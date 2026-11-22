-- Audit fix (2026-11-12): account:appeal-thread-no-decision-state (LOW).
--
-- Until now create_admin_message_thread required only a non-empty
-- subject and a non-empty body or attachments, and admin_messages had
-- no decision state at all. A frozen or terminated account could
-- therefore flood the staff inbox with unlimited appeal threads
-- (the 2000-character counter in the appeal form is display-only),
-- and staff had nowhere to record an outcome against an appeal —
-- the only frozen-account control is the per-member Unfreeze button,
-- with no thread link and no audit trail of the decision.
--
-- Fix, per the audit's remediation:
--   1. admin_messages gains a decision state: decision
--      ('pending' / 'approved' / 'denied', default 'pending'),
--      decided_by, decided_at, and a short decision_note, so every
--      appeal thread carries a recorded staff outcome. Existing
--      threads (and non-appeal contact threads) start as 'pending'.
--   2. create_admin_message_thread gains a server-side body-length
--      cap of 2000 characters (the length the UI already displays)
--      and a per-user open-appeal cap: a caller with >= 1 pending
--      appeal thread is rejected. The cap is scoped to appeal
--      subjects only ('Account Frozen Appeal' / 'Account Terminated
--      Appeal', the subjects the appeal form sends) so ordinary
--      contact-admin threads are unaffected. The open-appeal cap is
--      also the appeal rate limit: no second appeal can be opened
--      until staff decide the first one.
--   3. decide_admin_message_thread is a new staff-only RPC
--      (can_manage_users, the same permission as the Unfreeze
--      button) that records the outcome on the thread and writes an
--      'admin' message item into the thread, so the member can see
--      the decision in their own inbox. It refuses to re-decide a
--      thread that already has a decision, and refuses an empty
--      decision value.
--
-- No data change beyond the new columns defaulting existing threads
-- to 'pending'. Apply to live Supabase whenever; the appeal form
-- needs no client change — the RPC error surfaces in the form, and
-- the decision RPC is staff-side only (no admin.page.js wiring in
-- this migration; staff can call it until the UI lands).

-- ---------------------------------------------------------------------
-- 1. Decision state on admin_messages.
-- ---------------------------------------------------------------------

alter table public.admin_messages
  add column if not exists decision text not null default 'pending'
    check (decision in ('pending', 'approved', 'denied')),
  add column if not exists decided_by uuid,
  add column if not exists decided_at timestamp with time zone,
  add column if not exists decision_note text;

comment on column public.admin_messages.decision is
  'Audit fix account:appeal-thread-no-decision-state: staff decision on the thread (pending/approved/denied).';
comment on column public.admin_messages.decided_by is
  'Audit fix account:appeal-thread-no-decision-state: staff member who recorded the decision.';
comment on column public.admin_messages.decided_at is
  'Audit fix account:appeal-thread-no-decision-state: when the decision was recorded.';
comment on column public.admin_messages.decision_note is
  'Audit fix account:appeal-thread-no-decision-state: short staff note recorded with the decision.';

-- ---------------------------------------------------------------------
-- 2. create_admin_message_thread: body cap + open-appeal cap.
--    Body is otherwise byte-identical to the live definition
--    (verified from pg_get_functiondef).
-- ---------------------------------------------------------------------

create or replace function public.create_admin_message_thread(p_subject text, p_body text, p_attachments jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_is_appeal boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if coalesce(trim(p_subject), '') = '' then raise exception 'subject required'; end if;
  if coalesce(trim(p_body), '') = '' and coalesce(jsonb_array_length(p_attachments), 0) = 0 then
    raise exception 'body or attachment required';
  end if;

  -- Audit fix account:appeal-thread-no-decision-state: the
  -- 2000-character counter in the appeal form is display-only, so
  -- enforce the cap server-side.
  if coalesce(char_length(p_body), 0) > 2000 then
    raise exception 'message too long (max 2000 characters)';
  end if;

  -- Audit fix account:appeal-thread-no-decision-state: one open
  -- appeal per user. Scoped to the appeal subjects the appeal form
  -- sends, so ordinary contact-admin threads are not capped. This
  -- is also the appeal rate limit — a second appeal cannot be opened
  -- until staff decide the first one.
  v_is_appeal := p_subject in ('Account Frozen Appeal', 'Account Terminated Appeal');
  if v_is_appeal and exists (
    select 1 from public.admin_messages
    where user_id = auth.uid()
      and decision = 'pending'
      and subject in ('Account Frozen Appeal', 'Account Terminated Appeal')
  ) then
    raise exception 'an appeal is already open';
  end if;

  insert into admin_messages(user_id, subject) values (auth.uid(), p_subject) returning id into v_id;
  insert into admin_message_items(thread_id, sender_type, sender_id, body, attachments)
    values (v_id, 'user', auth.uid(), coalesce(p_body, ''), coalesce(p_attachments, '[]'::jsonb));
  return v_id;
end;
$function$;

comment on function public.create_admin_message_thread(text, text, jsonb) is
  'Audit fix account:appeal-thread-no-decision-state: body capped at 2000 characters; one open appeal thread per user (appeal subjects only).';

-- ---------------------------------------------------------------------
-- 3. Staff-only decision RPC.
-- ---------------------------------------------------------------------

create or replace function public.decide_admin_message_thread(p_thread_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_decision text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  -- Staff only: same permission as the account Unfreeze button.
  perform public.require_permission('can_manage_users');

  v_decision := lower(trim(coalesce(p_decision, '')));
  if v_decision not in ('approved', 'denied') then
    raise exception 'decision must be approved or denied';
  end if;
  if coalesce(char_length(p_note), 0) > 500 then
    raise exception 'decision note too long (max 500 characters)';
  end if;

  select user_id into v_user_id
  from public.admin_messages
  where id = p_thread_id
  for update;
  if v_user_id is null then
    raise exception 'thread not found';
  end if;

  -- A decided thread stays decided: re-deciding would rewrite the
  -- audit trail (decide once; a changed mind is a new thread/note).
  update public.admin_messages
  set decision = v_decision,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_thread_id and decision = 'pending';
  if not found then
    raise exception 'thread already has a decision';
  end if;

  -- Record the outcome in the thread itself, so the member sees it
  -- in their inbox alongside the staff reply.
  insert into public.admin_message_items
    (thread_id, sender_type, sender_id, body, attachments, read_by_user)
  values
    (p_thread_id, 'admin', auth.uid(),
     'Appeal decision: ' || v_decision ||
       case when nullif(trim(coalesce(p_note, '')), '') is not null
            then ' — ' || trim(p_note)
            else '' end,
     '[]'::jsonb, false);
end;
$function$;

comment on function public.decide_admin_message_thread(uuid, text, text) is
  'Audit fix account:appeal-thread-no-decision-state: staff-only (can_manage_users) decision on an admin message thread; records decision/decided_by/decided_at/decision_note and an admin message item. Re-deciding a decided thread is refused.';
