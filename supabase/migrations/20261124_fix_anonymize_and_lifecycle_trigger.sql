-- Fix the two code issues blocking the MCA website stress-test TEST
-- live tests (worker E, 2026-11-23), 2026-11-24.
--
-- ISSUE 1 — private.anonymize_user can never succeed (23502).
--   The migration-2 body sets password_reset_attempts = NULL and
--   pending_email_attempts = NULL, but both columns are
--   integer NOT NULL DEFAULT 0 on TEST and on live (verified from
--   information_schema on both projects, 2026-11-24). Every other
--   column the function NULLs was checked the same way and is
--   nullable on both projects, so these two are the only offenders.
--   Fix: set both attempts columns to 0, not NULL. Live's own
--   anonymize_user is an older body that never touches the attempts
--   columns, so live does not hit the 23502 today — but the
--   migration-2 body replaces it when migration 2 is applied to live,
--   so this fix is what makes that future apply work.
--
-- ISSUE 2 — protect_profile_columns blocks the own-account RPCs.
--   schedule_own_account_deletion / cancel_own_account_deletion /
--   reactivate_own_account (migration 2) and deactivate_own_account
--   (account.page.js:2099, same self-service lifecycle) all update
--   profiles.account_status on the caller's own row. They are SECURITY
--   DEFINER, but public.protect_profile_columns() reads the SESSION
--   user (auth.role() / session_user), not the function owner, so the
--   definer does not help — a plain member gets 400 'You do not have
--   permission to change account_status.' The sibling trigger
--   private.profiles_guard_columns() does NOT block these RPCs: it
--   returns early when current_user is not 'authenticated'/'anon',
--   and inside a SECURITY DEFINER function current_user is the owner
--   (postgres). So protect is the only blocker, and the guard needs
--   no change — its carve-out still governs direct client updates.
--
--   Fix, following the exact pattern set_mc_verify_code() already
--   uses and unlink_minecraft() copied in migration
--   20261115_unlink_minecraft_trigger_exemption.sql (same root cause,
--   same fix, for minecraft_verified / minecraft_uuid):
--     * each of the four RPCs sets the transaction-local flag
--       mca.own_account_lifecycle='on' around its UPDATE, then off.
--     * protect_profile_columns() exempts an account_status change
--       ONLY while that flag is on AND the row is the caller's own
--       (old.id = auth.uid()) AND the transition is one of the five
--       self-service transitions (active -> pending_deletion /
--       deactivated, deactivated -> pending_deletion / active,
--       pending_deletion -> active). Frozen / terminated in either
--       direction stay blocked even with the flag on.
--   Why the flag cannot be abused by a direct client call:
--     * set_config(..., true) is transaction-local: the flag dies
--       with the transaction, and each PostgREST request is its own
--       transaction, so it cannot leak into a later request.
--     * Clients have no SQL access (PostgREST exposes only tables /
--       RPCs; client DDL was revoked in 20261008), so no client can
--       call set_config. The only code that sets this flag is the
--       four RPCs below, each of which (a) requires auth.uid(),
--       (b) updates ONLY where id = auth.uid() (own row), and
--       (c) runs one fixed UPDATE with fixed values — no
--       caller-controlled value flows into it.
--     * Even if the flag were somehow on, the trigger independently
--       re-checks own-row + allowed transition, and every other
--       field check in the trigger still runs regardless of the flag.
--     * A direct client UPDATE of account_status runs with the flag
--       off and raises exactly as before.
--   The protect_profile_columns() body below is copied verbatim from
--   pg_get_functiondef on live + TEST (which agree byte-for-byte,
--   and match the repo's 20261115 copy) with only the
--   v_lifecycle_rpc declaration and the account_status block added.
--   The deactivate_own_account() body is likewise the verbatim
--   live/TEST body (it has no repo source) with only the flag lines
--   added. schedule / cancel / reactivate are the 20261123 repo
--   bodies with only the flag lines added.
--   terminate_own_account() is DELIBERATELY untouched: it has the
--   same trigger conflict, but it has no repo source, and the guard's
--   own comment says terminated stays staff/server-only — whether
--   self-termination should work is a product decision, not a bug
--   fix. Flagged for the parent instead.
--
--   FOUND footgun (why the flag-off sits where it does): PERFORM
--   set_config is a SELECT, so it clobbers FOUND. cancel/reactivate
--   read FOUND into v_cancelled/v_reactivated, and deactivate reads
--   it in `if not found`, so in each RPC the flag is turned off only
--   AFTER FOUND has been captured — otherwise a no-row update would
--   silently report success.
--
-- No DROP-first lines: every change here is body-only (no signature,
-- parameter, or return-type change), so CREATE OR REPLACE applies
-- cleanly and there is no transient window where a function is
-- missing while the statements are applied one at a time. (The 42P13
-- lesson from PRs #82–#84 does not apply.) CREATE OR REPLACE also
-- preserves the existing grants, so no grant statements are needed:
-- schedule/cancel/reactivate/deactivate already grant EXECUTE to
-- authenticated on both projects, anonymize is service_role-only,
-- and protect is a trigger function.
--
-- Apply order: TEST first (this migration), re-run the TEST live
-- tests, then live only as part of the sequenced live apply (after
-- migration 2 lands there — this file assumes migration 2's bodies
-- for schedule/cancel/reactivate/anonymize).

-- ── protect_profile_columns: lifecycle exemption ───────────────
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
  v_lifecycle_rpc boolean := coalesce(current_setting('mca.own_account_lifecycle', true), '') = 'on';
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
  -- Own-account lifecycle (2026-11-24): schedule / cancel / reactivate /
  -- deactivate set the transaction-local mca.own_account_lifecycle flag
  -- around their UPDATE (same pattern as mca.unlink_minecraft). Exempt
  -- ONLY the caller's own row moving along a self-service transition.
  -- Frozen / terminated in either direction stay blocked even with the
  -- flag on, and a direct client UPDATE (flag off) raises as before.
  if new.account_status is distinct from old.account_status then
    if not (v_lifecycle_rpc
            and old.id = auth.uid()
            and ((old.account_status = 'active' and new.account_status in ('pending_deletion', 'deactivated'))
                 or (old.account_status = 'deactivated' and new.account_status in ('pending_deletion', 'active'))
                 or (old.account_status = 'pending_deletion' and new.account_status = 'active'))) then
      raise exception 'You do not have permission to change account_status.';
    end if;
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

-- ── schedule_own_account_deletion: set the lifecycle flag ───────
create or replace function public.schedule_own_account_deletion()
returns timestamp with time zone
language plpgsql
security definer
set search_path to 'auth', 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_when timestamptz := now();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select account_status into v_status from public.profiles where id = v_uid;
  if v_status = 'terminated' then
    raise exception 'This account has already been terminated by an administrator.';
  end if;

  -- Signal protect_profile_columns() that this update is the lifecycle
  -- RPC's own work (same pattern as mca.unlink_minecraft). Only ever
  -- moves the caller's OWN row active -> pending_deletion.
  perform set_config('mca.own_account_lifecycle', 'on', true);
  update public.profiles
  set account_status = 'pending_deletion',
      deletion_scheduled_at = v_when
  where id = v_uid;
  perform set_config('mca.own_account_lifecycle', 'off', true);

  return v_when + interval '7 days';
end;
$function$;

-- ── cancel_own_account_deletion: set the lifecycle flag ──────────
create or replace function public.cancel_own_account_deletion()
returns boolean
language plpgsql
security definer
set search_path to 'auth', 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_cancelled boolean := false;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Signal protect_profile_columns() that this update is the lifecycle
  -- RPC's own work (same pattern as mca.unlink_minecraft). Only ever
  -- moves the caller's OWN row pending_deletion -> active. The flag is
  -- turned off AFTER FOUND is captured: PERFORM set_config clobbers
  -- FOUND, so turning it off first would make a no-row update report
  -- success.
  perform set_config('mca.own_account_lifecycle', 'on', true);
  update public.profiles
  set account_status = 'active',
      deletion_scheduled_at = null
  where id = v_uid
    and account_status = 'pending_deletion';

  v_cancelled := found;
  perform set_config('mca.own_account_lifecycle', 'off', true);
  return v_cancelled;
end;
$function$;

-- ── reactivate_own_account: set the lifecycle flag ───────────────
create or replace function public.reactivate_own_account()
returns boolean
language plpgsql
security definer
set search_path to 'auth', 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_reactivated boolean := false;
begin
  if v_uid is null then return false; end if;

  -- Signal protect_profile_columns() that this update is the lifecycle
  -- RPC's own work (same pattern as mca.unlink_minecraft). Only ever
  -- moves the caller's OWN row pending_deletion / deactivated -> active.
  -- Flag off AFTER FOUND is captured (see cancel above).
  perform set_config('mca.own_account_lifecycle', 'on', true);
  update public.profiles
  set account_status = 'active',
      deletion_scheduled_at = null,
      deactivated_at = null
  where id = v_uid
    and account_status in ('pending_deletion', 'deactivated');

  v_reactivated := found;
  perform set_config('mca.own_account_lifecycle', 'off', true);
  return v_reactivated;
end;
$function$;

-- ── deactivate_own_account: set the lifecycle flag ───────────────
-- Verbatim live/TEST body (no repo source exists for this RPC) with
-- only the flag lines added. Called by the account page (Deactivate
-- button); same 400 as schedule before this fix. Flag off AFTER the
-- `if not found` check: PERFORM set_config clobbers FOUND, so turning
-- it off first would make a deactivation from a non-active state
-- silently succeed instead of raising.
create or replace function public.deactivate_own_account()
returns void
language plpgsql
security definer
set search_path to 'auth', 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  -- Signal protect_profile_columns() that this update is the lifecycle
  -- RPC's own work (same pattern as mca.unlink_minecraft). Only ever
  -- moves the caller's OWN row active -> deactivated.
  perform set_config('mca.own_account_lifecycle', 'on', true);
  update public.profiles
  set account_status = 'deactivated',
      deactivated_at = now(),
      news_email_opt_in_before_deactivation = news_email_opt_in,
      news_email_opt_in = false
  where id = v_uid and account_status = 'active';

  if not found then
    raise exception 'Account cannot be deactivated from its current state.';
  end if;
  perform set_config('mca.own_account_lifecycle', 'off', true);

  delete from auth.sessions where auth.sessions.user_id = v_uid;
  delete from auth.refresh_tokens where auth.refresh_tokens.user_id = v_uid::text;
end;
$function$;

-- ── private.anonymize_user: attempts columns to 0, not NULL ──────
-- 20261123 body with exactly two value changes: password_reset_attempts
-- and pending_email_attempts are integer NOT NULL DEFAULT 0 on both
-- projects, so NULLing them raises 23502 and the function can never
-- succeed. 0 is the "no attempts outstanding" value and matches the
-- column defaults; every other NULL in the UPDATE targets a nullable
-- column (verified on TEST + live, 2026-11-24).
create or replace function private.anonymize_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'auth', 'public', 'pg_catalog'
as $function$
declare
  v_deleted_email text := 'deleted-' || p_user_id::text || '@deleted.invalid';
  v_deleted_username text := 'deleted_' || substr(md5(p_user_id::text), 1, 8);
begin
  if p_user_id is null then raise exception 'anonymize_user: null user id'; end if;

  -- Close the login surface first: no live sessions, no OAuth identities,
  -- no MFA factors, and banned so the old password is useless.
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.identities where user_id = p_user_id;
  delete from auth.mfa_factors where user_id = p_user_id;
  update auth.users
  set email = v_deleted_email,
      email_confirmed_at = null,
      phone = null,
      phone_confirmed_at = null,
      banned_until = now() + interval '100 years'
  where id = p_user_id;

  update public.profiles
  set email = v_deleted_email,
      username = v_deleted_username,
      display_name = 'Deleted Member',
      google_id = null,
      discord_id = null,
      minecraft_uuid = null,
      minecraft_username = null,
      minecraft_bedrock_username = null,
      minecraft_verified = false,
      minecraft_bedrock_verified = false,
      mc_verify_code = null,
      mc_verify_expires = null,
      password_reset_token = null,
      password_reset_expires = null,
      password_reset_attempts = 0,
      pending_email = null,
      pending_email_token = null,
      pending_email_expires = null,
      pending_email_attempts = 0,
      email_unsub_token = null,
      stripe_customer_id = null,
      stripe_subscription_id = null,
      membership_status = 'none',
      membership_source = null,
      membership_current_period_end = null,
      account_status = 'terminated',
      deletion_scheduled_at = null,
      deactivated_at = null
  where id = p_user_id;
end;
$function$;
