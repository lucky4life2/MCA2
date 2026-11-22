# Edge Functions (Stripe)

These three functions are the whole payment path. They are deployed to the
Supabase project directly (same convention as `supabase/migrations/` — this
folder is a copy of what is live, not a `supabase functions deploy` source of
truth), and they are inert until real Stripe keys are set — except for
`create-checkout-session`'s `TEST_CHECKOUT_MODE`, a way to test checkout (and
anything downstream of it, like the Minecraft membership-gate plugin) before
Stripe is connected; see below.

| Function | verify_jwt | What it does |
|---|---|---|
| `create-checkout-session` | true | Builds a Stripe Checkout Session from the signed-in user's cart. Prices, stock, `cart_enabled`, the one-membership-per-account rule and the billing cycle/anchor are all read from `products` / `profiles` server-side — nothing the browser sends is trusted except the product ids and quantities. |
| `stripe-webhook` | **false** | Stripe calls this directly and cannot present a Supabase JWT; authenticity comes from the `Stripe-Signature` check. Records the order (with its line items and shipping address), takes goods out of stock, and keeps `profiles.membership_*` in step with the subscription. |
| `create-billing-portal-session` | true | Opens the Stripe-hosted billing portal so a member can change their card, download an invoice, or cancel. |

## Turning payments on

1. **Secrets** — from the project root:

   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

   Until `STRIPE_SECRET_KEY` is a real key, checkout answers
   `503 The shop is not accepting payments yet`, which is what the Checkout
   button shows the member.

   Optional: `SITE_URL` — only needed if the site is served from a domain
   other than `minecraftclubofamerica.me`. It sets where Stripe sends the
   browser back to. The `Origin` header is never trusted for that, because
   anyone with a user token can call these endpoints and set it.

2. **Webhook endpoint** — in the Stripe dashboard, add
   `https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1/stripe-webhook`
   and subscribe it to:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

   `STRIPE_WEBHOOK_SECRET` is the signing secret Stripe shows for that
   endpoint. Without the webhook, payments succeed and nothing on the site
   ever updates — no order rows, no membership, no stock changes.

3. **Customer portal** — Settings → Billing → Customer portal in Stripe, save
   a configuration. Without one, "Manage Billing" returns Stripe's own error
   and a member has no way to cancel.

4. **Test it in test mode first** with `sk_test_` keys and the Stripe CLI:

   ```
   stripe listen --forward-to https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1/stripe-webhook
   ```

   Buy the $12 membership with card `4242 4242 4242 4242`, then check that
   `profiles.membership_status` is `active`, `membership_current_period_end`
   is a year out, and a row landed in `orders`.

## Testing checkout and the Minecraft plugin without Stripe

`create-checkout-session` supports a `TEST_CHECKOUT_MODE` that exercises the
whole shop → checkout → membership/order → plugin-gate flow with no Stripe
account at all:

```
supabase secrets set TEST_CHECKOUT_MODE=true
```

With `STRIPE_SECRET_KEY` still unset/placeholder and this flag on, clicking
Checkout on the live site runs every real check (signed in, rate limit, cart
validity, stock, `cart_enabled`, the one-membership-per-account rule) exactly
as normal, then — instead of creating a Stripe session — does directly what
`stripe-webhook` would do once Stripe confirmed payment: inserts a row into
`orders`, decrements stock for goods, or sets `profiles.membership_status =
'active'` (`membership_source = 'test_checkout'`) with a real period end for
a subscription. The browser is sent straight to `shop.html?checkout=success`,
same as a real payment.

Because that flips `profiles.membership_status` for real, it is enough to
test the Minecraft membership-gate plugin (`MembershipGateListener` in the
account-linking plugin) end to end too — link a Minecraft account on the
account page, run a test subscription checkout, and the plugin's own
Supabase read of `membership_status`/`membership_current_period_end` sees an
active member, no different from a real Stripe purchase.

