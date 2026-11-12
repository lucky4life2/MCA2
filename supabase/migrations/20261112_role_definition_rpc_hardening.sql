-- Audit fix (2026-11-11): admin:role-permission-self-escalation (HIGH).
--
-- Until now a role definition was written straight from the admin page
-- (supabase.from('roles').update/insert/delete) and the live roles_write
-- policy let any caller holding can_manage_roles or can_create_roles
-- write ANY role — no level cap, no held-role exclusion, no
-- permission-key restriction. A mid-level role editor could therefore
-- add can_assign_admin (or any other permission) to a role they hold
-- and immediately become owner-equivalent, or edit/delete a role above
-- their own level. The admin page's level checks were client-side only
-- and are bypassed by a direct PostgREST call.
--
-- Fix, per the audit's remediation (the RPC route — a policy alone
-- cannot compare "permissions the caller holds"):
--   1. Three SECURITY DEFINER RPCs own every role-definition write.
--      Each enforces, against the caller's REAL roles (user_roles,
--      never a role preview):
--        * AAL2 (a session that has not cleared MFA cannot edit roles);
--        * the caller really holds the base permission
--          (can_manage_roles to edit, can_create_roles to create/delete);
--        * a level cap — the role being touched (and, for update/
--          create, the level it would be given) must sit BELOW the
--          caller's max real level, unless the caller holds
--          can_assign_admin;
--        * a held-permission cap — every permission key the new set turns
--          on must already be true in one of the caller's real roles.
--          Turning a permission off is always allowed.
--      System roles can never be deleted through the RPC, and can never
--      be renamed (update takes no name at all).
--   2. The roles_write policy is dropped. With the RPCs in place no
--      client needs a direct roles write, and SECURITY DEFINER RPCs
--      bypass RLS, so role management keeps working through them while
--      the direct PostgREST escalation path is closed (default deny).
--   3. admin.page.js calls the RPCs instead of writing roles directly.
--
-- No data change. The owner (level 100, holds can_assign_admin and
-- every permission) is unaffected. A caller at level 80 without
-- can_assign_admin can still edit roles below 80 exactly as before.
--
-- Apply to live Supabase BEFORE the new admin.page.js serves traffic:
-- the old page writes roles directly and will fail once the policy is
-- dropped, and the new page calls RPCs that do not exist until this
-- migration lands.

-- ---------------------------------------------------------------------
-- Helpers: the caller's REAL standing. Role previews are deliberately
-- ignored here — a preview must never let a caller edit roles above
-- their real level or grant a permission they do not really hold.
-- ---------------------------------------------------------------------

create or replace function public._role_caller_max_level()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(max(r.level), 0)
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid();
$function$;

create or replace function public._role_caller_really_holds(p_perm text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and (r.permissions ->> p_perm)::boolean is true
  );
$function$;

-- Internal helpers only; the three RPCs below are the website entry
-- points. A new function is unreachable until granted (see
-- supabase/migrations/README.md), so these get service_role only.
revoke all on function public._role_caller_max_level() from public;
revoke all on function public._role_caller_really_holds(text) from public;
grant execute on function public._role_caller_max_level() to service_role;
grant execute on function public._role_caller_really_holds(text) to service_role;

-- ---------------------------------------------------------------------
-- update_role_definition — edit a role's label, color, level, permissions
-- ---------------------------------------------------------------------

create or replace function public.update_role_definition(
  p_role_id uuid,
  p_label text,
  p_color text,
  p_level int,
  p_permissions jsonb
)
returns public.roles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_target public.roles;
  v_my_level int;
  v_has_assign_admin boolean;
  v_new_level int;
begin
  if not private.aal2_ok() then
    raise exception 'Permission denied: AAL2 required';
  end if;
  if auth.uid() is null then
    raise exception 'Permission denied: not signed in';
  end if;

  if not public._role_caller_really_holds('can_manage_roles') then
    raise exception 'Permission denied: can_manage_roles required';
  end if;

  select * into v_target from public.roles where id = p_role_id;
  if v_target is null then
    raise exception 'Role not found';
  end if;

  v_my_level := public._role_caller_max_level();
  v_has_assign_admin := public._role_caller_really_holds('can_assign_admin');
  v_new_level := coalesce(p_level, v_target.level);

  -- Level cap, on the role as it stands and on the level it would be
  -- given: the caller must outrank the role unless they hold
  -- can_assign_admin.
  if not (v_my_level > v_target.level or v_has_assign_admin) then
    raise exception 'Cannot edit a role at or above your level';
  end if;
  if not (v_my_level > v_new_level or v_has_assign_admin) then
    raise exception 'Cannot set a role level at or above your level';
  end if;

  -- Held-permission cap: every permission the new set turns on must
  -- already be on in one of the caller's real roles. Turning a
  -- permission off is always allowed.
  if exists (
    select 1
    from jsonb_object_keys(coalesce(p_permissions, '{}'::jsonb)) as k
    where (p_permissions ->> k)::boolean is true
      and not public._role_caller_really_holds(k)
  ) then
    raise exception 'Cannot grant a permission you do not hold';
  end if;

  update public.roles
  set label = coalesce(p_label, v_target.label),
      color = coalesce(p_color, v_target.color),
      level = v_new_level,
      permissions = coalesce(p_permissions, v_target.permissions)
  where id = p_role_id
  returning * into v_target;

  return v_target;
end;
$function$;

