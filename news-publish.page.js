import { supabase, getMyRolePreview, requireAal2, optimizeImageFile, signedUrlForPublished, resolvePrivateBucketImagesInMarkdown, withTimeout, withRetry, uploadFileResilient, cleanupUploadedPaths } from './supabase.js';

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
  'retry-load-articles': (el, e) => loadArticles(),
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
    // blob: is allowed too: pending photos (not uploaded yet) preview
    // through object URLs this page created with URL.createObjectURL.
    // A blob URL can only point at a blob this page made, so it can't
    // smuggle in an outside resource the way data: or javascript: could.
    return (p.protocol === 'https:' || p.protocol === 'http:' || p.protocol === 'blob:') ? p.href : '';
  } catch { return ''; }
}

// ── Markdown renderer (mirrors news.js) ──────────────────────
function renderMarkdown(md) {
  if (!md) return '<em style="color:var(--muted);">Nothing to preview yet.</em>';
  // Reference-style images/links: `[photo-1]: <url>` definitions are
  // collected and stripped; `![alt][photo-1]` / `[text][photo-1]` resolve
  // against them. Body photos are inserted this way so the typing box
  // shows a short readable line instead of a long storage path.
  const refDefs = {};
  md = md.replace(/^\[([^\]]+)\]:[ \t]*(\S+)[ \t]*$/gm, (m, ref, url) => { refDefs[ref.trim().toLowerCase()] = url; return ''; });
  let html = md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/^#### (.+)$/gm,'<h4>$1</h4>').replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/^---+$/gm,'<hr>')
    .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g,'$1<em>$2</em>').replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/!\[([^\]]*)\]\[([^\]]+)\]/g, (m, alt, ref) => {
      const u = safeUrl(refDefs[ref.trim().toLowerCase()] || '');
      return u ? `<img src="${u}" alt="${alt}">` : alt;
    })
    .replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (m, text, ref) => {
      const u = safeUrl(refDefs[ref.trim().toLowerCase()] || '');
      return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    })
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
// Stress-test 17: all three list queries are idempotent reads, so they get
// withTimeout(8s) + one retry via withRetry. A failed load is recorded
// in _articlesLoadError and rendered as an error + retry button — never as
// the false-empty "No articles yet" the old code showed on any network
// failure (the queries used to ignore `error` entirely and coerce null
// to []). A fresh query builder is built inside each retry attempt:
// re-awaiting the same builder would not reliably re-issue the request.
let _articlesLoadError = null;

async function loadArticles() {
  _articlesLoadError = null;
  try {
    // My articles (all statuses) — authored by me OR coauthored by me
    // (coauthor lookup only once the migration exists)
    const loadMine = () => _coauthorsSupported
      ? supabase
        .from('news_articles').select('*')
        .or(`author_id.eq.${_user.id},coauthor_ids.cs.{${_user.id}}`)
        .order('created_at', { ascending: false })
      : supabase
        .from('news_articles').select('*')
        .eq('author_id', _user.id)
        .order('created_at', { ascending: false });
    // All published (any author)
    const loadAll = () => supabase
      .from('news_articles').select('id,title,category,author_name,published_at,status')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(20);
    // Pending review (any author) — only approvers see/need this
    const loadPending = () => supabase
      .from('news_articles').select('id,title,summary,category,author_name,created_at,status')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: true });
    const [mineRes, allRes, pendingRes] = await Promise.all([
      withRetry(() => withTimeout(loadMine(), 8000), 2),
      withRetry(() => withTimeout(loadAll(), 8000), 2),
      _canApprove ? withRetry(() => withTimeout(loadPending(), 8000), 2) : Promise.resolve(null),
    ]);
    if (mineRes.error) throw mineRes.error;
    if (allRes.error) throw allRes.error;
    if (pendingRes && pendingRes.error) throw pendingRes.error;
    _myArticles = mineRes.data || [];
    _allArticles = allRes.data || [];
    if (_canApprove) _pendingArticles = pendingRes.data || [];
  } catch (err) {
    _articlesLoadError = err;
  }

  renderMyArticles();
  renderAllArticles();
  if (_canApprove) renderPendingReview();
}

function loadErrorHtml() {
  return `<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:13px;">Couldn’t load articles — the connection may be down.<br><button class="btn btn-outline btn-sm" data-action="retry-load-articles" style="margin-top:10px;">Try again</button></div>`;
}

