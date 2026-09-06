package com.mca.verify;

import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;

import java.util.UUID;
import java.util.logging.Level;

/**
 * Locks the server to paying MCA members. Runs on AsyncPlayerPreLoginEvent,
 * before the Player object exists, so a non-member is refused cleanly
 * instead of being kicked right after they've fully joined.
 *
 * Hardcoded admins (config.yml's hardcoded_admins list) always bypass this,
 * same as HardcodedAdminListener's permission grant — website "can_view_admin"
 * staff are handled separately by the website's own gate, not this plugin,
 * since this listener only has the player's Minecraft UUID to go on.
 */
public class MembershipGateListener implements Listener {

    private final MCAVerifyPlugin plugin;
    private final SupabaseClient supabase;

    public MembershipGateListener(MCAVerifyPlugin plugin, SupabaseClient supabase) {
        this.plugin = plugin;
        this.supabase = supabase;
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onPreLogin(AsyncPlayerPreLoginEvent event) {
        if (!plugin.membershipGateEnabled()) return;

        UUID uuid = event.getUniqueId();
        if (plugin.isHardcodedAdmin(uuid)) return;

        SupabaseClient.MembershipStatus status;
        try {
            status = supabase.findMembershipStatusByUuid(uuid.toString());
        } catch (Exception e) {
            plugin.getLogger().log(Level.WARNING, "Membership check failed for " + uuid, e);
            status = null;
        }

        // No linked profile at all, or a profile that isn't an active member:
        // same refusal either way, since both mean "not currently paid up".
        if (status == null || !status.isActive()) {
            String reasonKey = status == null ? "membership_required_unlinked" : "membership_required";
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, plugin.msg(reasonKey));
        }
    }
}
