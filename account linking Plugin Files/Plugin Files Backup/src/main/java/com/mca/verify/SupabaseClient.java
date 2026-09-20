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
        String select = String.join(",", "id", columns.minecraftUsername, columns.minecraftVerified, columns.verifyExpires, columns.verifyCode);
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

            Instant expires = null;
            String expiresStr = getString(row, columns.verifyExpires);
            if (expiresStr != null) {
                try {
                    expires = Instant.parse(expiresStr);
                } catch (Exception e) {
                    // leave expires null if it doesn't parse
                }
            }
            return new ProfileMatch(id, mcUsername, verified, expires);
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return null;
        }
    }

    /**
     * Looks up membership status by linked Minecraft UUID. Returns null if
     * no linked profile is found (or on error) — callers should treat that
     * the same as "not an active member".
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
                return null;
            }
            JsonElement parsed = JsonParser.parseString(response.body());
            if (!parsed.isJsonArray()) return null;
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
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return null;
        }
    }

    /** Looks up a profile row by its linked Minecraft username. Returns null if not found or on error. */
    public ProfileMatch findByMinecraftUsername(String username) {
        String select = String.join(",", "id", columns.minecraftUsername, columns.minecraftVerified);
        String url = baseUrl + "/rest/v1/" + urlEncodePath(table)
                + "?" + urlEncode(columns.minecraftUsername) + "=eq." + urlEncode(username)
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

            return new ProfileMatch(id, mcUsername, verified, null);
        } catch (Exception e) {
            logger.log(Level.WARNING, "Error contacting Supabase", e);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            return null;
        }
    }

    /** Marks the given profile as verified, clearing the one-time code. */
    public boolean markVerified(String profileId, String minecraftUuid) {
        String url = baseUrl + "/rest/v1/" + urlEncodePath(table) + "?id=eq." + urlEncode(profileId);
        JsonObject body = new JsonObject();
        body.addProperty(columns.minecraftVerified, Boolean.TRUE);
        body.add(columns.verifyCode, JsonNull.INSTANCE);
        body.add(columns.verifyExpires, JsonNull.INSTANCE);
        if (minecraftUuid != null && !columns.minecraftUuid.isEmpty()) {
            body.addProperty(columns.minecraftUuid, minecraftUuid);
        }
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

    /** Force-clears verification on a profile (used by /mcaunverify). */
    public boolean clearVerification(String profileId) {
        String url = baseUrl + "/rest/v1/" + urlEncodePath(table) + "?id=eq." + urlEncode(profileId);
        JsonObject body = new JsonObject();
        body.addProperty(columns.minecraftVerified, Boolean.FALSE);
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
        public final String verifyCode;
        public final String verifyExpires;
        public final String membershipStatus;
        public final String membershipPeriodEnd;

        public ColumnNames(String minecraftUsername, String minecraftVerified, String minecraftUuid, String verifyCode, String verifyExpires) {
            this(minecraftUsername, minecraftVerified, minecraftUuid, verifyCode, verifyExpires, "membership_status", "membership_current_period_end");
        }

        public ColumnNames(String minecraftUsername, String minecraftVerified, String minecraftUuid, String verifyCode, String verifyExpires,
                            String membershipStatus, String membershipPeriodEnd) {
            this.minecraftUsername = minecraftUsername;
            this.minecraftVerified = minecraftVerified;
            this.minecraftUuid = minecraftUuid == null ? "" : minecraftUuid;
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

    public static class ProfileMatch {
        public final String id;
        public final String minecraftUsername;
        public final boolean verified;
        public final Instant verifyExpires;

        public ProfileMatch(String id, String minecraftUsername, boolean verified, Instant verifyExpires) {
            this.id = id;
            this.minecraftUsername = minecraftUsername;
            this.verified = verified;
            this.verifyExpires = verifyExpires;
        }
    }
}
