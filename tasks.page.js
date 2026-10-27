import { supabase, getMyRolePreview, requireAal2 } from './supabase.js';

// ── Delegated actions (strict CSP) ────────────────────────────────
// Inline handler attributes are blocked by the strict script-src policy,
// so every button/row above is wired through these listeners instead.
// data-action names the action; data-id / data-index / data-label carry
// the values the old inline handler used to inline. Handlers run at click
// time, after this module has fully evaluated, so window-assigned page
// functions are available here exactly as they were to inline handlers.

const _ACTION_HANDLERS = {
  'toggle-project-collapse': (el, e) => window.toggleProjectCollapse(el.dataset.id),
  'edit-project': (el, e) => window.editProject(el.dataset.id),
  'edit-task': (el, e) => window.editTask(el.dataset.id),
  'remove-pj-user': (el, e) => window.removePjUser(el.dataset.id),
};

document.addEventListener('click', (e) => {
  const actionEl = e.target.closest?.('[data-action]');
  if (!actionEl) return;
  // An inner element that asked to stop (e.g. a Sign In link inside a
  // clickable card) wins over the outer action: the click still follows
  // the inner element's own default, it just does not trigger the card.
  const stopEl = e.target.closest?.('[data-stop]');
  if (stopEl && stopEl !== actionEl && actionEl.contains(stopEl)) return;
  const handler = _ACTION_HANDLERS[actionEl.dataset.action];
  if (handler) handler(actionEl, e);
});

// Keyboard activation for role=button rows and cards: native buttons and
// links already fire click on Enter/Space, so only non-native controls
// need this. It replaces the old pattern where a keydown handler re-fired click.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (!t || !t.closest) return;
  if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  const actionEl = t.closest('[data-action]');
  if (!actionEl) return;
  e.preventDefault();
  const handler = _ACTION_HANDLERS[actionEl.dataset.action];
  if (handler) handler(actionEl, e);
});


// ── Tag / status / color system ─────────────────────────────────
// A task's tag IS its status and its color — one field, no overrides.
const NO_TAG = { name: 'No Tag', color: '#D9D9D9' };
function tagById(id) { return _tags.find(tg => tg.id === id); }
function taskTag(t) { return tagById(t.tag_id) || NO_TAG; }
function taskColor(t) { return taskTag(t).color; }
function tagOrder(t) { const i = _tags.findIndex(tg => tg.id === t.tag_id); return i < 0 ? 999 : i; }
function isDoneTask(t) { return !!tagById(t.tag_id)?.is_done; }
function isCheckoffTask(t) { return !!tagById(t.tag_id)?.is_checkoff; }
function contrastText(hex) {
  if (!hex) return '#111';
  let h = hex.replace('#', '');
  // safeColor() accepts 3-digit hex, but substring(4,6) on "abc" is empty ->
  // NaN luminance -> always white text, unreadable on a light tag. Expand the
  // shorthand first.
  if (h.length === 3) h = h[0]+h[0] + h[1]+h[1] + h[2]+h[2];
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  const yiq = (r*299 + g*587 + b*114) / 1000;
  return yiq >= 150 ? '#111111' : '#ffffff';
}

let _projects = [], _tasks = [], _members = [], _allProfiles = [], _me = null, _roles = [], _projectAccess = [], _assigneesByTask = {};
let _access = { manage: false, checkoff: false, test: false };
let _commentCounts = {};
let _view = 'list';
let _showDrafts = false;
let _projectFilter = '';
let _tags = [];
let _tagFilter = new Set(); // tag ids; task matches if its tag is one of the selected
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

let _projectSort = {}; // { [projectId]: 'color' | 'name' | 'due' | 'priority' }
function sortKeyFor(projectId) { return _projectSort[projectId] || 'color'; }

let _collapsedProjects = new Set(JSON.parse(localStorage.getItem('mca_tk_collapsed_projects') || '[]'));
function isCollapsed(projectId) { return _collapsedProjects.has(projectId); }
function saveCollapsedProjects() { localStorage.setItem('mca_tk_collapsed_projects', JSON.stringify([..._collapsedProjects])); }
window.toggleProjectCollapse = (projectId) => {
  if (_collapsedProjects.has(projectId)) _collapsedProjects.delete(projectId);
  else _collapsedProjects.add(projectId);
  saveCollapsedProjects();
  render();
};

function sortSelectHtml(projectId) {
  const current = sortKeyFor(projectId);
  const opts = [['color','Color'],['name','Name'],['due','Due Date'],['priority','Priority']];
  return `<select class="tp-sort" data-project="${projectId}">
    ${opts.map(([v,l]) => `<option value="${v}"${v===current?' selected':''}>Sort: ${l}</option>`).join('')}
  </select>`;
}

function attachProjectSortListeners() {
  document.querySelectorAll('.tp-sort').forEach(sel => {
    sel.onchange = (e) => {
      _projectSort[sel.dataset.project] = e.target.value;
      render();
    };
  });
}

function sortTasks(list, sortBy) {
  const arr = list.slice();
  if (sortBy === 'name') {
    arr.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sortBy === 'due') {
    arr.sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  } else if (sortBy === 'priority') {
    arr.sort((a, b) => {
      const da = isDoneTask(a) ? 1 : 0, db = isDoneTask(b) ? 1 : 0;
      if (da !== db) return da - db; // finished tasks always last — no longer relevant
      const pd = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
      if (pd !== 0) return pd;
      return tagOrder(a) - tagOrder(b); // secondary: custom color/tag order
    });
  } else { // color
    arr.sort((a, b) => {
      const so = tagOrder(a) - tagOrder(b);
      if (so !== 0) return so;
      return a.title.localeCompare(b.title);
    });
  }
  return arr;
}

async function resolveAccess(userId) {
  const access = { manage: false, checkoff: false, test: false };
  try {
    const [{ data: manage }, { data: checkoff }, { data: test }] = await Promise.all([
      supabase.rpc('user_has_permission', { perm: 'can_manage_tasks' }),
      supabase.rpc('user_has_permission', { perm: 'can_check_off_tasks' }),
      supabase.rpc('user_has_permission', { perm: 'can_test_tasks' }),
    ]);
    access.manage = manage === true;
    access.checkoff = checkoff === true;
    access.test = test === true;
  } catch {}
  return access;
}

