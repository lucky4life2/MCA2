/* ── CONFIG LOADER (stats + discord) ───────────────────────── */
(async function loadConfig() {
  const SUPABASE_URL_CFG  = 'https://hjaywokvgdzhvsoygctc.supabase.co';
  const SUPABASE_ANON_CFG = 'sb_publishable_4lPs4a1t0cOdDRZ1VTpMpQ_fC2dHV_T';
  // Reuses nav.js's site_config fetch when it already succeeded, so the
  // homepage doesn't fetch the same row twice. Falls back to its own fetch
  // when nav hasn't loaded or nav's fetch came back empty.
  let cfg = {};
  try {
    if (window._configReady) await window._configReady;
    if (window._siteConfig && Object.keys(window._siteConfig).length) {
      cfg = window._siteConfig;
    } else {
      const res = await fetch(
        `${SUPABASE_URL_CFG}/rest/v1/settings?key=eq.site_config&select=value`,
        { headers: { 'apikey': SUPABASE_ANON_CFG, 'Authorization': `Bearer ${SUPABASE_ANON_CFG}` }, signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return;
      const rows = await res.json();
      if (!rows.length) return;
      try { cfg = JSON.parse(rows[0].value); } catch(e) { return; }
    }
    // Stats
    ['stat1','stat2','stat3','stat4'].forEach(s => {
      ['label','value','sub'].forEach(p => {
        const el = document.getElementById(`${s}-${p}`);
        if (el && cfg[`${s}_${p}`]) el.textContent = cfg[`${s}_${p}`];
      });
    });
    // Discord button — site_config is admin-editable, so its URL is
    // untrusted input. Only accept http(s); anything else (e.g. a
    // javascript: scheme) is dropped and the button keeps its default href,
    // matching the safeLinkUrl() guard nav.js applies to this same field.
    if (cfg.discord_url && /^https?:\/\//i.test(String(cfg.discord_url).trim())) {
      const btn = document.getElementById('hero-discord-btn');
      if (btn) btn.href = String(cfg.discord_url).trim();
    }
  } catch(e) {}
})();
