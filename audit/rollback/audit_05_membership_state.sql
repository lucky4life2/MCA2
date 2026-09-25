-- Rollback for audit_05_membership_state (2026-09-24).
DROP FUNCTION IF EXISTS public.get_my_membership_state();
DROP FUNCTION IF EXISTS public.get_membership_state_for_minecraft(text);
DROP FUNCTION IF EXISTS public.admin_set_membership(uuid, boolean, text, timestamptz);

CREATE OR REPLACE FUNCTION public.user_meets_membership_gate()
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if public.user_has_permission('can_bypass_membership') then
    return true;
  end if;
  return exists (
    select 1 from public.profiles
    where id = auth.uid()
      and membership_status = 'active'
      and membership_current_period_end is not null
      and membership_current_period_end > now()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_membership(p_user_id uuid, p_grant boolean, p_note text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
begin
  if not public.user_has_permission('can_manage_memberships') then
    raise exception 'Not authorized to manage memberships';
  end if;
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  select coalesce(display_name, username, email) into v_actor_name from public.profiles where id = v_actor;
  if p_grant then
    update public.profiles
    set membership_status = 'active',
        membership_source = 'admin_grant',
        membership_current_period_end = now() + interval '100 years'
    where id = p_user_id;
    insert into public.audit_log (actor_id, actor_name, actor_type, action, table_name, record_id, summary, new_data)
    values (v_actor, v_actor_name, 'admin', 'membership_grant', 'profiles', p_user_id::text,
      'Granted complimentary membership' || case when p_note is not null and btrim(p_note) <> '' then ': ' || btrim(p_note) else '' end,
      jsonb_build_object('membership_status', 'active', 'membership_source', 'admin_grant'));
  else
    update public.profiles
    set membership_status = 'none', membership_source = null, membership_current_period_end = null
    where id = p_user_id;
    insert into public.audit_log (actor_id, actor_name, actor_type, action, table_name, record_id, summary, new_data)
    values (v_actor, v_actor_name, 'admin', 'membership_revoke', 'profiles', p_user_id::text,
      'Revoked membership' || case when p_note is not null and btrim(p_note) <> '' then ': ' || btrim(p_note) else '' end,
      jsonb_build_object('membership_status', 'none'));
  end if;
end;
$function$;
GRANT EXECUTE ON FUNCTION public.admin_set_membership(uuid, boolean, text) TO authenticated;
DROP FUNCTION IF EXISTS private.membership_state(uuid);
