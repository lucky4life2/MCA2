# Legal Review Needed

Items from the COPPA/minor-privacy compliance effort (`PHASE1-AUDIT-COPPA.md` and the Phase 2 implementation that followed it) that require an attorney's judgment, not an engineering decision. Nothing below was decided unilaterally in code beyond the minimum needed to make the site internally consistent and safe by default.

## 1. Is MCA "directed to children" or "mixed audience" under COPPA?

This determination changes real obligations (e.g., whether *every* user must be age-screened, vs. only screening triggered by actual knowledge). The implementation in this effort treats the site conservatively as mixed-audience with a neutral age screen applied to every new account regardless of provider, which is defensible under either characterization — but the underlying legal classification itself was not decided here and should be confirmed by counsel, considering factors like subject matter (a Minecraft server), the "elementary through high school" framing already in the Privacy Policy/Terms, marketing, and actual user demographics. `[uncertain]`

## 2. Is "email plus" the right VPC method for this organization's risk tolerance?

Only "email plus" is implemented (a parent email plus a confirming decision on a linked page). This is one of the FTC's longer-standing recognized methods, but it is also one of the weaker ones, and the Rule requires a *stronger* method before any child's information can be disclosed to a third party (16 CFR § 312.5(b)-(c) as amended). The code enforces this boundary by making `third_party_disclosure_consent` structurally impossible to be `true` while `consent_method = 'email_plus'` — but no stronger method (signed consent form, video conference, government-ID verification, knowledge-based authentication, payment-system verification, facial age estimation, etc.) has been implemented, and choosing one is exactly the kind of "choosing between VPC methods where the choice changes legal exposure" decision the task instructions reserved for a human. If MCA ever wants to disclose a child's information to a third party (including allowing an under-13 account to link Discord/Google), a stronger method must be chosen and implemented first. `[uncertain — do not implement a stronger method without this decision]`

## 3. State-law obligations that turn on user residence

This site does not collect a mailing address or any other residence signal, so it cannot currently determine which state's minor-privacy law (e.g., California, Virginia, Colorado, Connecticut, and others with their own thresholds and requirements) applies to a given 13-17 user. The defaults implemented (no targeted advertising, no sale/share of data, no public geolocation, privacy-protective profile-visibility default) are deliberately the most protective common denominator across these laws, chosen so the site isn't in violation of *any* of them by default — but:

- Whether MCA is a "covered entity" under any specific state law (based on revenue, user counts, or other thresholds) was not determined here.
- Whether collecting residence/state to apply state-specific rules more precisely is itself worth the added data collection is a tradeoff counsel should weigh in on. `[uncertain]`

## 4. Recordkeeping vs. retention-limitation tension in the consent ledger

`minor_consent` and `minor_consent_events` (the append-only consent ledger) are deleted via `ON DELETE CASCADE` when the underlying account is purged by the retention job. This means MCA's own proof that it properly requested, obtained, or honored a revocation of parental consent for a given child disappears once that child's account is purged (7 days after decline/revocation, or whenever a self-requested deletion completes for an approved account). This is the more protective choice from a data-minimization standpoint (16 CFR § 312.10) but may leave MCA without records to demonstrate compliance if ever questioned. Retaining a minimal, de-identified compliance record (e.g., "a consent request was sent on date X and declined on date Y for the [region] chapter," with no identifier tying it back to the specific child) after purge is a design counsel may want considered. Not implemented pending that judgment. `[uncertain]`

## 5. Whether Discord/Google account linking constitutes "disclosure to a third party" at all

The Privacy Policy already describes Discord and the Minecraft server as part of "the Services" MCA operates, which could support an argument that linking isn't a disclosure to an *external* third party in the same sense as, say, selling data to an ad network. This effort took the more protective reading — Discord Inc. and Google are legally distinct operators receiving a persistent identifier, so linking is treated as third-party disclosure requiring the stronger-than-email-plus consent described in item 2, and is blocked at the database layer for under-13 accounts as a result. Whether that's the *correct* legal characterization, or whether a narrower reading is defensible, is a question for counsel. `[uncertain]`

## 6. Direct-notice content sufficiency (16 CFR § 312.4)

The parent notice email (sent by `submit-age-check`) itemizes what's collected and states the parent's rights, but the exact subsection-level content requirements of § 312.4 as amended were not independently re-verified against the current CFR text beyond what this effort's authors could recall with confidence — flagged in `PHASE1-AUDIT-COPPA.md`'s gap table as `[uncertain]` for the same reason. Counsel should confirm the notice text satisfies every enumerated content requirement before this is relied on in a real enforcement context.

## 7. Google OAuth's presence

