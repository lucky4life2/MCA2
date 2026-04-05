/* archive.js — MCA Document Archive engine
   ─────────────────────────────────────────────────────────────
   HOW TO ADD A DOCUMENT
   1. Copy TEMPLATE.md from the archive/ folder
   2. Rename it: YYYY-MM-DD-short-title.md
   3. Fill in the frontmatter (title, category, date, author, summary, image)
   4. Write your explanation below the --- divider
   5. Upload the document scan/photo to archive/images/ on GitHub
   6. Upload the .md file to archive/ on GitHub — appears automatically

   CATEGORIES
   Use any category name you like. Documents will be grouped by category
   on the archive index page automatically.
   Examples: MCA Law, Rotavvara, Cloudridge, Treaties
   ─────────────────────────────────────────────────────────────── */

/* ── CONFIG ─────────────────────────────────────────────────── */
const ARCH_GITHUB_USER   = 'lucky4life2';
const ARCH_GITHUB_REPO   = 'MCA2';
const ARCH_GITHUB_BRANCH = 'main';
const ARCH_FOLDER        = 'archive';

const ARCH_API  = `https://api.github.com/repos/${ARCH_GITHUB_USER}/${ARCH_GITHUB_REPO}/contents/${ARCH_FOLDER}?ref=${ARCH_GITHUB_BRANCH}`;
const ARCH_RAW  = `https://raw.githubusercontent.com/${ARCH_GITHUB_USER}/${ARCH_GITHUB_REPO}/${ARCH_GITHUB_BRANCH}`;

