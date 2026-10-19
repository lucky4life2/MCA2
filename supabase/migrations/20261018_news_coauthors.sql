-- News article coauthoring (2026-10-18)
--
-- Adds a coauthor_ids array to news_articles so multiple News Team members
-- can be credited on (and edit) the same article. The primary author keeps
-- author_id/author_name; coauthors are resolved to display names client-side
-- via public_profiles.
--
-- The UPDATE policy is widened so a coauthor can edit under exactly the same
-- constraints as the primary author: they still need can_manage_news, and
-- non-approvers can only keep the article in draft/pending_review.

ALTER TABLE news_articles
  ADD COLUMN IF NOT EXISTS coauthor_ids uuid[] NOT NULL DEFAULT '{}';

DROP POLICY IF EXISTS news_upd ON news_articles;

CREATE POLICY news_upd ON news_articles FOR UPDATE
  USING (
    user_has_permission('can_manage_news'::text)
    AND (
      author_id = ( SELECT auth.uid() AS uid)
      OR ( SELECT auth.uid() AS uid) = ANY (coauthor_ids)
      OR user_has_permission('can_approve_news'::text)
    )
    AND user_meets_membership_gate()
  )
  WITH CHECK (
    user_has_permission('can_manage_news'::text)
    AND (
      user_has_permission('can_approve_news'::text)
      OR (
        (author_id = ( SELECT auth.uid() AS uid) OR ( SELECT auth.uid() AS uid) = ANY (coauthor_ids))
        AND (status = ANY (ARRAY['draft'::text, 'pending_review'::text]))
      )
    )
    AND user_meets_membership_gate()
  );