function applyAccessUI() {
  document.getElementById('btn-new-project').style.display = _access.manage ? '' : 'none';
  document.getElementById('btn-new-task').style.display = _access.manage ? '' : 'none';
  // Custom tags: creating/editing them is admin & owner only (can_manage_tasks),
  // NOT tester managers (can_check_off_tasks). Using testers can see and filter
  // by tags regardless of _access, since that part is read-only for them.
  document.getElementById('btn-manage-tags').style.display = _access.manage ? '' : 'none';
  document.getElementById('btn-view-drafts').style.display = _access.manage ? '' : 'none';
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return show('denied');
  if (!(await requireAal2('tasks.html'))) return;
  _me = session.user;
  _access = await resolveAccess(_me.id);
  if (!_access.manage && !_access.checkoff && !_access.test) return show('denied');
  applyAccessUI();
  show('main');
  buildLegend();
  await loadAll();
  openSharedTaskFromUrl();
}

function show(which) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('denied').style.display = which === 'denied' ? 'block' : 'none';
  document.getElementById('main').style.display = which === 'main' ? 'block' : 'none';
}

async function loadAll() {
  const [{ data: projects }, { data: tasks }, { data: profiles }, { data: userRoles }, { data: comments }, { data: tags }, { data: roles }, { data: access }, { data: assignees }] = await Promise.all([
    supabase.from('task_projects').select('*').order('sort_order').order('created_at'),
    supabase.from('tasks').select('*').order('due_date', { nullsFirst: false }),
    // public_profiles, not profiles: a member can only read their own profiles
    // row, so this came back with just themselves and every other name and
    // permission level was missing.
    supabase.from('public_profiles').select('id, display_name, username, role'),
    supabase.from('user_roles').select('user_id, roles(level)'),
    supabase.from('task_comments').select('task_id'),
    supabase.from('task_tags').select('*').order('sort_order').order('created_at'),
    _access.manage ? supabase.from('roles').select('id, label').order('level', { ascending: false }) : Promise.resolve({ data: [] }),
    _access.manage ? supabase.from('task_project_access').select('*') : Promise.resolve({ data: [] }),
    supabase.from('task_assignees').select('task_id, user_id'),
  ]);
  _projects = projects || []; _tasks = tasks || [];
  _roles = roles || []; _projectAccess = access || [];
  _allProfiles = profiles || []; // used for name lookups (assignees, commenters, checked-off-by) regardless of level
  _tags = tags || [];

  // Assignees live in the task_assignees join table (supports multiple per task).
  // Build a task_id -> [user_id] map, and attach a convenience single-value
  // assignee_id (first assignee) onto each task for the existing single-select UI.
  _assigneesByTask = {};
  (assignees || []).forEach(a => {
    (_assigneesByTask[a.task_id] = _assigneesByTask[a.task_id] || []).push(a.user_id);
  });
  _tasks.forEach(t => { t.assignee_id = (_assigneesByTask[t.id] || [])[0] || null; });

  _commentCounts = {};
  (comments || []).forEach(c => { _commentCounts[c.task_id] = (_commentCounts[c.task_id] || 0) + 1; });

  const levelByUser = {};
  (userRoles || []).forEach(ur => {
    const lvl = ur.roles?.level || 0;
    if (lvl > (levelByUser[ur.user_id] || 0)) levelByUser[ur.user_id] = lvl;
  });
  const legacyLevel = { owner: 100, admin: 80 };
  _members = _allProfiles.filter(m => {
    const lvl = Math.max(levelByUser[m.id] || 0, legacyLevel[m.role] || 0);
    return lvl >= 50;
  });

  fillSelects(); buildLegend(); render();
}

function fillSelects() {
  const pjSel = document.getElementById('tk-project');
  pjSel.innerHTML = _projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  const asSel = document.getElementById('tk-assignee');
  asSel.innerHTML = '<option value="">Unassigned</option>' + _members.map(m => `<option value="${m.id}">${escapeHtml(m.display_name || m.username)}</option>`).join('');
  const filterSel = document.getElementById('tk-project-filter');
  const prevVal = filterSel.value;
  filterSel.innerHTML = '<option value="">All Projects</option>' + _projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  filterSel.value = prevVal;
}

function memberName(id) {
  const m = _allProfiles.find(m => m.id === id);
  return m ? (m.display_name || m.username) : '';
}

function visibleTasks() {
  let list = _tasks;
  list = _showDrafts ? list.filter(t => t.is_draft) : list.filter(t => !t.is_draft);
  if (_projectFilter) list = list.filter(t => t.project_id === _projectFilter);
  if (_tagFilter.size) list = list.filter(t => t.tag_id && _tagFilter.has(t.tag_id));
  return list;
}

// Legend chips — visible to everyone with board access (testers included), so
// testers can filter by the tag/status/color admins set up. Multi-select: a
// task matches if its one tag is any of the selected chips.
function buildLegend() {
  const el = document.getElementById('tk-legend');
  el.innerHTML = _tags.map(tg => `
    <div class="tk-legend-chip${_tagFilter.has(tg.id) ? ' active' : ''}" data-tag="${tg.id}">
      <span class="tk-swatch" style="background:${safeColor(tg.color)};"></span>${escapeHtml(tg.name)}
    </div>`).join('');
  el.querySelectorAll('.tk-legend-chip').forEach(chip => {
    chip.onclick = () => {
      const id = chip.dataset.tag;
      if (_tagFilter.has(id)) _tagFilter.delete(id); else _tagFilter.add(id);
      chip.classList.toggle('active', _tagFilter.has(id));
      render();
    };
  });
}

document.getElementById('tk-project-filter').onchange = (e) => { _projectFilter = e.target.value; render(); };
document.getElementById('btn-view-list').onclick = () => setView('list');
document.getElementById('btn-view-grid').onclick = () => setView('grid');
document.getElementById('btn-view-drafts').onclick = () => {
  _showDrafts = !_showDrafts;
  document.getElementById('btn-view-drafts').classList.toggle('active', _showDrafts);
  render();
};
function setView(v) {
  _view = v;
  document.getElementById('btn-view-list').classList.toggle('active', v === 'list');
  document.getElementById('btn-view-grid').classList.toggle('active', v === 'grid');
  render();
}