This path is dead code the instant `STRIPE_SECRET_KEY` is a real key
(`stripeConfigured` short-circuits it), so it can't accidentally stay on in
production — only ever set `TEST_CHECKOUT_MODE=true` on a dev/staging
Supabase project, and unset it (or just set the real Stripe key) before that
project ever takes real payments. Test orders/memberships are clearly marked
(`membership_source = 'test_checkout'`, and the order's
`stripe_checkout_session_id` is a `test_...` id rather than Stripe's `cs_...`)
so they're never mistaken for a real purchase in the admin panel or account
page.

## Things worth knowing

- **Idempotency.** Order rows are `insert`ed, not upserted, and both
  `stripe_checkout_session_id` and `stripe_invoice_id` are unique. A retried
  webhook delivery hits the duplicate-key error, which is how the function
  knows not to take the same items out of stock twice.
- **Stripe's API version.** The functions pin `2024-06-20` for their own
  calls, but webhook *payloads* are rendered with the Stripe account's
  version, which on a new account is newer. The fields that moved between
  those versions (`invoice.subscription`, `subscription.current_period_end`)
  are read from either shape.
- **Membership columns are server-only.** `profiles.membership_*` and
  `stripe_*` are not in the client UPDATE grant and are rejected by
  `private.profiles_guard_columns()`. They are written by this webhook
  (service role) or by `admin_set_membership()` (an admin comp) and nowhere
  else.
- **Revoking is not cancelling.** An admin revoke in the members table
  clears the columns; it does not touch Stripe. Cancel the subscription in
  Stripe too, or the next renewal turns the membership back on.

## Recovered functions (source recovered from live, 2026-11-22)

These six functions were deployed to the live project for months with **no
source in the repo** — the deployed-only copies were the only copies. Their
source was recovered verbatim from the live deployment on 2026-11-22 via the
Supabase Management API (`GET /v1/projects/<ref>/functions/<slug>/body`
with `Accept: multipart/form-data`, which unbundles server-side) and placed
here unchanged, so the repo is again the source of truth. Nothing was
rewritten: the recovered files are byte-identical to what the live project
runs (live versions at recovery time are noted below). They were deployed to
the **test** project only, to verify they run; they were not redeployed to
live, which already runs them.

| Function | verify_jwt | Live version at recovery | What it does |
|---|---|---|---|
| `notify-news-subscribers` | true | v15 | Emails every opted-in subscriber (`profiles.news_email_opt_in`) when a news article is published. Caller must hold `can_manage_news`. Sends via Resend in batches of 100, with RFC 8058 one-click unsubscribe headers. Returns `{ success, sent, total }`. Called from `admin.page.js` / `news-publish.page.js` with `{ articleId }`. |
| `signup-with-email` | false | v20 | Creates an unconfirmed account from email + password (+ optional DOB metadata) and emails a 6-digit code (SHA-256 hash stored, 15-minute expiry). Rate-limited 5/IP/hour and 3/address/hour; Turnstile enforced once `TURNSTILE_SECRET_KEY` is set. Reclaims an abandoned never-confirmed signup on the same address. The code is confirmed by `verify-signup-code` — this function never marks the email confirmed itself. |
| `submit-age-check` | true | v16 | Two-step age gate for a signed-in user. Step 1 (`dateOfBirth`): records DOB + `compute_age_band`, sets `active` (13+) with the member role or `coppa_restricted` (under 13). Step 2 (`parentEmail`): for under-13 accounts only, creates a `minor_consent` row (email-plus, 14-day token) and emails the parent a review/approve link + permanent portal link via Resend; records `notice_sent` + `portal_token_issued` events. |
| `confirm-parental-consent` | false | v15 | Parent approves/declines from the emailed link (`{ userId, token, decision }`). Approve clears `coppa_restricted` → `active` and grants the member role; decline keeps the account restricted and sets `deletion_scheduled_at` (7-day purge). Token is a SHA-256 hash comparison with a 14-day expiry. |
| `parent-portal` | false | v11 | Tokenized, no-account-required parent portal (`{ userId, portalToken, action }`). `review` shows the consent status and what was collected; `revoke` (approved consents only) and `request_deletion` restrict the account, clear its identity fields, schedule deletion, and log the event. The portal token never expires on its own. |
| `verify-signup-code` | false | v17 | Confirms the 6-digit signup code (`{ userId, code }`). Hash-compare with `timingSafeEqual`, max 5 attempts per code (`consume_code_attempt`). On match, marks the email confirmed (the only place that may) and returns a fresh session (`access_token` + `refresh_token`). |

Secrets these need (all read from `Deno.env`, none hardcoded):

- `RESEND_API_KEY` — required by `signup-with-email`, `submit-age-check`
  (parent-email step) and `notify-news-subscribers`; without it they answer
  500 "Email delivery not configured." It is set on live, **not** on the
  test project, so the email-sending paths cannot be exercised on test until
  someone sets it there (Kyden's call — it would let test send real mail).
- `TURNSTILE_SECRET_KEY` — optional; `signup-with-email` enforces the
  Turnstile challenge only once it is set.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — supplied
  automatically by the Supabase runtime on both projects.

Other live functions with no source in this repo (not recovered in this
round, still deployed-only): `add-email-to-account`, `admin-resend-verification`,
`check-account-status`, `confirm-email-link`, `delete-own-account`,
`email-member`, `mcaverify`, `notify-policy-update`, `notify-task-assignee`,
`request-password-reset`, `resend-signup-code`, `reset-password-with-code`,
`sign-in-with-email`, `unsubscribe`, `verify-email-code`, `verify-reset-code`.
Recover them the same way (Management API body endpoint, `Accept:
multipart/form-data`) if the repo ever needs to be their source of truth.
