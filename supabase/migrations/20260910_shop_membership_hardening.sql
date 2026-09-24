-- Shop + membership hardening.
--
-- Applied directly to the Supabase project (see supabase/migrations/README.md
-- for why this folder is not a full migration history); kept here because the
-- fixes below are what make the Stripe integration safe to switch on.
--
-- 1. profiles.membership_* / stripe_* were client-writable and client-
--    unreadable at the same time: the column-level UPDATE grant covered them
--    (so any signed-in user could hand themselves a 100-year membership with
--    one PostgREST call) while the column-level SELECT grant did not (so
--    nav.js / account.html / admin.html could never read the real status).
-- 2. products could only be written by the legacy profiles.role admin/owner
--    values, so the can_manage_shop permission granted nothing.
-- 3. orders were readable only by their owner, so no staff member could see
--    what had been bought.
-- 4. paid orders never touched inventory.

-- ── 1a. Let the client read its own membership state ────────────────────
-- Row visibility is still governed by the profiles_select_self_or_staff RLS
-- policy; this only stops "permission denied for table profiles" on any
-- select that names a membership column.
grant select (membership_status, membership_source, membership_current_period_end)
  on public.profiles to authenticated;

-- Same omission, two columns older: age_band (COPPA, added 20260903) and
-- public_listing_opt_in were never added to the allowlist either, so the
-- account page's age gate re-prompted members who had already answered and
-- its directory checkbox always rendered unchecked. date_of_birth stays
-- unreadable on purpose — "has this been answered" is what the page needs,
-- and age_band answers it.
grant select (age_band, public_listing_opt_in) on public.profiles to authenticated;

-- ── 1b. Membership + Stripe columns become server-only ──────────────────
-- anon/authenticated hold a TABLE-level UPDATE grant on profiles, and a
-- column-level revoke cannot carve columns out of a table-level grant (it
-- silently revokes nothing). So the table grant is dropped and replaced
-- with an explicit column list. The columns left out are exactly the ones
-- private.profiles_guard_columns() below already rejects for these roles,
-- so nothing that used to succeed starts failing — the rule just also
-- applies one layer lower, where PostgREST refuses the request before the
-- row is touched.
revoke update on public.profiles from authenticated, anon;

grant update (
  id, username, display_name, minecraft_username, created_at, discord_id,
  minecraft_verified, mc_verify_code, mc_verify_expires, google_id,
  news_email_opt_in, task_email_opt_in, date_of_birth, age_band,
  public_listing_opt_in
) on public.profiles to authenticated, anon;

