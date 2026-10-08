-- Correct the administrative privileges restated by
-- 20260924_explicit_data_api_grants.sql. RLS does not govern TRUNCATE or
-- REFERENCES; browser roles also have no reason to create triggers.
-- This is a new corrective migration, not a rewrite of applied history.
-- Apply through the project's reviewed migration workflow, not db push
-- (the local migration history is incomplete). Not yet applied live.
begin;

revoke truncate, references, trigger on all tables in schema public
from public, anon, authenticated;

-- CRUD/column grants, RLS policies, and service_role grants are unchanged.
commit;
