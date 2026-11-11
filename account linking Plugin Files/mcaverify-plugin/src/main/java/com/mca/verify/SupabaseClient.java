package com.mca.verify;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Thin REST client that talks DIRECTLY to the Supabase PostgREST API
 * using the service_role key configured in config.yml. This bypasses
 * Row Level Security entirely, which is why the service_role_key must
 * never be exposed anywhere outside this server's config.yml.
 *
 * NOTE: this client does NOT go through the `mcaverify` Supabase Edge
 * Function at all — it reads/writes the `profiles` (and, with the new
 * sendHeartbeat() method, `settings`) tables directly.
 */
public class SupabaseClient {

    private final String baseUrl;
    private final String serviceRoleKey;
    private final String table;
    private final ColumnNames columns;
    private final Logger logger;
    private final HttpClient http;

    public SupabaseClient(String url, String serviceRoleKey, String table, ColumnNames columns, Logger logger) {
        this.baseUrl = stripTrailingSlash(url);
        this.serviceRoleKey = serviceRoleKey;
        this.table = table;
        this.columns = columns;
        this.logger = logger;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    private static String stripTrailingSlash(String s) {
        if (s != null && s.endsWith("/")) {
            return s.substring(0, s.length() - 1);
        }
        return s;
    }

    /** Looks up a profile row by its mc_verify_code. Returns null if not found or on error. */
    public ProfileMatch findByVerifyCode(String code) {
        String select = String.join(",", "id", columns.minecraftUsername, columns.minecraftVerified,
                columns.minecraftBedrockUsername, columns.minecraftBedrockVerified,
                columns.verifyExpires, columns.verifyCode);
        String url = baseUrl + "/rest/v1/" + urlEncodePath(table)
                + "?" + urlEncode(columns.verifyCode) + "=eq." + urlEncode(code)
                + "&select=" + urlEncode(select);
        try {
            HttpRequest request = baseRequest(url).GET().build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                logger.log(Level.WARNING, "Supabase lookup failed (" + response.statusCode() + "): " + response.body());
                return null;
            }
            JsonElement parsed = JsonParser.parseString(response.body());
            if (!parsed.isJsonArray()) return null;
            JsonArray arr = parsed.getAsJsonArray();
            if (arr.size() == 0) return null;
            JsonObject row = arr.get(0).getAsJsonObject();

            String id = getString(row, "id");
            String mcUsername = getString(row, columns.minecraftUsername);
            boolean verified = row.has(columns.minecraftVerified)
                    && !row.get(columns.minecraftVerified).isJsonNull()
                    && row.get(columns.minecraftVerified).getAsBoolean();
            String mcBedrockUsername = getString(row, columns.minecraftBedrockUsername);
            boolean bedrockVerified = row.has(columns.minecraftBedrockVerified)
                    && !row.get(columns.minecraftBedrockVerified).isJsonNull()
                    && row.get(columns.minecraftBedrockVerified).getAsBoolean();

            Instant expires = null;
            String expiresStr = getString(row, columns.verifyExpires);
            if (expiresStr != null) {
                try {
                    expires = Instant.parse(expiresStr);
                } catch (Exception e) {
                    // leave expires null if it doesn't parse
                }
            }
            return new ProfileMatch(id, mcUsername, verified, mcBedrockUsername, bedrockVerified, expires);
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return null;
        }
    }

    /**
     * Raised when the membership lookup could not be completed at all
     * (Supabase unreachable, HTTP error, unparseable body). Distinct from
     * "there is no linked profile", which is a definite answer — collapsing
     * the two meant a Supabase blip locked every player out of the server
     * and told them to go buy a membership they already had.
     */
    public static class MembershipLookupException extends RuntimeException {
        public MembershipLookupException(String message, Throwable cause) { super(message, cause); }
        public MembershipLookupException(String message) { super(message); }
    }

