(async function loadLeadership() {
  const SUPABASE_URL  = 'https://hjaywokvgdzhvsoygctc.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_4lPs4a1t0cOdDRZ1VTpMpQ_fC2dHV_T';

  // Leadership rows are editable from the admin panel and rendered straight
  // into innerHTML, so every interpolated field is escaped first.
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/leadership?select=*&order=sort_order.asc`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    if (!res.ok) throw new Error('fetch failed');
    const people = await res.json();

    // Team grid — show_in_team === true
    const teamGrid = document.getElementById('leadership-team-grid');
    const teamPeople = people.filter(p => p.show_in_team);
    teamGrid.innerHTML = teamPeople.length
      ? teamPeople.map(p => `
          <div class="leadership-team-card">
            <div class="leadership-team-name">${esc(p.name)}</div>
            <div class="leadership-team-role">${esc(p.title)}</div>
            ${p.subtitle ? `<div style="font-size:12px;color:var(--muted);margin-top:2px;">${esc(p.subtitle)}</div>` : ''}
          </div>`).join('')
      : '<div style="color:var(--muted);font-size:14px;">No team members listed.</div>';

    // Branch tables
    ['administrative','cabinet','congress','court'].forEach(branch => {
      const table = document.getElementById(`branch-${branch}`);
      if (!table) return;
      const rows = people.filter(p => p.branch === branch);
      table.innerHTML = rows.length
        ? rows.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.title)}${p.subtitle ? ' · ' + esc(p.subtitle) : ''}</td></tr>`).join('')
        : '<tr><td colspan="2" style="color:var(--muted);">No members listed.</td></tr>';
    });
  } catch(e) {
    ['leadership-team-grid','branch-administrative','branch-cabinet','branch-congress','branch-court'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<tr><td colspan="2" style="color:var(--muted);">Could not load data.</td></tr>';
    });
  }

  // Club Presidents
  try {
    const cpRes = await fetch(
      `${SUPABASE_URL}/rest/v1/club_presidents?select=*&order=region.asc,name.asc`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    if (cpRes.ok) {
      const presidents = await cpRes.json();
      if (presidents.length) {
        document.getElementById('club-presidents-section').style.display = '';
        const table = document.getElementById('club-presidents-table');
        table.innerHTML = presidents.map(p =>
          `<tr>
            <td>${esc(p.name)}${p.username ? `<br><span style="font-size:12px;color:var(--muted);">@${esc(p.username)}</span>` : ''}</td>
            <td>${esc(p.club_name)}${p.region ? `<br><span style="font-size:12px;color:var(--muted);">${esc(p.region)}</span>` : ''}</td>
          </tr>`
        ).join('');
      }
    }
  } catch(e) { /* Club presidents table may not exist yet */ }
})();