function render() {
  renderCollapsedStrip();
  if (_view === 'grid') renderGrid(); else renderList();
}

function orderedProjects() {
  let list = _projectFilter ? _projects.filter(p => p.id === _projectFilter) : _projects.slice();
  list = _showDrafts
    ? list.filter(p => p.is_draft || _tasks.some(t => t.project_id === p.id && t.is_draft))
    : list.filter(p => !p.is_draft);
  return list;
}

function renderCollapsedStrip() {
  const strip = document.getElementById('tk-collapsed-strip');
  const collapsed = orderedProjects().filter(p => isCollapsed(p.id));
  if (!collapsed.length) { strip.innerHTML = ''; strip.style.display = 'none'; return; }
  strip.style.display = 'flex';
  strip.innerHTML = collapsed.map(p => {
    const count = visibleTasks().filter(t => t.project_id === p.id).length;
    return `
    <div class="tk-collapsed-chip" data-action="toggle-project-collapse" data-id="${p.id}" role="button" tabindex="0" title="Expand ${escapeHtml(p.name)}">
      <span class="tk-collapsed-caret">▸</span>
      <span class="tk-collapsed-name">${escapeHtml(p.name)}</span>
      <span class="tk-collapsed-count">${count}</span>
    </div>`;
  }).join('');
}

function renderList() {
  const board = document.getElementById('board');
  if (!_projects.length) { board.innerHTML = '<div class="t-empty">No projects yet — create one to start adding tasks.</div>'; return; }
  const projectsToShow = orderedProjects().filter(p => !isCollapsed(p.id));
  if (!projectsToShow.length) { board.innerHTML = `<div class="t-empty">${_showDrafts ? 'No drafts right now.' : 'Nothing to show for this filter.'}</div>`; return; }
  board.innerHTML = projectsToShow.map(p => {
    const rows = sortTasks(visibleTasks().filter(t => t.project_id === p.id), sortKeyFor(p.id));
    return `
    <div class="tp-group">
      <div class="tp-head">
        <button class="tp-collapse-btn" data-action="toggle-project-collapse" data-id="${p.id}" title="Collapse">▾</button>
        <div class="tp-head-name">${escapeHtml(p.name)}${p.is_draft ? ' <span class="draft-badge">Draft</span>' : ''}${_access.manage && _projectAccess.some(a => a.project_id === p.id) ? ' 🔒' : ''}</div>
        <div class="tp-head-actions">
          ${sortSelectHtml(p.id)}
          ${_access.manage ? `<button data-action="edit-project" data-id="${p.id}">Edit</button>` : ''}
        </div>
      </div>
      ${rows.length ? rows.map(t => {
        const color = taskColor(t);
        const txt = contrastText(color);
        const tg = taskTag(t);
        return `
        <div class="t-row" data-action="edit-task" data-id="${t.id}" role="button" tabindex="0">
          <span class="t-color-dot" style="background:${safeColor(color)};"></span>
          <div class="t-title${isDoneTask(t) ? ' done' : ''}">${escapeHtml(t.title)}</div>
          ${t.is_draft ? '<span class="draft-badge">Draft</span>' : ''}
          ${t.assignee_id ? `<div class="t-meta">${escapeHtml(memberName(t.assignee_id))}</div>` : ''}
          ${t.due_date ? `<div class="t-meta">${escapeHtml(t.due_date)}</div>` : ''}
          ${_commentCounts[t.id] ? `<div class="t-meta">💬 ${_commentCounts[t.id]}</div>` : ''}
          ${t.checked_off_by ? `<div class="t-meta" style="color:#2d7d2f;">✓ ${escapeHtml(memberName(t.checked_off_by) || 'checked')}</div>` : ''}
          <div class="t-badge ${escapeHtml(t.priority)}">${escapeHtml(t.priority)}</div>
          <div class="t-status" style="background:${safeColor(color)};color:${safeColor(txt)};">${escapeHtml(tg.name)}</div>
        </div>`;
      }).join('') : '<div class="t-empty">No tasks in this project.</div>'}
    </div>`;
  }).join('');
  attachProjectSortListeners();
}

function renderGrid() {
  const board = document.getElementById('board');
  if (!_projects.length) { board.innerHTML = '<div class="t-empty">No projects yet — create one to start adding tasks.</div>'; return; }
  const projectsToShow = orderedProjects().filter(p => !isCollapsed(p.id));
  if (!projectsToShow.length) { board.innerHTML = `<div class="t-empty">${_showDrafts ? 'No drafts right now.' : 'Nothing to show for this filter.'}</div>`; return; }
  board.innerHTML = projectsToShow.map(p => {
    const cards = sortTasks(visibleTasks().filter(t => t.project_id === p.id), sortKeyFor(p.id));
    return `
    <div class="tp-group">
      <div class="tp-head">
        <button class="tp-collapse-btn" data-action="toggle-project-collapse" data-id="${p.id}" title="Collapse">▾</button>
        <div class="tp-head-name">${escapeHtml(p.name)}${p.is_draft ? ' <span class="draft-badge">Draft</span>' : ''}${_access.manage && _projectAccess.some(a => a.project_id === p.id) ? ' 🔒' : ''}</div>
        <div class="tp-head-actions">
          ${sortSelectHtml(p.id)}
          ${_access.manage ? `<button data-action="edit-project" data-id="${p.id}">Edit</button>` : ''}
        </div>
      </div>
      <div style="padding:14px 16px;">
        ${cards.length ? `<div class="tk-grid">${cards.map(t => {
          const color = taskColor(t);
          const txt = contrastText(color);
          const tg = taskTag(t);
          return `
          <div class="tk-card" style="background:${safeColor(color)};color:${safeColor(txt)};" data-action="edit-task" data-id="${t.id}" role="button" tabindex="0">
            <div class="tk-card-title${isDoneTask(t) ? ' done' : ''}" style="color:${safeColor(txt)};">${escapeHtml(t.title)}${t.is_draft ? ' <span class="draft-badge">Draft</span>' : ''}</div>
            <div class="tk-card-foot">
              <span class="tk-card-status" style="color:${safeColor(txt)};">${escapeHtml(tg.name)}</span>
              ${t.assignee_id ? `<span class="tk-card-meta" style="color:${safeColor(txt)};">👤 ${escapeHtml(memberName(t.assignee_id) || 'Unassigned')}</span>` : ''}
              ${t.due_date ? `<span class="tk-card-meta" style="color:${safeColor(txt)};">${escapeHtml(t.due_date)}</span>` : ''}
              ${_commentCounts[t.id] ? `<span class="tk-card-meta" style="color:${safeColor(txt)};">💬 ${_commentCounts[t.id]}</span>` : ''}
              ${t.checked_off_by ? `<span class="tk-card-meta" style="color:${safeColor(txt)};">✓ ${escapeHtml(memberName(t.checked_off_by) || 'checked')}</span>` : ''}
            </div>
          </div>`;
        }).join('')}</div>` : '<div class="t-empty">No tasks in this project.</div>'}
      </div>
    </div>`;
  }).join('');
  attachProjectSortListeners();
}

