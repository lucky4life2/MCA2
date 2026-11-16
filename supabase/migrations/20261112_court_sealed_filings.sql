-- MCA security audit (run-1, 2026-11-12) — MEDIUM court.page.js@sealed-filing-render
--
-- court_filings.p_read routed only through private.court_can_see_case on the
-- parent case and never branched on is_sealed, so sealing was label-only: any
-- caller who could see the case (including anonymous callers for public
-- cases) could read the full body of a sealed filing.
--
-- Fix: add an is_sealed branch. A sealed filing's body is readable only by
-- a case party, an active justice for the case, or a court manager. The two
-- helpers are used verbatim here and already exist live (verified 2026-11-12
-- via pg_proc): private.court_is_case_party(uuid) and
-- private.court_is_active_justice_for_case(uuid), both SECURITY DEFINER —
-- the court_filings p_insert policy already calls them the same way.
-- Unsealed filings keep the old case-visibility rule exactly.
--
-- The client render in court.page.js additionally shows only a placeholder
-- body for sealed filings to other readers, as defence in depth.
--
-- APPLY: run once against live Supabase (migration workflow). Reversible by
-- restoring p_read to the bare EXISTS (court_can_see_case) qual.
drop policy if exists p_read on public.court_filings;
create policy p_read on public.court_filings for select to public
  using (
    exists (select 1 from public.court_cases c where c.id = court_filings.case_id and private.court_can_see_case(c.*))
    and (not court_filings.is_sealed or private.court_is_case_party(court_filings.case_id) or private.court_is_active_justice_for_case(court_filings.case_id) or user_has_permission('can_manage_court'))
  );
