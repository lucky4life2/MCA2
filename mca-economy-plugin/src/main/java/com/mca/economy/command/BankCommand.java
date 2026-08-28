package com.mca.economy.command;

import com.mca.economy.EconomyService;
import com.mca.economy.MCAEconomyPlugin;
import com.mca.economy.model.EconomyAccount;
import com.mca.economy.supabase.EconomyException;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.OfflinePlayer;
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

public class BankCommand implements CommandExecutor, TabCompleter {

    private final MCAEconomyPlugin plugin;
    private final EconomyService service;

    public BankCommand(MCAEconomyPlugin plugin, EconomyService service) {
        this.plugin = plugin;
        this.service = service;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Only players can use /bank — manage accounts on the website instead.");
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
                    case "balance" -> handleBalance(player, args);
                    case "list" -> handleList(player);
                    case "create" -> handleCreate(player, args);
                    case "pay" -> handlePay(player, args);
                    case "invite" -> handleInvite(player, args);
                    case "use" -> handleUse(player, args);
                    default -> plugin.runSync(() -> sendUsage(player));
                }
            } catch (EconomyException e) {
                plugin.runSync(() -> player.sendMessage(err(e.getMessage())));
            } catch (Exception e) {
                plugin.getLogger().warning("Unexpected /bank error: " + e);
                plugin.runSync(() -> player.sendMessage(err("Something went wrong — try again in a moment.")));
            }
        });
        return true;
    }

    private void handleBalance(Player player, String[] args) throws EconomyException {
        UUID actorId = requireActor(player);
        if (actorId == null) return;

        List<EconomyAccount> accounts = service.myAccounts(actorId);
        if (args.length >= 2) {
            EconomyAccount account = find(accounts, args[1]);
            if (account == null) {
                plugin.runSync(() -> player.sendMessage(err("No account matching \"" + args[1] + "\".")));
                return;
            }
            plugin.runSync(() -> {
                player.sendMessage(info(account.name + ": " + fmt(account.balance) + " available"));
                if (account.reservedBalance.signum() > 0) {
                    player.sendMessage(line(fmt(account.reservedBalance)
                            + " is reserved against open orders on the exchange."));
                }
            });
            return;
        }
        plugin.runSync(() -> {
            if (accounts.isEmpty()) {
                player.sendMessage(err("You don't have any accounts yet. Try /bank create personal <name>."));
                return;
            }
            player.sendMessage(header("Your Balances"));
            for (EconomyAccount a : accounts) {
                player.sendMessage(line(a.name + " (" + a.type + "): " + fmt(a.balance)
                        + (a.reservedBalance.signum() > 0
                            ? " (+" + fmt(a.reservedBalance) + " reserved)" : "")));
            }
        });
    }

    private void handleList(Player player) throws EconomyException {
        UUID actorId = requireActor(player);
        if (actorId == null) return;
        List<EconomyAccount> accounts = service.myAccounts(actorId);
        plugin.runSync(() -> {
            if (accounts.isEmpty()) {
                player.sendMessage(err("You don't have any accounts yet. Try /bank create personal <name>."));
                return;
            }
            player.sendMessage(header("Your Accounts"));
            for (EconomyAccount a : accounts) {
                player.sendMessage(line(a.name + " — " + a.type + (a.frozen ? " (frozen)" : "")));
            }
        });
    }

    private void handleCreate(Player player, String[] args) throws EconomyException {
        if (args.length < 3) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /bank create <personal|business|nation> <name...>")));
            return;
        }
        String type = args[1].toLowerCase(Locale.ROOT);
        if (!type.equals("personal") && !type.equals("business") && !type.equals("nation")) {
            plugin.runSync(() -> player.sendMessage(err("Account type must be personal, business, or nation.")));
            return;
        }
        String name = String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length));

        UUID actorId = requireActor(player);
        if (actorId == null) return;

        if (type.equals("nation")) {
            plugin.runSync(() -> player.sendMessage(err("Nation accounts need a nation id — set these up on the website's Account page for now.")));
            return;
        }

        EconomyAccount account = service.createAccount(actorId, type, name, null);
        plugin.runSync(() -> player.sendMessage(info("Created " + account.type + " account \"" + account.name + "\".")));
    }

    private void handlePay(Player player, String[] args) throws EconomyException {
        if (args.length < 3) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /bank pay <player-or-account> <amount> [memo...]")));
            return;
        }
        UUID actorId = requireActor(player);
        if (actorId == null) return;

        List<EconomyAccount> myAccounts = service.myAccounts(actorId);
        EconomyAccount from = myAccounts.stream().filter(a -> "personal".equals(a.type)).findFirst().orElse(null);
        if (from == null) {
            plugin.runSync(() -> player.sendMessage(err("You need a personal account first — /bank create personal <name>.")));
            return;
        }

        BigDecimal amount;
        try {
            amount = new BigDecimal(args[2]);
        } catch (NumberFormatException e) {
            plugin.runSync(() -> player.sendMessage(err("\"" + args[2] + "\" isn't a valid amount.")));
            return;
        }
        if (amount.signum() <= 0) {
            plugin.runSync(() -> player.sendMessage(err("Amount must be a positive number.")));
            return;
        }
        if (from.balance.signum() <= 0) {
            plugin.runSync(() -> player.sendMessage(err("Your " + from.name + " account has no funds to send.")));
            return;
        }
        String memo = args.length > 3 ? String.join(" ", java.util.Arrays.copyOfRange(args, 3, args.length)) : null;

        EconomyAccount to = resolveTarget(myAccounts, args[1]);
        if (to == null) {
            plugin.runSync(() -> player.sendMessage(err("Couldn't find an account or online player named \"" + args[1] + "\".")));
            return;
        }

        service.transfer(actorId, from.id, to.id, amount, memo);
        plugin.runSync(() -> player.sendMessage(info("Paid " + fmt(amount) + " to " + to.name + ".")));
    }

    private void handleUse(Player player, String[] args) throws EconomyException {
        if (args.length < 2) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /bank use <account> — sets which account chest shops buy/sell from for you")));
            return;
        }
        UUID actorId = requireActor(player);
        if (actorId == null) return;

        List<EconomyAccount> accounts = service.myAccounts(actorId);
        EconomyAccount account = find(accounts, args[1]);
        if (account == null) {
            plugin.runSync(() -> player.sendMessage(err("No account of yours matches \"" + args[1] + "\".")));
            return;
        }
        service.setActiveAccount(player.getUniqueId(), account.id);
        plugin.runSync(() -> player.sendMessage(info("Chest shops will now use \"" + account.name + "\" for you.")));
    }

    private void handleInvite(Player player, String[] args) throws EconomyException {
        if (args.length < 3) {
            plugin.runSync(() -> player.sendMessage(err("Usage: /bank invite <account-name> <player>")));
            return;
        }
        UUID actorId = requireActor(player);
        if (actorId == null) return;

        List<EconomyAccount> myAccounts = service.myAccounts(actorId);
        EconomyAccount account = find(myAccounts, args[1]);
        if (account == null) {
            plugin.runSync(() -> player.sendMessage(err("No account of yours matches \"" + args[1] + "\".")));
            return;
        }

        OfflinePlayer target = Bukkit.getOfflinePlayer(args[2]);
        UUID targetActorId = service.resolveActor(target.getUniqueId());
        if (targetActorId == null) {
            plugin.runSync(() -> player.sendMessage(err(args[2] + " hasn't linked their Minecraft account on the website yet.")));
            return;
        }

        service.addAccountMember(actorId, account.id, targetActorId);
        plugin.runSync(() -> player.sendMessage(info("Added " + target.getName() + " to \"" + account.name + "\".")));
    }

    // ── Helpers ──

    private UUID requireActor(Player player) throws EconomyException {
        UUID actorId = service.resolveActor(player.getUniqueId());
        if (actorId == null) {
            plugin.runSync(() -> player.sendMessage(err("Link and verify your Minecraft account on the website first.")));
        }
        return actorId;
    }

    /** Matches an account by exact name, then by case-insensitive prefix, then by type keyword ("personal"/"business"/"nation"). */
    private EconomyAccount find(List<EconomyAccount> accounts, String token) {
        for (EconomyAccount a : accounts) if (a.name.equalsIgnoreCase(token)) return a;
        for (EconomyAccount a : accounts) if (a.name.toLowerCase(Locale.ROOT).startsWith(token.toLowerCase(Locale.ROOT))) return a;
        for (EconomyAccount a : accounts) if (a.type.equalsIgnoreCase(token)) return a;
        return null;
    }

    /** Resolves a /bank pay target: one of the sender's own accounts by name, or another online/known player's personal account. */
    private EconomyAccount resolveTarget(List<EconomyAccount> myAccounts, String token) throws EconomyException {
        EconomyAccount own = find(myAccounts, token);
        if (own != null) return own;

        OfflinePlayer target = Bukkit.getOfflinePlayer(token);
        UUID targetActorId = service.resolveActor(target.getUniqueId());
        if (targetActorId == null) return null;
        return service.myAccounts(targetActorId).stream()
                .filter(a -> "personal".equals(a.type))
                .findFirst()
                .orElse(null);
    }

    private void sendUsage(Player player) {
        player.sendMessage(header("Bank Commands"));
        player.sendMessage(line("/bank balance [account] — show balance"));
        player.sendMessage(line("/bank list — list your accounts"));
        player.sendMessage(line("/bank create <personal|business> <name> — open an account"));
        player.sendMessage(line("/bank pay <player|account> <amount> [memo] — send money"));
        player.sendMessage(line("/bank invite <account> <player> — add a manager to an account"));
        player.sendMessage(line("/bank use <account> — pick which account chest shops trade from for you"));
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
            return filter(List.of("balance", "list", "create", "pay", "invite", "use"), args[0]);
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("create")) {
            return filter(List.of("personal", "business"), args[1]);
        }
        if (args.length == 2 && (args[0].equalsIgnoreCase("pay") || args[0].equalsIgnoreCase("invite"))) {
            return filter(Bukkit.getOnlinePlayers().stream().map(Player::getName).collect(Collectors.toList()), args[1]);
        }
        return new ArrayList<>();
    }

    private List<String> filter(List<String> options, String prefix) {
        return options.stream()
                .filter(o -> o.toLowerCase(Locale.ROOT).startsWith(prefix.toLowerCase(Locale.ROOT)))
                .collect(Collectors.toList());
    }
}
