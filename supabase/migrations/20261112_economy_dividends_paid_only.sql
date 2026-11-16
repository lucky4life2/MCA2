-- MCA security audit (run-1, 2026-11-12) — MEDIUM stocks:dividends:unfiltered-status-direct-select
--
-- economy_dividends_select was qual true (plus only the RESTRICTIVE
-- members_only gate), so any gate-passing member could drop the client's
-- status='paid' filter and read proposed dividends (pending payout amount,
-- officer note, proposer) and cancelled dividends (retained amount, note).
-- Contrast: per-recipient economy_dividend_payments already carries a
-- scoped SELECT policy.
--
-- Fix: the policy qual is now (status = 'paid' OR can_manage_economy).
-- Proposed/cancelled rows are visible only to econ-admins. No officer
-- clause is added: no repo UI lists proposed dividends to officers, and
-- the audit's remediation adds one only if officers later gain such a
-- list. The client keeps its status='paid' filter as defence in depth.
-- The RESTRICTIVE members_only gate is unchanged.
--
-- APPLY: run once against live Supabase (migration workflow). Verify via
-- pg_policies: economy_dividends_select qual must be
-- (status = 'paid' OR user_has_permission('can_manage_economy')).
drop policy if exists economy_dividends_select on public.economy_dividends;

create policy economy_dividends_select on public.economy_dividends
  for select to public
  using ((status = 'paid') or user_has_permission('can_manage_economy'));
