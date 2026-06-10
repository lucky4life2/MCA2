// news.js — reads articles from Supabase news_articles table
import { supabase } from './supabase.js';

// ── Markdown → HTML (lightweight renderer) ───────────────────
function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    // Escape HTML entities first
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm,  '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,   '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,    '<h1>$1</h1>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/_(.+?)_/g,           '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px;">')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Unordered lists
  html = html.replace(/(^[-*] .+\n?)+/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /,'')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  // Ordered lists
  html = html.replace(/(^\d+\. .+\n?)+/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /,'')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });

  // Paragraphs — wrap double-newline separated blocks that aren't already HTML
  html = html.split(/\n{2,}/).map(block => {
    block = block.trim();
    if (!block) return '';
    if (/^<(h[1-6]|ul|ol|blockquote|hr|img)/.test(block)) return block;
    // Single newlines within a paragraph become <br>
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html;
}

// ── Format date ───────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Truncate for excerpt ──────────────────────────────────────
function truncate(str, len = 180) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len).replace(/\s\S*$/, '') + '…' : str;
}

// ════════════════════════════════════════════════════════════════
//  NEWS PAGE  (news.html)
// ════════════════════════════════════════════════════════════════

export async function initNewsPage() {
  const container = document.getElementById('news-container');
  const featured  = document.getElementById('news-featured');
  const grid      = document.getElementById('news-grid');
  const loading   = document.getElementById('news-loading');
  const empty     = document.getElementById('news-empty');

  if (!container) return;

  try {
    const { data: articles, error } = await supabase
      .from('news_articles')
      .select('id,title,slug,summary,body,category,author_name,published_at,image_url,status')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (loading) loading.style.display = 'none';

    if (error) throw error;
    if (!articles || articles.length === 0) {
      if (empty) empty.style.display = 'block';
      return;
    }

    const [top, ...rest] = articles;

    // Featured article
    if (featured) {
      featured.innerHTML = renderFeaturedCard(top);
      featured.style.display = '';
      featured.querySelector('.news-card-link')?.addEventListener('click', e => {
        e.preventDefault();
        openArticleModal(top);
      });
    }

    // Grid
    if (grid && rest.length) {
      grid.innerHTML = rest.map(a => renderGridCard(a)).join('');
      grid.querySelectorAll('.news-card-link').forEach((el, i) => {
        el.addEventListener('click', e => { e.preventDefault(); openArticleModal(rest[i]); });
      });
    }

  } catch(err) {
    if (loading) loading.style.display = 'none';
    if (container) container.innerHTML = `<p style="color:#c0392b;font-size:14px;text-align:center;">Failed to load news: ${err.message}</p>`;
  }
}

function renderFeaturedCard(a) {
  const excerpt = a.summary || truncate(a.body, 220);
  return `
    <article class="news-featured-card">
      ${a.image_url ? `<div class="news-featured-img" style="background-image:url('${a.image_url}');"></div>` : ''}
      <div class="news-featured-body">
        <div class="news-eyebrow">
          <span class="news-category">${a.category || 'General'}</span>
          <span class="news-date">${formatDate(a.published_at)}</span>
        </div>
        <h2 class="news-featured-title">${a.title}</h2>
        <p class="news-excerpt">${excerpt}</p>
        <a href="#" class="news-card-link news-read-more">Read Article →</a>
      </div>
    </article>`;
}

function renderGridCard(a) {
  const excerpt = a.summary || truncate(a.body, 140);
  return `
    <article class="news-card">
      ${a.image_url ? `<div class="news-card-img" style="background-image:url('${a.image_url}');"></div>` : '<div class="news-card-img news-card-img-placeholder"></div>'}
      <div class="news-card-body">
        <div class="news-eyebrow">
          <span class="news-category">${a.category || 'General'}</span>
          <span class="news-date">${formatDate(a.published_at)}</span>
        </div>
        <h3 class="news-card-title">${a.title}</h3>
        <p class="news-card-excerpt">${excerpt}</p>
        <a href="#" class="news-card-link news-read-more-sm">Read more →</a>
      </div>
    </article>`;
}

// ── Article modal ─────────────────────────────────────────────
let _modalOpen = false;

