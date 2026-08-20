/* nations.js — loads and renders nations from Supabase */

import { supabase, getUser } from './supabase.js';

const SUPABASE_URL_N  = 'https://hjaywokvgdzhvsoygctc.supabase.co';
const SUPABASE_ANON_N = 'sb_publishable_4lPs4a1t0cOdDRZ1VTpMpQ_fC2dHV_T';

/* ── MARKDOWN RENDERER (simple) ─────────────────────────────── */
function renderMd(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h3>$1</h3>')
    .replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    .replace(/\n{2,}/g,'</p><p>')
    .replace(/^(?!<[hul])/gm, '')
    .replace(/\n/g,' ')
    .replace(/^(.+)$/, '<p>$1</p>');
}

/* ── GRID RENDER ─────────────────────────────────────────────── */
function renderGrid(nations) {
  const grid = document.getElementById('nations-grid');
  if (!grid) return;

  if (nations.length === 0) {
    grid.innerHTML = '<p style="grid-column:1/-1;color:var(--mid);font-size:14px;">No nations found.</p>';
    return;
  }

  grid.innerHTML = nations.map((n, i) => {
    const flagHtml = `<div class="nation-flag-box">${
      n.flag
        ? `<img src="images/flags/${n.flag}" alt="${n.name} flag" onload="applyFlagClass(this)">`
        : `<span class="flag-placeholder">No flag</span>`
    }</div>`;
    return `
      <div class="nation-flag-item" data-season="${n.season || ''}" onclick="openNationDetail(${i})" style="cursor:pointer;" title="View ${n.name}">
        ${flagHtml}
        <div class="nation-name">${n.name}</div>
        ${n.season ? `<div class="nation-season-tag">${n.season}</div>` : ''}
      </div>`;
  }).join('');
}

/* ── YEAR / SERVER FILTER ────────────────────────────────────── */
function renderSeasonFilter(nations) {
  const filterEl = document.getElementById('nations-filter');
  if (!filterEl) return;

  const seasons = [...new Set(nations.map(n => n.season).filter(Boolean))];
  if (seasons.length < 2) { filterEl.innerHTML = ''; return; } // not worth a filter for one season

  filterEl.innerHTML = `
    <button class="archive-filter-btn active" data-season="all">All</button>
    ${seasons.map(s => `<button class="archive-filter-btn" data-season="${s}">${s}</button>`).join('')}
  `;
  filterEl.querySelectorAll('.archive-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterEl.querySelectorAll('.archive-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const active = btn.dataset.season;
      document.querySelectorAll('#nations-grid .nation-flag-item').forEach(card => {
        card.style.display = (active === 'all' || card.dataset.season === active) ? '' : 'none';
      });
    });
  });
}

/* ── DETAIL VIEW ─────────────────────────────────────────────── */
let _nations = [];
let _myOwnedNationIds = [];

