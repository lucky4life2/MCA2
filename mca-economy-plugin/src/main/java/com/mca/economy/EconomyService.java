package com.mca.economy;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mca.economy.model.EconomyAccount;
import com.mca.economy.model.EconomyCompany;
import com.mca.economy.model.EconomyShop;
import com.mca.economy.supabase.EconomyException;
import com.mca.economy.supabase.SupabaseClient;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Every method here makes a BLOCKING network call and must only be invoked
 * from an async thread (see MCAEconomyPlugin#runAsync) unless documented
 * otherwise. Commands hop onto an async task before calling into here,
 * then hop back to the main thread to touch Bukkit API / send messages.
 */
public class EconomyService {

    private final SupabaseClient client;

    // Minecraft UUID -> website profile id. Cached because verification rarely changes.
    private final Map<UUID, UUID> actorCache = new ConcurrentHashMap<>();
    // profile id -> that player's accounts. Cleared after any mutation so the next read is fresh.
    private final Map<UUID, List<EconomyAccount>> accountsCache = new ConcurrentHashMap<>();

    // Minecraft UUID -> which of that player's accounts local shop trades (buy/sell at a chest)
    // should use. Purely in-memory and per-session; defaults to their personal account.
    private final Map<UUID, UUID> activeAccountCache = new ConcurrentHashMap<>();

    public EconomyService(SupabaseClient client) {
        this.client = client;
    }

    public void setActiveAccount(UUID minecraftUuid, UUID accountId) {
        activeAccountCache.put(minecraftUuid, accountId);
    }

    /** The account a player's chest trades should use: their explicit /bank use choice, else their personal account, else null. */
    public EconomyAccount getActiveAccount(UUID minecraftUuid, List<EconomyAccount> accounts) {
        UUID chosen = activeAccountCache.get(minecraftUuid);
        if (chosen != null) {
            for (EconomyAccount a : accounts) if (a.id.equals(chosen)) return a;
        }
        for (EconomyAccount a : accounts) if ("personal".equals(a.type)) return a;
        return accounts.isEmpty() ? null : accounts.get(0);
    }

    /** Resolves a player's verified website profile id from their Minecraft UUID, or null if unlinked/unverified. */
    public UUID resolveActor(UUID minecraftUuid) throws EconomyException {
        UUID cached = actorCache.get(minecraftUuid);
        if (cached != null) return cached;

        JsonElement result = client.rpc("_economy_resolve_actor", Map.of("p_minecraft_uuid", minecraftUuid.toString()));
        if (result == null || result.isJsonNull()) return null;
        UUID actorId = UUID.fromString(result.getAsString());
        actorCache.put(minecraftUuid, actorId);
        return actorId;
    }

    public void invalidateActor(UUID minecraftUuid) {
        actorCache.remove(minecraftUuid);
    }

    public List<EconomyAccount> myAccounts(UUID actorId) throws EconomyException {
        JsonElement result = client.rpc("_economy_my_accounts", Map.of("p_actor", actorId.toString()));
        List<EconomyAccount> accounts = new ArrayList<>();
        if (result != null && result.isJsonArray()) {
            for (JsonElement el : result.getAsJsonArray()) {
                accounts.add(EconomyAccount.fromJson(el.getAsJsonObject()));
            }
        }
        accountsCache.put(actorId, accounts);
        return accounts;
    }

    /** Returns the cached account list if present, otherwise fetches fresh. */
    public List<EconomyAccount> myAccountsCached(UUID actorId) throws EconomyException {
        List<EconomyAccount> cached = accountsCache.get(actorId);
        return cached != null ? cached : myAccounts(actorId);
    }

    public EconomyAccount createAccount(UUID actorId, String type, String name, UUID nationId) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actorId.toString());
        params.put("p_type", type);
        params.put("p_name", name);
        params.put("p_nation_id", nationId != null ? nationId.toString() : null);
        JsonElement result = client.rpc("_economy_create_account", params);
        accountsCache.remove(actorId);
        return EconomyAccount.fromJson(result.getAsJsonObject());
    }

    public void addAccountMember(UUID actorId, UUID accountId, UUID newMemberProfileId) throws EconomyException {
        client.rpc("_economy_add_account_member", Map.of(
                "p_actor", actorId.toString(),
                "p_account_id", accountId.toString(),
                "p_user_id", newMemberProfileId.toString()
        ));
    }

    public void transfer(UUID actorId, UUID fromAccountId, UUID toAccountId, BigDecimal amount, String memo) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actorId.toString());
        params.put("p_from", fromAccountId.toString());
        params.put("p_to", toAccountId.toString());
        params.put("p_amount", amount);
        params.put("p_memo", memo);
        client.rpc("_economy_transfer", params);
        accountsCache.remove(actorId);
    }

    public EconomyAccount withdraw(UUID actorId, UUID accountId, BigDecimal amount, String memo) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actorId.toString());
        params.put("p_account_id", accountId.toString());
        params.put("p_amount", amount);
        params.put("p_memo", memo);
        JsonElement result = client.rpc("_economy_withdraw", params);
        accountsCache.remove(actorId);
        return EconomyAccount.fromJson(result.getAsJsonObject());
    }

    public EconomyAccount deposit(UUID actorId, UUID accountId, BigDecimal amount, String memo) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actorId.toString());
        params.put("p_account_id", accountId.toString());
        params.put("p_amount", amount);
        params.put("p_memo", memo);
        JsonElement result = client.rpc("_economy_deposit", params);
        accountsCache.remove(actorId);
        return EconomyAccount.fromJson(result.getAsJsonObject());
    }

    public EconomyCompany createCompany(UUID actorId, String name, String ticker, String description,
                                         UUID treasuryAccountId, int totalShares, BigDecimal initialPrice) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actorId.toString());
        params.put("p_name", name);
        params.put("p_ticker", ticker);
        params.put("p_description", description);
        params.put("p_treasury_account_id", treasuryAccountId.toString());
        params.put("p_total_shares", totalShares);
        params.put("p_initial_price", initialPrice);
        JsonElement result = client.rpc("_economy_create_company", params);
        return EconomyCompany.fromJson(result.getAsJsonObject());
    }

    public EconomyCompany setSharePrice(UUID actorId, UUID companyId, BigDecimal price) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actorId.toString());
        params.put("p_company_id", companyId.toString());
        params.put("p_price", price);
        JsonElement result = client.rpc("_economy_set_share_price", params);
        return EconomyCompany.fromJson(result.getAsJsonObject());
    }

    public void buyShares(UUID actorId, UUID accountId, UUID companyId, int shares) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actorId.toString());
        params.put("p_account_id", accountId.toString());
        params.put("p_company_id", companyId.toString());
        params.put("p_shares", shares);
        client.rpc("_economy_buy_shares", params);
        accountsCache.remove(actorId);
    }

    public void sellShares(UUID actorId, UUID accountId, UUID companyId, int shares) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actorId.toString());
        params.put("p_account_id", accountId.toString());
        params.put("p_company_id", companyId.toString());
        params.put("p_shares", shares);
        client.rpc("_economy_sell_shares", params);
        accountsCache.remove(actorId);
    }

    /** Companies are publicly readable (RLS allows select for everyone), read straight from the table. */
    public List<EconomyCompany> listCompanies() throws EconomyException {
        // status is the lifecycle truth now; is_active is derived from it.
        JsonElement result = client.select("economy_companies", "status=eq.public&order=ticker.asc");
        List<EconomyCompany> companies = new ArrayList<>();
        if (result != null && result.isJsonArray()) {
            for (JsonElement el : result.getAsJsonArray()) {
                companies.add(EconomyCompany.fromJson(el.getAsJsonObject()));
            }
        }
        return companies;
    }

    public EconomyCompany getCompanyByTicker(String ticker) throws EconomyException {
        String encoded = URLEncoder.encode(ticker.toUpperCase(), StandardCharsets.UTF_8);
        JsonElement result = client.select("economy_companies", "ticker=eq." + encoded + "&limit=1");
        if (result != null && result.isJsonArray() && !result.getAsJsonArray().isEmpty()) {
            return EconomyCompany.fromJson(result.getAsJsonArray().get(0).getAsJsonObject());
        }
        return null;
    }

    /**
     * How many shares of a company an account OWNS in total: available plus
     * whatever is reserved against open sell orders on the website exchange.
     * `shares` alone would under-report anyone with a resting sell order.
     */
    public int getShareholding(UUID accountId, UUID companyId) throws EconomyException {
        String query = "account_id=eq." + accountId + "&company_id=eq." + companyId
                + "&select=shares,reserved_shares&limit=1";
        JsonElement result = client.select("economy_shareholdings", query);
        if (result != null && result.isJsonArray() && !result.getAsJsonArray().isEmpty()) {
            JsonObject row = result.getAsJsonArray().get(0).getAsJsonObject();
            int available = row.get("shares").getAsInt();
            int reserved = (row.has("reserved_shares") && !row.get("reserved_shares").isJsonNull())
                    ? row.get("reserved_shares").getAsInt() : 0;
            return available + reserved;
        }
        return 0;
    }

    /** Shares free to sell right now, excluding any reserved against open orders. */
    public int getAvailableShareholding(UUID accountId, UUID companyId) throws EconomyException {
        String query = "account_id=eq." + accountId + "&company_id=eq." + companyId + "&select=shares&limit=1";
        JsonElement result = client.select("economy_shareholdings", query);
        if (result != null && result.isJsonArray() && !result.getAsJsonArray().isEmpty()) {
            return result.getAsJsonArray().get(0).getAsJsonObject().get("shares").getAsInt();
        }
        return 0;
    }

    // ── Physical chest shops ──
    // These bypass the actor-scoped _economy_* RPCs entirely: the plugin holds
    // the service_role key, and a shop's buy/sell prices were set by its owner
    // in advance, so a trade at the chest is authorized by the shop's existence,
    // not by the clicking player being a member of the owner's account.

    /** Loads every registered shop, for warming the in-memory cache on startup. */
    public List<EconomyShop> listAllShops() throws EconomyException {
        JsonElement result = client.select("economy_shops", "select=*");
        List<EconomyShop> shops = new ArrayList<>();
        if (result != null && result.isJsonArray()) {
            for (JsonElement el : result.getAsJsonArray()) {
                shops.add(EconomyShop.fromJson(el.getAsJsonObject()));
            }
        }
        return shops;
    }

    public EconomyShop createShop(String world, int x, int y, int z, UUID ownerActorId, UUID accountId,
                                   String material, BigDecimal buyPrice, BigDecimal sellPrice) throws EconomyException {
        Map<String, Object> row = new HashMap<>();
        row.put("world", world);
        row.put("x", x);
        row.put("y", y);
        row.put("z", z);
        row.put("owner_actor_id", ownerActorId.toString());
        row.put("account_id", accountId.toString());
        row.put("material", material);
        row.put("buy_price", buyPrice);
        row.put("sell_price", sellPrice);
        JsonElement result = client.insert("economy_shops", row);
        JsonElement created = result.isJsonArray() ? result.getAsJsonArray().get(0) : result;
        return EconomyShop.fromJson(created.getAsJsonObject());
    }

    public void removeShop(String world, int x, int y, int z) throws EconomyException {
        String query = "world=eq." + URLEncoder.encode(world, StandardCharsets.UTF_8) + "&x=eq." + x + "&y=eq." + y + "&z=eq." + z;
        client.delete("economy_shops", query);
    }

    /** Runs a shop trade directly as the shop owner (buy) or has the owner pay out (sell) — see class note above. */
    public void shopTrade(UUID actingActorId, UUID fromAccountId, UUID toAccountId, BigDecimal amount, String memo) throws EconomyException {
        Map<String, Object> params = new HashMap<>();
        params.put("p_actor", actingActorId.toString());
        params.put("p_from", fromAccountId.toString());
        params.put("p_to", toAccountId.toString());
        params.put("p_amount", amount);
        params.put("p_memo", memo);
        client.rpc("_economy_transfer", params);
        accountsCache.remove(actingActorId);
    }
}
