-- Rollback for migration audit_01_remove_legacy_role_checks (2026-09-24).
-- Captured from live pg_policies / pg_get_functiondef / roles before the change.
-- Running this file restores every legacy private.get_my_role() (profiles.role) check.

DROP POLICY IF EXISTS club_presidents_admin_insert ON public.club_presidents;
CREATE POLICY club_presidents_admin_insert ON public.club_presidents AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])));
DROP POLICY IF EXISTS club_presidents_admin_update ON public.club_presidents;
CREATE POLICY club_presidents_admin_update ON public.club_presidents AS PERMISSIVE FOR UPDATE TO public
  USING ((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])))
  WITH CHECK ((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])));
DROP POLICY IF EXISTS club_presidents_admin_delete ON public.club_presidents;
CREATE POLICY club_presidents_admin_delete ON public.club_presidents AS PERMISSIVE FOR DELETE TO public
  USING ((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])));

DROP POLICY IF EXISTS history_servers_admin_insert ON public.history_servers;
CREATE POLICY history_servers_admin_insert ON public.history_servers AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));
DROP POLICY IF EXISTS history_servers_admin_update ON public.history_servers;
CREATE POLICY history_servers_admin_update ON public.history_servers AS PERMISSIVE FOR UPDATE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()))
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));
DROP POLICY IF EXISTS history_servers_admin_delete ON public.history_servers;
CREATE POLICY history_servers_admin_delete ON public.history_servers AS PERMISSIVE FOR DELETE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));

DROP POLICY IF EXISTS leadership_admin_insert ON public.leadership;
CREATE POLICY leadership_admin_insert ON public.leadership AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));
DROP POLICY IF EXISTS leadership_admin_update ON public.leadership;
CREATE POLICY leadership_admin_update ON public.leadership AS PERMISSIVE FOR UPDATE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()))
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));
DROP POLICY IF EXISTS leadership_admin_delete ON public.leadership;
CREATE POLICY leadership_admin_delete ON public.leadership AS PERMISSIVE FOR DELETE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));

DROP POLICY IF EXISTS nation_owners_admin_insert ON public.nation_owners;
CREATE POLICY nation_owners_admin_insert ON public.nation_owners AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));
DROP POLICY IF EXISTS nation_owners_admin_update ON public.nation_owners;
CREATE POLICY nation_owners_admin_update ON public.nation_owners AS PERMISSIVE FOR UPDATE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()))
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));
DROP POLICY IF EXISTS nation_owners_admin_delete ON public.nation_owners;
CREATE POLICY nation_owners_admin_delete ON public.nation_owners AS PERMISSIVE FOR DELETE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));

DROP POLICY IF EXISTS nations_admin_insert ON public.nations;
CREATE POLICY nations_admin_insert ON public.nations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));
DROP POLICY IF EXISTS nations_admin_update ON public.nations;
CREATE POLICY nations_admin_update ON public.nations AS PERMISSIVE FOR UPDATE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()))
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));
DROP POLICY IF EXISTS nations_admin_delete ON public.nations;
CREATE POLICY nations_admin_delete ON public.nations AS PERMISSIVE FOR DELETE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission()));

DROP POLICY IF EXISTS settings_admin_insert ON public.settings;
CREATE POLICY settings_admin_insert ON public.settings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission() OR user_has_permission('can_lock_site'::text)));
DROP POLICY IF EXISTS settings_admin_update ON public.settings;
CREATE POLICY settings_admin_update ON public.settings AS PERMISSIVE FOR UPDATE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission() OR user_has_permission('can_lock_site'::text)))
  WITH CHECK (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission() OR user_has_permission('can_lock_site'::text)));
DROP POLICY IF EXISTS settings_admin_delete ON public.settings;
CREATE POLICY settings_admin_delete ON public.settings AS PERMISSIVE FOR DELETE TO public
  USING (((private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR private.user_has_config_permission() OR user_has_permission('can_lock_site'::text)));

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING (((( SELECT auth.uid() AS uid) = id) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR user_has_permission('can_manage_users'::text) OR user_has_permission('can_manage_minecraft'::text)))
  WITH CHECK (((( SELECT auth.uid() AS uid) = id) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR user_has_permission('can_manage_users'::text) OR user_has_permission('can_manage_minecraft'::text)));
DROP POLICY IF EXISTS profiles_select_self_or_staff ON public.profiles;
CREATE POLICY profiles_select_self_or_staff ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT auth.uid() AS uid) = id) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])) OR user_has_permission('can_manage_users'::text) OR user_has_permission('can_manage_minecraft'::text)));

