-- Supabase is retiring the implicit "new table -> auto-granted to anon/
-- authenticated/service_role" behavior that currently powers the Data API
-- (enforced on all projects, including this one, starting 2026-10-30).
-- This migration does not change any live behavior: every GRANT below
-- restates a privilege that is already in effect (verified against
-- information_schema.role_table_grants / column_privileges /
-- role_usage_grants before writing this file), so the site keeps working
-- exactly as it does today. Its only purpose is to make those grants
-- explicit so nothing is silently revoked once Supabase stops relying on
-- the implicit default.

-- Schema + sequence access (already granted; restated for explicitness)
grant usage on schema public to anon, authenticated, service_role;
grant usage on all sequences in schema public to anon, authenticated, service_role;

-- service_role already has full access to every table in this schema
grant select, insert, update, delete, references, trigger, truncate
on all tables in schema public
to service_role;

-- Tables where anon + authenticated already have full CRUD-and-friends
-- access at the table level (actual row-level restriction comes from RLS).
grant select, insert, update, delete, references, trigger, truncate
on table
  public.admin_message_items,
  public.admin_messages,
  public.archive_documents,
  public.club_presidents,
  public.congress_amendments,
  public.congress_attachments,
  public.congress_calendar_events,
  public.congress_chambers,
  public.congress_committee_members,
  public.congress_committee_reports,
  public.congress_committees,
  public.congress_debate_posts,
  public.congress_lookups,
  public.congress_measure_sponsors,
  public.congress_measure_versions,
  public.congress_measures,
  public.congress_members,
  public.congress_motions,
  public.congress_notifications,
  public.congress_returns,
  public.congress_roll_call_eligibility,
  public.congress_roll_calls,
  public.congress_votes,
  public.court_arguments,
  public.court_attachments,
  public.court_calendar_events,
  public.court_case_parties,
  public.court_case_recusals,
  public.court_cases,
  public.court_filings,
  public.court_justices,
  public.court_lookups,
  public.court_motions,
  public.court_notifications,
  public.court_opinions,
  public.court_roll_call_eligibility,
  public.court_roll_calls,
  public.court_votes,
  public.economy_account_members,
  public.economy_accounts,
  public.economy_companies,
  public.economy_company_members,
  public.economy_company_reports,
  public.economy_company_votes,
  public.economy_conflict_disclosures,
  public.economy_currency_issuance,
  public.economy_daily_ohlc,
  public.economy_dividend_payments,
  public.economy_dividends,
  public.economy_exchange_settings,
  public.economy_offering_purchases,
  public.economy_offerings,
  public.economy_orders,
  public.economy_share_transactions,
  public.economy_shareholdings,
  public.economy_shops,
  public.economy_trade_flags,
  public.economy_trades,
  public.economy_transactions,
  public.economy_vote_ballots,
  public.faqs,
  public.history_servers,
  public.leadership,
  public.minor_consent,
  public.nation_owners,
  public.nations,
  public.news_articles,
  public.orders,
  public.products,
  public.role_previews,
  public.roles,
  public.settings,
  public.task_assignees,
  public.task_comments,
  public.task_project_access,
  public.task_projects,
  public.task_tags,
  public.tasks,
  public.user_roles
to anon, authenticated;

-- audit_log: append-only, no UPDATE/DELETE/INSERT/TRUNCATE grant to
-- client-facing roles (rows are written by SECURITY DEFINER functions,
-- not directly by anon/authenticated).
grant references, select, trigger
on table public.audit_log
to anon, authenticated;

-- minor_consent_events: append-only consent ledger, service_role writes
-- only; authenticated may read, anon has no access at all.
grant select
on table public.minor_consent_events
to authenticated;

-- profiles_public: members-visible directory, read-only for anon + authenticated.
grant select
on table public.profiles_public
to anon, authenticated;

-- public_profiles: read-only, signed-in members only (no anon).
grant select
on table public.public_profiles
to authenticated;

-- system_lockdown: read-only status flag, visible to anon + authenticated.
grant select
on table public.system_lockdown
to anon, authenticated;

-- profiles: table-wide grants exclude SELECT/UPDATE (those are
-- column-scoped allowlists below, per the 2026-09-10 shop/membership
-- hardening migrations) but do include the rest of the surface anon/
-- authenticated already had table-wide.
grant insert, references, delete, trigger, truncate
on table public.profiles
to anon, authenticated;

-- Column-level SELECT allowlist for anon (matches live grants: does not
-- include age_band, membership_*, public_listing_opt_in).
grant select (
  account_status, created_at, deactivated_at, deletion_scheduled_at,
  discord_id, display_name, email, email_access_revoked, google_id, id,
  minecraft_username, minecraft_uuid, minecraft_verified,
  news_email_opt_in, role, task_email_opt_in, username
)
on public.profiles
to anon;

-- Column-level SELECT allowlist for authenticated (broader than anon:
-- includes age_band, membership_current_period_end, membership_source,
-- membership_status, public_listing_opt_in).
grant select (
  account_status, age_band, created_at, deactivated_at,
  deletion_scheduled_at, discord_id, display_name, email,
  email_access_revoked, google_id, id, membership_current_period_end,
  membership_source, membership_status, minecraft_username,
  minecraft_uuid, minecraft_verified, news_email_opt_in,
  public_listing_opt_in, role, task_email_opt_in, username
)
on public.profiles
to authenticated;

-- Column-level UPDATE allowlist (identical for anon + authenticated;
-- membership/Stripe/status columns are deliberately excluded, per
-- private.profiles_guard_columns()).
grant update (
  age_band, created_at, date_of_birth, discord_id, display_name,
  google_id, id, mc_verify_code, mc_verify_expires, minecraft_username,
  minecraft_verified, news_email_opt_in, public_listing_opt_in,
  task_email_opt_in, username
)
on public.profiles
to anon, authenticated;
