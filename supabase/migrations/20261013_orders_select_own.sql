-- 2026-10-13 review (H1): allow members to read their own orders.
-- The account page queries orders scoped to the signed-in user, but the only
-- orders SELECT policy in the repo was staff-only, so members always saw
-- "No orders yet" even with purchases. Apply in the Supabase SQL editor
-- (or via your migration tooling) as well as committing this file.
create policy orders_select_own on public.orders
  for select to authenticated
  using (auth.uid() = user_id);
