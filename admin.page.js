import { supabase, isAdmin, isOwner, startRolePreview, getMyRolePreview, requireAal2 } from './supabase.js';

// ── Delegated actions (strict CSP) ────────────────────────────────
// Inline handler attributes are blocked by the strict script-src policy,
// so every button/row above is wired through these listeners instead.
// data-action names the action; data-id / data-index / data-label carry
// the values the old inline handler used to inline. Handlers run at click
// time, after this module has fully evaluated, so window-assigned page
// functions are available here exactly as they were to inline handlers.

const _ACTION_HANDLERS = {
  'grant-membership': (el, e) => window.grantMembership(el.dataset.id),
  'revoke-membership': (el, e) => window.revokeMembership(el.dataset.id),
  'extend-membership': (el, e) => window.extendMembership(el.dataset.id),
  'allow-email': (el, e) => window.allowEmail(el.dataset.id),
  'revoke-email': (el, e) => window.revokeEmail(el.dataset.id),
  'revoke-discord': (el, e) => window.revokeDiscord(el.dataset.id),
  'revoke-google': (el, e) => window.revokeGoogle(el.dataset.id),
  'freeze-account': (el, e) => window.freezeAccount(el.dataset.id),
  'unfreeze-account': (el, e) => window.unfreezeAccount(el.dataset.id),
  'delete-account': (el, e) => window.deleteAccount(el.dataset.id),
  'open-email-member-modal': (el, e) => window.openEmailMemberModal(el.dataset.id),
  'open-role-modal': (el, e) => window.openRoleModal(el.dataset.id),
  'delete-role': (el, e) => window.deleteRole(el.dataset.id),
  'approve-article': (el, e) => window.approveArticle(el.dataset.id),
  'reject-article': (el, e) => window.rejectArticle(el.dataset.id),
  'unpublish-article': (el, e) => window.unpublishArticle(el.dataset.id),
  'publish-article': (el, e) => window.publishArticle(el.dataset.id),
  'edit-article': (el, e) => window.editArticle(el.dataset.id),
  'delete-article': (el, e) => window.deleteArticle(el.dataset.id),
  'publish-doc': (el, e) => window.publishDoc(el.dataset.id),
  'unpublish-doc': (el, e) => window.unpublishDoc(el.dataset.id),
  'edit-doc': (el, e) => window.editDoc(el.dataset.id),
  'delete-doc': (el, e) => window.deleteDoc(el.dataset.id),
  'publish-faq': (el, e) => window.publishFaq(el.dataset.id),
  'unpublish-faq': (el, e) => window.unpublishFaq(el.dataset.id),
  'edit-faq': (el, e) => window.editFaq(el.dataset.id),
  'delete-faq': (el, e) => window.deleteFaq(el.dataset.id),
  'approve-m-c': (el, e) => window.approveMC(el.dataset.id),
  'revoke-m-c': (el, e) => window.revokeMC(el.dataset.id),
  'approve-company': (el, e) => window.approveCompany(el.dataset.id),
  'reject-company': (el, e) => window.rejectCompany(el.dataset.id),
  'admin-edit-product': (el, e) => window.adminEditProduct(el.dataset.id),
  'admin-delete-product': (el, e) => window.adminDeleteProduct(el.dataset.id),
  'open-nation-modal': (el, e) => window.openNationModal(el.dataset.id),
  'delete-nation': (el, e) => window.deleteNation(el.dataset.id),
  'toggle-nation-owner': (el, e) => window.toggleNationOwner(el.dataset.id),
  'open-leader-modal': (el, e) => window.openLeaderModal(el.dataset.id),
  'delete-leader': (el, e) => window.deleteLeader(el.dataset.id),
  'open-history-server-modal': (el, e) => window.openHistoryServerModal(el.dataset.id),
  'delete-history-server': (el, e) => window.deleteHistoryServer(el.dataset.id),
  'open-c-p-modal': (el, e) => window.openCPModal(el.dataset.id),
  'delete-club-president': (el, e) => window.deleteClubPresident(el.dataset.id),
  'unclaim-thread': (el, e) => window.unclaimThread(el.dataset.id),
  'claim-thread': (el, e) => window.claimThread(el.dataset.id),
  'toggle-thread-expand': (el, e) => window.toggleThreadExpand(el.dataset.id),
  'send-message-reply': (el, e) => window.sendMessageReply(el.dataset.id),
  'delete-message': (el, e) => window.deleteMessage(el.dataset.id),
  'view-as-role': (el, e) => window.viewAsRole(el.dataset.id, el.dataset.label),
  'toggle-message-read': (el, e) => window.toggleMessageRead(el.dataset.id, el.dataset.read === '1'),
  'save-staged-roles': (el, e) => window._saveStagedRoles(el.dataset.id),
  'pm-remove-image': (el, e) => window.pmRemoveImage(Number(el.dataset.index)),
  'toggle-audit-detail': (el, e) => window.toggleAuditDetail(Number(el.dataset.index)),
  'close-role-popup': (el, e) => window.closeRolePopup(),
  'open-role-popup': (el, e) => window.openRolePopup({ currentTarget: el }, el.dataset.id),
  'toggle-staged-role': (el, e) => window._toggleStagedRole(el.dataset.id),
  'roles-more': (el, e) => (() => { const hidden = el.nextElementSibling, less = hidden.nextElementSibling; el.style.display = 'none'; hidden.style.display = 'inline'; less.style.display = 'inline-flex'; less.focus(); })(),
  'roles-less': (el, e) => (() => { const hidden = el.previousElementSibling, more = hidden.previousElementSibling; el.style.display = 'none'; hidden.style.display = 'none'; more.style.display = 'inline'; more.focus(); })(),
  'goto-tab': (el, e) => document.querySelector('[data-tab=' + el.dataset.tab + ']').click(),
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


// The two product-form selects used to call module-scope functions from
// static onchange attributes, which never worked (module scope is not
// global). Delegated change events call them directly, which also fixes
// those two selects.
document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('[data-change]');
  if (!sel) return;
  if (sel.dataset.change === 'toggle-inventory-field') toggleInventoryField();
  else if (sel.dataset.change === 'toggle-billing-anchor-date') toggleBillingAnchorDate();
});


// ── State ─────────────────────────────────────────────────────
let _allMembers   = [];
let _allRoles     = [];
let _authUsers    = {};
let _myPermissions = {};
let _myLevel      = 0;
let _session      = null;

const ALL_PERMISSIONS = [
  { key: 'can_view_admin',       label: 'View Admin Panel',        group: 'admin' },
  { key: 'can_manage_users',     label: 'Manage Users',            group: 'users' },
  { key: 'can_assign_roles',     label: 'Assign Roles to Members', group: 'users' },
  { key: 'can_assign_admin',     label: 'Assign Admin / Owner',    group: 'users' },
  { key: 'can_manage_roles',     label: 'Edit Role Permissions',   group: 'roles' },
  { key: 'can_create_roles',     label: 'Create / Delete Roles',   group: 'roles' },
  { key: 'can_manage_news',      label: 'Write & Edit News',       group: 'content' },
  { key: 'can_publish_news',     label: 'Publish / Unpublish',     group: 'content' },
  { key: 'can_approve_news',     label: 'Approve Pending Articles', group: 'content' },
  { key: 'can_manage_archive',   label: 'Write & Edit Archive',    group: 'content' },
  { key: 'can_manage_faqs',      label: 'Write & Edit FAQs',       group: 'content' },
  { key: 'can_manage_shop',      label: 'Manage Shop Products',    group: 'content' },
  { key: 'can_manage_memberships', label: 'Grant / Revoke Memberships', group: 'content' },
  { key: 'can_bypass_membership', label: 'Bypass Membership Requirement', group: 'content' },
  { key: 'can_manage_config',    label: 'Edit Site Config',        group: 'content' },
  { key: 'can_manage_minecraft', label: 'MC Verifications',        group: 'content' },
  { key: 'can_manage_economy',   label: 'Approve Companies & Manage Economy', group: 'content' },
  { key: 'can_manage_treasury',  label: 'Issue Marks / Manage Treasury', group: 'content' },
  { key: 'can_lock_site',        label: 'Lock / Unlock Site',      group: 'admin' },
  { key: 'can_manage_tasks',     label: 'Manage Task Board',       group: 'admin' },
  { key: 'can_test_tasks',       label: 'Tester: Submit Check-offs', group: 'admin' },
  { key: 'can_check_off_tasks',  label: 'Tester Manager: Check Off Tasks', group: 'admin' },
  { key: 'can_view_audit_log',   label: 'View Audit Log',          group: 'admin' },
  { key: 'can_manage_congress',              label: 'Manage Congress (chambers, committees, measures, votes)', group: 'congress' },
  { key: 'can_sponsor_congress_legislation', label: 'Sponsor / Introduce Legislation',       group: 'congress' },
  { key: 'can_certify_congress_votes',       label: 'Certify Roll Call Results',             group: 'congress' },
  { key: 'can_correct_congress_certifications', label: 'Correct Certified Votes (audited)',  group: 'congress' },
  { key: 'can_moderate_congress_debate',     label: 'Moderate Congress Debate',              group: 'congress' },
  { key: 'can_manage_court',                 label: 'Manage Court (justices, docket, calendar, rulings)', group: 'court' },
  { key: 'can_file_court_cases',             label: 'File Cases With the Court',             group: 'court' },
  { key: 'can_certify_court_rulings',        label: 'Certify Roll Call Rulings',             group: 'court' },
  { key: 'can_correct_court_certifications', label: 'Correct Certified Rulings (audited)',   group: 'court' },
  { key: 'can_moderate_court_filings',       label: 'Moderate Court Arguments',              group: 'court' },
];

// ── Init ─────────────────────────────────────────────────────
async function init() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    _session = session;

    if (!session?.user) { show('denied'); return; }
    if (!(await requireAal2('admin.html'))) return;

    await loadMyPermissions(session.user);

    if (!_myPermissions.can_view_admin) { show('denied'); return; }

    show('main');

    if (!_myPermissions.can_manage_roles && !_myPermissions.can_create_roles) {
      document.getElementById('tab-btn-roles').classList.add('hidden');
    }
    if (!_myPermissions.can_view_audit_log) {
      document.getElementById('tab-btn-audit-log').classList.add('hidden');
    }
    if (!_myPermissions.can_manage_economy) {
      document.getElementById('tab-btn-economy').classList.add('hidden');
    }

    const levelLabel = _myLevel >= 100 ? 'Owner' : _myLevel >= 80 ? 'Administrator' : 'Staff';
    document.getElementById('admin-hero-meta').textContent = 'Signed in as ' + levelLabel;

    await Promise.all([loadAll(), loadAllRoles()]);
    checkPluginBridge();
    checkEconomyPlugin();
    loadLockState();
    loadPendingNewsCount();
    loadPendingCompanyCount();
    restoreActiveTab();
    // initPresenceWatcher(); // disabled — see commented block below
  } catch(e) {
    console.error('Admin init error:', e);
    show('denied');
    document.querySelector('.admin-denied p').textContent = 'Error loading admin panel: ' + e.message;
  }
}

// ── Active viewers (Supabase Realtime Presence) ──────────────────
// Disabled — was getting stuck / not loading. Commented out (not deleted)
// so it can be re-enabled later if wanted.
/*
function initPresenceWatcher() {
  try {
    const render = (channel) => {
      const state = channel.presenceState();
      const entries = Object.values(state).flat();
      const countEl = document.getElementById('stat-active-now');
      const listEl  = document.getElementById('active-viewers-list');
      if (countEl) countEl.textContent = entries.length;
      if (!listEl) return;
      if (entries.length === 0) {
        listEl.textContent = 'No one is currently on the site.';
        return;
      }
      const named = entries.filter(e => e.name).sort((a, b) => a.name.localeCompare(b.name));
      const anonCount = entries.length - named.length;
      let html = '';
      if (named.length) {
        html += named.map(e => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="color:var(--black);font-weight:600;">${escapeHtml(e.name)}</span>
            <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">${(e.page || '').replace('.html','') || 'home'}</span>
          </div>`).join('');
      }
      if (anonCount > 0) {
        html += `<div style="padding:8px 0;color:var(--muted);">${anonCount} anonymous visitor${anonCount !== 1 ? 's' : ''}</div>`;
      }
      listEl.innerHTML = html;
    };

    // nav.js (loaded on every page, including this one) already opens and
    // subscribes to the 'site-presence' channel to track this admin's own
    // presence. Reuse that same channel instead of opening a second join
    // to the same topic, which conflicts with the first.
    let attempts = 0;
    const waitForChannel = setInterval(() => {
      attempts++;
      const channel = window._mcaPresenceChannel;
      if (channel) {
        clearInterval(waitForChannel);
        channel.on('presence', { event: 'sync' }, () => render(channel));
        channel.on('presence', { event: 'join' }, () => render(channel));
        channel.on('presence', { event: 'leave' }, () => render(channel));
        render(channel); // draw immediately with whatever state is already synced
        setInterval(() => render(channel), 8000); // safety-net refresh
      } else if (attempts >= 30) { // ~6s
        clearInterval(waitForChannel);
        const listEl = document.getElementById('active-viewers-list');
        if (listEl) listEl.textContent = 'Unable to load active viewers right now.';
      }
    }, 200);
  } catch(e) { console.error('Presence watcher error:', e); }
}
*/

async function loadMyPermissions(user) {
  _myPermissions = {};
  _myLevel = 0;

  // Server-side permission system is the sole source of truth. A failed or
  // errored RPC call means zero permissions — it must never fall back to a
  // broader grant (e.g. treating profiles.role as admin/owner). Every real
  // admin/owner account is provisioned in the new role system, so there is
  // no legitimate case where this needs to fail open.
  try {
    const { data: roles, error } = await supabase
      .rpc('get_user_roles', { p_user_id: user.id });
    if (error) throw error;
    (roles || []).forEach(r => {
      if (r.level > _myLevel) _myLevel = r.level;
      Object.entries(r.permissions || {}).forEach(([k, v]) => {
        if (v === true) _myPermissions[k] = true;
      });
    });
  } catch(e) {
    console.error('loadMyPermissions error — denying access:', e);
    _myPermissions = {};
    _myLevel = 0;
  }
}

function show(which) {
  document.getElementById('admin-loading').style.display = 'none';
  document.getElementById('admin-denied').style.display  = which === 'denied' ? 'block' : 'none';
  document.getElementById('admin-main').style.display    = which === 'main'   ? 'block' : 'none';
}

// Columns actually needed by the member list, excluding credential/token
// fields (password_reset_token, pending_email_token, mc_verify_code, etc.)
// that are no longer selectable by any client role — see the profiles
// column-select-allowlist migration.
const PROFILES_SAFE_COLUMNS = 'id, username, display_name, minecraft_username, role, created_at, discord_id, minecraft_verified, email, minecraft_uuid, email_access_revoked, account_status, deletion_scheduled_at, google_id, news_email_opt_in, deactivated_at, task_email_opt_in, membership_status, membership_source, membership_current_period_end';

async function loadAll() {
  // Load members with stacked roles via RPC
  try {
    const { data, error } = await supabase.rpc('get_members_with_roles');
    if (!error) _allMembers = data || [];
    else {
      // Fallback to profiles table if RPC doesn't exist yet
      const { data: pd } = await supabase.from('profiles').select(PROFILES_SAFE_COLUMNS).order('created_at', { ascending: false });
      _allMembers = (pd || []).map(p => ({ ...p, roles: [] }));
    }
  } catch(e) {
    const { data: pd } = await supabase.from('profiles').select(PROFILES_SAFE_COLUMNS).order('created_at', { ascending: false });
    _allMembers = (pd || []).map(p => ({ ...p, roles: [] }));
  }

  // Auth info
  try {
    const { data: authData } = await supabase.rpc('get_auth_users_info');
    _authUsers = {};
    (authData || []).forEach(u => { _authUsers[u.id] = u; });
  } catch(e) {}

  renderStats();
  renderMembers(_allMembers);
  renderMinecraftLists();
  populateRoleFilter();
}

async function loadAllRoles() {
  try {
    const { data, error } = await supabase.from('roles').select('*').order('level', { ascending: false });
    // If we get data (even empty array), migration has run fine
    if (!error) {
      _allRoles = data || [];
    } else {
      // RLS or other error — try fetching without order as fallback
      const { data: d2 } = await supabase.from('roles').select('*');
      _allRoles = d2 || [];
    }
  } catch(e) {
    _allRoles = [];
  }
  renderRoles();
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  document.getElementById('stat-members').textContent     = _allMembers.length;
  const adminCount = _allMembers.filter(m => (m.roles||[]).some(r => r.level >= 80)).length;
  document.getElementById('stat-admins').textContent      = adminCount;
  document.getElementById('stat-mc-verified').textContent = _allMembers.filter(m => m.minecraft_verified).length;
  document.getElementById('stat-mc-pending').textContent  = _allMembers.filter(m => m.minecraft_username && !m.minecraft_verified).length;
}

