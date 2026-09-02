import { supabase } from './supabase.js';

let _me = null;
let _access = { manage: false, file: false, certify: false, moderate: false, isJustice: false, justice: null };
let _types = [], _statuses = [], _motionTypes = [];
let _cases = [], _caseParties = [];
let _justices = [], _nations = [];
let _notifications = [], _pendingCertifications = [], _calendarEvents = [], _calendarAllEvents = [];
let _currentCase = null;
let _archiveFiltered = [];
let _memberProfiles = [];
const ARGUMENT_POSITIONS = ['opening_statement', 'argument', 'rebuttal', 'evidence_summary', 'closing_statement', 'procedural_note'];
const PARTY_ROLE_LABEL = { petitioner: 'Petitioner', respondent: 'Respondent', petitioner_representative: "Petitioner's Representative", respondent_representative: "Respondent's Representative", witness: 'Witness' };
const FILING_TYPE_LABEL = { complaint: 'Complaint', answer: 'Answer', brief: 'Brief', evidence: 'Evidence', motion_response: 'Response to Motion', appeal_notice: 'Notice of Appeal', other: 'Filing' };
const EVENT_TYPE_LABEL = { hearing: 'Hearing', oral_argument: 'Oral Argument', deliberation: 'Deliberation', deadline: 'Deadline', special_session: 'Special Session' };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^https?:\/\//i.test(u) ? u : '';
  return u;
}

// ── Member name directory (see congress.page.js for why public_profiles) ──
let _directory = null;
async function loadDirectory() {
  if (_directory) return _directory;
  const { data, error } = await supabase.from('public_profiles').select('id, username, display_name');
  if (error) { console.error('loadDirectory failed:', error.message); return new Map(); }
  _directory = new Map((data || []).map(p => [p.id, p.display_name || p.username]));
  return _directory;
}
function nameOf(userId, fallback = 'Member') {
  if (!userId || !_directory) return fallback;
  return _directory.get(userId) || fallback;
}

function show(which) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('denied').style.display = which === 'denied' ? 'block' : 'none';
  document.getElementById('main').style.display = which === 'main' ? 'block' : 'none';
}

async function resolveAccess() {
  const [{ data: manage }, { data: file }, { data: certify }, { data: moderate }, { data: justice }] = await Promise.all([
    supabase.rpc('user_has_permission', { perm: 'can_manage_court' }),
    supabase.rpc('user_has_permission', { perm: 'can_file_court_cases' }),
    supabase.rpc('user_has_permission', { perm: 'can_certify_court_rulings' }),
    supabase.rpc('user_has_permission', { perm: 'can_moderate_court_filings' }),
    supabase.from('court_justices').select('id, role').eq('user_id', _me.id).eq('status', 'active').maybeSingle(),
  ]);
  return {
    manage: manage === true, file: file === true, certify: certify === true, moderate: moderate === true,
    isJustice: !!justice, justice: justice || null,
  };
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return show('denied');
  _me = session.user;
  _access = await resolveAccess();
  await loadDirectory();
  document.getElementById('btn-new-case').style.display = (_access.manage || _access.file) ? '' : 'none';

  const [{ data: types }, { data: statuses }, { data: motionTypes }] = await Promise.all([
    supabase.from('court_lookups').select('*').eq('kind', 'case_type').eq('is_enabled', true).order('sort_order'),
    supabase.from('court_lookups').select('*').eq('kind', 'case_status').order('sort_order'),
    supabase.from('court_lookups').select('*').eq('kind', 'motion_type').order('sort_order'),
  ]);
  _types = types || []; _statuses = statuses || []; _motionTypes = motionTypes || [];
  populateFilters();
  populateNewCaseForm();
  document.getElementById('ct-tab-leadership').style.display = _access.manage ? '' : 'none';

  show('main');
  bindTabs();
  bindModals();
  await Promise.all([loadCases(), loadJustices(), loadDashboardExtras()]);
  renderDashboard();
  renderDocketList();
  renderArchive();
  if (_access.manage) { await loadCalendarAll(); renderLeadershipTools(); bindLeadershipTools(); }

  const deepLinkId = new URLSearchParams(location.search).get('case');
  if (deepLinkId) openCase(deepLinkId);
}

function populateFilters() {
  const typeSel = document.getElementById('ct-filter-type');
  _types.forEach(t => typeSel.insertAdjacentHTML('beforeend', `<option value="${t.key}">${esc(t.label)}</option>`));
  const statusSel = document.getElementById('ct-filter-status');
  _statuses.forEach(s => statusSel.insertAdjacentHTML('beforeend', `<option value="${s.key}">${esc(s.label)}</option>`));
  typeSel.onchange = renderDocketList;
  statusSel.onchange = renderDocketList;

  const arType = document.getElementById('ar-type');
  _types.forEach(t => arType.insertAdjacentHTML('beforeend', `<option value="${t.key}">${esc(t.label)}</option>`));
  const arStatus = document.getElementById('ar-status');
  ARCHIVE_STATUSES.forEach(key => arStatus.insertAdjacentHTML('beforeend', `<option value="${key}">${esc(statusLabel(key))}</option>`));
  ['ar-type', 'ar-status', 'ar-from', 'ar-to', 'ar-keyword'].forEach(id => document.getElementById(id).oninput = renderArchive);
  document.getElementById('ar-export').onclick = exportArchiveCsv;
}

function populateNewCaseForm() {
  document.getElementById('nc-type').innerHTML = _types.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('');
  document.getElementById('nc-type').onchange = async (e) => {
    const isConstitutional = e.target.value === 'constitutional_review';
    document.getElementById('nc-measure-group').style.display = isConstitutional ? '' : 'none';
    if (isConstitutional) await loadMeasureOptions();
  };
}

let _measureOptionsLoaded = false;
async function loadMeasureOptions() {
  if (_measureOptionsLoaded) return;
  _measureOptionsLoaded = true;
  const { data } = await supabase.from('congress_measures').select('id, number, title').order('created_at', { ascending: false });
  const sel = document.getElementById('nc-measure');
  (data || []).forEach(m => sel.insertAdjacentHTML('beforeend', `<option value="${m.id}">${esc(m.number || 'Draft')} — ${esc(m.title)}</option>`));
}

function bindTabs() {
  document.querySelectorAll('.cg-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.cg-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
      ['dashboard', 'docket', 'archive', 'leadership'].forEach(t => {
        document.getElementById('tab-' + t).style.display = (t === btn.dataset.tab) ? '' : 'none';
      });
    };
  });
}

