# Pass 3 — protection checklist: decisions, proposals, and what was NOT changed

This file is the paper trail for the third MCA website checklist pass
(rate limiting, API limits, spending caps, error handling, loading/empty
states, retries, timeouts, duplicate submissions/payments, query
optimisation, indexes, pagination, upload compression/limits, caching,
uptime monitoring, error logging, load behaviour, backup restoration).
Code fixes from this pass live in the same commit; everything in this file
is a decision, a proposal, or a procedure — nothing here was provisioned,
subscribed, or applied live.

## 1. Rate limiting — what exists, what does not

- In code already: `create-checkout-session` and
  `create-billing-portal-session` call `check_rate_limit` (10 attempts per
  5 minutes, per user id, fail-closed). That covers the two money endpoints.
- Deliberately NOT throttled in code: `stripe-webhook`. It runs with
  `verify_jwt=false`; authenticity is the Stripe-Signature check, and
  throttling it could break Stripe's own retries. No IP-based throttle
  exists anywhere in the repo to blunt unsigned abuse against it — adding
  one must exempt/allow Stripe retries, so it needs a design decision, not
  a copy of the per-user limiter.
- Not in the repo at all: news, tasks, messages, congress, court, and
  economy are browser → PostgREST/RPC calls protected by RLS/permission
  functions, with no rate limiting in code (there are no Edge Functions
  for them in this repo). Per-IP throttling for those surfaces would live
  in Cloudflare (WAF / rate-limit rules) or Supabase Auth dashboard
  settings — both outside the repo and untouched by this pass.
  **Kyden decision:** whether to add Cloudflare rate-limit rules for the
  Supabase project host, and at what threshold.

## 2. API limits — code caps added this pass

- Checkout request body capped at 64 KB (413 above that); a checkout body
  is `{ items: [...] }` plus an idempotency key and never legitimately
  approaches it.
- Checkout capped at 100 distinct items. This also closes the webhook's
  unpaginated `listLineItems` page (100 lines, `has_more` ignored): a cart
  can no longer exceed one page, so no order can record truncated lines.
- Already in code, unchanged: per-line qty 1–99, subscription qty forced
  to 1, $0.50 minimum unit price, server-side stock check, one
  membership per account, mixed membership+goods rejected.

## 3. Spending caps — code guards vs dashboard decisions

Code guards (already present, unchanged): the $0.50 floor, qty/stock/
membership checks above, and the shop refusing payments (503) until a
real `STRIPE_SECRET_KEY` is set. `TEST_CHECKOUT_MODE` is dead code the
moment a real key is set, so a leftover `TEST_CHECKOUT_MODE=true` secret
cannot mint real memberships — but it should still be unset on the live
project for hygiene.

**Kyden decisions (dashboard, not repo — nothing changed):**
1. Stripe: whether to enable Radar rules and which (e.g. block high-risk
   payments, 3-D Secure prompting). Stripe Checkout has no single "global
   spend cap" toggle; the controls are Radar rules, manual review, and
   the server-side checks above. Also confirm: customer-portal
   configuration (without it members cannot cancel), webhook endpoint +
   subscribed events, and live-vs-test key handling.
2. Supabase: plan, spend-cap / usage-alert settings, and Edge Function
   invocation / DB-size / bandwidth quotas — confirm the actual settings
   in the dashboard and record them; none are visible from the repo.
3. Club policy (not invented here): maximum product price, maximum
   single-order total, and whether any per-member spend limit should exist
   at all.

## 10. Duplicate payments — what the idempotency key does and does not fix

- The webhook's replay dedup (insert into `orders`, treat `23505` as
  already-recorded, decrement stock only on a fresh insert) is sound
  **only if** a unique index on `orders.stripe_checkout_session_id` exists
  live. No in-repo migration creates it — see
  `docs/pass3-index-drafts.sql` and run the pre-check query there first.
  This is the single highest-priority live check from this pass.
- This pass adds a client-generated idempotency key to checkout session
  creation (supabase.js → create-checkout-session → Stripe). A retried or
  double-clicked checkout now returns the original Stripe session instead
  of creating a second one.
- Residual path, NOT fixed: two different browser tabs generate different
  keys, so two sessions for one cart are still possible (mitigated by the
  checkout-button disable and the 10/5min rate limit). A webhook guard
  that refuses a second active subscription for the same user would close
  it, but it needs care around legitimate re-subscription after expiry,
  so it is a follow-up decision, not a change made here. No live payment
  or refund action was taken or is proposed.

## 17. Uptime monitoring — proposal, NOT provisioned

In-repo evidence: no uptime/monitoring configuration exists in the repo
(`wrangler.jsonc` observability is Cloudflare Workers logs/metrics, not
an external check and not alerting). The site already has a once-daily
external health check run by the assistant; that lives outside this repo.

