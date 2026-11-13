-- VER-M3 website half (2026-11-12): the account page's "Unlink Username"
-- button cleared minecraft_username + verified flags with a direct
-- PostgREST update but left minecraft_uuid / minecraft_bedrock_uuid on
-- the profile. A stale UUID stays linked to the old account, so a second
-- account claiming the same name and verifying ends up holding the same
-- UUID — the join gate then picks one arbitrarily (and an expired member
-- can ride on another account's active membership).
--
-- A direct update cannot clear the UUIDs: there is no UPDATE grant on
-- minecraft_uuid / minecraft_bedrock_uuid for authenticated, and
-- private.profiles_guard_columns() rejects any client-path change to
-- minecraft_uuid outright ("that field can only be changed by the
-- server") — deliberately, because the UUID is the join-gate identity
-- and a client that could write it could claim any other member's UUID.
-- So unlinking goes through this SECURITY DEFINER RPC, mirroring
-- set_mc_verify_code(): it runs as the function owner, only ever NULLs
-- the link fields on the caller's OWN row, and can never set an
-- arbitrary UUID. account.page.js calls it instead of the direct update.
--
-- The RPC also clears the verify code + expiry (mirrors the VER-M5
-- /mcaunverify fix): without that, the old code stays live for its
-- 10-minute window and could re-verify the just-unlinked account.
-- And it clears the verified flags too: the old direct update set
-- minecraft_verified false, but profiles_guard_columns() only lets
-- staff change that flag, so the button was silently failing on it as
-- well for non-staff owners (same for minecraft_bedrock_verified,
-- which has no UPDATE grant at all).
--
-- Apply to live Supabase BEFORE the new account.page.js serves traffic:
-- the new page calls this RPC, which does not exist until this
-- migration lands. The old page's direct update keeps working (or
-- failing as before) until then.

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

  -- Only ever nulls the link fields, only on the caller's own row.
  -- It can never set a username, a verified flag, or a UUID — so there
  -- is no path here to claim someone else's link.
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
end;
$function$;

comment on function public.unlink_minecraft() is
  'VER-M3 website half: the only supported way for the website to unlink a Minecraft account. Nulls both usernames, both verified flags, both UUIDs, and the verify code + expiry on the caller''s own row only. SECURITY DEFINER because the UUID columns have no client UPDATE grant and profiles_guard_columns() rejects client-path UUID writes.';

revoke all on function public.unlink_minecraft() from public;
grant execute on function public.unlink_minecraft() to authenticated;