    /**
     * Looks up membership status by linked Minecraft UUID. Returns null when
     * there is definitively no linked profile; throws
     * MembershipLookupException when the lookup itself failed.
     */
    public MembershipStatus findMembershipStatusByUuid(String minecraftUuid) {
        String select = String.join(",", "id", columns.membershipStatus, columns.membershipPeriodEnd);
        String url = baseUrl + "/rest/v1/" + urlEncodePath(table)
                + "?" + urlEncode(columns.minecraftUuid) + "=eq." + urlEncode(minecraftUuid)
                + "&select=" + urlEncode(select);
        try {
            HttpRequest request = baseRequest(url).GET().build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                logger.log(Level.WARNING, "Supabase membership lookup failed (" + response.statusCode() + "): " + response.body());
                throw new MembershipLookupException("Supabase returned HTTP " + response.statusCode());
            }
            JsonElement parsed = JsonParser.parseString(response.body());
            if (!parsed.isJsonArray()) throw new MembershipLookupException("Unexpected response body from Supabase");
            JsonArray arr = parsed.getAsJsonArray();
            if (arr.size() == 0) return null;
            JsonObject row = arr.get(0).getAsJsonObject();

            String status = getString(row, columns.membershipStatus);
            Instant periodEnd = null;
            String periodEndStr = getString(row, columns.membershipPeriodEnd);
            if (periodEndStr != null) {
                try {
                    periodEnd = Instant.parse(periodEndStr);
                } catch (Exception e) {
                    // leave periodEnd null if it doesn't parse
                }
            }
            return new MembershipStatus(status, periodEnd);
        } catch (MembershipLookupException e) {
            throw e;
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new MembershipLookupException("Could not reach Supabase", e);
        }
    }

    /**
     * Membership state for a linked Minecraft UUID via the service-role-only
     * RPC get_membership_state_for_minecraft — the same state rules the
     * website and the database use (none/active/grace/cancelled/expired plus
     * account_status and the can_bypass_membership permission). Throws
     * MembershipLookupException when the lookup itself fails.
     */
    public MembershipState getMembershipState(String minecraftUuid) {
        return getMembershipState(minecraftUuid, null);
    }

    /**
     * Same lookup, but also recognises a not-yet-linked player whose name a
     * website account has claimed (get_minecraft_join_state). Pass the
     * player's login name; it is trustworthy on an online-mode server
     * because Mojang has already authenticated it.
     */
    public MembershipState getMembershipState(String minecraftUuid, String minecraftName) {
        boolean withName = minecraftName != null && !minecraftName.isBlank();
        String url = baseUrl + "/rest/v1/rpc/"
                + (withName ? "get_minecraft_join_state" : "get_membership_state_for_minecraft");
        JsonObject body = new JsonObject();
        body.addProperty("p_minecraft_uuid", minecraftUuid);
        if (withName) body.addProperty("p_minecraft_name", minecraftName);
        try {
            HttpRequest request = baseRequest(url)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                logger.log(Level.WARNING, "Supabase membership RPC failed (" + response.statusCode() + "): " + response.body());
                throw new MembershipLookupException("Supabase returned HTTP " + response.statusCode());
            }
            JsonElement parsed = JsonParser.parseString(response.body());
            if (!parsed.isJsonArray() || parsed.getAsJsonArray().size() == 0) {
                throw new MembershipLookupException("Unexpected response body from Supabase");
            }
            JsonObject row = parsed.getAsJsonArray().get(0).getAsJsonObject();
            boolean linked = row.has("linked") && !row.get("linked").isJsonNull() && row.get("linked").getAsBoolean();
            boolean bypass = row.has("bypass") && !row.get("bypass").isJsonNull() && row.get("bypass").getAsBoolean();
            Instant expiresAt = null;
            String expiresStr = getString(row, "expires_at");
            if (expiresStr != null) {
                try { expiresAt = java.time.OffsetDateTime.parse(expiresStr).toInstant(); } catch (Exception ignored) { }
            }
            boolean pendingLink = row.has("pending_link") && !row.get("pending_link").isJsonNull() && row.get("pending_link").getAsBoolean();
            return new MembershipState(linked, getString(row, "state"), expiresAt, getString(row, "account_status"), bypass, pendingLink);
        } catch (MembershipLookupException e) {
            throw e;
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new MembershipLookupException("Could not reach Supabase", e);
        }
    }

    /** Looks up a profile row by its linked Minecraft username (Java or Bedrock). Returns null if not found or on error. */
    public ProfileMatch findByMinecraftUsername(String username) {
        String select = String.join(",", "id", columns.minecraftUsername, columns.minecraftVerified,
                columns.minecraftBedrockUsername, columns.minecraftBedrockVerified);
        // Bedrock names carry the Floodgate "." prefix, so a "." name only
        // ever matches the Bedrock column; a plain name only the Java one.
        boolean bedrock = username != null && username.startsWith(".");
        String nameColumn = bedrock ? columns.minecraftBedrockUsername : columns.minecraftUsername;
        String url = baseUrl + "/rest/v1/" + urlEncodePath(table)
                + "?" + urlEncode(nameColumn) + "=eq." + urlEncode(username)
                + "&select=" + urlEncode(select);
        try {
            HttpRequest request = baseRequest(url).GET().build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                logger.log(Level.WARNING, "Supabase lookup failed (" + response.statusCode() + "): " + response.body());
                return null;
            }
            JsonElement parsed = JsonParser.parseString(response.body());
            if (!parsed.isJsonArray()) return null;
            JsonArray arr = parsed.getAsJsonArray();
            if (arr.size() == 0) return null;
            JsonObject row = arr.get(0).getAsJsonObject();

            String id = getString(row, "id");
            String mcUsername = getString(row, columns.minecraftUsername);
            boolean verified = row.has(columns.minecraftVerified)
                    && !row.get(columns.minecraftVerified).isJsonNull()
                    && row.get(columns.minecraftVerified).getAsBoolean();
            String mcBedrockUsername = getString(row, columns.minecraftBedrockUsername);
            boolean bedrockVerified = row.has(columns.minecraftBedrockVerified)
                    && !row.get(columns.minecraftBedrockVerified).isJsonNull()
                    && row.get(columns.minecraftBedrockVerified).getAsBoolean();

            return new ProfileMatch(id, mcUsername, verified, mcBedrockUsername, bedrockVerified, null);
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return null;
        }
    }

    /** Marks the given profile as verified (Java edition), clearing the one-time code. */
    public boolean markVerified(String profileId, String minecraftUuid) {
        return markVerified(profileId, minecraftUuid, false);
    }

    /**
     * Marks the given profile as verified, clearing the one-time code.
     * When {@code bedrock} is true, the Bedrock (Floodgate) UUID + verified
     * flag are written instead of the Java ones, so a member who plays both
     * editions keeps both links. The code is cleared either way — verifying
     * the other edition needs a fresh code from the website.
     */
    public boolean markVerified(String profileId, String minecraftUuid, boolean bedrock) {
        String url = baseUrl + "/rest/v1/" + urlEncodePath(table) + "?id=eq." + urlEncode(profileId);
        JsonObject body = new JsonObject();
        if (bedrock) {
            body.addProperty(columns.minecraftBedrockVerified, Boolean.TRUE);
            if (minecraftUuid != null && !columns.minecraftBedrockUuid.isEmpty()) {
                body.addProperty(columns.minecraftBedrockUuid, minecraftUuid);
            }
        } else {
            body.addProperty(columns.minecraftVerified, Boolean.TRUE);
            if (minecraftUuid != null && !columns.minecraftUuid.isEmpty()) {
                body.addProperty(columns.minecraftUuid, minecraftUuid);
            }
        }
        body.add(columns.verifyCode, JsonNull.INSTANCE);
        body.add(columns.verifyExpires, JsonNull.INSTANCE);
        try {
            HttpRequest request = baseRequest(url)
                    .header("Content-Type", "application/json")
                    .header("Prefer", "return=minimal")
                    .method("PATCH", HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                logger.log(Level.WARNING, "Supabase update failed (" + response.statusCode() + "): " + response.body());
                return false;
            }
            return true;
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return false;
        }
    }

    /** Force-clears verification on a profile (used by /mcaunverify) — both Java and Bedrock links. */
    public boolean clearVerification(String profileId) {
        String url = baseUrl + "/rest/v1/" + urlEncodePath(table) + "?id=eq." + urlEncode(profileId);
        JsonObject body = new JsonObject();
        body.addProperty(columns.minecraftVerified, Boolean.FALSE);
        body.addProperty(columns.minecraftBedrockVerified, Boolean.FALSE);
        // Also clear the stored UUIDs: the join gate looks players up by UUID,
        // so leaving one set would let an unverified player keep joining.
        if (columns.minecraftUuid != null && !columns.minecraftUuid.isBlank()) {
            body.add(columns.minecraftUuid, JsonNull.INSTANCE);
        }
        if (columns.minecraftBedrockUuid != null && !columns.minecraftBedrockUuid.isBlank()) {
            body.add(columns.minecraftBedrockUuid, JsonNull.INSTANCE);
        }
        try {
            HttpRequest request = baseRequest(url)
                    .header("Content-Type", "application/json")
                    .header("Prefer", "return=minimal")
                    .method("PATCH", HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return response.statusCode() >= 200 && response.statusCode() < 300;
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return false;
        }
    }

    /**
     * NEW: upserts a heartbeat row into the `settings` table so the website's
     * admin panel can tell the plugin is actually running, not just that the
     * Edge Function is deployed. Call this periodically (e.g. every 60s) from
     * a repeating async task in onEnable().
     *
     * Mirrors the same direct-REST pattern as markVerified()/clearVerification(),
     * just against the `settings` table instead of `profiles`, using Postgres's
     * upsert-on-primary-key behavior via the Prefer: resolution=merge-duplicates header.
     */
    public boolean sendHeartbeat(String serverName) {
        String url = baseUrl + "/rest/v1/settings";

        JsonObject value = new JsonObject();
        value.addProperty("last_seen", Instant.now().toString());
        if (serverName != null && !serverName.isBlank()) {
            value.addProperty("server", serverName);
        } else {
            value.add("server", JsonNull.INSTANCE);
        }

        JsonObject body = new JsonObject();
        body.addProperty("key", "plugin_heartbeat");
        body.addProperty("value", value.toString());
        body.addProperty("updated_at", Instant.now().toString());

        try {
            HttpRequest request = baseRequest(url)
                    .header("Content-Type", "application/json")
                    .header("Prefer", "resolution=merge-duplicates,return=minimal")
                    .method("POST", HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                logger.log(Level.WARNING, "Heartbeat upsert failed (" + response.statusCode() + "): " + response.body());
                return false;
            }
            return true;
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error sending heartbeat to Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return false;
        }
    }

    private HttpRequest.Builder baseRequest(String url) {
        return HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("apikey", serviceRoleKey)
                .header("Authorization", "Bearer " + serviceRoleKey);
    }

    private static String getString(JsonObject obj, String key) {
        if (key == null || !obj.has(key) || obj.get(key).isJsonNull()) return null;
        JsonElement el = obj.get(key);
        return el.isJsonPrimitive() ? el.getAsString() : el.toString();
    }

    private static String urlEncode(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String urlEncodePath(String s) {
        return urlEncode(s);
    }

    public static class ColumnNames {
        public final String minecraftUsername;
        public final String minecraftVerified;
        public final String minecraftUuid;
        public final String minecraftBedrockUsername;
        public final String minecraftBedrockVerified;
        public final String minecraftBedrockUuid;
        public final String verifyCode;
        public final String verifyExpires;
        public final String membershipStatus;
        public final String membershipPeriodEnd;

        public ColumnNames(String minecraftUsername, String minecraftVerified, String minecraftUuid, String verifyCode, String verifyExpires) {
            this(minecraftUsername, minecraftVerified, minecraftUuid, verifyCode, verifyExpires, "membership_status", "membership_current_period_end");
        }

        public ColumnNames(String minecraftUsername, String minecraftVerified, String minecraftUuid, String verifyCode, String verifyExpires,
                            String membershipStatus, String membershipPeriodEnd) {
            this(minecraftUsername, minecraftVerified, minecraftUuid, verifyCode, verifyExpires,
                    membershipStatus, membershipPeriodEnd,
                    "minecraft_bedrock_username", "minecraft_bedrock_verified", "minecraft_bedrock_uuid");
        }

        public ColumnNames(String minecraftUsername, String minecraftVerified, String minecraftUuid, String verifyCode, String verifyExpires,
                            String membershipStatus, String membershipPeriodEnd,
                            String minecraftBedrockUsername, String minecraftBedrockVerified, String minecraftBedrockUuid) {
            this.minecraftUsername = minecraftUsername;
            this.minecraftVerified = minecraftVerified;
            this.minecraftUuid = minecraftUuid == null ? "" : minecraftUuid;
            this.minecraftBedrockUsername = minecraftBedrockUsername;
            this.minecraftBedrockVerified = minecraftBedrockVerified;
            this.minecraftBedrockUuid = minecraftBedrockUuid == null ? "" : minecraftBedrockUuid;
            this.verifyCode = verifyCode;
            this.verifyExpires = verifyExpires;
            this.membershipStatus = membershipStatus;
            this.membershipPeriodEnd = membershipPeriodEnd;
        }
    }

    /** membership_status ("active"/"past_due"/"canceled"/"none") + the current paid period's end. */
    public static class MembershipStatus {
        public final String status;
        public final Instant periodEnd;

        public MembershipStatus(String status, Instant periodEnd) {
            this.status = status;
            this.periodEnd = periodEnd;
        }

        /** True only while status is "active" AND the paid period hasn't ended yet. */
        public boolean isActive() {
            return "active".equals(status) && periodEnd != null && Instant.now().isBefore(periodEnd);
        }
    }

    /** Result of get_membership_state_for_minecraft. */
    public static class MembershipState {
        public final boolean linked;
        public final String state;          // none | active | grace | cancelled | expired
        public final Instant expiresAt;
        public final String accountStatus;  // active | frozen | terminated | ...
        public final boolean bypass;        // can_bypass_membership (staff)
        /**
         * True when this Minecraft account isn't linked yet, but a website
         * account has claimed its username. Such a player may be let in
         * (if that website account is paid up) just long enough to run
         * /mcaverify — see PendingLinkListener.
         */
        public final boolean pendingLink;

        public MembershipState(boolean linked, String state, Instant expiresAt, String accountStatus, boolean bypass) {
            this(linked, state, expiresAt, accountStatus, bypass, false);
        }

        public MembershipState(boolean linked, String state, Instant expiresAt, String accountStatus, boolean bypass, boolean pendingLink) {
            this.linked = linked;
            this.state = state == null ? "none" : state;
            this.expiresAt = expiresAt;
            this.accountStatus = accountStatus;
            this.bypass = bypass;
            this.pendingLink = pendingLink;
        }

        /** Same rule as the database's user_meets_membership_gate(). */
        public boolean accountOk() {
            return "active".equals(accountStatus) || "pending_deletion".equals(accountStatus);
        }

        public boolean membershipOk() {
            return "active".equals(state) || "grace".equals(state) || "cancelled".equals(state);
        }
    }

    public static class ProfileMatch {
        public final String id;
        public final String minecraftUsername;
        public final boolean verified;
        /** Bedrock (Floodgate) name, with the "." prefix, or null if not linked. */
        public final String minecraftBedrockUsername;
        public final boolean bedrockVerified;
        public final Instant verifyExpires;

        public ProfileMatch(String id, String minecraftUsername, boolean verified, Instant verifyExpires) {
            this(id, minecraftUsername, verified, null, false, verifyExpires);
        }

        public ProfileMatch(String id, String minecraftUsername, boolean verified,
                            String minecraftBedrockUsername, boolean bedrockVerified, Instant verifyExpires) {
            this.id = id;
            this.minecraftUsername = minecraftUsername;
            this.verified = verified;
            this.minecraftBedrockUsername = minecraftBedrockUsername;
            this.bedrockVerified = bedrockVerified;
            this.verifyExpires = verifyExpires;
        }

        /** True when this edition's name matches the in-game name and that edition is already verified. */
        public boolean verifiedFor(String playerName) {
            if (playerName != null && playerName.startsWith(".")) {
                return bedrockVerified && minecraftBedrockUsername != null
                        && minecraftBedrockUsername.equalsIgnoreCase(playerName);
            }
            return verified && minecraftUsername != null
                    && minecraftUsername.equalsIgnoreCase(playerName);
        }

        /** True when the in-game name matches either linked name (Java or Bedrock). */
        public boolean nameMatches(String playerName) {
            if (playerName == null) return false;
            if (playerName.startsWith(".")) {
                return minecraftBedrockUsername != null && minecraftBedrockUsername.equalsIgnoreCase(playerName);
            }
            return minecraftUsername != null && minecraftUsername.equalsIgnoreCase(playerName);
        }
    }
}
