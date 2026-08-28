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
    /** The company's own account, separate from any founder wallet. */
    public final UUID accountId;
    /** Authorized share ceiling — NOT the number in existence. */
    public final int totalShares;
    /** Shares actually issued to holders. Unsold offering shares stay unissued. */
    public final int sharesIssued;
    /** Legacy admin-set price. Kept for the pre-order-book path; never display it as "the price". */
    public final BigDecimal sharePrice;
    /** Price of the last completed trade, or null if the company has never traded. */
    public final BigDecimal lastTradePrice;
    /** draft | pending | private | public | suspended | dissolved */
    public final String status;
    public final boolean tradingHalted;
    public final String haltReason;
    public final boolean active;

    public EconomyCompany(UUID id, String name, String ticker, String description, UUID treasuryAccountId,
                           UUID accountId, int totalShares, int sharesIssued, BigDecimal sharePrice,
                           BigDecimal lastTradePrice, String status, boolean tradingHalted,
                           String haltReason, boolean active) {
        this.id = id;
        this.name = name;
        this.ticker = ticker;
        this.description = description;
        this.treasuryAccountId = treasuryAccountId;
        this.accountId = accountId;
        this.totalShares = totalShares;
        this.sharesIssued = sharesIssued;
        this.sharePrice = sharePrice;
        this.lastTradePrice = lastTradePrice;
        this.status = status;
        this.tradingHalted = tradingHalted;
        this.haltReason = haltReason;
        this.active = active;
    }

    /** Human-readable price for display: the last trade, or an honest "no trades yet". */
    public String displayPrice() {
        return lastTradePrice == null ? "no trades yet" : lastTradePrice.toPlainString() + " Marks";
    }

    public static EconomyCompany fromJson(JsonObject o) {
        return new EconomyCompany(
                UUID.fromString(o.get("id").getAsString()),
                o.get("name").getAsString(),
                o.get("ticker").getAsString(),
                (o.has("description") && !o.get("description").isJsonNull()) ? o.get("description").getAsString() : "",
                UUID.fromString(o.get("treasury_account_id").getAsString()),
                (o.has("account_id") && !o.get("account_id").isJsonNull())
                        ? UUID.fromString(o.get("account_id").getAsString()) : null,
                o.get("total_shares").getAsInt(),
                (o.has("shares_issued") && !o.get("shares_issued").isJsonNull())
                        ? o.get("shares_issued").getAsInt() : 0,
                o.get("share_price").getAsBigDecimal(),
                (o.has("last_trade_price") && !o.get("last_trade_price").isJsonNull())
                        ? o.get("last_trade_price").getAsBigDecimal() : null,
                (o.has("status") && !o.get("status").isJsonNull())
                        ? o.get("status").getAsString() : "public",
                o.has("trading_halted") && !o.get("trading_halted").isJsonNull()
                        && o.get("trading_halted").getAsBoolean(),
                (o.has("halt_reason") && !o.get("halt_reason").isJsonNull())
                        ? o.get("halt_reason").getAsString() : null,
                !o.has("is_active") || o.get("is_active").isJsonNull() || o.get("is_active").getAsBoolean()
        );
    }
}
