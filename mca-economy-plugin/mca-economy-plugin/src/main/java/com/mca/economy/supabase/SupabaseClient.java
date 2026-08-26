package com.mca.economy.supabase;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * Thin client for Supabase's PostgREST layer. Every call here uses the
 * service_role key, which bypasses row-level security entirely — the
 * actual security boundary is inside the Postgres functions themselves
 * (the internal {@code _economy_*} functions take an explicit p_actor
 * argument that this plugin fills in after resolving a player's verified
 * Minecraft UUID to a website profile id).
 *
 * All methods here block the calling thread on network I/O. Call them
 * from an async task (see MCAEconomyPlugin#runAsync), never the main
 * server thread, with the sole exception of the rare synchronous call a
 * Vault deposit/withdraw makes (documented on VaultEconomyProvider).
 */
public class SupabaseClient {

    private final String baseUrl;
    private final String serviceRoleKey;
    private final HttpClient http;
    private final Gson gson = new Gson();

    public SupabaseClient(String baseUrl, String serviceRoleKey) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.serviceRoleKey = serviceRoleKey;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    /**
     * Calls a Postgres RPC function (e.g. "_economy_transfer").
     *
     * @param functionName the SQL function name
     * @param params       named parameters matching the function's argument names
     * @return the parsed JSON response — an object for a single-row return,
     *         an array for a setof return, or a raw scalar (e.g. a quoted uuid string)
     */
    public JsonElement rpc(String functionName, Map<String, Object> params) throws EconomyException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/rest/v1/rpc/" + functionName))
                .timeout(Duration.ofSeconds(15))
                .header("apikey", serviceRoleKey)
                .header("Authorization", "Bearer " + serviceRoleKey)
                .header("Content-Type", "application/json")
                .header("Prefer", "return=representation")
                .POST(HttpRequest.BodyPublishers.ofString(gson.toJson(params)))
                .build();
        return send(request);
    }

    /**
     * Reads rows directly from a table via PostgREST (respects RLS unless
     * the service role key bypasses it, as it does here). Use for simple
     * public reads like the company list, where a dedicated RPC isn't
     * needed.
     *
     * @param table       table name, e.g. "economy_companies"
     * @param queryString raw PostgREST query string, e.g. "is_active=eq.true&order=ticker.asc" (no leading '?')
     */
    public JsonElement select(String table, String queryString) throws EconomyException {
        String url = baseUrl + "/rest/v1/" + table + (queryString == null || queryString.isBlank() ? "" : "?" + queryString);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .header("apikey", serviceRoleKey)
                .header("Authorization", "Bearer " + serviceRoleKey)
                .GET()
                .build();
        return send(request);
    }

    /**
     * Inserts a single row directly into a table via PostgREST and returns
     * the inserted row. Used for simple, plugin-owned tables (like
     * economy_shops) that don't need actor-scoped validation through an RPC.
     */
    public JsonElement insert(String table, Map<String, Object> row) throws EconomyException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/rest/v1/" + table))
                .timeout(Duration.ofSeconds(15))
                .header("apikey", serviceRoleKey)
                .header("Authorization", "Bearer " + serviceRoleKey)
                .header("Content-Type", "application/json")
                .header("Prefer", "return=representation")
                .POST(HttpRequest.BodyPublishers.ofString(gson.toJson(row)))
                .build();
        return send(request);
    }

    /**
     * Deletes rows matching a PostgREST filter query string, e.g.
     * "world=eq.world&x=eq.5&y=eq.64&z=eq.-12" (no leading '?').
     */
    public void delete(String table, String queryString) throws EconomyException {
        String url = baseUrl + "/rest/v1/" + table + (queryString == null || queryString.isBlank() ? "" : "?" + queryString);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .header("apikey", serviceRoleKey)
                .header("Authorization", "Bearer " + serviceRoleKey)
                .DELETE()
                .build();
        send(request);
    }

    private JsonElement send(HttpRequest request) throws EconomyException {
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new EconomyException("Could not reach the economy database: " + e.getMessage(), e);
        }

        String body = response.body();
        if (response.statusCode() >= 200 && response.statusCode() < 300) {
            if (body == null || body.isBlank()) return null;
            return JsonParser.parseString(body);
        }

        String message = "Economy database error (HTTP " + response.statusCode() + ")";
        try {
            JsonObject err = JsonParser.parseString(body).getAsJsonObject();
            if (err.has("message") && !err.get("message").isJsonNull()) {
                message = err.get("message").getAsString();
            }
        } catch (Exception ignored) {
            // Non-JSON error body — fall back to the generic message above.
        }
        throw new EconomyException(message);
    }
}
