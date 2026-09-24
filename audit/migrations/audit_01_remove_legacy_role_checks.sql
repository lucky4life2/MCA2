-- audit_01_remove_legacy_role_checks: PENDING (the auto-mode classifier blocked apply_migration on 2026-09-24).
-- Rollback: audit/rollback/audit_01_remove_legacy_role_checks.sql
--
-- profiles.role is legacy. After this migration, every permission check reads
-- user_roles + roles.permissions via user_has_permission(). All 3 accounts with a
-- legacy admin/owner value also hold the `owner` role in user_roles (verified
-- 2026-09-24), so nobody loses access. Behaviour change: the require_permission()
-- owner superuser fallback is gone, so owners now get exactly their role's
-- permissions (the owner role explicitly sets can_manage_congress/court = false).
-- An owner who needs congress/court powers can grant themselves the role
-- (they hold can_assign_roles).

ALTER POLICY club_presidents_admin_insert ON public.club_presidents TO authenticated WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY club_presidents_admin_update ON public.club_presidents TO authenticated USING (user_has_permission('can_manage_config')) WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY club_presidents_admin_delete ON public.club_presidents TO authenticated USING (user_has_permission('can_manage_config'));
ALTER POLICY history_servers_admin_insert ON public.history_servers TO authenticated WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY history_servers_admin_update ON public.history_servers TO authenticated USING (user_has_permission('can_manage_config')) WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY history_servers_admin_delete ON public.history_servers TO authenticated USING (user_has_permission('can_manage_config'));
ALTER POLICY leadership_admin_insert ON public.leadership TO authenticated WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY leadership_admin_update ON public.leadership TO authenticated USING (user_has_permission('can_manage_config')) WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY leadership_admin_delete ON public.leadership TO authenticated USING (user_has_permission('can_manage_config'));
ALTER POLICY nation_owners_admin_insert ON public.nation_owners TO authenticated WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY nation_owners_admin_update ON public.nation_owners TO authenticated USING (user_has_permission('can_manage_config')) WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY nation_owners_admin_delete ON public.nation_owners TO authenticated USING (user_has_permission('can_manage_config'));
ALTER POLICY nations_admin_insert ON public.nations TO authenticated WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY nations_admin_update ON public.nations TO authenticated USING (user_has_permission('can_manage_config')) WITH CHECK (user_has_permission('can_manage_config'));
ALTER POLICY nations_admin_delete ON public.nations TO authenticated USING (user_has_permission('can_manage_config'));
ALTER POLICY settings_admin_insert ON public.settings TO authenticated WITH CHECK (user_has_permission('can_manage_config') OR user_has_permission('can_lock_site'));
ALTER POLICY settings_admin_update ON public.settings TO authenticated USING (user_has_permission('can_manage_config') OR user_has_permission('can_lock_site')) WITH CHECK (user_has_permission('can_manage_config') OR user_has_permission('can_lock_site'));
ALTER POLICY settings_admin_delete ON public.settings TO authenticated USING (user_has_permission('can_manage_config') OR user_has_permission('can_lock_site'));

ALTER POLICY profiles_update ON public.profiles TO authenticated
  USING (((select auth.uid()) = id) OR user_has_permission('can_manage_users') OR user_has_permission('can_manage_minecraft'))
  WITH CHECK (((select auth.uid()) = id) OR user_has_permission('can_manage_users') OR user_has_permission('can_manage_minecraft'));
ALTER POLICY profiles_select_self_or_staff ON public.profiles TO authenticated
  USING (((select auth.uid()) = id) OR user_has_permission('can_manage_users') OR user_has_permission('can_manage_minecraft'));
ALTER POLICY audit_log_select_admins ON public.audit_log TO authenticated USING (user_has_permission('can_view_audit_log'));
ALTER POLICY products_insert ON public.products TO authenticated WITH CHECK (user_has_permission('can_manage_shop'));
ALTER POLICY products_update ON public.products TO authenticated USING (user_has_permission('can_manage_shop')) WITH CHECK (user_has_permission('can_manage_shop'));
ALTER POLICY products_delete ON public.products TO authenticated USING (user_has_permission('can_manage_shop'));
ALTER POLICY products_read ON public.products USING ((coalesce(active, true) = true) OR user_has_permission('can_manage_shop'));
ALTER POLICY orders_select_merged ON public.orders TO authenticated USING (((select auth.uid()) = user_id) OR user_has_permission('can_manage_shop'));
ALTER POLICY "staff manage comments" ON public.task_comments TO authenticated USING (user_has_permission('can_manage_tasks'));
ALTER POLICY "staff manage task assignees" ON public.task_assignees TO authenticated USING (user_has_permission('can_manage_tasks'));
ALTER POLICY "staff manage project access" ON public.task_project_access TO authenticated USING (user_has_permission('can_manage_tasks'));
ALTER POLICY "staff manage projects" ON public.task_projects TO authenticated USING (user_has_permission('can_manage_tasks'));
ALTER POLICY "staff manage published tasks" ON public.tasks TO authenticated
  USING (user_has_permission('can_manage_tasks') AND is_draft = false)
  WITH CHECK (user_has_permission('can_manage_tasks') AND is_draft = false);