DROP POLICY IF EXISTS audit_log_select_admins ON public.audit_log;
CREATE POLICY audit_log_select_admins ON public.audit_log AS PERMISSIVE FOR SELECT TO public
  USING ((user_has_permission('can_view_audit_log'::text) OR (private.get_my_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));

DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert ON public.products AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_has_permission('can_manage_shop'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));
DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products AS PERMISSIVE FOR UPDATE TO public
  USING ((user_has_permission('can_manage_shop'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))))
  WITH CHECK ((user_has_permission('can_manage_shop'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));
DROP POLICY IF EXISTS products_delete ON public.products;
CREATE POLICY products_delete ON public.products AS PERMISSIVE FOR DELETE TO public
  USING ((user_has_permission('can_manage_shop'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));
DROP POLICY IF EXISTS products_read ON public.products;
CREATE POLICY products_read ON public.products AS PERMISSIVE FOR SELECT TO public
  USING (((COALESCE(active, true) = true) OR user_has_permission('can_manage_shop'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));
DROP POLICY IF EXISTS orders_select_merged ON public.orders;
CREATE POLICY orders_select_merged ON public.orders AS PERMISSIVE FOR SELECT TO public
  USING (((( SELECT auth.uid() AS uid) = user_id) OR user_has_permission('can_manage_shop'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));

DROP POLICY IF EXISTS "staff manage comments" ON public.task_comments;
CREATE POLICY "staff manage comments" ON public.task_comments AS PERMISSIVE FOR ALL TO public
  USING ((user_has_permission('can_manage_tasks'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));
DROP POLICY IF EXISTS "staff manage task assignees" ON public.task_assignees;
CREATE POLICY "staff manage task assignees" ON public.task_assignees AS PERMISSIVE FOR ALL TO public
  USING ((user_has_permission('can_manage_tasks'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));
DROP POLICY IF EXISTS "staff manage project access" ON public.task_project_access;
CREATE POLICY "staff manage project access" ON public.task_project_access AS PERMISSIVE FOR ALL TO public
  USING ((user_has_permission('can_manage_tasks'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));
DROP POLICY IF EXISTS "staff manage projects" ON public.task_projects;
CREATE POLICY "staff manage projects" ON public.task_projects AS PERMISSIVE FOR ALL TO public
  USING ((user_has_permission('can_manage_tasks'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))));
DROP POLICY IF EXISTS "staff manage published tasks" ON public.tasks;
CREATE POLICY "staff manage published tasks" ON public.tasks AS PERMISSIVE FOR ALL TO public
  USING (((user_has_permission('can_manage_tasks'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))) AND (is_draft = false)))
  WITH CHECK (((user_has_permission('can_manage_tasks'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text]))) AND (is_draft = false)));
DROP POLICY IF EXISTS "creator manage own draft tasks" ON public.tasks;
CREATE POLICY "creator manage own draft tasks" ON public.tasks AS PERMISSIVE FOR ALL TO public
  USING (((created_by = ( SELECT auth.uid() AS uid)) AND (is_draft = true)))
  WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (user_has_permission('can_manage_tasks'::text) OR (private.get_my_role() = ANY (ARRAY['admin'::text, 'owner'::text])))));

CREATE OR REPLACE FUNCTION public.require_permission(perm text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
begin
  if user_has_permission(perm) or get_my_role() = 'owner' then
    return;
  end if;
  raise exception 'Permission denied: % required', perm;
end;
$function$;

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
  if v_uid is distinct from v_target_id
     and not public.user_has_permission('can_manage_users')
     and public.get_my_role() is distinct from 'owner' then
    return null;
  end if;
  return v_email;
end;
$function$;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO authenticated;

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
  select greatest(
    coalesce((select max(r.level) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user_id), 0),
    coalesce((select case when role = 'admin' then 80 when role in ('owner','super_admin') then 100 else 0 end from public.profiles where id = p_user_id), 0)
  ) into v_target_level;
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
  select greatest(
    coalesce((select max(r.level) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user_id), 0),
    coalesce((select case when role = 'admin' then 80 when role in ('owner','super_admin') then 100 else 0 end from public.profiles where id = p_user_id), 0)
  ) into v_target_level;
  if v_target_level >= 80 then
    perform public.require_permission('can_assign_admin');
  end if;
  delete from public.user_roles
  where user_id = p_user_id and role_id = p_role_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_profile_columns()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
declare
  v_full_staff boolean;
begin
  if auth.role() = 'service_role' or session_user = 'postgres' then
    return new;
  end if;
  v_full_staff := coalesce(get_my_role(), '') = any (array['admin', 'owner'])
                  or user_has_permission('can_manage_users')
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
  v_is_staff := private.get_my_role() = any(array['admin','owner'])
                or public.user_has_permission('can_manage_users')
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

UPDATE public.roles SET permissions = permissions || '{"can_manage_memberships": false}'::jsonb WHERE name = 'admin';
