package com.mca.economy.listener;

import com.mca.economy.EconomyService;
import com.mca.economy.MCAEconomyPlugin;
import com.mca.economy.ShopManager;
import com.mca.economy.model.EconomyAccount;
import com.mca.economy.model.EconomyShop;
import com.mca.economy.supabase.EconomyException;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.block.Chest;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Right-click a shop chest to buy 1 item; left-click to sell 1. Sneaking
 * (shift) skips the shop entirely so the owner can still open the chest
 * normally to restock it or collect proceeds. This is the whole point of
 * the "local trading" goal: no command moves money or items here, only
 * physically clicking the chest does.
 */
public class ShopInteractListener implements Listener {

    private final MCAEconomyPlugin plugin;
    private final EconomyService service;
    private final ShopManager shops;

    // Debounces rapid repeated LEFT_CLICK_BLOCK events (Bukkit fires these
    // continuously while the mouse button is held down over a block).
    private final Map<UUID, Long> lastTrade = new ConcurrentHashMap<>();
    private static final long COOLDOWN_MS = 350;

    public ShopInteractListener(MCAEconomyPlugin plugin, EconomyService service, ShopManager shops) {
        this.plugin = plugin;
        this.service = service;
        this.shops = shops;
    }

    @EventHandler(ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        if (event.getHand() != org.bukkit.inventory.EquipmentSlot.HAND) return; // avoid double-firing for off-hand
        Action action = event.getAction();
        if (action != Action.RIGHT_CLICK_BLOCK && action != Action.LEFT_CLICK_BLOCK) return;

        Block block = event.getClickedBlock();
        if (block == null || !(block.getState() instanceof Chest)) return;

        Player player = event.getPlayer();
        if (player.isSneaking()) return; // let the owner open the chest normally

        EconomyShop shop = shops.get(block);
        if (shop == null) return;

        event.setUseInteractedBlock(org.bukkit.event.Event.Result.DENY);
        event.setCancelled(true);

        long now = System.currentTimeMillis();
        Long last = lastTrade.get(player.getUniqueId());
        if (last != null && now - last < COOLDOWN_MS) return;
        lastTrade.put(player.getUniqueId(), now);

        Material material;
        try {
            material = Material.valueOf(shop.material);
        } catch (IllegalArgumentException e) {
            player.sendMessage(err("This shop's item is no longer valid."));
            return;
        }

        if (action == Action.RIGHT_CLICK_BLOCK) {
            handleBuy(player, block, shop, material);
        } else {
            handleSell(player, block, shop, material);
        }
    }

    private void handleBuy(Player player, Block block, EconomyShop shop, Material material) {
        if (shop.buyPrice == null) {
            player.sendMessage(err("This shop doesn't sell " + material.name() + "."));
            return;
        }
        Chest chest = (Chest) block.getState();
        Inventory chestInv = chest.getInventory();

        if (!chestInv.containsAtLeast(new ItemStack(material, 1), 1)) {
            player.sendMessage(err("Shop is out of stock."));
            return;
        }
        PlayerInventory playerInv = player.getInventory();
        if (playerInv.firstEmpty() == -1 && !hasRoomForOne(playerInv, material)) {
            player.sendMessage(err("Your inventory is full."));
            return;
        }

        // Move the item now (synchronous, main thread); roll back if the payment fails.
        Map<Integer, ItemStack> notRemoved = chestInv.removeItem(new ItemStack(material, 1));
        if (!notRemoved.isEmpty()) {
            player.sendMessage(err("Shop is out of stock."));
            return;
        }
        Map<Integer, ItemStack> notAdded = playerInv.addItem(new ItemStack(material, 1));
        if (!notAdded.isEmpty()) {
            chestInv.addItem(new ItemStack(material, 1)); // put it back
            player.sendMessage(err("Your inventory is full."));
            return;
        }

        BigDecimal price = shop.buyPrice;
        plugin.runAsync(() -> {
            try {
                UUID buyerActorId = service.resolveActor(player.getUniqueId());
                if (buyerActorId == null) {
                    plugin.runSync(() -> rollbackBuy(player, chestInv, material, "Link and verify your Minecraft account on the website first."));
                    return;
                }
                List<EconomyAccount> accounts = service.myAccounts(buyerActorId);
                EconomyAccount buyerAccount = service.getActiveAccount(player.getUniqueId(), accounts);
                if (buyerAccount == null) {
                    plugin.runSync(() -> rollbackBuy(player, chestInv, material, "You don't have an account yet — /bank create personal <name>."));
                    return;
                }
                service.shopTrade(buyerActorId, buyerAccount.id, shop.accountId, price, "Shop purchase: " + material.name());
                plugin.runSync(() -> player.sendMessage(info("Bought 1 " + prettyName(material) + " for " + fmt(price) + " (" + buyerAccount.name + ").")));
            } catch (EconomyException e) {
                plugin.runSync(() -> rollbackBuy(player, chestInv, material, e.getMessage()));
            }
        });
    }

