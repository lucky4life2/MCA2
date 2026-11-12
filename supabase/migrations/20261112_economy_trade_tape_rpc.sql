-- MCA security audit (run-1, 2026-11-12) — MEDIUM stocks:trades:counterparty-account-exposure
--
-- economy_trades_select was qual true plus the membership gate only, so any
-- gate-passing member could SELECT * and read buyer_account_id,
-- seller_account_id, buy_order_id and sell_order_id for trades they were
-- not party to — wallet-level trading history across companies and time.
-- RLS is row-level and cannot hide columns, and the UI's narrow column list
-- in loadRecentTrades was never a control (any caller substitutes '*').
--
-- Fix: the raw table is no longer directly readable by client roles.
-- economy_trade_tape is a SECURITY DEFINER reader returning only
-- company_id, quantity, price, total, created_at — the columns the UI
-- renders — and it enforces the membership gate itself, because SECURITY
-- DEFINER bypasses RLS. Direct client SELECT on economy_trades is revoked
-- from anon and authenticated; the economy_trades_select policy is left in
-- place as defence in depth (it now only binds roles that still hold a
-- grant, e.g. service_role/postgres paths).
--
-- Client half: economy.js loadRecentTrades now calls the RPC (only
-- legitimate reader in the repo — grep-verified; tests/economy_exchange.sql
-- reads the table only as the database owner in test scaffolding, which is
-- unaffected by a client-role revoke).
--
-- APPLY: run once against live Supabase (migration workflow). Apply only
-- AFTER deploying the economy.js change, or the recent-trades panel errors
-- until the new client ships. The revoke is the enforcement; verify with
-- role_table_grants (zero SELECT rows for anon/authenticated on the table).
create or replace function public.economy_trade_tape(p_company_id uuid)
 returns table(company_id uuid, quantity integer, price numeric, total numeric, created_at timestamptz)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  -- The membership gate is enforced here, not by RLS: SECURITY DEFINER
  -- bypasses RLS, so a gate check inside the function is the only control.
  select t.company_id, t.quantity, t.price, t.total, t.created_at
  from public.economy_trades t
  where t.company_id = p_company_id
    and public.user_meets_membership_gate()
  order by t.created_at desc;
$function$;

revoke all on function public.economy_trade_tape(uuid) from public;
grant execute on function public.economy_trade_tape(uuid) to authenticated, service_role;

-- Direct client reads of the raw tape end here. Server-side code (SECURITY
-- DEFINER functions, service_role edge functions) is unaffected: the revoke
-- targets only the client roles.
revoke select on public.economy_trades from anon, authenticated;
