// ── Supabase Client ──────────────────────────────────────────
// Pinned to an exact version rather than the "@2" tag: an unpinned tag lets
// esm.sh silently serve whatever the newest 2.x release is on every page
// load, with no code change or review here — a supply-chain drift risk.
// Bump this deliberately when upgrading.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

const SUPABASE_URL = 'https://hjaywokvgdzhvsoygctc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4lPs4a1t0cOdDRZ1VTpMpQ_fC2dHV_T';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // PKCE instead of the default implicit flow: no #access_token fragment
    // ever lands in the URL (fragments leak via referrers and logs), and
    // the callback code is exchanged with the stored code_verifier.
    flowType: 'pkce',
    // detectSessionInUrl used to run on every page. OAuth/link callbacks
    // can land on account.html (default return page and linkIdentity),
    // shop.html (nav sign-in buttons), or any ?return= page named from
    // login.html — so a page allowlist would break real logins. The
    // reliable gate is the callback itself: only exchange a code on a
    // page load that actually carries ?code=.
    detectSessionInUrl:
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('code'),
  },
});

// ── Network resilience helpers (pass 3) ──────────────────────────
// withRetry retries only thrown (network) failures, never { error }
// results — callers must still check `error` on the returned value.
// tries/backoff are proposals matching the shop page's existing 8s
// timeout scale, not club policy.
export async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 500 * (i + 1))); }
  }
  throw lastErr;
}

// withTimeout rejects after ms without cancelling the underlying request
// (Supabase queries take no signal) — same limitation as shop.page.js's
// existing wrapper, shared here so pages stop re-implementing it.
export function withTimeout(promise, ms = 8000) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out — having trouble reaching the server.')), ms))]);
}

// ── Resilient storage uploads + orphan sweep (stress-test item 4) ──
// Uploads are single-shot PUTs with no native timeout or resume, so a
// stalled connection (airplane mode, blackholed TCP) used to hang the
// Save button forever. These helpers bound every upload at 30s, retry
// once on network-type failures, and make sure a failed attempt can
// never leave a stray object behind.
//
// Design notes:
// - makePath() is called fresh on EVERY attempt, so each attempt gets a
//   unique timestamped path — a retry can never collide with, or
//   overwrite, an earlier attempt (same invariant the call sites already
//   relied on), and no `upsert` is needed.
// - Only THROWN errors are retried, and only network/timeout ones: a
//   returned { error } is a server verdict (RLS denial, too large, bad
//   type) that retrying cannot fix.
// - withTimeout does not cancel the underlying PUT, so an attempt that
//   timed out may still land server-side afterwards. Nothing ever
//   references a failed attempt's path (callers only learn the path on
//   success), so the helper best-effort removes attempted paths on
//   failure — and any path whose removal can't be confirmed is recorded
//   as an orphan for the sweep below.
export const UPLOAD_TIMEOUT_MS = 30000;
export const UPLOAD_MAX_ATTEMPTS = 2; // initial attempt + one retry

function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TypeError') return true;
  const msg = String(err.message || err);
  return /timed out|failed to fetch|network ?error|network request failed|load failed/i.test(msg);
}

/**
 * Uploads `file` to `bucket`, returning { path, data } for the attempt
 * that succeeded. Each attempt is capped at UPLOAD_TIMEOUT_MS (30s) and
 * a network/timeout failure is retried once with a fresh unique path.
 * Throws the last error, with `.attemptedPaths` listing every path tried.
 */
export async function uploadFileResilient(bucket, makePath, file, options = {}) {
  const attemptedPaths = [];
  let lastErr = null;
  for (let attempt = 0; attempt < UPLOAD_MAX_ATTEMPTS; attempt++) {
    const path = makePath();
    attemptedPaths.push(path);
    try {
      const { data, error } = await withTimeout(
        supabase.storage.from(bucket).upload(path, file, options),
        options.timeoutMs || UPLOAD_TIMEOUT_MS
      );
      if (error) { lastErr = error; break; } // server verdict — don't retry
      // Success: earlier attempts may have timed out but landed late.
      // Retract those stale paths; anything unconfirmed goes on the
      // orphan queue for the next sweep.
      const stale = attemptedPaths.slice(0, -1);
      if (stale.length) await cleanupUploadedPaths(bucket, stale);
      return { path, data };
    } catch (err) {
      lastErr = err;
      if (!isNetworkError(err)) break;
    }
  }
  // Final failure: nothing references any attempted path yet, so try to
  // retract them. A timeout leaves open that the PUT is still in flight
  // and lands after the removal, so timed-out paths are ALSO recorded as
  // orphans — the sweep's remove is idempotent, so re-removing a path
  // that is already gone is a harmless no-op.
  await cleanupUploadedPaths(bucket, attemptedPaths);
  if (isNetworkError(lastErr)) attemptedPaths.forEach(p => recordOrphanUpload(bucket, p));
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr?.message || lastErr || 'Upload failed.'));
  err.attemptedPaths = attemptedPaths;
  throw err;
}

