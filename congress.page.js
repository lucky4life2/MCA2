import { supabase } from './supabase.js';

let _me = null;
let _access = { manage: false, sponsor: false, certify: false, moderate: false, chambers: new Set() };
let _chambers = [], _types = [], _statuses = [];
let _measures = [];
let _committees = [], _committeeMembers = [], _memberProfiles = [];
let _calendarEvents = [], _congressMembers = [], _notifications = [], _pendingCertifications = [], _returns = [];
let _motionTypes = [];
let _calendarAllEvents = [];
let _currentMeasure = null;
let _archiveFiltered = [];
const POSITIONS = ['support', 'oppose', 'neutral', 'question', 'sponsor_statement', 'committee_report'];

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Allow-lists http(s) and relative URLs before anything navigates the page to
// them; blocks javascript: and other schemes. Needed because dataset reads
// back HTML-entity-decoded values, so esc() alone doesn't protect a nav sink.
function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^https?:\/\//i.test(u) ? u : '';
  return u;
}

// ── Member name directory ────────────────────────────────────
// profiles is readable only by yourself or staff — it holds emails and
// verification tokens — so embedding profiles(display_name, username) came
// back null for ordinary members and every name on this page rendered as the
// literal word "Member". public_profiles is a view exposing only
// id/username/display_name, which is safe for any signed-in member to read.
let _directory = null;

async function loadDirectory() {
  if (_directory) return _directory;
  const { data, error } = await supabase
    .from('public_profiles').select('id, username, display_name');
  if (error) { console.error('loadDirectory failed:', error.message); return new Map(); }
  _directory = new Map((data || []).map(p => [p.id, p.display_name || p.username]));
  return _directory;
}

// Resolve a user id to a display name. `fallback` is what to show when the id
// is null or unknown (a deleted account, say) — never a silent blank.
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
  const [{ data: manage }, { data: sponsor }, { data: certify }, { data: moderate }, { data: memberships }] = await Promise.all([
    supabase.rpc('user_has_permission', { perm: 'can_manage_congress' }),
    supabase.rpc('user_has_permission', { perm: 'can_sponsor_congress_legislation' }),
    supabase.rpc('user_has_permission', { perm: 'can_certify_congress_votes' }),
    supabase.rpc('user_has_permission', { perm: 'can_moderate_congress_debate' }),
    supabase.from('congress_members').select('chamber_id').eq('user_id', _me.id).eq('status', 'active'),
  ]);
  return {
    manage: manage === true,
    sponsor: sponsor === true,
    certify: certify === true,
    moderate: moderate === true,
    chambers: new Set((memberships || []).map(m => m.chamber_id)),
  };
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return show('denied');
  _me = session.user;
  _access = await resolveAccess();
  // Loaded once up front so every render below can resolve names synchronously.
  await loadDirectory();
  // View access: any authenticated member can view public/members-visible content;
  // page itself doesn't gate on chamber membership so the public can browse what's public.
  document.getElementById('btn-new-measure').style.display = (_access.manage || _access.sponsor) ? '' : 'none';

  const [{ data: chambers }, { data: types }, { data: statuses }, { data: motionTypes }] = await Promise.all([
    supabase.from('congress_chambers').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('congress_lookups').select('*').eq('kind', 'measure_type').eq('is_enabled', true).order('sort_order'),
    supabase.from('congress_lookups').select('*').eq('kind', 'measure_status').order('sort_order'),
    supabase.from('congress_lookups').select('*').eq('kind', 'motion_type').order('sort_order'),
  ]);
  _chambers = chambers || []; _types = types || []; _statuses = statuses || []; _motionTypes = motionTypes || [];
  populateFilters();
  populateNewMeasureForm();
  populateNewCommitteeForm();
  document.getElementById('btn-new-committee').style.display = _access.manage ? '' : 'none';
  document.getElementById('cg-tab-leadership').style.display = _access.manage ? '' : 'none';

  show('main');
  bindTabs();
  bindModals();
  bindCommitteeModal();
  await Promise.all([loadMeasures(), loadCommittees(), loadDashboardExtras()]);
  renderDashboard();
  renderMeasureList();
  renderArchive();
  renderCommittees();
  if (_access.manage) { await loadReturns(); await loadCalendarAll(); renderLeadershipTools(); bindLeadershipTools(); }

  const deepLinkId = new URLSearchParams(location.search).get('measure');
  if (deepLinkId) openMeasure(deepLinkId);
}

