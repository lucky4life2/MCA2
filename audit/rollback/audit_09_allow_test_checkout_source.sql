-- Rollback for audit_09_allow_test_checkout_source (2026-09-24).
-- Clears any test_checkout rows first so the original constraint can be re-added.
UPDATE public.profiles SET membership_source = NULL WHERE membership_source = 'test_checkout';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_membership_source_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_membership_source_valid
  CHECK ((membership_source IS NULL) OR (membership_source = ANY (ARRAY['stripe'::text, 'admin_grant'::text])));
