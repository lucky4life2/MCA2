// Apply dark mode immediately to prevent flash
(function() {
  if (localStorage.getItem('mca_theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// site_config is admin-editable, so its URLs are untrusted input. Anything but
// http(s) is dropped, and the result is attribute-escaped before it reaches an
// href in the nav/footer templates below.
function safeLinkUrl(url, fallback) {
  const u = String(url ?? '').trim();
  return escapeHtml(/^https?:\/\//i.test(u) ? u : fallback);
}



// Discord URL and site config — loaded from Supabase settings, falls back to hardcoded value
let DISCORD_URL = 'https://discord.gg/hZrt28vG29';
let YOUTUBE_URL = 'https://www.youtube.com/@MinecraftClubOfAmerica';
let EMAIL_US = 'minecraftclubofamerica@gmail.com';
let SITE_CONFIG = {};
// Set right before a same-site navigation happens (link click / form
// submit), so the role-preview pagehide handler below can tell "moving to
// another page on the site" apart from "actually closing the tab" — both
// fire the same pagehide event.
let _mcaInternalNav = false;
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (a && a.href && a.origin === window.location.origin) _mcaInternalNav = true;
}, true);
document.addEventListener('submit', () => { _mcaInternalNav = true; }, true);
let _configResolve;
const _configReady = new Promise(r => { _configResolve = r; });

(async function loadConfig() {
  const SUPABASE_URL_CFG  = 'https://hjaywokvgdzhvsoygctc.supabase.co';
  const SUPABASE_ANON_CFG = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqYXl3b2t2Z2R6aHZzb3lnY3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzA2NTQsImV4cCI6MjA5NTg0NjY1NH0.nFqlc20iUDwE1sXLRi2Pev181v2RJKx_S6UcTkGgPWU';
  try {
    const res = await fetch(
      `${SUPABASE_URL_CFG}/rest/v1/settings?key=eq.site_config&select=value`,
      { headers: { 'apikey': SUPABASE_ANON_CFG, 'Authorization': `Bearer ${SUPABASE_ANON_CFG}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows.length) {
        try { SITE_CONFIG = JSON.parse(rows[0].value); } catch(e) {}
        const withProtocol = (u) => u && !/^https?:\/\//i.test(u) ? 'https://' + u : u;
        if (SITE_CONFIG.discord_url) DISCORD_URL = withProtocol(SITE_CONFIG.discord_url);
        if (SITE_CONFIG.youtube_url) YOUTUBE_URL = withProtocol(SITE_CONFIG.youtube_url);
        if (SITE_CONFIG.email_us) EMAIL_US = SITE_CONFIG.email_us;
      }
    }
  } catch(e) {}
  _configResolve();
  window.EMAIL_US = EMAIL_US;
})();
window._configReady = _configReady;

const NAV_HTML = () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const wideLogo   = dark ? 'images/widelogo-dark.png'  : 'images/widelogo-light.png';
  const squareLogo = dark ? 'images/logo-dark.png'      : 'images/logo-light.png';
  return `
<nav>
  <a class="nav-logo" href="index.html">
    <img src="${wideLogo}" alt="Minecraft Club of America" class="nav-logo-img" id="nav-logo-img">
  </a>
  <ul class="nav-links" id="nav-links">
    <li><a href="index.html"      data-page="index">Home</a></li>
    <li class="nav-has-dropdown" id="nav-server-item">
      <a href="#" class="nav-dropdown-trigger" data-page="server-hub" aria-expanded="false" onclick="return false;">Server <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></a>
      <ul class="nav-dropdown" id="nav-server-dropdown">
        <li><a href="server.html"  data-page="server">Server</a></li>
        <li><a href="economy.html" data-page="economy">Economy</a></li>
        <li><a href="stocks.html"  data-page="stocks">Stock Exchange</a></li>
      </ul>
    </li>
    <li class="nav-has-dropdown" id="nav-community-item">
      <a href="#" class="nav-dropdown-trigger" data-page="community" aria-expanded="false" onclick="return false;">Community <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></a>
      <ul class="nav-dropdown" id="nav-community-dropdown">
        <li><a href="news.html"    data-page="news">News</a></li>
        <li><a href="nations.html" data-page="nations">Nations</a></li>
        <li><a href="congress.html" data-page="congress">Congress</a></li>
        <li><a href="court.html" data-page="court">World Court</a></li>
      </ul>
    </li>
    <li class="nav-has-dropdown" id="nav-about-item">
      <a href="#" class="nav-dropdown-trigger" data-page="about" aria-expanded="false" onclick="return false;">About <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></a>
      <ul class="nav-dropdown" id="nav-about-dropdown">
        <li><a href="leadership.html" data-page="leadership">Leadership</a></li>
        <li><a href="archive.html"    data-page="archive">Archive</a></li>
        <li><a href="history.html"    data-page="history">History</a></li>
      </ul>
    </li>
    <li><a href="${safeLinkUrl(DISCORD_URL, 'https://discord.gg/hZrt28vG29')}" data-discord target="_blank" rel="noopener noreferrer" class="nav-discord">Discord</a></li>
    <li class="nav-theme-item nav-theme-item-mobile">
      <div class="nav-account nav-account-mobile" id="nav-account-mobile"></div>
      <button class="nav-theme-toggle nav-theme-toggle-mobile" aria-label="Toggle dark mode">
        <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      </button>
    </li>
  </ul>
  <div class="nav-right">
    <div class="nav-account nav-account-desktop" id="nav-account"></div>
    <button class="nav-theme-toggle" id="nav-theme-toggle" aria-label="Toggle dark mode">
      <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    </button>
    <button class="nav-hamburger" id="nav-hamburger" aria-label="Toggle menu">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
`; }; // end NAV_HTML

const FOOTER_HTML = () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const squareLogo = dark ? 'images/logo-dark.png' : 'images/logo-light.png';
  return `
<footer>
  <div class="footer-inner">

    <div class="footer-brand">
      <div class="footer-logo">
        <img src="${squareLogo}" alt="Minecraft Club of America" class="footer-logo-img" id="footer-logo-img">
        <span class="footer-logo-text">Minecraft Club of America</span>
      </div>
      <p class="footer-tagline">Trade · Build · Govern · Create</p>
      <span class="footer-copy">© <span id="year"></span> Minecraft Club of America · Ratified May 13, 2025</span>
    </div>

    <div class="footer-links">
      <div class="footer-col">
        <div class="footer-col-title">Navigate</div>
        <a href="index.html">Home</a>
        <a href="server.html">Server</a>
        <a href="leadership.html">Leadership</a>
        <a href="history.html">History</a>
        <a href="nations.html">Nations</a>
        <a href="news.html">News</a>
        <a href="archive.html">Archive</a>
        <a href="help.html">Help</a>
      </div>

      <div class="footer-col">
        <div class="footer-col-title">Connect</div>
        <a href="${safeLinkUrl(DISCORD_URL, 'https://discord.gg/hZrt28vG29')}" data-discord target="_blank" rel="noopener noreferrer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.03.057a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          Discord
        </a>
        <a href="${safeLinkUrl(YOUTUBE_URL, 'https://www.youtube.com/@MinecraftClubOfAmerica')}" data-youtube target="_blank" rel="noopener noreferrer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          YouTube
        </a>
        <a href="#" id="footer-email-btn" onclick="copyEmail(this);return false;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          Email Us
        </a>
      </div>

      <div class="footer-col">
        <div class="footer-col-title">Legal</div>
        <a href="privacy.html">Privacy Policy</a>
        <a href="terms.html">Terms of Service</a>
      </div>
    </div>

  </div>
  <div class="footer-disclaimer">
    Not affiliated with, endorsed by, or associated with Mojang Studios or Microsoft.
    Minecraft is a trademark of Mojang Studios.
    <span class="footer-version">v2.5.67</span>
  </div>
</footer>
`; }; // end FOOTER_HTML

const TOAST_HTML = `<div class="toast" id="toast" role="status" aria-live="polite">Address copied to clipboard</div>`;

const PROGRESS_HTML = `<div class="scroll-progress" id="scroll-progress"></div>`;

// Declared here (before the site-lock IIFE below) because that IIFE can call
// injectNav() synchronously on some pages (e.g. admin.html, or ?preview=key),
// with no `await` in between — meaning it runs before the rest of this
// script's top-level code has executed. If _mcaAuthResolve were declared
// further down the file (as a `let`), that early synchronous call would hit
// it while still in the temporal dead zone and throw a ReferenceError,
// silently breaking the entire nav auth/account button on that page.
let _mcaAuthResolve;
window._mcaAuthReady = new Promise(r => { _mcaAuthResolve = r; });


/* ── SYSTEM LOCKDOWN (separate from the site lock below) ─────
   This is a second, independent kill switch. It has no admin bypass, no
   preview-key bypass, and applies to every page including admin.html. There
   is no button or RPC anywhere in the app that can flip it — the
   `system_lockdown` table only accepts SELECT from anon/authenticated (see
   migration), so the only way to turn it on/off is to run SQL directly in
   the Supabase dashboard. If the check itself can't reach Supabase, it fails
   open (lets the page continue) rather than bricking the site on a network
   hiccup — the switch only blocks when it can positively confirm
   `locked = true`.

   Everything else in this file (including the admin.html fast-path below)
   awaits `_systemLockdownCheck` before doing anything else, so there is no
   timing window where a page can render before this resolves. */
(function() {
  document.documentElement.style.visibility = 'hidden';
})();

const _systemLockdownCheck = (async function checkSystemLockdown() {
  const SUPABASE_URL  = 'https://hjaywokvgdzhvsoygctc.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqYXl3b2t2Z2R6aHZzb3lnY3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzA2NTQsImV4cCI6MjA5NTg0NjY1NH0.nFqlc20iUDwE1sXLRi2Pev181v2RJKx_S6UcTkGgPWU';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/system_lockdown?select=locked,message&id=eq.1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows?.[0]?.locked === true) {
        if (window.stop) window.stop();
        document.documentElement.style.visibility = '';
        document.documentElement.innerHTML = `<head><meta charset="utf-8"><title>Unavailable</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#05070f;font-family:'Open Sans',sans-serif;padding:2rem;text-align:center;">
          <div>
            <h1 style="color:#fff;font-size:1.6rem;font-weight:700;margin:0 0 0.75rem;">Site Unavailable</h1>
            <p style="color:#94a3b8;font-size:0.95rem;max-width:420px;line-height:1.6;margin:0 auto;">${(rows[0].message || 'This site is temporarily unavailable. Please check back later.').replace(/</g,'&lt;')}</p>
          </div>
        </body>`;
        return { locked: true };
      }
    }
  } catch (e) {
    // Can't reach the table — fail open.
  }
  return { locked: false };
})();


const PREVIEW_KEY     = 'I-pG1idLnWhIjId9i1TLAumZkBQjVcvc';
const SUPABASE_URL    = 'https://hjaywokvgdzhvsoygctc.supabase.co';
const SUPABASE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqYXl3b2t2Z2R6aHZzb3lnY3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzA2NTQsImV4cCI6MjA5NTg0NjY1NH0.nFqlc20iUDwE1sXLRi2Pev181v2RJKx_S6UcTkGgPWU';

let _siteLocked = false;
let _lockCheckResolve;
const _lockCheckDone = new Promise(r => { _lockCheckResolve = r; });

// Hide page until lock check completes (unless preview key present)
(function() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('preview') !== PREVIEW_KEY) {
    document.documentElement.style.visibility = 'hidden';
  }
})();

(async function checkLock() {
  // Wait on the independent system lockdown check first — if it's active,
  // it has already replaced the page and halted everything; nothing below
  // (including the admin.html fast-path) should run.
  const lockdownState = await _systemLockdownCheck;
  if (lockdownState.locked) { return; }

  // If preview key is in the URL, reveal immediately and skip lock check
  const params = new URLSearchParams(window.location.search);
  if (params.get('preview') === PREVIEW_KEY) {
    document.documentElement.style.visibility = '';
    _lockCheckResolve();
    injectNav();
    return;
  }

  // Admin pages are never locked — admins need access to turn the lock off
  // Cloudflare Pages strips .html extensions, so /admin.html is served at /admin
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  if (currentPage === 'admin.html' || currentPage === 'admin') {
    document.documentElement.style.visibility = '';
    _lockCheckResolve();
    injectNav();
    return;
  }

  try {
    // Check lock state from Supabase settings table
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?key=eq.site_lock&select=value`,
      {
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
        }
      }
    );

    if (!res.ok) { document.documentElement.style.visibility = ''; _lockCheckResolve(); injectNav(); return; }

    const rows = await res.json();
    if (!rows.length) { document.documentElement.style.visibility = ''; _lockCheckResolve(); injectNav(); return; }

    let cfg = {};
    try { cfg = JSON.parse(rows[0].value); } catch(e) { cfg = {}; }

    if (cfg.locked !== true) {
      document.documentElement.style.visibility = '';
      _lockCheckResolve();
      injectNav();
      return;
    }

    // Check if the current user is an admin — admins bypass the lock.
    // The whole check is raced against a hard timeout so a stuck network
    // call (or a stuck/deadlocked auth client) can never leave the page
    // hidden forever — it will always fall back to the lock screen instead.
    let isAdminBypass = false;
    try {
      isAdminBypass = await Promise.race([
        (async () => {
          const { supabase: _sb } = await import('./supabase.js');
          const { data: { session } } = await _sb.auth.getSession();
          const token = session?.access_token;
          if (!token) return false;

          // Check legacy profiles.role
          const profileRes = await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${session.user.id}`,
            {
              headers: {
                'apikey': SUPABASE_ANON,
                'Authorization': `Bearer ${token}`,
              }
            }
          );
          if (profileRes.ok) {
            const profiles = await profileRes.json();
            const role = profiles?.[0]?.role;
            if (role === 'admin' || role === 'owner') return true;
          }

          // Check new roles system via RPC
          const rpcRes = await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/user_has_permission`,
            {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_ANON,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ perm: 'can_view_admin' }),
            }
          );
          if (rpcRes.ok) {
            const hasAccess = await rpcRes.json();
            if (hasAccess === true) return true;
          }

          return false;
        })(),
        new Promise(resolve => setTimeout(() => resolve(false), 15000)),
      ]);
    } catch(e) {
      isAdminBypass = false;
    }

    if (isAdminBypass) {
      document.documentElement.style.visibility = '';
      _lockCheckResolve();
      injectNav();
      return;
    }

    // Site is locked and user is not an admin (or the admin check timed out)
    _siteLocked = true;
    _lockCheckResolve();

    // Show lock screen
    document.addEventListener('DOMContentLoaded', () => showLockScreen(cfg));
    if (document.readyState !== 'loading') showLockScreen(cfg);
  } catch(e) {
    // Can't reach Supabase — show an outage notice instead of the lock screen
    _siteLocked = true;
    _lockCheckResolve();
    const showOutage = () => {
      document.documentElement.style.visibility = '';
      document.body.innerHTML = `
        <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0f1e;font-family:'Open Sans',sans-serif;padding:2rem;text-align:center;">
          <img src="assets/mca-logo.png" alt="MCA" style="width:72px;height:72px;border-radius:12px;margin-bottom:1.5rem;" onerror="this.style.display='none'">
          <h1 style="color:#fff;font-size:1.6rem;font-weight:700;margin:0 0 0.5rem;">Site Temporarily Unavailable</h1>
          <p style="color:#94a3b8;font-size:0.95rem;max-width:420px;line-height:1.6;margin:0 0 1.5rem;">
            We're unable to load the site right now because Supabase — the service we use for our database — appears to be unreachable. This is likely due to an ongoing outage.
          </p>
          <a href="https://status.supabase.com" target="_blank" rel="noopener" style="display:inline-block;background:#3ecf8e;color:#0a0f1e;font-weight:700;font-size:0.9rem;padding:10px 20px;border-radius:6px;text-decoration:none;margin-bottom:1rem;">Check Supabase Status</a>
          <p style="color:#475569;font-size:0.8rem;margin:0;">Please try again once the outage is resolved.</p>
        </div>
      `;
    };
    document.addEventListener('DOMContentLoaded', showOutage);
    if (document.readyState !== 'loading') showOutage();
  }
})();

function showLockScreen(cfg) {
  document.documentElement.style.visibility = '';
  document.body.innerHTML = `
    <div style="
      min-height:100vh;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      background:#f5f6f8;
      font-family:'Open Sans',sans-serif;
      padding:2rem;
      text-align:center;
    ">
      <img src="/images/logo-light.png" alt="MCA Logo" id="lock-logo-img" style="width:72px;height:72px;object-fit:contain;margin-bottom:1.5rem;" onerror="this.style.display='none'">
      <div id="lock-eyebrow" style="
        font-size:11px;
        font-weight:700;
        letter-spacing:2px;
        text-transform:uppercase;
        color:#18489e;
        margin-bottom:0.75rem;
      ">Site Locked</div>
      <h1 style="
        font-family:'Times New Roman',serif;
        font-size:clamp(1.6rem,4vw,2.4rem);
        color:#1a1a2e;
        margin:0 0 1.25rem;
        font-weight:normal;
        max-width:560px;
        line-height:1.3;
      ">The MCA Website is<br>Temporarily Unavailable</h1>
      ${cfg.reason ? `<p style="font-size:15px;color:#555;max-width:480px;line-height:1.6;margin:0 0 1rem;">${cfg.reason}</p>` : ''}
      ${cfg.return_time ? `
      <div style="
        display:inline-block;
        margin-top:0.75rem;
        padding:10px 20px;
        background:#fff;
        border:1px solid #dde1ea;
        border-radius:6px;
        font-size:13px;
        color:#18489e;
        font-weight:600;
      ">Expected return: ${cfg.return_time}</div>` : ''}
      <p style="margin-top:3rem;font-size:11px;color:#aaa;letter-spacing:0.5px;" id="lock-footer-text">
        MINECRAFT CLUB OF AMERICA
      </p>
      <button id="lock-admin-login-btn" style="margin-top:1.25rem;background:none;border:none;color:#18489e;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:underline;">Admin Login</button>
    </div>
    <div id="lock-login-portal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:999;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:10px;padding:2rem;width:100%;max-width:360px;margin:1rem;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#18489e;margin-bottom:0.5rem;">Admin Access</div>
        <h2 style="font-family:'Times New Roman',serif;font-size:1.4rem;font-weight:normal;margin:0 0 1.25rem;color:#1a1a2e;">Sign in to continue</h2>
        <input id="lock-email" type="email" placeholder="Email" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dde1ea;border-radius:5px;font-size:14px;margin-bottom:10px;outline:none;font-family:inherit;">
        <input id="lock-password" type="password" placeholder="Password" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dde1ea;border-radius:5px;font-size:14px;margin-bottom:14px;outline:none;font-family:inherit;">
        <div id="lock-login-error" style="font-size:12px;color:#c0392b;margin-bottom:10px;display:none;"></div>
        <div style="display:flex;gap:8px;">
          <button id="lock-login-cancel" style="flex:1;padding:10px;border:1px solid #dde1ea;border-radius:5px;background:transparent;color:#666;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>
          <button id="lock-login-submit" style="flex:2;padding:10px;border:none;border-radius:5px;background:#18489e;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Sign In</button>
        </div>
      </div>
    </div>`;

  // Hidden sequence: logo ×3 → footer text ×2 → eyebrow label ×1 (in order, must complete within 20s each step)
  let _seq = 0;
  let _seqTimer = null;
  const _steps = [
    { id: 'lock-logo-img',    needed: 3 },
    { id: 'lock-footer-text', needed: 2 },
    { id: 'lock-eyebrow',     needed: 1 },
  ];
  let _stepCount = 0;

  function resetSeq() { _seq = 0; _stepCount = 0; clearTimeout(_seqTimer); }
  function bumpTimer() { clearTimeout(_seqTimer); _seqTimer = setTimeout(resetSeq, 20000); }

  function attachStep(stepIndex) {
    const el = document.getElementById(_steps[stepIndex].id);
    if (!el) return;
    el.style.cursor = 'default';
    el.addEventListener('click', () => {
      if (_seq !== stepIndex) { resetSeq(); return; }
      _stepCount++;
      bumpTimer();
      if (_stepCount >= _steps[stepIndex].needed) {
        _seq++;
        _stepCount = 0;
        if (_seq >= _steps.length) {
          clearTimeout(_seqTimer);
          showLockLogin();
        }
      }
    });
  }
  _steps.forEach((_, i) => attachStep(i));

  document.getElementById('lock-admin-login-btn').addEventListener('click', () => {
    resetSeq();
    showLockLogin();
  });

  function showLockLogin() {
    const portal = document.getElementById('lock-login-portal');
    portal.style.display = 'flex';
    document.getElementById('lock-email').focus();
  }

  document.getElementById('lock-login-cancel').addEventListener('click', () => {
    document.getElementById('lock-login-portal').style.display = 'none';
    resetSeq();
  });

  document.getElementById('lock-login-submit').addEventListener('click', async () => {
    const email = document.getElementById('lock-email').value.trim();
    const password = document.getElementById('lock-password').value;
    const errEl = document.getElementById('lock-login-error');
    errEl.style.display = 'none';
    if (!email || !password) { errEl.textContent = 'Please enter your email and password.'; errEl.style.display = 'block'; return; }
    const btn = document.getElementById('lock-login-submit');
    btn.textContent = 'Signing in…'; btn.disabled = true;
    try {
      const res = await fetch('https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1/sign-in-with-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sign in failed.');
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const _sb = createClient(SUPABASE_URL, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqYXl3b2t2Z2R6aHZzb3lnY3RjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNzA2NTQsImV4cCI6MjA5NTg0NjY1NH0.nFqlc20iUDwE1sXLRi2Pev181v2RJKx_S6UcTkGgPWU');
      const { error: sessionErr } = await _sb.auth.setSession({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      });
      if (sessionErr) throw sessionErr;
      // Verify they're actually an admin — check legacy role first, then the
      // newer permission system, matching the logic used for the lock bypass.
      let verifiedAdmin = false;
      const { data: profile } = await _sb.from('profiles').select('role').eq('id', json.user.id).single();
      if (profile && ['admin', 'owner'].includes(profile.role)) {
        verifiedAdmin = true;
      } else {
        const { data: hasAccess } = await _sb.rpc('user_has_permission', { perm: 'can_view_admin' });
        if (hasAccess === true) verifiedAdmin = true;
      }
      if (!verifiedAdmin) {
        await _sb.auth.signOut();
        throw new Error('Sorry, this site is for admins only right now.');
      }
      window.location.reload();
    } catch(err) {
      errEl.textContent = err.message || 'Sign in failed.';
      errEl.style.display = 'block';
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  });

  document.getElementById('lock-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('lock-login-submit').click();
  });
}


// _mcaAuthReady / _mcaAuthResolve are declared near the top of this file
// (before the site-lock IIFE) — see the comment there for why.

async function injectNav() {
  if (document.readyState === 'loading') {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }

  // Inject nav immediately without waiting for config.
  document.body.insertAdjacentHTML('afterbegin', NAV_HTML());

  // Accessibility: add a "skip to main content" link as the very first
  // focusable element on the page, so keyboard/screen-reader users don't
  // have to tab through the full nav (including the Community/About
  // dropdowns) on every single page. Targets whatever element follows
  // the injected <nav> in the DOM, since page layouts vary.
  (function addSkipLink() {
    const navEl = document.querySelector('body > nav');
    const mainEl = navEl && navEl.nextElementSibling;
    if (!mainEl) return;
    if (!mainEl.id) mainEl.id = 'mca-main-content';
    if (!mainEl.hasAttribute('tabindex')) mainEl.setAttribute('tabindex', '-1');
    document.body.insertAdjacentHTML('afterbegin', `<a href="#${mainEl.id}" class="skip-link">Skip to main content</a>`);
  })();

  // Init nav auth immediately (must run after nav is in DOM).
  initNavAuth(_mcaAuthResolve);

  // Update Discord/YouTube links once config resolves in the background.
  Promise.race([_configReady, new Promise(r => setTimeout(r, 1500))]).then(() => {
    document.querySelectorAll('a[data-discord]').forEach(a => { a.href = DISCORD_URL; });
    document.querySelectorAll('a[data-youtube]').forEach(a => { a.href = YOUTUBE_URL; });
  });

  // Inject footer + toast
  document.body.insertAdjacentHTML('beforeend', FOOTER_HTML() + TOAST_HTML);

  // Inject scroll progress bar
  document.body.insertAdjacentHTML('afterbegin', PROGRESS_HTML);

  // Drive the progress bar on scroll
  const bar = document.getElementById('scroll-progress');
  function updateProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = docHeight > 0 ? (scrollTop / docHeight * 100) + '%' : '0%';
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  // Auto-update year in footer
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Logo swap helper
  function applyLogoTheme(dark) {
    const navLogo    = document.getElementById('nav-logo-img');
    const footerLogo = document.getElementById('footer-logo-img');
    if (navLogo)    navLogo.src    = dark ? 'images/widelogo-dark.png'  : 'images/widelogo-light.png';
    if (footerLogo) footerLogo.src = dark ? 'images/logo-dark.png'      : 'images/logo-light.png';
  }

  // Set logos on initial load
  applyLogoTheme(document.documentElement.getAttribute('data-theme') === 'dark');

  // Dark mode toggle — handles both desktop (#nav-theme-toggle) and mobile (.nav-theme-toggle-mobile)
  document.querySelectorAll('#nav-theme-toggle, .nav-theme-toggle-mobile').forEach(btn => {
    btn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('mca_theme', 'light');
        applyLogoTheme(false);
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('mca_theme', 'dark');
        applyLogoTheme(true);
      }
    });
  });

  // Highlight active nav link
  const current = window.location.pathname.split('/').pop() || 'index.html';
  const page = current.replace('.html', '') || 'index';
  const activeLink = document.querySelector(`.nav-links a[data-page="${page}"]`);
  if (activeLink) {
    activeLink.classList.add('active');
    const parentDropdown = activeLink.closest('.nav-has-dropdown');
    if (parentDropdown) parentDropdown.querySelector('.nav-dropdown-trigger').classList.add('active');
  }

  // Nav dropdown toggles (Server, Community, About) — only one open at a time
  function closeDropdown(item) {
    item.classList.remove('open');
    const t = item.querySelector('.nav-dropdown-trigger');
    if (t) t.setAttribute('aria-expanded', 'false');
  }
  document.querySelectorAll('.nav-has-dropdown').forEach(item => {
    const trigger = item.querySelector('.nav-dropdown-trigger');
    if (!trigger) return;
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.nav-has-dropdown').forEach(closeDropdown);
      if (!wasOpen) {
        item.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
  document.addEventListener('click', e => {
    document.querySelectorAll('.nav-has-dropdown').forEach(item => {
      if (!item.contains(e.target)) closeDropdown(item);
    });
  });

  // Hamburger menu toggle
  const hamburger = document.getElementById('nav-hamburger');
  const navLinks  = document.getElementById('nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });
    // Close menu when a non-dropdown link is clicked
    navLinks.querySelectorAll('a:not(.nav-dropdown-trigger)').forEach(a => {
      a.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
    document.addEventListener('click', e => {
      if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      }
    });
  }

  // Join button interaction (index.html)
  const joinBtn = document.getElementById('joinBtn');
  if (joinBtn) {
    joinBtn.addEventListener('click', () => {
      window.open(DISCORD_URL, '_blank');
      const original = joinBtn.textContent;
      joinBtn.textContent = "You're In!";
      joinBtn.classList.add('btn-joined');
      setTimeout(() => {
        joinBtn.textContent = original;
        joinBtn.classList.remove('btn-joined');
      }, 2000);
    });
  }
}

// Copy-to-clipboard helper (server.html)
function copyAddress() {
  const el = document.getElementById('server-addr');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).catch(() => {});
  const t = document.getElementById('toast');
  if (!t) return;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
window.copyAddress = copyAddress;

// Copy email address helper (footer)
function copyEmail(el) {
  navigator.clipboard.writeText(EMAIL_US).catch(() => {});
  const orig = el.innerHTML;
  el.textContent = 'Copied!';
  setTimeout(() => { el.innerHTML = orig; }, 2000);
}
window.copyEmail = copyEmail;

// ── Nav auth + cart ───────────────────────────────────────────
async function initNavAuth(_authReadyResolve) {
  if (!document.getElementById('nav-account') && !document.getElementById('nav-account-mobile')) return;

  // Always re-query elements so stale closure refs never cause silent no-ops
  // ── Active viewers (Supabase Realtime Presence) ────────────────
  // Disabled — was getting stuck / not loading. Commented out (not deleted)
  // so it can be re-enabled later if wanted.
  /*
  let _presenceChannel = null;
  async function trackPresence(payload) {
    try {
      const { supabase: _sb } = await import('./supabase.js');
      let sid = sessionStorage.getItem('mca_presence_id');
      if (!sid) { sid = crypto.randomUUID(); sessionStorage.setItem('mca_presence_id', sid); }
      const page = window.location.pathname.split('/').pop() || 'index.html';
      const track = () => _presenceChannel.track({ ...payload, page, since: Date.now() });
      if (_presenceChannel) { track(); return; }
      _presenceChannel = _sb.channel('site-presence', { config: { presence: { key: sid } } });
      window._mcaPresenceChannel = _presenceChannel;
      _presenceChannel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          track();
          if (!window._mcaPresenceHeartbeat) {
            window._mcaPresenceHeartbeat = setInterval(track, 20000);
          }
        }
      });
    } catch(e) {}
  }
  */

  function getAccountEls() {
    return {
      el:       document.getElementById('nav-account'),
      elMobile: document.getElementById('nav-account-mobile'),
    };
  }

  // Render the button immediately so it appears without any async wait.
  setSignedOut();

  function setSignedOut() {
    // trackPresence({ name: null }); // disabled — see commented block above
    const { el: accountEl, elMobile: accountElMobile } = getAccountEls();
    const returnPage = encodeURIComponent(window.location.pathname.split('/').pop() || 'index.html');
    const html = `
      <div class="nav-account-wrap" id="nav-account-wrap">
        <button class="nav-account-btn nav-account-user" id="nav-account-user-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Account
        </button>
        <div class="nav-account-dropdown" id="nav-account-dropdown">
          <a class="nav-account-dropdown-item" href="shop.html">Shop</a>
          <a class="nav-account-dropdown-item" href="help.html">Help</a>
          <div class="nav-account-dropdown-divider"></div>
          <a class="nav-account-dropdown-item" href="login.html?return=${returnPage}">Sign In</a>
          <a class="nav-account-dropdown-item" href="login.html?tab=signup">Create Account</a>
        </div>
      </div>`;

    if (accountEl) accountEl.innerHTML = html;
    if (accountElMobile) accountElMobile.innerHTML = html;

    // Attach listeners to whichever buttons are present
    document.querySelectorAll('#nav-account-user-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        // Toggle the dropdown nearest to this button
        btn.nextElementSibling?.classList.toggle('open');
      });
    });
    document.addEventListener('click', () => {
      document.querySelectorAll('.nav-account-dropdown').forEach(d => d.classList.remove('open'));
      document.querySelectorAll('.nav-account-submenu').forEach(s => s.classList.remove('open'));
    });
  }

  async function setSignedIn(user) {
    let label = user.email?.split('@')[0] || 'Account';
    let isAdmin = false;
    let canPublishNews = false;
    let canManageArchive = false;
    let canAccessTasks = false;
    let isPreviewing = false;

    // Resolve role BEFORE the first render so other page scripts awaiting
    // _mcaAuthReady get the correct isAdmin status immediately, instead of
    // each page having to make its own duplicate (slow) profiles query.
    try {
      const mod0 = await import('./supabase.js');
      const [{ data: roleData }, preview, canViewAdmin] = await Promise.all([
        mod0.supabase.from('profiles').select('display_name, username').eq('id', user.id).single(),
        mod0.getMyRolePreview().catch(() => null),
        mod0.hasPermission('can_view_admin').catch(() => false)
      ]);
      if (roleData) {
        label = roleData.display_name || roleData.username || label;
      }
      // isAdmin comes exclusively from the server-side role/permission
      // system (user_roles + roles.permissions) via the can_view_admin
      // permission — never from the legacy profiles.role column.
      // assign_role_to_user only ever inserts into user_roles, so
      // profiles.role goes stale the moment a role is granted from the
      // admin panel and never reflects who's actually an admin/owner,
      // which was hiding the Admin/Tasks links after a fresh grant.
      // hasPermission('can_view_admin') is preview-aware (it checks
      // role_previews before the user's real roles), so this is also
      // correct while a "view as" preview is active.
      isAdmin = !!canViewAdmin;
      isPreviewing = !!preview;
    } catch(e) {}

    // trackPresence({ name: label }); // disabled — see commented block above

    // Render immediately with what we have so the nav never disappears during async fetches
    function render() {
      const { el: accountEl, elMobile: accountElMobile } = getAccountEls();
      const hasStaffAccess = isAdmin || canAccessTasks || canPublishNews || canManageArchive;
      const html = `
      <div class="nav-account-wrap" id="nav-account-wrap">
        <button class="nav-account-btn nav-account-user" id="nav-account-user-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${escapeHtml(label)}
        </button>
        <div class="nav-account-dropdown" id="nav-account-dropdown">
          ${hasStaffAccess ? `
          <div class="nav-account-submenu" id="nav-staff-submenu">
            <button class="nav-account-dropdown-item nav-account-submenu-trigger" id="nav-staff-trigger">
              Staff
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
            </button>
            <div class="nav-account-submenu-panel" id="nav-staff-panel">
              ${isAdmin ? `<a class="nav-account-dropdown-item" href="admin.html">Admin</a>` : ''}
              ${canAccessTasks ? `<a class="nav-account-dropdown-item" href="tasks.html">Tasks</a>` : ''}
              ${canPublishNews ? `<a class="nav-account-dropdown-item" href="news-publish.html">Publish News</a>` : ''}
              ${canManageArchive ? `<a class="nav-account-dropdown-item" href="archive-publish.html">Manage Archive</a>` : ''}
            </div>
          </div>
          <div class="nav-account-dropdown-divider"></div>
          ` : ''}
          <a class="nav-account-dropdown-item" href="account.html">Account</a>
          <a class="nav-account-dropdown-item" href="help.html">Help</a>
          <a class="nav-account-dropdown-item" href="shop.html">Shop</a>
          <div class="nav-account-dropdown-divider"></div>
          <button class="nav-account-dropdown-item" id="nav-signout-btn">Sign Out</button>
        </div>
      </div>`;

      if (accountEl) accountEl.innerHTML = html;
      if (accountElMobile) accountElMobile.innerHTML = html;

      document.querySelectorAll('#nav-account-user-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          btn.nextElementSibling?.classList.toggle('open');
        });
      });
      document.querySelectorAll('#nav-staff-trigger').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          btn.closest('.nav-account-submenu')?.classList.toggle('open');
        });
      });
      document.addEventListener('click', () => {
        document.querySelectorAll('.nav-account-dropdown').forEach(d => d.classList.remove('open'));
        document.querySelectorAll('.nav-account-submenu').forEach(s => s.classList.remove('open'));
      });
      document.querySelectorAll('#nav-signout-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            const mod = await import('./supabase.js');
            await mod.signOut();
          } catch(e) {}
          window.location.href = 'login.html';
        });
      });
    }

    render(); // show nav immediately

    watchMyRoleChanges(user.id);
    initRolePreviewBanner(); // fire-and-forget; shows/hides the "Previewing as" bar

    try {
      const mod = await import('./supabase.js');
      try {
        const permResult = await Promise.race([
          mod.supabase.rpc('user_has_permission', { perm: 'can_publish_news' }),
          new Promise(r => setTimeout(() => r({ data: null }), 1000))
        ]);
        if (permResult?.data) canPublishNews = true;
      } catch(e) {}
      try {
        const archiveResult = await Promise.race([
          mod.supabase.rpc('user_has_permission', { perm: 'can_manage_archive' }),
          new Promise(r => setTimeout(() => r({ data: null }), 1000))
        ]);
        if (archiveResult?.data) canManageArchive = true;
      } catch(e) {}
      try {
        const [manageResult, testResult, checkoffResult] = await Promise.all([
          Promise.race([mod.supabase.rpc('user_has_permission', { perm: 'can_manage_tasks' }), new Promise(r => setTimeout(() => r({ data: null }), 1000))]),
          Promise.race([mod.supabase.rpc('user_has_permission', { perm: 'can_test_tasks' }), new Promise(r => setTimeout(() => r({ data: null }), 1000))]),
          Promise.race([mod.supabase.rpc('user_has_permission', { perm: 'can_check_off_tasks' }), new Promise(r => setTimeout(() => r({ data: null }), 1000))]),
        ]);
        if (manageResult?.data || testResult?.data || checkoffResult?.data) canAccessTasks = true;
      } catch(e) {}
      // While previewing a role, canPublishNews/canManageArchive/canAccessTasks
      // above already came from the preview-aware user_has_permission RPC —
      // don't let a real admin/owner's actual role override them back to true.
      if (isAdmin && !isPreviewing) { canPublishNews = true; canManageArchive = true; canAccessTasks = true; }
    } catch(e) {}

    render(); // re-render with full data (name, admin link, etc.)
    return { isAdmin, canPublishNews, canManageArchive, canAccessTasks };
  }

  // If someone else changes this user's roles (or an admin/owner revokes/adds
  // one) while they're on the site, force a full reload so every permission
  // check re-runs from scratch. This closes the loop where an admin who just
  // got demoted could otherwise use still-cached permissions in memory to
  // re-grant themselves a role before the page ever refreshes.
  let _roleWatchStarted = false;
  function watchMyRoleChanges(userId) {
    if (_roleWatchStarted) return;
    _roleWatchStarted = true;
    (async () => {
      try {
        const { supabase: _sb } = await import('./supabase.js');
        const reload = () => window.location.reload();
        const onProfileChange = (payload) => {
          const before = payload.old || {};
          const after  = payload.new || {};
          if (before.role !== after.role || before.account_status !== after.account_status) reload();
        };
        _sb.channel(`role-watch-${userId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles', filter: `user_id=eq.${userId}` }, reload)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, onProfileChange)
          .subscribe();
      } catch(e) {}
    })();
  }

  let mod;
  try {
    mod = await import('./supabase.js');

    // Register onAuthStateChange BEFORE getUser() so we never miss INITIAL_SESSION.
    // Supabase fires INITIAL_SESSION synchronously on the first listener registration
    // when a cached session exists — if we awaited getUser() first, that event would
    // already be gone by the time we subscribed.
    let _lastSignedIn = false;
    let _authStateHandled = false;
    mod.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'EMAIL_CHANGE') {
        if (session?.user) {
          _lastSignedIn = true; _authStateHandled = true;
          const { isAdmin, canPublishNews } = await setSignedIn(session.user);
          if (_authReadyResolve) { _authReadyResolve({ user: session.user, session, isAdmin, canPublishNews }); _authReadyResolve = null; }
        } else if (event === 'INITIAL_SESSION') {
          // INITIAL_SESSION with null session means the token may be expired and
          // TOKEN_REFRESHED is on its way. Mark handled but don't resolve yet —
          // the fallback getUser() below will settle things if TOKEN_REFRESHED
          // never arrives (truly no session).
          _authStateHandled = true;
        } else {
          _lastSignedIn = false;
          if (_authReadyResolve) { _authReadyResolve({ user: null, session: null, isAdmin: false, canPublishNews: false }); _authReadyResolve = null; }
          setSignedOut();
        }
      } else if (event === 'SIGNED_OUT') {
        // TOKEN_REFRESHED can emit a transient SIGNED_OUT before SIGNED_IN —
        // wait one tick and only sign out if still no active session.
        const wasSignedIn = _lastSignedIn;
        if (wasSignedIn) {
          await new Promise(r => setTimeout(r, 200));
          const { data: { session: check } } = await mod.supabase.auth.getSession().catch(() => ({ data: { session: null } }));
          if (check) return; // session restored — ignore the transient event
        }
        _lastSignedIn = false;
        if (_authReadyResolve) { _authReadyResolve({ user: null, session: null, isAdmin: false, canPublishNews: false }); _authReadyResolve = null; }
        setSignedOut();
      }
    });

    // Fallback: resolve auth state via getUser() if _authReadyResolve is still
    // pending. This handles two cases:
    // 1. No cached session at all (INITIAL_SESSION never fired).
    // 2. INITIAL_SESSION fired with null session (expired token, TOKEN_REFRESHED
    //    incoming) — we still need to settle _authReadyReady if it hasn't yet.
    //
    // getUser() hits the network to validate the token with the auth server.
    // After a long break (device/browser asleep, tab suspended, etc.) the
    // network stack can take a while to come back up — DNS/TLS reconnects
    // from cold. A short timeout here was previously treating that slow-but-
    // fine reconnect as "not signed in" and forcing a manual sign-in even
    // though the session was still perfectly valid. We now give it more room,
    // and if it does time out we fall back to the locally cached session
    // (getSession()) instead of assuming the worst — only truly signing the
    // user out if there is no session at all.
    if (_authReadyResolve) {
      try {
        const { data: { user } } = await Promise.race([
          mod.supabase.auth.getUser(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('auth timeout')), 15000))
        ]);
        if (user) {
          const { isAdmin, canPublishNews } = await setSignedIn(user);
          if (_authReadyResolve) { _authReadyResolve({ user, session: null, isAdmin, canPublishNews }); _authReadyResolve = null; }
        } else {
          if (_authReadyResolve) { _authReadyResolve({ user: null, session: null, isAdmin: false, canPublishNews: false }); _authReadyResolve = null; }
          setSignedOut();
        }
      } catch(e) {
        // getUser() timed out or errored (likely a slow/cold network after a
        // long break). Don't give up yet — check the locally cached session
        // before deciding the user is signed out.
        try {
          const { data: { session: cachedSession } } = await mod.supabase.auth.getSession();
          if (cachedSession?.user) {
            const { isAdmin, canPublishNews } = await setSignedIn(cachedSession.user);
            if (_authReadyResolve) { _authReadyResolve({ user: cachedSession.user, session: cachedSession, isAdmin, canPublishNews }); _authReadyResolve = null; }
            return;
          }
        } catch(e2) {}
        if (_authReadyResolve) { _authReadyResolve({ user: null, session: null, isAdmin: false, canPublishNews: false }); _authReadyResolve = null; }
        setSignedOut();
      }
    }
  } catch(e) {
    if (_authReadyResolve) { _authReadyResolve({ user: null, session: null, isAdmin: false, canPublishNews: false }); _authReadyResolve = null; }
    setSignedOut();
  }
}

