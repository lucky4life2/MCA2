import { supabase, requireAal2 } from './supabase.js';

// ── Delegated actions (strict CSP) ────────────────────────────────
// Inline handler attributes are blocked by the strict script-src policy,
// so every button/row above is wired through these listeners instead.
// data-action names the action; data-id / data-index / data-label carry
// the values the old inline handler used to inline. Handlers run at click
// time, after this module has fully evaluated, so window-assigned page
// functions are available here exactly as they were to inline handlers.

const _ACTION_HANDLERS = {
  'load-into-editor': (el, e) => window.loadIntoEditor(el.dataset.id),
  'quick-publish': (el, e) => window.quickPublish(el.dataset.id),
  'quick-unpublish': (el, e) => window.quickUnpublish(el.dataset.id),
  'delete-doc': (el, e) => window.deleteDoc(el.dataset.id),
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


// Document metadata is author-supplied and rendered through innerHTML below.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Keep javascript:/data: URLs out of markdown links.
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

const BUCKET = 'archive-files';

function renderMarkdown(md) {
  if (!md) return '<em style="color:var(--muted);">Nothing to preview yet.</em>';
  let html = md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/^---+$/gm,'<hr>')
    .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      const u = safeUrl(url);
      return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    });
  html = html.replace(/(^[-*] .+\n?)+/gm, m => {
    const items = m.trim().split('\n').map(l=>`<li>${l.replace(/^[-*] /,'')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  html = html.split(/\n{2,}/).map(block => {
    block = block.trim(); if (!block) return '';
    if (/^<(h[1-6]|ul|ol|hr)/.test(block)) return block;
    return `<p>${block.replace(/\n/g,'<br>')}</p>`;
  }).join('\n');
  return html;
}

let _user = null, _profile = null;
let _myDocs = [], _allDocs = [], _editingId = null;
let _pendingFile = null;   // File object staged for upload
let _currentFileUrl = null, _currentFileName = null;

function toast(msg, isError = false) {
  const el = document.getElementById('ap-toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = ''; }, 3000);
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) { showState('denied'); return; }
  if (!(await requireAal2('archive-publish.html'))) return;
  _user = session.user;

  // Server-side permission RPC only. A failed or errored check denies
  // access — it must never fall back to profiles.role.
  let hasAccess = false;
  try {
    const { data, error } = await supabase.rpc('user_has_permission', { perm: 'can_manage_archive' });
    hasAccess = !error && data === true;
  } catch (e) {
    hasAccess = false;
  }

  if (!hasAccess) { showState('denied'); return; }

  const { data: profile } = await supabase.from('profiles').select('display_name,username').eq('id', _user.id).single();
  _profile = profile;
  const name = profile?.display_name || profile?.username || _user.email;
  document.getElementById('ap-author-meta').textContent = `Publishing as ${name}`;

  showState('main');
  await loadDocs();
}

function showState(which) {
  document.getElementById('ap-loading').style.display = which === 'loading' ? '' : 'none';
  document.getElementById('ap-denied').style.display  = which === 'denied'  ? '' : 'none';
  document.getElementById('ap-main').style.display    = which === 'main'    ? '' : 'none';
}

async function loadDocs() {
  const { data: mine } = await supabase
    .from('archive_documents').select('*')
    .eq('author_id', _user.id)
    .order('created_at', { ascending: false });
  _myDocs = mine || [];

  const { data: all } = await supabase
    .from('archive_documents').select('id,title,category,author_name,published_at,status')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(20);
  _allDocs = all || [];

  renderMyDocs();
  renderAllDocs();
}

function renderMyDocs() {
  const el = document.getElementById('my-docs-list');
  document.getElementById('my-count').textContent = `${_myDocs.length} document${_myDocs.length !== 1 ? 's' : ''}`;
  if (!_myDocs.length) {
    el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:13px;">No documents yet. Add your first one above!</div>`;
    return;
  }
  el.innerHTML = _myDocs.map(d => {
    const date = d.published_at
      ? new Date(d.published_at + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
      : new Date(d.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    return `<div class="doc-row">
      <span class="status-pip ${esc(d.status)}"></span>
      <div class="doc-row-info">
        <div class="doc-row-title">${esc(d.title)}</div>
        <div class="doc-row-meta">${esc(d.category||'Uncategorized')} · ${esc(capitalise(d.status))} · ${esc(date)}</div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button class="btn btn-outline btn-sm" data-action="load-into-editor" data-id="${d.id}">Edit</button>
        ${d.status !== 'published'
          ? `<button class="btn btn-success btn-sm" data-action="quick-publish" data-id="${d.id}">Publish</button>`
          : `<button class="btn btn-ghost btn-sm" data-action="quick-unpublish" data-id="${d.id}">Unpublish</button>`}
        <button class="btn btn-danger btn-sm" data-action="delete-doc" data-id="${d.id}">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderAllDocs() {
  const el = document.getElementById('all-docs-list');
  document.getElementById('all-count').textContent = `${_allDocs.length} published`;
  if (!_allDocs.length) {
    el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--muted);font-size:13px;">No published documents yet.</div>`;
    return;
  }
  el.innerHTML = _allDocs.map(d => {
    const date = d.published_at
      ? new Date(d.published_at + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
      : '';
    return `<div class="doc-row">
      <span class="status-pip published"></span>
      <div class="doc-row-info">
        <div class="doc-row-title">${esc(d.title)}</div>
        <div class="doc-row-meta">${esc(d.category||'Uncategorized')} · ${esc(d.author_name||'Unknown')} · ${esc(date)}</div>
      </div>
    </div>`;
  }).join('');
}

function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,80);
}

function clearEditor() {
  document.getElementById('ap-editing-id').value = '';
  document.getElementById('ap-title').value      = '';
  document.getElementById('ap-category').value   = '';
  document.getElementById('ap-supporters').value = '';
  document.getElementById('ap-summary').value    = '';
  document.getElementById('ap-body').value       = '';
  document.getElementById('ap-author-name').value = '';
  document.getElementById('ap-published-at').value = '';
  document.getElementById('ap-file').value = '';
  document.getElementById('ap-file-current').innerHTML = '';
  document.getElementById('editor-heading').textContent = 'New Document';
  document.getElementById('ap-summary-count').textContent = '0 / 280';
  document.getElementById('ap-body-count').textContent = '0 chars';
  _pendingFile = null; _currentFileUrl = null; _currentFileName = null;
  updatePreview();
  _editingId = null;
}

window.loadIntoEditor = async (id) => {
  const d = _myDocs.find(x => x.id === id);
  if (!d) return;
  _editingId = id;
  document.getElementById('ap-editing-id').value = id;
  document.getElementById('ap-title').value      = d.title    || '';
  document.getElementById('ap-category').value   = d.category || '';
  document.getElementById('ap-supporters').value = (d.supporters || []).join(', ');
  document.getElementById('ap-summary').value    = d.summary   || '';
  document.getElementById('ap-body').value       = d.body      || '';
  document.getElementById('ap-author-name').value = d.author_name || '';
  document.getElementById('ap-published-at').value = d.published_at || '';
  document.getElementById('ap-file').value = '';
  _pendingFile = null;
  _currentFileUrl  = d.file_url  || null;
  _currentFileName = d.file_name || null;
  const _safeCurrentFileUrl = safeUrl(_currentFileUrl);
  document.getElementById('ap-file-current').innerHTML = _currentFileUrl
    ? (_safeCurrentFileUrl
      ? `Current: <a href="${esc(_safeCurrentFileUrl)}" target="_blank" rel="noopener">${esc(_currentFileName) || 'view file'}</a>`
      : `Current: ${esc(_currentFileName) || 'file unavailable'}`)
    : '';
  document.getElementById('editor-heading').textContent = 'Editing: ' + d.title;
  updateCharCounts();
  updatePreview();
  document.getElementById('editor-heading').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setEditorMode('write');
  toast('Document loaded into editor');
};

async function uploadFileIfNeeded() {
  if (!_pendingFile) return { url: _currentFileUrl, name: _currentFileName };
  const ext = (_pendingFile.name.split('.').pop() || '').toLowerCase();
  const path = `${_user.id}/${Date.now()}-${slugify(_pendingFile.name.replace(/\.[^.]+$/, ''))}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, _pendingFile);
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, name: _pendingFile.name };
}

async function saveDoc(forcedStatus) {
  const id      = document.getElementById('ap-editing-id').value;
  const title   = document.getElementById('ap-title').value.trim();
  const body    = document.getElementById('ap-body').value.trim();
  if (!title) { toast('Please enter a document title.', true); return; }

  let fileInfo;
  try {
    fileInfo = await uploadFileIfNeeded();
  } catch (err) {
    toast('File upload failed: ' + err.message, true);
    return;
  }

  const status = forcedStatus || 'draft';
  const defaultAuthorName = _profile?.display_name || _profile?.username || _user.email;
  const overrideAuthor = document.getElementById('ap-author-name').value.trim();
  const authorName = overrideAuthor || defaultAuthorName;

  const supporters = document.getElementById('ap-supporters').value
    .split(',').map(s => s.trim()).filter(Boolean);

  const publishedAtInput = document.getElementById('ap-published-at').value;
  const publishedAt = publishedAtInput || (status === 'published' ? new Date().toISOString().slice(0,10) : null);

  const payload = {
    title,
    body,
    category:     document.getElementById('ap-category').value.trim() || 'Uncategorized',
    summary:      document.getElementById('ap-summary').value.trim() || null,
    supporters,
    status,
    author_name:  authorName,
    published_at: publishedAt,
    file_url:     fileInfo.url,
    file_name:    fileInfo.name,
  };

  let error;
  if (id) {
    // Keep slug text in sync with the title on every save
    const existing = _myDocs.find(x => x.id === id);
    const oldSlug  = existing?.slug || '';
    const suffix   = oldSlug.includes('-') ? oldSlug.slice(oldSlug.lastIndexOf('-') + 1) : Date.now().toString(36);
    const slug     = slugify(title) + '-' + suffix;
    ({ error } = await supabase.from('archive_documents').update({ ...payload, slug }).eq('id', id));
  } else {
    const slug = slugify(title) + '-' + Date.now().toString(36);
    ({ error } = await supabase.from('archive_documents').insert({
      ...payload, slug, author_id: _user.id
    }));
  }

  if (error) { toast('Error: ' + error.message, true); return; }

  toast(status === 'published' ? '✓ Document published!' : '✓ Draft saved');
  clearEditor();
  await loadDocs();
}

window.quickPublish = async (id) => {
  const doc = _myDocs.find(x => x.id === id);
  const { error } = await supabase.from('archive_documents')
    .update({ status: 'published', published_at: doc?.published_at || new Date().toISOString().slice(0,10) })
    .eq('id', id);
  if (error) { toast('Error: '+error.message, true); return; }
  toast('✓ Published!');
  await loadDocs();
};
window.quickUnpublish = async (id) => {
  const { error } = await supabase.from('archive_documents').update({ status: 'draft' }).eq('id', id);
  if (error) { toast('Error: '+error.message, true); return; }
  toast('Moved back to drafts');
  await loadDocs();
};
window.deleteDoc = async (id) => {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  const { error } = await supabase.from('archive_documents').delete().eq('id', id);
  if (error) { toast('Error: '+error.message, true); return; }
  if (_editingId === id) clearEditor();
  toast('Document deleted');
  await loadDocs();
};

document.getElementById('ap-file').addEventListener('change', e => {
  _pendingFile = e.target.files[0] || null;
  if (_pendingFile) {
    document.getElementById('ap-file-current').textContent = `Selected: ${_pendingFile.name} (will upload on save)`;
  }
});

document.querySelectorAll('#ap-toolbar .tb-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const textarea = document.getElementById('ap-body');
    const start = textarea.selectionStart, end = textarea.selectionEnd;
    const sel = textarea.value.slice(start, end);
    if (btn.dataset.wrap !== undefined) {
      const wrap = btn.dataset.wrap;
      textarea.setRangeText(wrap + (sel || 'text') + wrap, start, end, 'select');
    } else if (btn.dataset.prefix !== undefined) {
      textarea.setRangeText(btn.dataset.prefix + (sel || ''), start, end, 'end');
    } else if (btn.hasAttribute('data-link')) {
      const url = prompt('URL:', 'https://');
      if (!url) return;
      const text = sel || prompt('Link text:', 'link text') || 'link';
      textarea.setRangeText(`[${text}](${url})`, start, end, 'end');
    }
    textarea.focus();
    updatePreview();
    updateCharCounts();
  });
});

function setEditorMode(mode) {
  document.getElementById('tab-write').classList.toggle('active', mode === 'write');
  document.getElementById('tab-preview').classList.toggle('active', mode === 'preview');
  document.getElementById('ap-write-area').style.display   = mode === 'write'   ? '' : 'none';
  document.getElementById('ap-preview-area').style.display = mode === 'preview' ? '' : 'none';
  document.getElementById('ap-toolbar').style.display      = mode === 'write'   ? '' : 'none';
  if (mode === 'preview') updatePreview();
}
document.getElementById('tab-write').addEventListener('click',   () => setEditorMode('write'));
document.getElementById('tab-preview').addEventListener('click', () => setEditorMode('preview'));

function updatePreview() {
  document.getElementById('ap-preview').innerHTML = renderMarkdown(document.getElementById('ap-body').value);
}
function updateCharCounts() {
  const summaryLen = document.getElementById('ap-summary').value.length;
  document.getElementById('ap-summary-count').textContent = `${summaryLen} / 280`;
  const bodyLen = document.getElementById('ap-body').value.length;
  document.getElementById('ap-body-count').textContent = `${bodyLen} char${bodyLen !== 1 ? 's' : ''}`;
}
document.getElementById('ap-summary').addEventListener('input', updateCharCounts);
document.getElementById('ap-body').addEventListener('input', () => { updatePreview(); updateCharCounts(); });

document.getElementById('btn-clear-editor').addEventListener('click', () => {
  if (document.getElementById('ap-title').value && !confirm('Clear the editor? Unsaved changes will be lost.')) return;
  clearEditor();
});
document.getElementById('btn-save-draft').addEventListener('click', () => saveDoc('draft'));
document.getElementById('btn-publish').addEventListener('click', () => {
  if (!confirm('Publish this document? It will be visible to everyone in the Archive.')) return;
  saveDoc('published');
});

init();
