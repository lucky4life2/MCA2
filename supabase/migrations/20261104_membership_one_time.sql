-- Membership one-time payment (2026-11-04): membership checkout is a
-- one-time $12 payment for one year, with no Stripe subscription object.
-- The stripe-webhook one-time path records that with a new
-- membership_source value, 'stripe_onetime', so the profiles CHECK
-- constraint has to allow it — otherwise the grant UPDATE fails the
-- CHECK and the webhook returns 500 for every membership payment.
--
-- Apply BEFORE the new webhook code serves traffic. No data change:
-- every value already in the column (NULL, 'stripe', 'admin_grant',
-- 'test_checkout') is still allowed by the widened constraint.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_membership_source_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_membership_source_valid
  CHECK ((membership_source IS NULL) OR (membership_source = ANY (ARRAY['stripe'::text, 'admin_grant'::text, 'test_checkout'::text, 'stripe_onetime'::text])));
