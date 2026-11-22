-- News image upload RLS fix (2026-11-21, recorded 2026-11-22).
--
-- RECORD ONLY: this fix was already applied directly to the live project
-- on 2026-11-21 (see ~/workspace/news-images-policy-fix.sql) after
-- William (owner/admin, can_manage_news proven TRUE under a simulated
-- JWT) got "new row violates row-level security policy" uploading a
-- picture to a news article. This migration records that live change in
-- the repo so the fix is not lost; applying it to a database that already
-- has the fix is a no-op (DROP POLICY IF EXISTS + CREATE POLICY).
--
-- What changed vs 20261112_storage_upload_policy_predicates.sql:
--   - The mimetype conjunct is REMOVED from both news-images policies.
--     The recorded mimetype is client/server-sniffed and unreliable as a
--     gate: the archive investigation proved uploads fail even with an
--     explicit contentType, and only dropping the mimetype conjunct
--     unblocked them. The extension check is the deterministic type
--     restriction and already limits uploads to jpg/jpeg/png/webp.
--   - The 10 MB size cap is made NULL-TOLERANT
--     ((metadata ->> 'size') IS NULL OR ... <= 10485760): it passes when
--     the server records no size. The old form
--     (metadata ->> 'size')::bigint <= 10485760 fails (NULL) when no size
--     is recorded, which rejected otherwise-compliant uploads.
--
-- Security kept: only news managers (can_manage_news permission), only
-- the 4 image extensions, 10 MB cap when a size is recorded.
-- GIF/SVG/HEIC still fail the extension check (unchanged).
-- The archive-files policies are NOT touched by this migration.
--
-- IDEMPOTENT / SAFE TO RE-RUN: every statement is DROP POLICY IF EXISTS
-- followed by CREATE POLICY with the same name and body, so re-applying
-- to live (already fixed) or to the test project changes nothing the
-- second time.

DROP POLICY IF EXISTS "news team upload news images" ON storage.objects;
CREATE POLICY "news team upload news images" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'news-images'
    AND user_has_permission('can_manage_news')
    AND lower(storage.extension(name)) = ANY (ARRAY['jpg', 'jpeg', 'png', 'webp'])
    AND ((metadata ->> 'size') IS NULL OR (metadata ->> 'size')::bigint <= 10485760)
  );

DROP POLICY IF EXISTS "news team update news images" ON storage.objects;
CREATE POLICY "news team update news images" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'news-images'
    AND user_has_permission('can_manage_news')
  )
  WITH CHECK (
    bucket_id = 'news-images'
    AND user_has_permission('can_manage_news')
    AND lower(storage.extension(name)) = ANY (ARRAY['jpg', 'jpeg', 'png', 'webp'])
    AND ((metadata ->> 'size') IS NULL OR (metadata ->> 'size')::bigint <= 10485760)
  );
