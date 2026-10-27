-- clear_user_email login-method guard (Strix finding 15, 2026-10-27).
--
-- NOT APPLIED — migration file only. Apply by hand in the Supabase
-- dashboard SQL editor after diffing against the live function.
--
-- Problem: clear_user_email() (called from account.html after an email
-- identity is unlinked) had no server-side guard, so a caller could end
-- up with no way back into the account.
--
-- Fix: refuse to clear when the caller has no verified Discord or Google
-- identity left. OAuth identities are provider-verified by definition:
-- Supabase only creates one after the provider authenticates the user.
-- The email identity itself does not count — the whole point is that the
-- email method is being removed, so at least one of Discord / Google must
-- remain.
--
-- SOURCE WARNING: the live clear_user_email() source is not in this repo,
-- so the clearing statements below reconstruct the observed behaviour
-- (called after unlinkIdentity(email); clears the email from auth.users
-- and from the caller's profiles row). Diff them against the live
-- function before applying: the guard block at the top is the normative
-- change, and it must be kept even if the clearing statements below need
-- adjusting to match live. Do NOT apply blindly if the live signature
-- differs (arguments, return type, or security definer/invoker setting).
-- This version is SECURITY DEFINER with a pinned search_path because it
-- writes auth.users, which the caller's own role cannot.

create or replace function public.clear_user_email()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $function$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'clear_user_email: not signed in';
  end if;

  -- At least one login method must remain: a verified Discord or Google
  -- identity. Without this, clearing the email locks the user out.
  if not exists (
    select 1
    from auth.identities
    where user_id = v_uid
      and provider in ('discord', 'google')
  ) then
    raise exception 'clear_user_email: at least one linked login method (Discord or Google) must remain';
  end if;

  -- Clearing itself (reconstructed — verify against live before applying).
  update auth.users
     set email = null
   where id = v_uid;

  update public.profiles
     set email = null
   where id = v_uid;
end;
$function$;

-- The function writes auth.users, so it must not stay executable by
-- anonymous callers; keep the same grants the live function already has.
-- (No grant change is made here on purpose: re-apply the live grants
-- after replacing the function if your workflow drops them.)
