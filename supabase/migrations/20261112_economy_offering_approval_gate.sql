-- MCA security audit (run-1, 2026-11-12) — MEDIUM stocks:pending-company-offering-raise-before-approval
--
-- A company is founded with approval_status = 'pending' and the founding
-- promise is "until it is approved the company is not listed, cannot raise
-- Marks and cannot trade" — but no step of the offering chain checked
-- approval_status. A pending founder (who holds can_issue_shares from
-- founding) plus one econ-admin offering approval could sell shares to
-- outside buyers, with proceeds landing in the company account.
--
-- Fix: require approval_status = 'approved' in _economy_create_offering
-- (the cheapest single choke point), plus the same check in
-- _economy_review_offering (approval path only — sending an offering back
-- to draft must stay possible for a pending company) and in
-- _economy_buy_offering_shares as defence in depth. Each function body is
-- otherwise the live body verbatim.
--
-- APPLY: run once against live Supabase (migration workflow). The client
-- half (surface approval_status in the admin offering-review panel) is in
-- stocks.page.js.
create or replace function public._economy_create_offering(p_actor uuid, p_company_id uuid, p_share_count integer, p_price numeric, p_funding_goal numeric, p_opens_at timestamp with time zone, p_closes_at timestamp with time zone, p_lockup_days integer, p_risk_disclosure text, p_use_of_funds text, p_dilution_note text default null::text)
 returns economy_offerings
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_company  public.economy_companies;
  v_offering public.economy_offerings;
  v_new_issue boolean;
  v_uncommitted integer;
begin
  if not public.economy_company_can(p_company_id, p_actor, 'can_issue_shares')
     and not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'You do not have permission to raise capital for this company';
  end if;

  select * into v_company from public.economy_companies where id = p_company_id;
  if v_company is null then raise exception 'Company not found'; end if;
  if v_company.status in ('suspended','dissolved') then
    raise exception 'A % company cannot open an offering', v_company.status;
  end if;

  -- Audit fix (stocks:pending-company-offering-raise-before-approval):
  -- a pending company must not raise Marks until it is approved.
  if v_company.approval_status is distinct from 'approved' then
    raise exception 'Company not approved — it cannot raise Marks until it is approved';
  end if;

  if p_share_count is null or p_share_count <= 0 then raise exception 'Offer at least one share'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Offering price must be positive'; end if;
  if p_risk_disclosure is null or btrim(p_risk_disclosure) = '' then
    raise exception 'A risk disclosure is required before shares can be offered';
  end if;

  -- Authorized shares are a hard ceiling: already-issued shares plus every
  -- share still committed to an open or pending offering.
  select coalesce(sum(o.share_count - o.shares_sold), 0) into v_uncommitted
  from public.economy_offerings o
  where o.company_id = p_company_id and o.status in ('pending','open');

  if v_company.shares_issued + v_uncommitted + p_share_count > v_company.total_shares then
    raise exception 'Only % of % authorized shares remain unissued and uncommitted',
      v_company.total_shares - v_company.shares_issued - v_uncommitted, v_company.total_shares;
  end if;

  -- Anything after the founding round dilutes existing holders and has to say so.
  v_new_issue := v_company.shares_issued > 0;
  if v_new_issue and (p_dilution_note is null or btrim(p_dilution_note) = '') then
    raise exception 'Issuing new shares dilutes existing shareholders — a dilution disclosure is required';
  end if;

  insert into public.economy_offerings (
    company_id, share_count, price, percent_of_company, funding_goal,
    opens_at, closes_at, lockup_days, risk_disclosure, use_of_funds,
    status, is_new_issuance, dilution_note, created_by
  ) values (
    p_company_id, p_share_count, p_price,
    round((p_share_count::numeric / v_company.total_shares) * 100, 4),
    p_funding_goal, p_opens_at, p_closes_at,
    coalesce(p_lockup_days, 30), btrim(p_risk_disclosure), p_use_of_funds,
    'draft', v_new_issue, nullif(btrim(coalesce(p_dilution_note,'')), ''), p_actor
  ) returning * into v_offering;

  perform public._economy_audit(
    p_actor, 'offering_create', 'economy_offerings', v_offering.id::text,
    format('Drafted offering of %s shares at %s', p_share_count, p_price), to_jsonb(v_offering)
  );
  return v_offering;
end;
$function$;

create or replace function public._economy_review_offering(p_actor uuid, p_offering_id uuid, p_approve boolean, p_note text default null::text)
 returns economy_offerings
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offering public.economy_offerings;
  v_approval text;
begin
  if not public._economy_actor_has_permission(p_actor, 'can_manage_economy') then
    raise exception 'Only an economy admin can review an offering';
  end if;

  select * into v_offering from public.economy_offerings where id = p_offering_id for update;
  if v_offering is null then raise exception 'Offering not found'; end if;
  if v_offering.status <> 'pending' then raise exception 'This offering is not awaiting review'; end if;

  -- Audit fix (stocks:pending-company-offering-raise-before-approval),
  -- defence in depth on the approval path only: rejecting (sending back to
  -- draft) must stay possible for a pending company's offering.
  if p_approve then
    select approval_status into v_approval from public.economy_companies where id = v_offering.company_id;
    if v_approval is distinct from 'approved' then
      raise exception 'Company not approved — its offering cannot be opened';
    end if;
  end if;

  update public.economy_offerings
  set status = case when p_approve then 'open' else 'draft' end,
      approved_by = p_actor, approved_at = now(), review_note = p_note
  where id = p_offering_id returning * into v_offering;

  -- Approving an offering opens it. It does NOT move a single Mark: the
  -- company is paid per purchase, in _economy_buy_offering_shares.
  perform public._economy_audit(
    p_actor, case when p_approve then 'offering_approve' else 'offering_reject' end,
    'economy_offerings', p_offering_id::text,
    coalesce(p_note, case when p_approve then 'Offering approved' else 'Offering sent back' end), null
  );
  return v_offering;
