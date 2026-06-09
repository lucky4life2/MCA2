/* nations.js — loads and renders nations from Supabase */

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
      <div class="nation-flag-item" onclick="openNationDetail(${i})" style="cursor:pointer;" title="View ${n.name}">
        ${flagHtml}
        <div class="nation-name">${n.name}</div>
      </div>`;
  }).join('');
}

/* ── DETAIL VIEW ─────────────────────────────────────────────── */
let _nations = [];

function openNationDetail(i) {
  const n = _nations[i];
  if (!n) return;

  document.getElementById('nations-grid').closest('.section').style.display = 'none';
  const detail = document.getElementById('nation-detail-section');
  detail.style.display = '';

  document.getElementById('nation-detail-label').textContent = 'Nation Profile';
  document.getElementById('nation-detail-name').textContent  = n.name;

  const coreFields = [
    ['Leader',     n.leader],
    ['Capital',    n.capital],
    ['Government', n.government],
    ['Founded',    n.founded],
    ['Population', n.population],
    ['Territory',  n.territory],
    ['Status',     n.status],
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

  document.getElementById('nation-detail-body').innerHTML = flagHtml + tableHtml + bodyHtml;
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

/* ── INIT ───────────────────────────────────────────────────── */
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
      name:       r.name,
      leader:     r.leader     || '',
      capital:    r.capital    || '',
      government: r.government || '',
      founded:    r.founded    || '',
      population: r.population || '',
      territory:  r.territory  || '',
      status:     r.status     || '',
      flag:       r.flag       || '',
      body:       r.body       || '',
      fields:     [],
    }));
    renderGrid(_nations);
  } catch(e) {
    grid.innerHTML = '<p style="grid-column:1/-1;color:var(--mid);font-size:14px;">Could not load nations. Check back soon.</p>';
  }
})();
