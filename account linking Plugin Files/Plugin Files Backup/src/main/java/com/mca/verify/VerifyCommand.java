package com.mca.verify;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public class VerifyCommand implements CommandExecutor {

    private final MCAVerifyPlugin plugin;
    private final SupabaseClient supabase;

    public VerifyCommand(MCAVerifyPlugin plugin, SupabaseClient supabase) {
        this.plugin = plugin;
        this.supabase = supabase;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage("This command can only be run in-game.");
            return true;
        }
        Player player = (Player) sender;

        if (args.length != 1 || args[0].trim().isEmpty()) {
            player.sendMessage(plugin.msg("usage"));
            return true;
        }

        String code = args[0].trim().toUpperCase();
        String playerName = player.getName();
        String playerUuid = player.getUniqueId().toString();

        player.sendMessage(plugin.msg("checking"));

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            SupabaseClient.ProfileMatch match = supabase.findByVerifyCode(code);

            plugin.getServer().getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;

                if (match == null) {
                    player.sendMessage(plugin.msg("invalid_or_expired"));
                    return;
                }
                if (match.verified) {
                    player.sendMessage(plugin.msg("already_verified"));
                    return;
                }
                if (match.verifyExpires == null || java.time.Instant.now().isAfter(match.verifyExpires)) {
                    player.sendMessage(plugin.msg("invalid_or_expired"));
                    return;
                }
                if (match.minecraftUsername == null || !match.minecraftUsername.equalsIgnoreCase(playerName)) {
                    String websiteUsername = match.minecraftUsername == null ? "(none)" : match.minecraftUsername;
                    player.sendMessage(plugin.msg("username_mismatch",
                            "%website_username%", websiteUsername,
                            "%player_name%", playerName));
                    return;
                }

                plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
                    String uuidToStore = plugin.uuidTrackingEnabled() ? playerUuid : null;
                    boolean ok = supabase.markVerified(match.id, uuidToStore);

                    plugin.getServer().getScheduler().runTask(plugin, () -> {
                        if (!player.isOnline()) return;
                        if (ok) {
                            player.sendMessage(plugin.msg("success"));
                        } else {
                            player.sendMessage(plugin.msg("error"));
                        }
                    });
                });
            });
        });

        return true;
    }
}