// ── Data loads ──────────────────────────────────────────────────
async function loadCases() {
  const [{ data: cases, error }, { data: parties }] = await Promise.all([
    supabase.from('court_cases').select('*').order('created_at', { ascending: false }),
    supabase.from('court_case_parties').select('*'),
  ]);
  if (error) console.error(error);
  _cases = cases || [];
  _caseParties = parties || [];
}

async function loadJustices() {
  const { data } = await supabase.from('court_justices').select('*').order('seated_at');
  _justices = data || [];
}

async function loadNations() {
  if (_nations.length) return;
  const { data } = await supabase.from('nations').select('id, name').order('name');
  _nations = data || [];
}

async function loadDashboardExtras() {
  const nowIso = new Date().toISOString();
  const [{ data: events }, { data: notes }, { data: pendingCerts }] = await Promise.all([
    supabase.from('court_calendar_events').select('*').eq('is_cancelled', false).order('starts_at'),
    supabase.from('court_notifications').select('*').eq('user_id', _me.id).eq('is_read', false).order('created_at', { ascending: false }).limit(10),
    (_access.manage || _access.certify)
      ? supabase.from('court_roll_calls').select('id, question, closes_at, case_id, court_cases(number, title)').eq('status', 'closed').order('closes_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  _calendarEvents = (events || []).filter(e => (e.ends_at || e.starts_at) >= nowIso);
  _notifications = notes || [];
  _pendingCertifications = pendingCerts || [];
}

async function dismissNotification(id) {
  await supabase.from('court_notifications').update({ is_read: true }).eq('id', id);
  _notifications = _notifications.filter(n => n.id !== id);
  renderDashboard();
}

async function loadCalendarAll() {
  const { data } = await supabase.from('court_calendar_events').select('*').order('starts_at', { ascending: false }).limit(30);
  _calendarAllEvents = data || [];
}

async function loadMemberDirectory() {
  if (_memberProfiles.length) return;
  const { data } = await supabase.from('public_profiles').select('id, display_name, username').order('display_name');
  _memberProfiles = data || [];
  const sel = document.getElementById('lt-add-user');
  sel.innerHTML = `<option value="">Add justice…</option>` + _memberProfiles.map(p => `<option value="${p.id}">${esc(p.display_name || p.username)}</option>`).join('');
}

function typeLabel(key) { return _types.find(t => t.key === key)?.label || key; }
function statusLabel(key) { return _statuses.find(s => s.key === key)?.label || key; }
function motionTypeLabel(key) { return _motionTypes.find(t => t.key === key)?.label || key; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }

// ── Leadership Tools ────────────────────────────────────────────
function renderLeadershipTools() {
  const certifiable = _pendingCertifications;
  document.getElementById('ct-lt-certify').innerHTML = certifiable.length ? certifiable.map(rc => `
    <div class="cg-row" style="cursor:default;">
      <span class="cg-row-number">${esc(rc.court_cases?.number || 'Undocketed')}</span>
      <span class="cg-row-title">${esc(rc.question)}<span class="cg-sub" style="display:block;">${esc(rc.court_cases?.title || '')}</span></span>
      ${_access.certify ? `<button class="btn btn-primary" data-open-case="${rc.case_id}">Review &amp; Certify</button>` : ''}
    </div>`).join('') : `<div class="cg-empty-state">Nothing awaiting certification.</div>`;

  const active = _cases.filter(c => !['decided', 'dismissed', 'withdrawn'].includes(c.status_key));
  document.getElementById('ct-lt-docket').innerHTML = active.length ? active.map(c => `
    <div class="cg-row" style="cursor:default;flex-wrap:wrap;">
      <span class="cg-row-number">${esc(c.number || 'Undocketed')}</span>
      <span class="cg-row-title">${esc(c.title)} <span class="cg-badge ${esc(c.status_key)}">${esc(statusLabel(c.status_key))}</span></span>
      <select data-case-status="${c.id}" style="max-width:180px;">
        ${_statuses.map(s => `<option value="${s.key}" ${s.key === c.status_key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
      </select>
      <button class="btn btn-outline" data-case-status-apply="${c.id}">Set Status</button>
    </div>`).join('') : `<div class="cg-empty-state">No open cases.</div>`;

  document.getElementById('ct-lt-motion-types').innerHTML = _motionTypes.map(t => `
    <div class="cg-card" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;">
      <span style="font-size:13px;font-weight:600;">${esc(t.label)}</span>
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);">
        <input type="checkbox" data-motion-type-toggle="${t.key}" ${t.is_enabled ? 'checked' : ''}> Enabled
      </label>
    </div>`).join('');

  document.getElementById('ct-lt-calendar').innerHTML = _calendarAllEvents.length ? _calendarAllEvents.map(e => `
    <div class="cg-row" style="cursor:default;">
      <span class="cg-row-number">${fmtDate(e.starts_at)}</span>
      <span class="cg-row-title">${esc(EVENT_TYPE_LABEL[e.event_type] || e.event_type)} — ${esc(e.title)}${e.is_cancelled ? ' <span class="cg-badge withdrawn">Cancelled</span>' : ''}</span>
      ${!e.is_cancelled ? `<button class="btn btn-danger" data-cal-cancel="${e.id}">Cancel</button>` : ''}
    </div>`).join('') : `<div class="cg-empty-state">No calendar events yet.</div>`;

  document.getElementById('ct-lt-justices').innerHTML = _justices.length ? _justices.map(j => `
    <div class="cg-row" style="cursor:default;">
      <span style="flex:1;">${esc(nameOf(j.user_id))}${j.seat_label ? ` <span class="cg-sub">(${esc(j.seat_label)})</span>` : ''} ${j.role === 'chief' ? '<span class="ct-party-tag">Chief Justice</span>' : ''}</span>
      <select data-justice-status="${j.id}">
        ${['active', 'recused', 'vacant', 'ineligible'].map(s => `<option value="${s}" ${j.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>`).join('') : `<div class="cg-empty-state">No justices seated.</div>`;

  const natSel = document.getElementById('lt-add-nation');
  if (!natSel.dataset.filled) {
    loadNations().then(() => { natSel.innerHTML = `<option value="">Nation (optional)</option>` + _nations.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join(''); });
    natSel.dataset.filled = '1';
  }
}

function bindLeadershipTools() {
  loadMemberDirectory();
  document.getElementById('ct-lt-certify').onclick = (e) => {
    const id = e.target.dataset.openCase;
    if (id) openCase(id);
  };
  document.getElementById('ct-lt-docket').onclick = async (e) => {
    const id = e.target.dataset.caseStatusApply;
    if (!id) return;
    const sel = document.querySelector(`select[data-case-status="${id}"]`);
    const { error } = await supabase.rpc('court_transition_case_status', { p_case_id: id, p_status_key: sel.value });
    if (error) { alert(error.message); return; }
    await loadCases(); renderLeadershipTools(); renderDashboard(); renderDocketList(); renderArchive();
  };
  document.getElementById('ct-lt-motion-types').onchange = async (e) => {
    const key = e.target.dataset.motionTypeToggle;
    if (!key) return;
    await supabase.from('court_lookups').update({ is_enabled: e.target.checked }).eq('kind', 'motion_type').eq('key', key);
    const { data } = await supabase.from('court_lookups').select('*').eq('kind', 'motion_type').order('sort_order');
    _motionTypes = data || [];
  };
  document.getElementById('cal-submit').onclick = async () => {
    const title = document.getElementById('cal-title').value.trim();
    const starts = document.getElementById('cal-starts').value;
    if (!title || !starts) { alert('Title and start time are required.'); return; }
    await supabase.from('court_calendar_events').insert({
      event_type: document.getElementById('cal-type').value, title,
      starts_at: new Date(starts).toISOString(),
      location: document.getElementById('cal-location').value.trim() || null,
      created_by: _me.id,
    });
    ['cal-title', 'cal-starts', 'cal-location'].forEach(id => document.getElementById(id).value = '');
    await Promise.all([loadCalendarAll(), loadDashboardExtras()]); renderLeadershipTools(); renderDashboard();
  };
  document.getElementById('ct-lt-calendar').onclick = async (e) => {
    const id = e.target.dataset.calCancel;
    if (!id) return;
    await supabase.from('court_calendar_events').update({ is_cancelled: true, cancelled_reason: prompt('Reason (optional):') || null }).eq('id', id);
    await Promise.all([loadCalendarAll(), loadDashboardExtras()]); renderLeadershipTools(); renderDashboard();
  };
  document.getElementById('ct-lt-justices').onchange = async (e) => {
    const id = e.target.dataset.justiceStatus;
    if (!id) return;
    await supabase.from('court_justices').update({ status: e.target.value, status_set_by: _me.id, status_set_at: new Date().toISOString() }).eq('id', id);
    await loadJustices(); renderLeadershipTools();
  };
  document.getElementById('lt-add-user').onchange = async (e) => {
    const userId = e.target.value;
    if (!userId) return;
    await supabase.from('court_justices').insert({
      user_id: userId,
      nation_id: document.getElementById('lt-add-nation').value || null,
      role: document.getElementById('lt-add-role').value,
      created_by: _me.id,
    });
    e.target.value = '';
    await loadJustices(); renderLeadershipTools();
  };
}

// ── Dashboard ───────────────────────────────────────────────────
function upcomingItems() {
  const items = [];
  _calendarEvents.forEach(e => items.push({ when: e.starts_at, label: `${EVENT_TYPE_LABEL[e.event_type] || 'Event'}: ${e.title}`, sub: e.location || '', caseId: e.case_id }));
  const nowIso = new Date().toISOString();
  _cases.forEach(c => {
    if (c.hearing_deadline && c.hearing_deadline >= nowIso && !['decided', 'dismissed', 'withdrawn'].includes(c.status_key)) {
      items.push({ when: c.hearing_deadline, label: `Hearing deadline — ${c.number || 'Undocketed'}`, sub: c.title, caseId: c.id });
    }
  });
  return items.sort((a, b) => a.when.localeCompare(b.when)).slice(0, 8);
}

function renderDashboard() {
  const grid = document.getElementById('ct-dashboard-grid');
  const myCaseIds = new Set(_caseParties.filter(p => p.user_id === _me.id).map(p => p.case_id));
  const myCases = _cases.filter(c => myCaseIds.has(c.id) || c.created_by === _me.id);
  const underDeliberation = _cases.filter(c => c.status_key === 'deliberation');
  const recentlyDecided = _cases.filter(c => c.status_key === 'decided').slice(0, 6);
  const recent = _cases.slice(0, 6);
  const upcoming = upcomingItems();

  const caseCards = [
    ['Your Cases', myCases],
    ['Under Deliberation', underDeliberation],
    ['Recently Decided', recentlyDecided],
    ['Recent Activity', recent],
  ].map(([title, list]) => `
    <div class="cg-card">
      <h3>${esc(title)}</h3>
      ${list.length ? `<ul>${list.slice(0, 6).map(c => `
        <li><a href="#" data-case="${c.id}">${esc(c.number || 'Undocketed')} — ${esc(c.title)}
          <span class="cg-sub">${esc(typeLabel(c.type_key))} · ${esc(statusLabel(c.status_key))}</span></a></li>
      `).join('')}</ul>` : `<div class="cg-empty">Nothing here right now.</div>`}
    </div>`).join('');

  const upcomingCard = `
    <div class="cg-card">
      <h3>Upcoming</h3>
      ${upcoming.length ? `<ul>${upcoming.map(i => `
        <li>${i.caseId ? `<a href="#" data-case="${i.caseId}">${esc(i.label)}</a>` : `<span style="font-weight:600;">${esc(i.label)}</span>`}
          <span class="cg-sub">${fmtDate(i.when)}${i.sub ? ' · ' + esc(i.sub) : ''}</span></li>
      `).join('')}</ul>` : `<div class="cg-empty">Nothing scheduled.</div>`}
    </div>`;

  const notifCard = `
    <div class="cg-card">
      <h3>Notifications</h3>
      ${_notifications.length ? `<ul>${_notifications.map(n => `
        <li><a href="#" data-dismiss-notif="${n.id}" ${n.link ? `data-notif-link="${esc(n.link)}"` : ''}>${esc(n.title)}
          <span class="cg-sub">${n.body ? esc(n.body) + ' · ' : ''}${fmtDate(n.created_at)}</span></a></li>
      `).join('')}</ul>` : `<div class="cg-empty">You're all caught up.</div>`}
    </div>`;

  const quickActionsCard = (_access.manage || _access.certify) ? `
    <div class="cg-card">
      <h3>Quick Actions</h3>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${_access.manage ? `<button class="btn btn-outline" id="qa-new-case">+ File a Case</button>` : ''}
        ${_pendingCertifications.length ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">${_pendingCertifications.length} ruling${_pendingCertifications.length === 1 ? '' : 's'} awaiting certification:</div>
          <ul>${_pendingCertifications.slice(0, 5).map(rc => `<li><a href="#" data-case="${rc.case_id}">${esc(rc.court_cases?.number || 'Undocketed')} — ${esc(rc.question)}</a></li>`).join('')}</ul>` : ''}
      </div>
    </div>` : '';

  const standingCard = `
    <div class="cg-card">
      <h3>Your Standing</h3>
      <div style="font-size:13px;line-height:1.7;">
        ${_access.isJustice ? `✓ Seated Justice${_access.justice.role === 'chief' ? ' (Chief Justice)' : ''}<br>` : ''}
        ${_access.file || _access.manage ? '✓ Can file cases<br>' : ''}
        ${_access.manage ? '✓ Court administration access' : ''}
        ${!_access.isJustice && !_access.file && !_access.manage ? '<span class="cg-empty">No special standing on record</span>' : ''}
      </div>
    </div>`;

  grid.innerHTML = upcomingCard + notifCard + quickActionsCard + caseCards + standingCard;

  grid.querySelectorAll('a[data-case]').forEach(a => a.onclick = (e) => { e.preventDefault(); openCase(a.dataset.case); });
  grid.querySelectorAll('a[data-dismiss-notif]').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    if (a.dataset.notifLink) {
      const target = safeUrl(a.dataset.notifLink);
      if (target) window.location.href = target;
    }
    dismissNotification(a.dataset.dismissNotif);
  });
  const qaCase = document.getElementById('qa-new-case');
  if (qaCase) qaCase.onclick = () => document.getElementById('btn-new-case').click();
}

// ── Docket / Archive lists ──────────────────────────────────────
function caseRowHtml(c) {
  return `<div class="cg-row" tabindex="0" data-case="${c.id}">
    <span class="cg-row-number">${esc(c.number || 'UNDOCKETED')}</span>
    <span class="cg-row-title">${esc(c.title)}</span>
    <span class="cg-row-meta">${esc(typeLabel(c.type_key))}</span>
    <span class="cg-badge ${esc(c.status_key)}">${esc(statusLabel(c.status_key))}</span>
  </div>`;
}

function renderDocketList() {
  const typeFilter = document.getElementById('ct-filter-type').value;
  const statusFilter = document.getElementById('ct-filter-status').value;
  let list = _cases.filter(c => (!typeFilter || c.type_key === typeFilter) && (!statusFilter || c.status_key === statusFilter));
  const el = document.getElementById('ct-case-list');
  el.innerHTML = list.length ? list.map(caseRowHtml).join('') : `<div class="cg-empty-state">No cases match these filters.</div>`;
  bindRowClicks(el);
}

const ARCHIVE_STATUSES = ['decided', 'dismissed', 'withdrawn'];
function renderArchive() {
  const type = document.getElementById('ar-type').value;
  const status = document.getElementById('ar-status').value;
  const from = document.getElementById('ar-from').value;
  const to = document.getElementById('ar-to').value;
  const keyword = document.getElementById('ar-keyword').value.trim().toLowerCase();

  let list = _cases.filter(c => ARCHIVE_STATUSES.includes(c.status_key));
  if (type) list = list.filter(c => c.type_key === type);
  if (status) list = list.filter(c => c.status_key === status);
  if (from) list = list.filter(c => c.updated_at >= from);
  if (to) list = list.filter(c => c.updated_at <= to + 'T23:59:59');
  if (keyword) list = list.filter(c => (c.title + ' ' + (c.summary || '') + ' ' + (c.number || '')).toLowerCase().includes(keyword));

  const el = document.getElementById('ct-archive-list');
  el.innerHTML = list.length ? list.map(caseRowHtml).join('') : `<div class="cg-empty-state">No completed cases match these filters.</div>`;
  bindRowClicks(el);
  _archiveFiltered = list;
}

function exportArchiveCsv() {
  const rows = [['Number', 'Title', 'Type', 'Result', 'Last Updated']];
  (_archiveFiltered || []).forEach(c => rows.push([c.number || 'Undocketed', c.title, typeLabel(c.type_key), c.final_result || statusLabel(c.status_key), c.updated_at]));
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'mca-court-archive.csv'; a.click();
}

function bindRowClicks(container) {
  container.querySelectorAll('.cg-row').forEach(row => {
    row.onclick = () => openCase(row.dataset.case);
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCase(row.dataset.case); } };
  });
}

// ── Case detail ─────────────────────────────────────────────────
async function openCase(id) {
  const [{ data: kase }, { data: parties }, { data: filings }, { data: args }, { data: attachments }, { data: opinions }, { data: motions }, { data: rollCalls }, { data: recusals }] = await Promise.all([
    supabase.from('court_cases').select('*').eq('id', id).single(),
    supabase.from('court_case_parties').select('*').eq('case_id', id).order('added_at'),
    supabase.from('court_filings').select('*').eq('case_id', id).order('created_at'),
    supabase.from('court_arguments').select('*').eq('case_id', id).eq('is_archived', false).order('created_at'),
    supabase.from('court_attachments').select('*').eq('case_id', id).order('created_at'),
    supabase.from('court_opinions').select('*').eq('case_id', id).order('created_at', { ascending: false }),
    supabase.from('court_motions').select('*').eq('case_id', id).order('created_at', { ascending: false }),
    supabase.from('court_roll_calls').select('*').eq('case_id', id).order('created_at', { ascending: false }),
    supabase.from('court_case_recusals').select('*').eq('case_id', id),
  ]);
  if (!kase) return;
  window.history.replaceState(null, '', '?case=' + id);
  _currentCase = kase;

  const activeRollCall = (rollCalls || []).find(rc => rc.status === 'open' || rc.status === 'scheduled') || (rollCalls || [])[0] || null;
  const isParty = (parties || []).some(p => p.user_id === _me.id);
  const iAmRecused = (recusals || []).some(r => r.user_id === _me.id);
  const canFile = _access.manage || isParty || _access.isJustice;
  const canArgue = canFile;
  const isCaseOpen = !['decided', 'dismissed', 'withdrawn'].includes(kase.status_key);

  document.getElementById('ct-modal-title').textContent = `${kase.number || 'Undocketed'} — ${kase.title}`;
  document.getElementById('ct-modal-sub').textContent = `${typeLabel(kase.type_key)} · ${statusLabel(kase.status_key)}${kase.final_result ? ' · ' + kase.final_result : ''}`;

  let voteBlockHtml = '';
  if (activeRollCall) voteBlockHtml = await renderVoteBlock(activeRollCall);

  document.getElementById('ct-modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--mid);">${esc(kase.summary || '')}</p>
    ${kase.related_measure_id ? `<p style="font-size:12px;color:var(--muted);">Challenges Congress measure: <a href="congress.html?measure=${esc(kase.related_measure_id)}">view measure</a></p>` : ''}
    ${_access.manage ? `
      <div class="form-group" style="display:flex;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
          <label class="form-label" for="ct-visibility">Visibility</label>
          <select class="form-select" id="ct-visibility">
            ${['public', 'members', 'parties_only'].map(v => `<option value="${v}" ${v === kase.visibility ? 'selected' : ''}>${v.replace('_', ' ')}</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;min-width:180px;">
          <label class="form-label" for="ct-presiding">Presiding Justice</label>
          <select class="form-select" id="ct-presiding">
            <option value="">Unassigned</option>
            ${_justices.map(j => `<option value="${j.id}" ${j.id === kase.presiding_justice_id ? 'selected' : ''}>${esc(nameOf(j.user_id))}</option>`).join('')}
          </select>
        </div>
      </div>` : ''}

    <div class="cg-section-label">Parties</div>
    <div id="ct-parties">
      ${(parties || []).length ? parties.map(p => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;">
          <span style="flex:1;">${esc(p.user_id ? nameOf(p.user_id) : '(unnamed)')}</span>
          <span class="ct-party-tag">${esc(PARTY_ROLE_LABEL[p.party_role] || p.party_role)}</span>
          ${_access.manage ? `<button class="btn btn-danger" data-remove-party="${p.id}">Remove</button>` : ''}
        </div>`).join('') : '<div class="cg-empty-state">No parties on record.</div>'}
    </div>
    ${_access.manage ? `
      <div class="cg-committee-add-row" style="display:flex;gap:8px;margin-top:8px;">
        <select id="ct-add-party-user"><option value="">Add party…</option>${_memberProfiles.map(p => `<option value="${p.id}">${esc(p.display_name || p.username)}</option>`).join('')}</select>
        <select id="ct-add-party-role" style="max-width:220px;">
          ${Object.entries(PARTY_ROLE_LABEL).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
        </select>
        <button class="btn btn-outline" id="ct-add-party-submit">Add</button>
      </div>` : ''}
    ${_access.isJustice && !iAmRecused ? `<button class="btn btn-danger" id="ct-self-recuse" style="margin-top:8px;">Recuse Myself From This Case</button>` : ''}
    ${iAmRecused ? `<div class="cg-vote-status">You have recused yourself from this case.</div>` : ''}

    <div class="cg-section-label">Filings</div>
    <div id="ct-filings">
      ${(filings || []).length ? filings.map(f => `
        <div class="cg-debate-post">
          <div class="cg-debate-meta"><strong>${esc(nameOf(f.filed_by))}</strong>
            <span class="cg-pos-tag">${esc(FILING_TYPE_LABEL[f.filing_type] || f.filing_type)}</span>
            <span>${fmtDate(f.created_at)}</span>${f.is_sealed ? '<span>(sealed)</span>' : ''}</div>
          <div style="font-weight:600;margin-bottom:4px;">${esc(f.title)}</div>
          <div class="cg-fulltext">${esc(f.body)}</div>
        </div>`).join('') : '<div class="cg-empty-state">No filings yet.</div>'}
    </div>
    ${canFile && isCaseOpen ? `
      <div class="form-group" style="margin-top:8px;">
        <div class="cg-post-row">
          <select id="ct-filing-type">${Object.entries(FILING_TYPE_LABEL).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
          <input class="form-input" id="ct-filing-title" placeholder="Filing title">
        </div>
        <textarea class="form-textarea" id="ct-filing-body" rows="3" placeholder="Filing text…"></textarea>
        <button class="btn btn-outline" id="ct-filing-submit" style="margin-top:6px;">Submit Filing</button>
      </div>` : ''}

    <div class="cg-section-label">Evidence &amp; Exhibits</div>
    <div id="ct-attachments">
      ${(attachments || []).length ? attachments.filter(a => !a.filing_id).map(a => `
        <div style="font-size:13px;padding:4px 0;">📎 <a href="${esc(safeUrl(a.file_url))}" target="_blank" rel="noopener noreferrer">${esc(a.file_name)}</a>
          <span class="cg-sub">uploaded by ${esc(nameOf(a.uploaded_by))} · ${fmtDate(a.created_at)}</span></div>`).join('') : '<div class="cg-empty-state">No exhibits attached.</div>'}
    </div>
    ${canFile && isCaseOpen ? `
      <div class="cg-post-row" style="margin-top:6px;">
        <input class="form-input" id="ct-exhibit-name" placeholder="Exhibit name">
        <input class="form-input" id="ct-exhibit-url" placeholder="Link (https://…)">
        <button class="btn btn-outline" id="ct-exhibit-submit">Attach</button>
      </div>` : ''}

    <div class="cg-section-label">Motions</div>
    <div id="ct-motions">
      ${(motions || []).length ? motions.map(mo => `
        <div class="cg-amendment">
          <div class="cg-amendment-head">
            <strong>${esc(motionTypeLabel(mo.motion_type_key))}</strong>
            <span class="cg-badge ${mo.status === 'adopted' ? 'decided' : mo.status === 'rejected' ? 'dismissed' : mo.status === 'withdrawn' ? 'withdrawn' : 'deliberation'}">${esc(mo.status)}</span>
          </div>
          <div style="font-size:12px;color:var(--muted);">by ${esc(nameOf(mo.raised_by))} · ${fmtDate(mo.created_at)}</div>
          ${mo.note ? `<div style="margin-top:4px;">${esc(mo.note)}</div>` : ''}
          ${_access.manage && mo.status === 'pending' ? `
            <div class="cg-amendment-actions">
              <button class="btn btn-outline" data-motion-resolve="${mo.id}" data-motion-status="adopted">Adopt</button>
              <button class="btn btn-outline" data-motion-resolve="${mo.id}" data-motion-status="rejected">Reject</button>
              <button class="btn btn-danger" data-motion-resolve="${mo.id}" data-motion-status="withdrawn">Withdraw</button>
            </div>` : ''}
        </div>`).join('') : '<div class="cg-empty-state">No motions raised.</div>'}
    </div>
    ${canFile && isCaseOpen && _motionTypes.filter(t => t.is_enabled).length ? `
      <div class="cg-post-row" style="margin-top:8px;">
        <select id="ct-motion-type">${_motionTypes.filter(t => t.is_enabled).map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}</select>
        <input class="form-input" id="ct-motion-note" placeholder="Note (optional)">
        <button class="btn btn-outline" id="ct-motion-submit">Raise Motion</button>
      </div>` : ''}

    ${voteBlockHtml}

    <div class="cg-section-label">Opinions</div>
    <div id="ct-opinions">
      ${(opinions || []).length ? opinions.map(o => `
        <div class="cg-debate-post">
          <div class="cg-debate-meta"><strong>${esc(nameOf(o.filed_by))}</strong>
            <span class="cg-pos-tag">${esc(o.opinion_type.replace('_', ' '))}</span>
            <span>${fmtDate(o.created_at)}</span>
            ${o.declares_unconstitutional ? '<span class="cg-badge dismissed">Declares Unconstitutional</span>' : ''}</div>
          ${o.title ? `<div style="font-weight:600;margin-bottom:4px;">${esc(o.title)}</div>` : ''}
          <div class="cg-fulltext">${esc(o.body)}</div>
        </div>`).join('') : '<div class="cg-empty-state">No opinions filed yet.</div>'}
    </div>
    ${(_access.isJustice || _access.manage) ? `
      <div class="form-group" style="margin-top:8px;">
        <div class="cg-post-row">
          <select id="ct-opinion-type">
            <option value="majority">Majority Opinion</option>
            <option value="concurrence">Concurrence</option>
            <option value="dissent">Dissent</option>
            <option value="per_curiam">Per Curiam</option>
          </select>
          <input class="form-input" id="ct-opinion-title" placeholder="Title (optional)">
        </div>
        <textarea class="form-textarea" id="ct-opinion-body" rows="4" placeholder="Opinion text…"></textarea>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin-top:6px;">
          <input type="checkbox" id="ct-opinion-unconstitutional"> This opinion declares the challenged measure unconstitutional
        </label>
        <button class="btn btn-outline" id="ct-opinion-submit" style="margin-top:6px;">File Opinion</button>
      </div>` : ''}

    <div class="cg-section-label">Arguments</div>
    <div id="ct-arguments">
      ${(args || []).length ? args.map(p => renderArgumentPost(p)).join('') : '<div class="cg-empty-state">No arguments submitted yet.</div>'}
    </div>
    ${canArgue && isCaseOpen ? `
      <div class="form-group" style="margin-top:1rem;">
        <div class="cg-post-row">
          <select id="ct-post-position"><option value="">No tag</option>${ARGUMENT_POSITIONS.map(p => `<option value="${p}">${p.replace('_', ' ')}</option>`).join('')}</select>
          <input class="form-input" id="ct-post-section" placeholder="Reference (optional)">
        </div>
        <textarea class="form-textarea" id="ct-new-post" rows="2" placeholder="Present an argument…" aria-label="Add argument"></textarea>
        <button class="btn btn-outline" id="ct-post-submit" style="margin-top:6px;">Post</button>
      </div>` : ''}
  `;

  const foot = document.getElementById('ct-modal-foot');
  const footBtns = [`<button class="btn btn-outline" id="ct-copy-link">Copy Link</button>`, `<button class="btn btn-outline" id="ct-print">Print / PDF</button>`];
  const noActiveRollCall = !activeRollCall || ['certified', 'voided'].includes(activeRollCall.status);
  if (_access.manage) {
    if (isCaseOpen && noActiveRollCall) footBtns.push(`<button class="btn btn-outline" id="ct-schedule-vote">Schedule &amp; Open Ruling Vote</button>`);
    if (activeRollCall && activeRollCall.status === 'open') footBtns.push(`<button class="btn btn-outline" id="ct-close-vote">Close Voting</button>`);
    if (activeRollCall && activeRollCall.status === 'closed' && _access.certify) footBtns.push(`<button class="btn btn-primary" id="ct-certify-vote">Certify Ruling</button>`);
  }
  foot.innerHTML = footBtns.join('');

  document.getElementById('ct-copy-link').onclick = () => {
    navigator.clipboard?.writeText(window.location.origin + window.location.pathname + '?case=' + kase.id);
  };
  document.getElementById('ct-print').onclick = () => window.print();

  // Case-level manage controls
  document.getElementById('ct-visibility') && (document.getElementById('ct-visibility').onchange = async (e) => {
    await supabase.from('court_cases').update({ visibility: e.target.value }).eq('id', kase.id);
    await loadCases();
  });
  document.getElementById('ct-presiding') && (document.getElementById('ct-presiding').onchange = async (e) => {
    await supabase.from('court_cases').update({ presiding_justice_id: e.target.value || null }).eq('id', kase.id);
    await loadCases();
  });

  // Parties
  document.getElementById('ct-add-party-submit') && (document.getElementById('ct-add-party-submit').onclick = async () => {
    const userId = document.getElementById('ct-add-party-user').value;
    if (!userId) return;
    const { error } = await supabase.from('court_case_parties').insert({
      case_id: kase.id, user_id: userId, party_role: document.getElementById('ct-add-party-role').value, added_by: _me.id,
    });
    if (error) showModalError(error.message); else openCase(kase.id);
  });
  document.querySelectorAll('button[data-remove-party]').forEach(btn => {
    btn.onclick = async () => { await supabase.from('court_case_parties').delete().eq('id', btn.dataset.removeParty); openCase(kase.id); };
  });
  document.getElementById('ct-self-recuse') && (document.getElementById('ct-self-recuse').onclick = async () => {
    const reason = prompt('Reason for recusal (optional):') || null;
    const { error } = await supabase.from('court_case_recusals').insert({ case_id: kase.id, user_id: _me.id, reason, recused_by: _me.id });
    if (error) showModalError(error.message); else openCase(kase.id);
  });

  // Filings
  document.getElementById('ct-filing-submit') && (document.getElementById('ct-filing-submit').onclick = async () => {
    const title = document.getElementById('ct-filing-title').value.trim();
    const body = document.getElementById('ct-filing-body').value.trim();
    if (!title || !body) { showModalError('A filing needs both a title and text.'); return; }
    const { error } = await supabase.from('court_filings').insert({
      case_id: kase.id, filing_type: document.getElementById('ct-filing-type').value, title, body, filed_by: _me.id,
    });
    if (error) showModalError(error.message); else openCase(kase.id);
  });

  // Exhibits
  document.getElementById('ct-exhibit-submit') && (document.getElementById('ct-exhibit-submit').onclick = async () => {
    const name = document.getElementById('ct-exhibit-name').value.trim();
    const url = document.getElementById('ct-exhibit-url').value.trim();
    if (!name || !safeUrl(url)) { showModalError('Provide an exhibit name and a valid http(s) link.'); return; }
    const { error } = await supabase.from('court_attachments').insert({ case_id: kase.id, file_name: name, file_url: url, uploaded_by: _me.id });
    if (error) showModalError(error.message); else openCase(kase.id);
  });

  // Motions
  document.getElementById('ct-motion-submit') && (document.getElementById('ct-motion-submit').onclick = async () => {
    const motionTypeKey = document.getElementById('ct-motion-type').value;
    const note = document.getElementById('ct-motion-note').value.trim() || null;
    const { error } = await supabase.from('court_motions').insert({ case_id: kase.id, motion_type_key: motionTypeKey, raised_by: _me.id, note });
    if (error) showModalError(error.message); else openCase(kase.id);
  });
  document.querySelectorAll('#ct-motions [data-motion-resolve]').forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.motionResolve, status = btn.dataset.motionStatus;
    const motion = (motions || []).find(m => m.id === id);
    await supabase.from('court_motions').update({ status, resolved_by: _me.id, resolved_at: new Date().toISOString() }).eq('id', id);
    if (status === 'adopted') {
      if (motion?.motion_type_key === 'recusal') {
        await supabase.from('court_case_recusals').insert({ case_id: kase.id, user_id: motion.raised_by, reason: motion.note, recused_by: _me.id });
      } else if (motion?.motion_type_key === 'motion_to_dismiss') {
        await supabase.rpc('court_transition_case_status', { p_case_id: kase.id, p_status_key: 'dismissed' });
      }
      await loadCases(); if (_access.manage) { await loadDashboardExtras(); renderDashboard(); renderLeadershipTools(); }
    }
    openCase(kase.id);
  });

  // Opinions
  document.getElementById('ct-opinion-submit') && (document.getElementById('ct-opinion-submit').onclick = async () => {
    const body = document.getElementById('ct-opinion-body').value.trim();
    if (!body) { showModalError('Opinion text is required.'); return; }
    const { error } = await supabase.from('court_opinions').insert({
      case_id: kase.id, opinion_type: document.getElementById('ct-opinion-type').value,
      title: document.getElementById('ct-opinion-title').value.trim() || null, body,
      declares_unconstitutional: document.getElementById('ct-opinion-unconstitutional').checked,
      filed_by: _me.id,
    });
    if (error) showModalError(error.message); else openCase(kase.id);
  });

  // Arguments
  document.getElementById('ct-post-submit') && (document.getElementById('ct-post-submit').onclick = async () => {
    const body = document.getElementById('ct-new-post').value.trim();
    if (!body) return;
    const { error } = await supabase.from('court_arguments').insert({
      case_id: kase.id, author_id: _me.id, body,
      position: document.getElementById('ct-post-position').value || null,
      section_ref: document.getElementById('ct-post-section').value.trim() || null,
    });
    if (!error) openCase(kase.id); else showModalError(error.message);
  });
  document.querySelectorAll('button[data-edit-post]').forEach(btn => btn.onclick = () => startEditPost(btn.dataset.editPost, args));
  document.querySelectorAll('button[data-archive-post]').forEach(btn => {
    btn.onclick = async () => {
      const reason = prompt('Reason for archiving this post (visible in the moderation audit log):');
      if (reason === null) return;
      const { error } = await supabase.from('court_arguments').update({
        is_archived: true, archived_by: _me.id, archived_reason: reason, archived_at: new Date().toISOString(),
      }).eq('id', btn.dataset.archivePost);
      if (error) showModalError(error.message); else openCase(kase.id);
    };
  });

  // Ruling vote actions
  document.getElementById('ct-close-vote') && (document.getElementById('ct-close-vote').onclick = async () => {
    const { error } = await supabase.rpc('court_close_roll_call', { p_roll_call_id: activeRollCall.id });
    if (!error) openCase(kase.id); else showModalError(error.message);
  });
  document.getElementById('ct-certify-vote') && (document.getElementById('ct-certify-vote').onclick = async () => {
    const { error } = await supabase.rpc('court_certify_roll_call', { p_roll_call_id: activeRollCall.id, p_note: 'Certified via portal' });
    if (!error) { openCase(kase.id); await loadCases(); renderDocketList(); renderDashboard(); renderArchive(); } else showModalError(error.message);
  });
  document.getElementById('ct-schedule-vote') && (document.getElementById('ct-schedule-vote').onclick = async () => {
    const question = prompt('Question for the roll call:', `On the disposition of ${kase.number || kase.title}`);
    if (!question) return;
    const optionsRaw = prompt('Vote options, comma-separated:', 'for_petitioner, for_respondent, dismiss');
    if (!optionsRaw) return;
    const options = optionsRaw.split(',').map(s => s.trim()).filter(Boolean);
    const { data: rc, error } = await supabase.from('court_roll_calls').insert({
      case_id: kase.id, question, vote_options: options,
      threshold_numerator: kase.threshold_numerator, threshold_denominator: kase.threshold_denominator,
      quorum_numerator: kase.quorum_numerator, quorum_denominator: kase.quorum_denominator,
      created_by: _me.id,
    }).select().single();
    if (error) { showModalError(error.message); return; }
    const { error: openErr } = await supabase.rpc('court_open_roll_call', { p_roll_call_id: rc.id });
    if (openErr) { showModalError(openErr.message); return; }
    await loadCases(); renderDashboard(); renderDocketList();
    openCase(kase.id);
  });

  document.getElementById('ct-case-modal').classList.add('open');
}

function renderArgumentPost(p) {
  const canEdit = p.author_id === _me.id && !p.is_archived;
  const canModerate = _access.moderate || _access.manage;
  return `
    <div class="cg-debate-post" data-post-id="${p.id}">
      <div class="cg-debate-meta">
        <strong>${esc(nameOf(p.author_id))}</strong>
        ${p.position ? `<span class="cg-pos-tag">${esc(p.position.replace('_', ' '))}</span>` : ''}
        ${p.section_ref ? `<span>${esc(p.section_ref)}</span>` : ''}
        ${p.is_edited ? '<span>(edited)</span>' : ''}
        <span class="cg-debate-actions">
          ${canEdit ? `<button data-edit-post="${p.id}">Edit</button>` : ''}
          ${canModerate && !p.is_archived ? `<button class="danger" data-archive-post="${p.id}">Archive</button>` : ''}
        </span>
      </div>
      <div data-post-body="${p.id}">${esc(p.body)}</div>
    </div>`;
}

function startEditPost(postId, posts) {
  const post = posts.find(p => p.id === postId);
  const bodyEl = document.querySelector(`[data-post-body="${postId}"]`);
  if (!post || !bodyEl) return;
  bodyEl.innerHTML = `<textarea class="form-textarea" rows="2">${esc(post.body)}</textarea><button class="btn btn-outline" style="margin-top:6px;">Save</button>`;
  bodyEl.querySelector('button').onclick = async () => {
    const newBody = bodyEl.querySelector('textarea').value.trim();
    if (!newBody) return;
    const { error } = await supabase.from('court_arguments').update({ body: newBody, is_edited: true, edited_at: new Date().toISOString() }).eq('id', postId);
    if (error) showModalError(error.message); else openCase(_currentCase.id);
  };
}

async function renderVoteBlock(rollCall) {
  let myVote = null, myEligibility = null;
  if (rollCall.status !== 'scheduled') {
    const [{ data: vote }, { data: elig }] = await Promise.all([
      supabase.from('court_votes').select('choice').eq('roll_call_id', rollCall.id).eq('user_id', _me.id).maybeSingle(),
      supabase.from('court_roll_call_eligibility').select('is_eligible').eq('roll_call_id', rollCall.id).eq('user_id', _me.id).maybeSingle(),
    ]);
    myVote = vote?.choice || null;
    myEligibility = elig?.is_eligible || false;
  }
  const options = Array.isArray(rollCall.vote_options) ? rollCall.vote_options : JSON.parse(rollCall.vote_options || '[]');

  let tallyHtml = '';
  if (rollCall.visibility === 'live' && ['open', 'closed', 'certified'].includes(rollCall.status)) {
    const { data: tally } = await supabase.rpc('court_roll_call_tally', { p_roll_call_id: rollCall.id });
    if (tally && tally.length) {
      tallyHtml = `<div class="cg-tally">${tally.map(t => `
        <div class="cg-tally-cell"><div class="n">${t.vote_count}</div><div class="l">${esc(t.choice)}</div></div>
      `).join('')}</div>
      <div class="cg-vote-status">Cast: ${tally[0].total_cast} / Eligible: ${tally[0].total_eligible} · Quorum ${tally[0].quorum_met ? 'met' : 'not met'}</div>`;
    }
  }

  const canVote = rollCall.status === 'open' && myEligibility;
  return `
    <div class="cg-section-label">Ruling Vote — ${esc(rollCall.question)}</div>
    <div style="font-size:12px;color:var(--muted);">Status: ${esc(rollCall.status)} · Visibility: ${esc(rollCall.visibility)}</div>
    ${canVote ? `
      <div class="cg-vote-options">
        ${options.map(o => `<button class="btn ${myVote === o ? 'btn-primary' : 'btn-outline'}" data-vote="${esc(o)}">${esc(o)}</button>`).join('')}
      </div>
      <div class="cg-vote-status">${myVote ? `Your recorded vote: <strong>${esc(myVote)}</strong>${rollCall.allow_vote_changes ? ' (you may change it while voting is open)' : ''}` : 'You have not voted yet.'}</div>
    ` : rollCall.status === 'open' ? `<div class="cg-vote-status">You are not an eligible voter for this ruling.</div>` : ''}
    ${tallyHtml}
    <div id="ct-vote-rc-id" data-id="${rollCall.id}"></div>
  `;
}

function showModalError(msg) {
  const el = document.getElementById('ct-modal-error');
  el.textContent = msg; el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

document.getElementById('ct-modal-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-vote]');
  if (!btn) return;
  const rcId = document.getElementById('ct-vote-rc-id')?.dataset.id;
  if (!rcId) return;
  const { error } = await supabase.rpc('court_cast_vote', { p_roll_call_id: rcId, p_choice: btn.dataset.vote });
  if (error) showModalError(error.message);
  else openCase(_currentCase.id);
});

function bindModals() {
  const closeCaseModal = () => { document.getElementById('ct-case-modal').classList.remove('open'); window.history.replaceState(null, '', window.location.pathname); };
  document.getElementById('ct-modal-close').onclick = closeCaseModal;
  document.getElementById('ct-case-modal').addEventListener('click', (e) => { if (e.target.id === 'ct-case-modal') closeCaseModal(); });

  document.getElementById('btn-new-case').onclick = async () => {
    if (!_memberProfiles.length) await loadMemberDirectory();
    document.getElementById('ct-new-case-modal').classList.add('open');
  };
  document.getElementById('ct-new-close').onclick = () => document.getElementById('ct-new-case-modal').classList.remove('open');
  document.getElementById('nc-cancel').onclick = () => document.getElementById('ct-new-case-modal').classList.remove('open');
  document.getElementById('ct-new-case-modal').addEventListener('click', (e) => { if (e.target.id === 'ct-new-case-modal') e.currentTarget.classList.remove('open'); });

  document.getElementById('nc-submit').onclick = async () => {
    const title = document.getElementById('nc-title').value.trim();
    const errEl = document.getElementById('nc-error');
    errEl.style.display = 'none';
    if (!title) { errEl.textContent = 'A case title is required.'; errEl.style.display = 'block'; return; }
    const typeKey = document.getElementById('nc-type').value;
    const typeInfo = _types.find(t => t.key === typeKey);
    const { data: kase, error } = await supabase.from('court_cases').insert({
      type_key: typeKey,
      title,
      summary: document.getElementById('nc-summary').value.trim() || null,
      related_measure_id: document.getElementById('nc-measure').value || null,
      threshold_numerator: typeInfo?.default_threshold_numerator || 1,
      threshold_denominator: typeInfo?.default_threshold_denominator || 2,
      created_by: _me.id,
    }).select().single();
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    await supabase.from('court_case_parties').insert({ case_id: kase.id, user_id: _me.id, party_role: 'petitioner', added_by: _me.id });
    const complaint = document.getElementById('nc-text').value.trim();
    if (complaint) {
      await supabase.from('court_filings').insert({ case_id: kase.id, filing_type: 'complaint', title: 'Initial Complaint', body: complaint, filed_by: _me.id });
    }
    document.getElementById('ct-new-case-modal').classList.remove('open');
    ['nc-title', 'nc-summary', 'nc-text'].forEach(id => document.getElementById(id).value = '');
    await loadCases();
    renderDashboard(); renderDocketList(); renderArchive();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.getElementById('ct-case-modal').classList.remove('open');
    document.getElementById('ct-new-case-modal').classList.remove('open');
  });
}

init();