// ── Project modal ──
let _pjUserPicks = [];
function openProjectModal(p) {
  document.getElementById('pj-id').value = p?.id || '';
  document.getElementById('pj-name').value = p?.name || '';
  document.getElementById('pj-draft').checked = p?.is_draft || false;
  document.getElementById('pj-title').textContent = p ? 'Edit Project' : 'New Project';
  document.getElementById('pj-delete').style.display = p ? '' : 'none';
  document.getElementById('pj-error').style.display = 'none';
  const rows = p ? _projectAccess.filter(a => a.project_id === p.id) : [];
  const roleIds = new Set(rows.filter(a => a.role_id).map(a => a.role_id));
  _pjUserPicks = rows.filter(a => a.user_id).map(a => a.user_id);
  document.getElementById('pj-roles').innerHTML = _roles.map(r => `
    <label style="font-size:12px;display:flex;align-items:center;gap:4px;">
      <input type="checkbox" class="pj-role-cb" value="${r.id}" ${roleIds.has(r.id) ? 'checked' : ''}> ${escapeHtml(r.label)}
    </label>`).join('');
  renderPjUsers();
  const addSel = document.getElementById('pj-user-add');
  addSel.innerHTML = '<option value="">+ Add specific person…</option>' + _members.map(m => `<option value="${m.id}">${escapeHtml(m.display_name || m.username)}</option>`).join('');
  document.getElementById('pj-modal').style.display = 'flex';
}
function renderPjUsers() {
  document.getElementById('pj-users').innerHTML = _pjUserPicks.map(uid => {
    const m = _members.find(x => x.id === uid);
    return `<div style="font-size:12px;display:flex;justify-content:space-between;align-items:center;background:var(--bg-soft,#f2f2f2);padding:3px 8px;border-radius:4px;">
      <span>${escapeHtml(m?.display_name || m?.username || uid)}</span>
      <button type="button" data-action="remove-pj-user" data-id="${uid}" style="border:none;background:none;cursor:pointer;color:#c0392b;">✕</button>
    </div>`;
  }).join('');
}
window.removePjUser = (uid) => { _pjUserPicks = _pjUserPicks.filter(u => u !== uid); renderPjUsers(); };
document.getElementById('pj-user-add').onchange = (e) => {
  const uid = e.target.value;
  if (uid && !_pjUserPicks.includes(uid)) _pjUserPicks.push(uid);
  e.target.value = '';
  renderPjUsers();
};
window.editProject = (id) => openProjectModal(_projects.find(p => p.id === id));
document.getElementById('btn-new-project').onclick = () => openProjectModal(null);
document.getElementById('pj-close').onclick = document.getElementById('pj-cancel').onclick = () => document.getElementById('pj-modal').style.display = 'none';
document.getElementById('pj-save').onclick = async () => {
  let id = document.getElementById('pj-id').value;
  const name = document.getElementById('pj-name').value.trim();
  const errEl = document.getElementById('pj-error');
  if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
  const isDraft = document.getElementById('pj-draft').checked;
  if (id) {
    const { error } = await supabase.from('task_projects').update({ name, is_draft: isDraft }).eq('id', id);
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  } else {
    const { data, error } = await supabase.from('task_projects').insert({ name, is_draft: isDraft, created_by: _me.id }).select().single();
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    id = data.id;
  }
  const roleIds = [...document.querySelectorAll('.pj-role-cb:checked')].map(cb => cb.value);
  await supabase.from('task_project_access').delete().eq('project_id', id);
  const rows = [...roleIds.map(role_id => ({ project_id: id, role_id })), ..._pjUserPicks.map(user_id => ({ project_id: id, user_id }))];
  if (rows.length) { const { error } = await supabase.from('task_project_access').insert(rows); if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; } }
  document.getElementById('pj-modal').style.display = 'none'; loadAll();
};
document.getElementById('pj-delete').onclick = async () => {
  const id = document.getElementById('pj-id').value;
  if (!confirm('Delete this project and all its tasks?')) return;
  await supabase.from('task_projects').delete().eq('id', id);
  document.getElementById('pj-modal').style.display = 'none'; loadAll();
};

// ── Task modal ──
let _editingTag = null; // id of the single tag/status/color chosen for this task, or null

// Picking a tag for a task is gated the same way as title/project/etc —
// canEdit (= _access.manage). Testers still see the task's tag, just can't
// change it. Single-select: a task has exactly one tag, which is its status
// and its color.
let _tagPickEditingIds = new Set(); // ids of tags currently shown as inline edit rows — any number at once

