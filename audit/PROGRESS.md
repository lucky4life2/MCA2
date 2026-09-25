# Security audit progress (branch `security-audit`)

## Phase 0: Setup (2026-09-24)
- Read-only subagent definitions committed in `.claude/agents/` (force-added, because `/.claude` is gitignored).
- **Model pinning via `.claude/agents/` did not take effect this session.** Claude Code loads agent definitions only at session start, so the new types were "not found". As a workaround, subagents run as `general-purpose` with an explicit `model` override (opus for security/legal, sonnet for frontend/repo), and each is told to follow its definition file. The read-only tool lists are not enforced by config in this mode. Read-only was enforced by instruction, and the lead made every change.
- Answers: block under-13 users at signup ("minimize legal risk"). Use the existing membership model (profiles.membership_* driven by Stripe). Git ops are authorized by the prompt.

## Phase 1: Research (2026-09-24)
Guidance applied to this stack:
- **Cloudflare `_headers`**: when several rules match a path and set the same header, the values are joined with a comma. For CSP that means the browser enforces *both* policies, so the page-specific strict CSP intersects with the `/*` CSP. That is correct, but it means `/*` can never be the stricter tier. Limits are 100 rules and 2,000 characters per line. `! Header` detaches a header.
- **OWASP HTTP Headers cheat sheet**: prefer CSP `frame-ancestors` (keep XFO DENY for legacy browsers), `nosniff`, `strict-origin-when-cross-origin`, HSTS with preload, and no `X-XSS-Protection`. COEP `require-corp` is **not** applied because it would block cross-origin Supabase storage images and Google Fonts that have no CORP.
- **OWASP Top 10:2025**: A01 Broken Access Control (RLS/RPC checks), A02 Security Misconfiguration (headers, grants), A03 Software Supply Chain Failures (third-party script origins such as esm.sh), A05 Injection (XSS sinks), A07 Authentication Failures (OTP/email abuse), A09 Logging & Alerting (audit_log).
- **Supabase RLS docs**: `to authenticated` on policies, `(select auth.uid())`, never trust `user_metadata`, views need `security_invoker`, and SECURITY DEFINER functions need `search_path=''` plus an internal check because anything in `public` is callable over `/rest/v1/rpc`.
- **Supabase production checklist**: RLS everywhere, CAPTCHA on auth endpoints (Turnstile already present), OTP expiry ≤ 3600s, custom SMTP, rate limits, leaked-password protection (dashboard setting, manual).

Sources: see the final report, §6.

## Phase 2: Audit and fix (in progress)
Public repo policy: this log records **fixed** issues only. Open findings are tracked privately, outside the repo, until they are fixed.

Blocker: DB migrations and edge-function deploys are refused by the Claude Code auto-mode classifier until the owner adds a permission rule. Pending SQL is in `audit/migrations/`, with rollbacks in `audit/rollback/`.

Verified OK (live DB): RLS is enabled on all 86 public tables. Membership/billing/role/status columns cannot be written by clients (`private.profiles_guard_columns`). Storage writes are permission-gated.

Fixed (branch commit 83eb395; the security part is also in hotfix PR #33):
- URL sanitizer `safeUrl()` (10 copies) now uses a `URL()`-parser http(s) allowlist
- `account.html` `escapeHtml` escapes quotes
- removed dead `getProfile()` (legacy `profiles.role`) and unused `signInWithEmail()`
- WCAG AA contrast for green labels and muted text in light mode
- Escape-to-close on nav dropdowns; outage-screen logo path; economy table overflow at 375px

### Phase 4 early items (file-side)
- **Age-handling decision changed from "block under-13" to "keep the existing verifiable-parental-consent system".** The site describes MCA as a club for students "from elementary school through ... high school", and FTC COPPA FAQ D.4 says a site directed at children may not simply block them. The existing DB-enforced consent system is the lower-risk path. Whether MCA is general-audience or child-directed is flagged for counsel.
- Entity name "MCA Inc., a North Dakota nonprofit corporation" in the Privacy Policy and Terms; footer © MCA Inc.
- Mojang-style disclaimer in the footer ("NOT AN OFFICIAL MINECRAFT PRODUCT…"); removed "Official … merchandise" from the shop; removed the inaccurate "non-commercial" claim.
- Added sections marked DRAFT: Terms (Nonpartisanship; Governing Law, North Dakota); Privacy (breach-notice sentence; Do Not Track / third-party tracking).

## Phase 3: Membership (done)
Uses the existing Stripe-driven model (`profiles.membership_*`); no new table.
- `audit_05_membership_state`:
  - `private.membership_state()` is the single rule set: none / active / grace (past_due, still paid) / cancelled (still paid) / expired.
  - Exposed as `get_my_membership_state()` for signed-in users and `get_membership_state_for_minecraft()` for service_role.
  - `user_meets_membership_gate()` now allows grace/cancelled and refuses frozen/terminated/restricted accounts.
  - `admin_set_membership(..., p_expires_at)` supports extend-to-date.
- `audit_06_membership_enforcement`:
  - A RESTRICTIVE `members_only` policy on all 56 congress_/court_/economy_ tables.
  - A write trigger on 6 economy tables for website sessions (SECURITY DEFINER RPCs bypass RLS).
  - Market-data RPCs revoked from anon.
- `member-gate.js`: hides member pages before first paint and shows a state-accurate message (sign in / membership required / expired on date / account frozen or terminated). Grace and cancelled members get an end-date banner. Page scripts wait for the check, so there is no flash and no data load.
- `admin.html`: Extend… button plus accurate badges. `account.html`: expired/grace wording.
- Minecraft plugin (`account linking Plugin Files/.../MembershipGateListener`): calls the service-role RPC and uses the same rules with state-specific kick messages. Compiles with `mvn compile`; build and deploy the jar manually.

Page classification:
- **Public:** index, leadership, history, archive, document, news, article, nations, help, login, privacy, terms, cookies, accessibility, refund, unsubscribe, parental-consent, 404, shop.
- **Signed-in:** account, tasks (staff features gated by permission).
- **Member-only:** server, economy, stocks, congress, court.
- **Staff-only (permission):** admin, news-publish, archive-publish.

Test matrix: run as a rolled-back DO block impersonating each role via JWT claims (full results in the final report). All 10 roles × 13 checks behaved as designed.

## Phase 4: Legal (done — not legal advice)
- `audit_07_deletion_and_retention` + `audit_08_audit_log_maintenance_window`:
  - Scheduled deletion now runs per user.
  - Accounts tied to civic records (votes, bills, filings, economy history) are anonymized in place instead of blocking every deletion. Before this, one such member made the nightly purge fail for everyone.
  - `audit_log` entries for the deleted member are scrubbed.
  - Tested rolled-back: plain member fully deleted; civic member anonymized with the record kept; audit_log stays immutable outside the maintenance functions.
- Retention job `purge-retention` (daily 03:30 UTC): audit_log 12 months; support threads 24 months after last message; orders 7 years; rate-limit counters 1 day. The schedule is published in the Privacy Policy (DRAFT).
- Legal text: see "Phase 4 early items" above. Applicability screen in `audit/legal-research.md`.
