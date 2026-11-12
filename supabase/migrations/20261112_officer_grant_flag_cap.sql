-- Audit fix (2026-11-11): stocks:officer-rpcs:uncapped-grant-flags (HIGH).
--
-- economy_add_company_member (wrapper) forwards the caller's six
-- officer flags verbatim to _economy_add_company_member, whose only
-- gate was "caller can manage members for this company OR holds
-- can_manage_economy". A company officer holding only member management
-- could therefore call it on themselves (or anyone) with all six flags
-- true and walk away with full officer powers — issue shares, pay
-- dividends, manage funds — defeating the per-flag authority model for
-- that company. The add-officer UI passes the checkbox flags verbatim,
-- and nothing server-side compared a granted flag against the caller's
-- own flags.
--
-- Fix, per the audit's remediation: inside _economy_add_company_member,
-- when the caller lacks can_manage_economy, load the caller's own
-- member row for the company once and reject any requested flag that is
-- true while the caller's corresponding flag is false, before the
-- insert/upsert. That single cap closes self-grant and ally-grant alike.
-- An absent member row counts as holding nothing, so the check fails
-- closed. An econ admin (can_manage_economy) is exempt, exactly as the
-- existing gate already treats them.
--
-- The function body below is otherwise byte-identical to the live
-- definition (verified from pg_get_functiondef); only the declare block
-- gains v_me and the flag-cap block is added before the upsert. The
-- wrapper economy_add_company_member is unchanged. No client change is
-- needed: stocks.page.js already calls the wrapper RPC, and the RPC
-- error surfaces in the add-officer form.
--
-- No data change. Apply to live Supabase whenever; the cap only refuses
-- grants that were previously an escalation, and legit grants (flags the
-- caller already holds, or econ-admin grants) are unaffected.

create or replace function public._economy_add_company_member(
  p_actor uuid,
  p_company_id uuid,
  p_user_id uuid,
  p_role text,
  p_can_manage_profile boolean default false,
  p_can_manage_funds boolean default false,
  p_can_manage_members boolean default false,
  p_can_issue_shares boolean default false,
  p_can_pay_dividends boolean default false,
  p_can_publish_reports boolean default false
)
returns economy_company_members
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_member public.economy_company_members;
  v_me public.economy_company_members;
begin
  if not public.economy_company_can(p_company_id, p_actor, 'can_manage_members')
     and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'You do not have permission to manage this company''s officers';
  end if;
  if p_role not in ('officer','manager') then
    raise exception 'Officers may be added as officer or manager only';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'That user does not exist';
  end if;

  -- Flag cap (audit: stocks:officer-rpcs:uncapped-grant-flags).
  -- A caller without can_manage_economy may only grant an officer flag
  -- they already hold for this company. An absent member row counts as
  -- holding nothing, so the check fails closed.
  if not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    select * into v_me
    from public.economy_company_members
    where company_id = p_company_id and user_id = p_actor;

    if (coalesce(p_can_manage_profile, false)  and not coalesce(v_me.can_manage_profile, false))
      or (coalesce(p_can_manage_funds, false)    and not coalesce(v_me.can_manage_funds, false))
      or (coalesce(p_can_manage_members, false)  and not coalesce(v_me.can_manage_members, false))
      or (coalesce(p_can_issue_shares, false)    and not coalesce(v_me.can_issue_shares, false))
      or (coalesce(p_can_pay_dividends, false)   and not coalesce(v_me.can_pay_dividends, false))
      or (coalesce(p_can_publish_reports, false) and not coalesce(v_me.can_publish_reports, false))
    then
      raise exception 'You cannot grant an officer flag you do not hold';
    end if;
  end if;

  insert into public.economy_company_members (
    company_id, user_id, role,
    can_manage_profile, can_manage_funds, can_manage_members,
    can_issue_shares, can_pay_dividends, can_publish_reports, added_by
  ) values (
    p_company_id, p_user_id, p_role,
    coalesce(p_can_manage_profile,false), coalesce(p_can_manage_funds,false),
    coalesce(p_can_manage_members,false), coalesce(p_can_issue_shares,false),
    coalesce(p_can_pay_dividends,false), coalesce(p_can_publish_reports,false),
    p_actor
  )
  on conflict (company_id, user_id) do update set
    role                = excluded.role,
    can_manage_profile  = excluded.can_manage_profile,
    can_manage_funds    = excluded.can_manage_funds,
    can_manage_members  = excluded.can_manage_members,
    can_issue_shares    = excluded.can_issue_shares,
    can_pay_dividends   = excluded.can_pay_dividends,
    can_publish_reports = excluded.can_publish_reports
  returning * into v_member;

  perform public._economy_audit(
    p_actor, 'company_member_upsert', 'economy_company_members', v_member.id::text,
    format('Set %s as %s', p_user_id, p_role), to_jsonb(v_member)
  );
  return v_member;
end;
$function$;

comment on function public._economy_add_company_member(uuid, uuid, uuid, text, boolean, boolean, boolean, boolean, boolean, boolean) is
  'Audit fix stocks:officer-rpcs:uncapped-grant-flags: a caller without can_manage_economy may only grant officer flags they already hold for the company (self-grant and ally-grant alike). No grant change: this internal stays reachable to service_role only; the website calls the economy_add_company_member wrapper.';