The task context describing this project's auth methods mentioned only email/password and Discord OAuth, but the live code (and the already-published Privacy Policy) shows Google OAuth is also fully wired up. This was preserved and brought under the same age-gate/third-party-disclosure protections as Discord rather than removed, since removing a live auth method wasn't requested — but it's flagged here in case the discrepancy from the stated context means Google sign-in was supposed to have been decommissioned and simply wasn't, which would be a business decision, not a legal one, but is adjacent enough to flag alongside these.

---

None of the above blocked shipping the Phase 2 technical implementation, because the implementation was built to be conservative by default (block first, require an explicit future decision to loosen) rather than assume an answer to any of these questions.

## 8. General federal/state law compliance pass — 2026-09-04

A broader "make sure the site complies with all applicable laws" pass (beyond COPPA specifically). Everything below was either fixed outright or is flagged here because it needs a fact or a decision only the site owner/counsel can supply — nothing was fabricated.

**Fixed this session (code/schema/content, no owner input required):**
- CAN-SPAM (15 U.S.C. § 7704) one-click, no-login unsubscribe for the news digest and task-assignment emails (`unsubscribe` Edge Function, `unsubscribe.html`, `List-Unsubscribe`/`List-Unsubscribe-Post` headers for Gmail/Outlook/Yahoo's built-in one-click button), replacing the previous login-gated "manage preferences" link as the *only* opt-out.
- DMCA notice-and-takedown section added to `terms.html` (17 U.S.C. § 512): notice requirements, counter-notice process, repeat-infringer termination.
- Accessibility Statement page added (`accessibility.html`, linked from the footer): WCAG 2.1 AA conformance target, a feedback contact, consistent with ADA Title II/III web-accessibility expectations.
- State privacy-rights section added to `privacy.html` (know/access, correct, delete, opt-out-of-sale, non-discrimination) — formalizes the site's existing no-sale/no-targeted-ads posture into explicit rights language for CCPA/CPRA and comparable state laws.
- `profiles_update` RLS column-blind write access (flagged in `AUDIT-2026-09-01.md` finding #7) — a `can_manage_minecraft`-only caller (no `admin`/`owner`/`can_manage_users`) can no longer change another member's `username`, `display_name`, `public_listing_opt_in`, or `news_email_opt_in`; the security-critical columns (`role`, `email`, `account_status`, all tokens) were already unconditionally protected by the `profiles_guard_columns` trigger added in Phase 2. No custom role in the live database currently grants `can_manage_minecraft` without also granting one of the exempted permissions, so this closes a *latent* gap (relevant the next time an owner creates a narrower custom role via the role editor), not an active one.

**Needs the site owner to supply a fact (not a legal judgment — just missing information):**
- **CAN-SPAM physical postal address.** Every commercial/bulk email must include a valid postal address (15 U.S.C. § 7704(a)(5)(A)(iii)) — a P.O. Box is acceptable. The news-digest email currently renders a bracketed placeholder (`[MAILING ADDRESS NEEDED ...]`) in `notify-news-subscribers`'s footer so it's impossible to miss in the next digest sent. **Action:** update the `MAILING_ADDRESS` constant in that Edge Function (and in `notify-task-assignee` if a postal address is added there too) with a real address once one exists.
- **DMCA designated agent registration.** The notice-and-takedown *policy* is now in `terms.html`, but full DMCA safe-harbor protection (17 U.S.C. § 512(c)) also requires registering a designated agent with the U.S. Copyright Office at [dmca.copyright.gov](https://dmca.copyright.gov) (a small recurring fee, renewed periodically) — an account/business action outside what code or a database migration can do. **Action:** register `minecraftclubofamerica@gmail.com` (or whoever should hold this role) as the designated agent.

**Needs a Supabase Dashboard change (not reachable via any tool available to this effort):**
- **Leaked-password protection is still disabled** in Supabase Auth (re-confirmed live via the security advisor this session — same finding as `AUDIT-2026-09-01.md` #2). Dashboard → Authentication → Sign In / Providers → Password → enable "Leaked password protection." No code change, no data risk.

**Still attorney-judgment calls (not attempted, consistent with items #1-#7 above):**
- Whether MCA's revenue/user counts actually cross any state privacy law's "covered business" threshold (e.g., CCPA's $25M/100k-consumer/50%-revenue tests) was not determined — the new state-rights section in `privacy.html` honors those rights regardless, which is protective either way but isn't itself a determination of legal coverage.
- No governing-law/dispute-resolution (venue, arbitration) clause was added to `terms.html` — doing so requires knowing MCA's actual state of organization/operation, which wasn't provided and shouldn't be guessed.
- Whether any state's "social media platform" minor-safety statute (age-verification/parental-control mandates some states have enacted for larger platforms) reaches an organization of MCA's size was not researched or determined here — flagging only because the task description asked about "internet safety laws" broadly; nothing was implemented against an unconfirmed statute.
