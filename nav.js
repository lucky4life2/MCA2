/* nav.js — shared nav, footer, and global utilities */

const DISCORD_URL = 'https://discord.gg/hZrt28vG29';

const NAV_HTML = `
<nav>
  <a class="nav-logo" href="index.html">
    <img src="images/widelogo.png" alt="Minecraft Club of America" class="nav-logo-img">
  </a>
  <button class="nav-hamburger" id="nav-hamburger" aria-label="Toggle menu">
    <span></span><span></span><span></span>
  </button>
  <ul class="nav-links" id="nav-links">
    <li><a href="index.html"      data-page="index">Home</a></li>
    <li><a href="server.html"     data-page="server">Server</a></li>
    <li><a href="leadership.html" data-page="leadership">Leadership</a></li>
    <li><a href="history.html"    data-page="history">History</a></li>
    <li><a href="news.html"       data-page="news">News</a></li>
    <li><a href="archive.html"    data-page="archive">Archive</a></li>
    <li><a href="${DISCORD_URL}" target="_blank" class="nav-discord">Discord</a></li>
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
        <a href="news.html">News</a>
        <a href="archive.html">Archive</a>
      </div>

      <div class="footer-col">
        <div class="footer-col-title">Connect</div>
        <a href="${DISCORD_URL}" target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.03.057a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          Discord
        </a>
        <a href="https://www.youtube.com/@MinecraftClubOfAmerica" target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          YouTube
        </a>
        <a href="mailto:minecraftclubofamericaoffical@gmail.com">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          Email Us
        </a>
      </div>
    </div>

  </div>
  <div class="footer-disclaimer">
    Not affiliated with, endorsed by, or associated with Mojang Studios or Microsoft.
    Minecraft is a trademark of Mojang Studios.
    <span class="footer-version">v2.3.52</span>
  </div>
</footer>
`;

const TOAST_HTML = `<div class="toast" id="toast">Address copied to clipboard</div>`;

const PROGRESS_HTML = `<div class="scroll-progress" id="scroll-progress"></div>`;

document.addEventListener('DOMContentLoaded', () => {
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

  // Highlight active nav link based on current filename
  const current = window.location.pathname.split('/').pop() || 'index.html';
  const page = current.replace('.html', '') || 'index';
  const activeLink = document.querySelector(`.nav-links a[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('active');

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
