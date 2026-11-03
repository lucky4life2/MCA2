# Payments safety — Stripe checklist pass (2026-11-02)

Branch: `compliance-20-2026-11-02`. No live changes in this pass: no
database writes, no Stripe/Supabase/Cloudflare dashboard changes, no emails
sent, no payment or refund tests run, no test/live mode flipped. The live
site is unchanged until merge + deploy.

## Per-item status

1. **Test mode — AUDITED, no change.** Mode comes only from the secret's
   value; no code distinguishes `sk_live_` from `sk_test_`. The
   `TEST_CHECKOUT_MODE` path in `create-checkout-session` is dead code the
   instant any real key is set, and it must never be enabled on the live
   project. Whether production is live is a separate open question (live
   keys `sk_live_`/`pk_live_`, live webhook secret, no test/debug flags,
   then one real small purchase + refund).
2. **Server-side prices — VERIFIED.** The browser sends only product ids
   and quantities; `create-checkout-session` loads prices from the DB and
   enforces: 100 distinct items max, 10/item (clamped, subscriptions
   forced to 1), $0.50 floor, $500 order total cap, stock checks, active
   membership rejection, 10 checkouts/5 min rate limit, 3 orders/member/day.
3. **Webhook unlock — VERIFIED.** Membership activation happens only in
   `stripe-webhook` (`checkout.session.completed` /
   `async_payment_succeeded` → order insert, stock decrement for goods,
   `syncSubscription()` re-fetching live Stripe state). `shop.html?
   checkout=success` is display-only (clears the local cart, shows an
   alert); no session id is even passed in the URL.
4. **Webhook signature — VERIFIED, fail-closed.** Missing secret, missing
   header, or bad signature all return 400 before any handler code runs.
5. **Duplicate webhooks — FIXED IN BRANCH.** Handler logic was already
   correct (insert + 23505 already-recorded path, stock gated on fresh
   insert). The gap was the index itself: added as a real migration,
   `supabase/migrations/20261102_orders_stripe_session_unique.sql`
   (`if not exists`, so it is a no-op where the live index already
   exists). This promotes one draft from `docs/pass3-index-drafts.sql`.
6. **Secret keys — VERIFIED.** No `sk_`/`whsec_`/`service_role` strings in
   any shipped frontend file. The only frontend key is the Supabase anon
   key (public by design). Server-side secrets are env vars only. The one
   repo-wide `sk_live_` hit is a placeholder in
   `supabase/functions/README.md`, not a real key.
7. **Declined-card test — PROCEDURE ONLY (below).** Never run live, never
   with a real card.
8. **Sales tax / VAT — DECISION, nothing enabled.** Checkout sets no
   `automatic_tax`, tax rates, or shipping rates, matching the cart note
   ("MCA adds no taxes, shipping, or other fees"). Enabling Stripe Tax
   would contradict that note and the terms wording — it needs Kyden's
   decision first, plus wording updates in `shop.html` and `terms.html`.
9. **Statement descriptor — DASHBOARD-ONLY.** No code sets one. Set it in
   Stripe Dashboard → Settings → Public details / Checkout settings.
   Value is Kyden's decision (not invented here).
10. **Renewal price — PARTIALLY FIXED.** Shop already shows amount +
    interval before purchase (card, modal, cart drawer). The account page
    showed only a renewal date, so it now shows `at $12/year` — mirroring
    the site's existing non-member copy ("Membership is $12/year"). This
    is hardcoded: if the live membership price/cycle ever changes, this
    line goes stale. Durable fix: persist renewal amount + interval onto
    the profile at webhook sync time and render that field instead. The
    past-due branch still shows no amount.
11. **Failed-payment email — GAP, sketch below.** Today there is no email:
    `invoice.payment_failed` only syncs status to `past_due`, and the
    account page shows a notice only when the member next visits. No
    proactive notification exists.
12. **Customer portal — VERIFIED (code).** Wiring is complete on account
    and shop pages (`Manage Billing` / `Update Payment` → billing-portal
    function → redirect). Which features members actually see depends on
    the Stripe dashboard default portal configuration — see checklist.
13. **Cancel flow — HONESTY FIX.** The button labelled "Cancel Membership"
    only opened a staff-message form; it did not cancel. It now reads
    "Request Cancellation" and its comment says so plainly. True
    self-serve cancellation lives in the Stripe portal ("Manage Billing")
    and only if the portal configuration allows it — see checklist. Do
    not point the button at the portal until that is confirmed, or
    members will land in a portal with no cancel option.
14. **Refund policy — VERIFIED.** Identical in substance on the refund
    page, terms, and checkout text: 7-day membership / 14-day merchandise
    + "Defective or wrong items are always replaced or refunded."

## Dashboard checklist (report-only, nothing changed)

- Stripe portal default configuration: confirm it allows subscription
  cancellation AND card updates AND invoice history. Required before any
  portal-based cancel button.
- Statement descriptor text (see item 9).
- Stripe Tax on/off (see item 8). If enabled, update the cart note and
  terms wording in the same change.
- Stripe dashboard automatic failed-payment emails (optional alternative
  or complement to item 11's code path).

## Declined-card test (test mode only — never live, never a real card)

1. Confirm the project is on test keys (`sk_test_…` secret, test-mode
   Stripe dashboard) with the Stripe CLI forwarding webhooks to the test
   project.
2. Record the test account's state first: `profiles.membership_status` /
   `membership_current_period_end`, its row count in `orders`, and the
   `inventory` of one goods product in the cart.
3. As the test account, check out a goods item (and, in a separate run,
   the membership product).
4. At Stripe Checkout, pay with `4000 0000 0000 0002` (generic decline)
   and, in a second run, `4000 0000 0000 9995` (insufficient funds). Any
   future expiry, any 3-digit CVC, any test ZIP.
5. Expected at Checkout: Stripe shows the decline inline and does NOT
   redirect to `shop.html?checkout=success`. The browser cart is left
   untouched so the buyer can retry.
6. Verify no access was granted: no new `orders` row with
   `status = 'paid'`; membership status/period end unchanged; goods
   inventory unchanged; member gates still show non-active.
7. Verify in Stripe (test mode): the payment shows as failed/declined and
   no `checkout.session.completed` fulfilment was sent for that session.
8. Positive control, as a separate test: retry with `4242 4242 4242 4242`
   and confirm the order row, stock decrement, and (for membership)
   active status appear only after that successful payment's webhook.
9. Clean up: delete or clearly mark any test orders/memberships from the
   positive control so they are never mistaken for real purchases.

## Failed-payment email — implementation sketch (not implemented)

- Trigger: the existing `invoice.payment_failed` case in
  `supabase/functions/stripe-webhook/index.ts`, immediately after
  `syncSubscription(subscriptionId)`.
- Recipient: `invoice.customer_email` (already available in that handler)
  or the linked profile email.
- Reuse: the site's deployed `email-member` function (referenced by
  `admin.page.js`) — but its source is NOT in this branch's
  `supabase/functions/` listing, so confirm its mail provider/secret
  before wiring it; otherwise add a Resend-style send inside
  `stripe-webhook` with a new secret. Message: the payment failed, access
  continues to the period end, link to `account.html` → Update Payment.
- Alternative: Stripe dashboard automatic failed-payment emails (see
  checklist above).

## Open questions for Kyden

- Confirm the live membership product is still $12/year (the account-page
  renewal line now hardcodes it, mirroring existing site copy).
- Confirm the Stripe portal configuration allows subscription cancellation
  (and card updates + invoice history).
- Statement descriptor text; Stripe Tax on or off.
- Production-live checks (item 1) + the real small purchase/refund test.