function buildTagPicker(canEdit) {
  const el = document.getElementById('tk-status-picker');
  if (!_tags.length) {
    el.innerHTML = `<div class="t-empty" style="padding:0;">No tags yet.${canEdit ? ' Use the Tags button above to create some.' : ''}</div>`;
    document.getElementById('tk-tags-note').style.display = 'none';
    return;
  }
  el.innerHTML = _tags.map(tg => {
    if (canEdit && _tagPickEditingIds.has(tg.id)) {
      return `
      <div class="tk-tag-edit-row" data-tag="${tg.id}">
        <input type="color" class="tk-tagpick-color" value="${safeColor(tg.color)}">
        <input type="text" class="tk-tagpick-name" value="${escapeHtml(tg.name)}">
        <button class="tk-tagpick-save" title="Save">✓</button>
        <button class="tk-tagpick-cancel" title="Cancel">✕</button>
      </div>`;
    }
    return `
    <div class="status-pick${_editingTag === tg.id ? ' selected' : ''}" data-tag="${tg.id}" style="${canEdit ? '' : 'cursor:default;opacity:.85;'}">
      <span class="tk-swatch" style="background:${safeColor(tg.color)};"></span>${escapeHtml(tg.name)}
      ${canEdit ? `
      <span class="tk-tagpick-actions">
        <button class="tk-tagpick-edit" data-tag="${tg.id}" title="Rename or recolor">✎</button>
        <button class="tk-tagpick-del" data-tag="${tg.id}" title="Delete tag">🗑</button>
      </span>` : ''}
    </div>`;
  }).join('');

  if (canEdit) {
    el.querySelectorAll('.status-pick').forEach(pick => {
      pick.onclick = (e) => {
        if (e.target.closest('.tk-tagpick-actions')) return; // clicks on edit/delete don't toggle selection
        const id = pick.dataset.tag;
        _editingTag = (_editingTag === id) ? null : id;
        el.querySelectorAll('.status-pick').forEach(p => p.classList.toggle('selected', p.dataset.tag === _editingTag));
      };
    });
    el.querySelectorAll('.tk-tagpick-edit').forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); _tagPickEditingIds.add(btn.dataset.tag); buildTagPicker(canEdit); };
    });
    el.querySelectorAll('.tk-tagpick-del').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.dataset.tag;
        if (!confirm('Delete this tag? It will be removed from any tasks that have it.')) return;
        await deleteTagEverywhere(id);
      };
    });
    el.querySelectorAll('.tk-tag-edit-row').forEach(editRow => {
      const id = editRow.dataset.tag;
      editRow.querySelector('.tk-tagpick-save').onclick = async () => {
        const name = editRow.querySelector('.tk-tagpick-name').value.trim();
        const color = editRow.querySelector('.tk-tagpick-color').value;
        if (!name) return;
        await saveTagEdit(id, name, color);
      };
      editRow.querySelector('.tk-tagpick-cancel').onclick = () => { _tagPickEditingIds.delete(id); buildTagPicker(canEdit); };
    });
  }
  document.getElementById('tk-tags-note').style.display = canEdit ? 'none' : '';
}

// Rename/recolor a tag from the task modal's picker (same effect as editing
// it in the Manage Tags modal — keeps both entry points in sync).
async function saveTagEdit(id, name, color) {
  const { error } = await supabase.from('task_tags').update({ name, color }).eq('id', id);
  if (error) { alert(error.message); return; }
  const tg = _tags.find(t => t.id === id);
  if (tg) { tg.name = name; tg.color = color; }
  _tagPickEditingIds.delete(id);
  buildTagPicker(_access.manage);
  buildLegend();
  render();
}

// Delete a tag from the task modal's picker — removes it from the tag list
// and the current filter. tasks.tag_id references task_tags with ON DELETE NO
// ACTION, so Postgres refuses the delete while any task still carries the tag
// (this function never rewrote tasks.tag_id, despite what it used to claim).
async function deleteTagEverywhere(id) {
  const { error } = await supabase.from('task_tags').delete().eq('id', id);
  if (error) {
    alert(/foreign key|violates/i.test(error.message || '')
      ? 'That status is still assigned to one or more tasks. Move those tasks to another status first, then delete it.'
      : error.message);
    return;
  }
  _tags = _tags.filter(t => t.id !== id);
  _tagFilter.delete(id);
  if (_editingTag === id) _editingTag = null;
  _tagPickEditingIds.delete(id);
  buildTagPicker(_access.manage);
  buildLegend();
  render();
}

// Deep-linking: keep the URL in sync with whichever task is open so the
// address bar always holds a shareable link, and clear it again on close.
function setShareUrlParam(taskId) {
  const url = new URL(window.location.href);
  url.searchParams.set('task', taskId);
  window.history.replaceState({}, '', url);
}
function clearShareUrlParam() {
  const url = new URL(window.location.href);
  if (url.searchParams.has('task')) {
    url.searchParams.delete('task');
    window.history.replaceState({}, '', url);
  }
}
function shareTaskLink(taskId) {
  const url = new URL(window.location.href);
  url.searchParams.set('task', taskId);
  return url.toString();
}
async function copyShareLink(taskId) {
  const link = shareTaskLink(taskId);
  const btn = document.getElementById('tk-share');
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(link);
    btn.textContent = '✓ Link Copied';
  } catch {
    // Clipboard API unavailable (e.g. insecure context) — fall back to a prompt so it can still be copied manually.
    window.prompt('Copy this link to share the task:', link);
    btn.textContent = '✓ Link Ready';
  }
  setTimeout(() => { btn.textContent = original; }, 1800);
}
document.getElementById('tk-share').onclick = () => {
  const id = document.getElementById('tk-id').value;
  if (id) copyShareLink(id);
};

// Opens a task directly from a ?task=<id> URL, bypassing whatever project/
// draft/tag filters are currently active — that's the whole point of a
// share link: it finds the task for you even if you can't find it yourself.
// Expands its project if collapsed and switches off the drafts-only view
// if needed so the task is actually reachable behind the modal too.
function openSharedTaskFromUrl() {
  const id = new URLSearchParams(window.location.search).get('task');
  if (!id) return;
  const t = _tasks.find(x => x.id === id);
  if (!t) {
    alert("That task link doesn't point to a task you can see — it may have been deleted or you may not have access to its project.");
    clearShareUrlParam();
    return;
  }
  if (t.is_draft !== _showDrafts) {
    _showDrafts = t.is_draft;
    document.getElementById('btn-view-drafts').classList.toggle('active', _showDrafts);
  }
  if (isCollapsed(t.project_id)) {
    toggleProjectCollapse(t.project_id);
  }
  render();
  openTaskModal(t);
}

