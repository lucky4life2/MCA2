-- =====================================================================
-- MCA Economy & Stock Exchange — integration test suite
-- =====================================================================
-- Target: Supabase project "MCA website" (hjaywokvgdzhvsoygctc)
-- Scope:  the economy_* schema and the SECURITY DEFINER RPCs that gate
--         every write (_economy_buy_offering_shares, _economy_place_order,
--         _economy_cancel_order, _economy_pay_dividend,
--         _economy_treasury_issue, _economy_dissolve_company, ...)
--
-- WHY NOT pgTAP, unlike tests/congress_voting.pgtap.sql:
-- pgTAP is available on this project but NOT installed, and installing an
-- extension is a persistent schema change to production. The congress suite
-- has sat unexecuted since it was written for exactly that reason. This file
-- therefore uses plain plpgsql assertions instead, so it runs against any
-- database with zero setup — which means it actually gets run.
--
-- WHY SERVER-SIDE AT ALL:
-- Every rule worth testing here (money conservation, reservation accounting,
-- price-time priority, self-trade prevention, dividend rounding, authorization)
-- is enforced in Postgres, not in the browser. A JS test can only prove the UI
-- called the right RPC; it cannot prove the RPC is safe against someone hitting
-- PostgREST directly.
--
-- HOW TO RUN:
--   psql "<connection-string>" -f tests/economy_exchange.sql
--
-- Everything runs inside ONE transaction that ROLLS BACK at the end. It
-- creates no permanent rows and is safe to re-run. Fixtures reuse existing
-- profiles rather than inserting into auth.users, so nothing touches auth.
--
-- A pass looks like every row of the results table reading 'ok'. Any 'NOT OK'
-- row is either a real regression or schema drift — read the detail column
-- before assuming the test is wrong.
-- =====================================================================

begin;

create temporary table tap_results (
  seq     serial primary key,
  ok      boolean not null,
  name    text not null,
  detail  text
) on commit drop;

create temporary table tap_ctx (
  u_founder uuid, u_b uuid, u_c uuid, u_d uuid,
  u_outsider uuid, u_admin uuid, u_plain uuid,
  a_company uuid, a_b uuid, a_c uuid, a_d uuid,
  co_id uuid, off_id uuid
) on commit drop;

create or replace function pg_temp.check_eq(p_name text, p_got anyelement, p_want anyelement)
returns void language plpgsql as $$
begin
  insert into tap_results (ok, name, detail)
  values (p_got is not distinct from p_want, p_name,
          format('got %s, expected %s', coalesce(p_got::text, 'NULL'), coalesce(p_want::text, 'NULL')));
end;
$$;

