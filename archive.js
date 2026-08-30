// archive.js — MCA Document Archive engine (Supabase-backed)
// ─────────────────────────────────────────────────────────────
// Documents now live in the `archive_documents` table and are
// managed by Congress members through archive-publish.html —
// no more hand-editing markdown files on GitHub.
// ─────────────────────────────────────────────────────────────
import { supabase } from './supabase.js';

/* ── ESCAPING ───────────────────────────────────────────────── */
/* Everything on an archive_documents row is author-supplied and gets written
   straight into innerHTML below, so it has to be escaped first. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* Only http(s) and relative URLs may reach an href/src, so a javascript: or
   data: URL stored in file_url (or a markdown link) can't execute. */
function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^https?:\/\//i.test(u) ? u : '';
  return u;
}

/* ── HELPERS ────────────────────────────────────────────────── */
function isArchivePdf(file) {
  return (file || '').split(/[?#]/)[0].toLowerCase().endsWith('.pdf');
}

function getArchiveAssetName(file) {
  const clean = (file || '').split(/[?#]/)[0].replace(/\\/g, '/');
  return clean.split('/').pop() || clean;
}

/* ── MARKDOWN PARSER (reuse same logic as news) ─────────────── */
function parseArchiveMarkdown(md) {
  if (!md) return '';
  return md
    // Escape before any markup is generated — this parser previously emitted
    // the document body verbatim, so raw <script>/<img onerror> in a document
    // ran on archive.html and document.html for every visitor.
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/^---$/gm, '<hr class="divider">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      const u = safeUrl(url);
      return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    })
    .replace(/(^- .+$(\n^- .+$)*)/gm, match => {
      const items = match.split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    })
    .replace(/(^\d+\. .+$(\n^\d+\. .+$)*)/gm, match => {
      const items = match.split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `<ol>${items}</ol>`;
    })
    .split('\n\n')
    .map(block => {
      block = block.trim();
      if (!block) return '';
      if (/^<(h[1-6]|ul|ol|hr|blockquote|figure)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, ' ')}</p>`;
    })
    .join('\n');
}

/* ── DATE FORMATTER ─────────────────────────────────────────── */
function formatArchiveDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

function renderSupporters(supporters) {
  if (!supporters || !supporters.length) return '';
  return `
    <div class="document-supporters">
      <div class="document-supporters-label">Supporters</div>
      <div class="document-supporters-list">
        ${supporters.map(s => `<span class="supporter-pip">${esc(s)}</span>`).join('')}
      </div>
    </div>`;
}

/* ── ARCHIVE INDEX ──────────────────────────────────────────── */
async function loadArchiveIndex() {
  const loadingEl = document.getElementById('archive-loading');
  const errorEl   = document.getElementById('archive-error');
  const indexEl   = document.getElementById('archive-index');
  const filterEl  = document.getElementById('archive-filter');
  const searchEl  = document.getElementById('archive-search');
  const countEl   = document.getElementById('archive-search-count');
  const emptyEl   = document.getElementById('archive-empty');
  if (!indexEl) return;

  try {
    const { data: docs, error } = await supabase
      .from('archive_documents')
      .select('id,title,slug,category,summary,file_url,published_at,author_name')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (error) throw error;

    if (!docs || docs.length === 0) {
      loadingEl.textContent = 'No documents in the archive yet.';
      return;
    }

    // Get unique categories, Constitution pinned first
    const categories = [...new Set(docs.map(d => d.category || 'Uncategorized'))]
      .sort((a, b) => (a === 'Constitution' ? -1 : b === 'Constitution' ? 1 : 0));

    // Build category filter buttons
    if (filterEl) {
      filterEl.innerHTML = `
        <button class="archive-filter-btn active" data-cat="all">All</button>
        ${categories.map(cat => `<button class="archive-filter-btn" data-cat="${esc(cat)}">${esc(cat)}</button>`).join('')}
      `;
      filterEl.querySelectorAll('.archive-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          filterEl.querySelectorAll('.archive-filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          filterDocs();
        });
      });
    }

    // Group docs by category and render
    const grouped = {};
    docs.forEach(doc => {
      const cat = doc.category || 'Uncategorized';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(doc);
    });

    indexEl.innerHTML = categories.filter(cat => grouped[cat]).map(cat => { const catDocs = grouped[cat]; return `
      <div class="archive-category" data-category="${esc(cat)}">
        <div class="archive-category-header">${esc(cat)}</div>
        <div class="archive-category-docs">
          ${catDocs.map(doc => {
            const isPDF = isArchivePdf(doc.file_url);
            const thumb = !doc.file_url
              ? `<div class="archive-card-thumb archive-card-thumb-placeholder">📄</div>`
              : isPDF
              ? `<div class="archive-card-thumb archive-card-thumb-placeholder archive-card-thumb-pdf">PDF</div>`
              : `<img src="${esc(safeUrl(doc.file_url))}" alt="${esc(doc.title || '')}" class="archive-card-thumb">`;
            return `
              <a class="archive-card" href="document.html?slug=${encodeURIComponent(doc.slug)}">
                ${thumb}
                <div class="archive-card-body">
                  <div class="archive-card-category">${esc(cat)}</div>
                  <div class="archive-card-title">${esc(doc.title || 'Untitled')}</div>
                  <div class="archive-card-summary">${esc(doc.summary || '')}</div>
                  <div class="archive-card-meta">${esc(doc.published_at ? formatArchiveDate(doc.published_at) : '')} · ${esc(doc.author_name || 'MCA')}</div>
                </div>
              </a>`;
          }).join('')}
        </div>
      </div>`; }
    ).join('');

    loadingEl.style.display = 'none';
    indexEl.style.display   = 'block';

    // ── Filter logic ──────────────────────────────────────────
    function filterDocs() {
      const activeCat = filterEl
        ? (filterEl.querySelector('.archive-filter-btn.active')?.dataset.cat || 'all')
        : 'all';
      const q = searchEl ? searchEl.value.trim().toLowerCase() : '';

      let visible = 0;
      indexEl.querySelectorAll('.archive-card').forEach(card => {
        const cardCat  = card.closest('.archive-category')?.dataset.category || '';
        const catMatch = activeCat === 'all' || cardCat === activeCat;
        const txtMatch = !q || card.textContent.toLowerCase().includes(q);
        const show     = catMatch && txtMatch;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      // Hide empty category headers
      indexEl.querySelectorAll('.archive-category').forEach(cat => {
        const anyVisible = [...cat.querySelectorAll('.archive-card')]
          .some(c => c.style.display !== 'none');
        cat.style.display = anyVisible ? '' : 'none';
      });

      if (countEl) countEl.textContent = q ? (visible === 1 ? '1 result' : `${visible} results`) : '';
      if (emptyEl) emptyEl.style.display = (visible === 0 && q) ? 'block' : 'none';
    }

    if (searchEl) searchEl.addEventListener('input', filterDocs);

  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'block';
    errorEl.textContent     = 'Could not load archive. ' + err.message;
  }
}

/* ── DOCUMENT READER ────────────────────────────────────────── */
async function loadDocumentReader() {
  const loadingEl = document.getElementById('document-loading');
  const errorEl   = document.getElementById('document-error');
  const bodyEl    = document.getElementById('document-body');
  if (!bodyEl) return;

  const params = new URLSearchParams(window.location.search);
  const slug   = params.get('slug') || params.get('doc'); // 'doc' kept for old bookmarked links

  if (!slug) {
    errorEl.style.display   = 'block';
    errorEl.textContent     = 'No document specified.';
    loadingEl.style.display = 'none';
    return;
  }

  try {
    const { data: doc, error } = await supabase
      .from('archive_documents')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .single();

    if (error || !doc) throw error || new Error('Document not found.');

    const html = parseArchiveMarkdown(doc.body);

    if (doc.title) document.title = `${doc.title} — MCA Archive`;

    const hasFile = doc.file_url && doc.file_url.trim() !== '';

    bodyEl.innerHTML = `
      <div class="article-hero">
        <div class="article-hero-inner">
          <div class="article-meta-top">
            <span class="news-card-category">${esc(doc.category || 'Archive')}</span>
            <span class="news-card-date">${esc(doc.published_at ? formatArchiveDate(doc.published_at) : '')}</span>
          </div>
          <h1 class="article-title">${esc(doc.title || 'Untitled')}</h1>
          ${doc.summary ? `<p class="article-summary">${esc(doc.summary)}</p>` : ''}
          <div class="article-byline">Issued by <strong>${esc(doc.author_name || 'MCA')}</strong></div>
          ${renderSupporters(doc.supporters)}
        </div>
      </div>

      <div class="document-content content">
        <a class="article-back" href="archive.html">← Back to Archive</a>

        <div class="document-layout ${hasFile ? 'document-has-image' : ''}">

            ${hasFile ? (() => {
            const isPDF = isArchivePdf(doc.file_url);
            const assetName = doc.file_name || getArchiveAssetName(doc.file_url);
            return isPDF
              ? `<div class="document-scan">
                  <div class="document-scan-label">Original Document</div>
                  <div class="document-pdf-wrap">
                    <div class="document-pdf-icon">📄</div>
                    <div class="document-pdf-name">${esc(assetName)}</div>
                    <a href="${esc(safeUrl(doc.file_url))}" target="_blank" rel="noopener noreferrer" class="document-pdf-btn">View PDF →</a>
                  </div>
                </div>`
              : `<div class="document-scan">
                  <div class="document-scan-label">Original Document</div>
                  <img src="${esc(safeUrl(doc.file_url))}" alt="Original ${esc(doc.title || 'document')}">
                </div>`;
          })() : ''}

          <div class="document-text">
            <div class="document-text-label">${hasFile ? 'Explanation &amp; Translation' : 'Document'}</div>
            <div class="article-body">${html}</div>
          </div>

        </div>
      </div>`;

    loadingEl.style.display = 'none';
    bodyEl.style.display    = 'block';

  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'block';
    errorEl.textContent     = 'Could not load document. ' + err.message;
  }
}

/* ── ROUTER ─────────────────────────────────────────────────── */
function initArchive() {
  const page = window.location.pathname.split('/').pop();
  if (page === 'archive.html')   loadArchiveIndex();
  if (page === 'document.html')  loadDocumentReader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initArchive);
} else {
  initArchive();
}
