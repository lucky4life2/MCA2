-- Audit fix (2026-11-12): auth:role-preview:no-expiry-retention (MEDIUM).
--
-- Until now start_role_preview set expires_at = now() + interval
-- '100 years', contradicting the client comment ('Lasts 30 minutes')
-- and the nav.js note that the preview row 'has no expiry now'. A
-- preview therefore survived sign-out, tab crashes, and session
-- expiry, and user_has_permission / get_user_roles substituted the
-- preview role's permissions with no recheck of the caller's current
-- standing — so a permissions-only downgrade of the caller's real
-- roles did not clear a preview they had started while authorised.
--
-- Fix, per the audit's remediation (server-side first; the client
-- signOut change is a separate fix):
--   1. start_role_preview now sets expires_at = now() + interval
--      '30 minutes', matching the documented bound, on both the
--      insert and the ON CONFLICT update. It also sweeps expired
--      preview rows for the caller, so stale rows do not accumulate.
--   2. user_has_permission and get_user_roles revalidate a preview
--      row before substituting it: the caller must CURRENTLY hold
--      can_manage_roles (read from their real user_roles, never from
--      the preview itself) and the preview role's level must still
--      sit strictly below the caller's CURRENT max real level. A
--      preview that fails either check is ignored and the caller's
--      real roles are used instead. The stale row is left in place —
--      it expires within 30 minutes and is swept on the next preview
--      start; deleting it from inside user_has_permission (which runs
--      inside RLS policy evaluation) would be a side effect in a read
--      path.
--   3. Nothing else in either function changes: the creation gates in
--      start_role_preview, the AAL2 gate in user_has_permission, and
--      the can_manage_users gate in get_user_roles are carried over
--      unchanged from the live definitions (verified from
--      pg_get_functiondef).
--
-- No data change, except that previews older than 30 minutes stop
-- applying the moment this lands (they were already past the
-- documented bound). Apply to live Supabase whenever; no client
-- change is required for the server-side fix to take effect.

-- ---------------------------------------------------------------------
-- 1. start_role_preview: 30-minute expiry.
-- ---------------------------------------------------------------------

create or replace function public.start_role_preview(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_my_level     int;
  v_can_manage   boolean;
  v_target_level int;
begin
  select coalesce(max(r.level), 0) into v_my_level
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid();

  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and (r.permissions ->> 'can_manage_roles')::boolean = true
  ) into v_can_manage;

  if not v_can_manage then
    raise exception 'not authorized to preview roles';
  end if;

  select level into v_target_level from public.roles where id = p_role_id;
  if v_target_level is null then
    raise exception 'role not found';
  end if;

  if v_target_level >= v_my_level then
    raise exception 'can only preview a role below your own level';
  end if;

  -- Expired previews are dead weight: sweep the caller's so a stale
  -- row cannot be mistaken for a live one by any reader that forgets
  -- the expires_at check.
  delete from public.role_previews
  where user_id = auth.uid() and expires_at <= now();

  -- Audit fix auth:role-preview:no-expiry-retention: the documented
  -- bound is 30 minutes, not 100 years.
  insert into public.role_previews (user_id, preview_role_id, started_at, expires_at)
  values (auth.uid(), p_role_id, now(), now() + interval '30 minutes')
  on conflict (user_id) do update
    set preview_role_id = excluded.preview_role_id,
        started_at = now(),
        expires_at = now() + interval '30 minutes';
end;
$function$;

comment on function public.start_role_preview(uuid) is
  'Audit fix auth:role-preview:no-expiry-retention: role previews expire after 30 minutes (the documented bound), not 100 years.';

-- ---------------------------------------------------------------------
-- 2. user_has_permission: revalidate the preview before substituting.
-- ---------------------------------------------------------------------

create or replace function public.user_has_permission(perm text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_preview_role_id uuid;
  v_result boolean;
  v_my_level int;
  v_can_manage boolean;
  v_target_level int;
begin
  if not private.aal2_ok() then
    return false;
  end if;

  select preview_role_id into v_preview_role_id
  from public.role_previews
  where user_id = auth.uid() and expires_at > now();

  if v_preview_role_id is not null then
    -- Audit fix auth:role-preview:no-expiry-retention: a preview only
    -- applies while the caller CURRENTLY holds can_manage_roles and
    -- the preview role still sits below their CURRENT max real level.
    -- Both are read from the caller's real user_roles, never from the
    -- preview itself, so a downgrade of the real roles clears the
    -- preview even though the row is still unexpired. A preview that
    -- fails either check is ignored and the real roles below decide.
    select coalesce(max(r.level), 0) into v_my_level
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid();

    select exists (
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid()
        and (r.permissions ->> 'can_manage_roles')::boolean = true
    ) into v_can_manage;

    select level into v_target_level from public.roles where id = v_preview_role_id;

    if v_can_manage and v_target_level is not null and v_target_level < v_my_level then
      select coalesce((r.permissions ->> perm)::boolean, false) into v_result
      from public.roles r where r.id = v_preview_role_id;
      return v_result;
    end if;
    -- Preview no longer valid: fall through to the real roles.
  end if;

  return exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and (r.permissions ->> perm)::boolean = true
  );
end;
$function$;

comment on function public.user_has_permission(text) is
  'Audit fix auth:role-preview:no-expiry-retention: a role preview is substituted only while the caller currently holds can_manage_roles and the preview role is still below their current max real level.';

-- ---------------------------------------------------------------------
-- 3. get_user_roles: same revalidation before substituting.
-- ---------------------------------------------------------------------

create or replace function public.get_user_roles(p_user_id uuid)
returns table(role_id uuid, name text, label text, color text, level integer, is_system boolean, permissions jsonb, granted_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_preview_role_id uuid;
  v_my_level int;
  v_can_manage boolean;
  v_target_level int;
begin
  if p_user_id is distinct from auth.uid() then
    perform public.require_permission('can_manage_users');
  end if;

  if p_user_id = auth.uid() then
    select rp.preview_role_id into v_preview_role_id
    from public.role_previews rp
    where rp.user_id = auth.uid() and rp.expires_at > now();
  end if;

  if v_preview_role_id is not null then
    -- Audit fix auth:role-preview:no-expiry-retention: same
    -- revalidation as user_has_permission — the preview only applies
    -- while the caller currently holds can_manage_roles and the
    -- preview role still sits below their current max real level.
    -- Otherwise the real roles below are returned.
    select coalesce(max(r.level), 0) into v_my_level
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid();

    select exists (
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = auth.uid()
        and (r.permissions ->> 'can_manage_roles')::boolean = true
    ) into v_can_manage;

    select level into v_target_level from public.roles where id = v_preview_role_id;

    if v_can_manage and v_target_level is not null and v_target_level < v_my_level then
      return query
      select r.id, r.name, r.label, r.color, r.level, r.is_system, r.permissions, now()
      from public.roles r
      where r.id = v_preview_role_id;
      return;
    end if;
    -- Preview no longer valid: fall through to the real roles.
  end if;

  return query
  select r.id, r.name, r.label, r.color, r.level, r.is_system, r.permissions, ur.granted_at
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = p_user_id
  order by r.level desc;
end;
$function$;

comment on function public.get_user_roles(uuid) is
  'Audit fix auth:role-preview:no-expiry-retention: a role preview is substituted only while the caller currently holds can_manage_roles and the preview role is still below their current max real level.';
