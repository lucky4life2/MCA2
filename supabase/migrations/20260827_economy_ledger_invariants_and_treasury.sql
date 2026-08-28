-- =====================================================================
-- Economy phase 1 — ledger invariants, Treasury issuance, auth fixes
-- =====================================================================
-- Convention introduced here and used by every later phase:
--   balance          = AVAILABLE (spendable) Marks
--   reserved_balance = Marks held against open buy orders
--   total holdings   = balance + reserved_balance
-- Shares follow the identical shape (shares = available, reserved_shares
-- = held against open sell orders) so the two never drift apart in the
-- reader's head.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Available vs reserved, and the non-negativity backstops
-- ---------------------------------------------------------------------
alter table public.economy_accounts
  add column if not exists reserved_balance numeric(18,2) not null default 0;

comment on column public.economy_accounts.balance is
  'Available (spendable) Marks. Total holdings = balance + reserved_balance.';
comment on column public.economy_accounts.reserved_balance is
  'Marks held against open buy orders. Released on fill or cancel, never spent directly.';

alter table public.economy_accounts drop constraint if exists economy_accounts_balance_nonneg;
alter table public.economy_accounts add constraint economy_accounts_balance_nonneg
  check (balance >= 0);
alter table public.economy_accounts drop constraint if exists economy_accounts_reserved_nonneg;
alter table public.economy_accounts add constraint economy_accounts_reserved_nonneg
  check (reserved_balance >= 0);

alter table public.economy_shareholdings
  add column if not exists reserved_shares integer not null default 0;

comment on column public.economy_shareholdings.shares is
  'Available (sellable) shares. Total owned = shares + reserved_shares.';
comment on column public.economy_shareholdings.reserved_shares is
  'Shares held against open sell orders. Released on fill or cancel.';

alter table public.economy_shareholdings drop constraint if exists economy_shareholdings_shares_nonneg;
alter table public.economy_shareholdings add constraint economy_shareholdings_shares_nonneg
  check (shares >= 0);
alter table public.economy_shareholdings drop constraint if exists economy_shareholdings_reserved_nonneg;
alter table public.economy_shareholdings add constraint economy_shareholdings_reserved_nonneg
  check (reserved_shares >= 0);

-- ---------------------------------------------------------------------
-- 2. The Treasury issuance ledger
-- ---------------------------------------------------------------------
-- The ONLY place Marks may enter or leave circulation. Every row is a
-- deliberate act with an amount, a reason, a timestamp and an authorising
-- identity. Append-only, enforced by trigger below.
create table if not exists public.economy_currency_issuance (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.economy_accounts(id) on delete restrict,
  amount        numeric(18,2) not null,   -- positive = issued, negative = removed
  reason        text not null,
  source        text not null default 'treasury',
  authorized_by uuid,
  created_at    timestamptz not null default now(),
  constraint economy_currency_issuance_amount_nonzero check (amount <> 0),
  constraint economy_currency_issuance_reason_present check (btrim(reason) <> ''),
  constraint economy_currency_issuance_source_valid
    check (source in ('genesis','treasury','vault'))
);

comment on table public.economy_currency_issuance is
  'Append-only record of every Mark created or destroyed. sum(amount) here must always equal sum(balance + reserved_balance) across economy_accounts.';

create index if not exists economy_currency_issuance_account_idx
  on public.economy_currency_issuance (account_id, created_at desc);

create or replace function public.fn_economy_issuance_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'economy_currency_issuance is append-only; corrections must be new offsetting rows';
end;
$$;

drop trigger if exists trg_economy_issuance_immutable on public.economy_currency_issuance;
create trigger trg_economy_issuance_immutable
  before update or delete on public.economy_currency_issuance
  for each row execute function public.fn_economy_issuance_immutable();

alter table public.economy_currency_issuance enable row level security;
drop policy if exists economy_currency_issuance_select on public.economy_currency_issuance;
create policy economy_currency_issuance_select on public.economy_currency_issuance
  for select using (
    public.user_has_permission('can_manage_treasury')
    or public.user_has_permission('can_manage_economy')
    or public.user_has_permission('can_view_audit_log')
  );

