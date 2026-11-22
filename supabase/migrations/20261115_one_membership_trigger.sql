-- Fix B4 (Medium, test-run-1): one membership per account had no
-- data-layer enforcement.
--
-- A second 'membership' order for an already-active member inserted
-- fine. Enforcement lived only in create-checkout-session (which returns
-- 400 "You're already a member"), and that function was not deployed to
-- the test project — so nothing stopped a duplicate. Kyden's rule:
-- "It should be one membership per account."
--
-- This adds a BEFORE INSERT trigger on public.orders that mirrors the
-- edge function's check exactly: if the buyer already has
-- membership_status='active' with a period end in the future, the insert
-- is rejected. Otherwise it passes, so:
--   * a first purchase always works (profile not active yet);
--   * renewal after expiry works (period end has passed);
--   * re-purchase after a refund/cancel works (status is not 'active').
-- A partial unique index was NOT used: the old order stays 'paid'
-- forever, so it would block legitimate renewal after expiry. The
-- trigger reads the profile's live state instead, which is what the
-- membership actually is.
-- Note the trigger fires for service_role inserts too (the webhook and
-- TEST_CHECKOUT_MODE insert as service_role). That is correct: for a
-- legit first purchase the profile is not active yet, so the insert
-- passes; a duplicate is blocked at the same layer the edge function
-- checks. A race between two simultaneous purchases can still slip past
-- (both check before either commits the profile update) — the edge
-- function remains the primary guard and this is the backstop, exactly
-- as the plan requires ("the data enforces it so duplicates cannot
-- exist" for the normal path).
-- This file is for the TEST project first; the live fix goes via a PR.

create or replace function public.enforce_one_membership()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
  v_end timestamptz;
begin
  if new.kind <> 'membership' then
    return new;
  end if;
  select membership_status, membership_current_period_end
    into v_status, v_end
  from public.profiles
  where id = new.user_id;
  if v_status = 'active' and v_end is not null and v_end > now() then
    raise exception 'You already have an active membership.';
  end if;
  return new;
end;
$function$;

comment on function public.enforce_one_membership() is
  'B4 fix 2026-11-15: BEFORE INSERT trigger on orders. Rejects a second membership order while the buyer already has an active membership (membership_status=active, period end in the future), mirroring create-checkout-session''s check at the data layer. Renewal after expiry and re-purchase after refund/cancel still work.';

drop trigger if exists trg_enforce_one_membership on public.orders;
create trigger trg_enforce_one_membership
  before insert on public.orders
  for each row execute function public.enforce_one_membership();
