-- Club management RPCs — permission checks (supabase/migrations/20260925_club_management.sql)
--
-- HOW TO RUN: psql "<connection-string>" -f tests/club_management.sql
-- (or paste into the SQL editor / execute_sql).
--
-- One DO block that ALWAYS ends by raising its report, so every fixture row
-- rolls back even on a clean pass. Read the error text:
--   "CLUB TESTS PASSED: n checks"  or  "CLUB TESTS FAILED: ..." with the failures.
-- Users are simulated by setting request.jwt.claims, which is what auth.uid()
-- and private.aal2_ok() read. Fixtures reuse existing active profiles.
do $$
declare
  u_pres uuid; u_member uuid; u_other uuid; u_admin uuid;
  c_club uuid; c_other uuid;
  fails text[] := '{}'; n int := 0;
begin
  -- Fixtures: three plain active users with no config permission, no preview, no club.
  select id into u_pres from public.profiles p where account_status = 'active' and username is not null
    and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                    where ur.user_id = p.id and (r.permissions->>'can_manage_config')::boolean)
    and not exists (select 1 from public.role_previews rp where rp.user_id = p.id)
    and not exists (select 1 from public.club_presidents c where c.president_user_id = p.id)
    and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id)
    order by id limit 1;
  select id into u_member from public.profiles p where account_status = 'active' and id <> u_pres
    and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                    where ur.user_id = p.id and (r.permissions->>'can_manage_config')::boolean)
    and not exists (select 1 from public.club_presidents c where c.president_user_id = p.id)
    order by id limit 1;
  select id into u_other from public.profiles p where account_status = 'active' and id not in (u_pres, u_member)
    and not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                    where ur.user_id = p.id and (r.permissions->>'can_manage_config')::boolean)
    and not exists (select 1 from public.role_previews rp where rp.user_id = p.id)
    and not exists (select 1 from public.club_presidents c where c.president_user_id = p.id)
    order by id limit 1;
  select ur.user_id into u_admin from public.user_roles ur join public.roles r on r.id = ur.role_id
   where (r.permissions->>'can_manage_config')::boolean
     and not exists (select 1 from public.role_previews rp where rp.user_id = ur.user_id)
   limit 1;
  if u_pres is null or u_member is null or u_other is null or u_admin is null then
    raise exception 'CLUB TESTS SETUP: not enough fixture users';
  end if;

  delete from public.club_members where user_id in (u_member, u_other);

  -- Club linked by username (trigger), plus a second club nobody here runs.
  insert into public.club_presidents (name, club_name, username)
    select 'Test President', 'Test Club', '@' || username from public.profiles where id = u_pres
    returning id into c_club;
  insert into public.club_presidents (name, club_name) values ('Other', 'Other Club') returning id into c_other;

  n := n + 1;
  if (select president_user_id from public.club_presidents where id = c_club) is distinct from u_pres then
    fails := fails || 'username (with @) links president_user_id'::text;
  end if;

  -- Member requests to join.
  perform set_config('request.jwt.claims', json_build_object('sub', u_member, 'role', 'authenticated')::text, true);
  perform public.club_request_join(c_club);
  n := n + 1;
  if (select status from public.club_members where user_id = u_member) is distinct from 'pending' then
    fails := fails || 'join request is pending'::text;
  end if;

  -- Member can't list or approve (including themselves).
  n := n + 1;
  begin perform public.club_list_members(c_club); fails := fails || 'member listed club members'::text;
  exception when raise_exception then null; end;
  n := n + 1;
  begin perform public.club_review_member(u_member, true); fails := fails || 'member approved themselves'::text;
  exception when raise_exception then null; end;

  -- An outsider can't touch the club.
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  n := n + 1;
  begin perform public.club_review_member(u_member, true); fails := fails || 'outsider approved a member'::text;
  exception when raise_exception then null; end;
  n := n + 1;
  begin perform public.club_update_profile(c_club, 'Hacked', null, null, null); fails := fails || 'outsider edited club'::text;
  exception when raise_exception then null; end;

  -- President lists, approves, edits own club — but not the other club.
  perform set_config('request.jwt.claims', json_build_object('sub', u_pres, 'role', 'authenticated')::text, true);
  n := n + 1;
  if (select count(*) from public.club_list_members(c_club)) <> 1 then fails := fails || 'president sees 1 pending member'::text; end if;
  perform public.club_review_member(u_member, true);
  n := n + 1;
  if (select status from public.club_members where user_id = u_member) is distinct from 'approved' then
    fails := fails || 'president approves member'::text;
  end if;
  perform public.club_update_profile(c_club, 'Renamed Club', 'Utah', 'About us', 'Tuesdays');
  n := n + 1;
  if (select club_name || '|' || meeting_info from public.club_presidents where id = c_club) is distinct from 'Renamed Club|Tuesdays' then
    fails := fails || 'president edits own club profile'::text;
  end if;
  n := n + 1;
  begin perform public.club_update_profile(c_other, 'Hacked', null, null, null); fails := fails || 'president edited another club'::text;
  exception when raise_exception then null; end;
  n := n + 1;
  begin perform public.club_list_members(c_other); fails := fails || 'president listed another club'::text;
  exception when raise_exception then null; end;

  -- Approved member can't hop clubs without leaving; leaving works.
  perform set_config('request.jwt.claims', json_build_object('sub', u_member, 'role', 'authenticated')::text, true);
  n := n + 1;
  begin perform public.club_request_join(c_other); fails := fails || 'approved member switched clubs without leaving'::text;
  exception when raise_exception then null; end;

  -- President removes the member.
  perform set_config('request.jwt.claims', json_build_object('sub', u_pres, 'role', 'authenticated')::text, true);
  perform public.club_review_member(u_member, false);
  n := n + 1;
  if exists (select 1 from public.club_members where user_id = u_member) then fails := fails || 'president removes member'::text; end if;

  -- Admin (can_manage_config) can manage any club.
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  n := n + 1;
  begin perform public.club_list_members(c_other);
  exception when raise_exception then fails := fails || ('admin list other club: ' || sqlerrm); end;

  -- Grants: anon can't call the RPCs or read the table; nobody inserts directly.
  n := n + 1;
  if has_function_privilege('anon', 'public.club_request_join(uuid)', 'execute')
     or has_table_privilege('anon', 'public.club_members', 'select')
     or has_table_privilege('authenticated', 'public.club_members', 'insert') then
    fails := fails || 'grants: anon/insert access is closed'::text;
  end if;

  if cardinality(fails) = 0 then
    raise exception 'CLUB TESTS PASSED: % checks', n;
  end if;
  raise exception 'CLUB TESTS FAILED: % of % — %', cardinality(fails), n, array_to_string(fails, '; ');
end $$;
