-- Rollback for audit_11_scrub_audit_summaries (2026-09-24): restore the audit_08 scrub.
CREATE OR REPLACE FUNCTION private.scrub_audit_for_user(p_uid uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$
  select set_config('mca.audit_maintenance', 'on', true);
  update public.audit_log set actor_id = null, actor_name = 'Deleted member' where actor_id = p_uid;
  update public.audit_log set old_data = null, new_data = null
   where table_name = 'profiles' and record_id = p_uid::text;
$$;
