package com.mca.economy;

import com.google.gson.JsonElement;
import com.mca.economy.model.EconomyAccount;
import com.mca.economy.model.EconomyCompany;
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

    public EconomyService(SupabaseClient client) {
        this.client = client;
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
        JsonElement result = client.select("economy_companies", "is_active=eq.true&order=ticker.asc");
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

    /** How many shares of a company a given account holds. 0 if none. */
    public int getShareholding(UUID accountId, UUID companyId) throws EconomyException {
        String query = "account_id=eq." + accountId + "&company_id=eq." + companyId + "&select=shares&limit=1";
        JsonElement result = client.select("economy_shareholdings", query);
        if (result != null && result.isJsonArray() && !result.getAsJsonArray().isEmpty()) {
            return result.getAsJsonArray().get(0).getAsJsonObject().get("shares").getAsInt();
        }
        return 0;
    }
}
