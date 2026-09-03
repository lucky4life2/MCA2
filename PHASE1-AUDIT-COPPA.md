# Phase 1 — COPPA / Minor-Privacy Audit
**Minecraft Club of America (minecraftclubofamerica.me) — repo `lucky4life2/MCA2`**
Date: 2026-09-03. Scope: entire static front end, Supabase schema/RLS (project `hjaywokvgdzhvsoygctc`, queried live), and all 19 deployed Edge Functions. **No code was changed to produce this report.**

Method: full inventory of client-side PII-collecting fields (grep + read across every `.html`/`.js`), live `information_schema`/`pg_policies`/`pg_proc`/`pg_trigger` queries against production Postgres, live retrieval of Edge Function source for every function touching identity, consent, or email, and a live count against the production `minor_consent` table.

---

## 1. Personal-information inventory

"COPPA PI" below applies the amended 16 CFR §312.2 definition: first/last name; physical address; online contact info (email, or a **screen/username that functions as online contact information**, e.g. if it's also used to log in or message the person); telephone number; SSN; a **persistent identifier** that can recognize a user over time/site (this reaches `discord_id`, `google_id`, `minecraft_uuid`, and the Supabase auth UUID itself once it appears in a public URL); photos/videos/audio containing a child's image or voice; **geolocation** sufficient to identify street/city; and, new in the 2025 amendment, **biometric identifiers** and **government-issued identifiers**. This site does not collect biometrics, government IDs, phone numbers, audio, or geolocation anywhere I found — flagged explicitly where a category is absent rather than silently omitted.

### 1.1 `auth.users` (Supabase Auth, not directly queryable by app code)
| Field | COPPA PI | Required/Optional | Retention today |
|---|---|---|---|
| email | Yes (online contact info) | Required (email signup) or provider-supplied (OAuth) | Indefinite while account exists; deleted via `delete-own-account` or 7-day scheduled-deletion cron |
| hashed password | No (not "personal information" under §312.2, but sensitive) | Required (email signup) | Indefinite; Supabase-managed |
| OAuth identities (Discord sub+username, Google sub+name+email+photo) | Yes (persistent identifier + name/email/photo) | N/A (provider-driven) | Indefinite while linked |
| last_sign_in_at, IP/user-agent on auth events | Yes (IP can be PI) | N/A | Held in Supabase's own Auth logs, outside this schema — retention governed by Supabase, not app code |

### 1.2 `public.profiles` (one row per account, created immediately on signup — see §3)
| Column | COPPA PI | Required/Optional | Retention today |
|---|---|---|---|
| username, display_name | Yes (functions as online contact info — used to @-mention/DM inside admin messaging) | Required at signup (auto-derived from email local-part if blank) | Indefinite |
| email | Yes | Required | Indefinite; nulled only via account deletion/`clear_user_email` |
| discord_id, google_id | Yes (persistent identifier) | Optional (only if linked) | Indefinite while linked |
| minecraft_username, minecraft_uuid | Yes (persistent identifier) | Optional | Indefinite |
| minecraft_verified, mc_verify_code/expires | No / transient secret | — | `mc_verify_code` purged every 15 min by `purge_expired_profile_secrets()` cron if expired |
| role (legacy) | No | — | Indefinite |
| account_status, deactivated_at, deletion_scheduled_at | No | — | Deletion executes 7 days after scheduling (`purge-scheduled-deletions` cron, `03:00` daily) |
| pending_email, pending_email_token, pending_email_expires | Yes (email) / transient secret | — | Purged on expiry by the same cron |
| password_reset_token/expires | No (secret) | — | Purged on expiry by the same cron |
| news_email_opt_in, task_email_opt_in | No | Optional, defaults `false`/`true` respectively | Indefinite |
| email_access_revoked | No | — | Indefinite |

**No date-of-birth column, no age column, and no age-band column exist anywhere in the schema.** The only age-related fact stored is a single boolean (`minor_consent.is_minor_under_13`), captured once, only for accounts that happen to visit `account.html`.

### 1.3 `public.minor_consent` (added 2026-08-12; the entire current consent system)
| Column | COPPA PI | Notes |
|---|---|---|
| user_id | — | FK to profiles |
| is_minor_under_13 | No | Boolean only — not a DOB |
| parent_email | Yes | Plaintext |
| status | No | `pending` / `approved` / `declined` / `not_required` |
| consent_token | No (secret) | **Stored in plaintext**, not hashed (contrast with `signup-with-email`'s own comment explaining why *its* one-time code is SHA-256'd — the same reasoning wasn't applied here) |
| consent_token_expires, requested_at, approved_at, declined_at, updated_at | — | Only one event pair recorded per outcome; row is mutated in place (`update`), not appended — **no history**, no `notice_sent_at`, no `revoked_at`, no IP, no user-agent |

Live production data (queried directly): **14 rows `not_required`, 1 row `approved`, 0 `pending`/`declined`.** The one `approved` row is a real under-13 account that has been running with zero data-layer restriction since approval (see §3.6).

### 1.4 `public.public_profiles` (real table, RLS-enabled, synced from `profiles` by trigger `trg_sync_public_profile`)
`id, username, display_name, role` — readable by **every authenticated user**, unconditionally (`public_profiles_select_members`: `qual = true`). The sync trigger fires on any insert/update of `profiles.username/display_name/role` and does **not** check `minor_consent.status` or `account_status`. This is the site's real public member directory.

### 1.5 `public.profiles_public` (separate object — a plain view, no RLS of its own, `security invoker` semantics via underlying `profiles` RLS)
`id, username, display_name, minecraft_username, minecraft_verified, role, created_at` — access is gated by the caller's own `profiles` SELECT policy (self-or-staff), so in practice this view exposes nothing beyond what a user could already see of themselves; it does not appear to be the active public directory (that's §1.4).

### 1.6 Free-text fields that can carry incidental PII (any user-typed string; not schema-enforced)
`congress_debate_posts.body`, `congress_amendments`/`congress_motions`/`congress_committee_reports` notes, `court_filings.body`, `court_arguments.body`, `court_opinions`, `court_motions.note`, `court_case_recusals.reason`, `task_comments.body`, `nations.leader`, `news_articles.author_name` (defaults to the author's **raw email address** as the public byline when no display name/username is set — `news-publish.html:781`), `admin_messages`/`admin_message_items.body`, `admin_message_items.attachments`. None of these are COPPA PI *by column definition*, but any of them can become PI depending on what a user types, and all are publicly or semi-publicly visible.

### 1.7 `public.audit_log`
`actor_id, actor_name, actor_role, old_data, new_data` (jsonb). The `profiles` audit trigger logs only *changed* columns (diff-only, confirmed by reading `fn_audit_profiles()`), but a profile's `INSERT` event logs the **full new row** (`to_jsonb(NEW)`) as `new_data`, which includes `email` and `display_name` at minimum. Retention: indefinite, no purge job found.

### 1.8 Storage buckets (client-side `.storage.from()` call sites)
| Bucket | Public? | Contains | Path includes uploader's UUID? |
|---|---|---|---|
| `message-attachments` | Private (RLS-scoped read) | User/admin support-message image attachments | Yes — becomes part of a private, but persistent, identifier trail |
| `archive-files` | Public | Member-submitted archive documents | Yes — UUID appears in the **public** URL |
| `news-images` | Public | Article images | Yes (uploader is staff, not a child) |
| `shop-images` | Public | Product photos | No customer PII |

### 1.9 Categories confirmed **absent** site-wide
No phone number field, no physical mailing address field, no biometric data, no government-issued ID field, no audio, no geolocation collection (the Minecraft-server plugin bridge doesn't transmit player location), no payment/billing fields (Shop checkout button is a disabled placeholder — no name/address/card inputs exist in the DOM).

---

## 2. Third parties that receive user data

| Recipient | What it receives | Purpose |
|---|---|---|
| **Supabase** (`hjaywokvgdzhvsoygctc.supabase.co`) | Everything — full DB, Auth, Storage | Primary backend processor |
| **Cloudflare** | Hosting/CDN for all requests; Turnstile bot-check receives a browser challenge token + caller IP (`cf-connecting-ip`) server-side during signup verification | Hosting, DDoS/bot mitigation |
| **Discord** | OAuth: returns discord user id + Discord username to Supabase on sign-in/link | Login/identity provider |
| **Google** | OAuth: returns Google sub, name, email, profile photo (per `privacy.html:56`) | Login/identity provider — **note:** the task context describes auth as "email/password plus Discord OAuth," but the code (`login.html` Google buttons, `account.html` link/unlink, `profiles.google_id`, `privacy.html`'s dedicated Google Sign-In section) shows Google OAuth is fully wired and documented as live. Flagging this discrepancy for the record. |
| **Resend** (`api.resend.com`) | Recipient email addresses + message content for: signup verification codes, password-reset codes, parental-consent notices (parent's email, child's email as identifying context), news digests (opted-in members' email+name+what they read), admin 1:1 emails (`email-member`), task-assignee notifications, and (per an admin.html tooltip) a "legal-notice broadcast" sent to *every member with a usable email, plus the parent/guardian email on file for any approved under-13 account* | Transactional/broadcast email delivery — **this is third-party disclosure of a child's parent's email address and the fact of an approved under-13 account, with no separate disclosure-specific consent anywhere in the flow (see Gap #5 below)** |
| **esm.sh** | Nothing (CDN script fetch only, pinned version) | Serves `@supabase/supabase-js` |
| **api.mcstatus.io** | Nothing (public server ping) | Server status widget |
| Minecraft server plugin (self-hosted, via `mcaverify` Edge Function) | `minecraft_username`, `minecraft_uuid` (persistent identifiers) sent from the plugin to Supabase | Links a member's Minecraft account to their site profile |

No analytics/tracking script (Google Analytics, Plausible, GTM, etc.) was found anywhere in the repo.

---

## 3. Current age-gate / minor-consent flow, exactly as implemented

1. **Signup creates a fully active account before any age question is possible.** Every new `auth.users` row (email signup, Discord OAuth, or Google OAuth alike — confirmed via `pg_trigger`: `on_auth_user_created AFTER INSERT ON auth.users`, provider-agnostic) fires `handle_new_user()`, which immediately inserts a `profiles` row (`role='member'`, `email`, `display_name`) **and** grants the `member` entry in `user_roles`. This happens synchronously, with no age gate in between, for all three signup paths.
2. `login.html`'s "signup-consent" checkbox (`requireSignupConsent()`) is a general Terms/Privacy agreement checkbox — it does **not** ask for or record age or DOB. No DOB/age field exists on the signup form for any provider.
3. The only age question in the entire codebase lives in **`account.html`**, client-side: on page load, `getMinorConsent()` selects the caller's own `minor_consent` row; if it's missing, `pending`, or `declined`, the page hides the normal account UI and shows `#account-age-gate` ("Are you 13 or older?") instead.
   - "Yes" → `submit-age-check` Edge Function upserts `minor_consent(is_minor_under_13:false, status:'not_required')`. No DOB is ever captured — only this boolean.
   - "No" → collects a parent/guardian email in a text field, then `submit-age-check` upserts `minor_consent(is_minor_under_13:true, parent_email, status:'pending', consent_token:<uuid>, consent_token_expires:+14 days)` and, if `RESEND_API_KEY` is configured, sends a notice email to the parent via Resend containing a link to `parental-consent.html?uid=<id>&token=<token>`.
4. `parental-consent.html` (public page) reads `uid`/`token` from the query string and POSTs `{userId, token, decision}` to the public (`verify_jwt:false`) `confirm-parental-consent` function, which validates the token/expiry/current-status and sets `minor_consent.status` to `approved` or `declined`.
5. **Nothing else in the system ever reads `minor_consent.status`.** Confirmed by a full-text search of the repo and a direct query of `pg_policies`: the only two places that reference `minor_consent` are its own `SELECT`-own-row RLS policy and the two Edge Functions above. No RLS policy on any other table, no other RPC, and no other page checks it.
6. **Practical consequence:** the age gate is a same-page prompt on `account.html` only. The instant an account is created (any provider), it already has a full profile (username/display name/email), holds the `member` site role, and is listed in the open `public_profiles` directory to every authenticated user — regardless of whether `minor_consent` is missing, `pending`, or even `declined`. A user who never opens `account.html`, or who opens any other page first (`index.html`, `congress.html`, `court.html`, `tasks.html`, `news.html`, `nations.html`, `shop.html`), is never asked at all and faces no restriction anywhere. This was verified against **live production data**: one account currently has `minor_consent.status = 'approved'` for an under-13 user, and it has been operating as an ordinary, fully-provisioned `member` account (full profile, role, public listing) the entire time, with the RLS layer never having distinguished it from an adult account.
7. Declining consent (`status='declined'`) does not delete, freeze, or restrict the child's profile in any way — it only flips one column on `minor_consent`. The child's already-created `profiles` row, `member` role, and public-directory listing are untouched.
8. `profiles.account_status` (`active`/`deactivated`/`frozen`/`terminated`/`pending_deletion` — the full `CHECK` constraint) has no value representing a COPPA-restricted state, and is never set by any part of this flow; it stays `active` throughout.
9. Discord/Google OAuth signup goes through the identical `handle_new_user()` trigger and is subject to the identical (non-)gate — there is no code path that runs the age check as part of, or immediately after, the OAuth callback. A Discord/Google login is treated as sufficient to reach a fully active account; the age gate is only reachable if the user separately chooses to visit `account.html` afterward.

---

## 4. Gap table

| # | Requirement (16 CFR §312) | Current state | Gap | Proposed fix (Phase 2) |
|---|---|---|---|---|
| 1 | **§312.2** definition of "personal information" — amended to include biometric/government-ID/phone/audio/certain geolocation, alongside persistent identifiers, names, screen names that function as contact info | None of the new categories are collected (verified absent, §1.9). Persistent identifiers (`discord_id`, `google_id`, `minecraft_uuid`) and usernames-as-contact-info are collected and correctly treated as PI in this audit | No gap in collection scope; the gap is that the *rest* of the Rule's machinery (notice/consent/retention) doesn't apply to any of this data today | No new-category fix needed; ensure Phase 2's consent/notice text lists persistent identifiers explicitly |
| 2 | **§312.3 / §312.5(a)** — no collection of a child's PI without prior verifiable parental consent (subject to limited "collect parent contact info only" exception) | A full profile (username, display name, email, persistent identifiers if OAuth) is created and a site role is granted **before** any age question is asked, for every signup path | Direct violation: PI is collected from a (potential) under-13 user before any consent step exists, let alone completes | Phase 2 #1–#2: neutral DOB screen *at* signup, on all three providers; restricted-state account creation that defers profile completion until VPC |
| 3 | **§312.5(a)** — collection must stop, and the account must not function normally, pending consent | `minor_consent.status` is never enforced anywhere except a client-side UI branch on one page; verified live that an `approved` account and, by construction, any `pending`/`declined` one is fully functional at the RLS layer | No RLS enforcement exists at all for minor status; a direct PostgREST call bypasses the entire gate | Phase 2 #2: RLS policies on `profiles`, `public_profiles`, `user_roles`, storage buckets, and every content table gated on a restricted-state flag, not just client JS |
| 4 | **§312.4** — direct notice to the parent, separate from the privacy policy, with required content (what was collected, how used, that consent is required, parent's rights, link to full policy) | `submit-age-check`'s email covers: what MCA is, that consent is required before activation/collection, links to Privacy Policy and Terms | Missing: exact categories of information to be collected are not itemized in the notice (it says "personal information" generically, not "username, display name, persistent identifiers, etc."); no explicit statement of the parent's right to review/delete/refuse-further-collection (that's stated in the *privacy policy*, not the direct notice itself, contra §312.4's separateness requirement) `[uncertain: exact §312.4(c) subsection numbering for the itemized-content requirement — cite text, not letter, without further verification]` | Phase 2 #3: rewrite the notice template to itemize categories and state parental rights directly in the email body |
| 5 | **§312.5(b)/(c)** (2025 amendment) — a *separate*, opt-in, off-by-default consent specifically for disclosure to third parties, distinct from consent to collect/use; "email plus" is only sufficient for internal-use consent, not third-party-disclosure consent `[uncertain: exact subsection letter post-2025 renumbering — verify against current CFR text before citing in code/legal docs]` | **No such consent exists at all.** There is one boolean-equivalent outcome (`approved`/`declined`) covering everything. Meanwhile Resend (a third party) already receives the parent's email and the fact of an approved under-13 account via the notice email and the admin "legal-notice broadcast," and an approved child's data flows through Supabase (processor, not "disclosure" in the FTC sense) and potentially into `public_profiles`/audit logs visible to any staff member | No separate third-party-disclosure opt-in; no data-layer block on such disclosure in its absence | Phase 2 #4–#5: add `consent_method` abstraction + a distinct, defaulted-off third-party-disclosure consent row; hard-block any disclosure path at the RLS/RPC layer when absent |
| 6 | **§312.5(b)** — VPC methods; "email plus" (a confirming step after a delay) is a recognized method but weaker than others, and its use should match the org's actual risk (internal-only use) | Current mechanism is single-step: one email, one click (approve/decline) — **not even full "email plus,"** which requires a second, delayed confirmation step | Falls short of the "email plus" method it's closest to; no `consent_method` abstraction exists to swap in a stronger method later | Phase 2 #4: implement true email-plus (confirming second step after a delay) behind a `consent_method` abstraction |
| 7 | **§312.6** — parent's right to review, revoke, and have data deleted, exercisable easily | Privacy policy and the approval email describe this as "contact us"; no self-service mechanism exists — no token-based portal, no revoke button, no deletion trigger tied to revocation | No parent portal at all; the only "revoke" path is an email to a mailbox with no automation behind it | Phase 2 #7: tokenized parent portal (review/revoke/delete), wired to the existing account-deletion/restriction machinery |
| 8 | **§312.8** (2025 amendment) — written information security program naming a responsible person, risks assessed, safeguards, third-party recipients & assurances, review cadence | No such document exists in the repo | Missing entirely | Phase 2 #10: `SECURITY-PROGRAM.md` (`[NAME]` placeholder for the user to fill) |
| 9 | **§312.10** (2025 amendment) — data retention limited to what's reasonably necessary for the purpose collected; written retention policy; no indefinite retention | Scheduled-deletion machinery exists for member-initiated account deletion (7-day cron) and for expired secrets (15-min cron), but **nothing** retention-limits a declined/never-consented minor's already-created profile, nor limits `minor_consent`/`audit_log` rows, which are kept indefinitely with no purge job | No retention policy, written or enforced, for children's PI specifically; `consent_token` stored in plaintext indefinitely on approved/declined rows (nulled only on approve/decline transition, per the Edge Function code — confirmed) | Phase 2 #9: extend existing scheduled-deletion job to cover restricted/declined-consent accounts; publish retention policy in privacy policy |
| 10 | State minor-privacy laws (13–17): no targeted ads, no sale/share of data, no public geolocation, privacy-protective visibility defaults | No age band is stored at all (13–17 is indistinguishable from adult in the schema — `minor_consent` only ever asks "under 13, yes/no"), so no 13–17-specific defaults can exist | No 13–17 handling of any kind | Phase 2 #8: add `age_band` derived from stored DOB; apply defaults; `[uncertain: which specific state laws (CA, VA, CO, CT, etc.) apply turns on user residence, which this site doesn't collect — attorney judgment needed, will be flagged in `LEGAL-REVIEW-NEEDED.md`]` |
| 11 | Discord/Google OAuth must not bypass the age gate (COPPA doesn't recognize OAuth login as age verification) | Confirmed via `pg_trigger`: `handle_new_user()` fires identically for all three providers; the age gate is reachable only by separately visiting `account.html` | OAuth signups get a fully active account with zero age-gate exposure unless the user happens to click into account settings afterward | Phase 2 #12: run the neutral DOB screen as part of every signup path, including immediately after the OAuth callback, before the account is treated as unrestricted |
| 12 | Privacy policy accuracy (FTC Act §5 "unfair or deceptive" exposure independent of COPPA) | `privacy.html`'s Children's Privacy section states: *"we do not activate the account or collect any personal information beyond what's needed to request consent... The account stays inactive... until a parent completes this step."* | This is **not what the code does** — the account is fully activated (profile, role, public listing) immediately, before any consent step. The published policy makes an affirmative representation the implementation contradicts | Phase 2 #11: fix the implementation to match this representation (preferred, since the promised behavior is the correct one), then re-verify the policy text against the corrected code |

---

## 5. Notes for Phase 2 scoping

- **Reuse, don't duplicate:** `account_status` + its freeze/unfreeze/terminate RPCs and the 7-day scheduled-deletion cron (`purge-scheduled-deletions`) are the natural mechanism to extend for "restricted" state and for revocation-triggered deletion, per the task's constraints. `minor_consent` needs to become append-only (or gain a companion history table) to satisfy the ledger requirement (§312.8/§312.10-adjacent recordkeeping expectations) rather than being replaced.
- **`public_profiles` is the real public directory** (not `profiles_public`) — any "must not appear in a public listing" fix has to filter *this* table/policy.
- **Every write to `minor_consent` today goes through a `SECURITY DEFINER` service-role Edge Function**, not RLS `INSERT`/`UPDATE` policies (confirmed: only a `SELECT` policy exists on the table). The consent-ledger and parent-portal requirements in Phase 2 will need equivalent RLS policies added, since the acceptance criteria requires "the parent token may read/write only its own row" at the RLS layer, not just through a trusted Edge Function.
- Legal-citation confidence: section-level citations (§312.2, §312.3, §312.4, §312.5, §312.6, §312.8, §312.10) are given at normal confidence; **subsection-letter-level citations are marked `[uncertain]`** above and should be verified against the current CFR text before being written into `SECURITY-PROGRAM.md` or the privacy policy in Phase 2. No deadline or consent-method claim beyond what the task description itself supplied was fabricated.
- Full `LEGAL-REVIEW-NEEDED.md` (attorney-judgment items: directed-to-children vs. mixed-audience determination, which VPC method fits this org's risk tolerance, and state-law obligations turning on user residence) will be produced as part of Phase 2 per the task's own sequencing — the items are called out inline in the gap table above (rows 5, 10) in the meantime.

---

## 6. Files/objects touched to produce this report
None. This is a read-only audit. No migration, no Edge Function, and no repo file other than this report was created or modified.
