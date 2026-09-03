# Written Information Security Program

**Minecraft Club of America, Inc.** ("MCA")
Effective: 2026-09-03. Required by the amended FTC COPPA Rule, 16 CFR § 312.8 (written information security program), effective June 23, 2025.

This document is the organization's written information security program. It is kept in the repository (not publicly served — see `.assetsignore`) so it stays current with the code it describes, and is reviewed on the cadence in §6.

## 1. Responsible individual

Designated coordinator of this security program: **[NAME]**

Until this is filled in, MCA has not satisfied § 312.8's requirement to designate a specific individual responsible for the program. This is a placeholder deliberately left for the organization to complete — no name was assumed or fabricated.

## 2. Scope

This program covers all personal information MCA collects through minecraftclubofamerica.me, its Supabase backend (project `hjaywokvgdzhvsoygctc`), and the Discord/Minecraft-server integrations described in the Privacy Policy — with particular attention to information collected from children under 13 under COPPA and from 13-17 year olds under applicable state minor-privacy law.

## 3. Risks assessed

| Risk | Assessment |
|---|---|
| A minor's account collecting/exposing personal information before verifiable parental consent | Addressed directly by this compliance effort: accounts start in a restricted state (`profiles.account_status = 'age_unverified'` / `'coppa_restricted'`) with no role, no public identity, and no storage access until the age gate and, for under-13 accounts, verifiable parental consent (VPC) clears. Enforced at the RLS/trigger layer, not only in client code — see §4. |
| Unauthorized disclosure of a child's information to a third party | The only implemented VPC method (email-plus) is structurally prevented from authorizing third-party disclosure — `minor_consent.third_party_disclosure_consent` cannot be `true` while `consent_method = 'email_plus'` (a database `CHECK` constraint, not just an application rule), and linking a third-party identity provider (Discord/Google) for an under-13 account is blocked at the same trigger layer. |
| Credential/token exposure | One-time codes and tokens (signup verification, password reset, parental-consent links) are stored as SHA-256 hashes, never plaintext, consistent site-wide. |
| Excessive data retention | The existing 7-day scheduled-deletion job (`purge-scheduled-deletions`) now also covers accounts whose parental consent was declined or revoked, so a child's collected information doesn't sit indefinitely after consent is refused or withdrawn. See §5. |
| Privilege escalation via direct API calls bypassing the UI | All of the above is enforced by Postgres Row-Level Security policies and `BEFORE`/`AFTER` triggers, verified in this effort by running test queries directly against the database as the `authenticated` role (not just by trusting client-side JavaScript). |
| Third-party processor risk | See §4 — every processor with access to user data is listed with the assurance MCA relies on. |
| Employee/volunteer access to member PII | Access to full member records, the admin messaging inbox, and the consent ledger is gated by the `hasPermission()` / `user_roles` + `roles.permissions` system, never a legacy role string. All changes to a member's profile are recorded in `audit_log` (diff-only for updates, full row for inserts/deletes), including changes to consent records (`minor_consent`, `minor_consent_events`). |

## 4. Safeguards in place

- **Access control:** every permission check in the codebase goes through `hasPermission()` / `user_has_permission()`, backed by `user_roles` + `roles.permissions` — never the legacy `profiles.role` column.
- **Row-Level Security:** every table holding personal information has RLS enabled with explicit policies (no table relies on default-deny alone without a reviewed policy set). The consent ledger (`minor_consent`, `minor_consent_events`) has no INSERT/UPDATE/DELETE policy for any client role at all — writes only happen through service-role Edge Functions, which bypass RLS by design, not through anything reachable from a browser.
- **Restricted account state:** a brand-new account (any signup path — email, Discord OAuth, or Google OAuth) starts with no role, no public profile listing, and no storage access, enforced by RLS policies and `BEFORE INSERT`/`BEFORE UPDATE` triggers keyed off `account_status` and `age_band` — not only by the client hiding UI.
- **Encryption in transit:** HSTS and `upgrade-insecure-requests` are set site-wide (`_headers`); all Supabase/API traffic is HTTPS/WSS.
- **Secret handling:** one-time codes and consent tokens are SHA-256-hashed at rest; the anon key embedded in client code is the public, RLS-backed publishable key, never a service-role key.
- **Audit trail:** `audit_log`, populated by diff-only triggers, covers `profiles` and (as of this effort) `minor_consent`, alongside its existing coverage of tasks, admin messaging, congress, and court actions.
- **Bot/abuse protection:** Cloudflare Turnstile is wired into the signup Edge Function server-side (site key configuration is a manual step tracked separately, not part of this compliance effort).

