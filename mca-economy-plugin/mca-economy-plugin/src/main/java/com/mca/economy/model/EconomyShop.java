package com.mca.economy.model;

import com.google.gson.JsonObject;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * A physical chest/shelf shop — the whole point of which is that trading
 * happens by right/left-clicking the actual chest in the world, never a
 * command. Mirrors a row of the `economy_shops` table.
 */
public class EconomyShop {
    public final UUID id;
    public final String world;
    public final int x;
    public final int y;
    public final int z;
    public final UUID ownerActorId;
    public final UUID accountId;
    public final String material; // Bukkit Material name, e.g. "DIAMOND"
    public final BigDecimal buyPrice;  // price a player pays to buy 1 from the shop; null = shop doesn't sell
    public final BigDecimal sellPrice; // price the shop pays a player to sell 1 to it; null = shop doesn't buy

    public EconomyShop(UUID id, String world, int x, int y, int z, UUID ownerActorId, UUID accountId,
                        String material, BigDecimal buyPrice, BigDecimal sellPrice) {
        this.id = id;
        this.world = world;
        this.x = x;
        this.y = y;
        this.z = z;
        this.ownerActorId = ownerActorId;
        this.accountId = accountId;
        this.material = material;
        this.buyPrice = buyPrice;
        this.sellPrice = sellPrice;
    }

    /** Key used for the in-memory location -> shop cache. */
    public static String key(String world, int x, int y, int z) {
        return world + "|" + x + "|" + y + "|" + z;
    }

    public String key() {
        return key(world, x, y, z);
    }

    public static EconomyShop fromJson(JsonObject o) {
        return new EconomyShop(
                UUID.fromString(o.get("id").getAsString()),
                o.get("world").getAsString(),
                o.get("x").getAsInt(),
                o.get("y").getAsInt(),
                o.get("z").getAsInt(),
                UUID.fromString(o.get("owner_actor_id").getAsString()),
                UUID.fromString(o.get("account_id").getAsString()),
                o.get("material").getAsString(),
                (o.has("buy_price") && !o.get("buy_price").isJsonNull()) ? o.get("buy_price").getAsBigDecimal() : null,
                (o.has("sell_price") && !o.get("sell_price").isJsonNull()) ? o.get("sell_price").getAsBigDecimal() : null
        );
    }
}
