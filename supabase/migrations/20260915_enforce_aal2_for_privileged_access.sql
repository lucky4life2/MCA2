-- Server-side companion to the client-side 2FA-bypass fix: a Supabase
-- session is valid (AAL1) as soon as the password step succeeds, before an
-- enrolled TOTP factor is verified. The client now blocks navigation to
-- privileged pages until AAL2 is satisfied, but nothing stopped a caller
-- from hitting the underlying RPCs/RLS-gated tables directly with only an
-- AAL1 session. This closes that gap at the single points every privileged
-- check already funnels through, instead of touching every RLS policy.

create or replace function private.aal2_ok()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select not exists (
    select 1 from auth.mfa_factors
    where user_id = auth.uid() and status = 'verified'
  )
  or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

comment on function private.aal2_ok() is
  'True unless the caller has an enrolled+verified MFA factor but the current session has not cleared AAL2 yet. Mirrors supabase.auth.mfa.getAuthenticatorAssuranceLevel() client-side.';

create or replace function private.get_my_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when private.aal2_ok() then
    coalesce(
      (select r.name from public.role_previews rp join public.roles r on r.id = rp.preview_role_id
       where rp.user_id = auth.uid() and rp.expires_at > now()),
      (select role from public.profiles where id = auth.uid())
    )
  else null end;
$function$;

create or replace function private.current_user_role_level()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when private.aal2_ok() then
    coalesce(
      (select r.level from public.role_previews rp join public.roles r on r.id = rp.preview_role_id
       where rp.user_id = auth.uid() and rp.expires_at > now()),
      (select coalesce(max(r.level), 0) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = auth.uid())
    )
  else 0 end;
$function$;

create or replace function public.user_has_permission(perm text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_preview_role_id uuid;
  v_result boolean;
begin
  if not private.aal2_ok() then
    return false;
  end if;

  SELECT preview_role_id INTO v_preview_role_id
  FROM public.role_previews
  WHERE user_id = auth.uid() AND expires_at > now();

  IF v_preview_role_id IS NOT NULL THEN
    SELECT COALESCE((r.permissions ->> perm)::boolean, false) INTO v_result
    FROM public.roles r WHERE r.id = v_preview_role_id;
    RETURN v_result;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND (r.permissions ->> perm)::boolean = true
  );
end;
$function$;

create or replace function private.user_has_config_permission()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select private.aal2_ok() and coalesce(
    (
      select (r.permissions ->> 'can_manage_config')::boolean
      from public.role_previews rp
      join public.roles r on r.id = rp.preview_role_id
      where rp.user_id = auth.uid() and rp.expires_at > now()
    ),
    (
      select exists (
        select 1 from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = auth.uid()
        and (r.permissions->>'can_manage_config')::boolean = true
      )
    ),
    false
  );
$function$;