/**
 * Best-effort removal of storage objects that were uploaded but never
 * referenced by a saved row (e.g. a batch that failed halfway). Returns
 * { removed, orphaned }: paths whose removal could not be confirmed are
 * recorded for the orphan sweep and listed as `orphaned`. Never throws.
 */
export async function cleanupUploadedPaths(bucket, paths) {
  const list = [...new Set((paths || []).filter(Boolean))];
  if (!list.length) return { removed: [], orphaned: [] };
  try {
    const { error } = await supabase.storage.from(bucket).remove(list);
    if (error) throw error;
    return { removed: list, orphaned: [] };
  } catch (e) {
    console.warn(`cleanupUploadedPaths(${bucket}) failed:`, e?.message || e);
    list.forEach(p => recordOrphanUpload(bucket, p));
    return { removed: [], orphaned: list };
  }
}

// ── Orphaned-upload queue ─────────────────────────────────────────
// A failed upload can leave an object in storage with no row pointing
// at it (timed-out PUT that lands late, batch failure before the row is
// saved, remove that failed). There is no server-side sweeper, so the
// client keeps a small localStorage queue of suspect paths and retries
// their removal on the next signed-in page load (nav.js calls
// sweepRecordedOrphans() after auth resolves). Removal is idempotent,
// so queueing a path that is already gone is harmless.
const ORPHAN_QUEUE_KEY = 'mca_orphan_uploads';
const ORPHAN_QUEUE_MAX = 100;
const ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function recordOrphanUpload(bucket, path) {
  if (!bucket || !path) return;
  try {
    const raw = localStorage.getItem(ORPHAN_QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    if (Array.isArray(queue) && !queue.some(e => e?.bucket === bucket && e?.path === path)) {
      queue.push({ bucket, path, at: Date.now() });
      while (queue.length > ORPHAN_QUEUE_MAX) queue.shift();
      localStorage.setItem(ORPHAN_QUEUE_KEY, JSON.stringify(queue));
    }
  } catch (e) { /* storage unavailable — the orphan simply stays */ }
}

/** Removes every queued orphaned object. Never throws. Entries older
 *  than 7 days are dropped without retrying; entries whose removal
 *  fails stay queued for the next sweep. */
export async function sweepRecordedOrphans() {
  let queue;
  try {
    queue = JSON.parse(localStorage.getItem(ORPHAN_QUEUE_KEY) || '[]');
    if (!Array.isArray(queue)) queue = [];
  } catch { return { swept: 0, remaining: 0 }; }
  if (!queue.length) return { swept: 0, remaining: 0 };
  const now = Date.now();
  const fresh = queue.filter(e => e?.bucket && e?.path && now - (e.at || 0) < ORPHAN_MAX_AGE_MS);
  const remaining = [];
  let swept = 0;
  for (const entry of fresh) {
    try {
      const { error } = await supabase.storage.from(entry.bucket).remove([entry.path]);
      if (error) throw error;
      swept++;
    } catch (e) {
      remaining.push(entry);
    }
  }
  try { localStorage.setItem(ORPHAN_QUEUE_KEY, JSON.stringify(remaining)); } catch {}
  return { swept, remaining: remaining.length };
}

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
// Roles are re-read on every page load by nav + each page; memoise for
// 60s within a page lifetime (proposal TTL — roles change rarely
// mid-session, and a reload always refetches). A failed lookup is not
// cached, and starting/ending a role preview clears the memo.
let _rolesCache = null, _rolesAt = 0;
export async function getCurrentUserRoles() {
  if (_rolesCache && Date.now() - _rolesAt < 60000) return _rolesCache;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase.rpc('get_user_roles', { p_user_id: user.id });
  if (error) { console.error('getCurrentUserRoles error:', error.message); return []; }
  _rolesCache = data || []; _rolesAt = Date.now();
  return _rolesCache;
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
const _permInflight = {};
export async function hasPermission(perm) {
  // Dedupe only concurrent identical checks. No time-based memo: a cached
  // permission could outlive a demotion or a role-preview change.
  if (_permInflight[perm]) return _permInflight[perm];
  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc('user_has_permission', { perm });
      if (error) return false;
      return !!data;
    } catch { return false; }
  })();
  _permInflight[perm] = p;
  try { return await p; } finally { delete _permInflight[perm]; }
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
  _rolesCache = null;
}

