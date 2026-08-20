-- =====================================================================
-- Congress Voting System — pgTAP Integration Test Suite
-- =====================================================================
-- Target: Supabase project "MCA website" (hjaywokvgdzhvsoygctc)
-- Scope:  public.congress_* schema + the SECURITY DEFINER RPCs that
--         gate all writes (congress_cast_vote, congress_open_roll_call,
--         congress_close_roll_call, congress_certify_roll_call,
--         congress_transition_measure_status, etc.)
--
-- WHY pgTAP, not a JS test runner:
-- Every rule this phase needs to verify (duplicate-vote prevention,
-- eligibility, chamber restriction, closed-vote rejection, quorum/
-- threshold math, vote-change rules, version locking, certified
-- immutability) is enforced in Postgres — in the RPC bodies, in
-- CHECK/UNIQUE constraints, and in triggers (fn_congress_vote_lock,
-- fn_congress_roll_call_guard) — not in the browser. A JS-level test
-- can only confirm the UI *calls* the right RPC; it can't prove the
-- RPC is safe against someone hitting PostgREST directly. pgTAP tests
-- the real enforcement boundary.
--
-- HOW TO RUN (never against the production project):
--   1. Create a disposable branch: `supabase db branch create test`
--      (or use Supabase MCP's create_branch tool from the client).
--   2. `create extension if not exists pgtap;` on that branch once.
--   3. `psql <branch-connection-string> -f tests/congress_voting.pgtap.sql`
--   4. Everything below runs inside one transaction and ROLLS BACK at
--      the end — it never leaves rows behind, so it's safe to re-run.
--
-- STATUS: written against the live schema/RPC definitions inspected via
-- the Supabase MCP tools (columns, constraints, RLS policies, and
-- function bodies were read directly from the production database this
-- test targets). It has NOT yet been executed against a branch — no
-- branch was created in this session, since that requires a cost
-- confirmation only the project owner can give. Treat this file as
-- reviewed-and-ready-to-run, not as passing results. See the final
-- report's "Testing instructions and results" section.
-- =====================================================================

begin;
create extension if not exists pgtap;
select plan(37);

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111101', 'clerk@test.mca'),
  ('11111111-1111-1111-1111-111111111102', 'speaker@test.mca'),
  ('11111111-1111-1111-1111-111111111103', 'member.a@test.mca'),
  ('11111111-1111-1111-1111-111111111104', 'member.b@test.mca'),
  ('11111111-1111-1111-1111-111111111105', 'member.c@test.mca'),
  ('11111111-1111-1111-1111-111111111106', 'other.chamber@test.mca'),
  ('11111111-1111-1111-1111-111111111107', 'random.member@test.mca')
on conflict (id) do nothing;

insert into public.profiles (id, username, display_name, role) values
  ('11111111-1111-1111-1111-111111111101', 'test_clerk', 'Clerk Test', 'member'),
  ('11111111-1111-1111-1111-111111111102', 'test_speaker', 'Speaker Test', 'member'),
  ('11111111-1111-1111-1111-111111111103', 'test_membera', 'Member A', 'member'),
  ('11111111-1111-1111-1111-111111111104', 'test_memberb', 'Member B', 'member'),
  ('11111111-1111-1111-1111-111111111105', 'test_memberc', 'Member C', 'member'),
  ('11111111-1111-1111-1111-111111111106', 'test_otherchamber', 'Other Chamber Member', 'member'),
  ('11111111-1111-1111-1111-111111111107', 'test_random', 'Random Site Member', 'member')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_id)
select '11111111-1111-1111-1111-111111111101', id from public.roles where name = 'congress_clerk'
on conflict do nothing;
insert into public.user_roles (user_id, role_id)
select '11111111-1111-1111-1111-111111111102', id from public.roles where name = 'congress_speaker'
on conflict do nothing;

create temp table house as
  select id as house_id from public.congress_chambers where is_active limit 1;

