// ── Supabase Client ──────────────────────────────────────────
// Pinned to an exact version rather than the "@2" tag: an unpinned tag lets
// esm.sh silently serve whatever the newest 2.x release is on every page
// load, with no code change or review here — a supply-chain drift risk.
// Bump this deliberately when upgrading.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

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
 * Uses the server-side permission RPC exclusively. A failed or errored
 * check denies access — it must never fall back to a broader grant.
 */
export async function isAdmin(userId, accessToken) {
  try {
    const { data, error } = await supabase.rpc('user_has_permission', { perm: 'can_view_admin' });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the current user has owner-level access.
 * Owner is the only one who can assign Admin or create roles.
 * A failed or errored check denies access.
 */
export async function isOwner(userId, accessToken) {
  try {
    const { data, error } = await supabase.rpc('user_has_permission', { perm: 'can_assign_admin' });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
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
/**
 * Signing in is what reactivates a deactivated (dormant) account. Every
 * sign-in path funnels through here — login.html after a password/MFA
 * sign-in, and nav.js/account.html for OAuth, which redirects straight to
 * the destination page. Memoised per page load so concurrent callers share
 * one RPC and only one of them sees reactivated: true.
 * Resolves to { reactivated: boolean, status: string|null }. A dormant
 * account that is also frozen is NOT reactivated (status stays 'frozen').
 */
let _reactivatePromise = null;
export function reactivateIfDormant() {
  if (!_reactivatePromise) {
    _reactivatePromise = supabase.rpc('reactivate_own_account')
      .then(({ data, error }) => (error || !data)
        ? { reactivated: false, status: null }
        : { reactivated: data.reactivated === true, status: data.status ?? null })
      .catch(() => ({ reactivated: false, status: null }))
      .then(result => {
        // nav.js shows "You've reactivated your account" from this flag — on
        // this page, or on the next one when login.html redirects away.
        if (result.reactivated) {
          try { sessionStorage.setItem('mca_reactivated_notice', '1'); } catch (e) {}
          try { window.dispatchEvent(new Event('mca:reactivated')); } catch (e) {}
        }
        return result;
      });
  }
  return _reactivatePromise;
}

/** Sign out */
export async function signOut() {
  await supabase.auth.signOut();
}

/**
 * Guards a protected page against the AAL1-only bypass: a session is
 * live (and passes a plain getSession()/getUser() check) as soon as the
 * password step succeeds, before any enrolled TOTP factor is verified.
 * Call this right after confirming a session exists, on every page that
 * requires being signed in. Returns true if the page should render;
 * otherwise it has already redirected to the MFA challenge and the
 * caller should stop.
 */
export async function requireAal2(returnPath) {
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
      window.location.replace(`login.html?return=${encodeURIComponent(returnPath)}&mfa=1`);
      return false;
    }
  } catch (e) {}
  return true;
}

// ── Checkout ─────────────────────────────────────────────────

/**
 * Creates a Stripe Checkout Session for the given cart items via the
 * create-checkout-session Edge Function, and returns the session URL to
 * redirect the browser to. items: [{ id, qty }]. Throws on any failure
 * (not signed in, empty cart, Stripe/Edge Function error).
 */
export async function createCheckoutSession(items) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('You must be signed in to check out.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.url) throw new Error(result.error || 'Could not start checkout.');
  return result.url;
}

/**
 * Returns the signed-in user's membership state, or null when signed out.
 * { status, source, periodEnd (Date|null), isActive }. An active membership
 * is status 'active' AND a period end still in the future — the same rule
 * nav.js, the account page and the Minecraft plugin all gate on, kept in
 * one place so they can't drift apart.
 */
export async function getMembership() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('membership_status, membership_source, membership_current_period_end')
    .eq('id', user.id)
    .single();
  if (error) { console.error('getMembership error:', error.message); return null; }
  const periodEnd = data?.membership_current_period_end ? new Date(data.membership_current_period_end) : null;
  return {
    status: data?.membership_status || 'none',
    source: data?.membership_source || null,
    periodEnd,
    isActive: data?.membership_status === 'active' && !!periodEnd && periodEnd.getTime() > Date.now(),
  };
}

/**
 * Opens the Stripe Billing Portal for the signed-in member and returns the
 * URL to redirect the browser to. This is the only way a paying member can
 * change their card, see an invoice, or cancel — the Edge Function has been
 * deployed since the membership launch but nothing on the site called it.
 * returnTo is a bare page name on this site (validated server-side too).
 * Throws on any failure (not signed in, comped membership with no Stripe
 * customer behind it, Stripe/Edge Function error).
 */
export async function createBillingPortalSession(returnTo = 'account.html') {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('You must be signed in to manage billing.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-billing-portal-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ return_to: returnTo }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.url) throw new Error(result.error || 'Could not open the billing portal.');
  return result.url;
}
