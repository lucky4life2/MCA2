/* nav.js — injects the shared nav and footer into every page */

const DISCORD_URL = 'https://discord.gg/YOUR_INVITE_HERE';

const NAV_HTML = `
<nav>
  <a class="nav-logo" href="index.html">
    <div class="nav-dot"></div>
    Minecraft Club of America
  </a>
  <ul class="nav-links">
    <li><a href="index.html"      data-page="index">Home</a></li>
    <li><a href="server.html"     data-page="server">Server</a></li>
    <li><a href="leadership.html" data-page="leadership">Leadership</a></li>
    <li><a href="${DISCORD_URL}" target="_blank" class="nav-discord">Discord</a></li>
  </ul>
</nav>
`;

const FOOTER_HTML = `
<footer>
  <div class="footer-logo">
    <div class="nav-dot"></div>
    Minecraft Club of America
  </div>
  <span class="footer-copy">© 2025 Minecraft Club of America · Ratified May 13, 2025</span>
</footer>
`;

const TOAST_HTML = `<div class="toast" id="toast">Address copied to clipboard</div>`;

document.addEventListener('DOMContentLoaded', () => {
  // Inject nav
  document.body.insertAdjacentHTML('afterbegin', NAV_HTML);

  // Inject footer + toast before </body>
  document.body.insertAdjacentHTML('beforeend', FOOTER_HTML + TOAST_HTML);

  // Highlight active nav link based on current filename
  const current = window.location.pathname.split('/').pop() || 'index.html';
  const page = current.replace('.html', '') || 'index';
  const activeLink = document.querySelector(`.nav-links a[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('active');
});

// Copy-to-clipboard helper used on server.html
function copyAddress() {
  const el = document.getElementById('server-addr');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).catch(() => {});
  const t = document.getElementById('toast');
  if (!t) return;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