create temp table senate as (
  insert into public.congress_chambers
    (key, label, quorum_numerator, quorum_denominator, default_threshold_numerator, default_threshold_denominator)
  values ('test_senate', 'Test Senate', 1, 2, 1, 2)
  returning id as senate_id
);

insert into public.congress_members (chamber_id, user_id, status)
select house_id, u, 'active' from house, unnest(array[
  '11111111-1111-1111-1111-111111111103'::uuid,
  '11111111-1111-1111-1111-111111111104'::uuid,
  '11111111-1111-1111-1111-111111111105'::uuid
]) u;

insert into public.congress_members (chamber_id, user_id, status)
select senate_id, '11111111-1111-1111-1111-111111111106', 'active' from senate;

create temp table measure as (
  insert into public.congress_measures (type_key, chamber_id, title, status_key, created_by)
  select (select key from public.congress_measure_types limit 1), house_id,
         'Test Measure', 'voting', '11111111-1111-1111-1111-111111111101'
  from house
  returning id as mid
);

create temp table mversion as (
  insert into public.congress_measure_versions (measure_id, version_number, full_text, is_locked, created_by)
  select mid, 1, 'Original text.', true, '11111111-1111-1111-1111-111111111101' from measure
  returning id as vid
);

update public.congress_measures m set current_version_id = v.vid
from measure me, mversion v where m.id = me.mid;

-- =====================================================================
-- 1. VALID VOTE SUBMISSION  +  AUTHZ boundary for opening a roll call
-- =====================================================================

create temp table rc as (
  insert into public.congress_roll_calls
    (measure_id, chamber_id, measure_version_id, question,
     quorum_numerator, quorum_denominator, threshold_numerator, threshold_denominator,
     threshold_basis, status, created_by)
  select mid, house_id, vid, 'Shall the Test Measure pass?', 1, 2, 1, 2, 'cast', 'scheduled',
         '11111111-1111-1111-1111-111111111101'
  from measure, house, mversion
  returning id as id1
);

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111101')::text, true);
select throws_ok(
  $$ select public.congress_open_roll_call((select id1 from rc)) $$,
  'Permission denied: can_manage_congress required',
  'AUTHZ: clerk (no can_manage_congress) cannot open a roll call'
);

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111102')::text, true);
select lives_ok(
  $$ select public.congress_open_roll_call((select id1 from rc)) $$,
  'speaker (can_manage_congress) can open a scheduled roll call'
);
select is( (select status from public.congress_roll_calls where id = (select id1 from rc)), 'open',
  'roll call status transitions to open' );
select is( (select count(*)::int from public.congress_roll_call_eligibility where roll_call_id = (select id1 from rc) and is_eligible), 3,
  'opening the roll call seeded eligibility for exactly the 3 active House members' );

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111103')::text, true);
select lives_ok(
  $$ select public.congress_cast_vote((select id1 from rc), 'yea') $$,
  'VALID SUBMISSION: eligible member can cast a yea vote while open'
);
select is( (select choice from public.congress_votes
              where roll_call_id = (select id1 from rc) and user_id = '11111111-1111-1111-1111-111111111103'),
  'yea', 'the recorded vote matches the submitted choice' );

-- =====================================================================
-- 2. DUPLICATE VOTE PREVENTION (same user votes twice = update, not dup row)
-- =====================================================================
select lives_ok(
  $$ select public.congress_cast_vote((select id1 from rc), 'nay') $$,
  'DUPLICATE SUBMIT: same eligible member voting again updates their vote (allow_vote_changes=true by default)'
);
select is( (select count(*)::int from public.congress_votes
              where roll_call_id = (select id1 from rc) and user_id = '11111111-1111-1111-1111-111111111103'),
  1, 'still exactly one vote row for that user on that roll call (no duplicate row)' );
select is( (select change_count from public.congress_votes
              where roll_call_id = (select id1 from rc) and user_id = '11111111-1111-1111-1111-111111111103'),
  1, 'change_count incremented to reflect the vote change' );

