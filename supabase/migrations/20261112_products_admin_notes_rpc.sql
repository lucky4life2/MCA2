-- MCA security audit (run-1, 2026-11-12) — MEDIUM shop-products-select-star-admin_notes-column-exposure
--
-- Both shop product fetches used select('*'), and the live products_read
-- policy is row-level only, so the staff-only admin_notes column arrived in
-- every PostgREST response — including to anonymous visitors — even though
-- shop.page.js never renders it. RLS policies cannot restrict columns.
--
-- CORRECTION (mirror verification 2026-11-12): a bare
-- `revoke select (admin_notes) ...` does NOT hide the column here, because
-- anon + authenticated hold TABLE-level SELECT on products (verified live
-- via has_table_privilege), and a table-level grant dominates any
-- column-level revoke — anon could still `select admin_notes` after the
-- revoke (proven on the mirror: 'TOP SECRET NOTE' came back). The fix
-- therefore revokes table-level SELECT from both browser roles and
-- re-grants SELECT column-by-column for every column EXCEPT admin_notes.
-- NOTE FOR FUTURE COLUMNS: a column added to products later is NOT
-- readable by anon/authenticated until it is added to the GRANT list
-- below; the verify script catches a missing grant (shop list breaks)
-- and a present admin_notes grant alike.
--
-- Fix: serve staff reads through a staff-only SECURITY DEFINER function and
-- then revoke the table SELECT grant from both browser roles, re-granting
-- every other column. The admin page reads admin_notes through
-- public.admin_get_product_notes (which requires can_manage_shop);
-- shop.page.js now selects an explicit shopper column list omitting
-- admin_notes.
--
-- The admin WRITE path is untouched: only SELECT is revoked, and the
-- product save payload still writes admin_notes, so staff edits keep
-- working. Reads under service_role (Edge Functions use the admin
-- client) are likewise untouched — this revoke covers only anon
-- and authenticated. Repo-wide grep 2026-11-12 confirmed the only direct
-- products readers are shop.page.js and admin.page.js.
--
-- APPLY: run once against live Supabase (migration workflow). Reversible by
-- granting select on products back to anon and authenticated (table-level).
create or replace function public.admin_get_product_notes(p_product_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_notes text;
begin
  if not user_has_permission('can_manage_shop') then
    raise exception 'not permitted';
  end if;
  select admin_notes into v_notes from public.products where id = p_product_id;
  return v_notes;
end;
$function$;

revoke all on function public.admin_get_product_notes(uuid) from public;
grant execute on function public.admin_get_product_notes(uuid) to authenticated, service_role;

-- Column-level revoke alone is a no-op under the live table-level grant,
-- so revoke table-level SELECT first, then re-grant every column except
-- admin_notes. (Column list = live products columns 2026-11-12.)
revoke select on public.products from anon, authenticated;
grant select (
  id, name, description, price, inventory, category, image_url, active,
  created_at, image_url2, weight, dimensions, material, sizes, colors,
  sku, cart_enabled, product_type, images, billing_cycle, billing_anchor,
  billing_anchor_date
) on public.products to anon, authenticated;
