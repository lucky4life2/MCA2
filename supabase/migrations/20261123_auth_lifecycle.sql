-- Auth / signup lifecycle (stress-test items 8, 14, 18 + item-19 profile
-- optimistic concurrency), 2026-11-23.
--
-- APPLY ORDER: run this migration on the TEST project first and live-test
-- the full delete -> purge -> re-register cycle there BEFORE deploying the
-- client JS that ships with it (login/onboarding/account pages now SELECT
-- profiles.profile_version — the account page breaks if the column does
-- not exist yet). Apply to live only after the branch merges.
--
-- BEFORE APPLYING TO LIVE, diff these two against the live database —
-- neither definition lives in the repo today, so the copies committed
-- here are the designed semantics, not a verified copy of live:
--   * public.email_in_use — compare with pg_proc on the live project.
--     The live copy is what signup-with-email already calls; if it
--     differs, port the live semantics here instead of overwriting.
--   * private.profiles_guard_columns — the copy below is the repo's
--     20261027 file (20260910 text + the self-service carve-out) plus
--     the profile_version rule. If the live trigger body has drifted,
--     port the profile_version rule into the live version instead.
--
-- Contents:
--   * public.email_in_use — item 8. True when auth.users or profiles
--     holds the (trimmed, lowercased) email, excluding one user id. A
--     pending_deletion account still has its auth.users row, so it
--     counts as in-use and re-signup 409s during the grace period
--     (item 18); after the purge frees the address it returns false.
--   * public.schedule_own_account_deletion — item 18. Verbatim from
--     audit/rollback/audit_04_account_deletion_requires_aal2.sql.
--   * public.cancel_own_account_deletion — item 18. Clears a pending
--     deletion back to active. Called by the account page on sign-in
--     (auto-cancel) and by the Cancel button.
--   * public.reactivate_own_account — item 18. Clears pending_deletion
--     / deactivated back to active. Called by login.page.js on every
--     successful sign-in. Never touches coppa_restricted (that needs
--     parental consent, not a sign-in).
--   * private.anonymize_user — item 18. Anonymizes a civic-tied account
--     in place (email -> deleted-<uuid>@deleted.invalid in BOTH
--     auth.users and profiles, identities cleared, sessions killed,
--     user banned) so the purge never fails on a referencing row AND
--     the original email is freed for re-registration. Civic rows
--     (votes, bills, filings, economy history) are kept intact.
--   * private.purge_scheduled_deletions — item 18. Per-user loop over
--     due pending_deletion / coppa_restricted rows: tries DELETE FROM
--     auth.users; on a foreign-key violation (civic-tied or otherwise
--     referenced) anonymizes instead; any other per-user failure is
--     logged in the result and the batch continues — one bad row must
--     never fail the whole night's purge (audit_07 lesson).
--   * profiles.profile_version + bump trigger — item 19. Integer
--     optimistic-concurrency counter, bumped by the trigger on every
--     update. Clients never write it (the guard rejects anything but
--     the trigger's own +1, tolerated in either trigger order) and
--     send .eq('profile_version', <loaded>) on profile saves.
--
-- Grants follow supabase/migrations/README.md: default privileges are
-- cleared, so every new function is unreachable until granted here.
-- Own-account RPCs: authenticated only. Purge/anonymize: service_role
-- only (the pg_cron job runs as postgres and needs no grant).

-- ── email_in_use (item 8) ───────────────────────────────────────
-- Live (2026-11-23, verified verbatim from pg_proc on live + TEST,
-- which agree byte-for-byte) reconciled with the repo's btrim trimming.
-- Kept from live: plpgsql, service_role-only gate, unexpired
-- profiles.pending_email in-use check, DEFAULT NULL on
-- p_exclude_user_id, search_path 'public' (body is schema-qualified:
-- auth.users / public.profiles, so 'public' is sufficient).
-- Added from the repo: btrim() on both sides of every email compare.
-- DROP + CREATE (not CREATE OR REPLACE): the existing function carries
-- a parameter default that CREATE OR REPLACE cannot remove (42P13).
drop function if exists public.email_in_use(text, uuid);

create function public.email_in_use(p_email text, p_exclude_user_id uuid default null::uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('role') != 'service_role' then
    raise exception 'Forbidden';
  end if;

  return exists (
    select 1 from auth.users
    where lower(btrim(email)) = lower(btrim(p_email))
      and (p_exclude_user_id is null or id != p_exclude_user_id)
  ) or exists (
    select 1 from public.profiles
    where lower(btrim(email)) = lower(btrim(p_email))
      and (p_exclude_user_id is null or id != p_exclude_user_id)
  ) or exists (
    select 1 from public.profiles
    where pending_email is not null
      and lower(btrim(pending_email)) = lower(btrim(p_email))
      and (p_exclude_user_id is null or id != p_exclude_user_id)
      and pending_email_expires > now()
  );
end;
$function$;

-- ── schedule_own_account_deletion (item 18, audit_04 verbatim) ───
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

  update public.profiles
  set account_status = 'pending_deletion',
      deletion_scheduled_at = v_when
  where id = v_uid;

  return v_when + interval '7 days';
end;
$function$;

-- ── cancel_own_account_deletion (item 18) ────────────────────────
drop function if exists public.cancel_own_account_deletion();
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

  update public.profiles
  set account_status = 'active',
      deletion_scheduled_at = null
  where id = v_uid
    and account_status = 'pending_deletion';

  v_cancelled := found;
  return v_cancelled;
end;
$function$;

-- ── reactivate_own_account (item 18) ─────────────────────────────
-- Auto-cancel-on-sign-in: a member who signs back in during the
-- deletion grace period (or after a self-deactivation) has changed
-- their mind, so flip them back to active. coppa_restricted is
-- deliberately untouched — only verifiable parental consent clears it.
drop function if exists public.reactivate_own_account();
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

  update public.profiles
  set account_status = 'active',
      deletion_scheduled_at = null,
      deactivated_at = null
  where id = v_uid
    and account_status in ('pending_deletion', 'deactivated');

  v_reactivated := found;
  return v_reactivated;
end;
$function$;

-- ── private.anonymize_user (item 18) ─────────────────────────────
-- Civic-tied accounts cannot be deleted (votes, bills, filings and
-- economy history reference them), so the purge anonymizes them in
-- place instead. Both email copies move to the deleted- address — the
-- auth.users copy is what frees the original address for
-- email_in_use / re-registration — and the login surface is closed:
-- identities and sessions are deleted and the user is banned, so the
-- old password cannot sign in against the anonymized row. Civic rows
-- themselves are kept intact; audit_log scrubbing stays with the
-- separate private.scrub_audit_for_user maintenance function.
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
      password_reset_attempts = null,
      pending_email = null,
      pending_email_token = null,
      pending_email_expires = null,
      pending_email_attempts = null,
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

-- ── private.purge_scheduled_deletions (item 18) ──────────────────
-- Nightly purge, one row at a time. A plain member is fully deleted
-- (auth.users row; the profile cascades or is removed with it). A
-- referenced member — civic history or any other FK — is anonymized
-- in place instead. Each user runs in its own subtransaction, so a
-- failure is reported for that user only and the batch continues.
drop function if exists private.purge_scheduled_deletions();
create or replace function private.purge_scheduled_deletions()
returns table (user_id uuid, action text, note text)
language plpgsql
security definer
set search_path to 'auth', 'public', 'private', 'pg_catalog'
as $function$
declare
  r record;
  v_action text;
  v_note text;
begin
  for r in
    select p.id from public.profiles p
    where p.deletion_scheduled_at is not null
      and p.deletion_scheduled_at <= now() - interval '7 days'
      and p.account_status in ('pending_deletion', 'coppa_restricted')
  loop
    v_action := null;
    v_note := null;
    begin
      delete from auth.users where id = r.id;
      v_action := 'deleted';
      v_note := 'auth.users row deleted';
    exception
      when foreign_key_violation then
        begin
          perform private.anonymize_user(r.id);
          v_action := 'anonymized';
          v_note := 'referenced by other rows; anonymized in place';
        exception when others then
          v_action := 'failed';
          v_note := 'anonymize failed: ' || sqlerrm;
        end;
      when others then
        v_action := 'failed';
        v_note := 'delete failed: ' || sqlerrm;
    end;
    user_id := r.id;
    action := v_action;
    note := v_note;
    return next;
  end loop;
  return;
end;
$function$;

-- ── profiles.profile_version + bump trigger (item 19) ────────────
alter table public.profiles
  add column if not exists profile_version integer not null default 0;

-- Bumped on every update, whatever the writer. The name sorts after
-- the guard trigger only by accident — the guard tolerates the +1
-- below, so the bump is safe in either trigger order.
create or replace function private.profiles_bump_version()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
begin
  new.profile_version := old.profile_version + 1;
  return new;
end;
$function$;

drop trigger if exists profiles_version_bump on public.profiles;
create trigger profiles_version_bump
  before update on public.profiles
  for each row execute function private.profiles_bump_version();

-- ── profiles_guard_columns: 20261027 copy + profile_version rule ─
-- The 20261027 text is the 20260910 guard plus the narrow owner-only
-- carve-out for active -> deactivated / pending_deletion. Only the
-- profile_version block at the end is new: clients may never set the
-- counter themselves — except for the +1 the bump trigger writes,
-- which must be tolerated whichever trigger fires first.
create or replace function private.profiles_guard_columns()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $function$
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
  -- self-service account lifecycle (strix finding 7, 2026-10-27): the row
  -- owner may move their own account into 'deactivated' (via
  -- deactivate_own_account) or 'pending_deletion' (via
  -- schedule_own_account_deletion). narrow carve-out: only the owner
  -- (v_is_self), only into deactivated / pending_deletion, only from
  -- active (or from deactivated into pending_deletion) -- frozen /
  -- terminated stay staff/server-only, and no transition out of
  -- deactivated / pending_deletion is allowed here. only account_status
  -- and its two timestamp companions may change in the same statement.
  if new.account_status          is distinct from old.account_status
  or new.deletion_scheduled_at   is distinct from old.deletion_scheduled_at
  or new.deactivated_at          is distinct from old.deactivated_at
  then
    if not (
      v_is_self
      and (
        (old.account_status = 'active'       and new.account_status = 'deactivated')
        or (old.account_status = 'active'       and new.account_status = 'pending_deletion')
        or (old.account_status = 'deactivated'  and new.account_status = 'pending_deletion')
      )
      and new.password_reset_token    is not distinct from old.password_reset_token
      and new.password_reset_expires  is not distinct from old.password_reset_expires
      and new.password_reset_attempts is not distinct from old.password_reset_attempts
      and new.pending_email           is not distinct from old.pending_email
      and new.pending_email_token     is not distinct from old.pending_email_token
      and new.pending_email_expires   is not distinct from old.pending_email_expires
      and new.pending_email_attempts  is not distinct from old.pending_email_attempts
      and new.role                    is not distinct from old.role
      and new.email_access_revoked    is not distinct from old.email_access_revoked
      and new.minecraft_uuid          is not distinct from old.minecraft_uuid
      and new.email                   is not distinct from old.email
      and new.email_unsub_token       is not distinct from old.email_unsub_token
    ) then
      raise exception 'profiles: that field can only be changed by the server';
    end if;
  end if;
  if new.password_reset_token    is distinct from old.password_reset_token
  or new.password_reset_expires  is distinct from old.password_reset_expires
  or new.password_reset_attempts is distinct from old.password_reset_attempts
  or new.pending_email           is distinct from old.pending_email
  or new.pending_email_token     is distinct from old.pending_email_token
  or new.pending_email_expires   is distinct from old.pending_email_expires
  or new.pending_email_attempts  is distinct from old.pending_email_attempts
  or new.role                    is distinct from old.role
  or new.email_access_revoked    is distinct from old.email_access_revoked
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
  if (new.mc_verify_code is distinct from old.mc_verify_code and new.mc_verify_code is not null)
  or (new.mc_verify_expires is distinct from old.mc_verify_expires and new.mc_verify_expires is not null)
  then
    raise exception 'profiles: set the minecraft verification code with set_mc_verify_code()';
  end if;
  if (new.mc_verify_code is distinct from old.mc_verify_code
      or new.mc_verify_expires is distinct from old.mc_verify_expires)
     and not (v_is_self or v_is_staff)
  then
    raise exception 'profiles: mc_verify_code can only be cleared by its owner or staff';
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
  -- profile_version (item 19): a server-maintained optimistic-concurrency
  -- counter, bumped by the profiles_version_bump trigger on every update.
  -- A client must never set it -- except for the trigger's own +1, which
  -- the guard has to tolerate regardless of which trigger fires first
  -- (bump-then-guard sees old+1; guard-then-bump sees it unchanged).
  -- Ported verbatim from the staged migration; everything above is the
  -- live trigger body as read from pg_proc on 2026-11-23 (live and TEST
  -- agree byte-for-byte). Deliberately NOT restored: the dropped
  -- get_my_role() admin/owner term in v_is_staff, the old mc_verify_code
  -- owner-set behaviour.
  if new.profile_version is distinct from old.profile_version
     and new.profile_version is distinct from old.profile_version + 1
  then
    raise exception 'profiles: profile_version can only be changed by the server';
  end if;
  return new;
end;
$function$;

-- ── Grants (README standing rule: nothing is reachable until granted) ─
revoke all on function public.email_in_use(text, uuid) from public;
revoke all on function public.schedule_own_account_deletion() from public;
revoke all on function public.cancel_own_account_deletion() from public;
revoke all on function public.reactivate_own_account() from public;
revoke all on function private.anonymize_user(uuid) from public;
revoke all on function private.purge_scheduled_deletions() from public;

-- email_in_use is called by the signup-with-email edge function with the
-- service-role key; the browser never calls it directly.
grant execute on function public.email_in_use(text, uuid) to service_role;
grant execute on function public.schedule_own_account_deletion() to authenticated;
grant execute on function public.cancel_own_account_deletion() to authenticated;
grant execute on function public.reactivate_own_account() to authenticated;
grant execute on function private.anonymize_user(uuid) to service_role;
grant execute on function private.purge_scheduled_deletions() to service_role;

-- profile_version is read by the signed-in account page (PROFILE_COLUMNS);
-- it is deliberately NOT in the UPDATE allowlist — the trigger owns it.
grant select (profile_version) on public.profiles to authenticated;

-- ── Nightly purge job (item 18) ──────────────────────────────────
-- Replaces the old raw-DELETE cron command (audit_07 rollback text) with
-- the per-user purge function. Keeps the existing schedule when the job
-- already exists; otherwise schedules daily ~03:00 UTC (purge-retention
-- already runs 03:30 UTC). Skipped entirely when pg_cron is not
-- installed on the project.
do $job$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-scheduled-deletions') then
      perform cron.alter_job(
        (select jobid from cron.job where jobname = 'purge-scheduled-deletions'),
        command := 'select private.purge_scheduled_deletions();'
      );
    else
      perform cron.schedule(
        'purge-scheduled-deletions',
        '0 3 * * *',
        'select private.purge_scheduled_deletions();'
      );
    end if;
  end if;
end;
$job$;
