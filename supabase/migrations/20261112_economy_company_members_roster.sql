-- MCA security audit (run-1, 2026-11-12) — MEDIUM stocks:company-members:public-company-officer-roster
--
-- economy_company_members_select OR-ed in an EXISTS disjunct for companies
-- with status IN ('public','suspended'), so any gate-passing member could
-- read every roster row — user_ids (resolvable to named members via
-- public_profiles), roles, and all six officer permission flags — of any
-- public or suspended company they were not an officer of.
--
-- Fix: drop and recreate the policy without the public-or-suspended
-- disjunct. A roster row is now visible only to the member themselves, to
-- members of that company, or to econ-admins. The RESTRICTIVE members_only
-- gate is unchanged. No explicit club policy records public-officer
-- transparency, so the disjunct is removed rather than documented.
--
-- Client half (defence in depth): stocks.page.js renderManageCompany narrows
-- its roster select from '*' to the rendered columns only.
--
-- APPLY: run once against live Supabase (migration workflow). Verify via
-- pg_policies: the policy qual must contain no reference to
-- economy_companies status 'public'/'suspended'.
drop policy if exists economy_company_members_select on public.economy_company_members;

create policy economy_company_members_select on public.economy_company_members
  for select to public
  using (
    (user_id = (select auth.uid()))
    or private.economy_is_company_member(company_id, (select auth.uid()))
    or user_has_permission('can_manage_economy')
  );
