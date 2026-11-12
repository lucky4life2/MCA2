-- MCA security audit (run-1, 2026-11-12) — MEDIUM shop:checkout:inventory-oversell-unreserved (SQL half only)
--
-- Stock was checked only point-in-time at checkout creation and never
-- reserved; at fulfilment shop_consume_inventory decremented with
-- inventory = greatest(coalesce(inventory, 0) - v_qty, 0), silently
-- clamping at zero. Two buyers paying for the last unit both got recorded
-- orders while only one unit existed — the second order unfulfillable.
--
-- Fix (this migration, SQL half): consumption now fails instead of
-- clamping. The UPDATE carries an inventory >= v_qty precondition and
-- raises 'insufficient stock' when no row updates. The function body is
-- otherwise the definition in 20260910_shop_membership_hardening.sql
-- verbatim (service_role guard, id validation, subscription exclusion).
--
-- The webhook caller half is NOT this migration: the stripe-webhook caller
-- must treat the exception as an oversell requiring a refund or hold, not
-- a silent success (that half is another agent's job). A reservation at
-- checkout time would be the stronger fix, but is out of scope here.
--
-- APPLY: run once against live Supabase (migration workflow). NOTE: after
-- this lands, a webhook fulfilment that hits insufficient stock raises
-- instead of recording a phantom fulfilment — the caller must handle it.
create or replace function public.shop_consume_inventory(p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_qty  integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'shop_consume_inventory is server-only';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_qty := greatest(coalesce((v_item->>'qty')::integer, 0), 0);
    continue when v_qty = 0
      or (v_item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    -- Audit fix (shop:checkout:inventory-oversell-unreserved): fail loudly
    -- on insufficient stock instead of clamping inventory at zero. The
    -- caller must treat zero updated rows as an oversell (refund/hold),
    -- not a silent success.
    update public.products
    set inventory = inventory - v_qty
    where id = (v_item->>'id')::uuid
      and product_type <> 'subscription'
      and inventory is not null
      and inventory >= v_qty;
    if not found then
      raise exception 'insufficient stock for product %', (v_item->>'id');
    end if;
  end loop;
end;
$function$;

revoke all on function public.shop_consume_inventory(jsonb) from public, anon, authenticated;
grant execute on function public.shop_consume_inventory(jsonb) to service_role;
