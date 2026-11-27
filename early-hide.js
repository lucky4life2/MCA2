// Runs before first paint so the page never flashes the wrong theme or
// unstyled/unlocked content. Loaded as a plain, blocking <script src>
// (not type="module", not defer/async) at the very top of <head> — a
// classic script tag like this blocks parsing and therefore first paint
// until it runs, guaranteeing this executes before the browser can paint
// anything. nav.js itself is a deferred module and can't run until the
// whole document is parsed, which is too late to prevent a flash on a
// slow connection.
//
// A same-origin external file (not an inline <script> block) so it passes
// under both CSP tiers in _headers, including the strict one that has no
// 'unsafe-inline' for script-src.
(function () {
  try {
    var stored = localStorage.getItem('mca_theme');
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
})();
document.documentElement.style.visibility = 'hidden';