comment on function public.update_role_definition(uuid, text, text, int, jsonb) is
  'Audit fix admin:role-permission-self-escalation: the only supported way for the website to edit a role definition. Enforces AAL2, real can_manage_roles, a level cap on the role and its new level, and a held-permission cap on the new permission set — all against the caller''s real roles, never a preview.';

-- ---------------------------------------------------------------------
-- create_role_definition — create a new (never system) role
-- ---------------------------------------------------------------------

create or replace function public.create_role_definition(
  p_name text,
  p_label text,
  p_color text,
  p_level int,
  p_permissions jsonb
)
returns public.roles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
  v_label text;
  v_my_level int;
  v_has_assign_admin boolean;
  v_new_level int;
  v_role public.roles;
begin
  if not private.aal2_ok() then
    raise exception 'Permission denied: AAL2 required';
  end if;
  if auth.uid() is null then
    raise exception 'Permission denied: not signed in';
  end if;

  if not public._role_caller_really_holds('can_create_roles') then
    raise exception 'Permission denied: can_create_roles required';
  end if;

  -- Normalise the name the way the admin page does (lowercase, spaces
  -- to hyphens) so a direct RPC call cannot create a confusing
  -- near-duplicate of a system role.
  v_name := lower(regexp_replace(coalesce(trim(p_name), ''), '\s+', '-', 'g'));
  if v_name = '' then
    raise exception 'Role name is required';
  end if;
  if v_name !~ '^[a-z0-9][a-z0-9_-]*$' then
    raise exception 'Invalid role name';
  end if;

  v_label := nullif(trim(coalesce(p_label, '')), '');
  if v_label is null then
    raise exception 'Display label is required';
  end if;

  v_my_level := public._role_caller_max_level();
  v_has_assign_admin := public._role_caller_really_holds('can_assign_admin');
  v_new_level := coalesce(p_level, 10);

  -- Level cap on the level the role would be given.
  if not (v_my_level > v_new_level or v_has_assign_admin) then
    raise exception 'Cannot create a role at or above your level';
  end if;

  -- Held-permission cap, as in update_role_definition.
  if exists (
    select 1
    from jsonb_object_keys(coalesce(p_permissions, '{}'::jsonb)) as k
    where (p_permissions ->> k)::boolean is true
      and not public._role_caller_really_holds(k)
  ) then
    raise exception 'Cannot grant a permission you do not hold';
  end if;

  insert into public.roles (name, label, color, level, is_system, permissions)
  values (
    v_name,
    v_label,
    coalesce(p_color, '#888888'),
    v_new_level,
    false,
    coalesce(p_permissions, '{}'::jsonb)
  )
  returning * into v_role;

  return v_role;
end;
$function$;

comment on function public.create_role_definition(text, text, text, int, jsonb) is
  'Audit fix admin:role-permission-self-escalation: the only supported way for the website to create a role. Enforces AAL2, real can_create_roles, a level cap on the new level, and a held-permission cap — all against the caller''s real roles, never a preview.';

-- ---------------------------------------------------------------------
-- delete_role_definition — delete a role (never a system role)
-- ---------------------------------------------------------------------

create or replace function public.delete_role_definition(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_target public.roles;
  v_my_level int;
  v_has_assign_admin boolean;
begin
  if not private.aal2_ok() then
    raise exception 'Permission denied: AAL2 required';
  end if;
  if auth.uid() is null then
    raise exception 'Permission denied: not signed in';
  end if;

  -- The admin page only shows delete to can_create_roles holders.
  if not public._role_caller_really_holds('can_create_roles') then
    raise exception 'Permission denied: can_create_roles required';
  end if;

  select * into v_target from public.roles where id = p_role_id;
  if v_target is null then
    raise exception 'Role not found';
  end if;

  -- System roles are never deleted. (The admin page hides the delete
  -- button for them; this is the server-side backstop.)
  if v_target.is_system then
    raise exception 'System roles cannot be deleted';
  end if;

  v_my_level := public._role_caller_max_level();
  v_has_assign_admin := public._role_caller_really_holds('can_assign_admin');

  -- Level cap: the caller must outrank the role unless they hold
  -- can_assign_admin. user_roles.role_id is ON DELETE CASCADE, so
  -- deleting a role strips it from every holder.
  if not (v_my_level > v_target.level or v_has_assign_admin) then
    raise exception 'Cannot delete a role at or above your level';
  end if;

  delete from public.roles where id = p_role_id;
end;
$function$;

comment on function public.delete_role_definition(uuid) is
  'Audit fix admin:role-permission-self-escalation: the only supported way for the website to delete a role. Enforces AAL2, real can_create_roles, a level cap, and refuses system roles — all against the caller''s real roles, never a preview.';

-- Website entry points. (No grant on the _role_caller_* helpers: they
-- are internal, and SECURITY DEFINER RPCs run as the owner.)
revoke all on function public.update_role_definition(uuid, text, text, int, jsonb) from public;
revoke all on function public.create_role_definition(text, text, text, int, jsonb) from public;
revoke all on function public.delete_role_definition(uuid) from public;
grant execute on function public.update_role_definition(uuid, text, text, int, jsonb) to authenticated;
grant execute on function public.create_role_definition(text, text, text, int, jsonb) to authenticated;
grant execute on function public.delete_role_definition(uuid) to authenticated;

-- Close the direct path. With the RPCs in place no client needs a
-- direct roles write, and SECURITY DEFINER RPCs bypass RLS, so role
-- management keeps working through them while the direct PostgREST
-- escalation path is denied (default deny). roles_read is untouched.
drop policy if exists roles_write on public.roles;