    private void handleSell(Player player, Block block, EconomyShop shop, Material material) {
        if (shop.sellPrice == null) {
            player.sendMessage(err("This shop doesn't buy " + material.name() + "."));
            return;
        }
        ItemStack inHand = player.getInventory().getItemInMainHand();
        if (inHand.getType() != material || inHand.getAmount() < 1) {
            player.sendMessage(err("Hold a " + prettyName(material) + " in your hand to sell it here."));
            return;
        }
        Chest chest = (Chest) block.getState();
        Inventory chestInv = chest.getInventory();
        if (!hasRoomForOne(chestInv, material)) {
            player.sendMessage(err("Shop's chest is full."));
            return;
        }

        inHand.setAmount(inHand.getAmount() - 1);
        player.getInventory().setItemInMainHand(inHand.getAmount() <= 0 ? null : inHand);
        chestInv.addItem(new ItemStack(material, 1));

        BigDecimal price = shop.sellPrice;
        plugin.runAsync(() -> {
            try {
                UUID sellerActorId = service.resolveActor(player.getUniqueId());
                if (sellerActorId == null) {
                    plugin.runSync(() -> rollbackSell(player, chestInv, material, "Link and verify your Minecraft account on the website first."));
                    return;
                }
                List<EconomyAccount> accounts = service.myAccounts(sellerActorId);
                EconomyAccount sellerAccount = service.getActiveAccount(player.getUniqueId(), accounts);
                if (sellerAccount == null) {
                    plugin.runSync(() -> rollbackSell(player, chestInv, material, "You don't have an account yet — /bank create personal <name>."));
                    return;
                }
                service.shopTrade(shop.ownerActorId, shop.accountId, sellerAccount.id, price, "Shop sale: " + material.name());
                plugin.runSync(() -> player.sendMessage(info("Sold 1 " + prettyName(material) + " for " + fmt(price) + " (" + sellerAccount.name + ").")));
            } catch (EconomyException e) {
                plugin.runSync(() -> rollbackSell(player, chestInv, material, e.getMessage()));
            }
        });
    }

    private void rollbackBuy(Player player, Inventory chestInv, Material material, String message) {
        player.getInventory().removeItem(new ItemStack(material, 1));
        chestInv.addItem(new ItemStack(material, 1));
        player.sendMessage(err(message));
    }

    private void rollbackSell(Player player, Inventory chestInv, Material material, String message) {
        chestInv.removeItem(new ItemStack(material, 1));
        player.getInventory().addItem(new ItemStack(material, 1));
        player.sendMessage(err(message));
    }

    private boolean hasRoomForOne(Inventory inv, Material material) {
        for (ItemStack item : inv.getStorageContents()) {
            if (item == null || item.getType().isAir()) return true;
            if (item.getType() == material && item.getAmount() < item.getMaxStackSize()) return true;
        }
        return false;
    }

    private String prettyName(Material material) {
        String[] parts = material.name().toLowerCase(java.util.Locale.ROOT).split("_");
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

    private String info(String text) { return ChatColor.GREEN + text; }
    private String err(String text) { return ChatColor.RED + text; }
}