ALTER POLICY "creator manage own draft tasks" ON public.tasks TO authenticated
  USING (created_by = (select auth.uid()) AND is_draft = true)
  WITH CHECK (created_by = (select auth.uid()) AND user_has_permission('can_manage_tasks'));

CREATE OR REPLACE FUNCTION public.require_permission(perm text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
begin
  if user_has_permission(perm) then
    return;
  end if;
  raise exception 'Permission denied: % required', perm;
end;
$function$;

-- Username -> email resolution moves server-side into the sign-in-with-email edge
-- function (service role). After that deploy, no client needs this RPC.
CREATE OR REPLACE FUNCTION public.get_email_by_username(p_username text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_target_id uuid;
  v_email text;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return null;
  end if;
  select p.id, au.email into v_target_id, v_email
  from public.profiles p join auth.users au on au.id = p.id
  where lower(p.username) = lower(p_username) limit 1;
  if v_target_id is null then
    return null;
  end if;
  if v_uid is distinct from v_target_id and not public.user_has_permission('can_manage_users') then
    return null;
  end if;
  return v_email;
end;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_email_by_username(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_role_to_user(p_user_id uuid, p_role_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_role record;
  v_target_level int;
begin
  perform public.require_permission('can_assign_roles');
  select * into v_role from public.roles where id = p_role_id;
  if v_role is null then
    raise exception 'Role not found';
  end if;
  if (v_role.permissions ->> 'can_assign_admin')::boolean is true or v_role.level >= 80 then
    perform public.require_permission('can_assign_admin');
  end if;
  select coalesce(max(r.level), 0) into v_target_level
  from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user_id;
  if v_target_level >= 80 then
    perform public.require_permission('can_assign_admin');
  end if;
  insert into public.user_roles (user_id, role_id)
  values (p_user_id, p_role_id)
  on conflict (user_id, role_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_role_from_user(p_user_id uuid, p_role_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_role record;
  v_target_level int;
begin
  perform public.require_permission('can_assign_roles');
  select * into v_role from public.roles where id = p_role_id;
  if v_role is null then
    raise exception 'Role not found';
  end if;
  if (v_role.permissions ->> 'can_assign_admin')::boolean is true or v_role.level >= 80 then
    perform public.require_permission('can_assign_admin');
  end if;
  select coalesce(max(r.level), 0) into v_target_level
  from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user_id;
  if v_target_level >= 80 then
    perform public.require_permission('can_assign_admin');
  end if;
  delete from public.user_roles
  where user_id = p_user_id and role_id = p_role_id;
end;
$function$;

-- protect_profile_columns / profiles_guard_columns: only the staff-check line
-- changes (the legacy get_my_role() term is dropped). Bodies are otherwise
-- identical to the rollback file.
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
declare
  v_full_staff boolean;
begin
  if auth.role() = 'service_role' or session_user = 'postgres' then
    return new;
  end if;
  v_full_staff := user_has_permission('can_manage_users')
                  or user_has_permission('can_assign_admin');
  if old.id is distinct from auth.uid()
     and not v_full_staff
     and user_has_permission('can_manage_minecraft')
     and (new.username is distinct from old.username
          or new.display_name is distinct from old.display_name
          or new.public_listing_opt_in is distinct from old.public_listing_opt_in
          or new.news_email_opt_in is distinct from old.news_email_opt_in) then
    raise exception 'can_manage_minecraft only allows changes to this member''s Minecraft-related fields.';
  end if;
  if v_full_staff or user_has_permission('can_manage_minecraft') then
    return new;
  end if;
  if new.role is distinct from old.role then
    raise exception 'You do not have permission to change the role column.';
  end if;
  if new.minecraft_verified is distinct from old.minecraft_verified then
    raise exception 'You do not have permission to change minecraft_verified.';
  end if;
  if new.minecraft_uuid is distinct from old.minecraft_uuid then
    raise exception 'You do not have permission to change minecraft_uuid.';
  end if;
  if new.email_access_revoked is distinct from old.email_access_revoked then
    raise exception 'You do not have permission to change email_access_revoked.';
  end if;
  if new.account_status is distinct from old.account_status then
    raise exception 'You do not have permission to change account_status.';
  end if;
  if new.mc_verify_code is distinct from old.mc_verify_code then
    raise exception 'You do not have permission to change mc_verify_code.';
  end if;
  if new.mc_verify_expires is distinct from old.mc_verify_expires then
    raise exception 'You do not have permission to change mc_verify_expires.';
  end if;
  if new.password_reset_token is distinct from old.password_reset_token then
    raise exception 'You do not have permission to change password_reset_token.';
  end if;
  if new.pending_email_token is distinct from old.pending_email_token then
    raise exception 'You do not have permission to change pending_email_token.';
  end if;
  if new.task_email_opt_in is distinct from old.task_email_opt_in
     and not (user_has_permission('can_manage_tasks')
              or user_has_permission('can_check_off_tasks')
              or user_has_permission('can_test_tasks')) then
    raise exception 'You do not have permission to change task_email_opt_in.';
  end if;
  if new.date_of_birth is distinct from old.date_of_birth and old.date_of_birth is not null then
    raise exception 'Date of birth cannot be changed once set.';
  end if;
  if new.age_band is distinct from old.age_band and old.age_band is not null then
    raise exception 'Age band cannot be changed once set.';
  end if;
  if old.account_status in ('age_unverified','coppa_restricted') then
    if new.username is distinct from old.username
       or new.display_name is distinct from old.display_name
       or new.minecraft_username is distinct from old.minecraft_username then
      raise exception 'This account has not cleared the age gate yet and cannot set a profile identity.';
    end if;
  end if;
  if old.age_band = 'under_13'
     and ((new.discord_id is distinct from old.discord_id and new.discord_id is not null)
          or (new.google_id is distinct from old.google_id and new.google_id is not null)) then
    if not exists (
      select 1 from public.minor_consent mc
      where mc.user_id = old.id and mc.third_party_disclosure_consent = true
    ) then
      raise exception 'Linking a third-party account requires parental consent for third-party disclosure, which has not been given for this account.';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.profiles_guard_columns()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog'
AS $function$
declare
  v_is_self  boolean;
  v_is_staff boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  v_is_self  := auth.uid() = old.id;
  v_is_staff := public.user_has_permission('can_manage_users')
                or public.user_has_permission('can_manage_minecraft');
  if new.password_reset_token    is distinct from old.password_reset_token
  or new.password_reset_expires  is distinct from old.password_reset_expires
  or new.password_reset_attempts is distinct from old.password_reset_attempts
  or new.pending_email           is distinct from old.pending_email
  or new.pending_email_token     is distinct from old.pending_email_token
  or new.pending_email_expires   is distinct from old.pending_email_expires
  or new.pending_email_attempts  is distinct from old.pending_email_attempts
  or new.role                    is distinct from old.role
  or new.account_status          is distinct from old.account_status
  or new.email_access_revoked    is distinct from old.email_access_revoked
  or new.deletion_scheduled_at   is distinct from old.deletion_scheduled_at
  or new.deactivated_at          is distinct from old.deactivated_at
  or new.minecraft_uuid          is distinct from old.minecraft_uuid
  or new.email                   is distinct from old.email
  or new.email_unsub_token       is distinct from old.email_unsub_token
  then
    raise exception 'profiles: that field can only be changed by the server';
  end if;
  if new.membership_status             is distinct from old.membership_status
  or new.membership_source             is distinct from old.membership_source
  or new.membership_current_period_end is distinct from old.membership_current_period_end
  or new.stripe_customer_id            is distinct from old.stripe_customer_id
  or new.stripe_subscription_id        is distinct from old.stripe_subscription_id
  then
    raise exception 'profiles: membership and billing fields can only be changed by the server';
  end if;
  if (new.mc_verify_code is distinct from old.mc_verify_code
      or new.mc_verify_expires is distinct from old.mc_verify_expires)
     and not v_is_self
  then
    raise exception 'profiles: mc_verify_code can only be set by its owner';
  end if;
  if new.minecraft_verified is distinct from old.minecraft_verified and not v_is_staff then
    raise exception 'profiles: minecraft_verified can only be changed by staff';
  end if;
  if new.discord_id is distinct from old.discord_id and new.discord_id is not null then
    raise exception 'profiles: discord_id can only be cleared, not set, directly';
  end if;
  if new.google_id is distinct from old.google_id and new.google_id is not null then
    raise exception 'profiles: google_id can only be cleared, not set, directly';
  end if;
  return new;
end;
$function$;

-- Prompt requirement: the Administrator role can manage memberships (owner already can).
UPDATE public.roles SET permissions = permissions || '{"can_manage_memberships": true}'::jsonb WHERE name = 'admin';
