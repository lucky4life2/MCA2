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
