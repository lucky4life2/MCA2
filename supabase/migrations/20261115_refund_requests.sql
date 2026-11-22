-- Fix B5 (Medium, test-run-1): refund windows were policy only.
--
-- The refund policy (refund.html) promises 7 days for membership and
-- 14 days for merchandise, but no refund logic existed anywhere: no
-- function, no endpoint, no table. Refunds were manual via the Stripe
-- dashboard with nothing recording the request or checking the window.
--
-- Minimal version (SQL only, no Stripe money movement — see below):
--   * public.refund_requests — one row per request: the order, the
--     requester, the reason, the status (pending/approved/denied), the
--     staff resolver + note + timestamp. RLS: a member sees only their
--     own requests; staff with can_manage_memberships see all.
--   * public.request_refund(p_order_id, p_reason) — SECURITY DEFINER RPC
--     for the buyer. It checks the order exists, belongs to the caller,
--     and is status='paid'; then checks the window from the order's
--     created_at (membership 7 days, goods 14 days — the goods window is
--     measured from purchase here because the site does not record a
--     delivery date; the policy's "14 days of delivery" is approximated
--     by purchase date and staff can allow a late request manually);
--     rejects outside the window or a duplicate pending request; then
--     records the request as 'pending' and returns its id.
--   * public.resolve_refund_request(p_request_id, p_approve, p_note) —
--     staff-only RPC (can_manage_memberships). Records the decision.
--     It deliberately does NOT move money or change the order status:
--     the actual Stripe refund stays manual via the Stripe dashboard
--     (current practice), and the audit deliberately does not automate
--     membership revocation on refund — the owner decides. Once staff
--     refund in Stripe, the webhook's charge.refunded handler marks the
--     order 'refunded' (that handler does not exist on this branch yet;
--     it arrived in PR #57 on main — a refresh will bring it).
--
-- What this delivers: an endpoint that tests inside-vs-outside the
-- window (the exact gap the test run flagged), plus an auditable
-- request trail. What it does NOT do: issue the Stripe refund itself,
-- revoke membership, or restock goods — those stay staff actions.
-- This file is for the TEST project first; the live fix goes via a PR.

create table if not exists public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
comment on table public.refund_requests is
  'B5 fix 2026-11-15: member refund requests. The request records the window check; the Stripe refund itself stays manual via the dashboard (current practice) and membership revocation stays an owner decision per the audit.';

alter table public.refund_requests enable row level security;

drop policy if exists refund_requests_select_own on public.refund_requests;
create policy refund_requests_select_own on public.refund_requests
  for select to authenticated
  using (user_id = auth.uid() or public.user_has_permission('can_manage_memberships'));

drop policy if exists refund_requests_insert_own on public.refund_requests;
create policy refund_requests_insert_own on public.refund_requests
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists refund_requests_update_staff on public.refund_requests;
create policy refund_requests_update_staff on public.refund_requests
  for update to authenticated
  using (public.user_has_permission('can_manage_memberships'))
  with check (public.user_has_permission('can_manage_memberships'));

create or replace function public.request_refund(p_order_id uuid, p_reason text default '')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_order record;
  v_window interval;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_order_id is null then
    raise exception 'Missing order id';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if v_order is null then
    raise exception 'Order not found';
  end if;
  if v_order.user_id <> v_uid then
    raise exception 'That order is not yours';
  end if;
  if v_order.status <> 'paid' then
    raise exception 'Only a paid order can be refunded';
  end if;

  -- Refund windows (refund.html): membership 7 days, merchandise 14
  -- days. Goods are measured from purchase — the site records no
  -- delivery date, so the purchase date is the conservative proxy.
  v_window := case when v_order.kind = 'membership' then interval '7 days'
                   else interval '14 days' end;
  if v_order.created_at + v_window < now() then
    raise exception 'That order is outside the refund window (% days for %).',
      case when v_order.kind = 'membership' then 7 else 14 end, v_order.kind;
  end if;

  select id into v_existing from public.refund_requests
  where order_id = p_order_id and status = 'pending' limit 1;
  if v_existing is not null then
    raise exception 'A refund is already requested for that order';
  end if;

  insert into public.refund_requests (order_id, user_id, reason)
  values (p_order_id, v_uid, coalesce(nullif(btrim(p_reason), ''), ''));
  -- return the new request id
  select id into v_existing from public.refund_requests
  where order_id = p_order_id and user_id = v_uid and status = 'pending'
  order by created_at desc limit 1;
  return v_existing;
end;
$function$;

create or replace function public.resolve_refund_request(p_request_id uuid, p_approve boolean, p_note text default '')
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.user_has_permission('can_manage_memberships') then
    raise exception 'Permission denied: can_manage_memberships required';
  end if;
  select status into v_status from public.refund_requests where id = p_request_id;
  if v_status is null then
    raise exception 'Refund request not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'That refund request is already resolved';
  end if;
  update public.refund_requests
  set status = case when p_approve then 'approved' else 'denied' end,
      resolved_by = v_uid,
      resolution_note = coalesce(nullif(btrim(p_note), ''), ''),
      resolved_at = now()
  where id = p_request_id;
end;
$function$;

comment on function public.request_refund(uuid, text) is
  'B5 fix 2026-11-15: buyer requests a refund for a paid order. Enforces the refund window (membership 7 days, goods 14 days from purchase) and records a pending refund_requests row. Does not move money — staff refund in Stripe manually, then the webhook marks the order refunded.';
comment on function public.resolve_refund_request(uuid, boolean, text) is
  'B5 fix 2026-11-15: staff (can_manage_memberships) approve/deny a pending refund request. Records the decision only; does not move money or change the order — the Stripe refund and any membership decision stay manual.';

revoke all on function public.request_refund(uuid, text) from public;
grant execute on function public.request_refund(uuid, text) to authenticated;
revoke all on function public.resolve_refund_request(uuid, boolean, text) from public;
grant execute on function public.resolve_refund_request(uuid, boolean, text) to authenticated;
