/* nav.js — shared nav, footer, and global utilities */

const DISCORD_URL = 'https://discord.gg/hZrt28vG29';

const NAV_HTML = `
<nav>
  <a class="nav-logo" href="index.html">
    <img src="images/widelogo.png" alt="Minecraft Club of America" class="nav-logo-img">
  </a>
  <ul class="nav-links">
    <li><a href="index.html"      data-page="index">Home</a></li>
    <li><a href="server.html"     data-page="server">Server</a></li>
    <li><a href="leadership.html" data-page="leadership">Leadership</a></li>
    <li><a href="history.html"    data-page="history">History</a></li>
    <li><a href="${DISCORD_URL}" target="_blank" class="nav-discord">Discord</a></li>
  </ul>
</nav>
`;

const FOOTER_HTML = `
<footer>
  <div class="footer-logo">
    <img src="images/logo.png" alt="Minecraft Club of America" class="footer-logo-img">
    <span class="footer-logo-text">Minecraft Club of America</span>
  </div>
  <span class="footer-copy">© <span id="year"></span> Minecraft Club of America · Ratified May 13, 2025</span>
</footer>
`;

const TOAST_HTML = `<div class="toast" id="toast">Address copied to clipboard</div>`;

document.addEventListener('DOMContentLoaded', () => {
  // Inject nav
  document.body.insertAdjacentHTML('afterbegin', NAV_HTML);

  // Inject footer + toast
  document.body.insertAdjacentHTML('beforeend', FOOTER_HTML + TOAST_HTML);

  // Auto-update year in footer
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Highlight active nav link based on current filename
  const current = window.location.pathname.split('/').pop() || 'index.html';
  const page = current.replace('.html', '') || 'index';
  const activeLink = document.querySelector(`.nav-links a[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('active');

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
