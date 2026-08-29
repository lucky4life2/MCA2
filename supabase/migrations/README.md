# Economy migrations

This project has always applied migrations straight to Supabase rather than
keeping copies in the repo, so this folder is not a complete migration history
and `supabase db push` is **not** the workflow here.

Only one file is stored locally —
`20260827_economy_ledger_invariants_and_treasury.sql` — because it was written
before database access was available in that session and would otherwise have
been lost. It has since been corrected to match what actually landed (the
`_economy_audit` helper originally used an `actor_type` the `audit_log` CHECK
constraint rejects).

## What was applied, in order

| Version | Name | What it does |
|---|---|---|
| 20260828003122 | `economy_ledger_invariants_and_treasury` | available vs reserved balances, non-negativity constraints, append-only `economy_currency_issuance` Treasury ledger + genesis backfill, deposit/withdraw record currency creation, admin `treasury_issue`/`treasury_remove`, self-trade block, `can_manage_treasury` permission |
| 20260828003447 | `economy_company_identity_and_managers` | company lifecycle `status`, company's own `account_id`, `shares_issued` vs authorized `total_shares`, `last_trade_price`, `economy_company_members` (per-company officers) + `economy_company_can()`, wallet rename/close, widened transaction type vocabulary |
| 20260828003626 | `economy_audit_actor_type_fix` | derive a valid `audit_log.actor_type` instead of the rejected `'user'` |
| 20260828003839 | `economy_primary_offerings` | `economy_offerings` + `economy_offering_purchases`, pay-as-sold purchase RPC, offering review/close, insider lockups, idempotency tokens |
| 20260828004133 | `economy_order_book` | `economy_orders`, immutable `economy_trades`, daily OHLC, exchange settings, matching engine with price-time priority and circuit breaker, cancel/expire, book + market-summary readers |
| 20260828004359 | `economy_remove_noop_in_matcher` | strips a stray no-op statement from the matching engine |
| 20260828004633 | `economy_dividends_governance_safeguards` | dividends, shareholder register, voting, conflict disclosures, reports, halts/suspensions, dissolution |
| 20260828010257 | `economy_company_creation_no_preissue` | founding stops pre-issuing every share to the founder's wallet and creates the company's own account instead |
| 20260828012*   | `economy_advisor_fixes_search_path_and_register_privacy` | pins `search_path` on the three new trigger functions, and stops the shareholder register returning sub-threshold holders to unprivileged callers |
| 20260828 (audit) | `economy_close_internal_rpc_exposure` | revokes EXECUTE on all 38 `_economy_*` internals from `anon`/`authenticated` (they trust a caller-supplied `p_actor`, so anyone with the publishable key could mint Marks), and clears the schema-wide default privilege that kept re-granting them; adds `economy_audit_exposed_internals()` to check |
| 20260828 (audit) | `congress_certify_affirmative_only` | passage is read from the affirmative tally row instead of `bool_or` across every non-abstention choice, which certified defeated measures as passed |
| 20260828 (audit) | `economy_offering_issuance_makes_company_public` | moves the `private -> public` transition to the moment shares are issued, so a fully subscribed offering no longer leaves the company permanently untradeable |
| 20260828 (audit) | `economy_actor_scoped_permission_checks` | `_economy_transfer` / `_economy_create_account` / `_economy_add_account_member` use `_economy_actor_has_permission(p_actor, …)` instead of the `auth.uid()`-based helper, which was always false on the plugin's service_role path |
| 20260828 (audit) | `economy_expire_orders_requires_authority` | `economy_expire_orders()` now requires an economy admin (or service_role) instead of being callable by `anon` |

The full text of the five audit migrations, with the reasoning behind each, is
kept in `20260828_backend_audit_fixes.sql`.

### Not yet applied

`20260828_backend_audit_followups.sql` — the audit's remaining four items,
written but **not run against production**:

1. retires `economy_companies.treasury_account_id` (it pointed at a *personal*
   wallet, so the legacy `_economy_buy_shares` path paid company share sales to
   a private individual) by mirroring it onto `account_id` behind a CHECK
   constraint;
2. `_economy_set_share_price` — a fourth instance of the session-vs-actor
   permission bug, now gated on company officers;
3. `congress_roll_call_tally` — exact supermajorities failed by one vote
   (6 of 9 lost a two-thirds vote);
4. a `COMMENT` recording why `public_profiles` stays a SECURITY DEFINER view.

Section 1 contains the file's only data change and only DDL. Everything else is
`create or replace function` and comments.

## A standing rule this schema now depends on

`alter default privileges in schema public grant execute on functions to anon,
authenticated` was the reason repeated one-off revokes never held: every new
function was world-callable the moment it was created. That default is now
cleared for `postgres`, so **a new function is unreachable until you grant it
explicitly**. When you add an RPC the website calls, end the migration with:

```sql
grant execute on function public.your_new_function(<argtypes>) to authenticated;
```

Internal `_economy_*` helpers should get `service_role` only. Run
`select * from public.economy_audit_exposed_internals();` after any economy
migration — it returns rows only when an internal has become reachable again.

## Exporting the real SQL

Supabase keeps the statements it applied. To dump any of the above:

```sql
select version, name, statements
from supabase_migrations.schema_migrations
where name like 'economy%'
order by version;
```
