-- MCA security audit (run-1, 2026-11-12) — LOW tasks.page.js:task_comments:write-authorization:client-only
-- and LOW tasks:comments:deleted-body-still-served
--
-- Live policy texts verified 2026-11-12 via pg_policies:
-- (a) The INSERT policy 'testers post comments' required only
--     author_id = auth.uid() plus a task permission, with no task or
--     project check — any task-permission holder could post comments into
--     tasks in restricted projects they cannot read (and into drafts).
--     Fix: the WITH CHECK now also requires the task to exist, not be a
--     draft, and be in a project the caller can view
--     (private.user_can_view_project — same helper the SELECT policy already
--     uses). The same project check is added to the UPDATE policy 'authors
--     edit own comments' (USING and WITH CHECK), for symmetry.
-- (b) Neither SELECT policy excluded soft-deleted rows: soft-delete was a
--     display flag only, and a plain select still served deleted bodies.
--     Fix: deleted_at IS NULL is added to both SELECT-granting policies —
--     'testers view comments' and 'staff manage comments' (FOR ALL, which
--     grants SELECT along with the other commands).
--
-- CORRECTION (mirror verification 2026-11-12): the deleted_at IS NULL
-- in the SELECT policy ALSO broke the soft-delete itself. Per the
-- Postgres docs (CREATE POLICY, Table 257), on UPDATE the SELECT/ALL
-- policy's USING is checked against BOTH the existing row AND the new
-- row — and expressions from different policy types combine with AND.
-- So a direct client UPDATE setting deleted_at = now() always fails
-- with 42501 "new row violates row-level security policy": the new row
-- no longer passes the SELECT policy, whatever the UPDATE policies say
-- (proven on a local Postgres 16 mirror: the update fails even with the
-- UPDATE policy reduced to USING/WITH CHECK (true)). Neither the author
-- nor a manager could delete a comment any more — a regression.
-- Fix: soft-delete goes through a SECURITY DEFINER function instead
-- (delete_task_comment below), which checks the same author-or-manager
-- rules as the UPDATE policies and then sets deleted_at bypassing RLS.
-- tasks.page.js calls the RPC; the direct update path is gone from the
-- client. Ordinary body edits still use the direct UPDATE policies
-- (they keep deleted_at NULL, so the SELECT policy still admits them).
--
-- No other client change is needed in tasks.page.js: the comment insert
-- already sends author_id = the caller's id, and the render placeholder
-- already hides deleted bodies on screen. Policy denials surface
-- through the existing error alerts.
--
-- Note on 'staff manage comments': adding deleted_at IS NULL to an ALL
-- policy's USING also governs UPDATE/DELETE for managers, so a manager can
-- no longer update or hard-delete an already-soft-deleted comment row.
-- No UI restores or hard-deletes comments (verified 2026-11-12), and
-- soft-delete is the terminal state, so nothing in the app loses a path.
-- Managers can still update/delete any not-yet-deleted comment, and can
-- soft-delete through delete_task_comment like anyone else.
--
-- APPLY: run once against live Supabase (migration workflow). Reversible by
-- restoring the previous policy texts (and dropping delete_task_comment).
drop policy if exists "testers post comments" on public.task_comments;
create policy "testers post comments" on public.task_comments for insert to public
  with check (
    (author_id = (select auth.uid()))
    and (user_has_permission('can_test_tasks') or user_has_permission('can_check_off_tasks'))
    and exists (select 1 from public.tasks t where t.id = task_comments.task_id and (t.is_draft = false) and private.user_can_view_project(t.project_id))
  );

drop policy if exists "authors edit own comments" on public.task_comments;
create policy "authors edit own comments" on public.task_comments for update to public
  using (
    (author_id = (select auth.uid()))
    and exists (select 1 from public.tasks t where t.id = task_comments.task_id and (t.is_draft = false) and private.user_can_view_project(t.project_id))
  )
  with check (
    (author_id = (select auth.uid()))
    and exists (select 1 from public.tasks t where t.id = task_comments.task_id and (t.is_draft = false) and private.user_can_view_project(t.project_id))
  );

drop policy if exists "testers view comments" on public.task_comments;
create policy "testers view comments" on public.task_comments for select to public
  using (
    (user_has_permission('can_test_tasks') or user_has_permission('can_check_off_tasks'))
    and private.user_can_view_project((select tasks.project_id from tasks where tasks.id = task_comments.task_id))
    and (deleted_at is null)
  );

drop policy if exists "staff manage comments" on public.task_comments;
create policy "staff manage comments" on public.task_comments as permissive for all to authenticated
  using (user_has_permission('can_manage_tasks') and (deleted_at is null));

-- Soft-delete RPC. A direct client UPDATE cannot set deleted_at any more:
-- the SELECT policy's deleted_at IS NULL is checked against the new row
-- too (Postgres docs, CREATE POLICY Table 257), so it always 42501s.
-- This SECURITY DEFINER function is the only soft-delete path. It mirrors
-- the UPDATE policies: the author may delete their own comment (task must
-- be live and viewable, as 'authors edit own comments' requires), and a
-- task manager may delete any comment (as 'staff manage comments' allows).
-- Returns true when a live comment was soft-deleted, false when the id
-- does not exist or is already deleted.
create or replace function public.delete_task_comment(p_comment_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_author uuid;
  v_task uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select author_id, task_id into v_author, v_task
  from public.task_comments
  where id = p_comment_id;

  if v_author is null then
    return false;
  end if;

  if auth.uid() = v_author then
    if not exists (
      select 1 from public.tasks t
      where t.id = v_task
        and t.is_draft = false
        and private.user_can_view_project(t.project_id)
    ) then
      raise exception 'not permitted';
    end if;
  elsif user_has_permission('can_manage_tasks') then
    -- Staff path (matches 'staff manage comments'): no project check.
    null;
  else
    raise exception 'not permitted';
  end if;

  update public.task_comments
  set deleted_at = now()
  where id = p_comment_id and deleted_at is null;
  return found;
end;
$function$;

revoke all on function public.delete_task_comment(uuid) from public;
grant execute on function public.delete_task_comment(uuid) to authenticated, service_role;
