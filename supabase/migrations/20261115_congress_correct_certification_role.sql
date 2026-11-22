-- Fix B3 (HIGH, test-run-1): no role can correct a congress certification.
--
-- public.congress_correct_certification() requires the
-- can_correct_congress_certifications permission, but no role granted it
-- (owner/speaker/clerk/moderator/member all false, every other role null),
-- and user_has_permission() has no owner bypass — so the RPC was unusable
-- by everyone, including the owner. Compare the court side, where
-- chief_justice (the role that certifies court roll calls) holds
-- can_correct_court_certifications=true and the correction works.
-- This grants the permission to the two roles that need it:
--   * congress_speaker — the role that certifies congress roll calls
--     (can_manage_congress=true), mirroring chief_justice on the court side.
--   * owner — level 100; the audit established only the owner can edit
--     level 80+ roles, and the owner must be able to correct a
--     certification when the speaker cannot.
-- Idempotent: safe to re-run (jsonb_set overwrites the same key).
-- This file is for the TEST project first; the live fix goes via a PR.
-- (The same grant is needed on live — the test project's roles are an
-- exact copy of live's, so live has the same gap.)

update public.roles
set permissions = jsonb_set(coalesce(permissions, '{}'::jsonb), '{can_correct_congress_certifications}', 'true'::jsonb)
where name in ('congress_speaker', 'owner');
