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

## Exporting the real SQL

Supabase keeps the statements it applied. To dump any of the above:

```sql
select version, name, statements
from supabase_migrations.schema_migrations
where name like 'economy%'
order by version;
```
