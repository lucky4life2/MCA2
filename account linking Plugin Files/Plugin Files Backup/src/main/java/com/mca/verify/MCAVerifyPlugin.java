package com.mca.verify;

import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Level;

public class MCAVerifyPlugin extends JavaPlugin {

    private SupabaseClient supabase;
    private String minecraftUuidColumn;
    private final Set<UUID> hardcodedAdmins = new HashSet<>();
    private boolean membershipGateEnabled;

    // NEW: heartbeat task handle + config, so the website's admin panel can
    // tell this plugin is actually alive (see SupabaseClient.sendHeartbeat()).
    private BukkitTask heartbeatTask;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        FileConfiguration cfg = getConfig();

        String url = cfg.getString("supabase.url", "");
        String key = cfg.getString("supabase.service_role_key", "");
        String table = cfg.getString("table", "profiles");

        if (url.isBlank() || key.isBlank() || key.contains("PUT_YOUR_SUPABASE")) {
            getLogger().severe("Supabase URL/service_role_key are not configured! Edit plugins/MCAVerify/config.yml");
        }

        minecraftUuidColumn = cfg.getString("columns.minecraft_uuid", "minecraft_uuid");

        for (String raw : cfg.getStringList("hardcoded_admins")) {
            try {
                hardcodedAdmins.add(UUID.fromString(raw.trim()));
            } catch (IllegalArgumentException e) {
                getLogger().warning("Invalid UUID in hardcoded_admins: " + raw);
            }
        }

        SupabaseClient.ColumnNames columns = new SupabaseClient.ColumnNames(
                cfg.getString("columns.minecraft_username", "minecraft_username"),
                cfg.getString("columns.minecraft_verified", "minecraft_verified"),
                minecraftUuidColumn,
                cfg.getString("columns.verify_code", "mc_verify_code"),
                cfg.getString("columns.verify_expires", "mc_verify_expires"),
                cfg.getString("columns.membership_status", "membership_status"),
                cfg.getString("columns.membership_period_end", "membership_current_period_end")
        );

        supabase = new SupabaseClient(url, key, table, columns, getLogger());

        VerifyCommand verifyCommand = new VerifyCommand(this, supabase);
        getCommand("mcaverify").setExecutor(verifyCommand);

        AdminCommands adminCommands = new AdminCommands(this, supabase);
        getCommand("mcaunverify").setExecutor(adminCommands);
        getCommand("mcalookup").setExecutor(adminCommands);

        getServer().getPluginManager().registerEvents(new HardcodedAdminListener(this), this);

        membershipGateEnabled = cfg.getBoolean("membership.gate_enabled", true);
        getServer().getPluginManager().registerEvents(new MembershipGateListener(this, supabase), this);
        if (membershipGateEnabled) {
            getLogger().info("Membership gate ENABLED — only active members (and hardcoded admins) may join.");
        } else {
            getLogger().warning("Membership gate DISABLED in config.yml (membership.gate_enabled: false) — anyone can join.");
        }

        startHeartbeat(cfg);

        getLogger().info("MCAVerify enabled.");
    }

    @Override
    public void onDisable() {
        if (heartbeatTask != null) {
            heartbeatTask.cancel();
            heartbeatTask = null;
        }
        getLogger().info("MCAVerify disabled.");
    }

    /**
     * NEW: starts a repeating async task that pings Supabase every
     * heartbeat.interval_seconds (default 60s) so the website knows this
     * plugin is actually running, not just that the Edge Function/server
     * happens to be reachable.
     */
    private void startHeartbeat(FileConfiguration cfg) {
        boolean enabled = cfg.getBoolean("heartbeat.enabled", true);
        if (!enabled) {
            getLogger().info("Heartbeat disabled in config.yml (heartbeat.enabled: false).");
            return;
        }
        long intervalSeconds = Math.max(15, cfg.getLong("heartbeat.interval_seconds", 60));
        long intervalTicks = intervalSeconds * 20L; // Bukkit scheduler runs at 20 ticks/sec
        String serverName = cfg.getString("heartbeat.server_name", "");

        heartbeatTask = getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            boolean ok = supabase.sendHeartbeat(serverName.isBlank() ? getServer().getName() : serverName);
            if (!ok) {
                getLogger().log(Level.FINE, "Heartbeat send failed (will retry next interval).");
            }
        }, 0L, intervalTicks);

        getLogger().info("Heartbeat started, pinging every " + intervalSeconds + "s.");
    }

    public String msg(String key, String... placeholders) {
        String raw = getConfig().getString("messages." + key, key);
        for (int i = 0; i + 1 < placeholders.length; i += 2) {
            raw = raw.replace(placeholders[i], placeholders[i + 1]);
        }
        return org.bukkit.ChatColor.translateAlternateColorCodes('&', raw);
    }

    public boolean uuidTrackingEnabled() {
        return minecraftUuidColumn != null && !minecraftUuidColumn.isBlank();
    }

    public boolean isHardcodedAdmin(UUID uuid) {
        return hardcodedAdmins.contains(uuid);
    }

    public boolean membershipGateEnabled() {
        return membershipGateEnabled;
    }
}