create or replace function pg_temp.check_true(p_name text, p_got boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into tap_results (ok, name, detail) values (coalesce(p_got, false), p_name, p_detail);
end;
$$;

-- Asserts a statement is refused, and records the refusal message so a
-- passing test still shows WHY it was refused.
create or replace function pg_temp.check_refused(p_name text, p_sql text)
returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
    insert into tap_results (ok, name, detail) values (false, p_name, 'the call was ALLOWED');
  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into tap_results (ok, name, detail) values (true, p_name, 'refused: ' || v_err);
  end;
end;
$$;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
do $fixtures$
declare
  uFounder uuid; uB uuid; uC uuid; uD uuid; uOutsider uuid; uAdmin uuid; uPlain uuid;
  aCompany uuid; aB uuid; aC uuid; aD uuid; coId uuid; offId uuid;
begin
  select id into uFounder from public.profiles order by id limit 1;
  select id into uB from public.profiles where id <> uFounder order by id limit 1;
  select id into uC from public.profiles where id not in (uFounder, uB) order by id limit 1;
  select id into uD from public.profiles where id not in (uFounder, uB, uC) order by id limit 1;
  select id into uOutsider from public.profiles
    where id not in (uFounder, uB, uC, uD) order by id limit 1;

  select ur.user_id into uAdmin
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  where coalesce((r.permissions ->> 'can_manage_economy')::boolean, false) limit 1;

  select ur.user_id into uPlain
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  where coalesce((r.permissions ->> 'can_manage_treasury')::boolean, false) = false
    and coalesce((r.permissions ->> 'can_manage_economy')::boolean, false) = false
  limit 1;

  insert into public.economy_accounts (owner_id, type, name, balance)
  values (uFounder, 'company', 'TEST-CO account', 0) returning id into aCompany;
  insert into public.economy_accounts (owner_id, type, name, balance)
  values (uB, 'personal', 'TEST-B wallet', 10000) returning id into aB;
  insert into public.economy_accounts (owner_id, type, name, balance)
  values (uC, 'personal', 'TEST-C wallet', 10000) returning id into aC;
  insert into public.economy_accounts (owner_id, type, name, balance)
  values (uD, 'personal', 'TEST-D wallet', 10000) returning id into aD;

  insert into public.economy_account_members (account_id, user_id, role)
  values (aCompany, uFounder, 'owner'), (aB, uB, 'owner'), (aC, uC, 'owner'), (aD, uD, 'owner');

  insert into public.economy_companies
    (name, ticker, founder_id, treasury_account_id, account_id,
     total_shares, share_price, approval_status, status, shares_issued)
  values ('TEST-CO', 'TSTC', uFounder, aCompany, aCompany, 10000, 0, 'approved', 'private', 0)
  returning id into coId;

  insert into public.economy_company_members
    (company_id, user_id, role, can_issue_shares, can_pay_dividends, can_manage_members, can_manage_funds)
  values (coId, uFounder, 'founder', true, true, true, true);

  -- 100 shares offered at 10 Marks. No lockup, so the secondary-market tests
  -- below are testing the book rather than the lockup rule.
  insert into public.economy_offerings
    (company_id, share_count, price, risk_disclosure, status, lockup_days, created_by)
  values (coId, 100, 10, 'Test risk disclosure', 'open', 0, uFounder)
  returning id into offId;

  insert into tap_ctx values (uFounder, uB, uC, uD, uOutsider, uAdmin, uPlain,
                              aCompany, aB, aC, aD, coId, offId);
end;
$fixtures$;

-- ---------------------------------------------------------------------
-- 1. Primary offerings — the listing-payment regression
-- ---------------------------------------------------------------------
do $primary$
declare c record; v numeric; n int;
begin
  select * into c from tap_ctx;

  -- THE regression this whole change exists to prevent.
  select balance into v from public.economy_accounts where id = c.a_company;
  perform pg_temp.check_eq('listing an offering pays the company nothing', v, 0::numeric);

  select shares_issued into n from public.economy_companies where id = c.co_id;
  perform pg_temp.check_eq('listing issues no shares', n, 0);

  perform public._economy_buy_offering_shares(c.u_b, c.a_b, c.off_id, 40, null);

  select balance into v from public.economy_accounts where id = c.a_company;
  perform pg_temp.check_eq('company is paid exactly for shares actually sold', v, 400::numeric);

  select shares_issued into n from public.economy_companies where id = c.co_id;
  perform pg_temp.check_eq('only the shares bought are issued', n, 40);

  -- Same idempotency token twice must buy once.
  perform public._economy_buy_offering_shares(c.u_b, c.a_b, c.off_id, 5,
    '00000000-0000-4000-8000-000000000001'::uuid);
  perform public._economy_buy_offering_shares(c.u_b, c.a_b, c.off_id, 5,
    '00000000-0000-4000-8000-000000000001'::uuid);
  select shares_sold into n from public.economy_offerings where id = c.off_id;
  perform pg_temp.check_eq('duplicate submission never buys twice', n, 45);

  -- An offering price is not a trade and must not become "the price".
  select last_trade_price into v from public.economy_companies where id = c.co_id;
  perform pg_temp.check_true('offering purchases do not set a market price', v is null,
    'last_trade_price = ' || coalesce(v::text, 'NULL'));

  perform public._economy_close_offering(c.u_founder, c.off_id);
  select shares_issued into n from public.economy_companies where id = c.co_id;
  perform pg_temp.check_eq('unsold offering shares stay unissued', n, 45);
end;
$primary$;

-- ---------------------------------------------------------------------
-- 2. Secondary trading — order book mechanics
-- ---------------------------------------------------------------------
do $secondary$
declare
  c record; o public.economy_orders;
  v numeric; v2 numeric; n int; early uuid; late uuid; self_sell uuid; self_buy uuid;
  co_before numeric; seller_before numeric;
begin
  select * into c from tap_ctx;

  -- Give C and D shares directly so both sides of the book exist.
  insert into public.economy_shareholdings (company_id, account_id, shares)
  values (c.co_id, c.a_c, 200), (c.co_id, c.a_d, 200)
  on conflict (company_id, account_id) do update
    set shares = economy_shareholdings.shares + excluded.shares;
  update public.economy_companies set shares_issued = shares_issued + 400 where id = c.co_id;

  -- A resting order that matches nothing must not invent a price.
  o := public._economy_place_order(c.u_c, c.a_c, c.co_id, 'sell', 10, 50, null, null);
  early := o.id;
  select last_trade_price into v from public.economy_companies where id = c.co_id;
  perform pg_temp.check_true('an unmatched order never moves the price', v is null,
    'last_trade_price = ' || coalesce(v::text, 'NULL'));

  -- Second sell at the same price, later in time.
  o := public._economy_place_order(c.u_d, c.a_d, c.co_id, 'sell', 10, 50, null, null);
  late := o.id;

  select balance into co_before from public.economy_accounts where id = c.a_company;
  select balance into seller_before from public.economy_accounts where id = c.a_c;

  -- Aggressive buy at 60 against resting sells at 50.
  o := public._economy_place_order(c.u_b, c.a_b, c.co_id, 'buy', 10, 60, null, null);

  select price into v from public.economy_trades
    where company_id = c.co_id order by created_at desc limit 1;
  perform pg_temp.check_eq('execution uses the resting order price, not the aggressor limit',
    v, 50::numeric);

  select last_trade_price into v from public.economy_companies where id = c.co_id;
  perform pg_temp.check_eq('a completed trade sets last_trade_price', v, 50::numeric);

  select filled_quantity into n from public.economy_orders where id = early;
  perform pg_temp.check_eq('price-time priority fills the earlier order first', n, 10);
  select filled_quantity into n from public.economy_orders where id = late;
  perform pg_temp.check_eq('the later order at the same price stays unfilled', n, 0);

  select balance into v from public.economy_accounts where id = c.a_c;
  perform pg_temp.check_eq('the SELLER is paid on a secondary trade', v, seller_before + 500);

  select balance into v from public.economy_accounts where id = c.a_company;
  perform pg_temp.check_eq('the company is NOT paid on a secondary trade', v, co_before);

  -- Buyer reserved 10x60 but paid 10x50; the 100 difference comes straight back.
  select reserved_balance into v from public.economy_accounts where id = c.a_b;
  perform pg_temp.check_eq('excess reservation is released on a better fill', v, 0::numeric);

  -- Partial fill: 25 wanted, only the 10 resting at 50 available.
  o := public._economy_place_order(c.u_b, c.a_b, c.co_id, 'buy', 25, 50, null, null);
  perform pg_temp.check_eq('a partial fill fills what it can', o.filled_quantity, 10);
  perform pg_temp.check_eq('the unfilled remainder stays open', o.status, 'open'::text);
  select reserved_balance into v from public.economy_accounts where id = c.a_b;
  perform pg_temp.check_eq('only the unfilled remainder stays reserved', v, 750::numeric);

  -- Cancelling returns every reserved Mark and creates nothing.
  perform public._economy_cancel_order(c.u_b, o.id);
  select reserved_balance into v from public.economy_accounts where id = c.a_b;
  perform pg_temp.check_eq('cancelling releases the whole reservation', v, 0::numeric);

  -- Self-trading must produce no trade at all. C crosses its own book: a sell
  -- at 1 and a buy at 999 would match instantly if self-trades were allowed.
  o := public._economy_place_order(c.u_c, c.a_c, c.co_id, 'sell', 5, 1, null, null);
  self_sell := o.id;
  o := public._economy_place_order(c.u_c, c.a_c, c.co_id, 'buy', 5, 999, null, null);
  self_buy := o.id;
  perform pg_temp.check_eq('an account never trades with itself',
    (select count(*)::int from public.economy_trades
      where company_id = c.co_id and buyer_account_id = seller_account_id), 0);

  -- Both survive unmatched, which is the point — but leaving a 999 bid resting
  -- would make the circuit-breaker section below fire on THIS order rather
  -- than on its own fixture. Clear the book before moving on.
  perform public._economy_cancel_order(c.u_c, self_sell);
  perform public._economy_cancel_order(c.u_c, self_buy);
  perform pg_temp.check_eq('no orders rest on the book after the self-trade check',
    (select count(*)::int from public.economy_orders
      where company_id = c.co_id and status = 'open'), 0);
end;
$secondary$;

-- ---------------------------------------------------------------------
-- 3. Reservation integrity and the no-negative-balance backstop
-- ---------------------------------------------------------------------
do $reservations$
declare c record; v numeric;
begin
  select * into c from tap_ctx;
  select balance into v from public.economy_accounts where id = c.a_b;

  -- Reserved Marks are not spendable. This is also the backstop that makes a
  -- lost race safe: one SQL session cannot fork two real concurrent
  -- transactions, so the constraint that would catch a race is tested
  -- directly rather than by simulating timing.
  perform pg_temp.check_refused(
    'reserved Marks cannot be double-spent through a transfer',
    format('select public._economy_transfer(%L, %L, %L, %s, %L)',
           c.u_b, c.a_b, c.a_c, v + 1, 'overspend attempt'));

  perform pg_temp.check_refused(
    'a negative balance is impossible',
    format('update public.economy_accounts set balance = balance - 999999 where id = %L', c.a_b));

  perform pg_temp.check_refused(
    'shares cannot go negative',
    format('update public.economy_shareholdings set shares = -1 where account_id = %L', c.a_c));
end;
$reservations$;

-- ---------------------------------------------------------------------
-- 4. Authorization — never enforced in the browser alone
-- ---------------------------------------------------------------------
do $authz$
declare c record;
begin
  select * into c from tap_ctx;

  perform pg_temp.check_refused(
    'an outsider cannot touch another company''s officer tools',
    format('select public._economy_add_company_member(%L, %L, %L, %L)',
           c.u_outsider, c.co_id, c.u_outsider, 'manager'));

  perform pg_temp.check_refused(
    'a non-officer cannot propose a dividend',
    format('select public._economy_propose_dividend(%L, %L, 10, %L)',
           c.u_outsider, c.co_id, 'not mine'));

  perform pg_temp.check_refused(
    'a non-officer cannot open an offering',
    format('select public._economy_create_offering(%L, %L, 10, 5, null, null, null, 30, %L, null, null)',
           c.u_outsider, c.co_id, 'risk'));

  perform pg_temp.check_refused(
    'a user without can_manage_treasury cannot issue Marks',
    format('select public._economy_treasury_issue(%L, %L, 100, %L)',
           c.u_plain, c.a_b, 'unauthorized issuance'));

  perform pg_temp.check_refused(
    'issuing Marks without a reason is refused',
    format('select public._economy_treasury_issue(%L, %L, 100, %L)', c.u_admin, c.a_b, ''));

  perform pg_temp.check_refused(
    'a stranger cannot spend from someone else''s wallet',
    format('select public._economy_transfer(%L, %L, %L, 1, %L)',
           c.u_outsider, c.a_b, c.a_c, 'theft attempt'));
end;
$authz$;

-- ---------------------------------------------------------------------
-- 5. Dividends
-- ---------------------------------------------------------------------
do $dividends$
declare c record; divId uuid; v numeric; before_total numeric; after_total numeric;
begin
  select * into c from tap_ctx;
  select coalesce(sum(balance + reserved_balance), 0) into before_total from public.economy_accounts;

  divId := (public._economy_propose_dividend(c.u_founder, c.co_id, 100, 'test dividend')).id;
  perform public._economy_pay_dividend(c.u_founder, divId);

  select amount_paid into v from public.economy_dividends where id = divId;
  perform pg_temp.check_true('a dividend never pays out more than declared', v <= 100,
    'paid ' || v::text || ' of 100 declared');

  select remainder into v from public.economy_dividends where id = divId;
  perform pg_temp.check_true('rounding remainder stays with the company', v >= 0,
    'remainder ' || v::text);

  select coalesce(sum(balance + reserved_balance), 0) into after_total from public.economy_accounts;
  perform pg_temp.check_eq('a dividend moves Marks but never creates them', after_total, before_total);

  -- A dividend bigger than the company holds must fail cleanly, not part-pay.
  divId := (public._economy_propose_dividend(c.u_founder, c.co_id, 99999999, 'too big')).id;
  perform pg_temp.check_refused(
    'a dividend the company cannot cover is refused outright',
    format('select public._economy_pay_dividend(%L, %L)', c.u_founder, divId));
end;
$dividends$;

-- ---------------------------------------------------------------------
-- 6. Circuit breaker
-- ---------------------------------------------------------------------
do $breaker$
declare c record; o public.economy_orders; v numeric; halted boolean; reason text;
begin
  select * into c from tap_ctx;
  update public.economy_exchange_settings set circuit_breaker_pct = 10 where id;

  -- A wildly off-market crossing pair must halt rather than print.
  o := public._economy_place_order(c.u_d, c.a_d, c.co_id, 'sell', 5, 500, null, null);
  o := public._economy_place_order(c.u_b, c.a_b, c.co_id, 'buy', 5, 500, null, null);

  select trading_halted, halt_reason into halted, reason
  from public.economy_companies where id = c.co_id;
  perform pg_temp.check_true('an extreme price halts trading', halted, reason);
  perform pg_temp.check_true('the halt explains itself',
    reason is not null and btrim(reason) <> '', reason);

  select last_trade_price into v from public.economy_companies where id = c.co_id;
  perform pg_temp.check_true('a halted trade never prints its price', v < 500,
    'last_trade_price = ' || coalesce(v::text, 'NULL'));
end;
$breaker$;

-- ---------------------------------------------------------------------
-- 7. Immutability of the record
-- ---------------------------------------------------------------------
do $immutable$
begin
  perform pg_temp.check_refused(
    'a completed trade cannot be edited',
    'update public.economy_trades set price = 1 where id = (select id from public.economy_trades limit 1)');

  perform pg_temp.check_refused(
    'a completed trade cannot be deleted',
    'delete from public.economy_trades where id = (select id from public.economy_trades limit 1)');

  perform pg_temp.check_refused(
    'the currency issuance ledger is append-only',
    'update public.economy_currency_issuance set amount = 1 where id = (select id from public.economy_currency_issuance limit 1)');
end;
$immutable$;

-- ---------------------------------------------------------------------
-- 8. Dissolution
-- ---------------------------------------------------------------------
do $dissolution$
declare c record; v numeric; n int; before_total numeric; after_total numeric;
begin
  select * into c from tap_ctx;
  select coalesce(sum(balance + reserved_balance), 0) into before_total from public.economy_accounts;

  perform public._economy_dissolve_company(c.u_founder, c.co_id, 'test wind-up');

  select balance into v from public.economy_accounts where id = c.a_company;
  perform pg_temp.check_eq('dissolution empties the company account exactly', v, 0::numeric);

  select shares_issued into n from public.economy_companies where id = c.co_id;
  perform pg_temp.check_eq('dissolution cancels every share', n, 0);

  perform pg_temp.check_eq('no open orders survive dissolution',
    (select count(*)::int from public.economy_orders
      where company_id = c.co_id and status = 'open'), 0);

  select coalesce(sum(balance + reserved_balance), 0) into after_total from public.economy_accounts;
  perform pg_temp.check_eq('dissolution conserves Marks', after_total, before_total);

  perform pg_temp.check_true('the dissolved company keeps its historical record',
    exists (select 1 from public.economy_companies
            where id = c.co_id and status = 'dissolved' and dissolution_note is not null));
end;
$dissolution$;

-- ---------------------------------------------------------------------
-- 9. Treasury reconciliation
-- ---------------------------------------------------------------------
do $recon$
declare accounts_total numeric; issued_total numeric;
begin
  select coalesce(sum(balance + reserved_balance), 0) into accounts_total from public.economy_accounts;
  select coalesce(sum(amount), 0) into issued_total from public.economy_currency_issuance;

  -- This suite seeded 30000 Marks straight into accounts without issuance
  -- rows, so reconciliation MUST report a mismatch. A suite that reconciled
  -- cleanly here would prove the check cannot detect unbacked currency.
  perform pg_temp.check_true(
    'reconciliation detects Marks that were never issued',
    accounts_total <> issued_total,
    format('accounts %s vs issued %s (difference %s = the fixtures)',
           accounts_total, issued_total, accounts_total - issued_total));
end;
$recon$;

-- ---------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------
select seq,
       case when ok then 'ok' else 'NOT OK' end as result,
       name,
       detail
from tap_results
order by seq;

select count(*) filter (where ok)     as passed,
       count(*) filter (where not ok) as failed,
       count(*)                       as total
from tap_results;

rollback;