async function openTaskModal(t) {
  document.getElementById('tk-id').value = t?.id || '';
  document.getElementById('tk-name').value = t?.title || '';
  document.getElementById('tk-desc').value = t?.description || '';
  document.getElementById('tk-project').value = t?.project_id || _projects[0]?.id || '';
  document.getElementById('tk-assignee').value = t?.assignee_id || '';
  document.getElementById('tk-due').value = t?.due_date || '';
  document.getElementById('tk-priority').value = t?.priority || 'medium';
  document.getElementById('tk-draft').checked = t?.is_draft || false;
  document.getElementById('tk-title').textContent = t ? 'Edit Task' : 'New Task';

  const canEdit = _access.manage;
  ['tk-name', 'tk-desc', 'tk-project', 'tk-assignee', 'tk-due', 'tk-priority', 'tk-draft'].forEach(id => {
    document.getElementById(id).disabled = !canEdit;
  });
  document.getElementById('tk-draft-row').style.display = canEdit ? '' : 'none';

  // Drafting is the creator's call: RLS only accepts is_draft = true from
  // whoever created the task, so don't offer the checkbox to anyone else.
  const isMine = !t || t.created_by === _me.id;
  const draftLocked = canEdit && !isMine;
  if (draftLocked) document.getElementById('tk-draft').disabled = true;
  document.getElementById('tk-draft-note').style.display = draftLocked ? '' : 'none';

  const createdNote = document.getElementById('tk-created-note');
  if (t && t.created_by) {
    const who = memberName(t.created_by) || 'a former member';
    const when = t.created_at ? ' on ' + new Date(t.created_at).toLocaleDateString() : '';
    createdNote.textContent = `Created by ${who}${when}`;
    createdNote.style.display = '';
  } else {
    createdNote.style.display = 'none';
  }

  document.getElementById('tk-delete').style.display = (t && canEdit) ? '' : 'none';
  document.getElementById('tk-save').style.display = canEdit ? '' : 'none';
  const doneBtn = document.getElementById('tk-mark-done');
  doneBtn.style.display = (t && canEdit) ? '' : 'none';
  doneBtn.textContent = (t && isDoneTask(t)) ? '↺ Mark as Not Done' : '✓ Mark as Done';
  document.getElementById('tk-error').style.display = 'none';
  document.getElementById('tk-comments-wrap').style.display = t ? '' : 'none';
  document.getElementById('tk-share').style.display = t ? '' : 'none';
  if (t) setShareUrlParam(t.id);

  _editingTag = t?.tag_id || null;
  buildTagPicker(canEdit);

  // Testing workflow: submit-for-check-off is available to anyone with task
  // access on an existing task; the check-off toggle only to tester managers
  // (or full managers) once it's actually been submitted or already checked.
  const isCheckedOff = !!t?.checked_off_by;
  const submitBtn = document.getElementById('tk-submit-checkoff');
  submitBtn.style.display = (t && (_access.test || _access.checkoff || _access.manage)) ? '' : 'none';
  const toggleBtn = document.getElementById('tk-checkoff-toggle');
  const canToggle = t && (_access.checkoff || _access.manage) && (isCheckoffTask(t) || isCheckedOff);
  toggleBtn.style.display = canToggle ? '' : 'none';
  toggleBtn.textContent = isCheckedOff ? '↺ Undo Check-off' : '✓ Check Off';

  const noteEl = document.getElementById('tk-checkoff-note');
  if (isCheckedOff) {
    noteEl.style.display = '';
    noteEl.style.color = '#2d7d2f';
    noteEl.textContent = `✓ Checked off by ${memberName(t.checked_off_by) || 'a manager'}${t.checked_off_at ? ' on ' + new Date(t.checked_off_at).toLocaleDateString() : ''}`;
  } else {
    noteEl.style.display = 'none';
  }

  if (t) await loadComments(t.id);
  document.getElementById('tk-modal').style.display = 'flex';
}
window.editTask = (id) => openTaskModal(_tasks.find(t => t.id === id));
// When several tags are marked "done", the quick-action buttons below default
// to the lowest sort_order one — pick a specific done status for a task via
// the status/tag picker in the task modal instead if you want a different one.
function firstDoneTag() {
  return _tags.filter(tg => tg.is_done).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0] || null;
}
window.markDone = async (id) => {
  const doneTag = firstDoneTag();
  if (!doneTag) { alert('No tag is marked as the done status — set one in Manage Tags first.'); return; }
  await supabase.from('tasks').update({ tag_id: doneTag.id, updated_at: new Date().toISOString() }).eq('id', id);
  loadAll();
};
document.getElementById('btn-new-task').onclick = () => {
  if (!_projects.length) { alert('Create a project first.'); return; }
  openTaskModal(null);
};
document.getElementById('tk-close').onclick = document.getElementById('tk-cancel').onclick = () => {
  document.getElementById('tk-modal').style.display = 'none'; clearShareUrlParam();
  clearShareUrlParam();
};

