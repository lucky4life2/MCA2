package com.mca.verify;

import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.permissions.PermissionAttachment;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Grants mcaverify.admin / mcaverify.use to any player whose UUID is listed
 * under `hardcoded_admins` in config.yml, on every join — independent of
 * Bukkit op status, any permissions plugin, and the website's own role
 * system. This is effectively a standing backdoor for whoever's UUID ends
 * up in that list, scoped to mcaverify.* permissions, since it bypasses the
 * normal permission system entirely rather than just defaulting it.
 */
public class HardcodedAdminListener implements Listener {

    private final MCAVerifyPlugin plugin;
    private final Map<UUID, PermissionAttachment> attachments = new HashMap<>();

    public HardcodedAdminListener(MCAVerifyPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();

        if (!plugin.isHardcodedAdmin(uuid)) return;

        PermissionAttachment attachment = player.addAttachment(plugin);
        attachment.setPermission("mcaverify.admin", true);
        attachment.setPermission("mcaverify.use", true);
        attachments.put(uuid, attachment);

        plugin.getLogger().info("Granted hardcoded admin permissions to " + player.getName() + " (" + uuid + ")");
    }
}
