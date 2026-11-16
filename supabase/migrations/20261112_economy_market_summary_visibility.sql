-- MCA security audit (run-1, 2026-11-12) — LOW stocks:market-summary:pending-company-aggregates
--
-- economy_market_summary is SECURITY DEFINER and filtered only by company
-- id, so it bypassed the approval-gated economy_companies policy entirely:
-- any authenticated caller — even a gate-failing one — could invoke it with
-- a pending company's id (UUIDs are discoverable via the permissive
-- offerings/dividends quals) and read prices, best bid/ask, volume, shares
-- outstanding and market cap for a company they could not see.
--
-- Fix: full replacement of the function (no repo definition exists on main;
-- this body is the live body verbatim plus the visibility predicate). A row
-- is returned only when the company satisfies the economy_companies_select
-- rule — approval_status = 'approved' OR founder OR treasury-account
-- member OR can_manage_economy — AND the caller passes
-- user_meets_membership_gate(). Otherwise no row is returned. The gate
-- must be inside the function: SECURITY DEFINER bypasses RLS, so no policy
-- can enforce it.
--
-- APPLY: run once against live Supabase (migration workflow). Callers who
-- could already see the company (the UI renders it only for RLS-visible
-- companies) are unaffected; direct-RPC callers for pending companies get
-- an empty result instead of aggregates.
create or replace function public.economy_market_summary(p_company_id uuid)
 returns table(last_price numeric, last_trade_at timestamp with time zone, best_bid numeric, best_ask numeric, volume_today bigint, shares_outstanding integer, market_cap numeric)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select
    c.last_trade_price,
    c.last_trade_at,
    (select max(o.limit_price) from public.economy_orders o
      where o.company_id = c.id and o.side='buy' and o.status='open'
        and (o.expires_at is null or o.expires_at > now())),
    (select min(o.limit_price) from public.economy_orders o
      where o.company_id = c.id and o.side='sell' and o.status='open'
        and (o.expires_at is null or o.expires_at > now())),
    coalesce((select d.volume from public.economy_daily_ohlc d
              where d.company_id = c.id and d.trade_date = current_date), 0)::bigint,
    c.shares_issued,
    -- Explicitly last price x outstanding. Null before any trade, never faked.
    case when c.last_trade_price is null then null
         else c.last_trade_price * c.shares_issued end
  from public.economy_companies c
  where c.id = p_company_id
    -- Audit fix (stocks:market-summary:pending-company-aggregates): mirror
    -- the economy_companies_select rule, plus the membership gate. A pending
    -- company the caller cannot see returns no row at all.
    and (
      c.approval_status = 'approved'
      or c.founder_id = auth.uid()
      or private.economy_is_account_member(c.treasury_account_id, auth.uid())
      or public.user_has_permission('can_manage_economy')
    )
    and public.user_meets_membership_gate();
$function$;