document.getElementById('tk-submit-checkoff').onclick = async () => {
  const id = document.getElementById('tk-id').value;
  if (!id) return;
  if (!confirm('Submit this task for manager check-off?')) return;
  const { error } = await supabase.rpc('submit_task_for_checkoff', { p_task_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById('tk-modal').style.display = 'none'; clearShareUrlParam(); loadAll();
};
document.getElementById('tk-checkoff-toggle').onclick = async () => {
  const id = document.getElementById('tk-id').value;
  if (!id) return;
  const t = _tasks.find(x => x.id === id);
  const fn = t?.checked_off_by ? 'uncheck_task' : 'check_off_task';
  const { error } = await supabase.rpc(fn, { p_task_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById('tk-modal').style.display = 'none'; clearShareUrlParam(); loadAll();
};

document.getElementById('tk-mark-done').onclick = async () => {
  const id = document.getElementById('tk-id').value;
  const t = _tasks.find(x => x.id === id);
  const doneTag = firstDoneTag();
  if (isDoneTask(t)) {
    await supabase.from('tasks').update({ tag_id: null, updated_at: new Date().toISOString() }).eq('id', id);
  } else {
    if (!doneTag) { alert('No tag is marked as the done status — set one in Manage Tags first.'); return; }
    await supabase.from('tasks').update({ tag_id: doneTag.id, updated_at: new Date().toISOString() }).eq('id', id);
  }
  document.getElementById('tk-modal').style.display = 'none'; clearShareUrlParam(); loadAll();
};
// Shows a page-level toast (reuses the fixed #toast element nav.js injects
// into every page) that outlives the task modal, which closes immediately
// on save — so this is the only feedback left once notifyTaskAssignee's
// fire-and-forget call actually resolves.
function showTaskToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

const NOTIFY_SKIP_REASON = {
  opted_out: name => `${name} has task emails turned off, so nothing was sent.`,
  no_email: name => `${name} has no email on file, so nothing was sent.`,
  inactive_account: name => `${name}'s account isn't active, so nothing was sent.`,
  draft: name => `Saved as a draft — ${name} won't be emailed until it's published.`,
  draft_project: name => `That project is a draft — ${name} won't be emailed until it's published.`,
  self_assigned: () => null, // assigning yourself a task needs no email, and no toast either
};

// Fire-and-forget from the caller's perspective (never blocks or fails the
// save — the assignment itself already succeeded), but always surfaces what
// actually happened via a toast, since silently doing nothing is what made
// this look broken in the first place.
async function notifyTaskAssignee(taskId, userId) {
  const name = memberName(userId) || 'the assignee';
  try {
    const { data, error } = await supabase.functions.invoke('notify-task-assignee', {
      body: { task_id: taskId, user_id: userId },
    });
    if (error) {
      console.warn('Task assignment email failed:', error.message || error);
      showTaskToast(`Couldn't email ${name} about this task. They can still see it on the board.`);
      return;
    }
    if (data?.sent) {
      showTaskToast(`📧 Emailed ${name} about this assignment.`);
      return;
    }
    const reason = data?.reason;
    const describe = NOTIFY_SKIP_REASON[reason];
    const msg = describe ? describe(name) : null;
    if (msg) showTaskToast(msg);
  } catch (e) {
    console.warn('Task assignment email failed:', e);
    showTaskToast(`Couldn't email ${name} about this task. They can still see it on the board.`);
  }
}
document.getElementById('tk-save').onclick = async () => {
  const id = document.getElementById('tk-id').value;
  const title = document.getElementById('tk-name').value.trim();
  const errEl = document.getElementById('tk-error');
  if (!title) { errEl.textContent = 'Title is required.'; errEl.style.display = 'block'; return; }
  const assigneeId = document.getElementById('tk-assignee').value || null;
  const payload = {
    title,
    description: document.getElementById('tk-desc').value.trim() || null,
    project_id: document.getElementById('tk-project').value,
    due_date: document.getElementById('tk-due').value || null,
    priority: document.getElementById('tk-priority').value,
    tag_id: _editingTag || null,
    is_draft: document.getElementById('tk-draft').checked,
    updated_at: new Date().toISOString(),
  };
  let error, taskId = id;
  if (id) {
    ({ error } = await supabase.from('tasks').update(payload).eq('id', id));
  } else {
    payload.created_by = _me.id;
    let inserted;
    ({ data: inserted, error } = await supabase.from('tasks').insert(payload).select('id').single());
    taskId = inserted?.id;
  }
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }

  // Sync the single-select assignee against the task_assignees join table.
  const previousTask = id ? _tasks.find(t => t.id === id) : null;
  const previousAssigneeId = previousTask?.assignee_id || null;
  // A task that was a draft never notified anyone, so publishing it counts as
  // a fresh assignment even when the assignee didn't change.
  const justPublished = !!previousTask?.is_draft && !payload.is_draft;
  if (taskId) {
    ({ error } = await supabase.from('task_assignees').delete().eq('task_id', taskId));
    if (!error && assigneeId) {
      ({ error } = await supabase.from('task_assignees').insert({ task_id: taskId, user_id: assigneeId }));
    }
    if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
    // Only notify on an actual change of assignee, so re-saving a task for an
    // unrelated edit doesn't re-email the same person. The edge function
    // handles opt-out, missing email, self-assignment and drafts.
    if (assigneeId && (assigneeId !== previousAssigneeId || justPublished)) {
      notifyTaskAssignee(taskId, assigneeId);
    }
  }

  document.getElementById('tk-modal').style.display = 'none'; clearShareUrlParam(); loadAll();
};
document.getElementById('tk-delete').onclick = async () => {
  const id = document.getElementById('tk-id').value;
  if (!confirm('Delete this task?')) return;
  await supabase.from('tasks').delete().eq('id', id);
  document.getElementById('tk-modal').style.display = 'none'; clearShareUrlParam(); loadAll();
};

// ── Tag manager (admins & owners only — gated via btn-manage-tags visibility) ──
function renderTagMgrList() {
  const el = document.getElementById('tagmgr-list');
  el.innerHTML = _tags.length ? _tags.map(tg => `
    <div class="tag-mgr-row">
      <input type="color" class="tagmgr-color-input" data-id="${tg.id}" value="${safeColor(tg.color)}" style="width:30px;height:30px;padding:0;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:none;flex-shrink:0;">
      <input type="text" class="form-input tagmgr-name-input" data-id="${tg.id}" value="${escapeHtml(tg.name)}" style="flex:1;">
      <input type="number" class="form-input tagmgr-sort-input" data-id="${tg.id}" value="${tg.sort_order ?? 0}" title="Sort order (lower = earlier)" style="width:56px;flex-shrink:0;">
      <label style="font-size:11px;display:flex;align-items:center;gap:3px;white-space:nowrap;">
        <input type="checkbox" class="tagmgr-checkoff-input" data-id="${tg.id}" ${tg.is_checkoff ? 'checked' : ''}> Check-off
      </label>
      <label style="font-size:11px;display:flex;align-items:center;gap:3px;white-space:nowrap;">
        <input type="checkbox" class="tagmgr-done-input" data-id="${tg.id}" ${tg.is_done ? 'checked' : ''}> Done
      </label>
      <div class="tag-mgr-actions">
        <button data-save="${tg.id}" title="Save changes">💾</button>
        <button data-del="${tg.id}" title="Delete tag">🗑</button>
      </div>
    </div>`).join('') : '<div class="t-empty" style="padding:0;">No tags yet — add one below.</div>';

  el.querySelectorAll('[data-save]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.save;
      const name = el.querySelector(`.tagmgr-name-input[data-id="${id}"]`).value.trim();
      const color = el.querySelector(`.tagmgr-color-input[data-id="${id}"]`).value;
      const sortOrder = parseInt(el.querySelector(`.tagmgr-sort-input[data-id="${id}"]`).value, 10) || 0;
      const isCheckoff = el.querySelector(`.tagmgr-checkoff-input[data-id="${id}"]`).checked;
      const isDone = el.querySelector(`.tagmgr-done-input[data-id="${id}"]`).checked;
      const errEl = document.getElementById('tagmgr-error');
      errEl.style.display = 'none';
      if (!name) { errEl.textContent = 'Tag name can\'t be empty.'; errEl.style.display = 'block'; return; }
      // Multiple tags can each be marked check-off and/or done — no longer
      // exclusive, so we no longer clear the flag off any other tag here.
      const { error } = await supabase.from('task_tags').update({ name, color, sort_order: sortOrder, is_checkoff: isCheckoff, is_done: isDone }).eq('id', id);
      if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
      await loadAll();
      renderTagMgrList();
    };
  });
  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Delete this tag? It will be removed from any tasks that have it.')) return;
      const id = btn.dataset.del;
      await supabase.from('task_tags').delete().eq('id', id);
      await loadAll();
      renderTagMgrList();
    };
  });
}