// ── "Previewing as: <role>" banner ────────────────────────────────
// Shown on every page (not just admin.html) whenever the signed-in user
// has an active role_previews row, since a real "view as" needs to be
// visible everywhere the simulated permissions actually change what
// loads — not just in the admin panel where it was started.
let _rolePreviewChecked = false;
async function initRolePreviewBanner() {
  if (_rolePreviewChecked) return; // one check per page load is enough
  _rolePreviewChecked = true;
  try {
    const mod = await import('./supabase.js');
    const preview = await mod.getMyRolePreview();
    if (preview) renderRolePreviewBanner(preview, mod);
  } catch(e) {}
}

function renderRolePreviewBanner(preview, mod) {
  if (document.getElementById('role-preview-banner')) return;

  if (!document.getElementById('role-preview-banner-style')) {
    const style = document.createElement('style');
    style.id = 'role-preview-banner-style';
    style.textContent = `
      #role-preview-banner {
        position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
        display: flex; align-items: center; justify-content: center; gap: 12px;
        flex-wrap: wrap;
        padding: 8px 16px;
        font-size: 13px; font-weight: 600;
        color: #fff;
        background: var(--role-preview-color, #7a3cf0);
      }
      #role-preview-banner .rpb-exit {
        background: rgba(255,255,255,.18);
        border: 1px solid rgba(255,255,255,.5);
        color: #fff; border-radius: 4px;
        font-size: 12px; font-weight: 700;
        padding: 4px 10px; cursor: pointer;
      }
      #role-preview-banner .rpb-exit:hover { background: rgba(255,255,255,.3); }
    `;
    document.head.appendChild(style);
  }

  const banner = document.createElement('div');
  banner.id = 'role-preview-banner';
  banner.style.setProperty('--role-preview-color', preview.color || '#7a3cf0');
  banner.innerHTML = `
    <span>👁 Previewing the site as: <strong>${escapeHtml(preview.label)}</strong> — you're seeing exactly what this role can see, real data included.</span>
    <button class="rpb-exit" id="role-preview-exit-btn">Exit preview</button>
  `;
  document.body.prepend(banner);

  // Nav (and everything else anchored to its 58px height: .page-wrap,
  // .scroll-progress, and the mobile .nav-links / .nav-account-dropdown
  // overlays, which are fixed independently of the nav element itself)
  // all ignore document flow, so they'd otherwise render underneath —
  // and get hidden by — this banner. Push them all down directly via
  // inline styles (highest-precedence, no stylesheet-cascade guesswork)
  // instead of just the nav element, since several of these only need
  // it once a mobile menu is actually open.
  function applyOffset() {
    const px = banner.offsetHeight + 'px';
    document.querySelectorAll('nav').forEach(el => el.style.setProperty('top', px, 'important'));
    document.querySelectorAll('.page-wrap').forEach(el =>
      el.style.setProperty('padding-top', `calc(58px + ${px})`, 'important'));
    document.querySelectorAll('.scroll-progress, .nav-links, .nav-account-dropdown').forEach(el =>
      el.style.setProperty('top', `calc(58px + ${px})`, 'important'));
  }
  applyOffset();
  // Banner height can change (text wraps to 2 lines on narrow screens,
  // or the viewport is resized across that breakpoint), so keep the
  // offset in sync with the actual rendered height rather than a
  // one-time snapshot.
  window.addEventListener('resize', applyOffset);

  window.addEventListener('pagehide', () => {
    if (_mcaInternalNav) {
      // Just navigating to another page on the site — the preview row
      // in role_previews has no expiry now, so it's still active when
      // the next page's initRolePreviewBanner() checks it. Nothing to do.
      _mcaInternalNav = false;
      return;
    }
    // Tab/window actually closing (or navigating off-site) — end it for real.
    mod.endRolePreviewBeacon();
  });

  document.getElementById('role-preview-exit-btn').addEventListener('click', async () => {
    banner.querySelector('.rpb-exit').textContent = 'Exiting…';
    try { await mod.endRolePreview(); } catch(e) {}
    window.location.reload();
  });
}
