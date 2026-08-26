package com.mca.economy.model;

import com.google.gson.JsonObject;

import java.math.BigDecimal;
import java.util.UUID;

/** Mirrors a row of the `economy_accounts` table (personal, business, nation, or company). */
public class EconomyAccount {
    public final UUID id;
    public final UUID ownerId;
    public final String type; // "personal" | "business" | "nation" | "company"
    public final String name;
    public final BigDecimal balance;
    public final UUID nationId; // only set for type = "nation"
    public final boolean frozen;

    public EconomyAccount(UUID id, UUID ownerId, String type, String name, BigDecimal balance, UUID nationId, boolean frozen) {
        this.id = id;
        this.ownerId = ownerId;
        this.type = type;
        this.name = name;
        this.balance = balance;
        this.nationId = nationId;
        this.frozen = frozen;
    }

    public static EconomyAccount fromJson(JsonObject o) {
        return new EconomyAccount(
                UUID.fromString(o.get("id").getAsString()),
                UUID.fromString(o.get("owner_id").getAsString()),
                o.get("type").getAsString(),
                o.get("name").getAsString(),
                o.get("balance").getAsBigDecimal(),
                (o.has("nation_id") && !o.get("nation_id").isJsonNull()) ? UUID.fromString(o.get("nation_id").getAsString()) : null,
                o.has("is_frozen") && !o.get("is_frozen").isJsonNull() && o.get("is_frozen").getAsBoolean()
        );
    }
}