// ── Render pending review (approvers) ───────────────────────────
function renderPendingReview() {
  const el = document.getElementById('pending-review-list');
  document.getElementById('pending-count').textContent =
    `${_pendingArticles.length} awaiting review`;
  if (_articlesLoadError) { el.innerHTML = loadErrorHtml(); return; }
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
  if (_articlesLoadError) { el.innerHTML = loadErrorHtml(); return; }
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
  if (_articlesLoadError) { el.innerHTML = loadErrorHtml(); return; }
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
  discardPendingUploads();
  _heroImages = [];
  refreshHeroBox();
  document.getElementById('np-summary').value    = '';
  document.getElementById('np-body').value       = '';
  document.getElementById('np-author-name').value    = '';
  document.getElementById('np-published-at').value   = '';
  _articlePhotos = [];
  renderPhotoStrip();
  setCoauthors([]);
  document.getElementById('editor-heading').textContent = 'New Article';
  document.getElementById('np-summary-count').textContent = '0 / 280';
  document.getElementById('np-body-count').textContent = '0 chars';
  updatePreview();
  _editingId = null;
}

// ── Time-zone helpers (stress-test item 15) ───────────────────────
// datetime-local inputs hold LOCAL wall-clock time, so filling one must
// use local getters — toISOString() is UTC, and the old fill silently
// shifted published_at by the viewer's UTC offset on every edit-save
// (+7h in Denver, +6h in DST). The save path already parses the input
// as local time and stores UTC, so local-in / local-out round-trips.
function toLocalInputValue(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Short zone abbreviation for the viewer's zone, e.g. "MST" / "MDT".
function viewerTzAbbr(d = new Date()) {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName');
    return part ? part.value : '';
  } catch (e) { return ''; }
}
// Appends the local-time note to the existing hint under the Publish Date
// input (once), so the author can see the value is local time and which
// zone it is in.
function notePublishDateLocalTime() {
  const input = document.getElementById('np-published-at');
  const hint = input?.parentElement?.querySelector('.form-hint');
  if (!hint || hint.dataset.tzNoted) return;
  hint.dataset.tzNoted = '1';
  const abbr = viewerTzAbbr();
  hint.textContent += abbr ? ` Times are local (${abbr}).` : ' Times are local.';
}

