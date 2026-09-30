package com.mca.verify;

import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.util.UUID;

/**
 * Handles a paid member who joined BEFORE linking their Minecraft account
 * (MembershipGateListener admitted them as "pending link"). They may do
 * exactly one thing: run /mcaverify <code>. Until they do, they can't move,
 * chat, run other commands, touch blocks/items, or take damage, and they are
 * removed after pending_link.timeout_seconds. A successful /mcaverify clears
 * the pending flag (VerifyCommand), which lifts every restriction here.
 */
public class PendingLinkListener implements Listener {

    private final MCAVerifyPlugin plugin;

    public PendingLinkListener(MCAVerifyPlugin plugin) {
        this.plugin = plugin;
    }

    private boolean pending(Player p) {
        return p != null && plugin.isPendingLink(p.getUniqueId());
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        if (!plugin.isPendingLink(uuid)) return;

        long minutes = Math.max(1L, plugin.pendingLinkTimeoutTicks() / 20L / 60L);
        player.sendMessage(plugin.msg("pending_link_intro", "%minutes%", String.valueOf(minutes)));

        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            if (player.isOnline() && plugin.isPendingLink(uuid)) {
                plugin.removePendingLink(uuid);
                player.kickPlayer(plugin.msg("pending_link_timeout"));
            }
        }, plugin.pendingLinkTimeoutTicks());
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        plugin.removePendingLink(event.getPlayer().getUniqueId());
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        if (!pending(event.getPlayer())) return;
        if (event.getTo() == null) return;
        // Looking around is fine; changing position is not.
        if (event.getFrom().getX() != event.getTo().getX()
                || event.getFrom().getY() != event.getTo().getY()
                || event.getFrom().getZ() != event.getTo().getZ()) {
            event.setTo(event.getFrom());
        }
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        if (!pending(event.getPlayer())) return;
        String msg = event.getMessage().toLowerCase();
        if (msg.equals("/mcaverify") || msg.startsWith("/mcaverify ")) return;
        event.setCancelled(true);
    }

    @SuppressWarnings("deprecation")
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onChat(AsyncPlayerChatEvent event) {
        if (pending(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        if (pending(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onInteractEntity(PlayerInteractEntityEvent event) {
        if (pending(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        if (pending(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        if (pending(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onDrop(PlayerDropItemEvent event) {
        if (pending(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onInventoryOpen(InventoryOpenEvent event) {
        if (event.getPlayer() instanceof Player && pending((Player) event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (event.getEntity() instanceof Player && pending((Player) event.getEntity())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onDamageOthers(EntityDamageByEntityEvent event) {
        if (event.getDamager() instanceof Player && pending((Player) event.getDamager())) event.setCancelled(true);
    }
}
