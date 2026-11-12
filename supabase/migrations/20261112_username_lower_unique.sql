-- Audit fix (2026-11-12): account:username-case-variant-duplicate (LOW).
--
-- Until now profiles_username_key was a plain case-sensitive btree
-- on username, and the only duplicate check was the client-side
-- ilike lookup in the profile save flow — bypassable by a direct
-- PostgREST update of the caller's own row. Any member could
-- therefore take a case variant of another member's username
-- ('Kyden' vs 'kyden'), causing identity confusion in directory
-- listings, mentions, and admin views keyed by username string.
--
-- Fix, per the audit's remediation: a case-insensitive unique index
-- on lower(username). The existing exact-match index is kept — it is
-- harmless and remains the index the exact-match lookups use.
--
-- Live pre-check (2026-11-12, aggregate-only, no personal data):
-- zero case-variant duplicate groups among non-null usernames
-- (12 usernames, 12 distinct lower(username) values), so this index
-- creates cleanly. The 6 profiles with a NULL username are not
-- duplicates: PostgreSQL treats NULLs as distinct in a unique index,
-- so they do not block creation. The DO block below re-checks at
-- apply time and FAILS LOUDLY with a clear message if duplicates
-- have appeared since — it never silently skips the index.
--
-- Apply to live Supabase whenever; no client change is needed. If
-- the DO block raises, resolve the listed duplicate usernames by
-- hand first (rename the newer / inactive account's username), then
-- re-apply.
--
-- NOTE: usernames are nullable, and a unique index permits multiple
-- NULLs. That is existing behaviour (profiles without a username
-- yet) and is intentionally not changed here.

do $block$
declare
  v_dup_count int;
begin
  select count(*) into v_dup_count
  from (
    select lower(username) as u
    from public.profiles
    where username is not null
    group by lower(username)
    having count(*) > 1
  ) dups;
  if v_dup_count > 0 then
    raise exception 'account:username-case-variant-duplicate: % lower(username) value(s) are shared by more than one profile; rename the duplicate usernames before applying this migration (see the migration header)', v_dup_count;
  end if;
end;
$block$;

create unique index profiles_username_lower_key on public.profiles (lower(username));

comment on index public.profiles_username_lower_key is
  'Audit fix account:username-case-variant-duplicate: usernames are unique case-insensitively.';