**Proposal (Kyden to approve the alert destination):** UptimeRobot (free
tier), one HTTP monitor, `GET https://minecraftclubofamerica.me/`
expecting HTTP 200, checked every 5 minutes, alerting to an email address
Kyden designates. Interval and channel are proposals, not club policy.
This complements the daily deep check (which covers sub-pages) with
continuous homepage-down detection; it does not replace it. No account
was created and no monitor was configured by this pass.

## 18. Error logging — Sentry is NOT wired in this branch

The premise for this item mentioned a Sentry ingest endpoint seen in the
site's security headers. In this branch's `_headers` there is no Sentry,
no `report-uri`, no `Report-To`, and no ingest host, and there is no
DSN, no `@sentry/*` import, and no `captureException` call anywhere in
the repo. If an ingest endpoint appears in live response headers, it is
added outside the repo (e.g. Cloudflare dashboard) or on another branch
— it is not wired into this code, and adding a `report-uri`/`Report-To`
without a collector would just generate failed reports.

What exists today: `console.error` only — in all three Edge Functions and
across client pages. Browser `console.error` is invisible to the
operator; Edge Function `console.error` surfaces only in Supabase's Edge
Function logs (dashboard, retention-limited, no alerting).

**Proposal (NEEDS-KYDEN-DECISION, including a minors-privacy review —
Sentry captures IPs/URLs by default, so PII scrubbing and the COPPA
posture must be considered before enabling):**
1. Server-side first: create a Sentry project, set a `SENTRY_DSN` Edge
   Function secret, initialise the Sentry Deno SDK once per function, and
   replace/augment the existing `console.error` calls in the three
   functions' `catch` blocks with `captureException` (no user emails, no
   request bodies).
2. Only if browser errors are wanted later: add the browser SDK +
   extend CSP `connect-src`/`script-src` for the Sentry host — a separate
   change, since today's strict CSP would block it.

## 20. Backup restoration — procedure proposal, nothing run

No backup script, restore runbook, or restore-test record exists in the
repo, and the security program document contains no backup/restore
section. Supabase platform backups / point-in-time recovery are
plan-dependent dashboard features; their enablement, retention window,
and whether Storage bucket files are covered are not visible in the repo
and were not verified live.

**Proposed procedure (text only, nothing run):**
1. Kyden records in the security program: Supabase plan, whether daily
   backups / PITR are enabled, retention window, and whether Storage
   objects are covered (if not, a separate bucket-backup step is needed)
   — all confirmed in the dashboard, not assumed.
2. Restore test (staging project only, never production): provision a
   separate Supabase project; restore the latest backup/PITR snapshot
   into it; run a smoke checklist — sign-in works, homepage + shop/
   account pages load, `orders` row count and latest
   `membership_current_period_end` match the production snapshot taken at
   backup time, a test checkout in `TEST_CHECKOUT_MODE` succeeds against
   the restored data; then delete the staging project.
3. Record the outcome (date, backup timestamp restored, RTO measured,
   any gaps found) in the repo and repeat on a cadence Kyden sets
   (proposal: before any major migration, at minimum). Until step 2 has
   been done once, "we have backups" must be treated as unverified.

## Follow-ups intentionally left out of this pass

- Pagination for news/tasks/products: news.js fetches all published
  articles because the featured banner (every page) and client-side search
  both depend on the full list — paginating it needs a two-query refactor
  (banner query + paged index query), not a one-line change. Tasks,
  congress, court, and admin lists have the same load-all shape; the
  admin audit log's `.range()` + Load More pattern is the model to copy.
  Documented as a gap, not half-fixed.
- Admin publish/unpublish/delete error checks (admin.page.js) and the
  account-page messages error branch: the files are large and the
  handlers are intertwined; patching them blind in this pass risked
  breaking the admin panel. The tasks-page pattern from this commit
  (check `{ error }`, surface it, never render failure as empty) is the
  template for those two.
- Congress/court modal submits and remaining task handlers (project
  save, comment add, checkoff toggles) still lack duplicate-submit
  guards; the tasks `tk-save` and archive `saveDoc` guards from this
  commit are the template (disabled-button + guard flag).
- Upload compression: no compression is applied anywhere (the only
  canvas use on the site is the 2FA QR code). Message/product photos and
  archive files are stored as uploaded; adding client-side resizing
  would change what users see and is a product decision, not a silent
  fix. Size caps (10 MB) are now enforced on all three upload paths.
- Load behaviour (item 19, simultaneous users): no load test was run
  against the live site (forbidden by the pass constraints). The
  remaining console-error risks found by audit are fixed where they were
  boot-critical (congress/court error UI guards, tasks boot catch); the
  rest are ordinary page-level errors, not load behaviour.
