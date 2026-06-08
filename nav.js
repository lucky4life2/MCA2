// Apply dark mode immediately to prevent flash
(function() {
  if (localStorage.getItem('mca_theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();



// Discord URL — loaded from config.md on GitHub, falls back to hardcoded value
let DISCORD_URL = 'https://discord.gg/hZrt28vG29';
let _configResolve;
const _configReady = new Promise(r => { _configResolve = r; });

(async function loadConfig() {
  const RAW = 'https://raw.githubusercontent.com/lucky4life2/MCA2/main/config.md';
  try {
    const res = await fetch(RAW + '?nocache=' + Date.now());
    console.log('[nav config] fetch status:', res.status);
    if (res.ok) {
      const text = await res.text();
      console.log('[nav config] raw text:', text.slice(0, 200));
      const cfg = {};
      text.split('\n').forEach(line => {
        if (line.startsWith('#') || !line.trim()) return;
        const c = line.indexOf(':');
        if (c > 0) cfg[line.slice(0,c).trim()] = line.slice(c+1).trim();
      });
      console.log('[nav config] parsed:', cfg);
      if (cfg.discord_url) {
        console.log('[nav config] setting DISCORD_URL to:', cfg.discord_url);
        DISCORD_URL = cfg.discord_url;
      }
    }
  } catch(e) { console.error('[nav config] error:', e); }
  _configResolve();
})();

/* ── SITE LOCK ──────────────────────────────────────────────── */
const PREVIEW_KEY = 'I-pG1idLnWhIjId9i1TLAumZkBQjVcvc';
const LOCK_RAW    = 'https://raw.githubusercontent.com/lucky4life2/MCA2/main/locked.md';

// Clear any old sessionStorage preview keys, then hide until lock check completes
(function() {
  sessionStorage.removeItem('mca_preview');
  const params = new URLSearchParams(window.location.search);
  if (params.get('preview') !== PREVIEW_KEY) {
    document.documentElement.style.visibility = 'hidden';
  }
})();

(async function checkLock() {
  // If preview key is in the URL, reveal immediately and skip
  const params = new URLSearchParams(window.location.search);
  if (params.get('preview') === PREVIEW_KEY) {
    document.documentElement.style.visibility = '';
    return;
  }

  try {
    const res = await fetch(LOCK_RAW + '?nocache=' + Date.now());
    if (!res.ok) { document.documentElement.style.visibility = ''; return; }
    const cfg = {};
    (await res.text()).split('\n').forEach(line => {
      if (line.startsWith('#') || !line.trim()) return;
      const c = line.indexOf(':');
      if (c > 0) cfg[line.slice(0,c).trim()] = line.slice(c+1).trim();
    });
    if (cfg.locked !== 'true') {
      document.documentElement.style.visibility = '';
      return;
    }
    // Show lock screen
    document.addEventListener('DOMContentLoaded', () => showLockScreen(cfg));
    if (document.readyState !== 'loading') showLockScreen(cfg);
  } catch(e) {
    // On any error, reveal the page so it doesn't stay hidden forever
    document.documentElement.style.visibility = '';
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
      <img src="/images/logo.png" alt="MCA Logo" style="width:72px;height:72px;object-fit:contain;margin-bottom:1.5rem;" onerror="this.style.display='none'">
      <div style="
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
      <p style="margin-top:3rem;font-size:11px;color:#aaa;letter-spacing:0.5px;">
        MINECRAFT CLUB OF AMERICA
      </p>
    </div>`;
}


const NAV_HTML = `
<nav>
  <a class="nav-logo" href="index.html">
    <img src="images/widelogo.png" alt="Minecraft Club of America" class="nav-logo-img">
  </a>
  <div class="nav-right">
    <button class="nav-theme-toggle" id="nav-theme-toggle" aria-label="Toggle dark mode">
      <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    </button>
    <button class="nav-cart-btn" id="nav-cart-btn" aria-label="Cart" style="display:none;">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
      <span class="nav-cart-count" id="nav-cart-count" style="display:none;">0</span>
    </button>
    <div class="nav-account" id="nav-account">
      <!-- Injected by nav auth init -->
    </div>
    <button class="nav-hamburger" id="nav-hamburger" aria-label="Toggle menu">
      <span></span><span></span><span></span>
    </button>
  </div>
  <ul class="nav-links" id="nav-links">
    <li><a href="index.html"      data-page="index">Home</a></li>
    <li><a href="server.html"     data-page="server">Server</a></li>
    <li class="nav-has-dropdown" id="nav-about-item">
      <a href="#" class="nav-dropdown-trigger" data-page="about" onclick="return false;">About <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></a>
      <ul class="nav-dropdown" id="nav-about-dropdown">
        <li><a href="leadership.html" data-page="leadership">Leadership</a></li>
        <li><a href="history.html"    data-page="history">History</a></li>
        <li><a href="archive.html"    data-page="archive">Archive</a></li>
      </ul>
    </li>
    <li><a href="nations.html"    data-page="nations">Nations</a></li>
    <li><a href="news.html"       data-page="news">News</a></li>
    <li><a href="${DISCORD_URL}" data-discord target="_blank" class="nav-discord">Discord</a></li>
  </ul>
</nav>
`;

const FOOTER_HTML = `
<footer>
  <div class="footer-inner">

    <div class="footer-brand">
      <div class="footer-logo">
        <img src="images/logo.png" alt="Minecraft Club of America" class="footer-logo-img">
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
      </div>

      <div class="footer-col">
        <div class="footer-col-title">Connect</div>
        <a href="${DISCORD_URL}" data-discord target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.03.057a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          Discord
        </a>
        <a href="https://www.youtube.com/@MinecraftClubOfAmerica" target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          YouTube
        </a>
        <a href="#" id="footer-email-btn" onclick="copyEmail(this);return false;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          Email Us
        </a>
      </div>
    </div>

  </div>
  <div class="footer-disclaimer">
    Not affiliated with, endorsed by, or associated with Mojang Studios or Microsoft.
    Minecraft is a trademark of Mojang Studios.
    <span class="footer-version">v2.5.0</span>
  </div>
</footer>
`;

const TOAST_HTML = `<div class="toast" id="toast">Address copied to clipboard</div>`;

const PROGRESS_HTML = `<div class="scroll-progress" id="scroll-progress"></div>`;

document.addEventListener('DOMContentLoaded', async () => {
  // Wait for config (discord URL etc) before injecting nav so links are correct.
  // Cap the wait at 1.5s so a slow GitHub fetch doesn't delay the whole page.
  await Promise.race([_configReady, new Promise(r => setTimeout(r, 1500))]);

  // Inject nav
  document.body.insertAdjacentHTML('afterbegin', NAV_HTML);

  // Inject footer + toast
  document.body.insertAdjacentHTML('beforeend', FOOTER_HTML + TOAST_HTML);

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
  updateProgress(); // set initial state

  // Auto-update year in footer
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Dark mode toggle
  const themeToggle = document.getElementById('nav-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('mca_theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('mca_theme', 'dark');
      }
    });
  }

  // Highlight active nav link — also mark About dropdown active if on a child page
  const current = window.location.pathname.split('/').pop() || 'index.html';
  const page = current.replace('.html', '') || 'index';
  const activeLink = document.querySelector(`.nav-links a[data-page="${page}"]`);
  if (activeLink) {
    activeLink.classList.add('active');
    const parentDropdown = activeLink.closest('.nav-has-dropdown');
    if (parentDropdown) parentDropdown.querySelector('.nav-dropdown-trigger').classList.add('active');
  }

  // About dropdown toggle
  const aboutItem     = document.getElementById('nav-about-item');
  const aboutDropdown = document.getElementById('nav-about-dropdown');
  if (aboutItem && aboutDropdown) {
    aboutItem.querySelector('.nav-dropdown-trigger').addEventListener('click', e => {
      e.stopPropagation();
      aboutItem.classList.toggle('open');
    });
    document.addEventListener('click', e => {
      if (!aboutItem.contains(e.target)) aboutItem.classList.remove('open');
    });
  }

  // Hamburger menu toggle
  const hamburger = document.getElementById('nav-hamburger');
  const navLinks  = document.getElementById('nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });
    // Close menu when a link is clicked
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
    // Close menu when clicking outside
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
});

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

// Copy email address helper (footer)
function copyEmail(el) {
  navigator.clipboard.writeText('minecraftclubofamericaofficial@gmail.com').catch(() => {});
  const orig = el.innerHTML;
  el.textContent = 'Copied!';
  setTimeout(() => { el.innerHTML = orig; }, 2000);
}

// ── Nav auth + cart ───────────────────────────────────────────
// Runs after DOMContentLoaded so the nav is already injected.
// Dynamically imports supabase to avoid breaking non-shop pages
// if the module ever fails to load.
(async function initNavAuth() {
  const accountEl  = document.getElementById('nav-account');
  const cartBtn    = document.getElementById('nav-cart-btn');
  const cartCount  = document.getElementById('nav-cart-count');
  if (!accountEl) return;

  function updateCartBadge(userId) {
    if (!userId || !cartBtn) return;
    try {
      const raw   = localStorage.getItem('mca_cart_' + userId);
      const items = raw ? JSON.parse(raw) : [];
      const total = items.reduce((s, i) => s + (i.qty || 1), 0);
      cartBtn.style.display = '';
      if (total > 0) {
        cartCount.textContent    = total > 99 ? '99+' : total;
        cartCount.style.display  = '';
      } else {
        cartCount.style.display  = 'none';
      }
    } catch(e) {}
  }

  function setSignedOut() {
    accountEl.innerHTML = `<a class="nav-account-btn" href="login.html?return=${encodeURIComponent(window.location.pathname.split('/').pop() || 'index.html')}">Sign In</a>`;
    if (cartBtn) cartBtn.style.display = 'none';
  }

  function setSignedIn(user) {
    const label = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Account';
    accountEl.innerHTML = `
      <div class="nav-account-wrap" id="nav-account-wrap">
        <button class="nav-account-btn nav-account-user" id="nav-account-user-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${label}
        </button>
        <div class="nav-account-dropdown" id="nav-account-dropdown">
          <a class="nav-account-dropdown-item" href="account.html">My Account</a>
          <button class="nav-account-dropdown-item" id="nav-signout-btn">Sign Out</button>
        </div>
      </div>`;
    updateCartBadge(user.id);

    document.getElementById('nav-account-user-btn').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('nav-account-dropdown').classList.toggle('open');
    });
    document.addEventListener('click', () => {
      document.getElementById('nav-account-dropdown')?.classList.remove('open');
    });
    document.getElementById('nav-signout-btn').addEventListener('click', async () => {
      try {
        const mod = await import('./supabase.js');
        await mod.signOut();
      } catch(e) {}
      window.location.href = 'login.html';
    });
  }

  try {
    const mod = await import('./supabase.js');
    const { data: { user } } = await mod.supabase.auth.getUser();
    if (user) {
      setSignedIn(user);
    } else {
      setSignedOut();
    }
    mod.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (session?.user) setSignedIn(session.user);
        else setSignedOut();
      } else if (event === 'SIGNED_OUT') {
        setSignedOut();
      }
    });
    window._mcaUpdateCartBadge = () => {
      mod.supabase.auth.getUser().then(({ data: { user } }) => { if (user) updateCartBadge(user.id); });
    };
  } catch(e) {
    setSignedOut();
  }
})();
