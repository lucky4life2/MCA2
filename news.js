/* news.js — MCA news engine
   ─────────────────────────────────────────────────────────────
   HOW TO PUBLISH AN ARTICLE
   1. Copy TEMPLATE.md from the news/ folder
   2. Rename it: YYYY-MM-DD-slug-here.md  (e.g. 2026-04-01-spring-update.md)
   3. Fill in the frontmatter (title, author, date, category, summary)
   4. Write your article below the --- divider
   5. Upload to the news/ folder on GitHub — it appears automatically.
      No need to edit this file at all.
   ─────────────────────────────────────────────────────────────── */

/* ── CONFIG ─────────────────────────────────────────────────── */
const GITHUB_USER = 'lucky4life2';
const GITHUB_REPO = 'MCA2';
const GITHUB_BRANCH = 'main';
const NEWS_FOLDER = 'news';

// GitHub API endpoint to list files in the news/ folder
const GITHUB_API = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${NEWS_FOLDER}?ref=${GITHUB_BRANCH}`;

// Raw content base URL for fetching article files
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

/* ── AUTO-DISCOVER ARTICLES ─────────────────────────────────── */
async function getArticleList() {
  const res = await fetch(GITHUB_API, {
    headers: { 'Accept': 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const files = await res.json();

  // Return objects with path and raw download URL from GitHub API
  return files
    .filter(f => f.name.endsWith('.md') && f.name !== 'TEMPLATE.md')
    .map(f => ({ path: `${NEWS_FOLDER}/${f.name}`, url: f.download_url }));
}

/* ── MARKDOWN PARSER ────────────────────────────────────────── */
function parseMarkdown(md) {
  // Custom shortcodes first (before standard Markdown)
  md = md
    // [image: filename.jpg | caption] or [image: filename.jpg]
    // Images should be uploaded to the news/images/ folder on GitHub
    .replace(/\[image:\s*([^\]|]+?)(?:\s*\|\s*([^\]]*))?\]/g, (_, src, caption) => {
      const img = `<figure class="article-image"><img src="news/images/${src.trim()}" alt="${(caption||'').trim()}">`;
      return caption
        ? img + `<figcaption>${caption.trim()}</figcaption></figure>`
        : img + '</figure>';
    })
    // [pullquote]text[/pullquote]
    .replace(/\[pullquote\]([\s\S]*?)\[\/pullquote\]/g,
      (_, text) => `<blockquote class="pull-quote">${text.trim()}</blockquote>`);

  // Standard Markdown
  return md
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr class="divider">')
    // Unordered lists
    .replace(/(^- .+$(\n^- .+$)*)/gm, match => {
      const items = match.split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
      return `<ul>${items}</ul>`;
    })
    // Ordered lists
    .replace(/(^\d+\. .+$(\n^\d+\. .+$)*)/gm, match => {
      const items = match.split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `<ol>${items}</ol>`;
    })
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Paragraphs — wrap non-tag lines
    .split('\n\n')
    .map(block => {
      block = block.trim();
      if (!block) return '';
      if (/^<(h[1-6]|ul|ol|hr|blockquote|figure)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, ' ')}</p>`;
    })
    .join('\n');
}

/* ── FRONTMATTER PARSER ─────────────────────────────────────── */
function parseFrontmatter(raw) {
  // Strip optional leading --- delimiter (e.g. ---\ntitle: ...)
  if (raw.startsWith('---\n')) raw = raw.slice(4);

  const divider = raw.indexOf('\n---\n');
  if (divider === -1) return { meta: {}, body: raw };

  const metaBlock = raw.slice(0, divider);
  const body      = raw.slice(divider + 5); // skip '\n---\n'
  const meta      = {};

  metaBlock.split('\n').forEach(line => {
    const colon = line.indexOf(':');
    if (colon === -1) return;
    const key   = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    meta[key]   = value;
  });

  return { meta, body };
}

/* ── FETCH HELPER ───────────────────────────────────────────── */
async function fetchArticle(pathOrObj) {
  const path = typeof pathOrObj === 'object' ? pathOrObj.path : pathOrObj;
  const url  = typeof pathOrObj === 'object' && pathOrObj.url
    ? pathOrObj.url
    : `${RAW_BASE}/${path}`;
  const res = await fetch(url + '?nocache=' + Date.now());
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.text();
}

/* ── DATE FORMATTER ─────────────────────────────────────────── */
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
}

