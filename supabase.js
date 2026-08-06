// ── Supabase Client ──────────────────────────────────────────
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://hjaywokvgdzhvsoygctc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqYXl3b2t2Z2R6aHZzb3lnY3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzA2NTQsImV4cCI6MjA5NTg0NjY1NH0.nFqlc20iUDwE1sXLRi2Pev181v2RJKx_S6UcTkGgPWU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Auth helpers ─────────────────────────────────────────────

/** Returns the current session user, or null */
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Returns the profile row for a given user id, or null */
export async function getProfile(userId, accessToken) {
  if (!userId) return null;
  const client = accessToken
    ? createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: `Bearer ${accessToken}` } } })
    : supabase;
  const { data, error } = await client
    .from('profiles')
    .select('role, display_name, username, email')
    .eq('id', userId)
    .single();
  if (error) console.error('getProfile error:', error.message);
  return data;
}

// ── New role/permission helpers ──────────────────────────────

/**
 * Returns the stacked roles for the current authenticated user.
 * Each role: { role_id, name, label, color, level, is_system, permissions, granted_at }
 */
export async function getCurrentUserRoles() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.rpc('get_user_roles', { p_user_id: user.id });
  if (error) { console.error('getCurrentUserRoles error:', error.message); return []; }
  return data || [];
}

/**
 * Returns a merged permissions object for the current user,
 * combining all their roles (any true wins).
 */
export async function getCurrentUserPermissions() {
  const roles = await getCurrentUserRoles();
  const merged = {};
  for (const role of roles) {
    const perms = role.permissions || {};
    for (const [key, val] of Object.entries(perms)) {
      if (val === true) merged[key] = true;
      else if (!(key in merged)) merged[key] = false;
    }
  }
  return merged;
}

/**
 * Returns true if the current user has the given permission flag.
 * Uses server-side RPC for reliable enforcement.
 */
export async function hasPermission(perm) {
  try {
    const { data, error } = await supabase.rpc('user_has_permission', { perm });
    if (error) return false;
    return !!data;
  } catch { return false; }
}

/**
 * Returns true if the current user can view the admin panel.
 * Checks for can_view_admin permission OR legacy admin/owner role.
 */
export async function isAdmin(userId, accessToken) {
  // Try new permission system first — this respects an active "view as"
  // role preview, so trust its result whenever the call succeeds instead of
  // falling through to the raw (preview-unaware) legacy role check below.
  try {
    const { data, error } = await supabase.rpc('user_has_permission', { perm: 'can_view_admin' });
    if (!error) return data === true;
  } catch {}
  // Fallback: legacy role check (only reached if the RPC itself errored)
  const profile = await getProfile(userId, accessToken);
  return profile?.role === 'admin' || profile?.role === 'owner';
}

/**
 * Returns true if the current user has owner-level access.
 * Owner is the only one who can assign Admin or create roles.
 */
export async function isOwner(userId, accessToken) {
  try {
    const { data, error } = await supabase.rpc('user_has_permission', { perm: 'can_assign_admin' });
    if (!error) return data === true;
  } catch {}
  // Fallback: legacy owner (only reached if the RPC itself errored)
  const profile = await getProfile(userId, accessToken);
  return profile?.role === 'owner';
}

/** @deprecated Use isOwner() instead */
export async function isSuperAdmin(userId, accessToken) {
  return isOwner(userId, accessToken);
}

/**
 * Returns true if the current user has the "news" permission
 * (can_manage_news), allowing news publishing access.
 */
export async function canManageNews() {
  return hasPermission('can_manage_news');
}

// ── Role preview ("view as role") helpers ─────────────────────

/**
 * Starts a "view as role" session for the current user. Requires
 * can_manage_roles for real, and the target role must be at or below
 * the caller's own real level. Lasts 30 minutes or until endRolePreview().
 * Throws if the server rejects it (not authorized / role above level).
 */
export async function startRolePreview(roleId) {
  const { error } = await supabase.rpc('start_role_preview', { p_role_id: roleId });
  if (error) throw error;
}

/** Ends the current preview (if any), returning to the user's real roles. */
export async function endRolePreview() {
  const { error } = await supabase.rpc('end_role_preview');
  if (error) throw error;
}

// Same as endRolePreview(), but issued with fetch(..., { keepalive: true })
// instead of supabase.rpc(), so the request actually survives a tab close /
// navigation-away instead of getting cancelled mid-flight. Used from nav.js's
// pagehide handler, not from the "Exit preview" button (that one already
// works fine with the normal endRolePreview()).
export async function endRolePreviewBeacon() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    fetch(`${SUPABASE_URL}/rest/v1/rpc/end_role_preview`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`
      },
      body: '{}'
    });
  } catch (e) {}
}

/**
 * Returns the active preview role for the current user, or null if
 * there isn't one. { role_id, name, label, color, level, expires_at }
 */
export async function getMyRolePreview() {
  try {
    const { data, error } = await supabase.rpc('get_my_role_preview');
    if (error || !data || !data.length) return null;
    return data[0];
  } catch { return null; }
}

/** Sign in with Discord OAuth */
export async function signInWithDiscord() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + '/shop.html' }
  });
  if (error) console.error('Discord sign-in error:', error.message);
}

/** Sign in with Google OAuth */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/shop.html' }
  });
  if (error) console.error('Google sign-in error:', error.message);
}

/** Sign in with email + password */
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Sign out */
export async function signOut() {
  await supabase.auth.signOut();
}