function populateFilters() {
  const chSel = document.getElementById('cg-filter-chamber');
  _chambers.forEach(c => chSel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${esc(c.label)}</option>`));
  const stSel = document.getElementById('cg-filter-status');
  _statuses.forEach(s => stSel.insertAdjacentHTML('beforeend', `<option value="${s.key}">${esc(s.label)}</option>`));
  chSel.onchange = renderMeasureList;
  stSel.onchange = renderMeasureList;

  const arCh = document.getElementById('ar-chamber');
  _chambers.forEach(c => arCh.insertAdjacentHTML('beforeend', `<option value="${c.id}">${esc(c.label)}</option>`));
  const arType = document.getElementById('ar-type');
  _types.forEach(t => arType.insertAdjacentHTML('beforeend', `<option value="${t.key}">${esc(t.label)}</option>`));
  const arStatus = document.getElementById('ar-status');
  ARCHIVE_STATUSES.forEach(key => arStatus.insertAdjacentHTML('beforeend', `<option value="${key}">${esc(statusLabel(key))}</option>`));
  ['ar-chamber', 'ar-type', 'ar-status', 'ar-from', 'ar-to', 'ar-keyword'].forEach(id => document.getElementById(id).oninput = renderArchive);
  document.getElementById('ar-export').onclick = exportArchiveCsv;
}

function populateNewMeasureForm() {
  document.getElementById('nm-type').innerHTML = _types.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('');
  document.getElementById('nm-chamber').innerHTML = _chambers.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
}

function populateNewCommitteeForm() {
  document.getElementById('nc-chamber').insertAdjacentHTML('beforeend', _chambers.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join(''));
}

function bindTabs() {
  document.querySelectorAll('.cg-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.cg-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
      ['dashboard', 'legislation', 'committees', 'archive', 'leadership'].forEach(t => {
        document.getElementById('tab-' + t).style.display = (t === btn.dataset.tab) ? '' : 'none';
      });
    };
  });
}

// ── Committees ──────────────────────────────────────────────────
async function loadCommittees() {
  const [{ data: committees }, { data: members }] = await Promise.all([
    supabase.from('congress_committees').select('*').eq('is_active', true).order('name'),
    supabase.from('congress_committee_members').select('*'),
  ]);
  _committees = committees || [];
  _committeeMembers = members || [];
}

function renderCommittees() {
  const el = document.getElementById('cg-committee-list');
  if (!_committees.length) { el.innerHTML = `<div class="cg-empty-state">No committees yet.</div>`; return; }
  el.innerHTML = _committees.map(c => {
    const members = _committeeMembers.filter(m => m.committee_id === c.id);
    return `
    <div class="cg-card cg-committee-card" data-committee="${c.id}">
      <h3>${esc(c.name)}${c.chamber_id ? ` · ${esc(chamberLabel(c.chamber_id))}` : ' · Joint'}</h3>
      ${c.description ? `<p style="font-size:12px;color:var(--mid);margin:0 0 6px;">${esc(c.description)}</p>` : ''}
      <ul>
        ${members.length ? members.map(m => `
          <li><span>${esc(nameOf(m.user_id))}</span>
            <span class="cg-committee-role">${esc(m.role)}${_access.manage ? ` · <a href="#" data-remove-member="${m.id}">remove</a>` : ''}</span></li>
        `).join('') : `<li class="cg-empty">No members assigned.</li>`}
      </ul>
      ${_access.manage ? `
        <div class="cg-committee-add-row">
          <select data-add-user="${c.id}">
            <option value="">Add member…</option>
            ${_memberProfiles.map(p => `<option value="${p.id}">${esc(p.display_name || p.username)}</option>`).join('')}
          </select>
          <select data-add-role="${c.id}" style="max-width:110px;">
            <option value="member">Member</option>
            <option value="vice_chair">Vice Chair</option>
            <option value="chair">Chair</option>
          </select>
        </div>` : ''}
    </div>`;
  }).join('');

  el.querySelectorAll('select[data-add-user]').forEach(sel => {
    sel.onchange = async () => {
      const committeeId = sel.dataset.addUser;
      const userId = sel.value;
      if (!userId) return;
      const role = el.querySelector(`select[data-add-role="${committeeId}"]`).value;
      const { error } = await supabase.from('congress_committee_members').insert({ committee_id: committeeId, user_id: userId, role, added_by: _me.id });
      if (!error) { await loadCommittees(); renderCommittees(); }
      sel.value = '';
    };
  });
  el.querySelectorAll('a[data-remove-member]').forEach(a => {
    a.onclick = async (e) => {
      e.preventDefault();
      await supabase.from('congress_committee_members').delete().eq('id', a.dataset.removeMember);
      await loadCommittees(); renderCommittees();
    };
  });
}

function bindCommitteeModal() {
  document.getElementById('btn-new-committee').onclick = async () => {
    // lazy-load member directory the first time it's needed
    if (!_memberProfiles.length) {
      const { data } = await supabase.from('public_profiles').select('id, display_name, username').order('display_name');
      _memberProfiles = data || [];
    }
    document.getElementById('cg-new-committee-modal').classList.add('open');
  };
  document.getElementById('cg-nc-close').onclick = () => document.getElementById('cg-new-committee-modal').classList.remove('open');
  document.getElementById('nc-cancel').onclick = () => document.getElementById('cg-new-committee-modal').classList.remove('open');
  document.getElementById('cg-new-committee-modal').addEventListener('click', (e) => { if (e.target.id === 'cg-new-committee-modal') e.currentTarget.classList.remove('open'); });
  document.getElementById('nc-submit').onclick = async () => {
    const name = document.getElementById('nc-name').value.trim();
    const key = document.getElementById('nc-key').value.trim();
    const errEl = document.getElementById('nc-error');
    errEl.style.display = 'none';
    if (!name || !key) { errEl.textContent = 'Name and key are both required.'; errEl.style.display = 'block'; return; }
    const { error } = await supabase.from('congress_committees').insert({
      name, key, chamber_id: document.getElementById('nc-chamber').value || null,
      description: document.getElementById('nc-desc').value.trim() || null,
      created_by: _me.id,
    });
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    document.getElementById('cg-new-committee-modal').classList.remove('open');
    ['nc-name', 'nc-key', 'nc-desc'].forEach(id => document.getElementById(id).value = '');
    await loadCommittees(); renderCommittees();
  };
}

// ── Dashboard data (calendar, roster/attendance, notifications, pending certs) ──
async function loadDashboardExtras() {
  const nowIso = new Date().toISOString();
  const [{ data: events }, { data: members }, { data: notes }, { data: pendingCerts }] = await Promise.all([
    supabase.from('congress_calendar_events').select('*').eq('is_cancelled', false).order('starts_at'),
    supabase.from('congress_members').select('*'),
    supabase.from('congress_notifications').select('*').eq('user_id', _me.id).eq('is_read', false).order('created_at', { ascending: false }).limit(10),
    (_access.manage || _access.certify)
      ? supabase.from('congress_roll_calls').select('id, question, closes_at, measure_id, congress_measures(number, title)').eq('status', 'closed').order('closes_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  _calendarEvents = (events || []).filter(e => (e.ends_at || e.starts_at) >= nowIso);
  _congressMembers = members || [];
  _notifications = notes || [];
  _pendingCertifications = pendingCerts || [];
}

async function dismissNotification(id) {
  await supabase.from('congress_notifications').update({ is_read: true }).eq('id', id);
  _notifications = _notifications.filter(n => n.id !== id);
  renderDashboard();
}

// ── Leadership Tools: presidential action, return-for-correction, roster ──
async function loadReturns() {
  const { data } = await supabase.from('congress_returns').select('*, congress_measures(number, title)').order('returned_at', { ascending: false }).limit(15);
  _returns = data || [];
}

async function loadCalendarAll() {
  const { data } = await supabase.from('congress_calendar_events').select('*').order('starts_at', { ascending: false }).limit(30);
  _calendarAllEvents = data || [];
}

function renderLeadershipTools() {
  const passed = _measures.filter(m => m.status_key === 'passed');
  document.getElementById('cg-lt-passed').innerHTML = passed.length ? passed.map(m => `
    <div class="cg-row" style="cursor:default;">
      <span class="cg-row-number">${esc(m.number || 'Draft')}</span>
      <span class="cg-row-title">${esc(m.title)}</span>
      <span style="display:flex;gap:8px;">
        <button class="btn btn-primary" data-sign="${m.id}">Sign</button>
        <button class="btn btn-danger" data-veto="${m.id}">Veto</button>
      </span>
    </div>`).join('') : `<div class="cg-empty-state">Nothing awaiting signature.</div>`;

  const returnable = _measures.filter(m => ['passed', 'enacted', 'failed'].includes(m.status_key));
  document.getElementById('cg-lt-returnable').innerHTML = returnable.length ? returnable.map(m => `
    <div class="cg-row" style="cursor:default;">
      <span class="cg-row-number">${esc(m.number || 'Draft')}</span>
      <span class="cg-row-title">${esc(m.title)} <span class="cg-badge ${esc(m.status_key)}">${esc(statusLabel(m.status_key))}</span></span>
      <button class="btn btn-outline" data-return="${m.id}">Return for Correction</button>
    </div>`).join('') : `<div class="cg-empty-state">Nothing eligible for return right now.</div>`;

  document.getElementById('cg-lt-returns-log').innerHTML = _returns.length ? `
    <div class="cg-section-label">Recent Returns</div>
    <div class="cg-list">${_returns.map(r => `
      <div class="cg-row" style="cursor:default;">
        <span class="cg-row-number">${esc(r.congress_measures?.number || 'Draft')}</span>
        <span class="cg-row-title">${esc(r.reason)}<span class="cg-sub" style="display:block;">by ${esc(nameOf(r.returned_by, '—'))} · ${fmtDate(r.returned_at)}</span></span>
      </div>`).join('')}</div>` : '';

  const rosters = document.getElementById('cg-lt-rosters');
  rosters.innerHTML = _chambers.map(c => `
    <div class="cg-card" style="margin-bottom:12px;">
      <h3>${esc(c.label)}</h3>
      ${_congressMembers.filter(m => m.chamber_id === c.id).map(m => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;">
          <span style="flex:1;">${esc(nameOf(m.user_id))}${m.seat_label ? ` <span class="cg-sub">(${esc(m.seat_label)})</span>` : ''}</span>
          <select data-member-status="${m.id}">
            ${['active', 'absent', 'excused', 'recused', 'vacant', 'ineligible'].map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>`).join('') || `<div class="cg-empty">No members seated.</div>`}
    </div>`).join('');

  const chSel = document.getElementById('lt-add-chamber');
  if (!chSel.dataset.filled) { chSel.innerHTML = _chambers.map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join(''); chSel.dataset.filled = '1'; }

  document.getElementById('cg-lt-motion-types').innerHTML = _motionTypes.map(t => `
    <div class="cg-card" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;">
      <span style="font-size:13px;font-weight:600;">${esc(t.label)}</span>
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);">
        <input type="checkbox" data-motion-type-toggle="${t.key}" ${t.is_enabled ? 'checked' : ''}> Enabled
      </label>
    </div>`).join('');

  document.getElementById('cg-lt-calendar').innerHTML = _calendarAllEvents.length ? _calendarAllEvents.map(e => `
    <div class="cg-row" style="cursor:default;">
      <span class="cg-row-number">${fmtDate(e.starts_at)}</span>
      <span class="cg-row-title">${esc(EVENT_TYPE_LABEL[e.event_type] || e.event_type)} — ${esc(e.title)}${e.is_cancelled ? ' <span class="cg-badge withdrawn">Cancelled</span>' : ''}</span>
      ${!e.is_cancelled ? `<button class="btn btn-danger" data-cal-cancel="${e.id}">Cancel</button>` : ''}
    </div>`).join('') : `<div class="cg-empty-state">No calendar events yet.</div>`;
}

async function loadMemberDirectory() {
  if (_memberProfiles.length) return;
  const { data } = await supabase.from('public_profiles').select('id, display_name, username').order('display_name');
  _memberProfiles = data || [];
  document.getElementById('lt-add-user').innerHTML = `<option value="">Add member…</option>` + _memberProfiles.map(p => `<option value="${p.id}">${esc(p.display_name || p.username)}</option>`).join('');
}

function bindLeadershipTools() {
  loadMemberDirectory();
  document.getElementById('cg-lt-passed').onclick = async (e) => {
    const signId = e.target.dataset.sign, vetoId = e.target.dataset.veto;
    if (signId) {
      if (!confirm('Sign this measure into law?')) return;
      await supabase.from('congress_measures').update({ status_key: 'enacted', signed_by: _me.id, signed_at: new Date().toISOString() }).eq('id', signId);
    } else if (vetoId) {
      const note = prompt('Veto explanation (required):');
      if (!note) return;
      await supabase.from('congress_measures').update({ status_key: 'vetoed', vetoed_by: _me.id, vetoed_at: new Date().toISOString(), veto_note: note }).eq('id', vetoId);
    } else return;
    await loadMeasures(); renderLeadershipTools(); renderDashboard(); renderMeasureList(); renderArchive();
  };
  document.getElementById('cg-lt-returnable').onclick = async (e) => {
    const id = e.target.dataset.return;
    if (!id) return;
    const reason = prompt('Reason for returning this measure for correction (required):');
    if (!reason) return;
    const measure = _measures.find(m => m.id === id);
    await supabase.from('congress_returns').insert({ measure_id: id, returned_by: _me.id, from_status: measure.status_key, reason });
    await supabase.from('congress_measures').update({ status_key: 'committee' }).eq('id', id);
    await Promise.all([loadMeasures(), loadReturns()]);
    renderLeadershipTools(); renderDashboard(); renderMeasureList(); renderArchive();
  };
  document.getElementById('cg-lt-rosters').onchange = async (e) => {
    const memberId = e.target.dataset.memberStatus;
    if (!memberId) return;
    await supabase.from('congress_members').update({ status: e.target.value, status_set_by: _me.id, status_set_at: new Date().toISOString() }).eq('id', memberId);
    await loadDashboardExtras(); renderLeadershipTools(); renderDashboard();
  };
  document.getElementById('lt-add-user').onchange = async (e) => {
    const userId = e.target.value;
    if (!userId) return;
    const chamberId = document.getElementById('lt-add-chamber').value;
    const seatLabel = document.getElementById('lt-add-seat').value.trim() || null;
    await supabase.from('congress_members').insert({ chamber_id: chamberId, user_id: userId, seat_label: seatLabel, created_by: _me.id });
    e.target.value = ''; document.getElementById('lt-add-seat').value = '';
    await loadDashboardExtras(); renderLeadershipTools(); renderDashboard();
  };
  document.getElementById('cg-lt-motion-types').onchange = async (e) => {
    const key = e.target.dataset.motionTypeToggle;
    if (!key) return;
    await supabase.from('congress_lookups').update({ is_enabled: e.target.checked }).eq('kind', 'motion_type').eq('key', key);
    const { data } = await supabase.from('congress_lookups').select('*').eq('kind', 'motion_type').order('sort_order');
    _motionTypes = data || [];
  };
  document.getElementById('cal-submit').onclick = async () => {
    const title = document.getElementById('cal-title').value.trim();
    const starts = document.getElementById('cal-starts').value;
    if (!title || !starts) { alert('Title and start time are required.'); return; }
    await supabase.from('congress_calendar_events').insert({
      event_type: document.getElementById('cal-type').value, title,
      starts_at: new Date(starts).toISOString(),
      location: document.getElementById('cal-location').value.trim() || null,
      created_by: _me.id,
    });
    ['cal-title', 'cal-starts', 'cal-location'].forEach(id => document.getElementById(id).value = '');
    await Promise.all([loadCalendarAll(), loadDashboardExtras()]); renderLeadershipTools(); renderDashboard();
  };
  document.getElementById('cg-lt-calendar').onclick = async (e) => {
    const id = e.target.dataset.calCancel;
    if (!id) return;
    await supabase.from('congress_calendar_events').update({ is_cancelled: true, cancelled_reason: prompt('Reason (optional):') || null }).eq('id', id);
    await Promise.all([loadCalendarAll(), loadDashboardExtras()]); renderLeadershipTools(); renderDashboard();
  };
}

async function loadMeasures() {
  const { data, error } = await supabase
    .from('congress_measures')
    .select('*, congress_measure_sponsors(user_id, sponsor_type)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); _measures = []; return; }
  _measures = data || [];
}

function chamberLabel(id) { return _chambers.find(c => c.id === id)?.label || '—'; }
function statusLabel(key) { return _statuses.find(s => s.key === key)?.label || key; }
function typeLabel(key) { return _types.find(t => t.key === key)?.label || key; }
function motionTypeLabel(key) { return _motionTypes.find(t => t.key === key)?.label || key; }

const EVENT_TYPE_LABEL = { session: 'Session', committee_meeting: 'Committee Meeting', hearing: 'Hearing', deadline: 'Deadline', special_session: 'Special Session' };
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }

function upcomingItems() {
  const items = [];
  _calendarEvents.forEach(e => items.push({ when: e.starts_at, label: `${EVENT_TYPE_LABEL[e.event_type] || 'Event'}: ${e.title}`, sub: e.location || '' }));
  _measures.forEach(m => {
    if (m.debate_opens_at && m.debate_opens_at >= new Date().toISOString() && m.status_key !== 'debate') items.push({ when: m.debate_opens_at, label: `Debate opens — ${m.number || 'Draft'}`, sub: m.title, measureId: m.id });
    if (m.vote_opens_at && m.vote_opens_at >= new Date().toISOString() && m.status_key !== 'voting') items.push({ when: m.vote_opens_at, label: `Vote opens — ${m.number || 'Draft'}`, sub: m.title, measureId: m.id });
    if (m.vote_closes_at && m.status_key === 'voting') items.push({ when: m.vote_closes_at, label: `Vote deadline — ${m.number || 'Draft'}`, sub: m.title, measureId: m.id });
  });
  return items.sort((a, b) => a.when.localeCompare(b.when)).slice(0, 8);
}

function renderDashboard() {
  const grid = document.getElementById('cg-dashboard-grid');
  const votingNow = _measures.filter(m => m.status_key === 'voting');
  const underDebate = _measures.filter(m => m.status_key === 'debate');
  const mySponsored = _measures.filter(m => m.created_by === _me.id || (m.congress_measure_sponsors || []).some(s => s.user_id === _me.id));
  const recent = _measures.slice(0, 6);
  const upcoming = upcomingItems();

  const measureCards = [
    ['Open Votes', votingNow],
    ['Measures Under Debate', underDebate],
    ['Your Sponsored Measures', mySponsored],
    ['Recent Activity', recent],
  ].map(([title, list]) => `
    <div class="cg-card">
      <h3>${esc(title)}</h3>
      ${list.length ? `<ul>${list.slice(0, 6).map(m => `
        <li><a href="#" data-measure="${m.id}">${esc(m.number || 'Draft')} — ${esc(m.title)}
          <span class="cg-sub">${esc(chamberLabel(m.chamber_id))} · ${esc(statusLabel(m.status_key))}</span></a></li>
      `).join('')}</ul>` : `<div class="cg-empty">Nothing here right now.</div>`}
    </div>`).join('');

  const upcomingCard = `
    <div class="cg-card">
      <h3>Upcoming</h3>
      ${upcoming.length ? `<ul>${upcoming.map(i => `
        <li>${i.measureId ? `<a href="#" data-measure="${i.measureId}">${esc(i.label)}</a>` : `<span style="font-weight:600;">${esc(i.label)}</span>`}
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

  const attendanceCard = `
    <div class="cg-card">
      <h3>Attendance &amp; Chamber Status</h3>
      ${_chambers.length ? `<ul>${_chambers.map(c => {
        const roster = _congressMembers.filter(m => m.chamber_id === c.id);
        const active = roster.filter(m => m.status === 'active').length;
        const quorumNeeded = Math.ceil(roster.length * c.quorum_numerator / c.quorum_denominator);
        const met = active >= quorumNeeded;
        const notable = roster.filter(m => m.status !== 'active');
        return `<li><span style="font-weight:600;">${esc(c.label)}</span>
          <span class="cg-sub">${active}/${roster.length} active · quorum ${quorumNeeded} · <span style="color:${met ? 'var(--green,#2d7d2f)' : '#c0392b'};font-weight:600;">${met ? 'Quorum met' : 'No quorum'}</span>
          ${notable.length ? '<br>' + notable.map(m => `${esc(nameOf(m.user_id))} (${esc(m.status)})`).join(', ') : ''}</span></li>`;
      }).join('')}</ul>` : `<div class="cg-empty">No chambers configured.</div>`}
    </div>`;

  const quickActionsCard = (_access.manage || _access.certify) ? `
    <div class="cg-card">
      <h3>Quick Leadership Actions</h3>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${_access.manage ? `<button class="btn btn-outline" id="qa-new-measure">+ Docket a Measure</button>` : ''}
        ${_access.manage ? `<button class="btn btn-outline" id="qa-new-committee">+ New Committee</button>` : ''}
        ${_pendingCertifications.length ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">${_pendingCertifications.length} vote${_pendingCertifications.length === 1 ? '' : 's'} awaiting certification:</div>
          <ul>${_pendingCertifications.slice(0, 5).map(rc => `<li><a href="#" data-measure="${rc.measure_id}">${esc(rc.congress_measures?.number || 'Draft')} — ${esc(rc.question)}</a></li>`).join('')}</ul>` : ''}
      </div>
    </div>` : '';

  grid.innerHTML = upcomingCard + notifCard + quickActionsCard + attendanceCard + measureCards + `
    <div class="cg-card">
      <h3>Your Standing</h3>
      <div style="font-size:13px;line-height:1.7;">
        Chamber seats: ${_access.chambers.size ? [..._access.chambers].map(chamberLabel).join(', ') : '<span class="cg-empty">None on record</span>'}<br>
        ${_access.sponsor || _access.manage ? '✓ Can sponsor legislation' : ''}<br>
        ${_access.manage ? '✓ Congress management access' : ''}
      </div>
    </div>`;

  grid.querySelectorAll('a[data-measure]').forEach(a => a.onclick = (e) => { e.preventDefault(); openMeasure(a.dataset.measure); });
  grid.querySelectorAll('a[data-dismiss-notif]').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    if (a.dataset.notifLink) {
      const target = safeUrl(a.dataset.notifLink);
      if (target) window.location.href = target;
    }
    dismissNotification(a.dataset.dismissNotif);
  });
  const qaMeasure = document.getElementById('qa-new-measure');
  if (qaMeasure) qaMeasure.onclick = () => document.getElementById('btn-new-measure').click();
  const qaCommittee = document.getElementById('qa-new-committee');
  if (qaCommittee) qaCommittee.onclick = () => document.getElementById('btn-new-committee').click();
}

function measureRowHtml(m) {
  return `<div class="cg-row" tabindex="0" data-measure="${m.id}">
    <span class="cg-row-number">${esc(m.number || 'DRAFT')}</span>
    <span class="cg-row-title">${esc(m.title)}</span>
    <span class="cg-row-meta">${esc(chamberLabel(m.chamber_id))}</span>
    <span class="cg-badge ${esc(m.status_key)}">${esc(statusLabel(m.status_key))}</span>
  </div>`;
}

function renderMeasureList() {
  const chamberFilter = document.getElementById('cg-filter-chamber').value;
  const statusFilter = document.getElementById('cg-filter-status').value;
  let list = _measures.filter(m => (!chamberFilter || m.chamber_id === chamberFilter) && (!statusFilter || m.status_key === statusFilter));
  const el = document.getElementById('cg-measure-list');
  el.innerHTML = list.length ? list.map(measureRowHtml).join('') : `<div class="cg-empty-state">No legislation matches these filters.</div>`;
  bindRowClicks(el);
}

const ARCHIVE_STATUSES = ['passed', 'failed', 'enacted', 'vetoed'];
function renderArchive() {
  const chamber = document.getElementById('ar-chamber').value;
  const type = document.getElementById('ar-type').value;
  const status = document.getElementById('ar-status').value;
  const from = document.getElementById('ar-from').value;
  const to = document.getElementById('ar-to').value;
  const keyword = document.getElementById('ar-keyword').value.trim().toLowerCase();

  let list = _measures.filter(m => ARCHIVE_STATUSES.includes(m.status_key));
  if (chamber) list = list.filter(m => m.chamber_id === chamber);
  if (type) list = list.filter(m => m.type_key === type);
  if (status) list = list.filter(m => m.status_key === status);
  if (from) list = list.filter(m => m.updated_at >= from);
  if (to) list = list.filter(m => m.updated_at <= to + 'T23:59:59');
  if (keyword) list = list.filter(m => (m.title + ' ' + (m.summary || '') + ' ' + (m.number || '')).toLowerCase().includes(keyword));

  const el = document.getElementById('cg-archive-list');
  el.innerHTML = list.length ? list.map(measureRowHtml).join('') : `<div class="cg-empty-state">No completed measures match these filters.</div>`;
  bindRowClicks(el);
  _archiveFiltered = list;
}

function exportArchiveCsv() {
  const rows = [['Number', 'Title', 'Type', 'Chamber', 'Result', 'Last Updated']];
  (_archiveFiltered || []).forEach(m => rows.push([m.number || 'Draft', m.title, typeLabel(m.type_key), chamberLabel(m.chamber_id), statusLabel(m.status_key), m.updated_at]));
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'mca-congress-archive.csv'; a.click();
}

function bindRowClicks(container) {
  container.querySelectorAll('.cg-row').forEach(row => {
    row.onclick = () => openMeasure(row.dataset.measure);
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMeasure(row.dataset.measure); } };
  });
}

// ── Measure detail / voting / debate / amendments ─────────────────
async function openMeasure(id) {
  const [{ data: measure }, { data: version }, { data: rollCalls }, { data: posts }, { data: amendments }, { data: reports }, { data: motions }] = await Promise.all([
    supabase.from('congress_measures').select('*').eq('id', id).single(),
    supabase.from('congress_measure_versions').select('*').eq('measure_id', id).order('version_number', { ascending: false }).limit(1),
    supabase.from('congress_roll_calls').select('*').eq('measure_id', id).order('created_at', { ascending: false }),
    supabase.from('congress_debate_posts').select('*').eq('measure_id', id).eq('is_archived', false).order('created_at'),
    supabase.from('congress_amendments').select('*').eq('measure_id', id).order('number'),
    supabase.from('congress_committee_reports').select('*').eq('measure_id', id).order('created_at', { ascending: false }),
    supabase.from('congress_motions').select('*').eq('measure_id', id).order('created_at', { ascending: false }),
  ]);
  if (!measure) return;
  window.history.replaceState(null, '', '?measure=' + id);
  _currentMeasure = measure;
  const latestVersion = (version && version[0]) || null;
  const openRollCall = (rollCalls || []).find(rc => rc.status === 'open');
  const latestMeasureRollCall = openRollCall || (rollCalls || []).find(rc => !rc.amendment_id) || null;

  document.getElementById('cg-modal-title').textContent = `${measure.number || 'Draft'} — ${measure.title}`;
  document.getElementById('cg-modal-sub').textContent = `${typeLabel(measure.type_key)} · ${chamberLabel(measure.chamber_id)} · ${statusLabel(measure.status_key)}`;

  let voteBlockHtml = '';
  if (latestMeasureRollCall) {
    voteBlockHtml = await renderVoteBlock(latestMeasureRollCall, measure);
  }

  const isChamberMember = _access.chambers.has(measure.chamber_id);
  const canPost = _access.manage || isChamberMember;
  const canProposeAmendment = _access.manage || isChamberMember;
  const isOwnDraft = measure.status_key === 'draft' && measure.created_by === _me.id;

  document.getElementById('cg-modal-body').innerHTML = `
    <p style="font-size:13px;color:var(--mid);">${esc(measure.summary || '')}</p>
    ${_access.manage ? `
      <div class="form-group">
        <label class="form-label" for="cg-committee-assign">Committee</label>
        <select class="form-select" id="cg-committee-assign" style="max-width:320px;">
          <option value="">Unassigned</option>
          ${_committees.filter(c => !c.chamber_id || c.chamber_id === measure.chamber_id).map(c => `<option value="${c.id}" ${c.id === measure.committee_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>` : ''}
    <div class="cg-section-label">Full Text — v${latestVersion?.version_number ?? '—'}${latestVersion?.is_locked ? ' (locked)' : ''}</div>
    <div class="cg-fulltext">${esc(latestVersion?.full_text || '(No version text yet.)')}</div>
    ${voteBlockHtml}

    <div class="cg-section-label">Amendments</div>
    <div id="cg-amendments">
      ${(amendments || []).length ? amendments.map(a => renderAmendment(a, measure)).join('') : '<div class="cg-empty-state">No amendments proposed.</div>'}
    </div>
    ${canProposeAmendment ? `
      <button class="btn btn-outline" id="cg-propose-amendment-toggle" style="margin-top:6px;">+ Propose Amendment</button>
      <div id="cg-propose-amendment-form" style="display:none;margin-top:10px;">
        <div class="form-group"><label class="form-label" for="am-explain">Explanation</label><textarea class="form-textarea" id="am-explain" rows="2"></textarea></div>
        <div class="cg-amendment-diff">
          <div><label class="form-label">Text to remove/replace (optional)</label><textarea class="form-textarea" id="am-before" rows="3"></textarea></div>
          <div><label class="form-label">New text</label><textarea class="form-textarea" id="am-after" rows="3"></textarea></div>
        </div>
        <button class="btn btn-primary" id="am-submit">Submit Amendment</button>
      </div>` : ''}

    ${(reports || []).length || _access.manage || isChamberMember ? `
      <div class="cg-section-label">Committee Reports</div>
      <div id="cg-reports">
        ${(reports || []).length ? reports.map(r => `
          <div class="cg-debate-post">
            <div class="cg-debate-meta"><strong>${esc(nameOf(r.filed_by, 'Committee'))}</strong>
              <span class="cg-pos-tag">${esc((r.recommendation || 'no_recommendation').replace('_',' '))}</span></div>
            <div>${esc(r.summary)}</div>
          </div>
        `).join('') : '<div class="cg-empty-state">No committee reports filed.</div>'}
      </div>
      ${measure.committee_id ? `
        <div class="form-group" style="margin-top:8px;">
          <textarea class="form-textarea" id="cg-new-report" rows="2" placeholder="File a committee report…"></textarea>
          <div class="cg-post-row" style="margin-top:6px;">
            <select id="cg-report-rec">
              <option value="favorable">Favorable</option>
              <option value="unfavorable">Unfavorable</option>
              <option value="no_recommendation">No recommendation</option>
            </select>
            <button class="btn btn-outline" id="cg-report-submit">File Report</button>
          </div>
        </div>` : ''}
    ` : ''}

    <div class="cg-section-label">Parliamentary Motions</div>
    <div id="cg-motions">
      ${(motions || []).length ? motions.map(mo => `
        <div class="cg-amendment">
          <div class="cg-amendment-head">
            <strong>${esc(motionTypeLabel(mo.motion_type_key))}</strong>
            <span class="cg-badge ${mo.status === 'adopted' ? 'passed' : mo.status === 'rejected' ? 'failed' : mo.status === 'withdrawn' ? 'withdrawn' : 'debate'}">${esc(mo.status)}</span>
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
    ${(_access.manage || isChamberMember) && _motionTypes.filter(t => t.is_enabled).length ? `
      <div class="cg-post-row" style="margin-top:8px;">
        <select id="cg-motion-type">${_motionTypes.filter(t => t.is_enabled).map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}</select>
        <input class="form-input" id="cg-motion-note" placeholder="Note (optional)">
        <button class="btn btn-outline" id="cg-motion-submit">Raise Motion</button>
      </div>` : ''}

    <div class="cg-section-label">Debate</div>
    <div id="cg-debate-thread">
      ${(posts || []).length ? posts.map(p => renderDebatePost(p)).join('') : '<div class="cg-empty-state">No debate yet.</div>'}
    </div>
    ${canPost ? `
      <div class="form-group" style="margin-top:1rem;">
        <div class="cg-post-row">
          <select id="cg-post-position"><option value="">No position tag</option>${POSITIONS.map(p => `<option value="${p}">${p.replace('_',' ')}</option>`).join('')}</select>
          <input class="form-input" id="cg-post-section" placeholder="Section ref (optional)">
        </div>
        <textarea class="form-textarea" id="cg-new-post" rows="2" placeholder="Add to the debate…" aria-label="Add debate comment"></textarea>
        <button class="btn btn-outline" id="cg-post-submit" style="margin-top:6px;">Post</button>
      </div>` : ''}
  `;

  const foot = document.getElementById('cg-modal-foot');
  const footBtns = [`<button class="btn btn-outline" id="cg-copy-link">Copy Link</button>`, `<button class="btn btn-outline" id="cg-print">Print / PDF</button>`];
  const noActiveRollCall = !latestMeasureRollCall || ['certified', 'voided'].includes(latestMeasureRollCall.status);
  if (_access.manage) {
    if (measure.status_key !== 'passed' && measure.status_key !== 'failed' && measure.status_key !== 'enacted' && noActiveRollCall) {
      footBtns.push(`<button class="btn btn-outline" id="cg-schedule-vote">Schedule &amp; Open Vote</button>`);
    }
    if (measure.status_key === 'voting' && latestMeasureRollCall && latestMeasureRollCall.status === 'open') {
      footBtns.push(`<button class="btn btn-outline" id="cg-close-vote">Close Voting</button>`);
    }
    if (latestMeasureRollCall && latestMeasureRollCall.status === 'closed' && _access.certify) {
      footBtns.push(`<button class="btn btn-primary" id="cg-certify-vote">Certify Result</button>`);
    }
  }
  foot.innerHTML = footBtns.join('');

  document.getElementById('cg-copy-link').onclick = () => {
    navigator.clipboard?.writeText(window.location.origin + window.location.pathname + '?measure=' + measure.id);
  };
  document.getElementById('cg-print').onclick = () => window.print();

  document.getElementById('cg-motion-submit') && (document.getElementById('cg-motion-submit').onclick = async () => {
    const motionTypeKey = document.getElementById('cg-motion-type').value;
    const note = document.getElementById('cg-motion-note').value.trim() || null;
    const { error } = await supabase.from('congress_motions').insert({ measure_id: measure.id, motion_type_key: motionTypeKey, raised_by: _me.id, note });
    if (error) { showModalError(error.message); return; }
    openMeasure(measure.id);
  });
  document.querySelectorAll('#cg-motions [data-motion-resolve]').forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.motionResolve, status = btn.dataset.motionStatus;
    await supabase.from('congress_motions').update({ status, resolved_by: _me.id, resolved_at: new Date().toISOString() }).eq('id', id);
    if (status === 'adopted') {
      const motionKey = (motions || []).find(m => m.id === id)?.motion_type_key;
      if (motionKey === 'discharge_committee' && measure.status_key === 'committee') {
        await supabase.from('congress_measures').update({ status_key: 'introduced', committee_id: null }).eq('id', measure.id);
      } else if (motionKey === 'table') {
        await supabase.from('congress_measures').update({ status_key: 'committee' }).eq('id', measure.id);
      } else if (motionKey === 'recusal') {
        await supabase.from('congress_members').update({ status: 'recused', status_set_by: _me.id, status_set_at: new Date().toISOString() }).eq('user_id', _me.id).eq('chamber_id', measure.chamber_id);
      }
      await loadMeasures(); if (_access.manage) { await loadDashboardExtras(); renderDashboard(); renderLeadershipTools(); }
    }
    openMeasure(measure.id);
  });

  // Committee assignment
  document.getElementById('cg-committee-assign') && (document.getElementById('cg-committee-assign').onchange = async (e) => {
    await supabase.from('congress_measures').update({ committee_id: e.target.value || null }).eq('id', measure.id);
    await loadMeasures();
  });

  // Amendments
  document.getElementById('cg-propose-amendment-toggle') && (document.getElementById('cg-propose-amendment-toggle').onclick = () => {
    document.getElementById('cg-propose-amendment-form').style.display = 'block';
    document.getElementById('cg-propose-amendment-toggle').style.display = 'none';
  });
  document.getElementById('am-submit') && (document.getElementById('am-submit').onclick = async () => {
    const explanation = document.getElementById('am-explain').value.trim();
    if (!explanation) { showModalError('An explanation is required.'); return; }
    const nextNumber = ((amendments || []).reduce((max, a) => Math.max(max, a.number), 0)) + 1;
    const { error } = await supabase.from('congress_amendments').insert({
      measure_id: measure.id, number: nextNumber, sponsor_id: _me.id, explanation,
      affected_text_before: document.getElementById('am-before').value || null,
      affected_text_after: document.getElementById('am-after').value || null,
      created_by: _me.id,
    });
    if (error) showModalError(error.message); else openMeasure(measure.id);
  });
  document.querySelectorAll('button[data-amend-disposition]').forEach(btn => {
    btn.onclick = async () => {
      const { error } = await supabase.rpc('congress_set_amendment_disposition', {
        p_amendment_id: btn.dataset.amendId, p_status: btn.dataset.amendDisposition,
      });
      if (error) showModalError(error.message); else openMeasure(measure.id);
    };
  });
  document.querySelectorAll('button[data-amend-vote]').forEach(btn => {
    btn.onclick = async () => {
      const amend = amendments.find(a => a.id === btn.dataset.amendVote);
      const { data: rc, error } = await supabase.from('congress_roll_calls').insert({
        amendment_id: amend.id, chamber_id: measure.chamber_id, measure_version_id: latestVersion.id,
        question: `On Amendment #${amend.number} to ${measure.number || measure.title}`,
        created_by: _me.id,
      }).select().single();
      if (error) { showModalError(error.message); return; }
      await supabase.from('congress_amendments').update({ status: 'voting' }).eq('id', amend.id);
      const { error: openErr } = await supabase.rpc('congress_open_roll_call', { p_roll_call_id: rc.id });
      if (openErr) showModalError(openErr.message); else openMeasure(measure.id);
    };
  });

  // Committee reports
  document.getElementById('cg-report-submit') && (document.getElementById('cg-report-submit').onclick = async () => {
    const summary = document.getElementById('cg-new-report').value.trim();
    if (!summary) return;
    const { error } = await supabase.from('congress_committee_reports').insert({
      measure_id: measure.id, committee_id: measure.committee_id, summary,
      recommendation: document.getElementById('cg-report-rec').value, filed_by: _me.id,
    });
    if (error) showModalError(error.message); else openMeasure(measure.id);
  });

  // Debate posting
  document.getElementById('cg-post-submit') && (document.getElementById('cg-post-submit').onclick = async () => {
    const body = document.getElementById('cg-new-post').value.trim();
    if (!body) return;
    const { error } = await supabase.from('congress_debate_posts').insert({
      measure_id: measure.id, author_id: _me.id, body,
      position: document.getElementById('cg-post-position').value || null,
      section_ref: document.getElementById('cg-post-section').value.trim() || null,
    });
    if (!error) openMeasure(measure.id); else showModalError(error.message);
  });
  document.querySelectorAll('button[data-edit-post]').forEach(btn => {
    btn.onclick = () => startEditPost(btn.dataset.editPost, posts);
  });
  document.querySelectorAll('button[data-archive-post]').forEach(btn => {
    btn.onclick = async () => {
      const reason = prompt('Reason for archiving this post (visible in the moderation audit log):');
      if (reason === null) return;
      const { error } = await supabase.from('congress_debate_posts').update({
        is_archived: true, archived_by: _me.id, archived_reason: reason, archived_at: new Date().toISOString(),
      }).eq('id', btn.dataset.archivePost);
      if (error) showModalError(error.message); else openMeasure(measure.id);
    };
  });

  document.getElementById('cg-close-vote') && (document.getElementById('cg-close-vote').onclick = async () => {
    const { error } = await supabase.rpc('congress_close_roll_call', { p_roll_call_id: latestMeasureRollCall.id });
    if (!error) openMeasure(measure.id); else showModalError(error.message);
  });
  document.getElementById('cg-certify-vote') && (document.getElementById('cg-certify-vote').onclick = async () => {
    const { error } = await supabase.rpc('congress_certify_roll_call', { p_roll_call_id: latestMeasureRollCall.id, p_note: 'Certified via portal' });
    if (!error) { openMeasure(measure.id); await loadMeasures(); renderMeasureList(); renderDashboard(); renderArchive(); } else showModalError(error.message);
  });

  document.getElementById('cg-schedule-vote') && (document.getElementById('cg-schedule-vote').onclick = async () => {
    if (!latestVersion) { showModalError('This measure has no version text yet — add a version before opening a vote.'); return; }
    const { data: rc, error } = await supabase.from('congress_roll_calls').insert({
      measure_id: measure.id, chamber_id: measure.chamber_id, measure_version_id: latestVersion.id,
      question: `On passage of ${measure.number || measure.title}`,
      threshold_numerator: measure.threshold_numerator, threshold_denominator: measure.threshold_denominator,
      quorum_numerator: measure.quorum_numerator, quorum_denominator: measure.quorum_denominator,
      created_by: _me.id,
    }).select().single();
    if (error) { showModalError(error.message); return; }
    await supabase.from('congress_measure_versions').update({ is_locked: true }).eq('id', latestVersion.id);
    const { error: openErr } = await supabase.rpc('congress_open_roll_call', { p_roll_call_id: rc.id });
    if (openErr) { showModalError(openErr.message); return; }
    await loadMeasures(); renderDashboard(); renderMeasureList();
    openMeasure(measure.id);
  });

  document.getElementById('cg-measure-modal').classList.add('open');
}

function renderDebatePost(p) {
  const canEdit = p.author_id === _me.id && !p.is_archived;
  const canModerate = _access.moderate || _access.manage;
  return `
    <div class="cg-debate-post" data-post-id="${p.id}">
      <div class="cg-debate-meta">
        <strong>${esc(nameOf(p.author_id))}</strong>
        ${p.position ? `<span class="cg-pos-tag">${esc(p.position.replace('_',' '))}</span>` : ''}
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
  bodyEl.innerHTML = `
    <textarea class="form-textarea" rows="2">${esc(post.body)}</textarea>
    <button class="btn btn-outline" style="margin-top:6px;">Save</button>`;
  bodyEl.querySelector('button').onclick = async () => {
    const newBody = bodyEl.querySelector('textarea').value.trim();
    if (!newBody) return;
    const { error } = await supabase.from('congress_debate_posts').update({
      body: newBody, is_edited: true, edited_at: new Date().toISOString(),
    }).eq('id', postId);
    if (error) showModalError(error.message); else openMeasure(_currentMeasure.id);
  };
}

function renderAmendment(a, measure) {
  const canDispose = _access.manage && a.status === 'proposed';
  const canVote = _access.manage && (a.status === 'proposed' || a.status === 'debate');
  return `
    <div class="cg-amendment">
      <div class="cg-amendment-head">
        <strong>Amendment #${a.number}</strong>
        <span class="cg-badge ${a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'introduced'}">${esc(a.status)}</span>
      </div>
      <div style="font-size:12px;color:var(--mid);">By ${esc(nameOf(a.sponsor_id))}</div>
      <p style="font-size:13px;margin:6px 0;">${esc(a.explanation)}</p>
      ${(a.affected_text_before || a.affected_text_after) ? `
        <div class="cg-amendment-diff">
          <div class="before">${esc(a.affected_text_before || '(nothing removed)')}</div>
          <div class="after">${esc(a.affected_text_after || '(nothing added)')}</div>
        </div>` : ''}
      ${a.disposition_note ? `<div style="font-size:12px;color:var(--muted);">Note: ${esc(a.disposition_note)}</div>` : ''}
      <div class="cg-amendment-actions">
        ${canVote ? `<button class="btn btn-outline" data-amend-vote="${a.id}">Schedule &amp; Open Vote</button>` : ''}
        ${canDispose ? `
          <button class="btn btn-outline" data-amend-disposition="passed" data-amend-id="${a.id}">Mark Passed</button>
          <button class="btn btn-outline" data-amend-disposition="failed" data-amend-id="${a.id}">Mark Failed</button>
          <button class="btn btn-danger" data-amend-disposition="withdrawn" data-amend-id="${a.id}">Withdraw</button>
        ` : ''}
      </div>
    </div>`;
}

async function renderVoteBlock(rollCall, measure) {
  let myVote = null;
  if (rollCall.status !== 'scheduled') {
    const { data } = await supabase.from('congress_votes').select('choice').eq('roll_call_id', rollCall.id).eq('user_id', _me.id).maybeSingle();
    myVote = data?.choice || null;
  }
  const options = Array.isArray(rollCall.vote_options) ? rollCall.vote_options : JSON.parse(rollCall.vote_options || '[]');

  let tallyHtml = '';
  if (rollCall.visibility === 'live' && ['open','closed','certified'].includes(rollCall.status)) {
    const { data: tally } = await supabase.rpc('congress_roll_call_tally', { p_roll_call_id: rollCall.id });
    if (tally && tally.length) {
      tallyHtml = `<div class="cg-tally">${tally.map(t => `
        <div class="cg-tally-cell"><div class="n">${t.vote_count}</div><div class="l">${esc(t.choice)}</div></div>
      `).join('')}</div>
      <div class="cg-vote-status">Cast: ${tally[0].total_cast} / Eligible: ${tally[0].total_eligible} · Quorum ${tally[0].quorum_met ? 'met' : 'not met'}</div>`;
    }
  }

  const canVote = rollCall.status === 'open' && _access.chambers.has(measure.chamber_id);
  return `
    <div class="cg-section-label">Roll Call — ${esc(rollCall.question)}</div>
    <div style="font-size:12px;color:var(--muted);">Status: ${esc(rollCall.status)} · Visibility: ${esc(rollCall.visibility)}</div>
    ${canVote ? `
      <div class="cg-vote-options">
        ${options.map(o => `<button class="btn ${myVote === o ? 'btn-primary' : 'btn-outline'}" data-vote="${esc(o)}">${esc(o)}</button>`).join('')}
      </div>
      <div class="cg-vote-status">${myVote ? `Your recorded vote: <strong>${esc(myVote)}</strong>${rollCall.allow_vote_changes ? ' (you may change it while voting is open)' : ''}` : 'You have not voted yet.'}</div>
    ` : rollCall.status === 'open' ? `<div class="cg-vote-status">You are not an eligible voter for this chamber.</div>` : ''}
    ${tallyHtml}
    <div id="cg-vote-rc-id" data-id="${rollCall.id}"></div>
  `;
}

function showModalError(msg) {
  const el = document.getElementById('cg-modal-error');
  el.textContent = msg; el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

document.getElementById('cg-modal-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-vote]');
  if (!btn) return;
  const rcId = document.getElementById('cg-vote-rc-id')?.dataset.id;
  if (!rcId) return;
  const { error } = await supabase.rpc('congress_cast_vote', { p_roll_call_id: rcId, p_choice: btn.dataset.vote });
  if (error) showModalError(error.message);
  else openMeasure(_currentMeasure.id);
});

function bindModals() {
  const closeMeasureModal = () => { document.getElementById('cg-measure-modal').classList.remove('open'); window.history.replaceState(null, '', window.location.pathname); };
  document.getElementById('cg-modal-close').onclick = closeMeasureModal;
  document.getElementById('cg-measure-modal').addEventListener('click', (e) => { if (e.target.id === 'cg-measure-modal') closeMeasureModal(); });

  document.getElementById('btn-new-measure').onclick = () => document.getElementById('cg-new-measure-modal').classList.add('open');
  document.getElementById('cg-new-close').onclick = () => document.getElementById('cg-new-measure-modal').classList.remove('open');
  document.getElementById('nm-cancel').onclick = () => document.getElementById('cg-new-measure-modal').classList.remove('open');
  document.getElementById('cg-new-measure-modal').addEventListener('click', (e) => { if (e.target.id === 'cg-new-measure-modal') e.currentTarget.classList.remove('open'); });

  document.getElementById('nm-submit').onclick = async () => {
    const title = document.getElementById('nm-title').value.trim();
    const errEl = document.getElementById('nm-error');
    errEl.style.display = 'none';
    if (!title) { errEl.textContent = 'Title is required.'; errEl.style.display = 'block'; return; }
    const { data: measure, error } = await supabase.from('congress_measures').insert({
      type_key: document.getElementById('nm-type').value,
      chamber_id: document.getElementById('nm-chamber').value,
      title,
      summary: document.getElementById('nm-summary').value.trim() || null,
      created_by: _me.id,
    }).select().single();
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    const { data: v1 } = await supabase.from('congress_measure_versions').insert({
      measure_id: measure.id, version_number: 1,
      full_text: document.getElementById('nm-text').value, created_by: _me.id,
    }).select().single();
    if (v1) await supabase.from('congress_measures').update({ current_version_id: v1.id }).eq('id', measure.id);
    document.getElementById('cg-new-measure-modal').classList.remove('open');
    ['nm-title','nm-summary','nm-text'].forEach(id => document.getElementById(id).value = '');
    await loadMeasures();
    renderDashboard(); renderMeasureList(); renderArchive();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.getElementById('cg-measure-modal').classList.remove('open');
    document.getElementById('cg-new-measure-modal').classList.remove('open');
  });
}

init();
