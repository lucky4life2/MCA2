-- Rollback for audit_04_account_deletion_requires_aal2 (2026-09-24).
CREATE OR REPLACE FUNCTION public.schedule_own_account_deletion()
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_when timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT account_status INTO v_status FROM public.profiles WHERE id = v_uid;
  IF v_status = 'terminated' THEN
    RAISE EXCEPTION 'This account has already been terminated by an administrator.';
  END IF;

  UPDATE public.profiles
  SET account_status = 'pending_deletion',
      deletion_scheduled_at = v_when
  WHERE id = v_uid;

  RETURN v_when + interval '7 days';
END;
$function$;
