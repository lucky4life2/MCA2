-- MCA security audit (run-1, 2026-11-12) — MEDIUM economy:economy_transfer:to-closed-account
--
-- _economy_transfer checked the source wallet thoroughly (row lock,
-- is_frozen, membership, balance) but the destination only by existence.
-- Marks sent to a closed wallet (closed_at set, is_frozen true) sit frozen
-- on an account with no reopen path — only treasury_remove can touch them,
-- and it destroys rather than returns them. Sibling paths
-- (_economy_place_order, _economy_buy_offering_shares) already reject
-- closed/frozen buyer wallets; this brings transfers in line.
--
-- Fix: reject a destination with closed_at IS NOT NULL or is_frozen before
-- any balance movement. The destination row is locked (FOR UPDATE) so the
-- check cannot race a close landing between check and update.
--
-- APPLY: run once against live Supabase (migration workflow). Reversible by
-- re-applying the previous _economy_transfer body.
create or replace function public._economy_transfer(p_actor uuid, p_from uuid, p_to uuid, p_amount numeric, p_memo text default null::text)
 returns economy_transactions
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_from public.economy_accounts;
  v_dest public.economy_accounts;
  v_tx public.economy_transactions;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  select * into v_from from public.economy_accounts where id = p_from for update;
  if v_from is null then raise exception 'Source account not found'; end if;
  if v_from.is_frozen then raise exception 'Source account is frozen'; end if;

  if not exists (select 1 from public.economy_account_members m where m.account_id = p_from and m.user_id = p_actor)
     and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'You do not have access to this account';
  end if;

  if v_from.balance < p_amount then raise exception 'Insufficient balance'; end if;

  -- Audit fix (economy:economy_transfer:to-closed-account): the destination
  -- used to be checked only by existence. A closed wallet is frozen and has
  -- no reopen path, so Marks sent there are stranded.
  select * into v_dest from public.economy_accounts where id = p_to for update;
  if v_dest is null then
    raise exception 'Destination account not found';
  end if;
  if v_dest.closed_at is not null or v_dest.is_frozen then
    raise exception 'Destination account is closed';
  end if;

  update public.economy_accounts set balance = balance - p_amount where id = p_from;
  update public.economy_accounts set balance = balance + p_amount where id = p_to;

  insert into public.economy_transactions (from_account_id, to_account_id, amount, type, memo, created_by)
  values (p_from, p_to, p_amount, 'transfer', p_memo, p_actor)
  returning * into v_tx;

  return v_tx;
end;
$function$;