window.loadIntoEditor = async (id) => {
  const a = _myArticles.find(x => x.id === id);
  if (!a) return;
  discardPendingUploads();
  _editingId = id;
  document.getElementById('np-editing-id').value = id;
  document.getElementById('np-title').value      = a.title   || '';
  document.getElementById('np-category').value   = a.category || '';
  _articlePhotos = [];
  // Main hero first, then the extra heroes, in order. Stored heroes
  // have no pending file; a picked-but-unsaved hero carries its File.
  _heroImages = [a.image_url, ...((Array.isArray(a.hero_images) ? a.hero_images : []).filter(v => typeof v === 'string'))]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map(v => ({ value: v, file: null, preview: '' }));
  refreshHeroBox();
  document.getElementById('np-summary').value    = a.summary  || '';
  document.getElementById('np-body').value       = a.body     || '';
  // Photos already in the body join the strip, so reopening an article
  // shows all of its photos in the box — except the heroes, which have
  // their own row above.
  // Reference-style photo definitions (`[photo-1]: <path>`) resolve first,
  // so both inline `![alt](path)` and reference `![alt][photo-1]` images
  // join the strip.
  const photoDefs = {};
  for (const m of (a.body || '').matchAll(/^\[([^\]]+)\]:[ \t]*([^\s]+)/gm)) photoDefs[m[1].trim().toLowerCase()] = m[2];
  const heroValues = new Set(_heroImages.map(h => h.value));
  for (const m of (a.body || '').matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const u = m[1];
    if (!u || u.startsWith('data:') || heroValues.has(u)) continue;
    trackArticlePhoto(u, '');
  }
  for (const m of (a.body || '').matchAll(/!\[([^\]]*)\]\[([^\]]+)\]/g)) {
    const u = photoDefs[m[2].trim().toLowerCase()];
    if (!u || u.startsWith('data:') || heroValues.has(u)) continue;
    trackArticlePhoto(u, m[1] || '');
  }
  renderPhotoStrip();
  document.getElementById('np-author-name').value = a.author_name || '';
  setCoauthors(_coauthorsSupported ? await resolveCoauthorNames(a.coauthor_ids) : []);
  if (a.published_at) {
    const d = new Date(a.published_at);
    document.getElementById('np-published-at').value = toLocalInputValue(d);
  } else {
    document.getElementById('np-published-at').value = '';
  }
  notePublishDateLocalTime();
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
// Shares the same private news-images bucket for both. Files are grouped
// under the article's id once it has one, or a per-session draft folder
// before the first save. Uploads store the storage PATH; render sites
// mint a signed URL from it (signedUrlForPublished in supabase.js).
//
// DEFERRED UPLOADS: picking or dropping a photo does NOT upload it.
// The File stays in memory and previews through an object URL until
// the author clicks Save Draft or Publish, when flushPendingUploads()
// uploads everything still in the article. Closing the editor without
// saving leaves nothing orphaned in storage.
let _uploadFolder = `draft-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
function uploadFolder() { return _editingId || _uploadFolder; }

// Body photos picked but not yet uploaded, keyed by their placeholder
// token: { file, alt, preview } where preview is an object URL for the
// Preview tab and the thumbnail strip. Emptied by flushPendingUploads()
// (uploaded) or discardPendingUploads() (editor cleared / article loaded).
let _pendingBody = new Map();

// Drop a pending hero's object URL (its File was removed or uploaded).
function revokeHeroEntry(entry) {
  if (entry && entry.file && entry.preview) URL.revokeObjectURL(entry.preview);
}

// Throw away every not-yet-uploaded photo: pending heroes lose their
// object URLs, pending body photos are forgotten. Nothing in storage
// is touched — these files were never uploaded.
function discardPendingUploads() {
  for (const entry of _heroImages) revokeHeroEntry(entry);
  for (const p of _pendingBody.values()) URL.revokeObjectURL(p.preview);
  _pendingBody.clear();
}

async function uploadNewsImage(file) {
  // News photos are optimized before upload (resized, converted, EXIF stripped).
  file = await optimizeImageFile(file);
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  // Stress-test 4: resilient upload — 30s timeout + one retry on network
  // errors, so a stalled connection fails with a toast instead of hanging
  // the Save button forever. A fresh path per attempt: retries can never
  // collide with or overwrite an earlier attempt.
  const makePath = () => `${uploadFolder()}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { path } = await uploadFileResilient('news-images', makePath, file);
  // The bucket is private: store the storage PATH, not a public URL.
  // Render sites mint a short-lived signed URL from the path
  // (signedUrlForPublished in supabase.js); a public URL would 404
  // once the bucket is private.
  return path;
}

// Non-hero photos attached to the article in this editor session: inline
// Photo uploads, body drops, and images already in the body when an
// article is loaded. The heroes live in _heroImages; this list is
// everything else, shown as a thumbnail strip under the hero preview so
// all of the article's photos show up in the box together.
let _articlePhotos = []; // [{ value, alt }]
function trackArticlePhoto(value, alt) {
  if (!value) return;
  if (_articlePhotos.some(p => p.value === value)) return;
  _articlePhotos.push({ value, alt: alt || value.split('/').pop() || 'photo' });
}

