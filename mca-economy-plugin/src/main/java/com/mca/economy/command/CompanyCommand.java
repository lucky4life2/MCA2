package com.mca.economy.command;

import com.mca.economy.EconomyService;
import com.mca.economy.MCAEconomyPlugin;
import com.mca.economy.model.EconomyAccount;
import com.mca.economy.model.EconomyCompany;
import com.mca.economy.supabase.EconomyException;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Collectors;

public class CompanyCommand implements CommandExecutor, TabCompleter {

    private final MCAEconomyPlugin plugin;
    private final EconomyService service;

    public CompanyCommand(MCAEconomyPlugin plugin, EconomyService service) {
        this.plugin = plugin;
        this.service = service;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can use /company — trade on the website instead.");
            return true;
        }
        if (args.length == 0) {
            sendUsage(player);
            return true;
        }

        String sub = args[0].toLowerCase(Locale.ROOT);
        plugin.runAsync(() -> {
            try {
                switch (sub) {
                    case "list" -> handleList(player);
                    case "info" -> handleInfo(player, args);
                    case "found" -> handleFound(player, args);
                    case "buy" -> handleBuy(player, args);
                    case "sell" -> handleSell(player, args);
                    case "setprice" -> handleSetPrice(player, args);
                    default -> plugin.runSync(() -> sendUsage(player));
                }
            } catch (EconomyException e) {
                plugin.runSync(() -> player.sendMessage(err(e.getMessage())));
            } catch (Exception e) {
                plugin.getLogger().warning("Unexpected /company error: " + e);
                plugin.runSync(() -> player.sendMessage(err("Something went wrong — try again in a moment.")));
            }
        });
        return true;
    }

    private void handleList(Player player) throws EconomyException {
        List<EconomyCompany> companies = service.listCompanies();
        plugin.runSync(() -> {
            if (companies.isEmpty()) {
                player.sendMessage(err("No companies have been founded yet."));
                return;
            }
            player.sendMessage(header("Companies"));
            for (EconomyCompany c : companies) {
                player.sendMessage(line(c.ticker + " — " + c.name + " @ " + c.displayPrice()
                        + (c.tradingHalted ? " (halted)" : "")));
            }
        });
    }

    private void handleInfo(Player player, String[] args) throws EconomyException {
        if (args.length < 2) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /company info <ticker>")));
            return;
        }
        EconomyCompany company = service.getCompanyByTicker(args[1]);
        if (company == null) {
            plugin.runSync(() -> player.sendMessage(err("No company with ticker " + args[1].toUpperCase(Locale.ROOT) + ".")));
            return;
        }
        plugin.runSync(() -> {
            player.sendMessage(header(company.name + " (" + company.ticker + ")"));
            if (!company.description.isBlank()) player.sendMessage(line(company.description));
            player.sendMessage(line("Last traded price: " + company.displayPrice()));
            player.sendMessage(line("Shares issued: " + company.sharesIssued
                    + " of " + company.totalShares + " authorized"));
            player.sendMessage(line("Status: " + company.status));
            if (company.tradingHalted) {
                player.sendMessage(err("Trading halted: "
                        + (company.haltReason == null ? "no reason recorded" : company.haltReason)));
            }
        });
    }

    private void handleFound(Player player, String[] args) throws EconomyException {
        if (args.length < 6) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /company found <name> <ticker> <treasury-account> <totalShares> <initialPrice>")));
            return;
        }
        UUID actorId = requireActor(player);
        if (actorId == null) return;

        String name = args[1];
        String ticker = args[2];
        String treasuryToken = args[3];
        int totalShares;
        BigDecimal initialPrice;
        try {
            totalShares = Integer.parseInt(args[4]);
            initialPrice = new BigDecimal(args[5]);
        } catch (NumberFormatException e) {
            plugin.runSync(() -> player.sendMessage(err("Total shares and initial price must be numbers.")));
            return;
        }

        List<EconomyAccount> myAccounts = service.myAccounts(actorId);
        EconomyAccount treasury = find(myAccounts, treasuryToken);
        if (treasury == null) {
            plugin.runSync(() -> player.sendMessage(err("No account of yours matches \"" + treasuryToken + "\" to use as the treasury.")));
            return;
        }

        EconomyCompany company = service.createCompany(actorId, name, ticker, "", treasury.id, totalShares, initialPrice);
        plugin.runSync(() -> {
            player.sendMessage(info("Founded " + company.name + " (" + company.ticker + ") with "
                    + company.totalShares + " authorized shares. None are issued yet."));
            player.sendMessage(line("The company has its own account, separate from your wallet."));
            player.sendMessage(line("It is paid only when shares actually sell — open an offering on the website to raise Marks."));
        });
    }

    private void handleBuy(Player player, String[] args) throws EconomyException {
        if (args.length < 4) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /company buy <account> <ticker> <shares>")));
            return;
        }
        tradeShares(player, args, true);
    }

    private void handleSell(Player player, String[] args) throws EconomyException {
        if (args.length < 4) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /company sell <account> <ticker> <shares>")));
            return;
        }
        tradeShares(player, args, false);
    }

    private void tradeShares(Player player, String[] args, boolean buying) throws EconomyException {
        UUID actorId = requireActor(player);
        if (actorId == null) return;

        List<EconomyAccount> myAccounts = service.myAccounts(actorId);
        EconomyAccount account = find(myAccounts, args[1]);
        if (account == null) {
            plugin.runSync(() -> player.sendMessage(err("No account of yours matches \"" + args[1] + "\".")));
            return;
        }

        EconomyCompany company = service.getCompanyByTicker(args[2]);
        if (company == null) {
            plugin.runSync(() -> player.sendMessage(err("No company with ticker " + args[2].toUpperCase(Locale.ROOT) + ".")));
            return;
        }

        int shares;
        try {
            shares = Integer.parseInt(args[3]);
        } catch (NumberFormatException e) {
            plugin.runSync(() -> player.sendMessage(err("\"" + args[3] + "\" isn't a valid share count.")));
            return;
        }

        if (buying) {
            service.buyShares(actorId, account.id, company.id, shares);
        } else {
            service.sellShares(actorId, account.id, company.id, shares);
        }
        BigDecimal total = company.sharePrice.multiply(BigDecimal.valueOf(shares));
        String verb = buying ? "Bought" : "Sold";
        plugin.runSync(() -> player.sendMessage(info(verb + " " + shares + " " + company.ticker + " for " + fmt(total) + " total.")));
    }

    private void handleSetPrice(Player player, String[] args) throws EconomyException {
        if (args.length < 3) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /company setprice <ticker> <price>")));
            return;
        }
        UUID actorId = requireActor(player);
        if (actorId == null) return;

        EconomyCompany company = service.getCompanyByTicker(args[1]);
        if (company == null) {
            plugin.runSync(() -> player.sendMessage(err("No company with ticker " + args[1].toUpperCase(Locale.ROOT) + ".")));
            return;
        }
        BigDecimal price;
        try {
            price = new BigDecimal(args[2]);
        } catch (NumberFormatException e) {
            plugin.runSync(() -> player.sendMessage(err("\"" + args[2] + "\" isn't a valid price.")));
            return;
        }

        EconomyCompany updated = service.setSharePrice(actorId, company.id, price);
        plugin.runSync(() -> player.sendMessage(info(updated.ticker + " share price set to " + fmt(updated.sharePrice) + ".")));
    }

    // ── Helpers ──

    private UUID requireActor(Player player) throws EconomyException {
        UUID actorId = service.resolveActor(player.getUniqueId());
        if (actorId == null) {
            plugin.runSync(() -> player.sendMessage(err("Link and verify your Minecraft account on the website first.")));
        }
        return actorId;
    }

    private EconomyAccount find(List<EconomyAccount> accounts, String token) {
        for (EconomyAccount a : accounts) if (a.name.equalsIgnoreCase(token)) return a;
        for (EconomyAccount a : accounts) if (a.name.toLowerCase(Locale.ROOT).startsWith(token.toLowerCase(Locale.ROOT))) return a;
        for (EconomyAccount a : accounts) if (a.type.equalsIgnoreCase(token)) return a;
        return null;
    }

    private void sendUsage(Player player) {
        player.sendMessage(header("Company Commands"));
        player.sendMessage(line("/company list — see all companies"));
        player.sendMessage(line("/company info <ticker> — company details"));
        player.sendMessage(line("/company found <name> <ticker> <treasury-account> <shares> <price>"));
        player.sendMessage(line("/company buy <account> <ticker> <shares>"));
        player.sendMessage(line("/company sell <account> <ticker> <shares>"));
        player.sendMessage(line("/company setprice <ticker> <price> — owner only"));
    }

    private String fmt(BigDecimal amount) {
        return plugin.getCurrencySymbol() + String.format("%,.2f", amount);
    }

    private String header(String text) { return ChatColor.GOLD + "" + ChatColor.BOLD + text; }
    private String line(String text) { return ChatColor.GRAY + "• " + ChatColor.RESET + text; }
    private String info(String text) { return ChatColor.GREEN + text; }
    private String err(String text) { return ChatColor.RED + text; }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) {
            return filter(List.of("list", "info", "found", "buy", "sell", "setprice"), args[0]);
        }
        return new ArrayList<>();
    }

    private List<String> filter(List<String> options, String prefix) {
        return options.stream()
                .filter(o -> o.toLowerCase(Locale.ROOT).startsWith(prefix.toLowerCase(Locale.ROOT)))
                .collect(Collectors.toList());
    }
}
