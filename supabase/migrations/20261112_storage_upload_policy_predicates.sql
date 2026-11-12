-- storage:upload-client-caps-bypassed-via-direct-api (MEDIUM, 2026-11-12)
--
-- Upload size, format, and EXIF rules lived only in browser code
-- (supabase.js optimizeImageFile + page-local size checks), while the
-- live Storage INSERT policies for archive-files and news-images
-- contained no size, MIME, or extension term at all:
--   'managers upload archive files'  WITH CHECK (bucket_id =
--     'archive-files' AND user_has_permission('can_manage_archive'))
--   'news team upload news images'   WITH CHECK (bucket_id =
--     'news-images' AND user_has_permission('can_manage_news'))
-- A can_manage_archive / can_manage_news holder calling the Storage API
-- directly could therefore upload an unoptimized original (full
-- resolution, EXIF intact) or an SVG / HTML file into a public bucket.
--
-- Fix: DROP + recreate both INSERT policies with server-side predicates
-- constraining the object, keeping the original permission gate:
--   - extension allowlist via storage.extension(name) (lower-cased, so
--     'JPG' is treated as 'jpg'; a name with no extension fails closed):
--       news-images:   jpg, jpeg, png, webp
--       archive-files: jpg, jpeg, png, webp, pdf  (see PDF note below)
--     svg and html are rejected in both buckets by the allowlist.
--   - MIME allowlist via the object metadata:
--       news-images:   image/jpeg, image/png, image/webp
--       archive-files: image/jpeg, image/png, image/webp,
--                      application/pdf
--   - size <= 10 MB via (metadata ->> 'size')::bigint <= 10485760.
--
-- The same predicates are added as WITH CHECK on the two UPDATE policies
-- ('managers update archive files', 'news team update news images'):
-- without them, an upload could be smuggled in by uploading a compliant
-- file and then overwriting the same path with a non-compliant one.
-- shop-images and message-attachments policies are NOT touched.
--
-- PDF NOTE (deliberate deviation from the audit's image-only lists):
-- archive-files legitimately stores PDFs — the archive reader renders
-- them as "Original Document" PDFs (archive.js isArchivePdf) and the
-- bucket's own allowed_mime_types already lists application/pdf. An
-- image-only allowlist on archive-files would break every PDF document
-- upload, so pdf / application/pdf are allowed for archive-files only.
-- news-images stays image-only. GIF is in neither allowlist (the audit's
-- MIME list excludes it, and the optimizer converts images to WebP/JPEG
-- anyway); the buckets' own allowed_mime_types still list gif, but the
-- policy is the binding control, so a GIF upload is now rejected.
--
-- WHAT CANNOT BE EXPRESSED AS A STORAGE POLICY (stated explicitly):
--   - EXIF stripping cannot be expressed as a policy predicate: no
--     predicate can inspect image bytes or metadata content beyond the
--     mimetype/size fields. EXIF removal stays client-side
--     (optimizeImageFile, kept as UX only — not removed) until/unless an
--     upload-gatekeeper Edge Function is built. A direct-API caller can
--     still upload an image with EXIF intact; what the policy now
--     guarantees is that it is a <= 10 MB JPEG/PNG/WebP (or PDF).
--   - Note the residual: because EXIF cannot be policed here, a
--     GPS-tagged photo uploaded via direct API still lands in Storage
--     with its EXIF. The audit's Edge Function gatekeeper remains the
--     complete fix for that half.
--
-- ASSUMPTION THAT NEEDS A LIVE CHECK (a local Postgres mirror cannot
-- prove this): the (metadata ->> 'mimetype') and (metadata ->> 'size')
-- terms rely on Supabase's Storage server populating the metadata jsonb
-- BEFORE the INSERT/UPDATE policy is evaluated. If the storage server
-- evaluates the policy with metadata NULL, both terms are NULL, the
-- WITH CHECK fails, and ALL uploads to these buckets are rejected
-- (fail-closed — nothing bad lands, but uploads break). After applying,
-- run one live upload of a compliant image to each bucket and one of a
-- rejected type (SVG) before declaring this done; if compliant uploads
-- fail, the metadata terms must be dropped and only the extension
-- predicate kept. See the verification script.
--
-- Client-side optimizeImageFile is unchanged and stays as UX only.
--
-- VERIFY: run ~/workspace/audit-fix-verify/storage/
-- verify-storage-upload-client-caps-bypassed-via-direct-api.sql against
-- a local Postgres 16 mirror (see that script's setup assumptions). The
-- mirror can prove the policy bodies contain the predicates; it CANNOT
-- prove the Storage server populates metadata before policy evaluation,
-- nor that EXIF is stripped — those need the live upload checks above.

-- ── INSERT: archive-files ──────────────────────────────────────────
DROP POLICY IF EXISTS "managers upload archive files" ON storage.objects;
CREATE POLICY "managers upload archive files"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'archive-files'
    AND user_has_permission('can_manage_archive')
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'pdf')
    AND (metadata ->> 'mimetype') IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    AND (metadata ->> 'size')::bigint <= 10485760
  );

-- ── INSERT: news-images ────────────────────────────────────────────
DROP POLICY IF EXISTS "news team upload news images" ON storage.objects;
CREATE POLICY "news team upload news images"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'news-images'
    AND user_has_permission('can_manage_news')
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp')
    AND (metadata ->> 'mimetype') IN ('image/jpeg', 'image/png', 'image/webp')
    AND (metadata ->> 'size')::bigint <= 10485760
  );

-- ── UPDATE (overwrite): archive-files ──────────────────────────────
-- Same predicates as WITH CHECK, so a compliant upload cannot be
-- overwritten in place with a non-compliant file. The original qual
-- (bucket + permission on the old row) is preserved.
DROP POLICY IF EXISTS "managers update archive files" ON storage.objects;
CREATE POLICY "managers update archive files"
  ON storage.objects FOR UPDATE TO public
  USING (
    bucket_id = 'archive-files'
    AND user_has_permission('can_manage_archive')
  )
  WITH CHECK (
    bucket_id = 'archive-files'
    AND user_has_permission('can_manage_archive')
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp', 'pdf')
    AND (metadata ->> 'mimetype') IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    AND (metadata ->> 'size')::bigint <= 10485760
  );

-- ── UPDATE (overwrite): news-images ────────────────────────────────
DROP POLICY IF EXISTS "news team update news images" ON storage.objects;
CREATE POLICY "news team update news images"
  ON storage.objects FOR UPDATE TO public
  USING (
    bucket_id = 'news-images'
    AND user_has_permission('can_manage_news')
  )
  WITH CHECK (
    bucket_id = 'news-images'
    AND user_has_permission('can_manage_news')
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp')
    AND (metadata ->> 'mimetype') IN ('image/jpeg', 'image/png', 'image/webp')
    AND (metadata ->> 'size')::bigint <= 10485760
  );
