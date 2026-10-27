import { supabase, getMyRolePreview, requireAal2 } from './supabase.js';

// ── Delegated actions (strict CSP) ────────────────────────────────
// Inline handler attributes are blocked by the strict script-src policy,
// so every button/row above is wired through these listeners instead.
// data-action names the action; data-id / data-index / data-label carry
// the values the old inline handler used to inline. Handlers run at click
// time, after this module has fully evaluated, so window-assigned page
// functions are available here exactly as they were to inline handlers.

const _ACTION_HANDLERS = {
  'load-into-editor': (el, e) => window.loadIntoEditor(el.dataset.id),
  'approve-article': (el, e) => window.approveArticle(el.dataset.id),
  'reject-article': (el, e) => window.rejectArticle(el.dataset.id),
  'quick-unpublish': (el, e) => window.quickUnpublish(el.dataset.id),
  'quick-publish': (el, e) => window.quickPublish(el.dataset.id),
  'delete-article': (el, e) => window.deleteArticle(el.dataset.id),
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


// Article metadata is author-supplied and rendered through innerHTML below.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Keep javascript:/data: URLs out of markdown links and images.
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

// ── Markdown renderer (mirrors news.js) ──────────────────────
function renderMarkdown(md) {
  if (!md) return '<em style="color:var(--muted);">Nothing to preview yet.</em>';
  let html = md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/^#### (.+)$/gm,'<h4>$1</h4>').replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/^---+$/gm,'<hr>')
    .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g,'$1<em>$2</em>').replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
      const u = safeUrl(url);
      return u ? `<img src="${u}" alt="${alt}">` : '';
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      const u = safeUrl(url);
      return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    })
    .replace(/^&gt; (.+)$/gm,'<blockquote>$1</blockquote>');
  html = html.replace(/(^[-*] .+\n?)+/gm, m => {
    const items = m.trim().split('\n').map(l=>`<li>${l.replace(/^[-*] /,'')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  html = html.replace(/(^\d+\. .+\n?)+/gm, m => {
    const items = m.trim().split('\n').map(l=>`<li>${l.replace(/^\d+\. /,'')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  html = html.split(/\n{2,}/).map(block => {
    block = block.trim(); if (!block) return '';
    if (/^<(h[1-6]|ul|ol|blockquote|hr|img)/.test(block)) return block;
    return `<p>${block.replace(/\n/g,'<br>')}</p>`;
  }).join('\n');
  return html;
}

// ── State ────────────────────────────────────────────────────
let _user      = null;
let _profile   = null;
let _myArticles  = [];
let _allArticles = [];
let _pendingArticles = [];
let _editingId   = null;
let _canApprove  = false;
let _coauthors   = []; // [{id, name}] for the article in the editor
let _coauthorsSupported = true; // false until the coauthoring migration is applied

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, isError = false) {
  const el = document.getElementById('np-toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) { showState('denied'); return; }
  if (!(await requireAal2('news-publish.html'))) return;
  _user = session.user;

  // Check access via the server-side permission RPC only. A failed or
  // errored check denies access — it must never fall back to profiles.role.
  let hasAccess = false;
  try {
    const { data, error } = await supabase.rpc('user_has_permission', { perm: 'can_manage_news' });
    hasAccess = !error && data === true;
  } catch(e) {
    hasAccess = false;
  }

  if (!hasAccess) { showState('denied'); return; }

  // Check auto-publish / approval rights — admins & owners skip review, everyone else needs sign-off.
  // A failed check means no auto-publish (safer default: send for review).
  try {
    const { data, error } = await supabase.rpc('user_has_permission', { perm: 'can_approve_news' });
    _canApprove = !error && data === true;
  } catch { _canApprove = false; }
  document.getElementById('pending-review-panel').style.display = _canApprove ? '' : 'none';

  // Get profile for display name
  const { data: profile } = await supabase.from('profiles').select('display_name,username').eq('id', _user.id).single();
  _profile = profile;
  const name = profile?.display_name || profile?.username || _user.email;
  document.getElementById('np-author-meta').textContent = `Publishing as ${name}`;

  // Coauthoring needs the migration applied — hide the picker until then.
  try {
    const { error } = await supabase.from('news_articles').select('coauthor_ids').limit(1);
    _coauthorsSupported = !error;
  } catch { _coauthorsSupported = false; }
  if (!_coauthorsSupported) {
    document.getElementById('np-coauthor-search').closest('.form-group').style.display = 'none';
  }

  showState('main');
  await loadArticles();
}

function showState(which) {
  document.getElementById('np-loading').style.display = which === 'loading' ? '' : 'none';
  document.getElementById('np-denied').style.display  = which === 'denied'  ? '' : 'none';
  document.getElementById('np-main').style.display    = which === 'main'    ? '' : 'none';
}

// ── Load articles ─────────────────────────────────────────────
async function loadArticles() {
  // My articles (all statuses) — authored by me OR coauthored by me
  // (coauthor lookup only once the migration exists)
  let mine = null;
  if (_coauthorsSupported) {
    const res = await supabase
      .from('news_articles').select('*')
      .or(`author_id.eq.${_user.id},coauthor_ids.cs.{${_user.id}}`)
      .order('created_at', { ascending: false });
    mine = res.data;
  } else {
    const res = await supabase
      .from('news_articles').select('*')
      .eq('author_id', _user.id)
      .order('created_at', { ascending: false });
    mine = res.data;
  }
  _myArticles = mine || [];

  // All published (any author)
  const { data: all } = await supabase
    .from('news_articles').select('id,title,category,author_name,published_at,status')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(20);
  _allArticles = all || [];

  // Pending review (any author) — only approvers see/need this
  if (_canApprove) {
    const { data: pending } = await supabase
      .from('news_articles').select('id,title,summary,category,author_name,created_at,status')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: true });
    _pendingArticles = pending || [];
  }

  renderMyArticles();
  renderAllArticles();
  if (_canApprove) renderPendingReview();
}

// ── Render pending review (approvers) ───────────────────────────
function renderPendingReview() {
  const el = document.getElementById('pending-review-list');
  document.getElementById('pending-count').textContent =
    `${_pendingArticles.length} awaiting review`;
  if (!_pendingArticles.length) {
    el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:13px;">Nothing waiting on you right now.</div>`;
    return;
  }
  el.innerHTML = _pendingArticles.map(a => {
    const date = new Date(a.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    return `<div class="article-row">
      <span class="status-pip pending_review"></span>
      <div class="article-row-info">
        <div class="article-row-title">${esc(a.title)}</div>
        <div class="article-row-meta">${esc(a.category||'General')} · By ${esc(a.author_name||'Unknown')} · Submitted ${esc(date)}</div>
      </div>
      <div class="btn-row" style="flex-shrink:0;">
        <button class="btn btn-outline btn-sm" data-action="load-into-editor" data-id="${a.id}">Preview</button>
        <button class="btn btn-success btn-sm" data-action="approve-article" data-id="${a.id}">Approve &amp; Publish</button>
        <button class="btn btn-danger btn-sm" data-action="reject-article" data-id="${a.id}">Reject</button>
      </div>
    </div>`;
  }).join('');
}

window.approveArticle = async (id) => {
  const { error } = await supabase.from('news_articles')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      reviewed_by: _user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) { toast('Error: ' + error.message, true); return; }
  toast('✓ Approved and published!');
  if (_editingId === id) clearEditor();
  await loadArticles();
  await notifySubscribers(id);
};

window.rejectArticle = async (id) => {
  const reason = prompt('Optional note for the author on why this was sent back (leave blank to skip):') || null;
  const { error } = await supabase.from('news_articles')
    .update({
      status: 'draft',
      reviewed_by: _user.id,
      reviewed_at: new Date().toISOString(),
      rejection_note: reason,
    })
    .eq('id', id);
  if (error) { toast('Error: ' + error.message, true); return; }
  toast('Sent back to draft');
  if (_editingId === id) clearEditor();
  await loadArticles();
};

// ── Render my articles ────────────────────────────────────────
function renderMyArticles() {
  const el = document.getElementById('my-articles-list');
  document.getElementById('my-count').textContent = `${_myArticles.length} article${_myArticles.length !== 1 ? 's' : ''}`;
  if (!_myArticles.length) {
    el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:13px;">No articles yet. Write your first one above!</div>`;
    return;
  }
  el.innerHTML = _myArticles.map(a => {
    const date = a.published_at
      ? new Date(a.published_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
      : new Date(a.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    const statusLabel = a.status === 'pending_review' ? 'Pending Review' : capitalise(a.status);
    const noteHtml = (a.status === 'draft' && a.rejection_note)
      ? `<div class="article-row-meta" style="color:#c0392b;margin-top:2px;">Sent back: ${esc(a.rejection_note)}</div>` : '';
    const coauthoredBadge = (a.author_id !== _user?.id)
      ? `<span style="font-size:10px;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:1px 8px;margin-left:6px;">Coauthored</span>` : '';
    let actionBtn;
    if (a.status === 'published') {
      actionBtn = `<button class="btn btn-ghost btn-sm" data-action="quick-unpublish" data-id="${a.id}">Unpublish</button>`;
    } else if (a.status === 'pending_review') {
      actionBtn = _canApprove
        ? `<button class="btn btn-success btn-sm" data-action="approve-article" data-id="${a.id}">Approve</button>`
        : `<span style="font-size:11px;color:var(--muted);padding:0 4px;">Awaiting approval</span>`;
    } else {
      actionBtn = `<button class="btn btn-success btn-sm" data-action="quick-publish" data-id="${a.id}">${_canApprove ? 'Publish' : 'Submit for Review'}</button>`;
    }
    return `<div class="article-row">
      <span class="status-pip ${esc(a.status)}"></span>
      <div class="article-row-info">
        <div class="article-row-title">${esc(a.title)}${coauthoredBadge}</div>
        <div class="article-row-meta">${esc(a.category||'General')} · ${esc(statusLabel)} · ${esc(date)}</div>
        ${noteHtml}
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" data-action="load-into-editor" data-id="${a.id}">Edit</button>
        ${actionBtn}
        <button class="btn btn-danger btn-sm" data-action="delete-article" data-id="${a.id}">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderAllArticles() {
  const el = document.getElementById('all-articles-list');
  document.getElementById('all-count').textContent = `${_allArticles.length} published`;
  if (!_allArticles.length) {
    el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:13px;">No published articles yet.</div>`;
    return;
  }
  el.innerHTML = _allArticles.map(a => {
    const date = a.published_at
      ? new Date(a.published_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
      : '';
    const isMine = a.author_id === _user?.id;
    return `<div class="article-row">
      <span class="status-pip published"></span>
      <div class="article-row-info">
        <div class="article-row-title">${esc(a.title)}</div>
        <div class="article-row-meta">${esc(a.category||'General')} · ${esc(a.author_name||'Unknown')} · ${esc(date)}</div>
      </div>
    </div>`;
  }).join('');
}

function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Coauthors ─────────────────────────────────────────────────
function coauthorDisplayName(p) { return p.display_name || p.username || 'Unknown'; }

function renderCoauthorChips() {
  const el = document.getElementById('np-coauthor-chips');
  el.innerHTML = _coauthors.map((c, i) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:4px 6px 4px 12px;font-size:12px;">${esc(c.name)}<button type="button" data-coauthor-remove="${i}" style="border:none;background:none;cursor:pointer;font-size:14px;line-height:1;color:var(--muted);" aria-label="Remove coauthor">×</button></span>`
  ).join('');
  el.querySelectorAll('[data-coauthor-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      _coauthors.splice(parseInt(btn.dataset.coauthorRemove, 10), 1);
      renderCoauthorChips();
    });
  });
}

function setCoauthors(list) {
  // The picker UI already excludes the signed-in user from search results,
  // so the author can't add themselves. Never strip ids here: when a
  // coauthor edits, their own id must survive the round-trip or the
  // UPDATE's RLS check (auth.uid() = ANY (coauthor_ids)) will reject it.
  _coauthors = (list || []).filter(c => c && c.id);
  renderCoauthorChips();
}

let _coauthorSearchTimer = null;
async function searchCoauthors(raw) {
  const box = document.getElementById('np-coauthor-results');
  const q = raw.trim().replace(/[,()%"]/g, '');
  if (q.length < 2) { box.style.display = 'none'; return; }
  const { data } = await supabase.from('public_profiles')
    .select('id,username,display_name')
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(8);
  const picked = new Set(_coauthors.map(c => c.id));
  const rows = (data || []).filter(p => p.id !== _user.id && !picked.has(p.id));
  if (!rows.length) {
    box.innerHTML = `<div style="padding:.6rem .8rem;font-size:12px;color:var(--muted);">No members found.</div>`;
  } else {
    box.innerHTML = rows.map(p => {
      const name = coauthorDisplayName(p);
      const handle = (p.username && p.username !== name)
        ? ` <span style="color:var(--muted);font-size:11px;">@${esc(p.username)}</span>` : '';
      return `<div data-coauthor-pick="${p.id}" data-coauthor-name="${esc(name)}" style="padding:.6rem .8rem;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border);">${esc(name)}${handle}</div>`;
    }).join('');
    box.querySelectorAll('[data-coauthor-pick]').forEach(row => {
      row.addEventListener('click', () => {
        _coauthors.push({ id: row.dataset.coauthorPick, name: row.dataset.coauthorName });
        renderCoauthorChips();
        document.getElementById('np-coauthor-search').value = '';
        box.style.display = 'none';
      });
    });
  }
  box.style.display = '';
}

async function resolveCoauthorNames(ids) {
  const need = (ids || []).filter(id => id);
  if (!need.length) return [];
  const { data } = await supabase.from('public_profiles')
    .select('id,username,display_name').in('id', need);
  const byId = Object.fromEntries((data || []).map(p => [p.id, coauthorDisplayName(p)]));
  return need.map(id => ({ id, name: byId[id] || 'Unknown' }));
}

const npCoauthorSearch = document.getElementById('np-coauthor-search');
npCoauthorSearch.addEventListener('input', () => {
  clearTimeout(_coauthorSearchTimer);
  _coauthorSearchTimer = setTimeout(() => searchCoauthors(npCoauthorSearch.value), 250);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#np-coauthor-search') && !e.target.closest('#np-coauthor-results')) {
    document.getElementById('np-coauthor-results').style.display = 'none';
  }
});

// ── Editor ────────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,80);
}

function clearEditor() {
  document.getElementById('np-editing-id').value = '';
  document.getElementById('np-title').value      = '';
  document.getElementById('np-category').value   = '';
  setHeroImage('');
  document.getElementById('np-summary').value    = '';
  document.getElementById('np-body').value       = '';
  document.getElementById('np-author-name').value    = '';
  document.getElementById('np-published-at').value   = '';
  setCoauthors([]);
  document.getElementById('editor-heading').textContent = 'New Article';
  document.getElementById('np-summary-count').textContent = '0 / 280';
  document.getElementById('np-body-count').textContent = '0 chars';
  updatePreview();
  _editingId = null;
}

window.loadIntoEditor = async (id) => {
  const a = _myArticles.find(x => x.id === id);
  if (!a) return;
  _editingId = id;
  document.getElementById('np-editing-id').value = id;
  document.getElementById('np-title').value      = a.title   || '';
  document.getElementById('np-category').value   = a.category || '';
  setHeroImage(a.image_url || '');
  document.getElementById('np-summary').value    = a.summary  || '';
  document.getElementById('np-body').value       = a.body     || '';
  document.getElementById('np-author-name').value = a.author_name || '';
  setCoauthors(_coauthorsSupported ? await resolveCoauthorNames(a.coauthor_ids) : []);
  if (a.published_at) {
    const d = new Date(a.published_at);
    document.getElementById('np-published-at').value = d.toISOString().slice(0, 16);
  } else {
    document.getElementById('np-published-at').value = '';
  }
  document.getElementById('editor-heading').textContent = 'Editing: ' + a.title;
  updateCharCounts();
  updatePreview();
  // Scroll to editor
  document.getElementById('editor-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Switch to Write tab
  setEditorMode('write');
  toast('Article loaded into editor');
};

// ── Photo uploads (hero image + inline body images) ────────────
// Shares the same public news-images bucket for both. Files are grouped
// under the article's id once it has one, or a per-session draft folder
// before the first save.
let _uploadFolder = `draft-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
function uploadFolder() { return _editingId || _uploadFolder; }

async function uploadNewsImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${uploadFolder()}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { error } = await supabase.storage.from('news-images').upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from('news-images').getPublicUrl(path);
  return data.publicUrl;
}

function setHeroImage(url) {
  document.getElementById('np-image').value = url || '';
  document.getElementById('np-image-preview').src = url || '';
  document.getElementById('np-image-preview-wrap').style.display = url ? '' : 'none';
  document.getElementById('np-image-dropzone-label').textContent = url ? 'Click to replace' : 'Drag & drop a photo here, or click to browse';
}

async function handleHeroFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const errEl = document.getElementById('np-image-error');
  const uploadingEl = document.getElementById('np-image-uploading');
  errEl.style.display = 'none';
  uploadingEl.style.display = '';
  try {
    const url = await uploadNewsImage(file);
    setHeroImage(url);
  } catch (err) {
    errEl.textContent = 'Upload failed: ' + err.message;
    errEl.style.display = 'block';
  } finally {
    uploadingEl.style.display = 'none';
  }
}

const npImageDropzone = document.getElementById('np-image-dropzone');
const npImageFile     = document.getElementById('np-image-file');
npImageDropzone.addEventListener('click', () => npImageFile.click());
npImageFile.addEventListener('change', e => { handleHeroFile(e.target.files[0]); npImageFile.value = ''; });
['dragover','dragenter'].forEach(evt => npImageDropzone.addEventListener(evt, e => {
  e.preventDefault(); npImageDropzone.style.borderColor = 'var(--blue)'; npImageDropzone.style.background = 'var(--bg)';
}));
['dragleave','dragend'].forEach(evt => npImageDropzone.addEventListener(evt, () => {
  npImageDropzone.style.borderColor = 'var(--border)'; npImageDropzone.style.background = 'transparent';
}));
npImageDropzone.addEventListener('drop', e => {
  e.preventDefault();
  npImageDropzone.style.borderColor = 'var(--border)'; npImageDropzone.style.background = 'transparent';
  handleHeroFile(e.dataTransfer.files[0]);
});

// Manual URL fallback, tucked behind a toggle link so uploading stays the default path.
const npImageUrlToggle = document.getElementById('np-image-url-toggle');
const npImageUrlInput  = document.getElementById('np-image-url-input');
npImageUrlToggle.addEventListener('click', e => {
  e.preventDefault();
  const showing = npImageUrlInput.style.display !== 'none';
  npImageUrlInput.style.display = showing ? 'none' : '';
  if (!showing) { npImageUrlInput.value = document.getElementById('np-image').value; npImageUrlInput.focus(); }
});
npImageUrlInput.addEventListener('input', () => setHeroImage(npImageUrlInput.value.trim()));

// Inline "insert photo" toolbar button — uploads and drops markdown at the cursor.
const npInlineImageFile = document.getElementById('np-inline-image-file');
document.getElementById('tb-insert-image').addEventListener('click', () => npInlineImageFile.click());
npInlineImageFile.addEventListener('change', async e => {
  const file = e.target.files[0];
  npInlineImageFile.value = '';
  if (!file || !file.type.startsWith('image/')) return;
  const textarea = document.getElementById('np-body');
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const placeholder = '![Uploading photo…]()';
  textarea.setRangeText(placeholder, start, end, 'end');
  updatePreview(); updateCharCounts();
  try {
    const url = await uploadNewsImage(file);
    const alt = file.name.replace(/\.[^.]+$/, '');
    textarea.value = textarea.value.replace(placeholder, `![${alt}](${url})`);
  } catch (err) {
    textarea.value = textarea.value.replace(placeholder, '');
    toast('Photo upload failed: ' + err.message, true);
  }
  updatePreview(); updateCharCounts();
});

// ── Email subscribers when an article goes live ────────────────
async function notifySubscribers(articleId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1/notify-news-subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ articleId }),
    });
    const result = await res.json();
    if (!res.ok || result.error) {
      toast('Published, but notification emails failed: ' + (result.error || 'unknown error'), true);
    } else if (result.sent > 0) {
      toast(`✓ Notified ${result.sent} subscriber${result.sent === 1 ? '' : 's'} by email`);
    }
  } catch (e) {
    toast('Published, but notification emails failed: ' + e.message, true);
  }
}

async function saveArticle(forcedStatus) {
  const id      = document.getElementById('np-editing-id').value;
  const title   = document.getElementById('np-title').value.trim();
  const body    = document.getElementById('np-body').value.trim();
  if (!title) { toast('Please enter a headline.', true); return; }

  // Non-approvers (News Team) can't self-publish — their "Publish" goes to review instead
  let status = forcedStatus || 'draft';
  if (status === 'published' && !_canApprove) status = 'pending_review';
  const defaultAuthorName = _profile?.display_name || _profile?.username || _user.email;
  const overrideAuthor = document.getElementById('np-author-name').value.trim();
  const authorName = overrideAuthor || defaultAuthorName;

  const publishedAtInput = document.getElementById('np-published-at').value;
  const publishedAt = publishedAtInput
    ? new Date(publishedAtInput).toISOString()
    : (status === 'published' ? new Date().toISOString() : undefined);

  const payload = {
    title,
    body,
    category:    document.getElementById('np-category').value.trim() || 'General',
    image_url:   document.getElementById('np-image').value.trim() || null,
    summary:     document.getElementById('np-summary').value.trim() || null,
    status,
    author_name: authorName,
    published_at: publishedAt,
  };
  if (_coauthorsSupported) payload.coauthor_ids = _coauthors.map(c => c.id);
  if (status === 'pending_review') payload.rejection_note = null; // clear old feedback on resubmission

  let error;
  let newlyPublishedId = null;
  if (id) {
    // Update — don't overwrite author, but keep slug text in sync with the title
    const existing = _myArticles.find(x => x.id === id);
    const wasPublished = existing?.status === 'published';
    const oldSlug  = existing?.slug || '';
    const suffix   = oldSlug.includes('-') ? oldSlug.slice(oldSlug.lastIndexOf('-') + 1) : Date.now().toString(36);
    const slug     = slugify(title) + '-' + suffix;
    ({ error } = await supabase.from('news_articles').update({ ...payload, slug }).eq('id', id));
    if (!error && status === 'published' && !wasPublished) newlyPublishedId = id;
  } else {
    // Insert — set author
    const slug = slugify(title) + '-' + Date.now().toString(36);
    const { data: inserted, error: insertErr } = await supabase.from('news_articles').insert({
      ...payload, slug, author_id: _user.id, author_name: authorName
    }).select('id').single();
    error = insertErr;
    if (!error && status === 'published' && inserted) newlyPublishedId = inserted.id;
  }

  if (error) {
    toast('Error: ' + error.message, true);
    return;
  }

  if (status === 'published') toast('✓ Article published!');
  else if (status === 'pending_review') toast('Submitted for admin approval');
  else toast('✓ Draft saved');
  clearEditor();
  await loadArticles();
  if (newlyPublishedId) await notifySubscribers(newlyPublishedId);
}

window.quickPublish = async (id) => {
  const status = _canApprove ? 'published' : 'pending_review';
  const payload = { status };
  if (status === 'published') payload.published_at = new Date().toISOString();
  else payload.rejection_note = null;
  const { error } = await supabase.from('news_articles').update(payload).eq('id', id);
  if (error) { toast('Error: '+error.message, true); return; }
  toast(status === 'published' ? '✓ Published!' : 'Submitted for admin approval');
  await loadArticles();
  if (status === 'published') await notifySubscribers(id);
};
window.quickUnpublish = async (id) => {
  const { error } = await supabase.from('news_articles').update({ status: 'draft' }).eq('id', id);
  if (error) { toast('Error: '+error.message, true); return; }
  toast('Moved back to drafts');
  await loadArticles();
};
window.deleteArticle = async (id) => {
  if (!confirm('Delete this article? This cannot be undone.')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  const { error } = await supabase.from('news_articles').delete().eq('id', id);
  if (error) { toast('Error: '+error.message, true); return; }
  if (_editingId === id) clearEditor();
  toast('Article deleted');
  await loadArticles();
};

// ── Toolbar ───────────────────────────────────────────────────
document.querySelectorAll('#np-toolbar .tb-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const textarea = document.getElementById('np-body');
    const start = textarea.selectionStart;
    const end   = textarea.selectionEnd;
    const sel   = textarea.value.slice(start, end);

    if (btn.dataset.wrap !== undefined) {
      const wrap = btn.dataset.wrap;
      const replacement = wrap + (sel || 'text') + wrap;
      textarea.setRangeText(replacement, start, end, 'select');
    } else if (btn.dataset.prefix !== undefined) {
      const prefix = btn.dataset.prefix;
      textarea.setRangeText(prefix + (sel || ''), start, end, 'end');
    } else if (btn.hasAttribute('data-link')) {
      const url   = prompt('URL:', 'https://');
      if (!url) return;
      const text  = sel || prompt('Link text:', 'link text') || 'link';
      textarea.setRangeText(`[${text}](${url})`, start, end, 'end');
    }
    textarea.focus();
    updatePreview();
    updateCharCounts();
  });
});

// ── Write / Preview tabs ──────────────────────────────────────
function setEditorMode(mode) {
  document.getElementById('tab-write').classList.toggle('active',   mode === 'write');
  document.getElementById('tab-preview').classList.toggle('active', mode === 'preview');
  document.getElementById('np-write-area').style.display   = mode === 'write'   ? '' : 'none';
  document.getElementById('np-preview-area').style.display = mode === 'preview' ? '' : 'none';
  document.getElementById('np-toolbar').style.display      = mode === 'write'   ? '' : 'none';
  if (mode === 'preview') updatePreview();
}

document.getElementById('tab-write').addEventListener('click',   () => setEditorMode('write'));
document.getElementById('tab-preview').addEventListener('click', () => setEditorMode('preview'));

function updatePreview() {
  const body = document.getElementById('np-body').value;
  document.getElementById('np-preview').innerHTML = renderMarkdown(body);
}

// ── Character counters ────────────────────────────────────────
function updateCharCounts() {
  const summaryLen = document.getElementById('np-summary').value.length;
  document.getElementById('np-summary-count').textContent = `${summaryLen} / 280`;
  const bodyLen = document.getElementById('np-body').value.length;
  document.getElementById('np-body-count').textContent = `${bodyLen} char${bodyLen !== 1 ? 's' : ''}`;
}

document.getElementById('np-summary').addEventListener('input', updateCharCounts);
document.getElementById('np-body').addEventListener('input', () => { updatePreview(); updateCharCounts(); });

// ── Button wiring ─────────────────────────────────────────────
document.getElementById('btn-clear-editor').addEventListener('click', () => {
  if (document.getElementById('np-title').value && !confirm('Clear the editor? Unsaved changes will be lost.')) return;
  clearEditor();
});
document.getElementById('btn-save-draft').addEventListener('click', () => saveArticle('draft'));
document.getElementById('btn-publish').addEventListener('click', () => {
  if (!confirm('Publish this article? It will be visible to everyone on the website.')) return;
  saveArticle('published');
});

init();