-- ---------------------------------------------------------------------
-- 3. Audit helper — reuses the existing immutable audit_log
-- ---------------------------------------------------------------------
create or replace function public._economy_audit(
  p_actor uuid, p_action text, p_table text,
  p_record_id text, p_summary text, p_new jsonb default null
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_actor_type text;
begin
  -- audit_log.actor_type only accepts admin | member | system.
  if p_actor is null then
    v_actor_type := 'system';
  elsif public._economy_actor_has_permission(p_actor, 'can_view_admin') then
    v_actor_type := 'admin';
  else
    v_actor_type := 'member';
  end if;

  insert into public.audit_log
    (actor_id, actor_name, actor_type, action, table_name, record_id, summary, new_data)
  values (
    p_actor,
    (select coalesce(p.display_name, p.username, p.email) from public.profiles p where p.id = p_actor),
    v_actor_type, p_action, p_table, p_record_id, p_summary, p_new
  );
end;
$$;
revoke all on function public._economy_audit(uuid, text, text, text, text, jsonb) from public;
grant execute on function public._economy_audit(uuid, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 4. Genesis backfill — make reconciliation exact from day one
-- ---------------------------------------------------------------------
-- Balances that predate this ledger are recorded once, honestly labelled,
-- so the invariant holds without pretending these Marks were issued by an
-- admin who never actually authorised them.
insert into public.economy_currency_issuance (account_id, amount, reason, source, authorized_by)
select a.id,
       a.balance + a.reserved_balance,
       'Genesis: balance already in circulation when the Treasury ledger was introduced',
       'genesis',
       null
from public.economy_accounts a
where a.balance + a.reserved_balance <> 0
  and not exists (
    select 1 from public.economy_currency_issuance i
    where i.account_id = a.id and i.source = 'genesis'
  );

-- ---------------------------------------------------------------------
-- 5. Reconciliation
-- ---------------------------------------------------------------------
create or replace function public.economy_treasury_reconciliation()
returns table (
  total_in_accounts numeric,
  total_issued      numeric,
  discrepancy       numeric,
  is_balanced       boolean
)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_accounts numeric;
  v_issued   numeric;
begin
  if not (public.user_has_permission('can_manage_treasury')
          or public.user_has_permission('can_manage_economy')) then
    raise exception 'Not authorized to run currency reconciliation';
  end if;

  select coalesce(sum(balance + reserved_balance), 0) into v_accounts from public.economy_accounts;
  select coalesce(sum(amount), 0) into v_issued from public.economy_currency_issuance;

  return query select v_accounts, v_issued, v_accounts - v_issued, v_accounts = v_issued;
end;
$$;
revoke all on function public.economy_treasury_reconciliation() from public;
grant execute on function public.economy_treasury_reconciliation() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Deposit / withdraw now record currency creation and destruction
-- ---------------------------------------------------------------------
-- Signatures are unchanged so the Paper plugin's Vault provider keeps
-- working untouched. What changes is that Marks can no longer appear or
-- vanish without a matching Treasury ledger row.
create or replace function public._economy_deposit(
  p_actor uuid, p_account_id uuid, p_amount numeric, p_memo text default null
) returns economy_accounts
language plpgsql security definer set search_path to 'public' as $$
declare
  v_account public.economy_accounts;
  v_reason  text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  v_reason := coalesce(nullif(btrim(p_memo), ''), 'Deposit (no reason supplied)');

  select * into v_account from public.economy_accounts where id = p_account_id for update;
  if v_account is null then raise exception 'Account not found'; end if;
  if v_account.is_frozen then raise exception 'Account is frozen'; end if;

  update public.economy_accounts set balance = balance + p_amount
  where id = p_account_id returning * into v_account;

  insert into public.economy_transactions (from_account_id, to_account_id, amount, type, memo, created_by)
  values (null, p_account_id, p_amount, 'deposit', v_reason, p_actor);

  insert into public.economy_currency_issuance (account_id, amount, reason, source, authorized_by)
  values (p_account_id, p_amount, v_reason, 'vault', p_actor);

  return v_account;
end;
$$;

create or replace function public._economy_withdraw(
  p_actor uuid, p_account_id uuid, p_amount numeric, p_memo text default null
) returns economy_accounts
language plpgsql security definer set search_path to 'public' as $$
declare
  v_account public.economy_accounts;
  v_reason  text;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  v_reason := coalesce(nullif(btrim(p_memo), ''), 'Withdrawal (no reason supplied)');

  select * into v_account from public.economy_accounts where id = p_account_id for update;
  if v_account is null then raise exception 'Account not found'; end if;
  if v_account.is_frozen then raise exception 'Account is frozen'; end if;

  if not exists (select 1 from public.economy_account_members m
                 where m.account_id = p_account_id and m.user_id = p_actor)
     and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'You do not have access to this account';
  end if;

  if v_account.balance < p_amount then raise exception 'Insufficient balance'; end if;

  update public.economy_accounts set balance = balance - p_amount
  where id = p_account_id returning * into v_account;

  insert into public.economy_transactions (from_account_id, to_account_id, amount, type, memo, created_by)
  values (p_account_id, null, p_amount, 'withdrawal', v_reason, p_actor);

  insert into public.economy_currency_issuance (account_id, amount, reason, source, authorized_by)
  values (p_account_id, -p_amount, v_reason, 'vault', p_actor);

  return v_account;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Explicit Treasury actions for admins
-- ---------------------------------------------------------------------
create or replace function public._economy_treasury_issue(
  p_actor uuid, p_account_id uuid, p_amount numeric, p_reason text
) returns economy_accounts
language plpgsql security definer set search_path to 'public' as $$
declare v_account public.economy_accounts;
begin
  if not public._economy_actor_has_permission(p_actor, 'can_manage_treasury') then
    raise exception 'Only a Treasury admin can issue Marks';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to issue Marks';
  end if;

  select * into v_account from public.economy_accounts where id = p_account_id for update;
  if v_account is null then raise exception 'Account not found'; end if;

  update public.economy_accounts set balance = balance + p_amount
  where id = p_account_id returning * into v_account;

  insert into public.economy_transactions (from_account_id, to_account_id, amount, type, memo, created_by)
  values (null, p_account_id, p_amount, 'treasury_issue', btrim(p_reason), p_actor);

  insert into public.economy_currency_issuance (account_id, amount, reason, source, authorized_by)
  values (p_account_id, p_amount, btrim(p_reason), 'treasury', p_actor);

  perform public._economy_audit(
    p_actor, 'treasury_issue', 'economy_currency_issuance', p_account_id::text,
    format('Issued %s Marks to account %s', p_amount, v_account.name),
    jsonb_build_object('account_id', p_account_id, 'amount', p_amount, 'reason', btrim(p_reason))
  );

  return v_account;
end;
$$;

create or replace function public._economy_treasury_remove(
  p_actor uuid, p_account_id uuid, p_amount numeric, p_reason text
) returns economy_accounts
language plpgsql security definer set search_path to 'public' as $$
declare v_account public.economy_accounts;
begin
  if not public._economy_actor_has_permission(p_actor, 'can_manage_treasury') then
    raise exception 'Only a Treasury admin can remove Marks';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to remove Marks';
  end if;

  select * into v_account from public.economy_accounts where id = p_account_id for update;
  if v_account is null then raise exception 'Account not found'; end if;
  if v_account.balance < p_amount then
    raise exception 'Account only has % available Marks', v_account.balance;
  end if;

  update public.economy_accounts set balance = balance - p_amount
  where id = p_account_id returning * into v_account;

  insert into public.economy_transactions (from_account_id, to_account_id, amount, type, memo, created_by)
  values (p_account_id, null, p_amount, 'treasury_remove', btrim(p_reason), p_actor);

  insert into public.economy_currency_issuance (account_id, amount, reason, source, authorized_by)
  values (p_account_id, -p_amount, btrim(p_reason), 'treasury', p_actor);

  perform public._economy_audit(
    p_actor, 'treasury_remove', 'economy_currency_issuance', p_account_id::text,
    format('Removed %s Marks from account %s', p_amount, v_account.name),
    jsonb_build_object('account_id', p_account_id, 'amount', p_amount, 'reason', btrim(p_reason))
  );

  return v_account;
end;
$$;

create or replace function public.economy_treasury_issue(
  p_account_id uuid, p_amount numeric, p_reason text
) returns economy_accounts
language sql security definer set search_path to 'public' as $$
  select public._economy_treasury_issue(auth.uid(), p_account_id, p_amount, p_reason);
$$;

create or replace function public.economy_treasury_remove(
  p_account_id uuid, p_amount numeric, p_reason text
) returns economy_accounts
language sql security definer set search_path to 'public' as $$
  select public._economy_treasury_remove(auth.uid(), p_account_id, p_amount, p_reason);
$$;

revoke all on function public._economy_treasury_issue(uuid, uuid, numeric, text) from public;
revoke all on function public._economy_treasury_remove(uuid, uuid, numeric, text) from public;
grant execute on function public._economy_treasury_issue(uuid, uuid, numeric, text) to service_role;
grant execute on function public._economy_treasury_remove(uuid, uuid, numeric, text) to service_role;

revoke all on function public.economy_treasury_issue(uuid, numeric, text) from public;
revoke all on function public.economy_treasury_remove(uuid, numeric, text) from public;
grant execute on function public.economy_treasury_issue(uuid, numeric, text) to authenticated, service_role;
grant execute on function public.economy_treasury_remove(uuid, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Block self-trading
-- ---------------------------------------------------------------------
-- Live data showed 52 "purchases" totalling 61,100,800 Marks where the
-- buying account WAS the company treasury: balance went -cost then +cost
-- and the shares went out and straight back. Marks were conserved, but
-- the ledger and every volume figure derived from it were fiction.
create or replace function public._economy_buy_shares(
  p_actor uuid, p_account_id uuid, p_company_id uuid, p_shares integer
) returns economy_share_transactions
language plpgsql security definer set search_path to 'public' as $$
declare
  v_company          public.economy_companies;
  v_buyer            public.economy_accounts;
  v_cost             numeric(18,2);
  v_treasury_holding public.economy_shareholdings;
  v_tx               public.economy_share_transactions;
begin
  if p_shares is null or p_shares <= 0 then raise exception 'shares must be positive'; end if;

  if not exists (select 1 from public.economy_account_members m
                 where m.account_id = p_account_id and m.user_id = p_actor)
     and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'You do not have access to this account';
  end if;

  select * into v_company from public.economy_companies where id = p_company_id for update;
  if v_company is null then raise exception 'Company not found'; end if;
  if v_company.approval_status = 'pending' then raise exception 'This company is still awaiting admin approval'; end if;
  if v_company.approval_status = 'rejected' then raise exception 'This company was not approved and cannot be traded'; end if;
  if not v_company.is_active then raise exception 'Company is not currently listed'; end if;

  if p_account_id = v_company.treasury_account_id then
    raise exception 'A company cannot buy its own shares from itself';
  end if;

  select * into v_buyer from public.economy_accounts where id = p_account_id for update;
  if v_buyer.is_frozen then raise exception 'Account is frozen'; end if;

  select * into v_treasury_holding from public.economy_shareholdings
    where company_id = p_company_id and account_id = v_company.treasury_account_id for update;
  if v_treasury_holding is null or v_treasury_holding.shares < p_shares then
    raise exception 'Not enough shares available from the company treasury';
  end if;

  v_cost := v_company.share_price * p_shares;
  if v_buyer.balance < v_cost then
    raise exception 'Insufficient balance to buy % shares at %', p_shares, v_company.share_price;
  end if;

  update public.economy_accounts set balance = balance - v_cost where id = p_account_id;
  update public.economy_accounts set balance = balance + v_cost where id = v_company.treasury_account_id;

  update public.economy_shareholdings set shares = shares - p_shares
    where company_id = p_company_id and account_id = v_company.treasury_account_id;

  insert into public.economy_shareholdings (company_id, account_id, shares)
  values (p_company_id, p_account_id, p_shares)
  on conflict (company_id, account_id) do update set shares = economy_shareholdings.shares + excluded.shares;

  insert into public.economy_transactions (from_account_id, to_account_id, amount, type, memo, created_by)
  values (p_account_id, v_company.treasury_account_id, v_cost, 'share_purchase',
          p_shares || ' shares of ' || v_company.ticker, p_actor);

  insert into public.economy_share_transactions (company_id, account_id, shares, price_per_share, type)
  values (p_company_id, p_account_id, p_shares, v_company.share_price, 'buy')
  returning * into v_tx;

  return v_tx;
end;
$$;

create or replace function public._economy_sell_shares(
  p_actor uuid, p_account_id uuid, p_company_id uuid, p_shares integer
) returns economy_share_transactions
language plpgsql security definer set search_path to 'public' as $$
declare
  v_company   public.economy_companies;
  v_treasury  public.economy_accounts;
  v_holding   public.economy_shareholdings;
  v_proceeds  numeric(18,2);
  v_tx        public.economy_share_transactions;
begin
  if p_shares is null or p_shares <= 0 then raise exception 'shares must be positive'; end if;

  if not exists (select 1 from public.economy_account_members m
                 where m.account_id = p_account_id and m.user_id = p_actor)
     and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'You do not have access to this account';
  end if;

  select * into v_company from public.economy_companies where id = p_company_id for update;
  if v_company is null then raise exception 'Company not found'; end if;
  if v_company.approval_status != 'approved' then raise exception 'This company is not approved for trading'; end if;

  if p_account_id = v_company.treasury_account_id then
    raise exception 'A company cannot sell its own shares back to itself';
  end if;

  select * into v_holding from public.economy_shareholdings
    where company_id = p_company_id and account_id = p_account_id for update;
  if v_holding is null or v_holding.shares < p_shares then
    raise exception 'You do not own that many available shares';
  end if;

  v_proceeds := v_company.share_price * p_shares;

  select * into v_treasury from public.economy_accounts where id = v_company.treasury_account_id for update;
  if v_treasury.balance < v_proceeds then
    raise exception 'Company treasury cannot cover this buyback right now';
  end if;

  update public.economy_shareholdings set shares = shares - p_shares
    where company_id = p_company_id and account_id = p_account_id;

  insert into public.economy_shareholdings (company_id, account_id, shares)
  values (p_company_id, v_company.treasury_account_id, p_shares)
  on conflict (company_id, account_id) do update set shares = economy_shareholdings.shares + excluded.shares;

  update public.economy_accounts set balance = balance + v_proceeds where id = p_account_id;
  update public.economy_accounts set balance = balance - v_proceeds where id = v_company.treasury_account_id;

  insert into public.economy_transactions (from_account_id, to_account_id, amount, type, memo, created_by)
  values (v_company.treasury_account_id, p_account_id, v_proceeds, 'share_sale',
          p_shares || ' shares of ' || v_company.ticker, p_actor);

  insert into public.economy_share_transactions (company_id, account_id, shares, price_per_share, type)
  values (p_company_id, p_account_id, p_shares, v_company.share_price, 'sell')
  returning * into v_tx;

  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Permission key: Treasury power is separate from exchange admin
-- ---------------------------------------------------------------------
-- Seeded false everywhere so it shows up in the role editor, then granted
-- only to roles that already hold owner-level authority (can_assign_admin).
-- Deliberately NOT implied by can_manage_economy.
update public.roles
set permissions = permissions || jsonb_build_object('can_manage_treasury', false)
where not (permissions ? 'can_manage_treasury');

update public.roles
set permissions = permissions || jsonb_build_object('can_manage_treasury', true)
where coalesce((permissions ->> 'can_assign_admin')::boolean, false) = true;

-- ---------------------------------------------------------------------
-- 10. Missing grant that made multi-manager wallets impossible from the web
-- ---------------------------------------------------------------------
-- economy_set_share_price is deliberately left ungranted: displayed price
-- becomes last-traded-price-only in a later phase, so handing the web an
-- admin-set price lever now would be a step backwards.
grant execute on function public.economy_add_account_member(uuid, uuid) to authenticated;
