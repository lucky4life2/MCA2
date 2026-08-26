package com.mca.economy.vault;

import com.mca.economy.EconomyService;
import com.mca.economy.MCAEconomyPlugin;
import com.mca.economy.model.EconomyAccount;
import com.mca.economy.supabase.EconomyException;
import net.milkbowl.vault.economy.Economy;
import net.milkbowl.vault.economy.EconomyResponse;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * Bridges Vault's Economy interface to a player's PERSONAL MCA account.
 * Business, nation, and company accounts aren't reachable through Vault
 * (its interface only has one balance per player) — those are managed
 * through /bank and /company instead, and Vault-based plugins like
 * ChestShop only ever move money in or out of a player's personal
 * balance, exactly like a normal shop plugin would.
 *
 * getBalance()/has()/hasAccount() are served from a local cache refreshed
 * on join and on a timer, so they never block the main thread.
 * withdrawPlayer()/depositPlayer() make a blocking Supabase call on
 * whichever thread calls them — the same trade-off most database-backed
 * economy plugins make. On a small community server this is fine; if
 * trade volume ever gets heavy, move ChestShop-triggered calls onto an
 * async task yourself.
 */
public class VaultEconomyProvider implements Economy {

    private final MCAEconomyPlugin plugin;
    private final EconomyService service;

    private final Map<UUID, EconomyAccount> personalAccounts = new ConcurrentHashMap<>();

    public VaultEconomyProvider(MCAEconomyPlugin plugin, EconomyService service) {
        this.plugin = plugin;
        this.service = service;
    }

    // ── Cache management — called by the plugin, not part of the Vault interface ──

    /** Refreshes the cached personal account for a player. Safe to call from any thread. */
    public void refresh(UUID minecraftUuid) {
        try {
            UUID actorId = service.resolveActor(minecraftUuid);
            if (actorId == null) return; // not linked/verified on the website yet
            List<EconomyAccount> accounts = service.myAccounts(actorId);
            accounts.stream()
                    .filter(a -> "personal".equals(a.type))
                    .findFirst()
                    .ifPresent(a -> personalAccounts.put(minecraftUuid, a));
        } catch (EconomyException e) {
            plugin.getLogger().log(Level.WARNING, "Could not refresh economy account for " + minecraftUuid, e);
        }
    }

    public void invalidate(UUID minecraftUuid) {
        personalAccounts.remove(minecraftUuid);
    }

    private EconomyAccount cached(OfflinePlayer player) {
        return personalAccounts.get(player.getUniqueId());
    }

    // ── Vault Economy interface ──

    @Override public boolean isEnabled() { return true; }
    @Override public String getName() { return "MCAEconomy"; }
    @Override public boolean hasBankSupport() { return false; }
    @Override public int fractionalDigits() { return 2; }

    @Override public String format(double amount) {
        return plugin.getCurrencySymbol() + String.format("%,.2f", amount);
    }
    @Override public String currencyNamePlural() { return plugin.getCurrencyNamePlural(); }
    @Override public String currencyNameSingular() { return plugin.getCurrencyNameSingular(); }

    @Override public boolean hasAccount(String playerName) { return hasAccount(Bukkit.getOfflinePlayer(playerName)); }
    @Override public boolean hasAccount(OfflinePlayer player) { return cached(player) != null; }
    @Override public boolean hasAccount(String playerName, String worldName) { return hasAccount(playerName); }
    @Override public boolean hasAccount(OfflinePlayer player, String worldName) { return hasAccount(player); }

    @Override public double getBalance(String playerName) { return getBalance(Bukkit.getOfflinePlayer(playerName)); }
    @Override public double getBalance(OfflinePlayer player) {
        EconomyAccount account = cached(player);
        return account != null ? account.balance.doubleValue() : 0.0;
    }
    @Override public double getBalance(String playerName, String world) { return getBalance(playerName); }
    @Override public double getBalance(OfflinePlayer player, String world) { return getBalance(player); }

    @Override public boolean has(String playerName, double amount) { return has(Bukkit.getOfflinePlayer(playerName), amount); }
    @Override public boolean has(OfflinePlayer player, double amount) { return getBalance(player) >= amount; }
    @Override public boolean has(String playerName, String worldName, double amount) { return has(playerName, amount); }
    @Override public boolean has(OfflinePlayer player, String worldName, double amount) { return has(player, amount); }