document.getElementById('btn-manage-tags').onclick = () => {
  document.getElementById('tagmgr-error').style.display = 'none';
  document.getElementById('tagmgr-new-name').value = '';
  renderTagMgrList();
  document.getElementById('tagmgr-modal').style.display = 'flex';
};
document.getElementById('tagmgr-close').onclick = document.getElementById('tagmgr-done').onclick = () => {
  document.getElementById('tagmgr-modal').style.display = 'none';
};
document.getElementById('tagmgr-add').onclick = async () => {
  const name = document.getElementById('tagmgr-new-name').value.trim();
  const color = document.getElementById('tagmgr-new-color').value;
  const errEl = document.getElementById('tagmgr-error');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = 'Enter a tag name.'; errEl.style.display = 'block'; return; }
  const { error } = await supabase.from('task_tags').insert({ name, color, created_by: _me.id });
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  document.getElementById('tagmgr-new-name').value = '';
  await loadAll();
  renderTagMgrList();
};

// ── Comments ──
// Tag colours are free-text in the DB but land inside a style="" attribute,
// where a crafted value could close the attribute or inject extra CSS.
function safeColor(c) {
  const v = String(c ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : '#888888';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

let _comments = [];

async function loadComments(taskId) {
  const { data } = await supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at');
  _comments = data || [];
  document.getElementById('tk-comments-label').textContent = `Comments: ${_comments.length}`;
  renderComments();
  _commentCounts[taskId] = _comments.length;
}

function renderComments() {
  document.getElementById('tk-comments').innerHTML = _comments.map(c => {
    const isMine = _me && c.author_id === _me.id;
    const when = new Date(c.created_at).toLocaleString();

    if (c.deleted_at) {
      return `<div class="comment" data-comment-id="${c.id}">
        <div class="comment-meta">${escapeHtml(memberName(c.author_id) || 'Staff')} · ${when}</div>
        <div class="comment-deleted">This message was deleted.</div>
      </div>`;
    }

    const editedTag = c.edited_at ? '<span class="comment-edited-tag">(edited)</span>' : '';
    const actions = isMine ? `
        <span class="comment-actions">
          <button type="button" class="comment-action-btn" data-action="edit" data-id="${c.id}">Edit</button>
          <button type="button" class="comment-action-btn danger" data-action="delete" data-id="${c.id}">Delete</button>
        </span>` : '';

    return `<div class="comment" data-comment-id="${c.id}">
      <div class="comment-meta">${escapeHtml(memberName(c.author_id) || 'Staff')} · ${when} ${editedTag}${actions}</div>
      <div class="comment-body">${escapeHtml(c.body)}</div>
    </div>`;
  }).join('') || '<div class="t-empty">No comments yet.</div>';
}

document.getElementById('tk-comments').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const comment = _comments.find(c => c.id === id);
  if (!comment) return;

  if (btn.dataset.action === 'delete') {
    if (!confirm('Delete this comment? It will be replaced with "This message was deleted."')) return;
    const { error } = await supabase.from('task_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { alert(error.message || 'Could not delete comment.'); return; }
    comment.deleted_at = new Date().toISOString();
    renderComments();
    return;
  }

  if (btn.dataset.action === 'edit') {
    const wrap = document.querySelector(`.comment[data-comment-id="${id}"]`);
    if (!wrap) return;
    wrap.querySelector('.comment-body')?.remove();
    wrap.querySelector('.comment-actions')?.remove();
    const editBox = document.createElement('div');
    editBox.className = 'comment-edit-box';
    editBox.innerHTML = `
      <textarea>${escapeHtml(comment.body)}</textarea>
      <div class="comment-edit-actions">
        <button type="button" class="btn btn-primary" style="font-size:11px;padding:4px 10px;" data-action="save-edit" data-id="${id}">Save</button>
        <button type="button" class="btn btn-outline" style="font-size:11px;padding:4px 10px;" data-action="cancel-edit" data-id="${id}">Cancel</button>
      </div>`;
    wrap.appendChild(editBox);
    editBox.querySelector('textarea').focus();
    return;
  }

  if (btn.dataset.action === 'cancel-edit') {
    renderComments();
    return;
  }

  if (btn.dataset.action === 'save-edit') {
    const wrap = document.querySelector(`.comment[data-comment-id="${id}"]`);
    const newBody = wrap?.querySelector('.comment-edit-box textarea')?.value.trim();
    if (!newBody) { alert('Comment cannot be empty.'); return; }
    const { error } = await supabase.from('task_comments')
      .update({ body: newBody, edited_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { alert(error.message || 'Could not save edit.'); return; }
    comment.body = newBody;
    comment.edited_at = new Date().toISOString();
    renderComments();
    return;
  }
});

document.getElementById('tk-comment-add').onclick = async () => {
  const taskId = document.getElementById('tk-id').value;
  const input = document.getElementById('tk-comment-input');
  const body = input.value.trim();
  if (!body || !taskId) return;
  // The result used to be ignored and the box cleared unconditionally, so an
  // RLS or network failure silently threw away whatever the user had typed.
  const { error } = await supabase.from('task_comments').insert({ task_id: taskId, author_id: _me.id, body });
  if (error) { alert('Could not post that comment: ' + error.message); return; }
  input.value = '';
  loadComments(taskId);
};

init();
