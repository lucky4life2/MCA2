-- MCA security audit (run-1, 2026-11-12) — LOW stocks:company-ticker-no-server-format-check
--
-- _economy_create_company validated shares, price, and treasury ownership
-- but never the ticker format, and no CHECK constraint existed on the
-- column (UNIQUE only). Any authenticated caller via direct RPC could
-- register a confusable, malformed, or empty ticker, bypassing the
-- client-only check in stocks.page.js (/^[A-Z]{1,6}$/).
--
-- Fix: reject in _economy_create_company unless upper(p_ticker) matches
-- ^[A-Z]{1,6}$ (mirroring the client rule; lowercase input is still
-- accepted and stored uppercased, as before), plus a matching CHECK
-- constraint on the column as the backstop.
--
-- APPLY: run once against live Supabase (migration workflow). APPLY WITH
-- CARE: the constraint build fails if any existing ticker violates it.
-- Existing tickers are stored uppercased by the insert, but verify first:
--   select ticker from public.economy_companies where ticker !~ '^[A-Z]{1,6}$';
-- and fix any rows it returns before running this.
create or replace function public._economy_create_company(p_actor uuid, p_name text, p_ticker text, p_description text, p_treasury_account_id uuid, p_total_shares integer, p_initial_price numeric)
 returns economy_companies
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_company    public.economy_companies;
  v_account_id uuid;
begin
  if p_total_shares is null or p_total_shares <= 0 then
    raise exception 'Authorized shares must be positive';
  end if;
  if p_initial_price is null or p_initial_price < 0 then
    raise exception 'Initial price must be zero or positive';
  end if;

  -- Audit fix (stocks:company-ticker-no-server-format-check): the ticker
  -- format was client-only. Tickers are 1–6 uppercase letters.
  if p_ticker is null or upper(p_ticker) !~ '^[A-Z]{1,6}$' then
    raise exception 'Ticker must be 1 to 6 uppercase letters';
  end if;

  -- p_treasury_account_id is the FOUNDING wallet: an account the actor
  -- owns, used to establish they are a real participant. Deliberately NOT
  -- stored as the company treasury.
  if not exists (select 1 from public.economy_account_members m
                 where m.account_id = p_treasury_account_id and m.user_id = p_actor and m.role = 'owner')
     and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'You must own the account you are founding this company from';
  end if;

  -- The company's own account. Kept separate from the founder's wallet so
  -- offering proceeds and revenue are the company's money, not a person's.
  insert into public.economy_accounts (owner_id, type, name, balance)
  values (p_actor, 'company', p_name || ' (company account)', 0)
  returning id into v_account_id;

  insert into public.economy_account_members (account_id, user_id, role)
  values (v_account_id, p_actor, 'owner')
  on conflict (account_id, user_id) do nothing;

  insert into public.economy_companies (
    name, ticker, description, founder_id, treasury_account_id, account_id,
    total_shares, shares_issued, share_price, approval_status, status
  ) values (
    p_name, upper(p_ticker), p_description, p_actor, v_account_id, v_account_id,
    p_total_shares, 0, p_initial_price, 'pending', 'pending'
  ) returning * into v_company;

  insert into public.economy_company_members (
    company_id, user_id, role,
    can_manage_profile, can_manage_funds, can_manage_members,
    can_issue_shares, can_pay_dividends, can_publish_reports, added_by
  ) values (
    v_company.id, p_actor, 'founder', true, true, true, true, true, true, p_actor
  ) on conflict (company_id, user_id) do nothing;

  -- Deliberately NO economy_shareholdings insert. total_shares is the
  -- authorized ceiling; shares_issued stays 0 until an offering sells.

  perform public._economy_audit(
    p_actor, 'company_create', 'economy_companies', v_company.id::text,
    format('Founded %s (%s) with %s authorized shares, none issued',
           p_name, upper(p_ticker), p_total_shares),
    null
  );
  return v_company;
end;
$function$;

-- CHECK-constraint backstop (guarded so the migration is re-runnable).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'economy_companies_ticker_format_check'
  ) then
    alter table public.economy_companies
      add constraint economy_companies_ticker_format_check
      check (ticker ~ '^[A-Z]{1,6}$');
  end if;
end
$$;
