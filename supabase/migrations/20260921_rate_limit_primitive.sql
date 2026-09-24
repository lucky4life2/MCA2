-- Generic rate-limit primitive for write/auth-adjacent endpoints.
--
-- A fixed-window counter keyed by an arbitrary caller-chosen string (e.g.
-- 'checkout:<user_id>' or 'billing-portal:<user_id>'). Added so the Stripe
-- Edge Functions (create-checkout-session, create-billing-portal-session) —
-- both financial write endpoints with no throttling at all — have a shared,
-- reusable limiter instead of each hand-rolling one. Any future RPC that
-- needs to throttle a hot, abusable action (money movement, messaging,
-- form submission) can call the same function.
--
-- Not a fix for auth (signup/sign-in/OTP) rate limiting — those flows run in
-- Edge Functions deployed outside this repository and aren't reachable from
-- here; Supabase Auth's own built-in per-IP rate limits (Dashboard →
-- Authentication → Rate Limits) are the control for that surface.

create table if not exists public.rate_limits (
  rl_key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (rl_key, window_start)
);

comment on table public.rate_limits is
  'Fixed-window rate-limit counters written by check_rate_limit(). Rows older than a day are opportunistically pruned by the same function; nothing else reads or writes this table.';

create index if not exists rate_limits_window_start_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- No client-facing policies: this table is only ever touched through the
-- SECURITY DEFINER function below (or by service_role, which bypasses RLS),
-- never through a direct PostgREST select/insert/update/delete.

create or replace function public.check_rate_limit(p_key text, p_max_count integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_key is null or p_key = '' or p_max_count is null or p_max_count < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    -- Malformed call: fail closed rather than silently allowing everything.
    return false;
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits (rl_key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (rl_key, window_start)
  do update set count = rate_limits.count + 1
  returning count into v_count;

  -- Cheap, low-probability cleanup instead of a delete on every call, so a
  -- hot key doesn't pay for a table scan on each hit.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_max_count;
end;
$$;

comment on function public.check_rate_limit(text, integer, integer) is
  'Fixed-window limiter: records one hit for p_key and returns false once more than p_max_count hits have landed in the current p_window_seconds window. Callers should fail closed (treat a thrown error as "not allowed") on money-moving or auth-adjacent actions.';

-- Follows this schema''s standing rule (see supabase/migrations/README.md):
-- default privileges no longer grant EXECUTE automatically, so every new
-- function must be granted explicitly. service_role needs it for the Stripe
-- Edge Functions; authenticated is granted too so a future RPC can reuse it
-- without another migration.
grant execute on function public.check_rate_limit(text, integer, integer) to authenticated, service_role;
