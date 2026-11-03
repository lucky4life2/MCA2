-- Payments-safety pass (2026-11-02): the stripe-webhook replay protection
-- relies on this unique index. On a replayed checkout.session.completed
-- delivery the orders insert fails with 23505 ("already recorded") and the
-- stock decrement is skipped, so stock comes off exactly once. This index
-- was verified live but was missing from the branch's migrations, so a
-- fresh database built from this branch alone would double-insert and
-- double-decrement stock on replay. Idempotent: safe to apply even if the
-- live index already exists (if it exists under a different name, both
-- coexist harmlessly).
create unique index if not exists orders_stripe_checkout_session_id_key
  on public.orders (stripe_checkout_session_id);