/** Ends the current preview (if any), returning to the user's real roles. */
export async function endRolePreview() {
  const { error } = await supabase.rpc('end_role_preview');
  if (error) throw error;
  _rolesCache = null;
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
/** Sign out */
export async function signOut() {
  // End any active role preview BEFORE the session (and its access token)
  // is destroyed: end_role_preview is a plain DELETE (no error when no
  // preview exists), but once sign-out runs the token the preview row
  // needs is gone, so the preview would otherwise survive sign-out and
  // keep substituting permissions on the next sign-in
  // (auth:role-preview:no-expiry-retention, client half).
  await endRolePreview();
  await supabase.auth.signOut();
}

/**
 * Sign out everywhere (stress-test item 19): revokes the refresh tokens
 * for every session on every device, not just this browser. Same role
 * preview cleanup as signOut() first, for the same reason.
 */
export async function signOutGlobal() {
  await endRolePreview();
  await supabase.auth.signOut({ scope: 'global' });
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
export async function createCheckoutSession(items, idempotencyKey) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('You must be signed in to check out.');
  // One idempotency key per checkout intent: the shop persists one key per
  // cart (localStorage mca_checkout_intent_<userId>) and passes it here so
  // a retry/refresh/second tab returns the original Stripe session.
  // A caller that passes nothing keeps the old per-click behaviour.
  const key = typeof idempotencyKey === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)
    ? idempotencyKey
    : (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items, idempotencyKey: key }),
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
    signal: AbortSignal.timeout(15000),
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

// ── Image upload optimization ─────────────────────────────────────
// Club decision (2026-11-02): user-uploaded images are resized, converted,
// and stripped of EXIF before they reach Storage. A phone photo's EXIF can
// carry GPS coordinates, so drawing through a canvas (which drops all
// metadata) is a privacy fix, not just a size win. Non-images, SVGs
// (vector — rasterizing would destroy them), and GIFs (animation would be
// lost to a single frame) pass through unchanged. Avatars don't exist on
// the site, so the 512px avatar size has no call site yet; pass maxEdge
// explicitly if one is ever added.
export async function optimizeImageFile(file, maxEdge = 2048) {
  if (!file || !file.type.startsWith('image/')) return file;
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('That image is over 10 MB. Please choose a smaller file.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That image could not be processed — please choose another file.');
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  const toBlob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  // WebP keeps alpha, so it is the first choice for every image.
  let blob = await toBlob('image/webp', 0.8);
  let ext = 'webp';
  if (!blob) {
    // No WebP encoder (old browser): JPEG for opaque images, original file
    // for images with any alpha, so transparency is never silently lost.
    const data = ctx.getImageData(0, 0, width, height).data;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) { hasAlpha = true; break; }
    }
    if (hasAlpha) return file;
    blob = await toBlob('image/jpeg', 0.8);
    ext = 'jpg';
    if (!blob) return file;
  }
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

// ── Private-bucket signed URLs ─────────────────────────────────────
// storage:unpublished-public-bucket-objects (MEDIUM): archive-files and
// news-images are PRIVATE buckets (migration
// 20261112_storage_private_buckets.sql), so a stored public URL no longer
// serves anything. Rows store the STORAGE PATH (e.g.
// "<uid>/1234-file.pdf"), and render sites mint a short-lived signed URL
// from it at render time — only while the row is published, or while its
// author/approver is previewing it. Legacy rows still store the old full
// public URL; the parser below accepts both shapes. Values that are not
// objects in the requested bucket (an external image URL pasted by hand, a
// shop-images URL) pass through unchanged — they are not governed by this
// bucket's privacy.
//
// Why the client mints the URL instead of the server: createSignedUrl
// requires a storage.objects SELECT policy for the caller, and the
// migration adds publication-gated SELECT policies for both buckets
// (published row referencing the object, or author/approver/manager),
// so anonymous visitors can mint a signed URL for a published object
// while draft objects stay unreadable. A signed URL is a bearer token
// valid for SIGNED_URL_TTL_SECONDS — short, so an unpublish takes
// effect for new renders within the hour; already-issued URLs keep
// serving until they expire (residual risk, see the migration header).
export const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