-- =====================================================================
-- 3. CONCURRENT VOTE PREVENTION (race backstop)
-- =====================================================================
-- congress_cast_vote's "select existing row FOR UPDATE, else insert"
-- pattern can, in principle, race between two simultaneous first-time
-- votes from the same user. A single pgTAP transaction can't fork two
-- true concurrent sessions, so this verifies the actual backstop: the
-- UNIQUE(roll_call_id, user_id) constraint rejects a second row even
-- when inserted directly, bypassing the RPC's own check.
select throws_matching(
  $$ insert into public.congress_votes (roll_call_id, user_id, measure_version_id, choice)
     values ((select id1 from rc), '11111111-1111-1111-1111-111111111103', (select vid from mversion), 'yea') $$,
  'duplicate key value violates unique constraint',
  'CONCURRENCY BACKSTOP: UNIQUE(roll_call_id, user_id) blocks a second raw insert for the same voter'
);

-- =====================================================================
-- 4. ELIGIBILITY ENFORCEMENT
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111107')::text, true);
select throws_ok(
  $$ select public.congress_cast_vote((select id1 from rc), 'yea') $$,
  'You are not eligible to vote on this question',
  'ELIGIBILITY: a site member with no congress_members seat cannot vote'
);

-- =====================================================================
-- 5. CHAMBER RESTRICTIONS
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111106')::text, true);
select throws_ok(
  $$ select public.congress_cast_vote((select id1 from rc), 'yea') $$,
  'You are not eligible to vote on this question',
  'CHAMBER RESTRICTION: a member seated only in the Senate cannot vote on a House roll call'
);

-- =====================================================================
-- 6. CLOSED VOTE REJECTION + state machine
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111102')::text, true);
select lives_ok(
  $$ select public.congress_close_roll_call((select id1 from rc)) $$,
  'speaker can close the open roll call'
);
select is( (select status from public.congress_roll_calls where id = (select id1 from rc)), 'closed',
  'roll call status transitions to closed' );

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104')::text, true);
select throws_ok(
  $$ select public.congress_cast_vote((select id1 from rc), 'yea') $$,
  'Voting is not currently open for this question',
  'CLOSED VOTE: an eligible member cannot vote once the roll call is closed'
);
select throws_ok(
  $$ select public.congress_open_roll_call((select id1 from rc)) $$,
  'Only a scheduled roll call can be opened',
  'STATE MACHINE: a closed roll call cannot be re-opened via congress_open_roll_call'
);

-- =====================================================================
-- 7. QUORUM AND THRESHOLD CALCULATIONS
-- =====================================================================
select ok(
  not (select bool_and(quorum_met) from public.congress_roll_call_tally((select id1 from rc)) where choice not in ('present','abstain')),
  'QUORUM: 1 of 3 eligible members voting does not meet a 1/2 quorum requirement'
);

create temp table rc2 as (
  insert into public.congress_roll_calls
    (measure_id, chamber_id, measure_version_id, question,
     quorum_numerator, quorum_denominator, threshold_numerator, threshold_denominator,
     threshold_basis, status, created_by)
  select mid, house_id, vid, 'Second question for tally math', 1, 2, 1, 2, 'cast', 'scheduled',
         '11111111-1111-1111-1111-111111111101'
  from measure, house, mversion
  returning id as id2
);

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111102')::text, true);
select public.congress_open_roll_call((select id2 from rc2));

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111103')::text, true);
select public.congress_cast_vote((select id2 from rc2), 'yea');
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104')::text, true);
select public.congress_cast_vote((select id2 from rc2), 'yea');
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111105')::text, true);
select public.congress_cast_vote((select id2 from rc2), 'nay');