function openNationDetail(i) {
  const n = _nations[i];
  if (!n) return;

  document.getElementById('nations-grid').closest('.section').style.display = 'none';
  const detail = document.getElementById('nation-detail-section');
  detail.style.display = '';

  document.getElementById('nation-detail-label').textContent = 'Nation Profile';
  document.getElementById('nation-detail-name').textContent  = n.name;

  const coreFields = [
    ['Leader',        n.leader],
    ['Capital',       n.capital],
    ['Government',    n.government],
    ['Founded',       n.founded],
    ['Founder',       n.founder],
    ['Population',    n.population],
    ['Territory',     n.territory],
    ['Status',        n.status],
    ['Year / Server', n.season],
  ].filter(([,v]) => v);

  const extraFields = n.fields || [];

  const flagHtml = n.flag
    ? `<img src="images/flags/${n.flag}" alt="${n.name} flag" onload="applyFlagDetailClass(this)">`
    : '';

  const tableRows = [...coreFields, ...extraFields.map(f => [f.key, f.value])]
    .map(([k, v]) => `<tr><td style="font-weight:600;padding:6px 16px 6px 0;color:var(--mid);font-size:13px;white-space:nowrap;">${k}</td><td style="padding:6px 0;font-size:14px;">${v}</td></tr>`)
    .join('');

  const tableHtml = tableRows
    ? `<table style="border-collapse:collapse;margin-bottom:1.5rem;">${tableRows}</table>`
    : '';

  const bodyHtml = n.body ? `<div class="article-body">${renderMd(n.body)}</div>` : '';

  const isOwner = _myOwnedNationIds.includes(n.id);
  const editHtml = isOwner ? `
    <div id="nation-owner-edit-toggle" style="margin-bottom:1.5rem;">
      <button class="btn btn-outline" id="nation-owner-edit-btn" style="font-size:13px;">Edit your nation's info</button>
    </div>
    <div id="nation-owner-edit-form" style="display:none;margin-bottom:1.5rem;padding:1.25rem;border:1px solid var(--border);border-radius:8px;">
      <p style="font-size:12px;color:var(--mid);margin-bottom:1rem;">You can update the fields below. Flag images and the nation name are managed by MCA admins.</p>
      <div class="col2-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><label class="form-label">Leader(s)</label><input type="text" id="noe-leader" class="form-input" value="${n.leader || ''}"></div>
        <div><label class="form-label">Capital</label><input type="text" id="noe-capital" class="form-input" value="${n.capital || ''}"></div>
        <div><label class="form-label">Government</label><input type="text" id="noe-government" class="form-input" value="${n.government || ''}"></div>
        <div><label class="form-label">Founded</label><input type="text" id="noe-founded" class="form-input" value="${n.founded || ''}"></div>
        <div><label class="form-label">Founder</label><input type="text" id="noe-founder" class="form-input" value="${n.founder || ''}"></div>
        <div><label class="form-label">Population</label><input type="text" id="noe-population" class="form-input" value="${n.population || ''}"></div>
        <div><label class="form-label">Territory</label><input type="text" id="noe-territory" class="form-input" value="${n.territory || ''}"></div>
        <div style="grid-column:1/-1;"><label class="form-label">Status</label><input type="text" id="noe-status" class="form-input" value="${n.status || ''}"></div>
        <div style="grid-column:1/-1;"><label class="form-label">Description</label><textarea id="noe-body" class="form-input" rows="4" style="resize:vertical;">${n.body || ''}</textarea></div>
      </div>
      <div id="nation-owner-edit-error" style="display:none;color:#c0392b;font-size:13px;margin-top:8px;"></div>
      <div style="display:flex;gap:10px;margin-top:1rem;">
        <button class="btn btn-primary" id="nation-owner-save-btn" style="font-size:13px;">Save Changes</button>
        <button class="btn btn-outline" id="nation-owner-cancel-btn" style="font-size:13px;">Cancel</button>
      </div>
    </div>` : '';

  document.getElementById('nation-detail-body').innerHTML = flagHtml + editHtml + tableHtml + bodyHtml;

  if (isOwner) {
    const toggle = document.getElementById('nation-owner-edit-toggle');
    const form = document.getElementById('nation-owner-edit-form');
    document.getElementById('nation-owner-edit-btn').addEventListener('click', () => {
      toggle.style.display = 'none';
      form.style.display = 'block';
    });
    document.getElementById('nation-owner-cancel-btn').addEventListener('click', () => openNationDetail(i));
    document.getElementById('nation-owner-save-btn').addEventListener('click', async () => {
      const btn = document.getElementById('nation-owner-save-btn');
      const errEl = document.getElementById('nation-owner-edit-error');
      errEl.style.display = 'none';
      btn.disabled = true; btn.textContent = 'Saving…';
      const { error } = await supabase.rpc('update_own_nation', {
        p_nation_id: n.id,
        p_leader:     document.getElementById('noe-leader').value,
        p_capital:    document.getElementById('noe-capital').value,
        p_government: document.getElementById('noe-government').value,
        p_founded:    document.getElementById('noe-founded').value,
        p_founder:    document.getElementById('noe-founder').value,
        p_population: document.getElementById('noe-population').value,
        p_territory:  document.getElementById('noe-territory').value,
        p_status:     document.getElementById('noe-status').value,
        p_body:       document.getElementById('noe-body').value,
      });
      if (error) {
        errEl.textContent = error.message || 'Could not save changes.';
        errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Save Changes';
        return;
      }
      const res = await fetch(
        `${SUPABASE_URL_N}/rest/v1/nations?select=*&order=sort_order.asc`,
        { headers: { 'apikey': SUPABASE_ANON_N, 'Authorization': `Bearer ${SUPABASE_ANON_N}` } }
      );
      const rows = await res.json();
      _nations = rows.map(r => ({
        id: r.id, name: r.name, leader: r.leader || '', capital: r.capital || '',
        government: r.government || '', founded: r.founded || '', founder: r.founder || '', population: r.population || '',
        territory: r.territory || '', status: r.status || '', season: r.season || '', flag: r.flag || '', body: r.body || '', fields: [],
      }));
      renderGrid(_nations);
      renderSeasonFilter(_nations);
      openNationDetail(i);
    });
  }
}

