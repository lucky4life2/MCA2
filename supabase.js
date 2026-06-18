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
  // Try new permission system first
  try {
    const { data } = await supabase.rpc('user_has_permission', { perm: 'can_view_admin' });
    if (data === true) return true;
  } catch {}
  // Fallback: legacy role check
  const profile = await getProfile(userId, accessToken);
  return profile?.role === 'admin' || profile?.role === 'owner';
}

/**
 * Returns true if the current user has owner-level access.
 * Owner is the only one who can assign Admin or create roles.
 */
export async function isOwner(userId, accessToken) {
  try {
    const { data } = await supabase.rpc('user_has_permission', { perm: 'can_assign_admin' });
    if (data === true) return true;
  } catch {}
  // Fallback: legacy owner
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

/** Sign in with Discord OAuth */
export async function signInWithDiscord() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: window.location.origin + '/shop.html' }
  });
  if (error) console.error('Discord sign-in error:', error.message);
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
