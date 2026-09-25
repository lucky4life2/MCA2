-- Rollback for audit_07_deletion_and_retention (2026-09-24).
-- Restores the original purge-scheduled-deletions command (captured from cron.job)
-- and removes the retention job and the new functions.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'purge-scheduled-deletions'),
  command := $cmd$
    DELETE FROM auth.users
    WHERE id IN (
      SELECT id FROM profiles
      WHERE deletion_scheduled_at IS NOT NULL
        AND deletion_scheduled_at <= now() - interval '7 days'
        AND account_status IN ('pending_deletion', 'coppa_restricted')
    );
  $cmd$);
SELECT cron.unschedule('purge-retention') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-retention');
DROP FUNCTION IF EXISTS private.purge_scheduled_deletions();
DROP FUNCTION IF EXISTS private.anonymize_user(uuid);
DROP FUNCTION IF EXISTS private.purge_retention();

-- audit_08_audit_log_maintenance_window: restore the unconditional immutability trigger.
CREATE OR REPLACE FUNCTION public.fn_audit_log_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'audit_log records are permanent and cannot be modified or deleted';
end;
$function$;
DROP FUNCTION IF EXISTS private.scrub_audit_for_user(uuid);