// Classifies a stored value for one bucket:
//   { kind: 'path', path }  — a bare storage path, or a stored Supabase
//                             storage URL (public or signed) for this bucket
//   { kind: 'external' }    — anything else (external URL, another bucket's
//                             object, a non-storage URL on our own host)
//   { kind: 'empty' }       — blank / missing
function parseStoredStorageValue(bucket, stored) {
  const raw = String(stored ?? '').trim();
  if (!raw) return { kind: 'empty' };
  // No scheme and no protocol-relative prefix: the bare-path shape new
  // uploads store. (A stored value of just a path never contains '://'.)
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('//')) {
    return { kind: 'path', path: raw.replace(/^\/+/, '') };
  }
  let url;
  try {
    url = new URL(raw, typeof window !== 'undefined' ? window.location.href : undefined);
  } catch {
    return { kind: 'path', path: raw.replace(/^\/+/, '') };
  }
  let supabaseHost = null;
  try { supabaseHost = new URL(SUPABASE_URL).hostname; } catch { /* unreachable: constant */ }
  if (url.hostname !== supabaseHost) return { kind: 'external' };
  // /storage/v1/object/public/<bucket>/<path> or /object/sign/<bucket>/<path>
  const m = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
  if (!m) return { kind: 'external' };
  if (m[1] !== bucket) return { kind: 'external' };
  let path = m[2];
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  return { kind: 'path', path };
}

/**
 * Returns a renderable URL for a value stored in a private bucket, or
 * null when it must not be shown.
 *   bucket: 'archive-files' | 'news-images'
 *   storedUrl: the stored storage path, or a legacy stored public URL
 *   opts.status: the owning row's status — a signed URL is minted only
 *     when it is 'published', unless opts.isAuthorOrApprover is true
 *     (author/coauthor/approver previewing their own row).
 * External URLs and other buckets' objects pass through unchanged.
 * On any minting failure (object deleted, policy denied, offline) this
 * returns null — callers render "no file/image", never the raw stored
 * value, so a private-bucket path can never leak into an href/src.
 */
export async function signedUrlForPublished(bucket, storedUrl, { status, isAuthorOrApprover } = {}) {
  if (!storedUrl) return null;
  if (status !== 'published' && !isAuthorOrApprover) return null;
  const parsed = parseStoredStorageValue(bucket, storedUrl);
  if (parsed.kind === 'empty') return null;
  if (parsed.kind === 'external') return String(storedUrl).trim();
  // Bounded at 8s so a stalled connection fails fast into the caller's
  // "no file/image" render instead of hanging the page (stress-test 17).
  // A timeout is still just a null here — callers never show the raw path.
  const { data, error } = await withTimeout(
    supabase.storage.from(bucket).createSignedUrl(parsed.path, SIGNED_URL_TTL_SECONDS),
    8000
  ).catch(err => ({ data: null, error: err }));
  if (error || !data?.signedUrl) {
    console.error(`signedUrlForPublished(${bucket}) error:`, error?.message || 'no signed URL returned');
    return null;
  }
  return data.signedUrl;
}

/**
 * Rewrites markdown image URLs that point at objects in a private bucket
 * to render-time signed URLs (see signedUrlForPublished). News body
 * markdown embeds inline photos as `![alt](<stored path or URL>)`, and
 * reference-style photos as `![alt][photo-1]` with a `[photo-1]: <stored
 * path or URL>` definition at the end, so the hero image_url alone is
 * not the whole render surface.
 * External image URLs pass through untouched; an image whose signed URL
 * cannot be minted is left as-is (it 404s rather than vanishing the
 * surrounding text — the owning row is already gated to published-or-
 * author-preview by the caller, so this is a transient failure, not a
 * publication bypass).
 */
export async function resolvePrivateBucketImagesInMarkdown(bucket, md, opts = {}) {
  if (!md || typeof md !== 'string') return md || '';
  const urls = new Set();
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) urls.add(m[1]);
  for (const m of md.matchAll(/^\[[^\]]+\]:[ \t]*([^\s]+)/gm)) urls.add(m[1]);
  if (!urls.size) return md;
  const resolved = new Map();
  await Promise.all([...urls].map(async (u) => {
    if (!resolved.has(u)) resolved.set(u, await signedUrlForPublished(bucket, u, opts));
  }));
  let out = md.replace(/!\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (m, alt, url, title) => {
    const next = resolved.get(url);
    return next ? `![${alt}](${next}${title})` : m;
  });
  out = out.replace(/^(\[[^\]]+\]:[ \t]*)([^\s]+)/gm, (m, pre, url) => {
    const next = resolved.get(url);
    return next ? pre + next : m;
  });
  return out;
}
