-- Fix B2 (HIGH, test-run-1): news articles cannot enter pending_review.
--
-- The frontend review flow is draft -> pending_review (non-approver
-- submits) -> published (approver publishes): news-publish.page.js sends
-- status='pending_review' for non-approvers and admin.page.js lists it.
-- The RLS policy in 20261018_news_coauthors.sql already anticipates it
-- (non-approvers may only keep an article in draft/pending_review).
-- But the DB check constraint news_articles_status_check only allowed
-- ('draft','published','archived'), so every submit-for-review failed
-- with a check-constraint violation and review was silently skipped.
-- This widens the constraint to include 'pending_review'. It is a
-- superset, so no existing row can violate it.
-- This file is for the TEST project first; the live fix goes via a PR.

alter table public.news_articles drop constraint news_articles_status_check;
alter table public.news_articles add constraint news_articles_status_check
  check (status = any (array['draft'::text, 'pending_review'::text, 'published'::text, 'archived'::text]));
