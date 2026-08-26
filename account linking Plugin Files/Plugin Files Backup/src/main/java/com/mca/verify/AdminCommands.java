package com.mca.verify;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

public class AdminCommands implements CommandExecutor {

    private final MCAVerifyPlugin plugin;
    private final SupabaseClient supabase;

    public AdminCommands(MCAVerifyPlugin plugin, SupabaseClient supabase) {
        this.plugin = plugin;
        this.supabase = supabase;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        boolean isHardcodedAdmin = sender instanceof Player
                && plugin.isHardcodedAdmin(((Player) sender).getUniqueId());

        if (!sender.hasPermission("mcaverify.admin") && !isHardcodedAdmin) {
            sender.sendMessage(plugin.msg("no_permission"));
            return true;
        }

        if (args.length != 1 || args[0].trim().isEmpty()) {
            sender.sendMessage("Usage: /" + label + " <player>");
            return true;
        }

        String targetName = args[0].trim();

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            SupabaseClient.ProfileMatch match = supabase.findByMinecraftUsername(targetName);

            if (match == null) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                        sender.sendMessage(plugin.msg("lookup_not_found", "%player_name%", targetName)));
                return;
            }

            if (label.equalsIgnoreCase("mcalookup")) {
                plugin.getServer().getScheduler().runTask(plugin, () ->
                        sender.sendMessage(plugin.msg("lookup_found",
                                "%player_name%", targetName,
                                "%website_username%", String.valueOf(match.minecraftUsername),
                                "%verified%", String.valueOf(match.verified))));
                return;
            }

            // /mcaunverify
            boolean ok = supabase.clearVerification(match.id);
            plugin.getServer().getScheduler().runTask(plugin, () -> {
                if (ok) {
                    sender.sendMessage(plugin.msg("unverify_done", "%player_name%", targetName));
                } else {
                    sender.sendMessage(plugin.msg("error"));
                }
            });
        });

        return true;
    }
}
