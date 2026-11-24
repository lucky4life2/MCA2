-- Follow-up to PR #85 (20261124_fix_anonymize_and_lifecycle_trigger.sql).
--
-- PR #85 fixed two of the three NOT NULL violations in
-- private.anonymize_user (password_reset_attempts / pending_email_attempts
-- NULL -> 0). The behavioral test then surfaced a THIRD one the audit
-- had missed: email_unsub_token is uuid NOT NULL DEFAULT
-- gen_random_uuid() on BOTH projects, so setting it to NULL raises
-- 23502 and anonymize_user still cannot succeed. The audit missed it
-- because the tool output redacted every line containing "token", so
-- the column's nullability was never actually seen — the two text
-- token columns (password_reset_token, pending_email_token) were
-- re-checked individually after the failure and ARE nullable, so this
-- is the last offender: the complete NOT NULL set among the columns
-- anonymize_user NULLs is now {password_reset_attempts,
-- pending_email_attempts, email_unsub_token}.
--
-- Fix: email_unsub_token = gen_random_uuid(). The column is a uuid
-- with that exact default, so a fresh random uuid preserves the
-- "unusable token" property — the old unsubscribe link dies because
-- the token value changes, and nobody holds the new value — while
-- matching the column's own default semantics. (A 'deleted-...' marker
-- is not an option: the column is uuid-typed and would reject it.)
--
-- This file restates the full anonymize_user body from PR #85 with
-- exactly that one value changed, so it applies cleanly wherever PR
-- #85's version is live (TEST now; live after the sequenced apply).
-- Body-only change again: CREATE OR REPLACE, no DROP, grants preserved
-- (service_role-only, unchanged).

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
      email_unsub_token = gen_random_uuid(),
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
