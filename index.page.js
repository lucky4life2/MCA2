/* ── CONFIG LOADER (stats + discord) ───────────────────────── */
(async function loadConfig() {
  const SUPABASE_URL_CFG  = 'https://hjaywokvgdzhvsoygctc.supabase.co';
  const SUPABASE_ANON_CFG = 'sb_publishable_4lPs4a1t0cOdDRZ1VTpMpQ_fC2dHV_T';
  try {
    const res = await fetch(
      `${SUPABASE_URL_CFG}/rest/v1/settings?key=eq.site_config&select=value`,
      { headers: { 'apikey': SUPABASE_ANON_CFG, 'Authorization': `Bearer ${SUPABASE_ANON_CFG}` } }
    );
    if (!res.ok) return;
    const rows = await res.json();
    if (!rows.length) return;
    let cfg = {};
    try { cfg = JSON.parse(rows[0].value); } catch(e) { return; }
    // Stats
    ['stat1','stat2','stat3','stat4'].forEach(s => {
      ['label','value','sub'].forEach(p => {
        const el = document.getElementById(`${s}-${p}`);
        if (el && cfg[`${s}_${p}`]) el.textContent = cfg[`${s}_${p}`];
      });
    });
    // Discord button
    if (cfg.discord_url) {
      const btn = document.getElementById('hero-discord-btn');
      if (btn) btn.href = cfg.discord_url;
    }
  } catch(e) {}
})();
