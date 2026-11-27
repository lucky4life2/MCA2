// Per-card copy helper (server.html only)
  function copyAddr(id) {
    const el = document.getElementById(id);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent.trim()).catch(() => {});
    const t = document.getElementById('toast');
    if (!t) return;
    t.classList.add('show');
    if (window.mcaPausableToast) window.mcaPausableToast(t, 2000, () => t.classList.remove('show'));
    else setTimeout(() => t.classList.remove('show'), 2000);
  }
