# MCA Economy Plugin

A Paper plugin that gives MCA a website-integrated economy: personal, business,
and nation bank accounts, and player-founded companies with tradeable shares.
Everything reads and writes the **same Supabase tables** the website uses, so a
player's balance and portfolio are identical in-game and on the website
Account page — there's only one ledger.

## What's already live

The Supabase side is already deployed to the MCA project (`hjaywokvgdzhvsoygctc`):

- Tables: `economy_accounts`, `economy_account_members`, `economy_companies`,
  `economy_shareholdings`, `economy_transactions`, `economy_share_transactions`
- RLS: read-only for everyone via their own accounts/memberships; all writes
  go through the RPC functions below
- RPCs (callable from the website as `authenticated`): `economy_my_accounts`,
  `economy_create_account`, `economy_add_account_member`, `economy_transfer`,
  `economy_deposit`, `economy_withdraw`, `economy_create_company`,
  `economy_set_share_price`, `economy_buy_shares`, `economy_sell_shares`
- Internal `_economy_*` twins of each RPC (service_role only — these are what
  this plugin calls, passing an explicit actor id after resolving a player's
  verified `minecraft_uuid`)
- `Owner` and `Administrator` roles were granted a new `can_manage_economy`
  permission, so admins can act on any account (freeze abuse, fix mistakes,
  etc.) — same pattern as your other `user_has_permission()` checks

This plugin is the in-game half. The website's Account page just needs UI
that calls the public `economy_*` RPCs directly (Supabase JS client, same as
everywhere else on the site) — no new backend work needed there.

## What the plugin does

- **Registers as a Vault economy provider.** Any Vault-based plugin —
  ChestShop included — automatically starts trading against a player's
  **personal** MCA account. This is what gives you local, chest-based
  trading: install ChestShop separately (unmodified) and it just works.
- **`/bank`** — `balance`, `list`, `create <personal|business> <name>`,
  `pay <player-or-account> <amount> [memo]`, `invite <account> <player>`
  (add a co-manager to a business/nation account).
- **`/company`** — `list`, `info <ticker>`,
  `found <name> <ticker> <treasury-account> <shares> <price>`,
  `buy <account> <ticker> <shares>`, `sell <account> <ticker> <shares>`,
  `setprice <ticker> <price>` (company owner only).

Nation accounts aren't creatable from `/bank create` yet (they need a
`nation_id` — tie that into your nation-founding flow on the website, then
call `economy_create_account('nation', name, nation_id)` from there). Player
still sees and uses nation accounts they're a member of via `/bank
balance`/`/bank list`/`/bank pay` once created on the website.

## Building

This plugin depends on the Paper API and the Vault API (via JitPack), neither
of which are reachable from this sandbox, so **it hasn't been compiled or
run** — only written and reviewed. To build it:

```bash
mvn clean package
```

from a machine with normal internet access (your dev machine, or a GitHub
Actions runner — you're already doing something similar for the website).
The output jar (with `gson` shaded in) lands in `target/mca-economy-1.0.0.jar`.

## Installing on the server

1. Install [Vault](https://www.spigotmc.org/resources/vault.34315/) if it
   isn't already on the server.
2. Install [ChestShop](https://www.spigotmc.org/resources/chestshop.13850/)
   (or whatever local-trading plugin you prefer — anything Vault-based works).
3. Drop `mca-economy-1.0.0.jar` into `plugins/`, start the server once so it
   generates `plugins/MCAEconomy/config.yml`, then stop it.
4. Edit `config.yml` and paste in your Supabase **service role key** (Project
   Settings → API in the Supabase dashboard). This key bypasses row-level
   security — treat it like a root database password, never commit it.
5. Start the server again.

## How a player gets going

1. Link and verify their Minecraft account on the website (this plugin reads
   `profiles.minecraft_uuid` / `minecraft_verified`, same as everything else
   on the site).
2. `/bank create personal "My Wallet"` — or it's created automatically the
   first time a Vault-based plugin needs a balance for them.
3. Trade at a ChestShop sign, or use `/bank pay` / `/company buy` directly.

## Design notes / trade-offs worth knowing about

- **Security boundary is in Postgres, not the plugin.** The plugin calls
  `_economy_*` functions with the service role key, but those functions still
  check account membership and `can_manage_economy` before doing anything —
  a bug in the plugin can't let a player drain someone else's account.
- **Vault's `getBalance()`/`has()` are served from a cache** refreshed on
  join and every `cache-refresh-seconds` (default 30s), so they never block
  the main thread. `withdrawPlayer()`/`depositPlayer()` make a blocking
  Supabase call on whichever thread calls them — fine for a community
  server's trade volume; if that ever changes, move ChestShop-triggered
  calls onto an async task.
- **Selling shares back always sells to the company treasury** at the
  current `share_price` (which the founder/owner sets manually via
  `/company setprice` or a future website control) — there's no live
  order-book/bid-ask matching. That's a reasonable v1 for an in-universe
  stock market; a real matching engine would be a substantial follow-up.
- **Vault's legacy "bank" API isn't wired up** (`hasBankSupport()` returns
  `false`). Business and nation accounts are real, they just live behind
  `/bank` and the website instead of Vault's old multi-owner bank methods,
  which almost nothing modern still uses.
