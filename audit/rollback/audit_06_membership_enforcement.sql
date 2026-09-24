-- Rollback for audit_06_membership_enforcement (2026-09-24).
-- audit_06 only ADDED objects (one restrictive policy per congress_/court_/economy_
-- table, economy write triggers, one trigger function) and revoked anon EXECUTE on
-- two market-data RPCs. Dropping them restores the previous behavior exactly.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'members_only' LOOP
    EXECUTE format('DROP POLICY IF EXISTS members_only ON public.%I', t);
  END LOOP;
  FOR t IN SELECT event_object_table FROM information_schema.triggers
           WHERE trigger_schema = 'public' AND trigger_name = 'trg_membership_required' LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_membership_required ON public.%I', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS private.enforce_membership_on_write();
GRANT EXECUTE ON FUNCTION public.economy_market_summary(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.economy_order_book(uuid, integer) TO anon;