select ok(
  (select bool_and(quorum_met) from public.congress_roll_call_tally((select id2 from rc2)) where choice not in ('present','abstain')),
  'QUORUM: 3 of 3 eligible members voting meets a 1/2 quorum requirement'
);
select ok(
  (select threshold_met from public.congress_roll_call_tally((select id2 from rc2)) where choice = 'yea'),
  'THRESHOLD: 2 of 3 cast votes for "yea" clears a >1/2 majority threshold (threshold_basis=cast)'
);
select ok(
  not (select threshold_met from public.congress_roll_call_tally((select id2 from rc2)) where choice = 'nay'),
  'THRESHOLD: 1 of 3 cast votes for "nay" does not clear a >1/2 threshold'
);
select throws_ok(
  $$ select public.congress_cast_vote((select id2 from rc2), 'maybe') $$,
  'Invalid vote option',
  'VALIDATION: a choice outside vote_options (yea/nay/present/abstain) is rejected'
);

-- =====================================================================
-- 8. VOTE CHANGE RULES (allow_vote_changes = false)
-- =====================================================================
create temp table rc3 as (
  insert into public.congress_roll_calls
    (measure_id, chamber_id, measure_version_id, question, allow_vote_changes,
     quorum_numerator, quorum_denominator, threshold_numerator, threshold_denominator, status, created_by)
  select mid, house_id, vid, 'No-changes question', false, 1, 2, 1, 2, 'scheduled',
         '11111111-1111-1111-1111-111111111101'
  from measure, house, mversion
  returning id as id3
);

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111102')::text, true);
select public.congress_open_roll_call((select id3 from rc3));

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111103')::text, true);
select lives_ok( $$ select public.congress_cast_vote((select id3 from rc3), 'yea') $$, 'first vote on a no-changes roll call succeeds' );
select throws_ok(
  $$ select public.congress_cast_vote((select id3 from rc3), 'nay') $$,
  'Vote changes are not permitted on this question',
  'VOTE CHANGE RULES: allow_vote_changes=false blocks a second vote from the same member'
);

-- =====================================================================
-- 9. MEASURE VERSION LOCKING
-- =====================================================================
select ok( (select is_locked from public.congress_measure_versions where id = (select vid from mversion)),
  'the measure version used for an active roll call is locked' );

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111102')::text, true);
select is(
  (select count(*)::int from (
    update public.congress_measure_versions set full_text = 'tampered' where id = (select vid from mversion) returning 1
  ) x),
  0,
  'VERSION LOCKING: RLS blocks updates to a locked measure version, even for a speaker'
);

-- =====================================================================
-- 10. AMENDMENT VERSION CREATION (on certification of a passing amendment)
-- =====================================================================
create temp table amend as (
  insert into public.congress_amendments
    (measure_id, number, sponsor_id, explanation, affected_text_before, affected_text_after, status, created_by)
  select mid, 1, '11111111-1111-1111-1111-111111111103',
         'Replace "Original" with "Amended"', 'Original text.', 'Amended text.', 'voting',
         '11111111-1111-1111-1111-111111111103'
  from measure
  returning id as aid
);

create temp table arc as (
  insert into public.congress_roll_calls
    (amendment_id, chamber_id, measure_version_id, question,
     quorum_numerator, quorum_denominator, threshold_numerator, threshold_denominator, status, created_by)
  select aid, house_id, vid, 'Adopt Amendment #1?', 1, 2, 1, 2, 'closed',
         '11111111-1111-1111-1111-111111111101'
  from amend, house, mversion
  returning id as aid_rc
);

insert into public.congress_roll_call_eligibility (roll_call_id, user_id, chamber_id, is_eligible)
select aid_rc, '11111111-1111-1111-1111-111111111103', house_id from arc, house;
insert into public.congress_votes (roll_call_id, user_id, measure_version_id, choice)
select aid_rc, '11111111-1111-1111-1111-111111111103', vid, 'yea' from arc, mversion;

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111101')::text, true);
select lives_ok(
  $$ select public.congress_certify_roll_call((select aid_rc from arc), 'Certified in test') $$,
  'clerk (can_certify_congress_votes) can certify the amendment roll call'
);
select is( (select status from public.congress_amendments where id = (select aid from amend)), 'passed',
  'AMENDMENT: certifying a passing amendment vote marks the amendment passed' );