    @Override public EconomyResponse withdrawPlayer(String playerName, double amount) { return withdrawPlayer(Bukkit.getOfflinePlayer(playerName), amount); }
    @Override public EconomyResponse withdrawPlayer(OfflinePlayer player, double amount) {
        EconomyAccount account = cached(player);
        if (account == null) {
            return new EconomyResponse(0, 0, EconomyResponse.ResponseType.FAILURE,
                    "No linked MCA account yet — link your Minecraft account on the website first.");
        }
        if (account.balance.doubleValue() < amount) {
            return new EconomyResponse(0, account.balance.doubleValue(), EconomyResponse.ResponseType.FAILURE, "Insufficient funds.");
        }
        try {
            UUID actorId = service.resolveActor(player.getUniqueId());
            service.withdraw(actorId, account.id, BigDecimal.valueOf(amount).setScale(2, RoundingMode.HALF_UP), "Vault withdrawal");
            refresh(player.getUniqueId());
            return new EconomyResponse(amount, getBalance(player), EconomyResponse.ResponseType.SUCCESS, "");
        } catch (EconomyException e) {
            return new EconomyResponse(0, account.balance.doubleValue(), EconomyResponse.ResponseType.FAILURE, e.getMessage());
        }
    }
    @Override public EconomyResponse withdrawPlayer(String playerName, String worldName, double amount) { return withdrawPlayer(playerName, amount); }
    @Override public EconomyResponse withdrawPlayer(OfflinePlayer player, String worldName, double amount) { return withdrawPlayer(player, amount); }

    @Override public EconomyResponse depositPlayer(String playerName, double amount) { return depositPlayer(Bukkit.getOfflinePlayer(playerName), amount); }
    @Override public EconomyResponse depositPlayer(OfflinePlayer player, double amount) {
        EconomyAccount account = cached(player);
        if (account == null) {
            return new EconomyResponse(0, 0, EconomyResponse.ResponseType.FAILURE,
                    "No linked MCA account yet — link your Minecraft account on the website first.");
        }
        try {
            UUID actorId = service.resolveActor(player.getUniqueId());
            service.deposit(actorId, account.id, BigDecimal.valueOf(amount).setScale(2, RoundingMode.HALF_UP), "Vault deposit");
            refresh(player.getUniqueId());
            return new EconomyResponse(amount, getBalance(player), EconomyResponse.ResponseType.SUCCESS, "");
        } catch (EconomyException e) {
            return new EconomyResponse(0, account.balance.doubleValue(), EconomyResponse.ResponseType.FAILURE, e.getMessage());
        }
    }
    @Override public EconomyResponse depositPlayer(String playerName, String worldName, double amount) { return depositPlayer(playerName, amount); }
    @Override public EconomyResponse depositPlayer(OfflinePlayer player, String worldName, double amount) { return depositPlayer(player, amount); }

    // Shared/multi-owner "bank" accounts aren't exposed through Vault's legacy bank API —
    // use /bank and /company for business, nation, and company accounts instead.
    private EconomyResponse notSupported() {
        return new EconomyResponse(0, 0, EconomyResponse.ResponseType.NOT_IMPLEMENTED, "Use /bank for business and nation accounts.");
    }
    @Override public EconomyResponse createBank(String name, String player) { return notSupported(); }
    @Override public EconomyResponse createBank(String name, OfflinePlayer player) { return notSupported(); }
    @Override public EconomyResponse deleteBank(String name) { return notSupported(); }
    @Override public EconomyResponse bankBalance(String name) { return notSupported(); }
    @Override public EconomyResponse bankHas(String name, double amount) { return notSupported(); }
    @Override public EconomyResponse bankWithdraw(String name, double amount) { return notSupported(); }
    @Override public EconomyResponse bankDeposit(String name, double amount) { return notSupported(); }
    @Override public EconomyResponse isBankOwner(String name, String playerName) { return notSupported(); }
    @Override public EconomyResponse isBankOwner(String name, OfflinePlayer player) { return notSupported(); }
    @Override public EconomyResponse isBankMember(String name, String playerName) { return notSupported(); }
    @Override public EconomyResponse isBankMember(String name, OfflinePlayer player) { return notSupported(); }
    @Override public List<String> getBanks() { return List.of(); }

    @Override public boolean createPlayerAccount(String playerName) { return createPlayerAccount(Bukkit.getOfflinePlayer(playerName)); }
    @Override public boolean createPlayerAccount(OfflinePlayer player) {
        if (hasAccount(player)) return true;
        try {
            UUID actorId = service.resolveActor(player.getUniqueId());
            if (actorId == null) return false; // not linked/verified on the website
            String name = (player.getName() != null ? player.getName() : "Player") + "'s Account";
            service.createAccount(actorId, "personal", name, null);
            refresh(player.getUniqueId());
            return true;
        } catch (EconomyException e) {
            plugin.getLogger().log(Level.WARNING, "Could not create personal account for " + player.getUniqueId(), e);
            return false;
        }
    }
    @Override public boolean createPlayerAccount(String playerName, String worldName) { return createPlayerAccount(playerName); }
    @Override public boolean createPlayerAccount(OfflinePlayer player, String worldName) { return createPlayerAccount(player); }
}
