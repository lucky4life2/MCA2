-- storage:unpublished-public-bucket-objects (MEDIUM, 2026-11-12)
--
-- Draft, pending, and unpublished archive files and news images were
-- publicly fetchable: archive-files and news-images are public buckets,
-- uploads returned a public URL before any row existed, and every
-- publish / unpublish / delete transition touched only the database row,
-- never the storage object. A URL seen while an item was published kept
-- serving after unpublish or delete, and archive URLs were guessable
-- (uid / timestamp / slugified filename, no random component).
--
-- Fix: make both buckets private and serve objects only through
-- publication-gated access.
--
-- 1. UPDATE storage.buckets SET public = false for both buckets. From
--    that moment getPublicUrl results 404 and only signed URLs (or a
--    SELECT policy) can serve an object.
-- 2. Add storage.objects SELECT policies that mirror the publication
--    gate at the storage layer. These are REQUIRED, not optional:
--    Supabase's createSignedUrl requires the caller to pass a SELECT
--    policy on storage.objects, and public render pages are visited by
--    ANONYMOUS callers — with no SELECT policy at all, the client helper
--    (signedUrlForPublished in supabase.js) would fail for everyone and
--    every published image/file would break. Each policy admits:
--      - a manager of that area (can_manage_archive / can_manage_news,
--        plus can_approve_news for news), who may preview anything;
--      - anyone (including anon) when a PUBLISHED row references the
--        object — archive_documents.file_url / news_articles.image_url
--        equal to the object path, or a legacy stored full public URL
--        ending in '/<bucket>/<path>' (exact-suffix match, no LIKE, so
--        wildcard characters in a filename cannot over-match);
--      - the author of the row (author_id = auth.uid(), plus news
--        coauthors), for draft preview;
--      - for news, a published article whose BODY embeds the object
--        (inline markdown photos live in news_articles.body, not in
--        image_url) — exact-substring match via strpos, again no LIKE.
--    Draft / pending / deleted rows reference nothing: their objects fail
--    every disjunct and are unreadable, including by path guessing.
--    Direct client downloads (storage.download) of a published object are
--    therefore possible for anyone who knows the path — that is the
--    intended "publicly retrievable only while published" semantic, not
--    a leak: the row gate is the same one the signed-URL helper applies.
--    shop-images and message-attachments are NOT touched by this file.
--
-- DEPLOY ORDER — READ FIRST:
--   Apply this migration ONLY AFTER the new client code is live
--   (signedUrlForPublished in supabase.js, upload sites storing the
--   storage path, and every render site below routing through the
--   helper). The moment public flips to false, every render site still
--   using a stored public URL breaks (images/files 404) until the new
--   client ships. Deploy client first, then this migration.
--
-- RESIDUAL RISKS (if a render site is missed, or a URL escapes):
--   - A render site still interpolating a stored public URL shows a
--     broken image/file instead of leaking anything: fail-closed for
--     privacy, but visibly broken. Render sites covered by the client
--     change: archive.js (index thumb + document reader), news.js
--     (article modal), article.page.js (hero + body markdown),
--     archive-publish.page.js (editor "current file" link),
--     news-publish.page.js (hero preview + body preview).
--     NOT covered (outside this change's file scope — needs a follow-up
--     before or with deploy): admin.page.js openArchiveModal "Current
--     file" link (am2-file-current, ~line 1131) still renders the stored
--     value raw; after this migration it 404s for newly stored paths.
--   - A signed URL minted while an item was published keeps serving
--     until its 1-hour expiry even after the item is unpublished or
--     deleted. That is inherent to bearer signed URLs; no revocation
--     list exists. New renders after unpublish mint nothing.
--   - Objects uploaded before any row exists (hero photo picked before
--     the first save, archive file picked before save) have no row, so
--     no SELECT disjunct matches except the manager one: anyone else
--     (including the author, if they lack the manage permission) cannot
--     mint a signed URL for them until the row is saved. The author
--     preview in the publish pages runs as a manager, so this does not
--     block the normal flow.
--   - The client helper derives publication state from the row it
--     already loaded; the storage policy re-checks the live row. A row
--     unpublished between the page load and the mint is still denied by
--     the policy (defence in depth at the storage layer).
--
-- ROLLBACK: UPDATE storage.buckets SET public = true WHERE id IN
-- ('archive-files','news-images'); DROP POLICY the two policies below.
-- (Rollback re-exposes every object, including drafts — only as an
-- emergency measure while the client is fixed.)
--
-- VERIFY: run ~/workspace/audit-fix-verify/storage/
-- verify-storage-unpublished-public-bucket-objects.sql against a local
-- Postgres 16 mirror seeded with storage.buckets / storage.objects /
-- the two tables (see the script's setup assumptions). The mirror can
-- prove the bucket flags and the policy bodies; it CANNOT prove that
-- Supabase's Storage API honours the policies for createSignedUrl /
-- download — that needs one live check after deploy (anonymous fetch of
-- a published file's signed URL succeeds; direct fetch of a draft
-- object's public URL 404s).

UPDATE storage.buckets SET public = false
WHERE id IN ('archive-files', 'news-images');

-- Archive files: published-row, author, or manager.
DROP POLICY IF EXISTS "published archive files are readable" ON storage.objects;
CREATE POLICY "published archive files are readable"
  ON storage.objects FOR SELECT TO public
  USING (
    bucket_id = 'archive-files'
    AND (
      user_has_permission('can_manage_archive')
      OR EXISTS (
        SELECT 1 FROM public.archive_documents d
        WHERE d.status = 'published'
          AND (
            d.file_url = storage.objects.name
            OR right(d.file_url, length('/archive-files/' || storage.objects.name))
               = '/archive-files/' || storage.objects.name
            OR strpos(d.body, storage.objects.name) > 0
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.archive_documents d
        WHERE d.author_id = auth.uid()
          AND (
            d.file_url = storage.objects.name
            OR right(d.file_url, length('/archive-files/' || storage.objects.name))
               = '/archive-files/' || storage.objects.name
            OR strpos(d.body, storage.objects.name) > 0
          )
      )
    )
  );

-- News images: published-row, author/coauthor, approver, or manager.
DROP POLICY IF EXISTS "published news images are readable" ON storage.objects;
CREATE POLICY "published news images are readable"
  ON storage.objects FOR SELECT TO public
  USING (
    bucket_id = 'news-images'
    AND (
      user_has_permission('can_manage_news')
      OR user_has_permission('can_approve_news')
      OR EXISTS (
        SELECT 1 FROM public.news_articles a
        WHERE a.status = 'published'
          AND (
            a.image_url = storage.objects.name
            OR right(a.image_url, length('/news-images/' || storage.objects.name))
               = '/news-images/' || storage.objects.name
            OR strpos(a.body, storage.objects.name) > 0
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.news_articles a
        WHERE (a.author_id = auth.uid() OR auth.uid() = ANY (a.coauthor_ids))
          AND (
            a.image_url = storage.objects.name
            OR right(a.image_url, length('/news-images/' || storage.objects.name))
               = '/news-images/' || storage.objects.name
            OR strpos(a.body, storage.objects.name) > 0
          )
      )
    )
  );