function closeNationDetail() {
  document.getElementById('nations-grid').closest('.section').style.display = '';
  document.getElementById('nation-detail-section').style.display = 'none';
}

/* ── FLAG FORMAT DETECTION ──────────────────────────────────── */
// Portrait ratio (height > width) = PMC banner; landscape = regular flag
function applyFlagClass(img) {
  const isBanner = img.naturalHeight > img.naturalWidth;
  img.classList.add(isBanner ? 'flag-banner' : 'flag-landscape');
}

function applyFlagDetailClass(img) {
  const isBanner = img.naturalHeight > img.naturalWidth;
  img.className = isBanner ? 'flag-detail-banner' : 'flag-detail-landscape';
}

/* Module scripts don't leak top-level functions onto window, but the
   HTML markup calls these via inline onclick/onload attributes — so
   they need to be attached explicitly. */
window.openNationDetail = openNationDetail;
window.closeNationDetail = closeNationDetail;
window.applyFlagClass = applyFlagClass;
window.applyFlagDetailClass = applyFlagDetailClass;
(async function init() {
  const grid = document.getElementById('nations-grid');
  if (!grid) return;

  try {
    const res = await fetch(
      `${SUPABASE_URL_N}/rest/v1/nations?select=*&order=sort_order.asc`,
      { headers: { 'apikey': SUPABASE_ANON_N, 'Authorization': `Bearer ${SUPABASE_ANON_N}` } }
    );
    if (!res.ok) throw new Error('fetch failed');
    const rows = await res.json();
    _nations = rows.map(r => ({
      id:         r.id,
      name:       r.name,
      leader:     r.leader     || '',
      capital:    r.capital    || '',
      government: r.government || '',
      founded:    r.founded    || '',
      founder:    r.founder    || '',
      population: r.population || '',
      territory:  r.territory  || '',
      status:     r.status     || '',
      season:     r.season     || '',
      flag:       r.flag       || '',
      body:       r.body       || '',
      fields:     [],
    }));
    renderGrid(_nations);
    renderSeasonFilter(_nations);
  } catch(e) {
    grid.innerHTML = '<p style="grid-column:1/-1;color:var(--mid);font-size:14px;">Could not load nations. Check back soon.</p>';
  }

  try {
    const user = await getUser();
    if (user) {
      const { data } = await supabase.from('nation_owners').select('nation_id').eq('user_id', user.id);
      _myOwnedNationIds = (data || []).map(r => r.nation_id);
    }
  } catch(e) { /* not logged in / owner lookup failed — no edit access, fine */ }
})();