/* ── NEWS INDEX ─────────────────────────────────────────────── */
async function loadIndex() {
  const loadingEl = document.getElementById('news-loading');
  const errorEl   = document.getElementById('news-error');
  const indexEl   = document.getElementById('news-index');
  if (!indexEl) return;

  try {
    const articlePaths = await getArticleList();
    const articles = await Promise.all(
      articlePaths.map(async item => {
        const raw = await fetchArticle(item);
        const { meta } = parseFrontmatter(raw);
        return { path: item.path, meta };
      })
    );

    // Sort newest first by date field, fall back to filename
    articles.sort((a, b) => {
      const da = (a.meta.date || '').trim() || a.path.split('/').pop() || '0000-00-00';
      const db = (b.meta.date || '').trim() || b.path.split('/').pop() || '0000-00-00';
      return (db < da ? -1 : db > da ? 1 : 0);
    });

    if (articles.length === 0) {
      loadingEl.textContent = 'No articles published yet.';
      return;
    }

    indexEl.innerHTML = articles.map(({ path, meta }) => {
      const slug = encodeURIComponent(path);
      return `
        <a class="news-card" href="article.html?article=${slug}">
          <div class="news-card-meta">
            <span class="news-card-category">${meta.category || 'News'}</span>
            <span class="news-card-date">${meta.date ? formatDate(meta.date) : ''}</span>
          </div>
          <div class="news-card-title">${meta.title || 'Untitled'}</div>
          <div class="news-card-summary">${meta.summary || ''}</div>
          <div class="news-card-byline">By ${meta.author || 'MCA Staff'}</div>
        </a>`;
    }).join('');

    loadingEl.style.display = 'none';
    indexEl.style.display   = 'block';

    // Wire up search bar
    const searchInput  = document.getElementById('news-search');
    const searchCount  = document.getElementById('news-search-count');
    const emptyEl      = document.getElementById('news-empty');
    const cards        = indexEl.querySelectorAll('.news-card');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        let visible = 0;

        cards.forEach(card => {
          // Search across title, summary, author, category
          const text = card.textContent.toLowerCase();
          const show = !q || text.includes(q);
          card.style.display = show ? '' : 'none';
          if (show) visible++;
        });

        // Update count label
        if (q && searchCount) {
          searchCount.textContent = visible === 1
            ? '1 result'
            : `${visible} results`;
        } else if (searchCount) {
          searchCount.textContent = '';
        }

        // Show empty state if nothing matches
        if (emptyEl) emptyEl.style.display = (visible === 0 && q) ? 'block' : 'none';
      });
    }

  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'block';
    errorEl.textContent     = 'Could not load articles. ' + err.message;
  }
}

/* ── ARTICLE READER ─────────────────────────────────────────── */
async function loadArticle() {
  const loadingEl = document.getElementById('article-loading');
  const errorEl   = document.getElementById('article-error');
  const bodyEl    = document.getElementById('article-body');
  if (!bodyEl) return;

  const params = new URLSearchParams(window.location.search);
  const path   = decodeURIComponent(params.get('article') || '');

  if (!path) {
    errorEl.style.display   = 'block';
    errorEl.textContent     = 'No article specified.';
    loadingEl.style.display = 'none';
    return;
  }

  try {
    const raw             = await fetchArticle(path);
    const { meta, body }  = parseFrontmatter(raw);
    const html            = parseMarkdown(body);

    // Update page title
    if (meta.title) document.title = `${meta.title} — MCA`;

    bodyEl.innerHTML = `
      <div class="article-hero">
        <div class="article-hero-inner">
          <div class="article-meta-top">
            <span class="news-card-category">${meta.category || 'News'}</span>
            <span class="news-card-date">${meta.date ? formatDate(meta.date) : ''}</span>
          </div>
          <h1 class="article-title">${meta.title || 'Untitled'}</h1>
          ${meta.summary ? `<p class="article-summary">${meta.summary}</p>` : ''}
          <div class="article-byline">By <strong>${meta.author || 'MCA Staff'}</strong></div>
        </div>
      </div>
      <div class="article-content content">
        <a class="article-back" href="news.html">← Back to News</a>
        <div class="article-body">${html}</div>
      </div>`;

    loadingEl.style.display = 'none';
    bodyEl.style.display    = 'block';

  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'block';
    errorEl.textContent     = 'Could not load article. ' + err.message;
  }
}

/* ── FEATURED BANNER (homepage) ─────────────────────────────── */
async function loadFeaturedBanner() {
  const banner = document.getElementById('featured-banner');
  if (!banner) return;

  try {
    // Fetch all articles and find Featured ones, then pick the most recent
    const articlePaths = await getArticleList();
    const all = await Promise.all(
      articlePaths.map(async item => {
        const raw = await fetchArticle(item);
        const { meta } = parseFrontmatter(raw);
        return { path: item.path, meta };
      })
    );

    const featured = all
      .filter(a => (a.meta.category || '').toLowerCase() === 'featured')
      .sort((a, b) => {
        const da = a.meta.date || '0000-00-00';
        const db = b.meta.date || '0000-00-00';
        return (db < da ? -1 : db > da ? 1 : 0); // newest first
      });

    if (featured.length === 0) return;

    const { path, meta } = featured[0]; // only the most recent
    const slug = encodeURIComponent(path);

    // Check if user already dismissed this featured article
    const dismissedKey = 'mca_dismissed_featured';
    const dismissed = localStorage.getItem(dismissedKey);
    if (dismissed === path) return; // same article, keep hidden

    // Build the banner as a wrapper div, with the link and dismiss button as siblings
    banner.innerHTML = `
      <div class="featured-banner-wrap">
        <a class="featured-banner" href="article.html?article=${slug}">
          <div class="featured-banner-inner">
            <div class="featured-banner-left">
              <span class="featured-tag">&#9733; Featured</span>
              <div class="featured-banner-title">${meta.title || 'Untitled'}</div>
              <div class="featured-banner-summary">${meta.summary || ''}</div>
            </div>
            <div class="featured-banner-right">
              <span class="featured-banner-meta">${meta.date ? formatDate(meta.date) : ''} · By ${meta.author || 'MCA Staff'}</span>
              <span class="featured-banner-cta">Read story →</span>
            </div>
          </div>
        </a>
        <button class="featured-banner-dismiss" aria-label="Dismiss">&#x2715;</button>
      </div>`;
    banner.style.display = 'block';

    // Wire up dismiss button — it's outside the <a> so no navigation conflict
    banner.querySelector('.featured-banner-dismiss').addEventListener('click', () => {
      localStorage.setItem(dismissedKey, path);
      banner.style.display = 'none';
    });

  } catch (err) {
    // Silently fail — banner just stays hidden
  }
}

/* ── ROUTER — run the right function based on current page ───── */
document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop();
  if (page === 'news.html' || page === '')  loadIndex();
  if (page === 'article.html')             loadArticle();
  if (page === 'index.html'  || page === '')  loadFeaturedBanner();
});
