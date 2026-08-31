(async function loadHistoryServers() {
  const SUPABASE_URL  = 'https://hjaywokvgdzhvsoygctc.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_4lPs4a1t0cOdDRZ1VTpMpQ_fC2dHV_T';
  const tbody = document.getElementById('history-servers-tbody');

  // Server history rows are admin-editable and go straight into innerHTML.
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/history_servers?select=*&order=sort_order.asc`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    if (!res.ok) throw new Error('fetch failed');
    const servers = await res.json();

    tbody.innerHTML = servers.length
      ? servers.map(s => `
          <tr${s.is_current ? ' class="current-row"' : ''}>
            <td><strong>${esc(s.name)}</strong></td>
            <td>${esc(s.period)}</td>
            <td>${esc(s.description || '')}</td>
          </tr>`).join('')
      : '<tr><td colspan="3" style="color:var(--muted);">No servers listed yet.</td></tr>';
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--muted);">Could not load server history.</td></tr>';
  }
})();
