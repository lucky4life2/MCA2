package com.mca.economy.model;

import com.google.gson.JsonObject;

import java.math.BigDecimal;
import java.util.UUID;

/** Mirrors a row of the `economy_companies` table. */
public class EconomyCompany {
    public final UUID id;
    public final String name;
    public final String ticker;
    public final String description;
    public final UUID treasuryAccountId;
    public final int totalShares;
    public final BigDecimal sharePrice;
    public final boolean active;

    public EconomyCompany(UUID id, String name, String ticker, String description, UUID treasuryAccountId,
                           int totalShares, BigDecimal sharePrice, boolean active) {
        this.id = id;
        this.name = name;
        this.ticker = ticker;
        this.description = description;
        this.treasuryAccountId = treasuryAccountId;
        this.totalShares = totalShares;
        this.sharePrice = sharePrice;
        this.active = active;
    }

    public static EconomyCompany fromJson(JsonObject o) {
        return new EconomyCompany(
                UUID.fromString(o.get("id").getAsString()),
                o.get("name").getAsString(),
                o.get("ticker").getAsString(),
                (o.has("description") && !o.get("description").isJsonNull()) ? o.get("description").getAsString() : "",
                UUID.fromString(o.get("treasury_account_id").getAsString()),
                o.get("total_shares").getAsInt(),
                o.get("share_price").getAsBigDecimal(),
                !o.has("is_active") || o.get("is_active").isJsonNull() || o.get("is_active").getAsBoolean()
        );
    }
}
