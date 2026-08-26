package com.mca.economy.command;

import com.mca.economy.EconomyService;
import com.mca.economy.MCAEconomyPlugin;
import com.mca.economy.ShopManager;
import com.mca.economy.model.EconomyAccount;
import com.mca.economy.model.EconomyShop;
import com.mca.economy.supabase.EconomyException;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.block.Chest;
import org.bukkit.block.Sign;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Sets up and tears down physical chest shops. The actual buying/selling
 * happens by clicking the chest (see ShopInteractListener) — this command
 * only ever configures the shop, never moves money or items itself.
 *
 * Setup: place a sign on the side of a chest, look at the SIGN (not the
 * chest), hold the item the shop should trade in your hand, then run
 * /shop create.
 */
public class ShopCommand implements CommandExecutor, TabCompleter {

    private final MCAEconomyPlugin plugin;
    private final EconomyService service;
    private final ShopManager shops;

    public ShopCommand(MCAEconomyPlugin plugin, EconomyService service, ShopManager shops) {
        this.plugin = plugin;
        this.service = service;
        this.shops = shops;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can use /shop.");
            return true;
        }
        if (args.length == 0) {
            sendUsage(player);
            return true;
        }

        String sub = args[0].toLowerCase(Locale.ROOT);
        switch (sub) {
            case "create" -> handleCreate(player, args);
            case "remove" -> handleRemove(player);
            case "info" -> handleInfo(player);
            default -> sendUsage(player);
        }
        return true;
    }

    private void handleCreate(Player player, String[] args) {
        if (args.length < 4) {
            player.sendMessage(err("Usage: /shop create <account> <buyPrice|-> <sellPrice|->"));
            return;
        }

        Block signBlock = targetedSign(player);
        if (signBlock == null) {
            player.sendMessage(err("Look at a sign attached to a chest first — place one on the side of the chest."));
            return;
        }
        Block chestBlock = attachedChest(signBlock);
        if (chestBlock == null) {
            player.sendMessage(err("That sign isn't attached to a chest."));
            return;
        }
        if (shops.exists(chestBlock)) {
            player.sendMessage(err("That chest is already a shop — /shop remove it first."));
            return;
        }

        ItemStack inHand = player.getInventory().getItemInMainHand();
        if (inHand == null || inHand.getType().isAir()) {
            player.sendMessage(err("Hold the item you want this shop to trade."));
            return;
        }
        String material = inHand.getType().name();

        BigDecimal buyPrice = parsePriceArg(args[2]);
        BigDecimal sellPrice = parsePriceArg(args[3]);
        if (buyPrice == null && sellPrice == null) {
            player.sendMessage(err("Set at least a buy price or a sell price (use \"-\" for the one you don't want)."));
            return;
        }
        if ((buyPrice != null && buyPrice.signum() < 0) || (sellPrice != null && sellPrice.signum() < 0)) {
            player.sendMessage(err("Prices can't be negative."));
            return;
        }

        String accountToken = args[1];
        String world = chestBlock.getWorld().getName();
        int x = chestBlock.getX(), y = chestBlock.getY(), z = chestBlock.getZ();
        Material displayMaterial = inHand.getType();
        String materialFinal = material;

        plugin.runAsync(() -> {
            try {
                UUID actorId = service.resolveActor(player.getUniqueId());
                if (actorId == null) {
                    plugin.runSync(() -> player.sendMessage(err("Link and verify your Minecraft account on the website first.")));
                    return;
                }
                List<EconomyAccount> accounts = service.myAccounts(actorId);
                EconomyAccount account = accounts.stream()
                        .filter(a -> a.name.equalsIgnoreCase(accountToken) || a.type.equalsIgnoreCase(accountToken))
                        .findFirst().orElse(null);
                if (account == null) {
                    plugin.runSync(() -> player.sendMessage(err("No account of yours matches \"" + accountToken + "\".")));
                    return;
                }
                if (account.frozen) {
                    plugin.runSync(() -> player.sendMessage(err("That account is frozen.")));
                    return;
                }

                EconomyShop shop = service.createShop(world, x, y, z, actorId, account.id, materialFinal, buyPrice, sellPrice);
                shops.put(shop);

                plugin.runSync(() -> {
                    writeSign(signBlock, player.getName(), displayMaterial, buyPrice, sellPrice);
                    player.sendMessage(info("Shop created — trading " + displayMaterial.name() + " via \"" + account.name + "\"."));
                });
            } catch (EconomyException e) {
                plugin.runSync(() -> player.sendMessage(err(e.getMessage())));
            }
        });
    }

    private void handleRemove(Player player) {
        Block block = targetedShopBlock(player);
        if (block == null) {
            player.sendMessage(err("Look at a shop chest (or its sign) first."));
            return;
        }
        EconomyShop shop = shops.get(block);
        if (shop == null) {
            player.sendMessage(err("That's not a shop."));
            return;
        }

        plugin.runAsync(() -> {
            try {
                UUID actorId = service.resolveActor(player.getUniqueId());
                boolean isOwner = actorId != null && actorId.equals(shop.ownerActorId);
                if (!isOwner && !player.hasPermission("mcaeconomy.admin")) {
                    plugin.runSync(() -> player.sendMessage(err("You don't own this shop.")));
                    return;
                }
                service.removeShop(shop.world, shop.x, shop.y, shop.z);
                shops.remove(shop.world, shop.x, shop.y, shop.z);
                plugin.runSync(() -> {
                    clearAttachedSign(block);
                    player.sendMessage(info("Shop removed."));
                });
            } catch (EconomyException e) {
                plugin.runSync(() -> player.sendMessage(err(e.getMessage())));
            }
        });
    }

    private void handleInfo(Player player) {
        Block block = targetedShopBlock(player);
        EconomyShop shop = block == null ? null : shops.get(block);
        if (shop == null) {
            player.sendMessage(err("Look at a shop chest (or its sign) first."));
            return;
        }
        player.sendMessage(info("Shop: " + shop.material));
        player.sendMessage(line("Buy:  " + (shop.buyPrice != null ? fmt(shop.buyPrice) + " each" : "not for sale")));
        player.sendMessage(line("Sell: " + (shop.sellPrice != null ? fmt(shop.sellPrice) + " each" : "shop doesn't buy")));
    }

    // ── Helpers ──

    private BigDecimal parsePriceArg(String token) {
        if (token.equals("-")) return null;
        try {
            return new BigDecimal(token);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private Block targetedSign(Player player) {
        Block block = player.getTargetBlockExact(6);
        if (block == null) return null;
        return (block.getState() instanceof Sign) ? block : null;
    }

    /** Either the chest itself or its attached sign, whichever the player is looking at. */
    private Block targetedShopBlock(Player player) {
        Block block = player.getTargetBlockExact(6);
        if (block == null) return null;
        if (shops.exists(block)) return block;
        if (block.getState() instanceof Sign) {
            Block chest = attachedChest(block);
            if (chest != null && shops.exists(chest)) return chest;
        }
        return null;
    }

    private Block attachedChest(Block signBlock) {
        if (!(signBlock.getBlockData() instanceof WallSign wallSign)) return null;
        Block behind = signBlock.getRelative(wallSign.getFacing().getOppositeFace());
        BlockState state = behind.getState();
        return (state instanceof Chest) ? behind : null;
    }

    private void writeSign(Block signBlock, String ownerName, Material material, BigDecimal buyPrice, BigDecimal sellPrice) {
        BlockState state = signBlock.getState();
        if (!(state instanceof Sign sign)) return;
        sign.setLine(0, ChatColor.DARK_GREEN + "[Shop]");
        sign.setLine(1, ownerName);
        sign.setLine(2, prettyMaterial(material));
        StringBuilder priceLine = new StringBuilder();
        if (buyPrice != null) priceLine.append("B:").append(fmt(buyPrice));
        if (buyPrice != null && sellPrice != null) priceLine.append(" ");
        if (sellPrice != null) priceLine.append("S:").append(fmt(sellPrice));
        sign.setLine(3, priceLine.toString());
        sign.update(true);
    }

    private void clearAttachedSign(Block chestBlock) {
        for (org.bukkit.block.BlockFace face : org.bukkit.block.BlockFace.values()) {
            Block adj = chestBlock.getRelative(face);
            if (adj.getState() instanceof Sign sign && adj.getBlockData() instanceof WallSign wallSign
                    && adj.getRelative(wallSign.getFacing().getOppositeFace()).equals(chestBlock)) {
                for (int i = 0; i < 4; i++) sign.setLine(i, "");
                sign.update(true);
            }
        }
    }

    private String prettyMaterial(Material material) {
        String[] parts = material.name().toLowerCase(Locale.ROOT).split("_");
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(Character.toUpperCase(p.charAt(0))).append(p.substring(1));
        }
        return sb.toString();
    }

    private String fmt(BigDecimal amount) {
        return plugin.getCurrencySymbol() + String.format("%,.2f", amount);
    }

    private void sendUsage(Player player) {
        player.sendMessage(header("Shop Commands"));
        player.sendMessage(line("/shop create <account> <buyPrice|-> <sellPrice|-> — turn the chest behind the sign you're looking at into a shop, trading whatever's in your hand"));
        player.sendMessage(line("/shop remove — look at your shop (or its sign) and remove it"));
        player.sendMessage(line("/shop info — look at a shop to see its prices"));
    }

    private String header(String text) { return ChatColor.GOLD + "" + ChatColor.BOLD + text; }
    private String line(String text) { return ChatColor.GRAY + "• " + ChatColor.RESET + text; }
    private String info(String text) { return ChatColor.GREEN + text; }
    private String err(String text) { return ChatColor.RED + text; }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) {
            return filter(List.of("create", "remove", "info"), args[0]);
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("create")) {
            return filter(List.of("personal", "business"), args[1]);
        }
        if (args.length == 3 && args[0].equalsIgnoreCase("create")) {
            return filter(List.of("-", "1.00", "10.00"), args[2]);
        }
        if (args.length == 4 && args[0].equalsIgnoreCase("create")) {
            return filter(List.of("-", "1.00", "5.00"), args[3]);
        }
        return new ArrayList<>();
    }

    private List<String> filter(List<String> options, String prefix) {
        return options.stream()
                .filter(o -> o.toLowerCase(Locale.ROOT).startsWith(prefix.toLowerCase(Locale.ROOT)))
                .collect(Collectors.toList());
    }
}
