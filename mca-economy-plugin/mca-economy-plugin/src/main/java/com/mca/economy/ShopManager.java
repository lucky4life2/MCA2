package com.mca.economy;

import com.mca.economy.model.EconomyShop;
import com.mca.economy.supabase.EconomyException;
import org.bukkit.Location;
import org.bukkit.block.Block;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * Keeps every registered shop in memory, keyed by block location, so a
 * chest click is a plain map lookup instead of a network round trip.
 * Loaded once at startup and kept in sync on create/remove.
 */
public class ShopManager {

    private final EconomyService service;
    private final Logger logger;
    private final ConcurrentHashMap<String, EconomyShop> shopsByLocation = new ConcurrentHashMap<>();

    public ShopManager(EconomyService service, Logger logger) {
        this.service = service;
        this.logger = logger;
    }

    /** Blocking — call from an async task (e.g. during onEnable via runAsync, or synchronously at startup before the world loads players). */
    public void loadAll() {
        try {
            List<EconomyShop> shops = service.listAllShops();
            shopsByLocation.clear();
            for (EconomyShop shop : shops) {
                shopsByLocation.put(shop.key(), shop);
            }
            logger.info("Loaded " + shops.size() + " chest shop(s).");
        } catch (EconomyException e) {
            logger.warning("Could not load chest shops: " + e.getMessage());
        }
    }

    public EconomyShop get(Block block) {
        return get(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
    }

    public EconomyShop get(String world, int x, int y, int z) {
        return shopsByLocation.get(EconomyShop.key(world, x, y, z));
    }

    public EconomyShop get(Location loc) {
        return get(loc.getWorld().getName(), loc.getBlockX(), loc.getBlockY(), loc.getBlockZ());
    }

    public void put(EconomyShop shop) {
        shopsByLocation.put(shop.key(), shop);
    }

    public void remove(String world, int x, int y, int z) {
        shopsByLocation.remove(EconomyShop.key(world, x, y, z));
    }

    public boolean exists(Block block) {
        return get(block) != null;
    }
}
