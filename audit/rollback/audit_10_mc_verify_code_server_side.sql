-- Rollback for audit_10_mc_verify_code_server_side (2026-09-24).
-- Restores the two trigger functions exactly as audit_01 left them and drops the RPC.
DROP FUNCTION IF EXISTS public.set_mc_verify_code(text);

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

-- Note: audit_10b_fix_protect_profile_columns_bypass redefined the same two objects
-- (set_mc_verify_code, protect_profile_columns); this file rolls back both.