function openArticleModal(article) {
  let overlay = document.getElementById('news-article-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'news-article-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:500;background:rgba(10,15,30,.6);
      display:flex;align-items:flex-start;justify-content:center;
      padding:2rem 1rem;overflow-y:auto;`;
    document.body.appendChild(overlay);
  }

  const bodyHtml = renderMarkdown(article.body);
  overlay.innerHTML = `
    <div style="background:var(--white);border-radius:8px;border:1px solid var(--border);
      width:100%;max-width:720px;overflow:hidden;box-shadow:0 20px 60px rgba(10,15,30,.25);
      margin:auto;position:relative;">
      ${article.image_url ? `<div style="height:280px;background:url('${article.image_url}') center/cover no-repeat;"></div>` : ''}
      <button id="news-modal-close" style="position:absolute;top:16px;right:16px;
        background:rgba(10,15,30,.5);color:#fff;border:none;border-radius:50%;
        width:32px;height:32px;cursor:pointer;font-size:16px;line-height:1;
        display:flex;align-items:center;justify-content:center;">✕</button>
      <div style="padding:2.5rem;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:1.25rem;">
          <span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;
            color:var(--green);background:#e8f8e8;padding:3px 8px;border-radius:3px;">${article.category||'General'}</span>
          <span style="font-size:12px;color:var(--muted);">${formatDate(article.published_at)}</span>
          ${article.author_name ? `<span style="font-size:12px;color:var(--muted);">By ${article.author_name}</span>` : ''}
        </div>
        <h1 style="font-family:'Times New Roman',serif;font-size:clamp(1.5rem,4vw,2.25rem);
          color:var(--blue);font-weight:700;line-height:1.2;margin-bottom:1.5rem;">${article.title}</h1>
        <div class="news-article-body" style="font-size:15px;line-height:1.8;color:var(--black);">
          ${bodyHtml}
        </div>
      </div>
    </div>`;

  overlay.style.display = 'flex';
  _modalOpen = true;

  document.getElementById('news-modal-close').addEventListener('click', closeArticleModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeArticleModal(); });
  document.addEventListener('keydown', handleEsc);
}

function closeArticleModal() {
  const overlay = document.getElementById('news-article-overlay');
  if (overlay) overlay.style.display = 'none';
  _modalOpen = false;
  document.removeEventListener('keydown', handleEsc);
}

function handleEsc(e) { if (e.key === 'Escape') closeArticleModal(); }

// ════════════════════════════════════════════════════════════════
//  SINGLE ARTICLE PAGE  (?slug=...)
// ════════════════════════════════════════════════════════════════

export async function initSingleArticlePage() {
  const container = document.getElementById('single-article-container');
  if (!container) return;

  const slug = new URLSearchParams(window.location.search).get('slug');
  if (!slug) { container.innerHTML = '<p style="color:#c0392b;">No article specified.</p>'; return; }

  const { data: article, error } = await supabase
    .from('news_articles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single();

  if (error || !article) {
    container.innerHTML = '<p style="color:#c0392b;">Article not found.</p>';
    return;
  }

  document.title = `${article.title} — MCA News`;
  container.innerHTML = `
    ${article.image_url ? `<div style="height:320px;background:url('${article.image_url}') center/cover no-repeat;border-radius:6px;margin-bottom:2rem;"></div>` : ''}
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:1rem;flex-wrap:wrap;">
      <span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--green);">${article.category||'General'}</span>
      <span style="font-size:13px;color:var(--muted);">${formatDate(article.published_at)}</span>
      ${article.author_name ? `<span style="font-size:13px;color:var(--muted);">By ${article.author_name}</span>` : ''}
    </div>
    <h1 style="font-family:'Times New Roman',serif;font-size:clamp(1.75rem,5vw,2.75rem);color:var(--blue);font-weight:700;line-height:1.15;margin-bottom:1.5rem;">${article.title}</h1>
    ${article.summary ? `<p style="font-size:1.1rem;color:var(--muted);line-height:1.7;margin-bottom:2rem;border-left:3px solid var(--green);padding-left:1rem;">${article.summary}</p>` : ''}
    <div class="news-article-body" style="font-size:15px;line-height:1.85;color:var(--black);">
      ${renderMarkdown(article.body)}
    </div>`;
}
