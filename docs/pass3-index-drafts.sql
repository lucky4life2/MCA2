-- ============================================================================
-- DRAFT ONLY — DO NOT APPLY WITHOUT KYDEN'S APPROVAL.
--
-- This file is PREPARED, NOT APPLIED. It is deliberately kept OUT of
-- supabase/migrations/ so no deploy flow picks it up automatically.
--
-- Why drafts exist: only 3 indexes are visible in-repo; the live schema
-- (orders, profiles, news, tasks, congress, court, economy tables) was
-- created by migrations that were never stored in the repo. Everything
-- below is therefore gated on a live read-only pre-check.
--
-- STEP 1 — run this live (read-only) and skip any index that already exists:
-- ============================================================================
-- select tablename, indexname, indexdef from pg_indexes
-- where schemaname = 'public'
--   and tablename in ('orders','profiles','news_articles','task_comments','tasks',
--     'congress_notifications','court_notifications','congress_members',
--     'economy_trades','economy_company_reports','economy_dividends',
--     'admin_message_items','congress_calendar_events','court_calendar_events')
-- order by tablename, indexname;
-- -- also verify the item-10 assumption (webhook replay dedup depends on it):
-- select indexname from pg_indexes where tablename = 'orders'
--   and indexdef ilike '%stripe_checkout_session_id%';
--
-- STEP 2 — if the checkout-session check above shows DUPLICATE values in
-- stripe_checkout_session_id, do NOT apply the unique index below blindly.
-- De-duplicate first (Kyden decides which row survives).
--
-- STEP 3 — apply with plain CREATE INDEX IF NOT EXISTS, and prefer
-- CONCURRENTLY outside a transaction for large tables.
-- ============================================================================

-- Item 10 VERIFY-then-add: the webhook's 23505 dedup depends on this.
create unique index if not exists orders_stripe_checkout_session_id_key
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- Account page: .from('orders').eq('user_id', …).order('created_at' desc).limit(25)
create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);
-- Admin page: .from('orders').order('created_at' desc).limit(100) (no user filter)
create index if not exists orders_created_idx
  on public.orders (created_at desc);
-- Webhook fallback lookup: profiles by stripe_subscription_id
create index if not exists profiles_stripe_subscription_idx
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- News: list filters status='published' ordered by published_at desc;
-- publish page filters author_id ordered by created_at desc.
create index if not exists news_articles_status_published_idx
  on public.news_articles (status, published_at desc);
create index if not exists news_articles_author_created_idx
  on public.news_articles (author_id, created_at desc);
-- news-publish uses .or('author_id.eq.… ,coauthor_ids.cs.{…}') — array containment needs GIN
create index if not exists news_articles_coauthor_ids_gin
  on public.news_articles using gin (coauthor_ids);

-- Tasks/messages: per-task comment loads, per-thread item loads
create index if not exists task_comments_task_created_idx
  on public.task_comments (task_id, created_at);
create index if not exists admin_message_items_thread_idx
  on public.admin_message_items (thread_id);

-- Notifications: .eq('user_id', …).eq('is_read', false).order('created_at' desc).limit(10)
create index if not exists congress_notifications_user_created_idx
  on public.congress_notifications (user_id, created_at desc);
create index if not exists court_notifications_user_created_idx
  on public.court_notifications (user_id, created_at desc);
-- Membership lookup seen in congress.page.js: chamber membership by user + status
create index if not exists congress_members_user_status_idx
  on public.congress_members (user_id, status);

-- Stocks detail view: per-company trades/reports/dividends
create index if not exists economy_trades_company_created_idx
  on public.economy_trades (company_id, created_at desc);
create index if not exists economy_company_reports_company_period_idx
  on public.economy_company_reports (company_id, period_end desc);
create index if not exists economy_dividends_company_status_paid_idx
  on public.economy_dividends (company_id, status, paid_at desc);

-- Deliberately NOT drafted: public_profiles (a view — index the underlying
-- table instead, once identified live), products.id (presumed PK), and any
-- table whose filter columns were not evidenced in code.
