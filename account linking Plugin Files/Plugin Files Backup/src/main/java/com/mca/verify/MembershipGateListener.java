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

        SupabaseClient.MembershipState s;
        try {
            s = supabase.getMembershipState(uuid.toString());
        } catch (SupabaseClient.MembershipLookupException e) {
            // The lookup itself failed — Supabase is down or unreachable.
            // That is not the same as "this player has no membership", and
            // used to be reported to the player as "go buy a membership".
            // The gate protects paid access, so the default is still to
            // refuse, but with an honest message and a config switch for
            // admins who would rather keep the server open through an
            // outage than lock out everyone who has paid.
            plugin.getLogger().log(Level.WARNING, "Membership check failed for " + uuid, e);
            if (plugin.denyOnMembershipLookupError()) {
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, plugin.msg("membership_check_unavailable"));
            }
            return;
        }

        // Same rules as the website and the database (user_meets_membership_gate):
        // staff bypass; account status first (frozen/terminated get their own
        // message, not a membership prompt); then active, grace and
        // cancelled-but-still-paid may join.
        if (!s.linked) {
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, plugin.msg("membership_required_unlinked"));
            return;
        }
        if (s.bypass) return;
        if (!s.accountOk()) {
            String key = "frozen".equals(s.accountStatus) ? "account_frozen"
                    : "terminated".equals(s.accountStatus) ? "account_terminated"
                    : "account_unavailable";
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, plugin.msg(key));
            return;
        }
        if (s.membershipOk()) return;
        if ("expired".equals(s.state)) {
            String date = s.expiresAt == null ? "recently"
                    : java.time.format.DateTimeFormatter.ofPattern("MMMM d, yyyy")
                        .withZone(java.time.ZoneOffset.UTC).format(s.expiresAt);
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, plugin.msg("membership_expired", "%date%", date));
            return;
        }
        event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, plugin.msg("membership_required"));
    }
}