select is( (select count(*)::int from public.congress_measure_versions where measure_id = (select mid from measure)),
  2, 'AMENDMENT VERSION CREATION: certifying a passing amendment creates a new locked measure version' );
select is( (select current_version_id from public.congress_measures where id = (select mid from measure)),
  (select id from public.congress_measure_versions where measure_id = (select mid from measure) and version_number = 2),
  'the measure''s current_version_id now points at the new (v2) version' );

-- =====================================================================
-- 11. AUTHORIZATION FOR LEADERSHIP/ADMIN ACTIONS
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111103')::text, true);
select throws_ok(
  $$ select public.congress_transition_measure_status((select mid from measure), 'debate') $$,
  'Permission denied: can_manage_congress required',
  'AUTHZ: a rank-and-file congress_member cannot transition measure status'
);
select throws_ok(
  $$ select public.congress_certify_roll_call((select id2 from rc2), null) $$,
  'Permission denied: can_certify_congress_votes required',
  'AUTHZ: a rank-and-file congress_member cannot certify a roll call'
);

select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111102')::text, true);
select lives_ok(
  $$ select public.congress_transition_measure_status((select mid from measure), 'debate') $$,
  'AUTHZ: the speaker (can_manage_congress) CAN transition measure status'
);

-- =====================================================================
-- 12. CERTIFIED VOTE IMMUTABILITY
-- =====================================================================
select throws_ok(
  $$ update public.congress_votes set choice = 'nay' where roll_call_id = (select aid_rc from arc) $$,
  'Votes on a certified roll call cannot be modified.',
  'CERTIFIED IMMUTABILITY: fn_congress_vote_lock trigger blocks editing a vote on a certified roll call'
);
select throws_ok(
  $$ update public.congress_roll_calls set certification_note = 'tampered' where id = (select aid_rc from arc) $$,
  'This roll call is certified. Use the correction procedure to make an audited change.',
  'CERTIFIED IMMUTABILITY: fn_congress_roll_call_guard trigger blocks editing a certified roll call directly'
);

-- =====================================================================
-- 13. DISCUSSION INPUT SANITIZATION
-- =====================================================================
-- The DB layer stores raw text (no sanitization trigger on
-- congress_debate_posts.body) — escaping happens at render time via
-- congress.html's esc() before innerHTML insertion. What the DB layer
-- IS responsible for is: RLS still enforces chamber-membership +
-- author identity regardless of body content, and a script payload
-- round-trips inert (never evaluated server-side).
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111103')::text, true);
select lives_ok(
  $$ insert into public.congress_debate_posts (measure_id, author_id, body)
     values ((select mid from measure), '11111111-1111-1111-1111-111111111103', '<script>alert(1)</script>') $$,
  'a debate post containing a script tag is accepted and stored as inert text (escaping is a render-time concern)'
);
select is(
  (select body from public.congress_debate_posts where measure_id = (select mid from measure)
     and author_id = '11111111-1111-1111-1111-111111111103' order by created_at desc limit 1),
  '<script>alert(1)</script>',
  'SANITIZATION: stored body is byte-for-byte untouched; congress.html''s esc() is what protects rendering — see report'
);
select set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111107')::text, true);
select throws_ok(
  $$ insert into public.congress_debate_posts (measure_id, author_id, body)
     values ((select mid from measure), '11111111-1111-1111-1111-111111111107', 'not a chamber member') $$,
  null,
  'a non-chamber-member cannot post to debate regardless of body content (RLS p_insert)'
);

-- =====================================================================
-- 14. AUDIT LOG CREATION
-- =====================================================================
-- Documented gap, not a passing assertion of desired behavior: the
-- congress_* RPCs do not currently write to public.audit_log. See
-- "Remaining risks" in the final report.
select is(
  (select count(*)::int from public.audit_log where table_name like 'congress_%'),
  0,
  'AUDIT LOG GAP (documented): no congress_* actions currently write audit_log rows'
);

select * from finish();
rollback;