// ── Role filter dropdown ──────────────────────────────────────
function populateRoleFilter() {
  const sel = document.getElementById('filter-role');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Roles</option>';
  _allRoles.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.name;
    opt.textContent = r.label;
    if (r.name === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ── Members ───────────────────────────────────────────────────
let _memberFilter = { search: '', role: '', mc: '' };

function applyMemberFilters() {
  const { search, role, mc } = _memberFilter;
  const q = search.toLowerCase();
  return _allMembers.filter(m => {
    if (q && !(
      (m.display_name||'').toLowerCase().includes(q) ||
      (m.username||'').toLowerCase().includes(q) ||
      (m.email||'').toLowerCase().includes(q)
    )) return false;
    if (role && !(m.roles||[]).some(r => r.name === role)) return false;
    if (mc === 'verified' && !m.minecraft_verified) return false;
    if (mc === 'pending'  && !(m.minecraft_username && !m.minecraft_verified)) return false;
    if (mc === 'none'     && m.minecraft_username) return false;
    return true;
  });
}

function renderMembers(members) {
  document.getElementById('member-count-badge').textContent = members.length;
  const tbody = document.getElementById('members-tbody');
  const clearBtn = document.getElementById('filter-clear');
  const hasFilters = _memberFilter.search || _memberFilter.role || _memberFilter.mc;
  clearBtn.style.display = hasFilters ? '' : 'none';

  if (!members.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted);">No members found.</td></tr>`;
    return;
  }
  tbody.innerHTML = members.map(m => {
    const name = m.display_name || m.username || '—';
    const memberRoles = m.roles || [];

    // Role badges + assignment button — sort highest-level first, collapse past 3 to reduce clutter
    const sortedRoles = [...memberRoles].sort((a, b) => (b.level||0) - (a.level||0));
    const roleBadge = r => `<span class="role-badge" style="background:${safeColor(r.color)}22;color:${safeColor(r.color)};border:1px solid ${safeColor(r.color)}44;">${escapeHtml(r.label)}</span>`;
    const VISIBLE_ROLE_COUNT = 3;
    const visibleRoles = sortedRoles.slice(0, VISIBLE_ROLE_COUNT);
    const overflowRoles = sortedRoles.slice(VISIBLE_ROLE_COUNT);
    const roleBadgesHtml = visibleRoles.map(roleBadge).join('') +
      (overflowRoles.length
        ? `<span class="role-badge role-more-toggle" style="cursor:pointer;background:var(--bg);color:var(--muted);border:1px dashed var(--border);" title="${escapeHtml(overflowRoles.map(r=>r.label).join(', '))}" role="button" tabindex="0" data-action="roles-more">+${overflowRoles.length} more</span><span style="display:none;">${overflowRoles.map(roleBadge).join('')}</span><span class="role-badge role-less-toggle" style="display:none;cursor:pointer;background:var(--bg);color:var(--muted);border:1px dashed var(--border);" role="button" tabindex="0" data-action="roles-less">− less</span>`
        : '');

    // Can this user's roles be changed by current viewer?
    const targetMaxLevel = memberRoles.reduce((max, r) => Math.max(max, r.level||0), 0);
    const canEdit = _myPermissions.can_assign_roles &&
      (targetMaxLevel < _myLevel || _myPermissions.can_assign_admin);

    const rolesCell = `<div class="role-badges-wrap">${roleBadgesHtml || '<span style="font-size:12px;color:var(--muted);">—</span>'}
      ${canEdit ? `<button class="btn btn-outline btn-sm" data-action="open-role-popup" data-id="${m.id}" style="margin-left:4px;">Edit</button>` : ''}
    </div>`;

    // Account badges
    const auth = _authUsers[m.id] || {};
    const emailVerified = auth.email_confirmed_at;
    const hasDiscord = (auth.providers||[]).includes('discord');
    const hasGoogle  = (auth.providers||[]).includes('google');
    const accountStatus = m.account_status || 'active';

    const emailBadge = !m.email
      ? `<span class="badge badge-unlinked">No Email</span>`
      : emailVerified
        ? `<span class="badge badge-verified">✉ Verified</span>`
        : `<span class="badge badge-pending">✉ Unverified</span>`;
    const discordBadge = hasDiscord
      ? `<span class="badge badge-verified" style="background:#5865F2;color:#fff;">Discord</span>`
      : `<span class="badge badge-unlinked">No Discord</span>`;
    const googleBadge = hasGoogle
      ? `<span class="badge badge-verified" style="background:#fff;color:#3c4043;border:1px solid var(--border);">Google</span>`
      : '';
    const statusBadge = accountStatus === 'frozen'
      ? `<span class="badge" style="background:#fff8e1;color:#b07d00;">⏸ Frozen</span>`
      : '';

    const mcBadge = m.minecraft_verified
      ? `<span class="badge badge-verified">Verified</span>`
      : m.minecraft_username
        ? `<span class="badge badge-pending">Pending</span>`
        : `<span class="badge badge-unlinked">None</span>`;

    // Membership: active is only "real" while the current period hasn't
    // lapsed yet, whether that period came from Stripe or an admin comp.
    const periodEnd = m.membership_current_period_end ? new Date(m.membership_current_period_end) : null;
    const isActiveMember = m.membership_status === 'active' && periodEnd && periodEnd.getTime() > Date.now();
    const membershipBadge = isActiveMember
      ? `<span class="badge badge-verified">${m.membership_source === 'admin_grant' ? 'Comped' : m.membership_source === 'test_checkout' ? 'Active (Test)' : 'Active'}</span>`
      : m.membership_status === 'past_due'
        ? `<span class="badge badge-pending">${periodEnd && periodEnd.getTime() > Date.now() ? 'Grace' : 'Expired'}</span>`
        : m.membership_status && m.membership_status !== 'none'
          ? `<span class="badge badge-unlinked">${m.membership_status === 'canceled' && periodEnd && periodEnd.getTime() > Date.now() ? 'Cancelled' : 'Expired'}</span>`
          : `<span class="badge badge-unlinked">None</span>`;
    const grantMembershipBtn = !isActiveMember && _myPermissions.can_manage_memberships
      ? `<button class="btn btn-outline btn-sm" data-action="grant-membership" data-id="${m.id}">Grant</button>` : '';
    const revokeMembershipBtn = isActiveMember && _myPermissions.can_manage_memberships
      ? `<button class="btn btn-danger btn-sm" data-action="revoke-membership" data-id="${m.id}">Revoke</button>` : '';
    const extendMembershipBtn = _myPermissions.can_manage_memberships
      ? `<button class="btn btn-outline btn-sm" data-action="extend-membership" data-id="${m.id}">Extend…</button>` : '';

    const allowEmailBtn = !emailVerified && m.email && _myPermissions.can_manage_users
      ? `<button class="btn btn-secondary btn-sm" data-action="allow-email" data-id="${m.id}">Allow Email</button>` : '';
    const revokeEmailBtn = m.email && _myPermissions.can_manage_users
      ? `<button class="btn btn-danger btn-sm" data-action="revoke-email" data-id="${m.id}">Revoke Email</button>` : '';
    const revokeDiscordBtn = hasDiscord && _myPermissions.can_manage_users
      ? `<button class="btn btn-danger btn-sm" data-action="revoke-discord" data-id="${m.id}">Revoke Discord</button>` : '';
    const revokeGoogleBtn = hasGoogle && _myPermissions.can_manage_users
      ? `<button class="btn btn-danger btn-sm" data-action="revoke-google" data-id="${m.id}">Revoke Google</button>` : '';
    const freezeBtn = accountStatus === 'active' && _myPermissions.can_manage_users
      ? `<button class="btn btn-outline btn-sm" data-action="freeze-account" data-id="${m.id}">Freeze</button>` : '';
    const unfreezeBtn = accountStatus === 'frozen' && _myPermissions.can_manage_users
      ? `<button class="btn btn-success btn-sm" data-action="unfreeze-account" data-id="${m.id}">Unfreeze</button>` : '';
    const deleteBtn = _myPermissions.can_manage_users && !['owner','super_admin'].includes(m.role)
      ? `<button class="btn btn-danger btn-sm" data-action="delete-account" data-id="${m.id}">Delete</button>` : '';
    const emailMemberBtn = m.email && !m.email_access_revoked && _myPermissions.can_manage_users
      ? `<button class="btn btn-outline btn-sm" data-action="open-email-member-modal" data-id="${m.id}">Email</button>` : '';

    return `<tr>
      <td>
        <div class="member-name">${escapeHtml(name)}</div>
        ${m.username && m.display_name ? `<div class="member-email">@${escapeHtml(m.username)}</div>` : ''}
      </td>
      <td><div class="member-email">${escapeHtml(m.email||'—')}</div></td>
      <td>${rolesCell}</td>
      <td style="white-space:nowrap;">
        <div style="display:flex;flex-direction:column;gap:4px;">${emailBadge}${discordBadge}${googleBadge}${statusBadge}</div>
      </td>
      <td>${mcBadge}</td>
      <td>
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
          ${membershipBadge}
          ${grantMembershipBtn}${revokeMembershipBtn}${extendMembershipBtn}
        </div>
      </td>
      <td>
        <div class="btn-actions">
          ${emailMemberBtn}${allowEmailBtn}${revokeEmailBtn}${revokeDiscordBtn}${revokeGoogleBtn}
          ${freezeBtn}${unfreezeBtn}${deleteBtn}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Role popup for member row ─────────────────────────────────
let _popupEl = null;
let _popupState = null;
window.openRolePopup = (event, userId) => {
  closeRolePopup();
  const member = _allMembers.find(m => m.id === userId);
  if (!member) return;
  const originalRoleIds = new Set((member.roles||[]).map(r => r.role_id));
  const stagedRoleIds = new Set(originalRoleIds); // working copy, only committed on Save

  const popup = document.createElement('div');
  popup.className = 'role-popup';
  popup.style.cssText = 'position:absolute;';

  // Determine which roles can be offered
  const assignableRoles = _allRoles.filter(r => {
    if (r.level >= 80 && !_myPermissions.can_assign_admin) return false;
    if (r.level >= _myLevel && !_myPermissions.can_assign_admin) return false;
    return true;
  });

  function renderItems() {
    return assignableRoles.map(r => {
      const has = stagedRoleIds.has(r.id);
      return `<div class="role-popup-item" data-role-id="${r.id}" data-action="toggle-staged-role" data-id="${r.id}" role="checkbox" aria-checked="${has}" tabindex="0">
        <span class="role-popup-dot" style="background:${safeColor(r.color)};"></span>
        <span style="flex:1;">${escapeHtml(r.label)}</span>
        ${has ? `<span class="role-popup-check">✓</span>` : ''}
      </div>`;
    }).join('');
  }

  popup.innerHTML = `
    <div style="padding:8px 14px 6px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);">Assign Roles</div>
    <div id="role-popup-items">${renderItems()}</div>
    <div id="role-popup-error" style="display:none;font-size:11px;color:#c0392b;padding:4px 14px 0;"></div>
    <div style="border-top:1px solid var(--border);padding:8px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <button data-action="close-role-popup" style="font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;padding:0;">Cancel</button>
      <button id="role-popup-save" class="btn btn-primary btn-sm" data-action="save-staged-roles" data-id="${userId}">Save</button>
    </div>`;

  // Position near the button
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const wrap = document.querySelector('.members-table-wrap');
  const wrapRect = wrap.getBoundingClientRect();
  popup.style.top  = (rect.bottom - wrapRect.top + wrap.scrollTop + 4) + 'px';
  popup.style.left = (rect.left   - wrapRect.left) + 'px';

  wrap.style.position = 'relative';
  wrap.appendChild(popup);
  _popupEl = popup;
  _popupState = { userId, originalRoleIds, stagedRoleIds, renderItems, popup };

  setTimeout(() => { document.addEventListener('click', closeRolePopupOutside); }, 0);
};

window._toggleStagedRole = (roleId) => {
  if (!_popupState) return;
  const { stagedRoleIds } = _popupState;
  if (stagedRoleIds.has(roleId)) stagedRoleIds.delete(roleId);
  else stagedRoleIds.add(roleId);
  const itemsEl = document.getElementById('role-popup-items');
  if (itemsEl) itemsEl.innerHTML = _popupState.renderItems();
};

window._saveStagedRoles = async (userId) => {
  if (!_popupState || _popupState.userId !== userId) return;
  const { originalRoleIds, stagedRoleIds } = _popupState;
  const toAdd = [...stagedRoleIds].filter(id => !originalRoleIds.has(id));
  const toRemove = [...originalRoleIds].filter(id => !stagedRoleIds.has(id));
  const errEl = document.getElementById('role-popup-error');
  const saveBtn = document.getElementById('role-popup-save');

  if (!toAdd.length && !toRemove.length) { closeRolePopup(); return; }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
  try {
    for (const roleId of toAdd) {
      const { error } = await supabase.rpc('assign_role_to_user', { p_user_id: userId, p_role_id: roleId });
      if (error) throw error;
    }
    for (const roleId of toRemove) {
      const { error } = await supabase.rpc('revoke_role_from_user', { p_user_id: userId, p_role_id: roleId });
      if (error) throw error;
    }
    closeRolePopup();
    await loadAll();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  }
};

function closeRolePopupOutside(e) {
  if (_popupEl && !_popupEl.contains(e.target)) closeRolePopup();
}
window.closeRolePopup = () => {
  if (_popupEl) { _popupEl.remove(); _popupEl = null; }
  _popupState = null;
  document.removeEventListener('click', closeRolePopupOutside);
};

// Filter events
document.getElementById('member-search').addEventListener('input', function() {
  _memberFilter.search = this.value;
  renderMembers(applyMemberFilters());
});
document.getElementById('filter-role').addEventListener('change', function() {
  _memberFilter.role = this.value;
  renderMembers(applyMemberFilters());
});
document.getElementById('filter-mc').addEventListener('change', function() {
  _memberFilter.mc = this.value;
  renderMembers(applyMemberFilters());
});
document.getElementById('filter-clear').addEventListener('click', () => {
  _memberFilter = { search: '', role: '', mc: '' };
  document.getElementById('member-search').value  = '';
  document.getElementById('filter-role').value    = '';
  document.getElementById('filter-mc').value      = '';
  renderMembers(applyMemberFilters());
});

// ── Roles panel ───────────────────────────────────────────────
function renderRoles() {
  const el = document.getElementById('roles-list');
  if (!_allRoles.length) {
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px;">No roles found. Run the migration SQL first.</div>';
    return;
  }
  el.innerHTML = _allRoles.map(r => {
    const activePerms = ALL_PERMISSIONS.filter(p => r.permissions?.[p.key]);
    const chips = activePerms.map(p => `<span class="perm-chip">${escapeHtml(p.label)}</span>`).join('');
    const memberCount = _allMembers.filter(m => (m.roles||[]).some(x => x.role_id === r.id)).length;

    const canEdit = _myPermissions.can_manage_roles &&
      !(r.name === 'owner' && _myLevel < 100) &&
      !(r.level >= _myLevel && !_myPermissions.can_assign_admin);

    const canDelete = _myPermissions.can_create_roles && !r.is_system;

    // "View as" impersonates real DB-level access via the previewed role's
    // permissions, so it's gated the same way starting a preview is gated
    // server-side: real can_manage_roles, and only for roles at or below
    // the admin's own real level (previewing "up" would be privilege
    // escalation, not a preview).
    const canViewAs = _myPermissions.can_manage_roles && r.level <= _myLevel;

    return `<div class="role-card">
      <div class="role-card-color" style="background:${safeColor(r.color)};"></div>
      <div class="role-card-body">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <div class="role-card-name">${escapeHtml(r.label)}
              ${r.is_system ? '<span style="font-size:10px;color:var(--muted);font-weight:400;margin-left:6px;">(system)</span>' : ''}
            </div>
            <div class="role-card-meta">Level ${escapeHtml(r.level)} · <code style="font-family:monospace;font-size:11px;">${escapeHtml(r.name)}</code> · ${memberCount} member${memberCount !== 1 ? 's' : ''}</div>
          </div>
          <div style="display:flex;gap:6px;">
            ${canViewAs ? `<button class="btn btn-outline btn-sm" data-action="view-as-role" data-id="${r.id}" data-label="${escapeHtml(r.label)}" title=""Browse the live site with exactly this role's real permissions">View as</button>` : ''}
            ${canEdit ? `<button class="btn btn-outline btn-sm" data-action="open-role-modal" data-id="${r.id}">Edit</button>` : ''}
            ${canDelete ? `<button class="btn btn-danger btn-sm" data-action="delete-role" data-id="${r.id}">Delete</button>` : ''}
          </div>
        </div>
        <div class="role-card-perms">${chips || '<span style="font-size:12px;color:var(--muted);">No permissions</span>'}</div>
      </div>
    </div>`;
  }).join('');
}

// Role modal
function buildPermGrid(currentPerms = {}) {
  const grid = document.getElementById('rm-perm-grid');
  grid.innerHTML = ALL_PERMISSIONS.map(p => `
    <label class="perm-toggle">
      <input type="checkbox" name="perm" value="${escapeHtml(p.key)}" ${currentPerms[p.key] ? 'checked' : ''}>
      <span class="perm-toggle-label">${escapeHtml(p.label)}<span class="perm-toggle-key">${escapeHtml(p.key)}</span></span>
    </label>`).join('');
}

window.openRoleModal = (id) => {
  const role = id ? _allRoles.find(r => r.id === id) : null;
  document.getElementById('rm-id').value    = role?.id || '';
  document.getElementById('rm-name').value  = role?.name || '';
  document.getElementById('rm-label').value = role?.label || '';
  document.getElementById('rm-color').value = role?.color || '#888888';
  document.getElementById('rm-level').value = role?.level || 10;
  const nameInput = document.getElementById('rm-name');
  nameInput.disabled = !!(role?.is_system);  // can't rename system roles
  document.getElementById('rm-title').textContent = role ? `Edit: ${role.label}` : 'New Role';
  document.getElementById('rm-error').style.display = 'none';
  buildPermGrid(role?.permissions || {});
  document.getElementById('role-modal').style.display = 'flex';
};

document.getElementById('btn-add-role').addEventListener('click', () => {
  if (!_myPermissions.can_create_roles) { alert('Only the Owner can create new roles.'); return; }
  openRoleModal(null);
});

function closeRoleModal() { document.getElementById('role-modal').style.display = 'none'; }
document.getElementById('rm-close').addEventListener('click',  closeRoleModal);
document.getElementById('rm-cancel').addEventListener('click', closeRoleModal);

document.getElementById('rm-save').addEventListener('click', async () => {
  const id    = document.getElementById('rm-id').value;
  const name  = document.getElementById('rm-name').value.trim().toLowerCase().replace(/\s+/g,'-');
  const label = document.getElementById('rm-label').value.trim();
  const color = document.getElementById('rm-color').value;
  const level = parseInt(document.getElementById('rm-level').value) || 10;
  const errEl = document.getElementById('rm-error');
  errEl.style.display = 'none';

  if (!label) { errEl.textContent = 'Display label is required.'; errEl.style.display = 'block'; return; }
  if (!id && !name) { errEl.textContent = 'Role name is required.'; errEl.style.display = 'block'; return; }
  if (level >= 80 && !_myPermissions.can_assign_admin) {
    errEl.textContent = 'Cannot create roles with level 80+. Only the Owner can do this.';
    errEl.style.display = 'block'; return;
  }

  // Collect permissions
  const permissions = {};
  document.querySelectorAll('#rm-perm-grid input[type=checkbox]').forEach(cb => {
    permissions[cb.value] = cb.checked;
  });

  const payload = { label, color, level, permissions };
  if (!id) payload.name = name;

  let error;
  if (id) {
    ({ error } = await supabase.from('roles').update(payload).eq('id', id));
  } else {
    ({ error } = await supabase.from('roles').insert({ ...payload, name }));
  }
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  closeRoleModal();
  await loadAllRoles();
  await loadAll();
});

window.deleteRole = async (id) => {
  if (!confirm('Delete this role? Users with this role will lose it.')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  const { error } = await supabase.from('roles').delete().eq('id', id);
  if (error) { alert(error.message); return; }
  await loadAllRoles();
  await loadAll();
};

// Starts a real "view as role" session: from this point on, every RLS
// check server-side (news, archive, tasks, faqs, admin messages, etc.)
// evaluates against the previewed role's actual permissions instead of
// the admin's own, until they exit or close the tab. Opens the
// live site in a new tab so this admin panel stays open with the
// admin's real access.
window.viewAsRole = async (roleId, roleLabel) => {
  if (!confirm(`View the site as "${roleLabel}"?\n\nReal data will be shown exactly as this role would see it, until you exit the preview or close this tab. Your own admin access here is unaffected.`)) return;
  try {
    await startRolePreview(roleId);
  } catch (e) {
    alert(`Couldn't start preview: ${e.message || e}`);
    return;
  }
  window.open('index.html', '_blank');
};

// ── News admin ────────────────────────────────────────────────
let _newsArticles = [];
let _newsFilter = { search: '', status: '' };

async function loadNewsAdmin() {
  const el = document.getElementById('news-article-list');
  try {
    let q = supabase.from('news_articles').select('*').order('created_at', { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    _newsArticles = data || [];
    renderNewsAdmin();
  } catch(e) {
    el.innerHTML = `<div style="padding:1.5rem;color:#c0392b;font-size:13px;">Error loading articles: ${escapeHtml(e.message)}</div>`;
  }
}

function renderNewsAdmin() {
  const el = document.getElementById('news-article-list');
  const { search, status } = _newsFilter;
  const q = search.toLowerCase();
  const filtered = _newsArticles.filter(a => {
    if (q && !(a.title||'').toLowerCase().includes(q)) return false;
    if (status && a.status !== status) return false;
    return true;
  });

  if (!filtered.length) {
    el.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--muted);font-size:14px;">${_newsArticles.length ? 'No articles match your filters.' : 'No articles yet. Click "+ New Article" to get started.'}</div>`;
    return;
  }

  el.innerHTML = filtered.map(a => {
    const pub = a.published_at ? new Date(a.published_at).toLocaleDateString() : '';
    const created = new Date(a.created_at).toLocaleDateString();
    const statusLabel = a.status === 'pending_review' ? 'Pending Review' : a.status;
    const noteHtml = (a.status === 'draft' && a.rejection_note)
      ? `<div style="font-size:11px;color:#c0392b;margin-top:2px;">Rejection note: ${escapeHtml(a.rejection_note)}</div>` : '';
    let actionBtns;
    if (a.status === 'pending_review') {
      actionBtns = `
        <button class="btn btn-success btn-sm" data-action="approve-article" data-id="${a.id}">Approve &amp; Publish</button>
        <button class="btn btn-danger btn-sm" data-action="reject-article" data-id="${a.id}">Reject</button>`;
    } else if (a.status === 'published') {
      actionBtns = `<button class="btn btn-outline btn-sm" data-action="unpublish-article" data-id="${a.id}">Unpublish</button>`;
    } else {
      actionBtns = `<button class="btn btn-success btn-sm" data-action="publish-article" data-id="${a.id}">Publish</button>`;
    }
    return `<div class="news-article-row">
      <div style="flex:1;min-width:0;">
        <div class="news-article-title">
          <span class="status-dot ${escapeHtml(a.status)}"></span>${escapeHtml(a.title)}
        </div>
        <div class="news-article-meta">
          ${escapeHtml(a.category || 'General')} · By ${escapeHtml(a.author_name||'Unknown')} · Created ${escapeHtml(created)}
          ${a.status === 'published' && pub ? ` · Published ${pub}` : ''}
          ${a.status === 'pending_review' ? ` · <span style="color:#c0392b;font-weight:600;">${escapeHtml(statusLabel)}</span>` : ''}
        </div>
        ${noteHtml}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
        ${actionBtns}
        <button class="btn btn-outline btn-sm" data-action="edit-article" data-id="${a.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete-article" data-id="${a.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('news-search').addEventListener('input', function() {
  _newsFilter.search = this.value;
  renderNewsAdmin();
});
document.getElementById('news-filter-status').addEventListener('change', function() {
  _newsFilter.status = this.value;
  renderNewsAdmin();
});

// News CRUD
function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,80);
}

function openNewsModal(article = null) {
  document.getElementById('nm2-id').value            = article?.id || '';
  document.getElementById('nm2-title-input').value   = article?.title || '';
  document.getElementById('nm2-category').value      = article?.category || '';
  document.getElementById('nm2-status').value        = article?.status || 'draft';
  document.getElementById('nm2-author-name').value   = article?.author_name || '';
  if (article?.published_at) {
    const d = new Date(article.published_at);
    document.getElementById('nm2-published-at').value = d.toISOString().slice(0, 16);
  } else {
    document.getElementById('nm2-published-at').value = '';
  }
  document.getElementById('nm2-summary').value       = article?.summary || '';
  document.getElementById('nm2-image').value         = article?.image_url || '';
  document.getElementById('nm2-body').value          = article?.body || '';
  document.getElementById('nm2-error').style.display = 'none';
  document.getElementById('nm2-title').textContent   = article ? 'Edit Article' : 'New Article';
  document.getElementById('news-modal').style.display = 'flex';
}
function closeNewsModal() { document.getElementById('news-modal').style.display = 'none'; }

document.getElementById('btn-new-article').addEventListener('click', () => openNewsModal());
document.getElementById('nm2-close').addEventListener('click',  closeNewsModal);
document.getElementById('nm2-cancel').addEventListener('click', closeNewsModal);

// Double-clicking Publish on a new article used to run the insert twice —
// two published articles, and notifySubscribers() firing a second email blast
// to every subscriber. The generated slug carries a timestamp, so there was no
// unique constraint to fall back on.
let _savingArticle = false;

async function saveArticle(forceStatus = null) {
  if (_savingArticle) return;
  _savingArticle = true;
  const saveBtns = ['nm2-save-draft', 'nm2-save-publish'].map(x => document.getElementById(x)).filter(Boolean);
  saveBtns.forEach(b => { b.disabled = true; });
  try { await saveArticleInner(forceStatus); }
  finally {
    _savingArticle = false;
    saveBtns.forEach(b => { b.disabled = false; });
  }
}

async function saveArticleInner(forceStatus) {
  const id      = document.getElementById('nm2-id').value;
  const title   = document.getElementById('nm2-title-input').value.trim();
  const errEl   = document.getElementById('nm2-error');
  errEl.style.display = 'none';
  if (!title) { errEl.textContent = 'Title is required.'; errEl.style.display = 'block'; return; }

  const status = forceStatus || document.getElementById('nm2-status').value;
  const wasPublished = id ? (_newsArticles.find(x => x.id === id)?.status === 'published') : false;
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile }  = await supabase.from('profiles').select('display_name,username').eq('id', user.id).single();
  const defaultAuthorName = profile?.display_name || profile?.username || 'Unknown';

  // Use whatever is in the Author Name field; fall back to current user's name for new articles
  const overrideAuthor = document.getElementById('nm2-author-name').value.trim();
  const authorName = overrideAuthor || defaultAuthorName;

  // Use the custom publish date if set, otherwise default to now when publishing
  const publishedAtInput = document.getElementById('nm2-published-at').value;
  const publishedAt = publishedAtInput
    ? new Date(publishedAtInput).toISOString()
    : (status === 'published' ? new Date().toISOString() : undefined);

  const payload = {
    title,
    category:     document.getElementById('nm2-category').value.trim() || 'General',
    status,
    summary:      document.getElementById('nm2-summary').value.trim() || null,
    image_url:    document.getElementById('nm2-image').value.trim() || null,
    body:         document.getElementById('nm2-body').value.trim(),
    author_name:  authorName,
    published_at: publishedAt,
  };
  if (status === 'published' && !wasPublished) {
    payload.reviewed_by = user.id;
    payload.reviewed_at = new Date().toISOString();
  }
  // author_id is only set on insert (new articles), not on update
  if (id) { delete payload.author_id; }

  let error, newId = id;
  if (id) {
    ({ error } = await supabase.from('news_articles').update(payload).eq('id', id));
  } else {
    const slug = slugify(title) + '-' + Date.now().toString(36);
    const { data: inserted, error: insertErr } = await supabase.from('news_articles')
      .insert({ ...payload, slug, author_id: user.id, author_name: authorName })
      .select('id').single();
    error = insertErr;
    newId = inserted?.id;
  }
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  closeNewsModal();
  loadNewsAdmin();
  loadPendingNewsCount();
  if (status === 'published' && !wasPublished && newId) await notifySubscribers(newId);
}

document.getElementById('nm2-save-draft').addEventListener('click', () => saveArticle('draft'));
document.getElementById('nm2-save-publish').addEventListener('click', () => saveArticle('published'));

window.editArticle = (id) => {
  const a = _newsArticles.find(x => x.id === id);
  if (a) openNewsModal(a);
};

// ── Email subscribers when an article goes live ────────────────
async function notifySubscribers(articleId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1/notify-news-subscribers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ articleId }),
    });
    const result = await res.json();
    if (res.ok && !result.error && result.sent > 0) {
      console.log(`Notified ${result.sent} subscriber(s) about article ${articleId}`);
    } else if (!res.ok || result.error) {
      console.error('notify-news-subscribers failed:', result.error);
    }
  } catch (e) {
    console.error('notify-news-subscribers failed:', e.message);
  }
}

window.publishArticle = async (id) => {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('news_articles').update({
    status: 'published',
    published_at: new Date().toISOString(),
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id);
  loadNewsAdmin();
  loadPendingNewsCount();
  await notifySubscribers(id);
};
window.approveArticle = window.publishArticle; // same action, different entry point
window.rejectArticle = async (id) => {
  // This prompt is the only gate on rejecting — there is no preceding
  // confirm() — so Cancel has to abort. `|| null` swallowed the null and sent
  // the article back to draft anyway, with no way to back out once clicked.
  const reason = prompt("Send this article back to the author? Optional note on why (leave blank to skip):", '');
  if (reason === null) return;
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('news_articles').update({
    status: 'draft',
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    rejection_note: reason || null,
  }).eq('id', id);
  loadNewsAdmin();
  loadPendingNewsCount();
};
window.unpublishArticle = async (id) => {
  await supabase.from('news_articles').update({ status: 'draft' }).eq('id', id);
  loadNewsAdmin();
};
window.deleteArticle = async (id) => {
  if (!confirm('Delete this article? This cannot be undone.')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  await supabase.from('news_articles').delete().eq('id', id);
  loadNewsAdmin();
  loadPendingNewsCount();
};

// Load pending-review count on page init so the badge shows before the News tab is opened
async function loadPendingNewsCount() {
  if (!_myPermissions.can_approve_news) return;
  const { count } = await supabase
    .from('news_articles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_review');
  const newsBadge = document.getElementById('news-pending-badge');
  const groupBadge = document.getElementById('content-group-badge');
  const statCell = document.getElementById('stat-news-pending-cell');
  const statValue = document.getElementById('stat-news-pending');
  if (count) {
    if (newsBadge) { newsBadge.textContent = count; newsBadge.style.display = 'inline'; }
    if (groupBadge) { groupBadge.textContent = count; groupBadge.style.display = 'inline'; }
    if (statCell) statCell.style.display = '';
    if (statValue) statValue.textContent = count;
  } else {
    if (newsBadge) newsBadge.style.display = 'none';
    if (groupBadge) groupBadge.style.display = 'none';
    if (statCell) statCell.style.display = 'none';
  }
}

// ── Archive admin ─────────────────────────────────────────────
const ARCHIVE_BUCKET = 'archive-files';
let _archiveDocs = [];
let _archiveFilter = { search: '', status: '' };
let _archivePendingFile = null;
let _archiveCurrentFileUrl = null, _archiveCurrentFileName = null;

async function loadArchiveAdmin() {
  const el = document.getElementById('archive-doc-list');
  try {
    const { data, error } = await supabase.from('archive_documents').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    _archiveDocs = data || [];
    renderArchiveAdmin();
  } catch(e) {
    el.innerHTML = `<div style="padding:1.5rem;color:#c0392b;font-size:13px;">Error loading documents: ${escapeHtml(e.message)}</div>`;
  }
}

function renderArchiveAdmin() {
  const el = document.getElementById('archive-doc-list');
  const { search, status } = _archiveFilter;
  const q = search.toLowerCase();
  const filtered = _archiveDocs.filter(d => {
    if (q && !(d.title||'').toLowerCase().includes(q)) return false;
    if (status && d.status !== status) return false;
    return true;
  });

  if (!filtered.length) {
    el.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--muted);font-size:14px;">${_archiveDocs.length ? 'No documents match your filters.' : 'No documents yet. Click "+ New Document" to get started.'}</div>`;
    return;
  }

  el.innerHTML = filtered.map(d => {
    const pub = d.published_at ? new Date(d.published_at + 'T00:00:00').toLocaleDateString() : '';
    const created = new Date(d.created_at).toLocaleDateString();
    return `<div class="news-article-row">
      <div style="flex:1;min-width:0;">
        <div class="news-article-title">
          <span class="status-dot ${escapeHtml(d.status)}"></span>${escapeHtml(d.title)}
        </div>
        <div class="news-article-meta">
          ${escapeHtml(d.category || 'Uncategorized')} · By ${escapeHtml(d.author_name||'Unknown')} · Created ${escapeHtml(created)}
          ${d.status === 'published' && pub ? ` · Ratified ${pub}` : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
        ${d.status !== 'published' ? `<button class="btn btn-success btn-sm" data-action="publish-doc" data-id="${d.id}">Publish</button>` : ''}
        ${d.status === 'published'  ? `<button class="btn btn-outline btn-sm" data-action="unpublish-doc" data-id="${d.id}">Unpublish</button>` : ''}
        <button class="btn btn-outline btn-sm" data-action="edit-doc" data-id="${d.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete-doc" data-id="${d.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('archive-admin-search').addEventListener('input', function() {
  _archiveFilter.search = this.value;
  renderArchiveAdmin();
});
document.getElementById('archive-admin-filter-status').addEventListener('change', function() {
  _archiveFilter.status = this.value;
  renderArchiveAdmin();
});

function openArchiveModal(doc = null) {
  document.getElementById('am2-id').value           = doc?.id || '';
  document.getElementById('am2-title-input').value  = doc?.title || '';
  document.getElementById('am2-category').value     = doc?.category || '';
  document.getElementById('am2-status').value       = doc?.status || 'draft';
  document.getElementById('am2-author-name').value  = doc?.author_name || '';
  document.getElementById('am2-published-at').value = doc?.published_at || '';
  document.getElementById('am2-supporters').value    = (doc?.supporters || []).join(', ');
  document.getElementById('am2-summary').value      = doc?.summary || '';
  document.getElementById('am2-body').value         = doc?.body || '';
  document.getElementById('am2-file').value = '';
  _archivePendingFile = null;
  _archiveCurrentFileUrl  = doc?.file_url  || null;
  _archiveCurrentFileName = doc?.file_name || null;
  document.getElementById('am2-file-current').innerHTML = _archiveCurrentFileUrl
    ? `Current: <a href="${escapeHtml(safeUrl(_archiveCurrentFileUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(_archiveCurrentFileName || 'view file')}</a>`
    : '';
  document.getElementById('am2-error').style.display = 'none';
  document.getElementById('am2-title').textContent   = doc ? 'Edit Document' : 'New Document';
  document.getElementById('archive-modal').style.display = 'flex';
}
function closeArchiveModal() { document.getElementById('archive-modal').style.display = 'none'; }

document.getElementById('btn-new-doc').addEventListener('click', () => openArchiveModal());
document.getElementById('am2-close').addEventListener('click',  closeArchiveModal);
document.getElementById('am2-cancel').addEventListener('click', closeArchiveModal);
document.getElementById('am2-file').addEventListener('change', e => {
  _archivePendingFile = e.target.files[0] || null;
  if (_archivePendingFile) {
    document.getElementById('am2-file-current').textContent = `Selected: ${_archivePendingFile.name} (will upload on save)`;
  }
});

async function uploadArchiveFileIfNeeded(userId) {
  if (!_archivePendingFile) return { url: _archiveCurrentFileUrl, name: _archiveCurrentFileName };
  const ext = (_archivePendingFile.name.split('.').pop() || '').toLowerCase();
  const path = `${userId}/${Date.now()}-${slugify(_archivePendingFile.name.replace(/\.[^.]+$/, ''))}.${ext}`;
  const { error } = await supabase.storage.from(ARCHIVE_BUCKET).upload(path, _archivePendingFile);
  if (error) throw error;
  const { data } = supabase.storage.from(ARCHIVE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, name: _archivePendingFile.name };
}

async function saveArchiveDoc(forceStatus = null) {
  const id      = document.getElementById('am2-id').value;
  const title   = document.getElementById('am2-title-input').value.trim();
  const errEl   = document.getElementById('am2-error');
  errEl.style.display = 'none';
  if (!title) { errEl.textContent = 'Title is required.'; errEl.style.display = 'block'; return; }

  const { data: { user } } = await supabase.auth.getUser();

  let fileInfo;
  try {
    fileInfo = await uploadArchiveFileIfNeeded(user.id);
  } catch (err) {
    errEl.textContent = 'File upload failed: ' + err.message; errEl.style.display = 'block'; return;
  }

  const status = forceStatus || document.getElementById('am2-status').value;
  const { data: profile }  = await supabase.from('profiles').select('display_name,username').eq('id', user.id).single();
  const defaultAuthorName = profile?.display_name || profile?.username || 'Unknown';
  const overrideAuthor = document.getElementById('am2-author-name').value.trim();
  const authorName = overrideAuthor || defaultAuthorName;

  const supporters = document.getElementById('am2-supporters').value
    .split(',').map(s => s.trim()).filter(Boolean);

  const publishedAtInput = document.getElementById('am2-published-at').value;
  const publishedAt = publishedAtInput || (status === 'published' ? new Date().toISOString().slice(0,10) : null);

  const payload = {
    title,
    category:     document.getElementById('am2-category').value.trim() || 'Uncategorized',
    status,
    summary:      document.getElementById('am2-summary').value.trim() || null,
    body:         document.getElementById('am2-body').value.trim(),
    supporters,
    author_name:  authorName,
    published_at: publishedAt,
    file_url:     fileInfo.url,
    file_name:    fileInfo.name,
  };

  let error;
  if (id) {
    ({ error } = await supabase.from('archive_documents').update(payload).eq('id', id));
  } else {
    const slug = slugify(title) + '-' + Date.now().toString(36);
    ({ error } = await supabase.from('archive_documents').insert({ ...payload, slug, author_id: user.id }));
  }
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  closeArchiveModal();
  loadArchiveAdmin();
}

document.getElementById('am2-save-draft').addEventListener('click',   () => saveArchiveDoc('draft'));
document.getElementById('am2-save-publish').addEventListener('click', () => saveArchiveDoc('published'));

window.editDoc = (id) => {
  const d = _archiveDocs.find(x => x.id === id);
  if (d) openArchiveModal(d);
};
window.publishDoc = async (id) => {
  const d = _archiveDocs.find(x => x.id === id);
  await supabase.from('archive_documents').update({ status: 'published', published_at: d?.published_at || new Date().toISOString().slice(0,10) }).eq('id', id);
  loadArchiveAdmin();
};
window.unpublishDoc = async (id) => {
  await supabase.from('archive_documents').update({ status: 'draft' }).eq('id', id);
  loadArchiveAdmin();
};
window.deleteDoc = async (id) => {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  await supabase.from('archive_documents').delete().eq('id', id);
  loadArchiveAdmin();
};

// ── FAQ admin ─────────────────────────────────────────────────
let _faqs = [];
let _faqFilter = { search: '', status: '' };

async function loadFaqAdmin() {
  const el = document.getElementById('faq-admin-list');
  try {
    const { data, error } = await supabase.from('faqs').select('*')
      .order('category', { ascending: true }).order('sort_order', { ascending: true });
    if (error) throw error;
    _faqs = data || [];
    renderFaqAdmin();
  } catch(e) {
    el.innerHTML = `<div style="padding:1.5rem;color:#c0392b;font-size:13px;">Error loading FAQ: ${escapeHtml(e.message)}</div>`;
  }
}

function renderFaqAdmin() {
  const el = document.getElementById('faq-admin-list');
  const { search, status } = _faqFilter;
  const q = search.toLowerCase();
  const filtered = _faqs.filter(f => {
    if (q && !f.question.toLowerCase().includes(q)) return false;
    if (status && f.status !== status) return false;
    return true;
  });

  if (!filtered.length) {
    el.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--muted);font-size:14px;">${_faqs.length ? 'No questions match your filters.' : 'No questions yet. Click "+ New Question" to get started.'}</div>`;
    return;
  }

  el.innerHTML = filtered.map(f => `<div class="news-article-row">
      <div style="flex:1;min-width:0;">
        <div class="news-article-title">
          <span class="status-dot ${escapeHtml(f.status)}"></span>${escapeHtml(f.question)}
        </div>
        <div class="news-article-meta">${escapeHtml(f.category || 'General')} · Sort ${escapeHtml(f.sort_order)} · ${f.status === 'published' ? 'Published' : 'Draft'}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
        ${f.status !== 'published' ? `<button class="btn btn-success btn-sm" data-action="publish-faq" data-id="${f.id}">Publish</button>` : `<button class="btn btn-outline btn-sm" data-action="unpublish-faq" data-id="${f.id}">Unpublish</button>`}
        <button class="btn btn-outline btn-sm" data-action="edit-faq" data-id="${f.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete-faq" data-id="${f.id}">Delete</button>
      </div>
    </div>`).join('');
}

document.getElementById('faq-admin-search').addEventListener('input', function() {
  _faqFilter.search = this.value;
  renderFaqAdmin();
});
document.getElementById('faq-admin-filter-status').addEventListener('change', function() {
  _faqFilter.status = this.value;
  renderFaqAdmin();
});

function openFaqModal(faq = null) {
  document.getElementById('fm-id').value          = faq?.id || '';
  document.getElementById('fm-question').value    = faq?.question || '';
  document.getElementById('fm-answer').value      = faq?.answer || '';
  document.getElementById('fm-category').value    = faq?.category || '';
  document.getElementById('fm-status').value      = faq?.status || 'draft';
  document.getElementById('fm-sort-order').value  = faq?.sort_order ?? 0;
  document.getElementById('fm-error').style.display = 'none';
  document.getElementById('fm-title').textContent = faq ? 'Edit Question' : 'New Question';
  document.getElementById('faq-modal').style.display = 'flex';
}
function closeFaqModal() { document.getElementById('faq-modal').style.display = 'none'; }

document.getElementById('btn-new-faq').addEventListener('click', () => openFaqModal());
document.getElementById('fm-close').addEventListener('click', closeFaqModal);
document.getElementById('fm-cancel').addEventListener('click', closeFaqModal);

async function saveFaq(forceStatus = null) {
  const id       = document.getElementById('fm-id').value;
  const question = document.getElementById('fm-question').value.trim();
  const answer   = document.getElementById('fm-answer').value.trim();
  const errEl    = document.getElementById('fm-error');
  errEl.style.display = 'none';
  if (!question || !answer) { errEl.textContent = 'Question and answer are both required.'; errEl.style.display = 'block'; return; }

  const status = forceStatus || document.getElementById('fm-status').value;
  const payload = {
    question, answer,
    category:   document.getElementById('fm-category').value.trim() || 'General',
    status,
    sort_order: parseInt(document.getElementById('fm-sort-order').value, 10) || 0,
  };

  let error;
  if (id) {
    ({ error } = await supabase.from('faqs').update(payload).eq('id', id));
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    ({ error } = await supabase.from('faqs').insert({ ...payload, author_id: user.id }));
  }
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  closeFaqModal();
  loadFaqAdmin();
}

document.getElementById('fm-save-draft').addEventListener('click',   () => saveFaq('draft'));
document.getElementById('fm-save-publish').addEventListener('click', () => saveFaq('published'));

window.editFaq = (id) => {
  const f = _faqs.find(x => x.id === id);
  if (f) openFaqModal(f);
};
window.publishFaq = async (id) => {
  await supabase.from('faqs').update({ status: 'published' }).eq('id', id);
  loadFaqAdmin();
};
window.unpublishFaq = async (id) => {
  await supabase.from('faqs').update({ status: 'draft' }).eq('id', id);
  loadFaqAdmin();
};
window.deleteFaq = async (id) => {
  if (!confirm('Delete this question? This cannot be undone.')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  await supabase.from('faqs').delete().eq('id', id);
  loadFaqAdmin();
};

// ── Site Lock ─────────────────────────────────────────────────
async function loadLockState() {
  const badge = document.getElementById('lock-status-badge');
  try {
    const { data } = await supabase.from('settings').select('value').eq('key','site_lock').single();
    let cfg = {};
    if (data?.value) { try { cfg = JSON.parse(data.value); } catch(e) {} }
    applyLockUI(cfg.locked === true, cfg.reason||'', cfg.return_time||'');
  } catch(e) { badge.textContent = 'Error'; badge.className = 'badge badge-pending'; }
}
function applyLockUI(isLocked, reason, returnTime) {
  const badge = document.getElementById('lock-status-badge');
  document.getElementById('lock-reason').value = reason;
  document.getElementById('lock-return').value = returnTime;
  if (isLocked) {
    badge.textContent = 'Locked'; badge.className = 'badge badge-pending';
    document.getElementById('btn-lock-enable').style.display  = 'none';
    document.getElementById('btn-lock-disable').style.display = '';
  } else {
    badge.textContent = 'Unlocked'; badge.className = 'badge badge-verified';
    document.getElementById('btn-lock-enable').style.display  = '';
    document.getElementById('btn-lock-disable').style.display = 'none';
  }
}
async function saveLockState(locked) {
  const statusEl = document.getElementById('lock-save-status');
  const reason     = document.getElementById('lock-reason').value.trim();
  const returnTime = document.getElementById('lock-return').value.trim();
  const value = JSON.stringify({ locked, reason, return_time: returnTime });
  statusEl.textContent = 'Saving...';
  const { error } = await supabase.from('settings').upsert({ key:'site_lock', value }, { onConflict:'key' });
  if (error) {
    statusEl.textContent = 'Error: ' + error.message;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  } else {
    applyLockUI(locked, reason, returnTime);
    statusEl.textContent = locked ? '✓ Site locked' : '✓ Site unlocked';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  }
}
document.getElementById('btn-lock-enable').addEventListener('click', () => {
  if (confirm('Lock the site? Non-admin visitors will see the maintenance screen.')) saveLockState(true);
});
document.getElementById('btn-lock-disable').addEventListener('click', () => saveLockState(false));

// ── Minecraft ─────────────────────────────────────────────────
function renderMinecraftLists() {
  const pending  = _allMembers.filter(m => m.minecraft_username && !m.minecraft_verified);
  const verified = _allMembers.filter(m => m.minecraft_verified);
  document.getElementById('pending-count-badge').textContent = pending.length;
  const pendingEl = document.getElementById('pending-verify-list');
  pendingEl.innerHTML = pending.length ? pending.map(m => verifyCard(m, false)).join('') : `<div class="verify-empty">No pending verifications.</div>`;
  const verifiedEl = document.getElementById('verified-list');
  verifiedEl.innerHTML = verified.length ? verified.map(m => verifyCard(m, true)).join('') : `<div class="verify-empty">No verified accounts yet.</div>`;
}
function verifyCard(m, isVerified) {
  const name = m.display_name || m.username || m.email || m.id;
  return `<div class="verify-card">
    <div class="verify-card-info">
      <div class="verify-card-name">${escapeHtml(name)}</div>
      <div class="verify-card-detail">MC username: <span class="verify-card-mc">${escapeHtml(m.minecraft_username)}</span><br>${escapeHtml(m.email||'No email')}</div>
    </div>
    <div class="btn-actions">
      ${!isVerified ? `<button class="btn btn-success btn-sm" data-action="approve-m-c" data-id="${m.id}">Approve</button>` : ''}
      <button class="btn btn-danger btn-sm" data-action="revoke-m-c" data-id="${m.id}">${isVerified ? 'Revoke' : 'Reject'}</button>
    </div>
  </div>`;
}
window.approveMC  = async (id) => {
  const { error } = await supabase.from('profiles').update({ minecraft_verified: true }).eq('id', id);
  if (error) { alert('Failed to approve: ' + error.message); return; }
  await loadAll();
};
window.revokeMC   = async (id) => {
  if (!confirm('Remove Minecraft verification?')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  await supabase.from('profiles').update({ minecraft_verified: false, minecraft_username: null, mc_verify_code: null, mc_verify_expires: null }).eq('id', id);
  await loadAll();
};
// ── Economy: company approvals ────────────────────────────────
// Founding a company writes it as approval_status='pending' / is_active=false
// and hands every share to the founder's treasury account. Until it's approved
// here it won't appear in the Stock Market list on the account page.
let _adminCompanies = [];

async function loadEconomyAdmin() {
  const pendingEl  = document.getElementById('company-pending-list');
  const reviewedEl = document.getElementById('company-reviewed-list');
  if (!_myPermissions.can_manage_economy) {
    pendingEl.innerHTML = `<div class="verify-empty">You don't have permission to review companies.</div>`;
    reviewedEl.innerHTML = '';
    return;
  }

  const { data, error } = await supabase
    .from('economy_companies')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    pendingEl.innerHTML = `<div class="verify-empty">Couldn't load companies: ${escapeHtml(error.message)}</div>`;
    reviewedEl.innerHTML = '';
    return;
  }

  _adminCompanies = data || [];
  const pending  = _adminCompanies.filter(c => c.approval_status === 'pending');
  const reviewed = _adminCompanies.filter(c => c.approval_status !== 'pending');

  document.getElementById('company-pending-count-badge').textContent = pending.length;
  pendingEl.innerHTML  = pending.length  ? pending.map(c => companyCard(c, true)).join('')   : `<div class="verify-empty">No companies awaiting review.</div>`;
  reviewedEl.innerHTML = reviewed.length ? reviewed.map(c => companyCard(c, false)).join('') : `<div class="verify-empty">No companies have been reviewed yet.</div>`;
}

function companyCard(c, isPending) {
  const founder = _allMembers.find(m => m.id === c.founder_id);
  const founderName = founder ? (founder.display_name || founder.username || founder.email || c.founder_id) : 'Unknown founder';
  const created = c.created_at ? new Date(c.created_at).toLocaleDateString() : '';
  const statusBadge = c.approval_status === 'approved'
    ? `<span class="badge badge-verified">Approved</span>`
    : c.approval_status === 'rejected'
      ? `<span class="badge badge-revoked">Rejected</span>`
      : `<span class="badge badge-pending">Pending</span>`;

  return `<div class="verify-card">
    <div class="verify-card-info">
      <div class="verify-card-name">${escapeHtml(c.ticker)} — ${escapeHtml(c.name)} ${isPending ? '' : statusBadge}</div>
      <div class="verify-card-detail">
        ${c.total_shares.toLocaleString()} shares @ $${Number(c.share_price).toFixed(2)} —
        market cap $${(c.total_shares * Number(c.share_price)).toFixed(2)}<br>
        Founded by ${escapeHtml(founderName)}${created ? ' on ' + created : ''}
        ${c.description ? '<br>' + escapeHtml(c.description) : ''}
        ${c.review_note ? '<br>Note: ' + escapeHtml(c.review_note) : ''}
      </div>
    </div>
    <div class="btn-actions">
      ${isPending ? `
        <button class="btn btn-success btn-sm" data-action="approve-company" data-id="${c.id}">Approve</button>
        <button class="btn btn-danger btn-sm" data-action="reject-company" data-id="${c.id}">Reject</button>
      ` : ''}
    </div>
  </div>`;
}

window.approveCompany = async (id) => {
  const c = _adminCompanies.find(x => x.id === id);
  if (!confirm(`Approve ${c?.ticker || 'this company'}? It will start trading immediately at $${Number(c?.share_price || 0).toFixed(2)}/share.`)) return;
  const note = prompt('Optional note for the founder (leave blank to skip):', '') || null;
  const { error } = await supabase.rpc('economy_approve_company', { p_company_id: id, p_note: note });
  if (error) { alert('Failed to approve: ' + error.message); return; }
  await loadEconomyAdmin();
  loadPendingCompanyCount();
};

window.rejectCompany = async (id) => {
  const c = _adminCompanies.find(x => x.id === id);
  const note = prompt(`Reject ${c?.ticker || 'this company'}? Give the founder a reason:`, '');
  if (note === null) return;
  const { error } = await supabase.rpc('economy_reject_company', { p_company_id: id, p_note: note || null });
  if (error) { alert('Failed to reject: ' + error.message); return; }
  await loadEconomyAdmin();
  loadPendingCompanyCount();
};

async function loadPendingCompanyCount() {
  if (!_myPermissions.can_manage_economy) return;
  const { count } = await supabase
    .from('economy_companies')
    .select('id', { count: 'exact', head: true })
    .eq('approval_status', 'pending');
  const tabBadge  = document.getElementById('economy-pending-badge');
  const grpBadge  = document.getElementById('economy-group-badge');
  const statCell  = document.getElementById('stat-company-pending-cell');
  const statValue = document.getElementById('stat-company-pending');
  if (count) {
    if (tabBadge) { tabBadge.textContent = count; tabBadge.style.display = 'inline'; }
    if (grpBadge) { grpBadge.textContent = count; grpBadge.style.display = 'inline'; }
    if (statCell) statCell.style.display = '';
    if (statValue) statValue.textContent = count;
  } else {
    if (tabBadge) tabBadge.style.display = 'none';
    if (grpBadge) grpBadge.style.display = 'none';
    if (statCell) statCell.style.display = 'none';
  }
}

window.allowEmail = async (id) => {
  const member = _allMembers.find(m => m.id === id);
  if (!confirm(`Allow ${member?.email || 'this user'} to sign in with email? Their email will be marked as verified without sending a confirmation.`)) return;
  const { error } = await supabase.rpc('allow_email_access', { user_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
window.revokeEmail = async (id) => {
  if (!confirm('Revoke and remove this email? This signs them out and fully removes the email from the account so they can add a new one themselves.')) return;
  const { error } = await supabase.rpc('revoke_email_verification', { user_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
window.revokeDiscord = async (id) => {
  if (!confirm('Unlink Discord from this account?')) return;
  const { error } = await supabase.rpc('revoke_discord_identity', { user_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
window.revokeGoogle = async (id) => {
  if (!confirm('Unlink Google from this account?')) return;
  const { error } = await supabase.rpc('revoke_google_identity', { user_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
window.freezeAccount = async (id) => {
  const member = _allMembers.find(m => m.id === id);
  const name = member?.display_name || member?.username || 'this account';
  if (!confirm(`Freeze ${name}? They will be signed out and blocked from signing in until unfrozen.`)) return;
  const { error } = await supabase.rpc('freeze_account', { user_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
window.unfreezeAccount = async (id) => {
  const member = _allMembers.find(m => m.id === id);
  const name = member?.display_name || member?.username || 'this account';
  if (!confirm(`Unfreeze ${name}? They will be able to sign in again.`)) return;
  const { error } = await supabase.rpc('unfreeze_account', { user_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
window.grantMembership = async (id) => {
  const member = _allMembers.find(m => m.id === id);
  const name = member?.display_name || member?.username || 'this member';
  // Comping over a live Stripe subscription rewrites membership_source, but
  // Stripe keeps billing — and the next renewal webhook writes 'stripe' back
  // over the comp. Say so before it happens.
  if (member?.membership_source === 'stripe') {
    if (!confirm(`${name} already pays for a membership through Stripe.\n\nComping them here does NOT cancel that subscription — they will keep being charged, and the next renewal will overwrite the comp. Cancel the subscription in the Stripe dashboard first.\n\nComp them anyway?`)) return;
  } else if (!confirm(`Grant ${name} a complimentary MCA membership? They'll get server + member-page access without paying.`)) return;
  const { error } = await supabase.rpc('admin_set_membership', { p_user_id: id, p_grant: true });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
// Grant or extend a membership until a specific date (admin_set_membership p_expires_at).
window.extendMembership = async (id) => {
  const member = _allMembers.find(m => m.id === id);
  const name = member?.display_name || member?.username || 'this member';
  const input = prompt(`Give ${name} membership access until which date? (YYYY-MM-DD)`);
  if (!input) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.trim()) || isNaN(new Date(input.trim() + 'T23:59:59').getTime())) { alert('Please enter a date like 2027-06-30.'); return; }
  const until = new Date(input.trim() + 'T23:59:59');
  if (until.getTime() <= Date.now()) { alert('The date must be in the future.'); return; }
  const { error } = await supabase.rpc('admin_set_membership', { p_user_id: id, p_grant: true, p_expires_at: until.toISOString() });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
window.revokeMembership = async (id) => {
  const member = _allMembers.find(m => m.id === id);
  const name = member?.display_name || member?.username || 'this member';
  // Revoking only clears the columns on the profile. A Stripe subscription
  // is billed by Stripe, not by this table, so it keeps charging (and the
  // next renewal webhook flips them back to active) until it is cancelled
  // in Stripe — by the member in the billing portal, or by an admin.
  const stripeBacked = member?.membership_source === 'stripe';
  const warning = stripeBacked
    ? `Revoke ${name}'s membership?\n\nThey lose server + member-page access immediately, but their Stripe subscription is NOT cancelled — they will keep being charged and the next renewal will restore their access. Cancel it in the Stripe dashboard as well.\n\nRevoke anyway?`
    : `Revoke ${name}'s membership? They'll lose server + member-page access immediately.`;
  if (!confirm(warning)) return;
  const { error } = await supabase.rpc('admin_set_membership', { p_user_id: id, p_grant: false });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};
window.deleteAccount = async (id) => {
  const member = _allMembers.find(m => m.id === id);
  const name = member?.display_name || member?.username || 'this account';
  if (!confirm(`⚠️ DELETE ACCOUNT\n\nYou are about to permanently delete ${name}'s account. All their data will be erased.\n\nAre you sure you want to proceed?`)) return;
  if (!confirm(`⚠️ SECOND CONFIRMATION\n\nDeleting ${name} is irreversible. There is no undo, no recovery, no way back.\n\nDo you still want to delete this account?`)) return;
  const input = prompt(`⚠️ FINAL CONFIRMATION\n\nType the username or display name of the account to confirm deletion:\n\nExpected: "${name}"`);
  if (input?.trim() !== name) { alert('Name did not match. Deletion cancelled.'); return; }
  const { error } = await supabase.rpc('delete_account', { user_id: id });
  if (error) { alert('Error: ' + error.message); return; }
  await loadAll();
};

// ── Plugin bridge ─────────────────────────────────────────────
const EDGE_FUNCTION_URL = 'https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1/mcaverify';
const PLUGIN_HEARTBEAT_STALE_MS = 3 * 60 * 1000; // 3 minutes — plugin pings every 60s by default
// Humanize a heartbeat age so the admin UI never shows a raw "101904m ago".
function humanizeDuration(ms) {
  if (isNaN(ms)) return 'unknown time';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return Math.round(ms / 1000) + 's ago';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}
async function checkPluginBridge() {
  const dot = document.getElementById('plugin-dot'), text = document.getElementById('plugin-status-text'), badge = document.getElementById('plugin-badge');
  // Step 1: confirm the Edge Function is reachable
  try {
    const res = await fetch(EDGE_FUNCTION_URL, { method:'GET', signal: AbortSignal.timeout(5000) });
    if (res.status !== 405 && res.status !== 200) {
      dot.className = 'plugin-dot offline'; text.textContent = `Edge Function returned ${res.status}.`; badge.textContent = 'Error'; badge.className = 'badge badge-pending';
      return;
    }
  } catch(e) {
    dot.className = 'plugin-dot offline'; text.textContent = 'Edge Function not reachable. Not yet deployed.'; badge.textContent = 'Offline'; badge.className = 'badge badge-unlinked';
    return;
  }
  // Step 2: check plugin heartbeat — confirms the Bukkit plugin is actually running
  try {
    const { data, error } = await supabase.from('settings').select('value').eq('key', 'plugin_heartbeat').single();
    if (error || !data) {
      dot.className = 'plugin-dot offline'; text.textContent = 'Edge Function is reachable, but the plugin has never sent a heartbeat. Is MCAVerify installed and running?'; badge.textContent = 'Plugin Not Detected'; badge.className = 'badge badge-unlinked';
      return;
    }
    const heartbeat = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const lastSeen = new Date(heartbeat.last_seen);
    const ageMs = Date.now() - lastSeen.getTime();
    if (isNaN(ageMs) || ageMs > PLUGIN_HEARTBEAT_STALE_MS) {
      const ago = humanizeDuration(ageMs);
      dot.className = 'plugin-dot offline'; text.textContent = `Plugin heartbeat is stale (last seen ${ago}). The plugin may have stopped or crashed.`; badge.textContent = 'Plugin Offline'; badge.className = 'badge badge-pending';
      return;
    }
    const ago = humanizeDuration(ageMs);
    const server = heartbeat.server ? ` · ${heartbeat.server}` : '';
    dot.className = 'plugin-dot online'; text.textContent = `Edge Function deployed · Plugin running (last heartbeat ${ago}${server}).`; badge.textContent = 'Online'; badge.className = 'badge badge-verified';
  } catch(e) {
    dot.className = 'plugin-dot offline'; text.textContent = 'Could not read plugin heartbeat from Supabase.'; badge.textContent = 'Error'; badge.className = 'badge badge-pending';
  }
}
document.getElementById('btn-ping-plugin').addEventListener('click', () => {
  document.getElementById('plugin-status-text').textContent = 'Pinging...';
  document.getElementById('economy-plugin-status-text').textContent = 'Pinging...';
  checkPluginBridge();
  checkEconomyPlugin();
});

// Economy plugin heartbeat — same settings-table mechanism as MCAVerify,
// under its own key. No Edge Function involved.
async function checkEconomyPlugin() {
  const dot = document.getElementById('economy-plugin-dot'), text = document.getElementById('economy-plugin-status-text');
  try {
    const { data, error } = await supabase.from('settings').select('value').eq('key', 'economy_plugin_heartbeat').single();
    if (error || !data) {
      dot.className = 'plugin-dot offline'; text.textContent = 'Economy plugin: no heartbeat yet. Is MCAEconomy installed and running?';
      return;
    }
    const heartbeat = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const lastSeen = new Date(heartbeat.last_seen);
    const ageMs = Date.now() - lastSeen.getTime();
    const ago = humanizeDuration(ageMs);
    if (isNaN(ageMs) || ageMs > PLUGIN_HEARTBEAT_STALE_MS) {
      dot.className = 'plugin-dot offline'; text.textContent = `Economy plugin: heartbeat stale (last seen ${ago}).`;
      return;
    }
    const server = heartbeat.server ? ` · ${heartbeat.server}` : '';
    dot.className = 'plugin-dot online'; text.textContent = `Economy plugin running (last heartbeat ${ago}${server}).`;
  } catch(e) {
    dot.className = 'plugin-dot offline'; text.textContent = 'Economy plugin: could not read heartbeat from Supabase.';
  }
}

// ── Shop ──────────────────────────────────────────────────────
let _products = [];
async function loadAdminProducts() {
  const list = document.getElementById('shop-product-list');
  const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
  if (error) { list.innerHTML = `<div style="padding:1.5rem;color:#c0392b;font-size:13px;">Error: ${escapeHtml(error.message)}</div>`; return; }
  _products = data || [];
  if (!_products.length) { list.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px;">No products yet.</div>`; return; }
  list.innerHTML = _products.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border);gap:12px;">
      <div style="display:flex;align-items:center;gap:12px;min-width:0;">
        ${p.image_url ? `<img src="${escapeHtml(safeUrl(p.image_url))}" alt="${escapeHtml(p.name)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;flex-shrink:0;">` : `<div style="width:40px;height:40px;background:var(--bg);border:1px solid var(--border);border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px;">📦</div>`}
        <div><div style="font-weight:600;font-size:14px;color:var(--black);">${escapeHtml(p.name)}</div>
        <div style="font-size:12px;color:var(--muted);">$${Number(p.price).toFixed(2)} · ${p.product_type === 'subscription' ? '<span style="color:#7c5cbf">Subscription</span>' : p.inventory + ' in stock'} · <span style="color:${p.active?'#2d7d2f':'#c0392b'}">${p.active?'Active':'Inactive'}</span></div></div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" data-action="admin-edit-product" data-id="${p.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="admin-delete-product" data-id="${p.id}">Delete</button>
      </div>
    </div>`).join('');
}
// Orders had no admin view at all: a paid order for a physical item landed
// in the orders table and nobody could see it, let alone the address to post
// it to. Staff visibility comes from the orders_select_staff RLS policy.
async function loadAdminOrders() {
  const list = document.getElementById('shop-order-list');
  if (!list) return;
  const { data, error } = await supabase
    .from('orders')
    .select('id, user_id, kind, amount_total, currency, status, line_items, customer_email, shipping, created_at, stripe_checkout_session_id, stripe_invoice_id')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) { list.innerHTML = `<div style="padding:1.5rem;color:#c0392b;font-size:13px;">Error: ${escapeHtml(error.message)}</div>`; return; }
  const orders = data || [];
  if (!orders.length) { list.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px;">No orders yet.</div>`; return; }

  const nameFor = (userId) => {
    const m = _allMembers.find(x => x.id === userId);
    return m?.display_name || m?.username || m?.email || userId;
  };
  const addressOf = (shipping) => {
    const a = shipping?.address;
    if (!a) return '';
    return [shipping.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(' '), a.country]
      .filter(Boolean).join(', ');
  };

  list.innerHTML = orders.map(o => {
    const items = Array.isArray(o.line_items) ? o.line_items : [];
    const itemText = items.length
      ? items.map(i => `${escapeHtml(String(i.quantity ?? 1))}× ${escapeHtml(i.name || 'Item')}`).join(', ')
      : (o.kind === 'membership' ? 'MCA Membership' : '—');
    const address = addressOf(o.shipping);
    return `
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;gap:12px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;font-size:14px;color:var(--black);">
          ${o.kind === 'membership' ? 'Membership' : 'Shop order'} · ${escapeHtml(nameFor(o.user_id))}
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">${itemText}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">
          ${escapeHtml(new Date(o.created_at).toLocaleString())}
          ${o.customer_email ? ' · ' + escapeHtml(o.customer_email) : ''}
        </div>
        ${address ? `<div style="font-size:12px;color:var(--mid);margin-top:4px;">📦 ${escapeHtml(address)}</div>` : ''}
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-weight:600;font-size:14px;color:var(--black);">$${Number(o.amount_total || 0).toFixed(2)}</div>
        <div style="font-size:11px;color:${o.status === 'paid' ? '#2d7d2f' : 'var(--muted)'};text-transform:uppercase;letter-spacing:.5px;">${escapeHtml(o.status || '')}</div>
      </div>
    </div>`;
  }).join('');
}
window.loadAdminOrders = loadAdminOrders;
document.getElementById('btn-refresh-orders')?.addEventListener('click', loadAdminOrders);

function toggleInventoryField() {
  const type = document.getElementById('pm-product-type').value;
  document.getElementById('pm-inventory-group').style.display = type === 'subscription' ? 'none' : '';
  document.getElementById('pm-billing-group').style.display = type === 'subscription' ? '' : 'none';
}
function toggleBillingAnchorDate() {
  const anchor = document.getElementById('pm-billing-anchor').value;
  document.getElementById('pm-billing-anchor-date-group').style.display = anchor === 'fixed' ? '' : 'none';
}

// ── Product photo gallery (drag & drop, multi-file, 10MB total cap) ──
const PM_MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB
let _pmImages = []; // { type:'existing'|'new', url?, file?, previewUrl, name, size }

function pmTotalBytes() {
  return _pmImages.reduce((sum, img) => sum + (img.size || 0), 0);
}

function pmRenderImages() {
  const grid  = document.getElementById('pm-image-grid');
  const meter = document.getElementById('pm-image-size-meter');
  grid.innerHTML = _pmImages.map((img, i) => `
    <div style="position:relative;width:72px;height:72px;">
      <img src="${img.previewUrl || img.url}" alt="Product image preview" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">
      <button type="button" data-action="pm-remove-image" data-index="${i}" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#c0392b;color:#fff;border:none;cursor:pointer;font-size:11px;line-height:1;">✕</button>
      ${i === 0 ? `<div style="position:absolute;bottom:2px;left:2px;background:rgba(10,15,30,.65);color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;">Main</div>` : ''}
    </div>`).join('');
  const totalMB = (pmTotalBytes() / (1024*1024)).toFixed(2);
  meter.textContent = _pmImages.length ? `${totalMB} MB / 10 MB used across ${_pmImages.length} photo${_pmImages.length!==1?'s':''}` : '';
}

window.pmRemoveImage = (i) => { _pmImages.splice(i, 1); pmRenderImages(); };

function pmAddFiles(fileList) {
  const errEl = document.getElementById('pm-image-error');
  errEl.style.display = 'none';
  let runningTotal = pmTotalBytes();
  let rejected = 0;
  [...fileList].forEach(file => {
    if (!file.type.startsWith('image/')) return;
    if (runningTotal + file.size > PM_MAX_TOTAL_BYTES) { rejected++; return; }
    runningTotal += file.size;
    _pmImages.push({ type: 'new', file, previewUrl: URL.createObjectURL(file), name: file.name, size: file.size });
  });
  if (rejected) {
    errEl.textContent = `${rejected} photo${rejected!==1?'s':''} skipped — that would put this product's photos over the 10 MB total limit. Remove some or pick smaller files.`;
    errEl.style.display = 'block';
  }
  pmRenderImages();
}

const pmDropzone   = document.getElementById('pm-dropzone');
const pmFileInput  = document.getElementById('pm-file-input');
pmDropzone.addEventListener('click', () => pmFileInput.click());
pmFileInput.addEventListener('change', e => { pmAddFiles(e.target.files); pmFileInput.value = ''; });
['dragover','dragenter'].forEach(evt => pmDropzone.addEventListener(evt, e => {
  e.preventDefault(); pmDropzone.style.borderColor = 'var(--blue)'; pmDropzone.style.background = 'var(--bg)';
}));
['dragleave','dragend'].forEach(evt => pmDropzone.addEventListener(evt, e => {
  pmDropzone.style.borderColor = 'var(--border)'; pmDropzone.style.background = 'transparent';
}));
pmDropzone.addEventListener('drop', e => {
  e.preventDefault();
  pmDropzone.style.borderColor = 'var(--border)'; pmDropzone.style.background = 'transparent';
  pmAddFiles(e.dataTransfer.files);
});

async function pmUploadPendingImages(productIdHint) {
  const folder = productIdHint || `new-${Date.now()}`;
  const uploaded = [];
  for (const img of _pmImages) {
    if (img.type === 'existing') { uploaded.push({ url: img.url, name: img.name || '', size: img.size || 0 }); continue; }
    const ext = (img.file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const { error } = await supabase.storage.from('shop-images').upload(path, img.file);
    if (error) throw error;
    const { data } = supabase.storage.from('shop-images').getPublicUrl(path);
    uploaded.push({ url: data.publicUrl, name: img.file.name, size: img.file.size });
  }
  return uploaded;
}

function openProductModal(product = null) {
  ['id','name','desc','price','inventory','category','weight','dimensions','material','sizes','colors','sku','notes'].forEach(k => {
    const el = document.getElementById('pm-'+k);
    // `??`, not `||`: a price of 0 (free) or inventory of 0 (out of stock) are
    // legitimate stored values, and `||` blanked the field so saving an
    // otherwise-untouched product failed with "price/inventory is required".
    if (el) el.value = product?.[k === 'desc' ? 'description' : k === 'notes' ? 'admin_notes' : k] ?? '';
  });
  document.getElementById('pm-product-type').value = product?.product_type || 'physical';
  document.getElementById('pm-billing-cycle').value = product?.billing_cycle || 'monthly';
  document.getElementById('pm-billing-anchor').value = product?.billing_anchor || 'purchase';
  document.getElementById('pm-billing-anchor-date').value = product?.billing_anchor_date || '';
  toggleBillingAnchorDate();
  document.getElementById('pm-active').value = product ? String(product.active) : 'true';
  document.getElementById('pm-cart-enabled').checked = product ? (product.cart_enabled !== false) : true;
  document.getElementById('pm-error').style.display = 'none';
  document.getElementById('pm-image-error').style.display = 'none';
  document.getElementById('pm-title').textContent = product ? 'Edit Product' : 'Add Product';

  // Rebuild the photo gallery state from saved data.
  // Prefer the new `images` array; fall back to the legacy image_url/image_url2
  // fields for products created before multi-photo support (their byte size is
  // unknown, so they don't count against the 10MB meter until re-uploaded).
  _pmImages = [];
  if (product?.images && Array.isArray(product.images) && product.images.length) {
    _pmImages = product.images.map(img => ({ type: 'existing', url: img.url, name: img.name || '', size: img.size || 0 }));
  } else if (product) {
    if (product.image_url)  _pmImages.push({ type: 'existing', url: product.image_url,  name: '', size: 0 });
    if (product.image_url2) _pmImages.push({ type: 'existing', url: product.image_url2, name: '', size: 0 });
  }
  pmRenderImages();

  toggleInventoryField();
  document.getElementById('product-modal').style.display = 'flex';
}
function closeProductModal() { document.getElementById('product-modal').style.display = 'none'; }
document.getElementById('btn-add-product').addEventListener('click', () => openProductModal());
document.getElementById('pm-close').addEventListener('click', closeProductModal);
document.getElementById('pm-cancel').addEventListener('click', closeProductModal);
document.getElementById('pm-save').addEventListener('click', async () => {
  const id = document.getElementById('pm-id').value;
  const name = document.getElementById('pm-name').value.trim();
  const price = parseFloat(document.getElementById('pm-price').value);
  const productType = document.getElementById('pm-product-type').value;
  const isSubscription = productType === 'subscription';
  const inventoryRaw = document.getElementById('pm-inventory').value;
  const inventory = isSubscription ? null : parseInt(inventoryRaw, 10);
  const errEl = document.getElementById('pm-error');
  errEl.style.display = 'none';
  if (!name || isNaN(price)) { errEl.textContent = 'Name and price are required.'; errEl.style.display = 'block'; return; }
  if (!isSubscription && isNaN(inventory)) { errEl.textContent = 'Inventory is required for physical products.'; errEl.style.display = 'block'; return; }

  let uploadedImages;
  try {
    uploadedImages = await pmUploadPendingImages(id);
  } catch (err) {
    errEl.textContent = 'Photo upload failed: ' + err.message; errEl.style.display = 'block'; return;
  }

  const billingAnchor = document.getElementById('pm-billing-anchor').value;
  const billing_cycle = isSubscription ? document.getElementById('pm-billing-cycle').value : null;
  const billing_anchor = isSubscription ? billingAnchor : null;
  const billing_anchor_date = isSubscription && billingAnchor === 'fixed' ? (document.getElementById('pm-billing-anchor-date').value || null) : null;
  // A fixed billing anchor with no date would satisfy the DB constraints but
  // leaves nothing to bill against, so catch it here with a readable message
  // rather than letting it save incomplete.
  if (isSubscription && billingAnchor === 'fixed' && !billing_anchor_date) {
    errEl.textContent = 'Pick a fixed billing date, or set the billing anchor back to "From purchase date".';
    errEl.style.display = 'block';
    return;
  }

  const payload = { name, description: document.getElementById('pm-desc').value.trim()||null, price, inventory, product_type: productType, billing_cycle, billing_anchor, billing_anchor_date, category: document.getElementById('pm-category').value.trim()||null, active: document.getElementById('pm-active').value==='true', images: uploadedImages, image_url: uploadedImages[0]?.url || null, image_url2: uploadedImages[1]?.url || null, weight: document.getElementById('pm-weight').value.trim()||null, dimensions: document.getElementById('pm-dimensions').value.trim()||null, material: document.getElementById('pm-material').value.trim()||null, sizes: document.getElementById('pm-sizes').value.trim()||null, colors: document.getElementById('pm-colors').value.trim()||null, sku: document.getElementById('pm-sku').value.trim()||null, admin_notes: document.getElementById('pm-notes').value.trim()||null, cart_enabled: document.getElementById('pm-cart-enabled').checked };
  const { error } = id ? await supabase.from('products').update(payload).eq('id',id) : await supabase.from('products').insert(payload);
  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }
  closeProductModal(); loadAdminProducts();
});
window.adminEditProduct = async (id) => { const { data } = await supabase.from('products').select('*').eq('id',id).single(); if (data) openProductModal(data); };
window.adminDeleteProduct = async (id) => { if (!confirm('Delete this product?')) return; if (!confirm('Are you sure? This cannot be undone.')) return; await supabase.from('products').delete().eq('id',id); loadAdminProducts(); };

// ── Config ────────────────────────────────────────────────────
async function loadConfigTab() { await loadSiteConfig(); }
async function loadSiteConfig() {
  const { data } = await supabase.from('settings').select('value').eq('key','site_config').single();
  let cfg = {}; if (data?.value) { try { cfg = JSON.parse(data.value); } catch(e) {} }
  ['discord-url','youtube-url','instagram-url','twitter-url','email-us','stat1-label','stat1-value','stat1-sub','stat2-label','stat2-value','stat2-sub','stat3-label','stat3-value','stat3-sub','stat4-label','stat4-value','stat4-sub'].forEach(k => {
    const el = document.getElementById('cfg-'+k);
    if (el) el.value = cfg[k.replace('-','_')]||'';
  });
}
document.getElementById('btn-save-config').addEventListener('click', async () => {
  const statusEl = document.getElementById('cfg-status');
  statusEl.textContent = 'Saving...';
  const cfg = {};
  ['discord-url','youtube-url','instagram-url','twitter-url','email-us','stat1-label','stat1-value','stat1-sub','stat2-label','stat2-value','stat2-sub','stat3-label','stat3-value','stat3-sub','stat4-label','stat4-value','stat4-sub'].forEach(k => {
    let v = document.getElementById('cfg-'+k)?.value.trim()||'';
    if ((k === 'discord-url' || k === 'youtube-url' || k === 'instagram-url' || k === 'twitter-url') && v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    cfg[k.replace('-','_')] = v;
  });
  const { error } = await supabase.from('settings').upsert({ key:'site_config', value: JSON.stringify(cfg) }, { onConflict:'key' });
  statusEl.textContent = error ? 'Error: '+error.message : '✓ Saved';
  if (!error) setTimeout(() => { statusEl.textContent = ''; }, 3000);
});

document.getElementById('btn-send-legal-notice').addEventListener('click', async () => {
  const btn = document.getElementById('btn-send-legal-notice');
  const statusEl = document.getElementById('legal-notice-status');
  const doc = document.getElementById('legal-notice-doc').value;
  const summary = document.getElementById('legal-notice-summary').value.trim();
  if (!confirm(`Send a policy-update email to every member (and relevant parents) about the ${doc === 'terms' ? 'Terms of Service' : 'Privacy Policy'}?`)) return;
  btn.disabled = true;
  statusEl.textContent = 'Sending…';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${supabase.supabaseUrl}/functions/v1/notify-policy-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabase.supabaseKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ document: doc, summary }),
    });
    const json = await res.json();
    if (!res.ok || json.error) { statusEl.textContent = 'Error: ' + (json.error || 'Failed to send.'); }
    else { statusEl.textContent = `✓ Sent to ${json.sent} of ${json.total} recipients.`; document.getElementById('legal-notice-summary').value = ''; }
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false;
});

// ── Email an individual member ─────────────────────────────────
window.openEmailMemberModal = (userId) => {
  const m = _allMembers.find(x => x.id === userId);
  if (!m) return;
  document.getElementById('em-user-id').value = userId;
  document.getElementById('em-recipient-name').textContent = m.display_name || m.username || 'Member';
  document.getElementById('em-recipient-email').textContent = m.email || '';
  document.getElementById('em-subject').value = '';
  document.getElementById('em-message').value = '';
  document.getElementById('em-error').style.display = 'none';
  document.getElementById('email-member-modal').style.display = 'flex';
};
document.getElementById('em-close').onclick = document.getElementById('em-cancel').onclick = () => {
  document.getElementById('email-member-modal').style.display = 'none';
};
document.getElementById('em-send').addEventListener('click', async () => {
  const btn = document.getElementById('em-send');
  const errEl = document.getElementById('em-error');
  const userId = document.getElementById('em-user-id').value;
  const subject = document.getElementById('em-subject').value.trim();
  const message = document.getElementById('em-message').value.trim();
  errEl.style.display = 'none';
  if (!subject) { errEl.textContent = 'Subject is required.'; errEl.style.display = 'block'; return; }
  if (!message) { errEl.textContent = 'Message is required.'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${supabase.supabaseUrl}/functions/v1/email-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabase.supabaseKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ user_id: userId, subject, message }),
    });
    const json = await res.json();
    if (!res.ok || json.error) { errEl.textContent = 'Error: ' + (json.error || 'Failed to send.'); errEl.style.display = 'block'; }
    else { document.getElementById('email-member-modal').style.display = 'none'; }
  } catch (e) {
    errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block';
  }
  btn.disabled = false; btn.textContent = 'Send Email';
});

let _nationsAdmin = [], _leadersAdmin = [], _nationOwnersById = {}, _nmOwnerIds = [];
async function loadNationsAdmin() {
  const { data } = await supabase.from('nations').select('*').order('sort_order', { ascending: true });
  _nationsAdmin = data || [];
  fetchSeasonServerNames(); // warm the Year / Server dropdown

  const { data: ownerRows } = await supabase.from('nation_owners').select('nation_id,user_id,profiles(id,display_name,username)');
  _nationOwnersById = {};
  (ownerRows || []).forEach(r => { (_nationOwnersById[r.nation_id] ??= []).push(r.profiles); });

  const el = document.getElementById('nations-admin-list');
  el.innerHTML = _nationsAdmin.length ? _nationsAdmin.map(n => {
    const owners = (_nationOwnersById[n.id] || []).map(p => p?.display_name || p?.username).filter(Boolean);
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 1.5rem;border-bottom:1px solid var(--border);">
      <div><div style="font-weight:600;font-size:14px;">${escapeHtml(n.name)}${n.season ? ` <span style="font-weight:600;font-size:11px;color:var(--blue);border:1px solid var(--blue);border-radius:20px;padding:1px 8px;vertical-align:middle;">${escapeHtml(n.season)}</span>` : ''}</div><div style="font-size:12px;color:var(--muted);">${[n.government?escapeHtml(n.government):'',n.leader?'Led by '+escapeHtml(n.leader):'',n.founded?escapeHtml(n.founded):''].filter(Boolean).join(' · ')}</div><div style="font-size:12px;color:var(--muted);">${owners.length?'Leader(s): '+owners.map(escapeHtml).join(', '):'No leader assigned'}</div></div>
      <div style="display:flex;gap:8px;"><button class="btn btn-outline btn-sm" data-action="open-nation-modal" data-id="${n.id}">Edit</button><button class="btn btn-danger btn-sm" data-action="delete-nation" data-id="${n.id}">Delete</button></div>
    </div>`;
  }).join('')
    : '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px;">No nations yet.</div>';
}

function renderOwnerChips() {
  const box = document.getElementById('nm-owner-chips');
  box.innerHTML = _nmOwnerIds.map(id => {
    const m = _allMembers.find(x => x.id === id);
    const label = m?.display_name || m?.username || 'Unknown user';
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--light-blue,#eef3fb);color:var(--blue);font-size:12px;font-weight:600;padding:4px 8px;border-radius:20px;">${escapeHtml(label)}<button type="button" data-action="toggle-nation-owner" data-id="${id}" style="background:none;border:none;cursor:pointer;color:inherit;font-size:14px;line-height:1;padding:0;">✕</button></span>`;
  }).join('');
  const labelEl = document.getElementById('nm-owner-dropdown-label');
  labelEl.textContent = _nmOwnerIds.length
    ? _nmOwnerIds.length + (_nmOwnerIds.length === 1 ? ' leader selected' : ' leaders selected')
    : 'Select leaders…';
  labelEl.style.color = _nmOwnerIds.length ? 'inherit' : 'var(--muted)';
}
function renderOwnerDropdownList() {
  const q = document.getElementById('nm-owner-dropdown-search').value.trim().toLowerCase();
  const list = document.getElementById('nm-owner-dropdown-list');
  const matches = _allMembers.filter(m => !q || (m.display_name || '').toLowerCase().includes(q) || (m.username || '').toLowerCase().includes(q));
  list.innerHTML = matches.length
    ? matches.map(m => `<div class="owner-dropdown-item" data-action="toggle-nation-owner" data-id="${m.id}" role="checkbox" aria-checked="${_nmOwnerIds.includes(m.id)}" tabindex="0" style="padding:8px 10px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;"><input type="checkbox" tabindex="-1" aria-hidden="true" ${_nmOwnerIds.includes(m.id) ? 'checked' : ''} style="pointer-events:none;">${escapeHtml(m.display_name || m.username)}${m.username && m.display_name ? ' <span style="color:var(--muted);">@'+escapeHtml(m.username)+'</span>' : ''}</div>`).join('')
    : '<div style="padding:8px 10px;font-size:13px;color:var(--muted);">No matches</div>';
}
window.toggleNationOwner = (id) => {
  _nmOwnerIds = _nmOwnerIds.includes(id) ? _nmOwnerIds.filter(x => x !== id) : [..._nmOwnerIds, id];
  renderOwnerChips();
  renderOwnerDropdownList();
};
document.getElementById('nm-owner-dropdown-search').addEventListener('input', renderOwnerDropdownList);
document.getElementById('nm-owner-dropdown-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const panel = document.getElementById('nm-owner-dropdown-panel');
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (opening) { document.getElementById('nm-owner-dropdown-search').value = ''; renderOwnerDropdownList(); document.getElementById('nm-owner-dropdown-search').focus(); }
});
document.addEventListener('click', (e) => {
  const panel = document.getElementById('nm-owner-dropdown-panel');
  if (panel && panel.style.display !== 'none' && !panel.contains(e.target) && e.target.id !== 'nm-owner-dropdown-btn') panel.style.display = 'none';
});
async function loadLeadershipAdmin() {
  const { data } = await supabase.from('leadership').select('*').order('sort_order', { ascending: true });
  _leadersAdmin = data || [];
  // Order + labels mirror the four sections actually rendered on leadership.html.
  // "other" has no section on the public page, so it's called out explicitly here.
  const BRANCH_ORDER = ['administrative', 'cabinet', 'congress', 'court', 'other'];
  const BRANCH_LABEL = {
    administrative: 'Administrative Branch',
    cabinet:        'Cabinet Departments',
    congress:       'World Congress',
    court:          'World Court',
    other:          'Other <span class="leadership-branch-note">(not shown on the public site)</span>',
  };
  const el = document.getElementById('leadership-admin-list');

  if (!_leadersAdmin.length) {
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px;">No leaders yet.</div>';
    return;
  }

  el.innerHTML = BRANCH_ORDER.map(branch => {
    const rows = _leadersAdmin.filter(l => (l.branch || 'other') === branch);
    if (!rows.length) return '';
    return `
      <div class="leadership-branch-group">
        <div class="leadership-branch-heading">${BRANCH_LABEL[branch]} <span class="leadership-branch-count">${rows.length}</span></div>
        ${rows.map(l => `
          <div class="leadership-row" style="display:flex;align-items:center;justify-content:space-between;padding:10px 1.5rem;border-bottom:1px solid var(--border);">
            <div><div style="font-weight:600;font-size:14px;">${escapeHtml(l.name)}</div><div style="font-size:12px;color:var(--muted);">${escapeHtml(l.title)}${l.subtitle?' · '+escapeHtml(l.subtitle):''} · Order ${escapeHtml(l.sort_order)}${l.show_in_team?' · Team grid':''}</div></div>
            <div style="display:flex;gap:8px;"><button class="btn btn-outline btn-sm" data-action="open-leader-modal" data-id="${l.id}">Edit</button><button class="btn btn-danger btn-sm" data-action="delete-leader" data-id="${l.id}">Delete</button></div>
          </div>`).join('')}
      </div>`;
  }).join('');
}
document.getElementById('btn-add-nation').addEventListener('click', () => openNationModal(null));

// The Year / Server dropdown is driven by the same history_servers rows the
// history page lists, plus any season already saved on a nation so legacy
// free-text values survive an edit.
let _seasonServerNames = null;
async function fetchSeasonServerNames() {
  if (_seasonServerNames) return _seasonServerNames;
  const { data, error } = await supabase.from('history_servers').select('name,sort_order').order('sort_order', { ascending: true });
  if (error) return [];
  _seasonServerNames = (data || []).map(s => s.name).filter(Boolean);
  return _seasonServerNames;
}
function populateSeasonSelect(current) {
  const sel = document.getElementById('nm-season');
  if (!sel) return;
  const used = _nationsAdmin.map(n => n.season).filter(Boolean);
  const opts = [...new Set([...(_seasonServerNames || []), ...used, ...(current ? [current] : [])])];
  sel.innerHTML = '<option value="">— None —</option>' +
    opts.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  sel.value = current || '';
}
window.openNationModal = (id) => {
  const n = id ? _nationsAdmin.find(x => x.id === id) : null;
  populateSeasonSelect(n?.season || '');
  fetchSeasonServerNames().then(() => populateSeasonSelect(document.getElementById('nm-season')?.value || n?.season || ''));
  ['id','name','leader','capital','government','founded','founder','population','territory','status','flag','body','sort_order'].forEach(k => {
    const el = document.getElementById('nm-'+k); if (el) el.value = n?.[k] ?? '';
  });
  _nmOwnerIds = n ? (_nationOwnersById[n.id] || []).map(p => p?.id).filter(Boolean) : [];
  document.getElementById('nm-owner-dropdown-panel').style.display = 'none';
  renderOwnerChips();
  document.getElementById('nm-error').style.display = 'none';
  document.getElementById('nm-title').textContent = n ? 'Edit Nation' : 'Add Nation';
  document.getElementById('nation-modal').style.display = 'flex';
};
function closeNationModal() { document.getElementById('nation-modal').style.display = 'none'; }
document.getElementById('nm-close').addEventListener('click', closeNationModal);
document.getElementById('nm-cancel').addEventListener('click', closeNationModal);
document.getElementById('nm-save').addEventListener('click', async () => {
  const name = document.getElementById('nm-name').value.trim();
  if (!name) { const e = document.getElementById('nm-error'); e.textContent = 'Nation name is required.'; e.style.display = 'block'; return; }
  const id = document.getElementById('nm-id').value;
  const payload = { name };
  ['leader','capital','government','founded','founder','population','territory','status','season','flag','body'].forEach(k => { payload[k] = document.getElementById('nm-'+k)?.value.trim()||null; });
  const sortVal = document.getElementById('nm-sort_order')?.value.trim();
  if (sortVal !== '') payload.sort_order = parseInt(sortVal);
  const result = id ? await supabase.from('nations').update(payload).eq('id',id).select() : await supabase.from('nations').insert(payload).select();
  const { data, error } = result;
  if (error) { const e = document.getElementById('nm-error'); e.textContent = 'Error: ' + error.message; e.style.display = 'block'; return; }
  const nationId = id || data?.[0]?.id;
  if (nationId) {
    await supabase.from('nation_owners').delete().eq('nation_id', nationId);
    if (_nmOwnerIds.length) await supabase.from('nation_owners').insert(_nmOwnerIds.map(user_id => ({ nation_id: nationId, user_id })));
  }
  closeNationModal(); await loadNationsAdmin();
});
window.deleteNation = async (id) => { if (!confirm('Delete this nation?')) return; if (!confirm('Are you sure? This cannot be undone.')) return; await supabase.from('nations').delete().eq('id',id); await loadNationsAdmin(); };

document.getElementById('btn-add-leader').addEventListener('click', () => openLeaderModal(null));
window.openLeaderModal = (id) => {
  const l = id ? _leadersAdmin.find(x => x.id === id) : null;
  document.getElementById('lm-id').value = l?.id||'';
  document.getElementById('lm-name').value = l?.name||'';
  document.getElementById('lm-title').value = l?.title||'';
  document.getElementById('lm-subtitle').value = l?.subtitle||'';
  document.getElementById('lm-branch').value = l?.branch||'administrative';
  document.getElementById('lm-sort').value = l?.sort_order??0;
  document.getElementById('lm-show-in-team').checked = l?.show_in_team||false;
  document.getElementById('lm-error').style.display = 'none';
  document.getElementById('lm-modal-title').textContent = l ? 'Edit Person' : 'Add Person';
  document.getElementById('leader-modal').style.display = 'flex';
};
function closeLeaderModal() { document.getElementById('leader-modal').style.display = 'none'; }
document.getElementById('lm-close').addEventListener('click', closeLeaderModal);
document.getElementById('lm-cancel').addEventListener('click', closeLeaderModal);
document.getElementById('lm-save').addEventListener('click', async () => {
  const name = document.getElementById('lm-name').value.trim(), title = document.getElementById('lm-title').value.trim();
  if (!name||!title) { const e = document.getElementById('lm-error'); e.textContent = 'Name and Title are required.'; e.style.display = 'block'; return; }
  const id = document.getElementById('lm-id').value;
  const sortVal = document.getElementById('lm-sort').value;
  const sort_order = sortVal === '' || sortVal === null || isNaN(sortVal) ? 0 : parseInt(sortVal, 10);
  const payload = { name, title, subtitle: document.getElementById('lm-subtitle').value.trim()||null, branch: document.getElementById('lm-branch').value, sort_order: sort_order, show_in_team: document.getElementById('lm-show-in-team').checked };
  const result = id ? await supabase.from('leadership').update(payload).eq('id',id).select() : await supabase.from('leadership').insert(payload).select();
  const { data, error } = result;
  if (error) { const e = document.getElementById('lm-error'); e.textContent = 'Error: ' + error.message; e.style.display = 'block'; return; }
  closeLeaderModal(); await loadLeadershipAdmin();
});
window.deleteLeader = async (id) => { if (!confirm('Remove this person?')) return; if (!confirm('Are you sure? This cannot be undone.')) return; await supabase.from('leadership').delete().eq('id',id); await loadLeadershipAdmin(); };

// ── History Servers ──────────────────────────────────────────
let _historyServersAdmin = [];
async function loadHistoryServersAdmin() {
  const el = document.getElementById('history-servers-admin-list');
  const { data, error } = await supabase.from('history_servers').select('*').order('sort_order', { ascending: true });
  if (error) { el.innerHTML = `<div style="text-align:center;padding:2rem;color:#c0392b;font-size:13px;">Error: ${escapeHtml(error.message)}</div>`; return; }
  _historyServersAdmin = data || [];
  el.innerHTML = _historyServersAdmin.length
    ? _historyServersAdmin.map(s => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 1.5rem;border-bottom:1px solid var(--border);">
          <div><div style="font-weight:600;font-size:14px;">${escapeHtml(s.name)}${s.is_current ? ' <span style="color:var(--green);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">Current</span>' : ''}</div><div style="font-size:12px;color:var(--muted);">${escapeHtml(s.period)} · Order ${escapeHtml(s.sort_order)}</div></div>
          <div style="display:flex;gap:8px;"><button class="btn btn-outline btn-sm" data-action="open-history-server-modal" data-id="${s.id}">Edit</button><button class="btn btn-danger btn-sm" data-action="delete-history-server" data-id="${s.id}">Delete</button></div>
        </div>`).join('')
    : '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px;">No servers yet.</div>';
}
document.getElementById('btn-add-history-server').addEventListener('click', () => openHistoryServerModal(null));
window.openHistoryServerModal = (id) => {
  const s = id ? _historyServersAdmin.find(x => x.id === id) : null;
  document.getElementById('hs-id').value = s?.id || '';
  document.getElementById('hs-name').value = s?.name || '';
  document.getElementById('hs-period').value = s?.period || '';
  document.getElementById('hs-sort').value = s?.sort_order ?? 0;
  document.getElementById('hs-is-current').checked = s?.is_current || false;
  document.getElementById('hs-description').value = s?.description || '';
  document.getElementById('hs-error').style.display = 'none';
  document.getElementById('hs-modal-title').textContent = s ? 'Edit Server' : 'Add Server';
  document.getElementById('hs-modal').style.display = 'flex';
};
function closeHistoryServerModal() { document.getElementById('hs-modal').style.display = 'none'; }
document.getElementById('hs-close').addEventListener('click', closeHistoryServerModal);
document.getElementById('hs-cancel').addEventListener('click', closeHistoryServerModal);
document.getElementById('hs-save').addEventListener('click', async () => {
  const name = document.getElementById('hs-name').value.trim(), period = document.getElementById('hs-period').value.trim();
  if (!name || !period) { const e = document.getElementById('hs-error'); e.textContent = 'Server Name and Period are required.'; e.style.display = 'block'; return; }
  const id = document.getElementById('hs-id').value;
  const sortVal = document.getElementById('hs-sort').value;
  const sort_order = sortVal === '' || sortVal === null || isNaN(sortVal) ? 0 : parseInt(sortVal, 10);
  const payload = { name, period, description: document.getElementById('hs-description').value.trim() || null, is_current: document.getElementById('hs-is-current').checked, sort_order };
  const result = id ? await supabase.from('history_servers').update(payload).eq('id', id).select() : await supabase.from('history_servers').insert(payload).select();
  const { error } = result;
  if (error) { const e = document.getElementById('hs-error'); e.textContent = 'Error: ' + error.message; e.style.display = 'block'; return; }
  _seasonServerNames = null; // server list changed — refresh the nation dropdown cache
  closeHistoryServerModal(); await loadHistoryServersAdmin();
});
window.deleteHistoryServer = async (id) => { if (!confirm('Delete this server?')) return; if (!confirm('Are you sure? This cannot be undone.')) return; await supabase.from('history_servers').delete().eq('id', id); _seasonServerNames = null; await loadHistoryServersAdmin(); };

// ── Club Presidents ───────────────────────────────────────────
let _clubPresidents = [];

async function loadClubPresidentsAdmin() {
  const el = document.getElementById('club-presidents-admin-list');
  const { data, error } = await supabase.from('club_presidents').select('*').order('region', { ascending: true });
  if (error) {
    el.innerHTML = `<div style="text-align:center;padding:2rem;color:#c0392b;font-size:13px;">Error: ${escapeHtml(error.message)}</div>`;
    return;
  }
  _clubPresidents = data || [];
  el.innerHTML = _clubPresidents.length
    ? _clubPresidents.map(p => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 1.5rem;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:600;font-size:14px;">${escapeHtml(p.name)}${p.username ? ` <span style="font-size:12px;color:var(--muted);font-weight:400;">@${escapeHtml(p.username)}</span>` : ''}</div>
          <div style="font-size:12px;color:var(--muted);">${escapeHtml(p.club_name)}${p.region ? ' · ' + escapeHtml(p.region) : ''} · ${p.president_user_id ? 'Account linked' : '<span style="color:#b07d00;">No linked account</span>'}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-outline btn-sm" data-action="open-c-p-modal" data-id="${p.id}">Edit</button>
          <button class="btn btn-danger btn-sm" data-action="delete-club-president" data-id="${p.id}">Delete</button>
        </div>
      </div>`).join('')
    : '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px;">No club presidents yet.</div>';
}

window.openCPModal = (id) => {
  const p = id ? _clubPresidents.find(x => x.id === id) : null;
  document.getElementById('cp-id').value        = p?.id || '';
  document.getElementById('cp-name').value      = p?.name || '';
  document.getElementById('cp-club-name').value = p?.club_name || '';
  document.getElementById('cp-username').value  = p?.username || '';
  document.getElementById('cp-region').value    = p?.region || '';
  document.getElementById('cp-error').style.display = 'none';
  document.getElementById('cp-modal-title').textContent = p ? 'Edit Club President' : 'Add Club President';
  document.getElementById('cp-modal').style.display = 'flex';
};

function closeCPModal() { document.getElementById('cp-modal').style.display = 'none'; }
document.getElementById('cp-close').addEventListener('click',  closeCPModal);
document.getElementById('cp-cancel').addEventListener('click', closeCPModal);
document.getElementById('btn-add-club-president').addEventListener('click', () => openCPModal(null));

document.getElementById('cp-save').addEventListener('click', async () => {
  const name      = document.getElementById('cp-name').value.trim();
  const club_name = document.getElementById('cp-club-name').value.trim();
  const errEl     = document.getElementById('cp-error');
  errEl.style.display = 'none';
  if (!name || !club_name) { errEl.textContent = 'Name and School/Club Name are required.'; errEl.style.display = 'block'; return; }
  const id = document.getElementById('cp-id').value;
  const payload = {
    name,
    club_name,
    username: document.getElementById('cp-username').value.trim() || null,
    region:   document.getElementById('cp-region').value.trim()   || null,
  };
  const { error } = id
    ? await supabase.from('club_presidents').update(payload).eq('id', id)
    : await supabase.from('club_presidents').insert(payload);
  if (error) { errEl.textContent = 'Error: ' + error.message; errEl.style.display = 'block'; return; }
  closeCPModal();
  await loadClubPresidentsAdmin();
});

window.deleteClubPresident = async (id) => {
  if (!confirm('Remove this club president?')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  await supabase.from('club_presidents').delete().eq('id', id);
  await loadClubPresidentsAdmin();
};

// ── Tabs ──────────────────────────────────────────────────────
function switchTab(tabName) {
  // Deactivate all flat tabs and group items
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-group-trigger').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-group-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  // Close all groups
  document.querySelectorAll('.admin-tab-group').forEach(g => g.classList.remove('open'));

  // Activate the panel
  const panel = document.getElementById('tab-' + tabName);
  if (panel) panel.classList.add('active');

  // Mark the right trigger active
  const flatTab = document.querySelector(`.admin-tab[data-tab="${tabName}"]`);
  if (flatTab) { flatTab.classList.add('active'); }
  const groupItem = document.querySelector(`.admin-tab-group-item[data-tab="${tabName}"]`);
  if (groupItem) {
    groupItem.classList.add('active');
    groupItem.closest('.admin-tab-group')?.querySelector('.admin-tab-group-trigger').classList.add('active');
  }

  // Lazy-load hooks
  if (tabName === 'shop')       { loadAdminProducts(); loadAdminOrders(); }
  if (tabName === 'config')     loadConfigTab();
  if (tabName === 'news')       loadNewsAdmin();
  if (tabName === 'archive')    loadArchiveAdmin();
  if (tabName === 'faqs')       loadFaqAdmin();
  if (tabName === 'history-servers') loadHistoryServersAdmin();
  if (tabName === 'roles')      renderRoles();
  if (tabName === 'messages')   loadMessages();
  if (tabName === 'leadership')      loadLeadershipAdmin();
  if (tabName === 'club-presidents') loadClubPresidentsAdmin();
  if (tabName === 'nations')         loadNationsAdmin();
  if (tabName === 'audit-log')       loadAuditLog();
  if (tabName === 'economy')         loadEconomyAdmin();

  // Persist so a refresh (or reopening the page) lands back on this tab.
  // replaceState (not pushState) so tab switches don't pile up browser history.
  if (window.location.hash !== '#' + tabName) {
    history.replaceState(null, '', '#' + tabName);
  }
  try { localStorage.setItem('admin-active-tab', tabName); } catch (e) {}
}

// Flat tabs
document.querySelectorAll('.admin-tab:not(.admin-tab-group-trigger):not(.admin-tab-link)').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// Group items
document.querySelectorAll('.admin-tab-group-item:not(.admin-tab-link)').forEach(item => {
  item.addEventListener('click', () => switchTab(item.dataset.tab));
});

// Group triggers — toggle dropdown, close others
//
// The "Members"/"Content" dropdown menus used to live inside .admin-tabs,
// which scrolls horizontally on phones (overflow-x: auto). Mobile Safari has
// a long-standing bug where a `position: fixed` element nested inside a
// horizontally-scrolling ancestor can render clipped, offset, or just never
// show up at all — which is exactly what made these menus "not function" on
// phone even though the same code worked fine on desktop. Moving each menu
// out to be a direct child of <body> sidesteps that entirely: the menu is no
// longer a descendant of the scrolling strip at all, on any device.
document.querySelectorAll('.admin-tab-group').forEach(grp => {
  const menu = grp.querySelector('.admin-tab-group-menu');
  if (!menu) return;
  menu.dataset.forGroup = grp.id;
  document.body.appendChild(menu);
});

function getGroupMenu(grp) {
  return document.querySelector(`.admin-tab-group-menu[data-for-group="${grp.id}"]`);
}
function closeAllGroupMenus() {
  document.querySelectorAll('.admin-tab-group').forEach(g => g.classList.remove('open'));
  document.querySelectorAll('.admin-tab-group-menu').forEach(m => m.classList.remove('open'));
}

document.querySelectorAll('.admin-tab-group-trigger').forEach(trigger => {
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const grp = trigger.closest('.admin-tab-group');
    const menu = getGroupMenu(grp);
    const wasOpen = grp.classList.contains('open');
    closeAllGroupMenus();
    if (!wasOpen && menu) {
      // Only matters on desktop — the mobile media query pins the menu to
      // the bottom of the screen with `!important`, overriding this.
      const rect = trigger.getBoundingClientRect();
      menu.style.top = (rect.bottom + 4) + 'px';
      menu.style.left = rect.left + 'px';
      grp.classList.add('open');
      menu.classList.add('open');
    }
  });
});
document.addEventListener('click', closeAllGroupMenus);
window.addEventListener('resize', closeAllGroupMenus);

// The hash and the saved tab both feed a querySelector template below; a value
// containing a quote produces an invalid selector and throws, which used to
// abort the whole admin bootstrap. Tab names are plain slugs, so anything else
// is discarded.
const isTabName = (v) => /^[a-z0-9-]{1,40}$/i.test(String(v ?? ''));
let _hashTab = window.location.hash.replace('#','');
if (!isTabName(_hashTab)) _hashTab = '';
if (!_hashTab) {
  try {
    const saved = localStorage.getItem('admin-active-tab') || '';
    _hashTab = isTabName(saved) ? saved : '';
  } catch (e) {}
}
// NOTE: switchTab(_hashTab) is intentionally NOT called here. At this point
// in the script, init() (called at the bottom of the file) hasn't run yet —
// the session isn't authenticated, permissions haven't loaded, and #admin-main
// is still display:none. Calling switchTab() this early used to fire
// loadAuditLog() against a not-yet-ready supabase session on a hidden panel,
// and nothing re-ran it once the tab actually became visible. Restoring the
// saved tab now happens at the end of init(), once the panel is shown and
// permissions are known — see restoreActiveTab() below.
function restoreActiveTab() {
  if (!_hashTab || _hashTab === 'overview') return;
  // Don't switch to a tab the user isn't permitted to see (e.g. a stale
  // audit-log hash for someone who no longer has can_view_audit_log).
  const trigger = document.querySelector(`[data-tab="${_hashTab}"]`);
  if (!trigger || trigger.classList.contains('hidden')) return;
  switchTab(_hashTab);
}

// ── Admin Messages ────────────────────────────────────────────
let _messages = [];   // threads
let _items = {};      // thread_id -> [items] (chronological)
let _expandedThreads = new Set();
let _myDisplayName = null;

async function getMyDisplayName() {
  if (_myDisplayName) return _myDisplayName;
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('profiles').select('display_name,username').eq('id', user.id).single();
  _myDisplayName = profile?.display_name || profile?.username || 'An admin';
  return _myDisplayName;
}

// Role/tag colours land inside style="" attributes, where a crafted value
// could close the attribute or inject extra CSS.
function safeColor(c) {
  const v = String(c ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : '#888888';
}

// Only http(s) and relative URLs may reach an href/src.
function safeUrl(url) {
  // Positive allowlist: the browser's own URL parser resolves the value (it
  // strips every leading C0 control char, which the old regex missed) and only
  // http(s) survives. Relative links resolve against this page, so they still work.
  // Empty/missing input must NOT fall through: new URL('', base) resolves to the
  // page URL itself, which would render a broken <img> pointing at this document.
  if (url == null || String(url).trim() === '') return '';
  try {
    const p = new URL(String(url), location.href);
    return (p.protocol === 'https:' || p.protocol === 'http:') ? p.href : '';
  } catch { return ''; }
}

function isSafeAttachmentUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url);
}

function renderMsgAttachments(attachments) {
  // A malformed attachments value (a bare string, a lone object, or an entry
  // that is not an object) used to throw inside .filter() and kill the whole
  // inbox render. Only a real array of objects is rendered now; anything
  // else renders as no attachments (the DB half of this fix is the
  // admin_message_items attachments CHECK in supabase/migrations/).
  if (!Array.isArray(attachments) || !attachments.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
    ${attachments.filter(a => a && typeof a === 'object' && isSafeAttachmentUrl(a.url)).map(a => `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name||'attachment')}" style="width:56px;height:56px;object-fit:cover;border-radius:5px;border:1px solid var(--border);"></a>`).join('')}
  </div>`;
}

async function uploadMsgAttachments(files) {
  const { data: { user } } = await supabase.auth.getUser();
  const uploaded = [];
  for (const file of files) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const { error } = await supabase.storage.from('message-attachments').upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from('message-attachments').getPublicUrl(path);
    uploaded.push({ url: data.publicUrl, name: file.name, size: file.size });
  }
  return uploaded;
}

// Local thumbnail preview of just-selected files, before upload, so an
// admin can confirm it's the right photo. Bound once via delegation below
// since reply forms are re-created on every renderMessages().
function renderFilePreview(fileInput, previewEl) {
  if (!previewEl) return;
  previewEl.innerHTML = '';
  [...(fileInput.files || [])].forEach(f => {
    const url = URL.createObjectURL(f);
    previewEl.insertAdjacentHTML('beforeend', `<img src="${escapeHtml(safeUrl(url))}" alt="${escapeHtml(f.name)}" style="width:56px;height:56px;object-fit:cover;border-radius:5px;border:1px solid var(--border);">`);
  });
}
document.getElementById('messages-inbox').addEventListener('change', (e) => {
  if (e.target.matches('input[type="file"]')) {
    const id = e.target.id.replace('reply-file-', '');
    renderFilePreview(e.target, document.getElementById(`reply-preview-${id}`));
  }
});

async function loadMessages() {
  const inbox = document.getElementById('messages-inbox');
  inbox.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:13px;">Loading...</div>';

  const { data, error } = await supabase
    .from('admin_messages')
    .select('*, profiles!admin_messages_user_id_fkey(display_name, username, email)')
    .order('last_message_at', { ascending: false });

  if (error) {
    inbox.innerHTML = `<div class="msg-empty">Failed to load messages: ${escapeHtml(error.message)}</div>`;
    return;
  }
  _messages = data || [];

  const { data: itemRows, error: itemErr } = await supabase
    .from('admin_message_items')
    .select('*')
    .order('created_at', { ascending: true });
  _items = {};
  if (!itemErr) {
    (itemRows || []).forEach(it => {
      (_items[it.thread_id] ||= []).push(it);
    });
  }

  renderMessages();
  updateUnreadBadge();
}

function threadUnread(id) {
  return (_items[id] || []).some(i => i.sender_type === 'user' && !i.read_by_admin);
}

function renderMessages() {
  const inbox = document.getElementById('messages-inbox');
  if (!_messages.length) {
    inbox.innerHTML = '<div class="msg-empty">No messages yet.</div>';
    return;
  }
  inbox.innerHTML = _messages.map(m => { try {
    const p = m.profiles || {};
    const sender = escapeHtml(p.display_name || p.username || p.email || m.user_id);
    const subject = escapeHtml(m.subject || '(no subject)');
    const unread = threadUnread(m.id);
    const items = _items[m.id] || [];
    const expanded = _expandedThreads.has(m.id);
    const lastItem = items[items.length - 1];
    const lastPreviewRaw = lastItem ? lastItem.body.slice(0, 80) + (lastItem.body.length > 80 ? '…' : '') : '';
    const lastPreview = escapeHtml(lastPreviewRaw);
    const lastTime = lastItem ? new Date(lastItem.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric' }) : '';
    const claimBadge = m.claimed_by
      ? `<span class="badge" style="background:#eef3ff;color:#18489e;">Claimed by ${escapeHtml(m.claimed_by_name || 'an admin')}</span>` : '';
    const claimBtn = m.claimed_by
      ? `<button class="btn btn-outline btn-sm" data-action="unclaim-thread" data-id="${m.id}">Unclaim</button>`
      : `<button class="btn btn-outline btn-sm" data-action="claim-thread" data-id="${m.id}">Claim</button>`;

    const itemsHtml = items.map(it => {
      const t = new Date(it.created_at).toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
      const adminLabel = it.sender_display_name ? `Your Reply · ${escapeHtml(it.sender_display_name)}` : 'Your Reply';
      const body = escapeHtml(it.body);
      return it.sender_type === 'admin'
        ? `<div style="margin-top:8px;padding:10px 12px;background:var(--bg);border-left:3px solid var(--blue);border-radius:4px;">
             <div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--blue);margin-bottom:4px;">${adminLabel} · ${escapeHtml(t)}</div>
             <div style="font-size:13px;white-space:pre-wrap;">${body}</div>
             ${renderMsgAttachments(it.attachments)}
           </div>`
        : `<div style="margin-top:8px;padding:10px 12px;background:var(--card,var(--bg));border-left:3px solid var(--border);border-radius:4px;">
             <div style="font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">${sender} · ${escapeHtml(t)}</div>
             <div style="font-size:13px;white-space:pre-wrap;">${body}</div>
             ${renderMsgAttachments(it.attachments)}
           </div>`;
    }).join('');

    return `<div class="msg-row ${unread ? 'unread' : ''}" data-id="${m.id}">
      <div class="msg-dot"></div>
      <div class="msg-content">
        <div class="msg-meta" style="cursor:pointer;" data-action="toggle-thread-expand" data-id="${m.id}" role="button" tabindex="0" aria-expanded="${expanded ? 'true' : 'false'}">
          <span class="msg-sender">${sender}</span>
          ${claimBadge}
          <span style="margin-left:auto;font-size:11px;color:var(--muted);">${expanded ? '▲' : '▼'}</span>
        </div>
        <div class="msg-subject" style="cursor:pointer;" data-action="toggle-thread-expand" data-id="${m.id}" role="button" tabindex="0">${subject}</div>
        ${expanded ? '' : `<div style="font-size:12px;color:var(--muted);margin-top:2px;cursor:pointer;" data-action="toggle-thread-expand" data-id="${m.id}" role="button" tabindex="0">${lastPreview} ${lastPreview ? '· ' + lastTime : ''}</div>`}
        ${expanded ? `
        ${itemsHtml}
        <div class="msg-reply-form" style="margin-top:10px;">
          <textarea class="form-input" id="reply-input-${m.id}" rows="2" placeholder="Write a message..." style="resize:vertical;min-height:60px;width:100%;box-sizing:border-box;"></textarea>
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap;">
            <input type="file" id="reply-file-${m.id}" accept="image/*" multiple style="font-size:11px;max-width:200px;">
            <label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer;">
              <input type="checkbox" id="reply-share-name-${m.id}" checked> Share my name with the member
            </label>
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Photos up to 10 MB total.</div>
          <div id="reply-preview-${m.id}" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
          <button class="btn btn-primary btn-sm" style="margin-top:6px;" data-action="send-message-reply" data-id="${m.id}">Send</button>
        </div>` : ''}
      </div>
      <div class="msg-actions">
        ${claimBtn}
        ${unread
          ? `<button class="btn btn-outline btn-sm" data-action="toggle-message-read" data-id="${m.id}" data-read="1">Mark Read</button>`
          : `<button class="btn btn-outline btn-sm" data-action="toggle-message-read" data-id="${m.id}" data-read="0">Mark Unread</button>`
        }
        <button class="btn btn-danger btn-sm" data-action="delete-message" data-id="${m.id}">Delete</button>
      </div>
    </div>`;
  } catch (err) {
    // One bad thread (malformed body, date, or attachments) must not kill
    // the whole inbox render — show a placeholder row for it instead.
    console.error('renderMessages: could not render thread', m && m.id, err);
    return `<div class="msg-row" data-id="${m.id}"><div class="msg-content"><div class="msg-subject">This thread could not be displayed.</div></div></div>`;
  }
  }).join('');
}

window.toggleThreadExpand = (id) => {
  if (_expandedThreads.has(id)) _expandedThreads.delete(id);
  else _expandedThreads.add(id);
  renderMessages();
};

window.claimThread = async (id) => {
  const name = await getMyDisplayName();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('admin_messages').update({ claimed_by: user.id, claimed_by_name: name, claimed_at: new Date().toISOString() }).eq('id', id);
  if (error) { alert(error.message || 'Failed to claim.'); return; }
  const m = _messages.find(x => x.id === id);
  if (m) { m.claimed_by = user.id; m.claimed_by_name = name; }
  renderMessages();
};

window.unclaimThread = async (id) => {
  const { error } = await supabase.from('admin_messages').update({ claimed_by: null, claimed_by_name: null, claimed_at: null }).eq('id', id);
  if (error) { alert(error.message || 'Failed to unclaim.'); return; }
  const m = _messages.find(x => x.id === id);
  if (m) { m.claimed_by = null; m.claimed_by_name = null; }
  renderMessages();
};

window.sendMessageReply = async (id) => {
  const input = document.getElementById(`reply-input-${id}`);
  const fileInput = document.getElementById(`reply-file-${id}`);
  const shareNameBox = document.getElementById(`reply-share-name-${id}`);
  const reply = input?.value.trim();
  const files = fileInput?.files ? [...fileInput.files] : [];
  if (!reply && !files.length) return;
  const btn = input.parentElement.querySelector('.btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  if (totalBytes > 10 * 1024 * 1024) {
    alert('Attached photos exceed 10 MB total. Please remove some and try again.');
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    return;
  }

  let attachments = [];
  try {
    attachments = await uploadMsgAttachments(files);
  } catch (err) {
    alert('Photo upload failed: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  let senderDisplayName = null;
  if (shareNameBox?.checked) {
    const { data: profile } = await supabase.from('profiles').select('display_name,username').eq('id', user.id).single();
    senderDisplayName = profile?.display_name || profile?.username || null;
  }

  const { data: newItem, error } = await supabase.from('admin_message_items').insert({
    thread_id: id,
    sender_type: 'admin',
    sender_id: user?.id || null,
    body: reply,
    read_by_admin: true,
    read_by_user: false,
    attachments,
    sender_display_name: senderDisplayName,
  }).select().single();
  if (error) {
    alert(error.message || 'Failed to send message.');
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    return;
  }
  (_items[id] ||= []).push(newItem);
  if (input) input.value = '';
  if (btn) { btn.disabled = false; btn.textContent = 'Send'; }

  const m = _messages.find(x => x.id === id);
  if (m && !m.claimed_by) {
    const name = senderDisplayName || await getMyDisplayName();
    const { error: claimErr } = await supabase.from('admin_messages').update({ claimed_by: user.id, claimed_by_name: name, claimed_at: new Date().toISOString() }).eq('id', id);
    if (!claimErr) { m.claimed_by = user.id; m.claimed_by_name = name; }
  }

  renderMessages();
  updateUnreadBadge();
};

function updateUnreadBadge() {
  const unread = _messages.filter(m => threadUnread(m.id)).length;
  const badge = document.getElementById('messages-unread-badge');
  if (unread > 0) {
    badge.textContent = unread;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

window.toggleMessageRead = async (id, read) => {
  if (read) {
    await supabase.from('admin_message_items').update({ read_by_admin: true }).eq('thread_id', id).eq('sender_type', 'user');
    (_items[id] || []).forEach(i => { if (i.sender_type === 'user') i.read_by_admin = true; });
  } else {
    await supabase.from('admin_message_items').update({ read_by_admin: false }).eq('thread_id', id).eq('sender_type', 'user');
    (_items[id] || []).forEach(i => { if (i.sender_type === 'user') i.read_by_admin = false; });
  }
  renderMessages();
  updateUnreadBadge();
};

window.deleteMessage = async (id) => {
  if (!confirm('Delete this message?')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  await supabase.from('admin_messages').delete().eq('id', id);
  _messages = _messages.filter(x => x.id !== id);
  delete _items[id];
  renderMessages();
  updateUnreadBadge();
};

document.getElementById('btn-mark-all-read')?.addEventListener('click', async () => {
  const unreadIds = _messages.filter(m => threadUnread(m.id)).map(m => m.id);
  if (!unreadIds.length) return;
  await supabase.from('admin_message_items').update({ read_by_admin: true }).in('thread_id', unreadIds).eq('sender_type', 'user');
  unreadIds.forEach(id => (_items[id] || []).forEach(i => { if (i.sender_type === 'user') i.read_by_admin = true; }));
  renderMessages();
  updateUnreadBadge();
});

// Load unread count on page init so badge shows even before tab is clicked
async function loadUnreadCount() {
  const { count } = await supabase
    .from('admin_message_items')
    .select('id', { count: 'exact', head: true })
    .eq('sender_type', 'user')
    .eq('read_by_admin', false);
  if (count) {
    const badge = document.getElementById('messages-unread-badge');
    badge.textContent = count;
    badge.style.display = 'inline';
  }
}

// ── Audit Log ────────────────────────────────────────────────
const AUDIT_PAGE_SIZE = 40;
let _auditLog = [];
let _auditOffset = 0;
let _auditDone = false;
let _auditLoading = false;
let _auditTablesLoaded = false;
let _auditFilter = { search: '', action: '', table: '', actorType: '', actor: '', from: '', to: '' };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function auditTableLabel(t) {
  return String(t).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function populateAuditTableFilter() {
  if (_auditTablesLoaded) return;
  try {
    const { data, error } = await supabase.from('audit_log').select('table_name, actor_id, actor_name');
    if (error) throw error;
    const tables = [...new Set((data || []).map(r => r.table_name))].sort();
    const sel = document.getElementById('audit-filter-table');
    tables.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = auditTableLabel(t);
      sel.appendChild(opt);
    });

    const actorsSeen = new Map();
    (data || []).forEach(r => {
      if (r.actor_id && !actorsSeen.has(r.actor_id)) actorsSeen.set(r.actor_id, r.actor_name || 'Unknown');
    });
    const actorSel = document.getElementById('audit-filter-actor');
    [...actorsSeen.entries()].sort((a,b) => a[1].localeCompare(b[1])).forEach(([id, name]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = name;
      actorSel.appendChild(opt);
    });

    _auditTablesLoaded = true;
  } catch (e) { /* non-fatal */ }
}

async function loadAuditLog(reset = true) {
  if (_auditLoading) return;
  _auditLoading = true;
  const el = document.getElementById('audit-log-list');
  const moreBtn = document.getElementById('btn-audit-load-more');
  const endLabel = document.getElementById('audit-log-end');

  if (reset) {
    _auditLog = [];
    _auditOffset = 0;
    _auditDone = false;
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted);font-size:14px;">Loading audit log...</div>';
    populateAuditTableFilter();
  }

  try {
    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false })
      .range(_auditOffset, _auditOffset + AUDIT_PAGE_SIZE - 1);
    if (_auditFilter.action)    q = q.eq('action', _auditFilter.action);
    if (_auditFilter.table)     q = q.eq('table_name', _auditFilter.table);
    if (_auditFilter.actorType) q = q.eq('actor_type', _auditFilter.actorType);
    if (_auditFilter.actor)     q = q.eq('actor_id', _auditFilter.actor);
    if (_auditFilter.from)      q = q.gte('created_at', _auditFilter.from + 'T00:00:00');
    if (_auditFilter.to)        q = q.lte('created_at', _auditFilter.to + 'T23:59:59');
    if (_auditFilter.search) {
    // .or() takes a comma-separated filter grammar, so a search containing
    // , ( ) . or * either broke the query outright (400) or widened it.
    const term = String(_auditFilter.search).replace(/[,()*.\\]/g, ' ').trim();
    if (term) q = q.or(`summary.ilike.%${term}%,actor_name.ilike.%${term}%`);
  }

    const { data, error } = await withTimeout(q, 10000);
    if (error) throw error;

    _auditLog = _auditLog.concat(data || []);
    _auditOffset += (data || []).length;
    if (!data || data.length < AUDIT_PAGE_SIZE) _auditDone = true;

    await withTimeout(renderAuditLog(), 10000);
    moreBtn.style.display = _auditDone ? 'none' : 'inline-block';
    endLabel.style.display = (_auditDone && _auditLog.length) ? 'inline' : 'none';
  } catch (e) {
    el.innerHTML = `<div style="padding:1.5rem;color:#c0392b;font-size:13px;">Error loading audit log: ${escapeHtml(e.message)}</div>`;
  } finally {
    _auditLoading = false;
  }
}

// Fields whose value is a uuid pointing at a user — resolved to the
// person's actual name before being shown in the expanded details.
const AUDIT_REF_FIELDS = {
  user_id: 'profiles', author_id: 'profiles', created_by: 'profiles',
  checked_off_by: 'profiles', claimed_by: 'profiles', sender_id: 'profiles',
  granted_by: 'profiles', actor_id: 'profiles', assignee_id: 'profiles',
  approved_by: 'profiles', updated_by: 'profiles', deleted_by: 'profiles',
};
const AUDIT_REF_TABLE_CONFIG = {
  profiles: { label: c => c.display_name || c.username || c.email || 'Unknown user' },
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let _auditRefCache = { profiles: {} };

function withTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ]);
}

const AUDIT_LABEL_OVERRIDES = { id: 'ID', uuid: 'UUID' };
function humanizeFieldName(k) {
  if (AUDIT_LABEL_OVERRIDES[k]) return AUDIT_LABEL_OVERRIDES[k];
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

async function resolveAuditRefs(rows) {
  const needed = { profiles: new Set() };
  rows.forEach(r => {
    [r.old_data, r.new_data].forEach(blob => {
      if (!blob) return;
      Object.entries(blob).forEach(([k, v]) => {
        const table = AUDIT_REF_FIELDS[k];
        if (table && typeof v === 'string' && UUID_RE.test(v) && !_auditRefCache[table][v]) {
          needed[table].add(v);
        }
      });
    });
  });

  for (const table of Object.keys(needed)) {
    const ids = [...needed[table]];
    if (!ids.length) continue;
    try {
      const { data, error } = await withTimeout(
        supabase.from(table).select('id, display_name, username, email').in('id', ids)
      );
      if (error) throw error;
      (data || []).forEach(row => {
        _auditRefCache[table][row.id] = AUDIT_REF_TABLE_CONFIG[table].label(row);
      });
    } catch (e) { /* non-fatal — falls back to raw id */ }
  }
}

function resolveAuditValue(key, value) {
  const table = AUDIT_REF_FIELDS[key];
  if (table && typeof value === 'string' && UUID_RE.test(value)) {
    const name = _auditRefCache[table][value];
    return name ? `${escapeHtml(name)} (${value.slice(0, 8)}…)` : value;
  }
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d)) return d.toLocaleString();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatAuditBlob(blob) {
  return Object.entries(blob).map(([k, v]) => {
    return `<div class="audit-field-row"><span class="audit-field-key">${escapeHtml(humanizeFieldName(k))}</span><span class="audit-field-val">${escapeHtml(resolveAuditValue(k, v))}</span></div>`;
  }).join('');
}

async function renderAuditLog() {
  const el = document.getElementById('audit-log-list');
  if (!_auditLog.length) {
    el.innerHTML = '<div style="text-align:center;padding:2.5rem;color:var(--muted);font-size:14px;">No audit log entries match your filters.</div>';
    return;
  }

  await resolveAuditRefs(_auditLog);

  el.innerHTML = _auditLog.map((r, idx) => {
    const when = new Date(r.created_at).toLocaleString();
    const actor = r.actor_name || 'Unknown';
    const actorType = r.actor_type || 'system';
    const hasDetail = r.old_data || r.new_data;
    return `<div class="audit-row">
      <div class="audit-row-top" ${hasDetail ? `data-action="toggle-audit-detail" data-index="${idx}" role="button" tabindex="0" aria-expanded="false" aria-controls="audit-detail-${idx}"` : ''}>
        <div class="audit-row-main">
          <div class="audit-summary">
            <span class="audit-actor-badge audit-actor-${escapeHtml(actorType)}">${escapeHtml(actorType)}</span><span class="audit-action-badge audit-action-${escapeHtml(r.action)}">${escapeHtml(r.action)}</span>${escapeHtml(r.summary || auditTableLabel(r.table_name))}
          </div>
          <div class="audit-meta">${escapeHtml(when)} · ${escapeHtml(actor)}${r.actor_role ? ' (' + escapeHtml(r.actor_role) + ')' : ''} · ${auditTableLabel(r.table_name)}${r.table_name === 'tasks' && r.record_id ? ` · Task ID: <span title="${escapeHtml(r.record_id)}">${escapeHtml(r.record_id.slice(0, 8))}…</span>` : ''}</div>
        </div>
        ${hasDetail ? `<span class="audit-row-toggle" id="audit-toggle-${idx}">Details ▾</span>` : ''}
      </div>
      ${hasDetail ? `<div class="audit-row-detail" id="audit-detail-${idx}">
        ${r.old_data ? `<div class="audit-row-detail-label">Before</div>${formatAuditBlob(r.old_data)}` : ''}
        ${r.new_data ? `<div class="audit-row-detail-label" style="margin-top:8px;">After</div>${formatAuditBlob(r.new_data)}` : ''}
      </div>` : ''}
    </div>`;
  }).join('');
}

function toggleAuditDetail(idx) {
  const detail = document.getElementById('audit-detail-' + idx);
  const toggle = document.getElementById('audit-toggle-' + idx);
  if (!detail) return;
  const open = detail.classList.toggle('open');
  if (toggle) toggle.textContent = open ? 'Details ▴' : 'Details ▾';
  const row = detail.previousElementSibling;
  if (row && row.hasAttribute('aria-expanded')) row.setAttribute('aria-expanded', String(open));
}
window.toggleAuditDetail = toggleAuditDetail;

let _auditSearchDebounce;
document.getElementById('audit-search').addEventListener('input', function() {
  clearTimeout(_auditSearchDebounce);
  const val = this.value;
  _auditSearchDebounce = setTimeout(() => {
    _auditFilter.search = val;
    loadAuditLog(true);
  }, 300);
});
document.getElementById('audit-filter-action').addEventListener('change', function() {
  _auditFilter.action = this.value;
  loadAuditLog(true);
});
document.getElementById('audit-filter-table').addEventListener('change', function() {
  _auditFilter.table = this.value;
  loadAuditLog(true);
});
document.getElementById('audit-filter-actor-type').addEventListener('change', function() {
  _auditFilter.actorType = this.value;
  loadAuditLog(true);
});
document.getElementById('audit-filter-actor').addEventListener('change', function() {
  _auditFilter.actor = this.value;
  loadAuditLog(true);
});
document.getElementById('audit-filter-from').addEventListener('change', function() {
  _auditFilter.from = this.value;
  loadAuditLog(true);
});
document.getElementById('audit-filter-to').addEventListener('change', function() {
  _auditFilter.to = this.value;
  loadAuditLog(true);
});
document.getElementById('btn-audit-clear-filters').addEventListener('click', () => {
  _auditFilter = { search: '', action: '', table: '', actorType: '', actor: '', from: '', to: '' };
  document.getElementById('audit-search').value = '';
  document.getElementById('audit-filter-action').value = '';
  document.getElementById('audit-filter-table').value = '';
  document.getElementById('audit-filter-actor-type').value = '';
  document.getElementById('audit-filter-actor').value = '';
  document.getElementById('audit-filter-from').value = '';
  document.getElementById('audit-filter-to').value = '';
  loadAuditLog(true);
});
document.getElementById('btn-audit-load-more').addEventListener('click', () => loadAuditLog(false));

init();
loadUnreadCount();
