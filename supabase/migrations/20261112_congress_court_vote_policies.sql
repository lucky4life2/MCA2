-- MCA security audit (run-1, 2026-11-12) — MEDIUM congress-court:direct-vote-table-select:own-filter-only
--
-- The congress_votes and court_votes p_read policies each OR in an EXISTS
-- branch on roll calls with visibility = 'live' that carries no caller,
-- membership-gate, or voter condition, so any caller — including anonymous —
-- could enumerate individual votes (voter id + choice) on live roll calls
-- with a single unfiltered select. The pages themselves render only the
-- aggregate tally RPC output and select only the viewer's own choice, so
-- the live branch was the whole exposure.
--
-- Fix: drop and recreate both p_read policies without the live branch. Keep
-- the own-vote, manager, and certifier disjuncts exactly as they were.
-- The tally RPCs are untouched and remain the only aggregate path.
--
-- APPLY: run once against live Supabase (migration workflow). Reversible by
-- re-adding the EXISTS (visibility = 'live') disjunct to each qual.
drop policy if exists p_read on public.congress_votes;
create policy p_read on public.congress_votes for select to public
  using ((user_id = (select auth.uid())) or user_has_permission('can_manage_congress') or user_has_permission('can_certify_congress_votes'));

drop policy if exists p_read on public.court_votes;
create policy p_read on public.court_votes for select to public
  using ((user_id = (select auth.uid())) or user_has_permission('can_manage_court') or user_has_permission('can_certify_court_rulings'));
