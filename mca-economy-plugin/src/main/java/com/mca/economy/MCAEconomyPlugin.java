package com.mca.economy;

import com.mca.economy.command.BankCommand;
import com.mca.economy.command.CompanyCommand;
import com.mca.economy.supabase.SupabaseClient;
import com.mca.economy.vault.VaultEconomyProvider;
import net.milkbowl.vault.economy.Economy;
import org.bukkit.event.HandlerList;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MCAEconomyPlugin extends JavaPlugin implements Listener {

    private SupabaseClient supabaseClient;
    private EconomyService economyService;
    private VaultEconomyProvider vaultProvider;
    private ExecutorService asyncExecutor;

    private String currencySymbol;
    private String currencyNameSingular;
    private String currencyNamePlural;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        String url = getConfig().getString("supabase.url", "");
        String key = getConfig().getString("supabase.service-role-key", "");
        if (url.isBlank() || key.isBlank() || key.contains("PASTE_YOUR")) {
            getLogger().severe("supabase.url / supabase.service-role-key are not set in config.yml — disabling.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        currencySymbol = getConfig().getString("currency.symbol", "$");
        currencyNameSingular = getConfig().getString("currency.name-singular", "Dollar");
        currencyNamePlural = getConfig().getString("currency.name-plural", "Dollars");

        this.asyncExecutor = Executors.newFixedThreadPool(2, r -> {
            Thread t = new Thread(r, "MCAEconomy-Worker");
            t.setDaemon(true);
            return t;
        });

        this.supabaseClient = new SupabaseClient(url, key);
        this.economyService = new EconomyService(supabaseClient);

        if (getServer().getPluginManager().getPlugin("Vault") != null) {
            this.vaultProvider = new VaultEconomyProvider(this, economyService);
            getServer().getServicesManager().register(Economy.class, vaultProvider, this, ServicePriority.Highest);
            getLogger().info("Registered as the Vault economy provider.");
        } else {
            getLogger().warning("Vault not found — local trading via ChestShop (or anything else Vault-based) will not work. /bank and /company still will.");
        }

        getServer().getPluginManager().registerEvents(this, this);

        BankCommand bankCommand = new BankCommand(this, economyService);
        getCommand("bank").setExecutor(bankCommand);
        getCommand("bank").setTabCompleter(bankCommand);

        CompanyCommand companyCommand = new CompanyCommand(this, economyService);
        getCommand("company").setExecutor(companyCommand);
        getCommand("company").setTabCompleter(companyCommand);

        // Warm the cache for anyone already online (e.g. after a /reload).
        getServer().getOnlinePlayers().forEach(p -> runAsync(() -> {
            if (vaultProvider != null) vaultProvider.refresh(p.getUniqueId());
        }));

        int refreshSeconds = getConfig().getInt("cache-refresh-seconds", 30);
        getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            if (vaultProvider == null) return;
            getServer().getOnlinePlayers().forEach(p -> vaultProvider.refresh(p.getUniqueId()));
        }, 20L * refreshSeconds, 20L * refreshSeconds);
    }

    @Override
    public void onDisable() {
        HandlerList.unregisterAll((Listener) this);
        if (asyncExecutor != null) asyncExecutor.shutdownNow();
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        runAsync(() -> {
            if (vaultProvider != null) vaultProvider.refresh(event.getPlayer().getUniqueId());
        });
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        if (vaultProvider != null) vaultProvider.invalidate(event.getPlayer().getUniqueId());
        economyService.invalidateActor(event.getPlayer().getUniqueId());
    }

    /** Runs a blocking economy call off the main thread. Use this from every command handler. */
    public void runAsync(Runnable task) {
        CompletableFuture.runAsync(task, asyncExecutor).exceptionally(t -> {
            getLogger().warning("Async economy task failed: " + t.getMessage());
            return null;
        });
    }

    /** Hops back onto the main thread — use before touching Bukkit API (messages, inventories, etc.). */
    public void runSync(Runnable task) {
        getServer().getScheduler().runTask(this, task);
    }

    public EconomyService getEconomyService() {
        return economyService;
    }

    public String getCurrencySymbol() {
        return currencySymbol;
    }

    public String getCurrencyNameSingular() {
        return currencyNameSingular;
    }

    public String getCurrencyNamePlural() {
        return currencyNamePlural;
    }
}
