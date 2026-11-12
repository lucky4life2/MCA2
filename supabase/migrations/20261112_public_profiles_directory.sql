-- MCA security audit (run-1, 2026-11-12) — MEDIUM public_profiles/member-directory-unfiltered-roster-and-role-exposure
--
-- Live state verified 2026-11-12: public_profiles_select_members was qual
-- true for roles {anon, authenticated}, and anon held a SELECT grant, so any
-- anonymous caller could enumerate the whole synced roster including its
-- role column — role data the staff-gated user_roles policy otherwise
-- restricts. The sync trigger (fn_sync_public_profile) deleted rows only
-- for age_unverified / coppa_restricted / opted-out accounts, so frozen,
-- terminated, deactivated, and pending_deletion members stayed listed.
--
-- Fix, in three parts:
-- (a) Narrow the SELECT policy to authenticated callers only, plus an
--     active-status predicate. public_profiles carries no account_status
--     column, so the predicate is a SECURITY DEFINER helper:
--     private.public_profile_is_active. A plain EXISTS on profiles would
--     NOT work here — profiles_select_self_or_staff restricts profiles rows
--     to self-or-staff, and policy expressions see RLS-filtered rows, so an
--     ordinary member's EXISTS would come back false for everyone else and
--     hide the whole directory. The helper also re-checks the listing
--     opt-in as defence in depth (sync already enforces consent).
-- (b) REVOKE SELECT ON public.public_profiles FROM anon — the table grant is
--     separate from the policy roles, so both must change.
-- (c) Extend fn_sync_public_profile to delete rows for frozen, terminated,
--     deactivated, and pending_deletion accounts too, and one-time backfill:
--     delete directory rows whose profile is not active + opted-in (covers
--     rows the old trigger already synced, plus orphaned rows).
-- The role column stays visible to authenticated members via this table —
-- that is the intended behaviour; anonymous callers lose it with the revoke.
--
-- APPLY: run once against live Supabase (migration workflow). The backfill
-- DELETE only removes directory rows; profiles is untouched. Reversible by
-- restoring the qual-true policy and the old trigger body.
create or replace function private.public_profile_is_active(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.account_status = 'active'
      and p.public_listing_opt_in
  );
$function$;

drop policy if exists public_profiles_select_members on public.public_profiles;
create policy public_profiles_select_members on public.public_profiles
  for select to authenticated
  using ((select auth.uid()) is not null and private.public_profile_is_active(public_profiles.id));

revoke select on public.public_profiles from anon;

create or replace function public.fn_sync_public_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.account_status in ('age_unverified','coppa_restricted','frozen','terminated','deactivated','pending_deletion') or not new.public_listing_opt_in then
    delete from public.public_profiles where id = new.id;
  else
    insert into public.public_profiles (id, username, display_name, role)
    values (new.id, new.username, new.display_name, new.role)
    on conflict (id) do update
      set username     = excluded.username,
          display_name = excluded.display_name,
          role         = excluded.role;
  end if;
  return new;
end;
$function$;

-- One-time backfill for rows the old trigger already synced.
delete from public.public_profiles pp
where not exists (
  select 1 from public.profiles p
  where p.id = pp.id
    and p.account_status = 'active'
    and p.public_listing_opt_in
);
