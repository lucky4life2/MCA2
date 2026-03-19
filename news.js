/* news.js — MCA Gazette news engine
   ─────────────────────────────────────────────────────────────
   HOW TO PUBLISH AN ARTICLE
   1. Copy TEMPLATE.md from the news/ folder
   2. Rename it: YYYY-MM-DD-slug-here.md  (e.g. 2026-04-01-spring-update.md)
   3. Fill in the frontmatter (title, author, date, category, summary)
   4. Write your article below the --- divider
   5. Commit and push — it's live within a minute

   ARTICLE LIST
   Add every published filename to ARTICLES below (newest first).
   Remove TEMPLATE.md — it's just for reference, never list it here.
   ─────────────────────────────────────────────────────────────── */

const ARTICLES = [
  'news/2026-03-19-global-dawn-launch.md',
  // Add new articles above this line, newest first
];

/* ── CONFIG ─────────────────────────────────────────────────── */
// If hosting on GitHub Pages, set this to your raw content base URL.
// Example: 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main'
// Leave as '' when running locally or if files are served from the same origin.
const RAW_BASE = '';

/* ── MARKDOWN PARSER ────────────────────────────────────────── */
function parseMarkdown(md) {
  // Custom shortcodes first (before standard Markdown)
  md = md
    // [image: filename.jpg | caption] or [image: filename.jpg]
    .replace(/\[image:\s*([^\]|]+?)(?:\s*\|\s*([^\]]*))?\]/g, (_, src, caption) => {
      const img = `<figure class="article-image"><img src="news/${src.trim()}" alt="${(caption||'').trim()}">`;
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
async function fetchArticle(path) {
  const url = RAW_BASE ? `${RAW_BASE}/${path}` : path;
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
    const articles = await Promise.all(
      ARTICLES.map(async path => {
        const raw = await fetchArticle(path);
        const { meta } = parseFrontmatter(raw);
        return { path, meta };
      })
    );

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

/* ── ROUTER — run the right function based on current page ───── */
document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop();
  if (page === 'news.html' || page === '')  loadIndex();
  if (page === 'article.html')             loadArticle();
});
