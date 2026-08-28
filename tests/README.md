# Tests

## Files

| File | What it covers | Status |
|---|---|---|
| `congress_voting.pgtap.sql` | All 12 backend-verifiable requirements from the Phase 4 spec: valid submission, duplicate/concurrent prevention, eligibility, chamber restriction, closed-vote rejection, quorum/threshold math, vote-change rules, version locking, amendment version creation, leadership/admin authorization, certified immutability, discussion-post RLS, and the audit-log gap. | Written and reviewed against the live schema; **not yet executed** (see below). |
| `frontend_and_mobile.md` | Everything pgTAP can't see: render-time XSS escaping, vote-button UX, loading/error feedback, mobile tap targets, axe-core accessibility scan. | Outline only — no Playwright harness exists in this repo yet. |
| `economy_exchange.sql` | The economy and stock exchange: offerings paying the company only as shares sell, order-book matching and price-time priority, reservation accounting, self-trade prevention, authorization boundaries, dividend rounding, circuit breakers, ledger immutability, dissolution, and Treasury reconciliation. | **Written and executed — 46 assertions, 46 passed, 0 failed** (2026-08-27, against the live project inside a transaction that rolled back). |

## Why the pgTAP suite hasn't been run

Running it requires a live Postgres session with the `pgtap` extension —
either a Supabase branch or a local `supabase db start`. Creating a
branch through Supabase costs money and needs the project owner to
confirm that cost; I didn't create one unprompted. The SQL itself was
written directly against the real table definitions, constraints, RLS
policies, and function bodies (pulled from the production project via
introspection), so it should run clean, but "should run clean" is not
the same as "ran clean" — treat it as reviewed, not verified, until
someone runs it.

## How to actually run it

```bash
# Option A — Supabase-hosted branch (costs apply, needs owner approval)
supabase db branch create phase4-tests
supabase link --project-ref <branch-ref>
psql "$(supabase db branch get phase4-tests --output url)" \
  -c "create extension if not exists pgtap;" \
  -f tests/congress_voting.pgtap.sql

# Option B — local Supabase stack (free, needs Docker)
supabase start
psql "postgresql://postgres:postgres@localhost:54322/postgres" \
  -c "create extension if not exists pgtap;" \
  -f tests/congress_voting.pgtap.sql
# NOTE: a local stack starts from the migration history, not a copy of
# production data, so it needs the same congress_* migrations applied
# first (`supabase db reset` after linking migrations).
```

A pass looks like `ok 1 - AUTHZ: clerk (no can_manage_congress)...`
through `ok 37 - ...`, ending in `1..37` with no `not ok` lines. Any
`not ok` means either the schema drifted from what this suite assumes,
or a real regression — read the diagnostic line pgTAP prints under the
failure before assuming it's the test that's wrong.

The whole file is one transaction that rolls back at the end
(`begin; ... rollback;`), so it's safe to run repeatedly and never
leaves fixture rows in the branch.

## What's deliberately NOT tested here

- **Audit logging for congress actions** — doesn't exist yet at the DB
  layer (test 14 documents the gap rather than pretending to verify
  behavior that isn't implemented). See the main report's "Remaining
  risks."
- **True concurrent race conditions** — a single SQL transaction can't
  fork two simultaneous sessions. Test 3 verifies the actual backstop
  (the UNIQUE constraint) directly instead, which is what makes the
  race safe regardless of timing.
- **Frontend rendering, mobile layout, screen-reader behavior** — see
  `frontend_and_mobile.md`; these need a browser, not a SQL session.


## The economy suite (`economy_exchange.sql`)

Unlike the congress suite this one deliberately does **not** use pgTAP. pgTAP is
available on the project but not installed, and installing an extension is a
persistent schema change to production — which is exactly why the congress
suite has never been run. `economy_exchange.sql` uses plain plpgsql assertions
instead, so it needs no setup:

```bash
psql "<connection-string>" -f tests/economy_exchange.sql
```

It runs inside one transaction that rolls back, reuses existing `profiles` rows
rather than inserting into `auth.users`, and prints a table of `ok` / `NOT OK`
rows followed by a passed/failed/total summary.

Two things it deliberately does **not** claim to test:

- **True concurrency.** A single SQL session cannot fork two simultaneous
  transactions. The suite tests the actual backstops instead — the
  non-negative-balance and non-negative-shares CHECK constraints, and the fact
  that reserved Marks are excluded from spendable balance. Matching is
  serialised per company by a `SELECT ... FOR UPDATE` on the company row, so a
  lost race blocks rather than double-spends.
- **Front-end behaviour.** Confirmation dialogs, escaping, and mobile layout
  need a browser. See `frontend_and_mobile.md`.

One assertion is intentionally inverted: `reconciliation detects Marks that were
never issued` passes when reconciliation reports a **mismatch**, because the
fixtures deliberately seed balances without issuance rows. A suite that
reconciled cleanly there would prove the check cannot spot unbacked currency.