end;
$function$;

create or replace function public._economy_buy_offering_shares(p_actor uuid, p_account_id uuid, p_offering_id uuid, p_shares integer, p_client_token uuid default null::uuid)
 returns economy_offering_purchases
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offering  public.economy_offerings;
  v_company   public.economy_companies;
  v_buyer     public.economy_accounts;
  v_existing  public.economy_offering_purchases;
  v_purchase  public.economy_offering_purchases;
  v_cost      numeric(18,2);
  v_available integer;
begin
  if p_client_token is not null then
    select * into v_existing from public.economy_offering_purchases where client_token = p_client_token;
    if found then return v_existing; end if;
  end if;

  if p_shares is null or p_shares <= 0 then raise exception 'Buy at least one whole share'; end if;

  if not exists (select 1 from public.economy_account_members m
                 where m.account_id = p_account_id and m.user_id = p_actor) then
    raise exception 'You do not have access to this account';
  end if;

  select * into v_offering from public.economy_offerings where id = p_offering_id for update;
  if v_offering is null then raise exception 'Offering not found'; end if;
  if v_offering.status <> 'open' then raise exception 'This offering is not open'; end if;
  if v_offering.opens_at is not null and now() < v_offering.opens_at then
    raise exception 'This offering has not opened yet';
  end if;
  if v_offering.closes_at is not null and now() > v_offering.closes_at then
    raise exception 'This offering has closed';
  end if;

  select * into v_company from public.economy_companies where id = v_offering.company_id for update;
  if v_company.status in ('suspended','dissolved') then
    raise exception 'This company is % — its offering cannot be bought', v_company.status;
  end if;

  -- Audit fix (stocks:pending-company-offering-raise-before-approval),
  -- defence in depth: even an already-open offering cannot sell shares
  -- while its company is not approved.
  if v_company.approval_status is distinct from 'approved' then
    raise exception 'Company not approved — its offering cannot be bought';
  end if;

  if p_account_id = v_company.account_id or p_account_id = v_company.treasury_account_id then
    raise exception 'A company cannot buy its own offering';
  end if;

  v_available := v_offering.share_count - v_offering.shares_sold;
  if p_shares > v_available then
    raise exception 'Only % shares remain in this offering', v_available;
  end if;

  v_cost := v_offering.price * p_shares;

  select * into v_buyer from public.economy_accounts where id = p_account_id for update;
  if v_buyer.closed_at is not null then raise exception 'That wallet is closed'; end if;
  if v_buyer.is_frozen then raise exception 'Account is frozen'; end if;
  if v_buyer.balance < v_cost then
    raise exception 'This costs % Marks but the wallet only has % available', v_cost, v_buyer.balance;
  end if;

  update public.economy_accounts set balance = balance - v_cost where id = p_account_id;
  update public.economy_accounts set balance = balance + v_cost where id = v_company.account_id;

  insert into public.economy_shareholdings (company_id, account_id, shares)
  values (v_company.id, p_account_id, p_shares)
  on conflict (company_id, account_id)
    do update set shares = economy_shareholdings.shares + excluded.shares;

  update public.economy_companies
  set shares_issued = shares_issued + p_shares
  where id = v_company.id;

  update public.economy_offerings
  set shares_sold = shares_sold + p_shares,
      proceeds    = proceeds + v_cost,
      status      = case when shares_sold + p_shares >= share_count then 'closed' else status end,
      closed_at   = case when shares_sold + p_shares >= share_count then now() else closed_at end
  where id = p_offering_id;

  -- Shares are now in outside hands, so the company is tradeable. This
  -- lives here, at the moment of issuance, precisely because the offering
  -- may close on this same statement without anyone ever calling
  -- _economy_close_offering.
  if v_company.status = 'private' then
    update public.economy_companies set status = 'public' where id = v_company.id;
  end if;

  insert into public.economy_transactions
    (from_account_id, to_account_id, amount, type, category, memo, created_by)
  values (p_account_id, v_company.account_id, v_cost, 'offering_purchase', 'capital_raise',
          format('%s shares of %s at %s (primary offering)', p_shares, v_company.ticker, v_offering.price),
          p_actor);

  insert into public.economy_offering_purchases
    (offering_id, company_id, account_id, shares, price_per_share, total,
     lockup_until, client_token, created_by)
  values (p_offering_id, v_company.id, p_account_id, p_shares, v_offering.price, v_cost,
          now() + make_interval(days => v_offering.lockup_days), p_client_token, p_actor)
  returning * into v_purchase;

  -- Deliberately does NOT touch last_trade_price. An offering price is a
  -- reference price, not a trade, and must never masquerade as one.
  return v_purchase;
end;
$function$;