## 5. Data retention

Children's personal information is retained only as long as reasonably necessary for the purpose for which it was collected (16 CFR § 312.10):

- An account that never completes the age gate, or whose parent declines or later revokes consent, is restricted immediately and queued for deletion on the same 7-day schedule already used for member-requested account deletion (`profiles.deletion_scheduled_at`, purged by the `purge-scheduled-deletions` scheduled job). This is a widened version of the existing mechanism, not a parallel one.
- Transient secrets (one-time codes, password-reset tokens, the one-time parental-consent link token) expire on their own schedule and are purged by the existing `purge-expired-profile-secrets` job (every 15 minutes).
- The consent ledger (`minor_consent`, `minor_consent_events`) is cascade-deleted along with the account when it is finally purged. **This is flagged in `LEGAL-REVIEW-NEEDED.md`**: MCA loses its own proof of having properly requested/obtained/honored consent for that child once the account is purged, which may be undesirable from a recordkeeping standpoint even though it is protective from a data-minimization standpoint. No decision has been made to change this without legal input.
- MCA does not operate a targeted-advertising system, does not sell or share personal information, and does not collect geolocation data — so the state-law defaults requiring these be off are satisfied by the absence of the feature, not by a toggle that could be silently flipped on later. If any of these features are ever added, this program and the retention/consent design must be revisited first.

## 6. Third-party data recipients and assurances relied on

| Recipient | Data received | Assurance relied on |
|---|---|---|
| **Supabase** | All account, profile, and consent data (database, auth, storage) | Supabase is MCA's database/auth/storage processor; access is controlled entirely by MCA's own RLS policies and API keys. No separate data-processing agreement has been reviewed as part of this effort — flagged for the responsible individual to confirm. |
| **Cloudflare** | Hosting/CDN traffic; Turnstile bot-check receives a challenge token and the caller's IP | Standard hosting/CDN provider; no account PII is sent beyond what any hosting provider sees in normal request handling. |
| **Discord** | OAuth identity (Discord user ID, username) — only when a user chooses to sign in with or link Discord | Third-party OAuth identity provider. Under-13 accounts cannot link Discord without third-party-disclosure consent, which is currently unobtainable (see §3) — so no under-13 account can reach this path today. |
| **Google** | OAuth identity (Google sub, name, email, profile photo) — only when a user chooses to sign in with or link Google | Same as Discord, and subject to Google's own API Services User Data Policy (see Privacy Policy). Same under-13 block applies. |
| **Resend** | Recipient email addresses and message content for transactional email: signup verification, password reset, parental-consent notices and the permanent parent-portal link, and (for opted-in members) news digests | Transactional email processor. Parent-facing consent/notice emails are the mechanism the Rule itself requires (direct notice, 16 CFR § 312.4) — this is not "disclosure to a third party" in the sense the separate third-party-disclosure consent covers. |
| Minecraft server plugin bridge (`mcaverify` Edge Function) | `minecraft_username`, `minecraft_uuid` (persistent identifiers) | MCA's own, self-hosted Minecraft server — an extension of the Service itself, not an external operator, per the existing Privacy Policy's description of "the Services." Authenticated by a shared secret (`MCA_PLUGIN_SECRET`), not open to the public internet. |

## 7. Review cadence

This program, and the code it describes, should be reviewed:

- Whenever a new feature collects, displays, or transmits personal information (before it ships, not after).
- Whenever a new third-party integration is added.
- At least annually, by the individual named in §1.
- Immediately upon any known or suspected security incident involving personal information.

No review has occurred yet beyond the authoring of this document and the Phase 1/Phase 2 compliance effort it accompanies (`PHASE1-AUDIT-COPPA.md`, this Phase 2 implementation).
