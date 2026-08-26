# MCAVerify — recovered source + heartbeat patch

You uploaded the compiled `mcaverify-1_0_0.jar` rather than the original
source, so this folder is a **decompiled reconstruction** of the plugin
(there was no javac/decompiler available in my sandbox and no network
access to fetch one, so I wrote a small bytecode reader by hand and
rebuilt the Java from that). It should be functionally equivalent to
what's currently deployed, plus the heartbeat feature added on top.
I have not been able to compile/test it here — review it before deploying,
especially message-formatting edge cases.

## Where the heartbeat code went

- **`SupabaseClient.java`** — new method `sendHeartbeat(String serverName)`.
  It upserts a row into the `settings` table (`key = "plugin_heartbeat"`,
  `value = {"last_seen": ..., "server": ...}`) using the same direct-REST
  pattern the plugin already uses for `markVerified()`/`clearVerification()`.
- **`MCAVerifyPlugin.java`** — new `startHeartbeat()`, called at the end of
  `onEnable()`. It schedules `supabase.sendHeartbeat(...)` on a repeating
  async task (`runTaskTimerAsynchronously`, default every 60s) and cancels
  it in `onDisable()`.
- **`config.yml`** — new `heartbeat:` section (`enabled`, `interval_seconds`,
  `server_name`).

This matches the website-side change already deployed to the `mcaverify`
Edge Function, which now reports `plugin_online: true` only if a heartbeat
landed in the last 150 seconds — so once you build and deploy this jar, the
admin panel's "Ping Bridge" button will reflect reality.

## Important: this plugin doesn't call the Edge Function at all

Worth knowing — the plugin never talks to the `mcaverify` Supabase Edge
Function. It calls Supabase's PostgREST API **directly**, using the
`service_role_key` from `config.yml`, which bypasses Row Level Security
entirely. That's why the heartbeat just upserts straight into `settings`
the same way `markVerified()` does, rather than POSTing to the Edge
Function with the plugin secret.

## Two things flagged while reading through this

1. **`hardcoded_admins` / `HardcodedAdminListener`** — any UUID listed under
   `hardcoded_admins` in `config.yml` silently gets `mcaverify.admin` and
   `mcaverify.use` permissions on every join, regardless of op status or
   your permissions plugin. The shipped `config.yml` has it set to a
   placeholder UUID (`00000000-...`), but worth checking what's actually in
   the live `config.yml` on the server — anyone in that list has standing
   admin access to `/mcaunverify` and `/mcalookup` that's invisible to the
   website's own role system.
2. **The `service_role_key` lives in plaintext in `config.yml`** on the
   Minecraft server. It has full database access, bypassing every RLS
   policy on the site. Worth treating that file (and any backups of it) the
   same way you'd treat a root database password.

## Building

This needs a JDK + Maven + internet access (none of which I have here):

```
mvn package
```

Output: `target/mcaverify-1.0.0.jar`. Drop it in `plugins/`, reload, then
edit the new `heartbeat:` section in `plugins/MCAVerify/config.yml` if you
want a different interval or a custom `server_name` label.
