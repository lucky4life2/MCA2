-- MCA security audit (run-1, 2026-11-12) — MEDIUM tasks.page.js:checkoff:lifecycle-role-separation:rpc-only-task-id
--
-- Live bodies verified 2026-11-12 via pg_proc: submit_task_for_checkoff,
-- check_off_task, and uncheck_task (all SECURITY DEFINER) gated only on the
-- caller's role and never checked task existence, project access, draft
-- status, submission state, or submitter identity. Any task-permission
-- holder could submit / check off any task id, including tasks in restricted
-- projects they cannot view and draft tasks, and could check off a task they
-- submitted themselves.
--
-- Fix: each RPC now loads the task and enforces the lifecycle —
--   * the task must exist;
--   * draft tasks are excluded from all three transitions;
--   * the caller must be able to view the task's project
--     (private.user_can_view_project — same helper the task_comments SELECT
--     policy already uses);
--   * check-off / uncheck require the task's current tag to be a checkoff
--     tag (task_tags.is_checkoff), i.e. the task was actually submitted;
--   * submit records submitted_by = auth.uid(), and check-off rejects when
--     submitted_by = auth.uid() unless the caller is admin / owner.
-- The role gates and the checkoff-tag lookup (lowest sort_order among
-- is_checkoff tags) are unchanged. submitted_by is a new nullable column;
-- pre-migration rows have submitted_by NULL, so the self-check-off guard
-- does not fire for them (NULL = auth.uid() is not true).
--
-- Known edge: uncheck now requires the checkoff tag, so a task that was
-- checked off and then had its tag moved elsewhere by a manager can no
-- longer be unchecked directly — the manager must move the tag back to a
-- checkoff tag (or re-submit) first. That is the intended state guard.
--
-- APPLY: run once against live Supabase (migration workflow). Reversible by
-- re-applying the previous RPC bodies and dropping the column.
alter table public.tasks add column if not exists submitted_by uuid;

create or replace function public.submit_task_for_checkoff(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_checkoff_tag_id uuid;
  v_task public.tasks%rowtype;
begin
  if not (
    user_has_permission('can_test_tasks')
    or user_has_permission('can_check_off_tasks')
    or user_has_permission('can_manage_tasks')
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','owner'))
  ) then
    raise exception 'not permitted';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'task not found';
  end if;
  if v_task.is_draft then
    raise exception 'draft tasks cannot be submitted for check-off';
  end if;
  if not private.user_can_view_project(v_task.project_id) then
    raise exception 'not authorized';
  end if;

  -- Multiple tags can now be marked is_checkoff = true. Pick the same one
  -- deterministically (lowest sort_order) instead of an arbitrary row.
  select id into v_checkoff_tag_id from public.task_tags where is_checkoff = true order by sort_order asc, id asc limit 1;
  if v_checkoff_tag_id is null then
    raise exception 'No tag is marked as the check-off status. Set one in Manage Tags first.';
  end if;

  update public.tasks
  set tag_id = v_checkoff_tag_id,
      submitted_by = auth.uid(),
      checked_off_by = null,
      checked_off_at = null,
      updated_at = now()
  where id = p_task_id;
end;
$function$;

create or replace function public.check_off_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_task public.tasks%rowtype;
begin
  if not (
    user_has_permission('can_check_off_tasks')
    or user_has_permission('can_manage_tasks')
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','owner'))
  ) then
    raise exception 'not permitted';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'task not found';
  end if;
  if v_task.is_draft then
    raise exception 'draft tasks cannot be checked off';
  end if;
  if not private.user_can_view_project(v_task.project_id) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.task_tags t where t.id = v_task.tag_id and t.is_checkoff) then
    raise exception 'task has not been submitted for check-off';
  end if;
  if v_task.submitted_by = auth.uid()
     and not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','owner')) then
    raise exception 'cannot check off a task you submitted';
  end if;

  update public.tasks
  set checked_off_by = auth.uid(),
      checked_off_at = now(),
      updated_at = now()
  where id = p_task_id;
end;
$function$;

create or replace function public.uncheck_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_task public.tasks%rowtype;
begin
  if not (
    user_has_permission('can_check_off_tasks')
    or user_has_permission('can_manage_tasks')
    or exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','owner'))
  ) then
    raise exception 'not permitted';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'task not found';
  end if;
  if v_task.is_draft then
    raise exception 'draft tasks cannot be unchecked';
  end if;
  if not private.user_can_view_project(v_task.project_id) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.task_tags t where t.id = v_task.tag_id and t.is_checkoff) then
    raise exception 'task has not been submitted for check-off';
  end if;

  update public.tasks
  set checked_off_by = null,
      checked_off_at = null,
      updated_at = now()
  where id = p_task_id;
end;
$function$;
