-- Rollback for audit_02_rate_limit_primitive (2026-09-24). This migration only
-- created new objects, so rolling back means dropping them.
drop function if exists public.check_rate_limit(text, integer, integer);
drop table if exists public.rate_limits;