-- Defence in depth for any path that still reaches the table as an
-- authenticated role. SECURITY DEFINER callers (admin_set_membership) and
-- the service role (the Stripe webhook) run as the function owner /
-- service_role and are unaffected.
create or replace function private.profiles_guard_columns()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
declare
  v_is_self  boolean;
  v_is_staff boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  v_is_self  := auth.uid() = old.id;
  v_is_staff := private.get_my_role() = any(array['admin','owner'])
                or public.user_has_permission('can_manage_users')
                or public.user_has_permission('can_manage_minecraft');

  -- Never client-writable, by anyone: real credentials/tokens (always
  -- issued and consumed server-side) and fields every RPC that touches them
  -- already exists specifically to gate.
  if new.password_reset_token    is distinct from old.password_reset_token
  or new.password_reset_expires  is distinct from old.password_reset_expires
  or new.password_reset_attempts is distinct from old.password_reset_attempts
  or new.pending_email           is distinct from old.pending_email
  or new.pending_email_token     is distinct from old.pending_email_token
  or new.pending_email_expires   is distinct from old.pending_email_expires
  or new.pending_email_attempts  is distinct from old.pending_email_attempts
  or new.role                    is distinct from old.role
  or new.account_status          is distinct from old.account_status
  or new.email_access_revoked    is distinct from old.email_access_revoked
  or new.deletion_scheduled_at   is distinct from old.deletion_scheduled_at
  or new.deactivated_at          is distinct from old.deactivated_at
  or new.minecraft_uuid          is distinct from old.minecraft_uuid
  or new.email                   is distinct from old.email
  or new.email_unsub_token       is distinct from old.email_unsub_token
  then
    raise exception 'profiles: that field can only be changed by the server';
  end if;

  -- Membership is money: it is written by the Stripe webhook (service_role)
  -- or by admin_set_membership() (SECURITY DEFINER, gated on
  -- can_manage_memberships), never by a client update — not even a staff
  -- one, which would otherwise be an unaudited way around that RPC.
  if new.membership_status             is distinct from old.membership_status
  or new.membership_source             is distinct from old.membership_source
  or new.membership_current_period_end is distinct from old.membership_current_period_end
  or new.stripe_customer_id            is distinct from old.stripe_customer_id
  or new.stripe_subscription_id        is distinct from old.stripe_subscription_id
  then
    raise exception 'profiles: membership and billing fields can only be changed by the server';
  end if;

  -- mc_verify_code / mc_verify_expires: only the row owner may set these
  -- (a self-chosen verification nonce -- not a privilege by itself).
  if (new.mc_verify_code is distinct from old.mc_verify_code
      or new.mc_verify_expires is distinct from old.mc_verify_expires)
     and not v_is_self
  then
    raise exception 'profiles: mc_verify_code can only be set by its owner';
  end if;

  -- minecraft_verified: staff may flip this on someone else's row (the
  -- admin approve/revoke Minecraft-link buttons); nobody may set it on
  -- their own row directly.
  if new.minecraft_verified is distinct from old.minecraft_verified and not v_is_staff then
    raise exception 'profiles: minecraft_verified can only be changed by staff';
  end if;

  -- discord_id / google_id: self may only clear (unlink) their own link,
  -- never set it to an arbitrary value directly.
  if new.discord_id is distinct from old.discord_id and new.discord_id is not null then
    raise exception 'profiles: discord_id can only be cleared, not set, directly';
  end if;
  if new.google_id is distinct from old.google_id and new.google_id is not null then
    raise exception 'profiles: google_id can only be cleared, not set, directly';
  end if;

  return new;
end;
$function$;

-- ── 2. can_manage_shop actually manages the shop ────────────────────────
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists products_delete on public.products;

create policy products_insert on public.products
  for insert to public
  with check (public.user_has_permission('can_manage_shop')
              or private.get_my_role() = any (array['admin','owner']));

create policy products_update on public.products
  for update to public
  using (public.user_has_permission('can_manage_shop')
         or private.get_my_role() = any (array['admin','owner']))
  with check (public.user_has_permission('can_manage_shop')
              or private.get_my_role() = any (array['admin','owner']));

create policy products_delete on public.products
  for delete to public
  using (public.user_has_permission('can_manage_shop')
         or private.get_my_role() = any (array['admin','owner']));

-- ── 3. Orders: what was bought, and who can see it ──────────────────────
alter table public.orders add column if not exists customer_email text;
alter table public.orders add column if not exists shipping jsonb;

-- Subscription renewals never create a Checkout Session, so they produced no
-- orders row at all: a member's order history showed the first year and then
-- nothing, forever. Renewal invoices get their own row, keyed on the invoice
-- id so a retried webhook delivery can't duplicate it.
alter table public.orders add column if not exists stripe_invoice_id text;
create unique index if not exists orders_stripe_invoice_id_key
  on public.orders (stripe_invoice_id);

drop policy if exists orders_select_staff on public.orders;
create policy orders_select_staff on public.orders
  for select to public
  using (public.user_has_permission('can_manage_shop')
         or private.get_my_role() = any (array['admin','owner']));

-- ── 4. Paid goods come out of stock ─────────────────────────────────────
-- Called by the stripe-webhook function with the service role, once per
-- order row that was actually newly inserted (Stripe retries webhooks, and
-- a retry must not decrement twice).
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

    update public.products
    set inventory = greatest(coalesce(inventory, 0) - v_qty, 0)
    where id = (v_item->>'id')::uuid
      and product_type <> 'subscription'
      and inventory is not null;
  end loop;
end;
$function$;

revoke all on function public.shop_consume_inventory(jsonb) from public, anon, authenticated;
grant execute on function public.shop_consume_inventory(jsonb) to service_role;