/* ── AUTO-DISCOVER DOCUMENTS ────────────────────────────────── */
async function getDocumentList() {
  const res = await fetch(ARCH_API, {
    headers: { 'Accept': 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const files = await res.json();

  return files
    .filter(f => f.name.endsWith('.md') && f.name !== 'TEMPLATE.md')
    .map(f => ({ path: `${ARCH_FOLDER}/${f.name}`, url: f.download_url }));
}

/* ── FETCH HELPER ───────────────────────────────────────────── */
async function fetchDocument(item) {
  const url = item.url || `${ARCH_RAW}/${item.path}`;
  const res = await fetch(url + '?nocache=' + Date.now());
  if (!res.ok) throw new Error(`Could not load ${item.path} (${res.status})`);
  return res.text();
}

/* ── FRONTMATTER PARSER ─────────────────────────────────────── */
function parseArchiveFrontmatter(raw) {
  // Strip optional leading --- delimiter (e.g. ---\ntitle: ...)
  if (raw.startsWith('---\n')) raw = raw.slice(4);

  const divider = raw.indexOf('\n---\n');
  if (divider === -1) return { meta: {}, body: raw };
  const metaBlock = raw.slice(0, divider);
  const body      = raw.slice(divider + 5);
  const meta      = {};
  metaBlock.split('\n').forEach(line => {
    const colon = line.indexOf(':');
    if (colon === -1) return;
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  });
  return { meta, body };
}

/* ── MARKDOWN PARSER (reuse same logic as news) ─────────────── */
function parseArchiveMarkdown(md) {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/^---$/gm, '<hr class="divider">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
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
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
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
    const docPaths = await getDocumentList();
    const docs = await Promise.all(
      docPaths.map(async item => {
        const raw = await fetchDocument(item);
        const { meta } = parseArchiveFrontmatter(raw);
        return { path: item.path, meta };
      })
    );

    // Sort by date descending
    docs.sort((a, b) => {
      const da = a.meta.date || '0000-00-00';
      const db = b.meta.date || '0000-00-00';
      return db.localeCompare(da);
    });

    if (docs.length === 0) {
      loadingEl.textContent = 'No documents in the archive yet.';
      return;
    }

    // Get unique categories
    const categories = [...new Set(docs.map(d => d.meta.category || 'Uncategorized'))];

    // Build category filter buttons
    if (filterEl) {
      filterEl.innerHTML = `
        <button class="archive-filter-btn active" data-cat="all">All</button>
        ${categories.map(cat => `<button class="archive-filter-btn" data-cat="${cat}">${cat}</button>`).join('')}
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
      const cat = doc.meta.category || 'Uncategorized';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(doc);
    });

    indexEl.innerHTML = Object.entries(grouped).map(([cat, catDocs]) => `
      <div class="archive-category" data-category="${cat}">
        <div class="archive-category-header">${cat}</div>
        <div class="archive-category-docs">
          ${catDocs.map(({ path, meta }) => {
            const slug = encodeURIComponent(path);
            const isPDF = meta.image && meta.image.toLowerCase().endsWith('.pdf');
            const thumb = !meta.image
              ? `<div class="archive-card-thumb archive-card-thumb-placeholder">📄</div>`
              : isPDF
              ? `<div class="archive-card-thumb archive-card-thumb-placeholder archive-card-thumb-pdf">PDF</div>`
              : `<img src="archive/images/${meta.image}" alt="${meta.title || ''}" class="archive-card-thumb">`;
            return `
              <a class="archive-card" href="document.html?doc=${slug}">
                ${thumb}
                <div class="archive-card-body">
                  <div class="archive-card-category">${cat}</div>
                  <div class="archive-card-title">${meta.title || 'Untitled'}</div>
                  <div class="archive-card-summary">${meta.summary || ''}</div>
                  <div class="archive-card-meta">${meta.date ? formatArchiveDate(meta.date) : ''} · ${meta.author || 'MCA'}</div>
                </div>
              </a>`;
          }).join('')}
        </div>
      </div>`
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
  const path   = decodeURIComponent(params.get('doc') || '');

  if (!path) {
    errorEl.style.display   = 'block';
    errorEl.textContent     = 'No document specified.';
    loadingEl.style.display = 'none';
    return;
  }

  try {
    const raw            = await fetchDocument({ path, url: null });
    const { meta, body } = parseArchiveFrontmatter(raw);
    const html           = parseArchiveMarkdown(body);

    if (meta.title) document.title = `${meta.title} — MCA Archive`;

    const hasImage = meta.image && meta.image.trim() !== '';

    bodyEl.innerHTML = `
      <div class="article-hero">
        <div class="article-hero-inner">
          <div class="article-meta-top">
            <span class="news-card-category">${meta.category || 'Archive'}</span>
            <span class="news-card-date">${meta.date ? formatArchiveDate(meta.date) : ''}</span>
          </div>
          <h1 class="article-title">${meta.title || 'Untitled'}</h1>
          ${meta.summary ? `<p class="article-summary">${meta.summary}</p>` : ''}
          <div class="article-byline">Issued by <strong>${meta.author || 'MCA'}</strong></div>
        </div>
      </div>

      <div class="document-content content">
        <a class="article-back" href="archive.html">← Back to Archive</a>

        <div class="document-layout ${hasImage ? 'document-has-image' : ''}">

            ${hasImage ? (() => {
            const isPDF = meta.image.toLowerCase().endsWith('.pdf');
            return isPDF
              ? `<div class="document-scan">
                  <div class="document-scan-label">Original Document</div>
                  <div class="document-pdf-wrap">
                    <div class="document-pdf-icon">📄</div>
                    <div class="document-pdf-name">${meta.image}</div>
                    <a href="archive/images/${meta.image}" target="_blank" rel="noopener" class="document-pdf-btn">View PDF →</a>
                  </div>
                </div>`
              : `<div class="document-scan">
                  <div class="document-scan-label">Original Document</div>
                  <img src="archive/images/${meta.image}" alt="Original ${meta.title || 'document'}">
                </div>`;
          })() : ''}

          <div class="document-text">
            <div class="document-text-label">${hasImage ? 'Explanation &amp; Translation' : 'Document'}</div>
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
document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop();
  if (page === 'archive.html')   loadArchiveIndex();
  if (page === 'document.html')  loadDocumentReader();
});
