-- Fix B1 (HIGH, test-run-1): unlink_minecraft() fails for regular members.
--
-- Root cause: unlink_minecraft() is SECURITY DEFINER and updates profiles,
-- but the BEFORE UPDATE trigger public.protect_profile_columns() checks the
-- SESSION user's permissions (auth.uid() / user_has_permission), not the
-- function owner's. A plain member has no can_manage_users /
-- can_assign_admin / can_manage_minecraft, so the trigger raised
-- 'You do not have permission to change minecraft_verified.' before the
-- update landed. The unlink feature is for members to unlink their OWN
-- account, so it was broken for exactly its intended users. (The sibling
-- trigger private.profiles_guard_columns() does not block this: it returns
-- early when current_user is not 'authenticated'/'anon', and inside a
-- SECURITY DEFINER function current_user is the function owner.)
--
-- Fix, following the exact pattern set_mc_verify_code() already uses
-- (set a transaction-local mca.* flag around the UPDATE; the trigger
-- reads the flag and exempts the RPC's own update):
--   * unlink_minecraft() sets mca.unlink_minecraft='on' around its UPDATE.
--   * protect_profile_columns() skips the minecraft_verified /
--     minecraft_uuid / mc_verify_code / mc_verify_expires checks while the
--     flag is on.
-- The flag can only be turned on inside unlink_minecraft(), which only
-- ever NULLs the link fields on the caller's OWN row (where id =
-- auth.uid()) and can never set an arbitrary value — so the exemption
-- cannot be used to claim someone else's link or to write any other
-- field. set_config(..., true) is transaction-local, so the flag dies
-- with the transaction even if the UPDATE raises.
--
-- The protect_profile_columns() body below is copied verbatim from the
-- live/test DB (pg_get_functiondef) with only the v_unlink_rpc lines
-- added, so nothing else in the trigger changes.
-- This file is for the TEST project first; the live fix goes via a PR.

create or replace function public.protect_profile_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'private'
as $function$
declare
  v_full_staff boolean;
  v_code_rpc boolean := coalesce(current_setting('mca.set_mc_verify_code', true), '') = 'on';
  v_unlink_rpc boolean := coalesce(current_setting('mca.unlink_minecraft', true), '') = 'on';
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
  if new.minecraft_verified is distinct from old.minecraft_verified and not v_unlink_rpc then
    raise exception 'You do not have permission to change minecraft_verified.';
  end if;
  if new.minecraft_uuid is distinct from old.minecraft_uuid and not v_unlink_rpc then
    raise exception 'You do not have permission to change minecraft_uuid.';
  end if;
  if new.email_access_revoked is distinct from old.email_access_revoked then
    raise exception 'You do not have permission to change email_access_revoked.';
  end if;
  if new.account_status is distinct from old.account_status then
    raise exception 'You do not have permission to change account_status.';
  end if;
  if new.mc_verify_code is distinct from old.mc_verify_code and new.mc_verify_code is not null and not v_code_rpc and not v_unlink_rpc then
    raise exception 'Use set_mc_verify_code() to set a Minecraft verification code.';
  end if;
  if new.mc_verify_expires is distinct from old.mc_verify_expires and new.mc_verify_expires is not null and not v_code_rpc and not v_unlink_rpc then
    raise exception 'Use set_mc_verify_code() to set a Minecraft verification code.';
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

create or replace function public.unlink_minecraft()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Signal protect_profile_columns() that this update is the unlink RPC's
  -- own work (same pattern as set_mc_verify_code's mca.set_mc_verify_code
  -- flag). Transaction-local: dies with the transaction on any error.
  -- Only ever nulls the link fields, only on the caller's own row.
  -- It can never set a username, a verified flag, or a UUID — so there
  -- is no path here to claim someone else's link.
  perform set_config('mca.unlink_minecraft', 'on', true);
  update public.profiles set
    minecraft_username = null,
    minecraft_verified = false,
    minecraft_bedrock_username = null,
    minecraft_bedrock_verified = false,
    minecraft_uuid = null,
    minecraft_bedrock_uuid = null,
    mc_verify_code = null,
    mc_verify_expires = null
  where id = v_uid;
  perform set_config('mca.unlink_minecraft', 'off', true);
end;
$function$;

comment on function public.unlink_minecraft() is
  'VER-M3 website half, B1 fix 2026-11-15: the only supported way for the website to unlink a Minecraft account. Nulls both usernames, both verified flags, both UUIDs, and the verify code + expiry on the caller''s own row only. Sets the transaction-local mca.unlink_minecraft flag around its UPDATE so protect_profile_columns() recognises it as the RPC''s own work (same pattern as set_mc_verify_code).';