async function renderPhotoStrip() {
  const box = document.getElementById('np-image-thumbs');
  if (!_articlePhotos.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.innerHTML = '<div style="width:100%;font-size:10px;color:var(--muted);text-align:center;">Also in this article:</div>' + _articlePhotos.map((p, i) =>
    `<div style="width:64px;text-align:center;">
       <img data-idx="${i}" alt="${esc(p.alt)}" style="width:64px;height:48px;object-fit:cover;border-radius:4px;display:block;background:var(--bg);">
       <div style="font-size:9px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(p.alt)}">${esc(p.alt)}</div>
     </div>`).join('');
  box.style.display = 'flex';
  for (let i = 0; i < _articlePhotos.length; i++) {
    const p = _articlePhotos[i];
    const img = box.querySelector(`[data-idx="${i}"]`);
    if (!img) continue;
    const src = await signedUrlForPublished('news-images', p.value, { isAuthorOrApprover: true });
    // The strip may have re-rendered while the signed URL was minting;
    // only fill in the image that is still showing for this photo.
    if (src && img.isConnected && img.dataset.idx === String(i)) img.src = src;
  }
}

// Hero images: an article can have more than one. _heroImages holds
// ordered entries { value, file, preview }: value is the STORED value
// (a storage path, a legacy public URL, or a hand-pasted external URL),
// file is the picked File while the photo is still pending upload
// (null once stored), and preview is its object URL for that window.
// _heroImages[0] is the main hero and mirrors the #np-image input,
// which the save path still reads. The extras live in the
// news_articles.hero_images column; image_url stays the main hero so
// the news list, admin modal, and old articles keep working unchanged.
let _heroImages = []; // [{ value, file, preview }, ...]

function heroAlt(entry) {
  if (entry.file) return (entry.file.name.replace(/\.[^.]+$/, '') || 'photo');
  const name = String(entry.value || '').split('/').pop() || 'photo';
  return name.replace(/\.[^.]+$/, '') || 'photo';
}

async function refreshHeroBox() {
  const entry = _heroImages[0];
  const primary = entry?.value || '';
  // The np-image input keeps the STORED primary value (empty while the
  // main hero is still pending upload). The preview <img> needs a
  // renderable URL: a pending hero uses its object URL; a stored one
  // mints a signed URL (private bucket), publication gate bypassed —
  // this is the author/coauthor/approver previewing their own article.
  document.getElementById('np-image').value = primary;
  let previewUrl = null;
  if (entry?.file) previewUrl = entry.preview;
  else if (primary) previewUrl = await signedUrlForPublished('news-images', primary, { isAuthorOrApprover: true });
  // The hero may have changed while the signed URL was minting; only show
  // the preview that belongs to the current main hero.
  const current = _heroImages[0];
  const showUrl = (current === entry) ? previewUrl : null;
  document.getElementById('np-image-preview').src = showUrl || '';
  document.getElementById('np-image-preview-wrap').style.display = showUrl ? '' : 'none';
  document.getElementById('np-image-dropzone-label').textContent = (primary || entry) ? 'Click to add more hero photos' : 'Drag & drop photos here, or click to browse';
  renderHeroThumbs();
}

// Thumbnails of every hero image, under the big main preview: click one
// to make it the main hero, × to take it out of the hero set.
async function renderHeroThumbs() {
  const box = document.getElementById('np-hero-thumbs');
  if (_heroImages.length < 2) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.innerHTML = '<div style="width:100%;font-size:10px;color:var(--muted);text-align:center;">Hero images — click one to make it the main photo:</div>' + _heroImages.map((entry, i) =>
    `<div data-hero-idx="${i}" style="width:64px;text-align:center;position:relative;cursor:pointer;">
       <img alt="${esc(heroAlt(entry))}" title="${i === 0 ? 'Main hero' : 'Click to make this the main hero'}" style="width:64px;height:48px;object-fit:cover;border-radius:4px;display:block;background:var(--bg);${i === 0 ? 'outline:2px solid var(--blue);' : ''}">
       <span data-hero-remove="${i}" title="Remove from hero images" style="position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:11px;line-height:16px;text-align:center;cursor:pointer;">×</span>
       <div style="font-size:9px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(heroAlt(entry))}">${i === 0 ? 'Main' : 'Hero'} · ${esc(heroAlt(entry))}</div>
     </div>`).join('');
  box.style.display = 'flex';
  for (let i = 0; i < _heroImages.length; i++) {
    const entry = _heroImages[i];
    const img = box.querySelector(`[data-hero-idx="${i}"] img`);
    if (!img) continue;
    if (entry.file) { img.src = entry.preview; continue; }
    const src = await signedUrlForPublished('news-images', entry.value, { isAuthorOrApprover: true });
    // The thumbs may have re-rendered while the signed URL was minting;
    // only fill in the image that still shows this photo at this spot.
    if (src && img.isConnected && _heroImages[i] === entry) img.src = src;
  }
}

async function setHeroImage(url) {
  // Sets the main hero, keeping any extra heroes. Clearing it promotes
  // the next hero to main (or empties the set when there is none).
  // Replacing a pending main hero discards its file (never uploaded).
  url = (url || '').trim();
  if (url) {
    const entry = { value: url, file: null, preview: '' };
    if (_heroImages.length) { revokeHeroEntry(_heroImages[0]); _heroImages[0] = entry; }
    else _heroImages.push(entry);
  } else {
    revokeHeroEntry(_heroImages.shift());
  }
  await refreshHeroBox();
}

// Hero dropzone accepts more than one photo: every photo dropped or
// picked here becomes a hero image. The first is the main hero; the rest
// show as thumbnails under it in the box and on the article page.
// Photos meant for the article body go through the Photo button, or a
// drop straight into the body textbox, instead.
// Photos are NOT uploaded here — the File is kept in memory and
// previews through an object URL until Save/Publish uploads it.
async function handleHeroFiles(fileList) {
  const picked = Array.from(fileList || []);
  const files = picked.filter(f => f && f.type.startsWith('image/'));
  const skipped = picked.length - files.length;
  if (!files.length) {
    if (skipped) toast('Only image files can be uploaded.', true);
    return;
  }
  for (const file of files) {
    _heroImages.push({ value: '', file, preview: URL.createObjectURL(file) });
  }
  await refreshHeroBox();
  toast(`Added ${files.length} hero photo${files.length === 1 ? '' : 's'} — will upload when you save`);
  if (skipped) toast('Skipped ' + skipped + ' non-image file' + (skipped === 1 ? '' : 's') + '.', true);
}

const npImageDropzone = document.getElementById('np-image-dropzone');
const npImageFile     = document.getElementById('np-image-file');
npImageDropzone.addEventListener('click', () => npImageFile.click());
npImageFile.addEventListener('change', e => { handleHeroFiles(e.target.files); npImageFile.value = ''; });
['dragover','dragenter'].forEach(evt => npImageDropzone.addEventListener(evt, e => {
  e.preventDefault(); npImageDropzone.style.borderColor = 'var(--blue)'; npImageDropzone.style.background = 'var(--bg)';
}));
['dragleave','dragend'].forEach(evt => npImageDropzone.addEventListener(evt, () => {
  npImageDropzone.style.borderColor = 'var(--border)'; npImageDropzone.style.background = 'transparent';
}));
npImageDropzone.addEventListener('drop', e => {
  e.preventDefault();
  npImageDropzone.style.borderColor = 'var(--border)'; npImageDropzone.style.background = 'transparent';
  handleHeroFiles(e.dataTransfer.files);
});

// Hero thumbnail strip: click a thumb to make it the main hero, × to take
// it out of the hero set (the next hero becomes main). Delegated, since
// the strip re-renders on every hero change.
document.getElementById('np-hero-thumbs').addEventListener('click', async e => {
  const removeBtn = e.target.closest('[data-hero-remove]');
  if (removeBtn) {
    const [removed] = _heroImages.splice(Number(removeBtn.dataset.heroRemove), 1);
    revokeHeroEntry(removed); // a pending hero's file is never uploaded
    await refreshHeroBox();
    return;
  }
  const thumb = e.target.closest('[data-hero-idx]');
  if (thumb) {
    const idx = Number(thumb.dataset.heroIdx);
    if (idx > 0) {
      const [picked] = _heroImages.splice(idx, 1);
      _heroImages.unshift(picked);
      await refreshHeroBox();
    }
  }
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

// Upload photos and insert them into the body at the given position, one
// unique placeholder per photo so uploads finishing out of order can't
// overwrite each other's spot. Shared by the Photo button and by dropping
// photos straight into the body textbox.
// Photos go in as reference-style markdown — `![alt][photo-1]` where you
// write, with the long storage path kept in a `[photo-1]: <path>`
// definition at the end of the body — so the typing box shows a short
// readable line instead of a path, and the preview/article still render
// the actual picture.
function nextPhotoRef() {
  const body = document.getElementById('np-body').value;
  let max = 0;
  for (const m of body.matchAll(/\[photo-(\d+)\]/g)) max = Math.max(max, Number(m[1]));
  return 'photo-' + (max + 1);
}

function appendPhotoDefinition(ref, path) {
  const textarea = document.getElementById('np-body');
  const def = `[${ref}]: ${path}`;
  textarea.value = textarea.value ? textarea.value.replace(/\s+$/, '') + '\n\n' + def + '\n' : def + '\n';
}

async function insertBodyPhotos(files, start, end) {
  const textarea = document.getElementById('np-body');
  const from = Math.max(0, Math.min(start ?? textarea.selectionStart, textarea.value.length));
  const to = Math.max(from, Math.min(end ?? from, textarea.value.length));
  const placeholders = files.map((file, i) => {
    const token = `photo-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`;
    return { file, token, text: `![Uploading ${token}…]()` };
  });
  textarea.setRangeText(placeholders.map(p => p.text).join('\n'), from, to, 'end');
  // Photos are NOT uploaded here — each File is kept in _pendingBody
  // under its placeholder token and previews through an object URL
  // until Save/Publish (flushPendingUploads) uploads it. Deleting the
  // placeholder line before saving drops the photo without uploading.
  for (const p of placeholders) {
    const alt = p.file.name.replace(/\.[^.]+$/, '');
    const pending = { file: p.file, alt, preview: URL.createObjectURL(p.file) };
    _pendingBody.set(p.token, pending);
    trackArticlePhoto(pending.preview, alt);
  }
  updatePreview(); updateCharCounts();
  renderPhotoStrip();
  toast(`Added ${placeholders.length} photo${placeholders.length === 1 ? '' : 's'} — will upload when you save`);
}

// Inline "insert photo" toolbar button — uploads and drops markdown at the cursor.
const npInlineImageFile = document.getElementById('np-inline-image-file');
document.getElementById('tb-insert-image').addEventListener('click', () => npInlineImageFile.click());
npInlineImageFile.addEventListener('change', async e => {
  const picked = Array.from(e.target.files || []);
  npInlineImageFile.value = '';
  const files = picked.filter(f => f && f.type.startsWith('image/'));
  if (!files.length) {
    if (picked.length) toast('Only image files can be uploaded.', true);
    return;
  }
  const textarea = document.getElementById('np-body');
  await insertBodyPhotos(files, textarea.selectionStart, textarea.selectionEnd);
  if (picked.length > files.length) toast('Skipped ' + (picked.length - files.length) + ' non-image file' + (picked.length - files.length === 1 ? '' : 's') + '.', true);
});

// Drag & drop straight into the body textbox works the same as the Photo
// button: the photos upload and land as markdown where they were dropped.
function dropCaretPosition(textarea, event) {
  // Caret position in the textbox under the mouse. Falls back to the
  // current caret when the browser can't tell us.
  try {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(event.clientX, event.clientY);
      if (r && (r.startContainer === textarea || textarea.contains(r.startContainer)) && typeof r.startOffset === 'number') return r.startOffset;
    }
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(event.clientX, event.clientY);
      if (p && (p.offsetNode === textarea || textarea.contains(p.offsetNode)) && typeof p.offset === 'number') return p.offset;
    }
  } catch { /* fall through to the caret */ }
  return textarea.selectionStart;
}

const npBody = document.getElementById('np-body');
npBody.addEventListener('dragover', e => {
  // Only take over when files are being dragged in; dragging text around
  // inside the box keeps the browser's default move-text behaviour.
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
  e.preventDefault();
  npBody.style.borderColor = 'var(--blue)';
});
npBody.addEventListener('dragleave', () => { npBody.style.borderColor = ''; });
npBody.addEventListener('drop', async e => {
  if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  npBody.style.borderColor = '';
  const picked = Array.from(e.dataTransfer.files);
  const files = picked.filter(f => f && f.type.startsWith('image/'));
  if (!files.length) { toast('Only image files can be uploaded.', true); return; }
  const pos = dropCaretPosition(npBody, e);
  await insertBodyPhotos(files, pos, pos);
  if (picked.length > files.length) toast('Skipped ' + (picked.length - files.length) + ' non-image file' + (picked.length - files.length === 1 ? '' : 's') + '.', true);
});

// ── Email subscribers when an article goes live ────────────────
async function notifySubscribers(articleId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('https://ghyajcawrnrvnwhicfql.supabase.co/functions/v1/notify-news-subscribers', {
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

// Double-clicking Publish on a new article used to run the insert twice —
// two published articles, and notifySubscribers() firing a second email blast
// to every subscriber. The generated slug carries a timestamp, so there was no
// unique constraint to fall back on. Same guard as the admin page
// (admin.page.js saveArticle); audit publishing:news-publish-double-submit-duplicates.
let _saving = false;

async function saveArticle(forcedStatus) {
  if (_saving) return;
  _saving = true;
  const saveBtns = ['btn-save-draft', 'btn-publish'].map(x => document.getElementById(x)).filter(Boolean);
  saveBtns.forEach(b => { b.disabled = true; });
  try { await saveArticleInner(forcedStatus); }
  finally {
    _saving = false;
    saveBtns.forEach(b => { b.disabled = false; });
  }
}

// Upload every photo added in this editor session that is still in
// the article, then rewrite the body and heroes to the stored paths.
// This is the ONLY place photos upload: nothing was sent to storage
// when the photos were picked, so closing the editor without saving
// leaves nothing orphaned. Returns false (after a toast naming the
// file) when an upload fails — the save must not go ahead pointing at
// a photo that isn't in storage. A photo whose upload already
// succeeded is stored in the editor state right away, so retrying the
// save only uploads the ones still pending.
async function flushPendingUploads() {
  let ok = true;
  // Photos uploaded before a failure are unreferenced (the save aborts),
  // so they are retracted below and their editor entries restored to
  // pending — retrying Save re-uploads them instead of saving dangling paths.
  const uploadedThisFlush = [];
  const uploadingEl = document.getElementById('np-image-uploading');
  if (uploadingEl) uploadingEl.style.display = '';
  // Heroes first, in order.
  for (const entry of _heroImages) {
    if (!entry.file) continue;
    const file = entry.file, prevValue = entry.value;
    try {
      entry.value = await uploadNewsImage(entry.file);
      URL.revokeObjectURL(entry.preview);
      entry.file = null; entry.preview = '';
      uploadedThisFlush.push({ path: entry.value, restore: () => {
        entry.file = file; entry.value = prevValue;
        // The success path revoked the old object URL, so mint a fresh one
        // or refreshHeroBox() would show an empty preview for the restored hero.
        entry.preview = URL.createObjectURL(file);
      } });
    } catch (err) {
      toast('Photo upload failed: ' + entry.file.name + ': ' + err.message + ' — article not saved.', true);
      ok = false;
      break;
    }
  }
  if (ok) {
    // Body photos: only placeholders still in the body text upload.
    const textarea = document.getElementById('np-body');
    const present = new Set();
    for (const m of textarea.value.matchAll(/!\[Uploading ([A-Za-z0-9-]+)…\]\(\)/g)) present.add(m[1]);
    for (const [token, p] of [..._pendingBody]) {
      if (!present.has(token)) {
        // The author deleted the line — drop the photo, never upload it.
        URL.revokeObjectURL(p.preview);
        _pendingBody.delete(token);
        _articlePhotos = _articlePhotos.filter(x => x.value !== p.preview);
        continue;
      }
      try {
        const path = await uploadNewsImage(p.file);
        const ref = nextPhotoRef();
        textarea.value = textarea.value.replace(`![Uploading ${token}…]()`, `![${p.alt}][${ref}]`);
        appendPhotoDefinition(ref, path);
        const stripEntry = _articlePhotos.find(x => x.value === p.preview);
        if (stripEntry) stripEntry.value = path;
        URL.revokeObjectURL(p.preview);
        _pendingBody.delete(token);
        uploadedThisFlush.push({ path, restore: () => {
          // Mint a fresh preview URL: the success path revoked the old one,
          // and the thumbnail strip would otherwise show a dead object URL.
          p.preview = URL.createObjectURL(p.file);
          textarea.value = textarea.value.replace(`![${p.alt}][${ref}]`, `![Uploading ${token}…]()`);
          textarea.value = textarea.value.replace(new RegExp(`^\\[${ref}\\]: .*\\n?`, 'm'), '');
          _pendingBody.set(token, p);
          const s = _articlePhotos.find(x => x.value === path);
          if (s) s.value = p.preview;
        } });
      } catch (err) {
        toast('Photo upload failed: ' + p.file.name + ': ' + err.message + ' — article not saved.', true);
        ok = false;
        break;
      }
    }
    if (ok) {
      // A placeholder whose token is unknown (hand-edited) can't resolve —
      // strip it so a half-finished marker never lands in the saved article.
      textarea.value = textarea.value.replace(/^!\[Uploading [^\]]*…\]\(\)\n?/gm, '');
    }
  }
  if (!ok && uploadedThisFlush.length) {
    // Photos uploaded before the failure are unreferenced (the save was
    // aborted) — retract them and restore the editor entries to pending
    // so retrying Save re-uploads them instead of saving dangling paths.
    await cleanupUploadedPaths('news-images', uploadedThisFlush.map(u => u.path));
    uploadedThisFlush.forEach(u => u.restore());
  }
  // Re-render either way: photos that did upload must stop showing
  // their (now revoked) object URLs and show the stored image instead.
  await refreshHeroBox();
  renderPhotoStrip();
  updatePreview(); updateCharCounts();
  if (uploadingEl) uploadingEl.style.display = 'none';
  return ok;
}

async function saveArticleInner(forcedStatus) {
  const id      = document.getElementById('np-editing-id').value;
  const title   = document.getElementById('np-title').value.trim();
  if (!title) { toast('Please enter a headline.', true); return; }

  // Uploads happen here, at save time — nothing was uploaded when the
  // photos were picked. A failed upload aborts the save (see above).
  if (!(await flushPendingUploads())) return;
  const body = document.getElementById('np-body').value.trim();

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
    image_url:   _heroImages[0]?.value || null,
    hero_images: _heroImages.slice(1).map(h => h.value),
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
// Audit fix publishing:delete-leaves-storage-objects: resolve a stored hero
// image value to its news-images bucket path so deleting the article retracts
// the object too. Stored values are either a bare storage path (new uploads)
// or a legacy full public/signed URL; anything else is not our object.
function newsImageStoragePath(stored) {
  const raw = String(stored ?? '').trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('//')) return raw.replace(/^\/+/, '');
  const marker = '/storage/v1/object/public/news-images/';
  const signed = '/storage/v1/object/sign/news-images/';
  const i = raw.indexOf(marker) >= 0 ? raw.indexOf(marker) + marker.length : raw.indexOf(signed) >= 0 ? raw.indexOf(signed) + signed.length : -1;
  if (i < 0) return null;
  const path = raw.slice(i).split('?')[0];
  try { return decodeURIComponent(path); } catch { return path; }
}

window.deleteArticle = async (id) => {
  if (!(await mcaConfirm({ title: 'Delete article?', message: 'Delete this article? This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
  const { data: article } = await supabase.from('news_articles').select('image_url,hero_images').eq('id', id).maybeSingle();
  const { error } = await supabase.from('news_articles').delete().eq('id', id);
  if (error) { toast('Error: '+error.message, true); return; }
  const paths = [article?.image_url, ...((Array.isArray(article?.hero_images) ? article.hero_images : []).filter(v => typeof v === 'string'))]
    .map(v => newsImageStoragePath(v)).filter(Boolean);
  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from('news-images').remove(paths);
    if (rmErr) console.warn('Could not remove deleted article images:', rmErr.message);
  }
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

// Only the newest keystroke's preview may paint: minting signed URLs
// for inline body photos is async, and a slow mint from an older body
// must not overwrite the preview of the current text.
let _previewToken = 0;
async function updatePreview() {
  const token = ++_previewToken;
  const body = document.getElementById('np-body').value;
  // Pending (not yet uploaded) body photos show through their object
  // URLs: swap each placeholder for an inline image pointing at the
  // blob URL. The signed-URL resolver passes blob: URLs through
  // untouched (they are not storage paths), and renderMarkdown renders
  // them via the blob: allowance in safeUrl.
  const previewBody = body.replace(/!\[Uploading ([A-Za-z0-9-]+)…\]\(\)/g, (m, token) => {
    const p = _pendingBody.get(token);
    return p ? `![${p.alt}](${p.preview})` : m;
  });
  // Body markdown may embed news-images photos as storage paths; resolve
  // them to signed URLs for the author's preview (publication gate
  // bypassed — this is the author's own draft).
  const resolved = await resolvePrivateBucketImagesInMarkdown('news-images', previewBody, { isAuthorOrApprover: true });
  if (token !== _previewToken) return;
  document.getElementById('np-preview').innerHTML = renderMarkdown(resolved);
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
document.getElementById('btn-clear-editor').addEventListener('click', async () => {
  if (document.getElementById('np-title').value && !(await mcaConfirm({ title: 'Clear the editor?', message: 'Unsaved changes will be lost.', confirmText: 'Clear' }))) return;
  clearEditor();
});
document.getElementById('btn-save-draft').addEventListener('click', () => saveArticle('draft'));
document.getElementById('btn-publish').addEventListener('click', async () => {
  if (!(await mcaConfirm({ title: 'Publish this article?', message: 'It will be visible to everyone on the website.', confirmText: 'Publish' }))) return;
  saveArticle('published');
});

init();
