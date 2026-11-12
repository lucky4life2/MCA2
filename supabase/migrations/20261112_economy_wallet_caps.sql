-- MCA security audit (run-1, 2026-11-12) — LOW economy:business-wallet-no-creation-cap
--
-- _economy_create_account capped personal accounts only (one per actor).
-- Any member could create unlimited business wallets — and, per nation_id,
-- unlimited nation wallets — by repeating the UI or calling the RPC
-- directly. Creation mints no Marks, so the harm is proliferation (wallet
-- clutter, many wallets usable to fragment or obscure fund flows).
--
-- Fix: reject business creation at 5 per actor and nation creation at 5
-- per nation_id. 5 is a club-chosen cap; generous is the point — the fix
-- closes unbounded creation, not tight budgeting. Closed wallets still
-- count toward the cap (counting only open wallets would let a close/create
-- loop recreate the same proliferation).
--
-- APPLY: run once against live Supabase (migration workflow). If any actor
-- already holds more than 5 business wallets (or any nation more than 5),
-- this does not delete them — it only blocks further creation past the cap.
create or replace function public._economy_create_account(p_actor uuid, p_type text, p_name text, p_nation_id uuid default null::uuid)
 returns economy_accounts
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_account public.economy_accounts;
begin
  if p_actor is null then raise exception 'Unknown actor'; end if;
  if p_type not in ('personal','business','nation') then
    raise exception 'Invalid account type for direct creation: %', p_type;
  end if;

  if p_type = 'nation' then
    if p_nation_id is null then raise exception 'A nation account requires a nation_id'; end if;
    if not exists (select 1 from public.nation_owners no where no.nation_id = p_nation_id and no.user_id = p_actor)
       and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
      raise exception 'Only a nation owner can open a nation treasury account';
    end if;
  end if;

  if p_type = 'personal' and exists (select 1 from public.economy_accounts where owner_id = p_actor and type = 'personal') then
    raise exception 'You already have a personal account';
  end if;

  -- Audit fix (economy:business-wallet-no-creation-cap): cap business
  -- wallets per actor and nation wallets per nation (club-chosen cap: 5).
  if p_type = 'business' and (select count(*) from public.economy_accounts where owner_id = p_actor and type = 'business') >= 5 then
    raise exception 'Business wallet limit reached (5 per member)';
  end if;
  if p_type = 'nation' and (select count(*) from public.economy_accounts where nation_id = p_nation_id and type = 'nation') >= 5 then
    raise exception 'Nation wallet limit reached (5 per nation)';
  end if;

  insert into public.economy_accounts (owner_id, type, name, nation_id)
  values (p_actor, p_type, p_name, case when p_type = 'nation' then p_nation_id else null end)
  returning * into v_account;

  insert into public.economy_account_members (account_id, user_id, role)
  values (v_account.id, p_actor, 'owner');

  return v_account;
end;
$function$;
