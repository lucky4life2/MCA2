-- MCA security audit (run-1, 2026-11-12) — LOW economy:economy_transfer:no-client-token
--
-- economy_transfer had no token parameter, lookup, or dedupe step, and
-- economy_transactions had no token column or unique index. A sender whose
-- transfer response was lost (ambiguous failure) and who retried got two
-- distinct transfer rows and two movements of Marks. The sibling paths
-- (orders, offering purchases) already dedupe on a client token backed by
-- a partial unique index; transfers now mirror that pattern.
--
-- Fix: add economy_transactions.client_token (uuid, nullable), a partial
-- unique index on it, and p_client_token to _economy_transfer with a
-- token-first lookup returning the existing row before inserting.
--
-- Signature change: adding a parameter means CREATE OR REPLACE would
-- create an overload and leave the old token-less functions callable, so
-- the old signatures are dropped first (wrapper first — it depends on the
-- implementation — then the implementation), then both are recreated with
-- the new signature. Calls that omit p_client_token keep working (it
-- defaults to NULL); only callers that pass a token get dedupe.
--
-- This redefinition also preserves the destination-closed check from
-- 20261112_economy_transfer_dest_closed.sql (which sorts before this file
-- and would otherwise be reverted by the redefinition).
--
-- Client half: economy.page.js sendMarks mints one token per user intent
-- and passes it as p_client_token.
--
-- APPLY: run once against live Supabase (migration workflow). APPLY WITH
-- CARE: if economy_transactions already holds two rows with the same
-- non-null client_token (impossible before this migration — the column is
-- new — so the index build cannot fail on duplicates).
alter table public.economy_transactions add column if not exists client_token uuid;

create unique index if not exists economy_transactions_token_key
  on public.economy_transactions (client_token) where client_token is not null;

-- Drop the old token-less signatures first (see header: CREATE OR REPLACE
-- cannot change a function's argument list, it would overload instead).
drop function if exists public.economy_transfer(uuid, uuid, numeric, text);
drop function if exists public._economy_transfer(uuid, uuid, uuid, numeric, text);

create or replace function public._economy_transfer(p_actor uuid, p_from uuid, p_to uuid, p_amount numeric, p_memo text default null::text, p_client_token uuid default null::uuid)
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
  -- Idempotency: a resubmitted transfer with the same token returns the
  -- original row. Mirrors _economy_place_order / _economy_buy_offering_shares.
  if p_client_token is not null then
    select * into v_tx from public.economy_transactions where client_token = p_client_token;
    if found then return v_tx; end if;
  end if;

  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  select * into v_from from public.economy_accounts where id = p_from for update;
  if v_from is null then raise exception 'Source account not found'; end if;
  if v_from.is_frozen then raise exception 'Source account is frozen'; end if;

  if not exists (select 1 from public.economy_account_members m where m.account_id = p_from and m.user_id = p_actor)
     and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'You do not have access to this account';
  end if;

  if v_from.balance < p_amount then raise exception 'Insufficient balance'; end if;

  -- Preserved from 20261112_economy_transfer_dest_closed.sql: reject a
  -- closed or frozen destination before any balance movement.
  select * into v_dest from public.economy_accounts where id = p_to for update;
  if v_dest is null then
    raise exception 'Destination account not found';
  end if;
  if v_dest.closed_at is not null or v_dest.is_frozen then
    raise exception 'Destination account is closed';
  end if;

  update public.economy_accounts set balance = balance - p_amount where id = p_from;
  update public.economy_accounts set balance = balance + p_amount where id = p_to;

  insert into public.economy_transactions (from_account_id, to_account_id, amount, type, memo, created_by, client_token)
  values (p_from, p_to, p_amount, 'transfer', p_memo, p_actor, p_client_token)
  returning * into v_tx;

  return v_tx;
end;
$function$;

create or replace function public.economy_transfer(p_from uuid, p_to uuid, p_amount numeric, p_memo text default null::text, p_client_token uuid default null::uuid)
 returns economy_transactions
 language sql
 security definer
 set search_path to 'public'
as $function$ select public._economy_transfer(auth.uid(), p_from, p_to, p_amount, p_memo, p_client_token); $function$;
