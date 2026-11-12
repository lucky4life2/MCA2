-- MCA security audit (run-1, 2026-11-12) — MEDIUM congress:calendar-events:measure-linked-reads
-- and MEDIUM court.page.js:dashboard-calendar-events-parties-only-visibility
--
-- congress_calendar_events.p_read and court_calendar_events.p_read were both
-- just (auth.uid() IS NOT NULL): any signed-in caller could read every
-- calendar event, including ones linked to a measure (or a parties_only
-- case) they cannot see — leaking the event's existence, title, description,
-- timing, location, and its measure_id / case_id. The linked measure and
-- case tables already gate visibility through
-- private.congress_can_see_measure and private.court_can_see_case; the
-- calendar policies never called them.
--
-- Fix: replace each p_read with a linked-aware qual. Unlinked events stay
-- readable by any signed-in caller (the intended behaviour); a linked event
-- is readable only by callers who can see the linked measure / case. Do NOT
-- add a RESTRICTIVE members_only SELECT policy instead — that would change
-- the intended any-signed-in readability of unlinked events.
--
-- The client reads in congress.page.js / court.page.js were also narrowed
-- from select('*') to the rendered columns as defence in depth.
--
-- APPLY: run once against live Supabase (migration workflow). Reversible by
-- restoring each p_read to ((select auth.uid()) is not null).
drop policy if exists p_read_auth on public.congress_calendar_events;
create policy p_read_auth on public.congress_calendar_events for select to public
  using (
    (measure_id is null and (select auth.uid()) is not null)
    or (measure_id is not null and exists (select 1 from public.congress_measures m where m.id = congress_calendar_events.measure_id and private.congress_can_see_measure(m.*)))
  );

drop policy if exists p_read_auth on public.court_calendar_events;
create policy p_read_auth on public.court_calendar_events for select to public
  using (
    (case_id is null and (select auth.uid()) is not null)
    or (case_id is not null and exists (select 1 from public.court_cases c where c.id = court_calendar_events.case_id and private.court_can_see_case(c.*)))
  );
