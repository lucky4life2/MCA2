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
