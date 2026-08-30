// news.js — ES module, loaded via <script type="module" src="news.js">
import { supabase } from './supabase.js';

// ── Escaping ─────────────────────────────────────────────────
// Article fields are author-supplied and land in innerHTML, so everything
// interpolated below has to be escaped first.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Only http(s) and relative URLs may reach an href/src, so a javascript:,
// data: or vbscript: payload smuggled in through a markdown link, a markdown
// image, or an article's image_url can't execute.
function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^https?:\/\//i.test(u) ? u : '';
  return u;
}

// ── Markdown → HTML ───────────────────────────────────────────
function renderMarkdown(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm,  '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,   '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,    '<h1>$1</h1>')
    .replace(/^---+$/gm, '<hr>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/_(.+?)_/g,           '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Images must be matched before links: `![alt](url)` also matches the
    // link pattern, so running links first turned every markdown image into
    // a stray "!" followed by a link and no image ever rendered.
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
      const u = safeUrl(url);
      return u ? `<img src="${u}" alt="${alt}" style="max-width:100%;border-radius:4px;">` : '';
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      const u = safeUrl(url);
      return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    })
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/(^[-*] .+\n?)+/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /,'')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  html = html.replace(/(^\d+\. .+\n?)+/gm, match => {
    const items = match.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /,'')}</li>`).join('');
    return `<ol>${items}</ol>`;
  });
  html = html.split(/\n{2,}/).map(block => {
    block = block.trim();
    if (!block) return '';
    if (/^<(h[1-6]|ul|ol|blockquote|hr|img)/.test(block)) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
}

function truncate(str, len = 180) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len).replace(/\s\S*$/, '') + '…' : str;
}

// ── Featured banner ───────────────────────────────────────────
function renderFeaturedBanner(article) {
  const storageKey = `mca-featured-dismissed-${article.id}`;
  if (localStorage.getItem(storageKey)) return;

  const inner = `
    <div class="featured-banner-inner">
      <div class="featured-banner-left">
        <span class="featured-tag">Featured</span>
        <span class="featured-banner-title" style="white-space:normal;overflow:visible;text-overflow:unset;">${esc(article.title)}</span>
      </div>
      <div class="featured-banner-right">
        <span class="featured-banner-meta">${formatDate(article.published_at)}</span>
        <span class="featured-banner-cta">Read more →</span>
      </div>
      <button id="featured-banner-close" type="button" title="Dismiss" aria-label="Dismiss featured article banner" style="
        margin-left:16px;background:rgba(255,255,255,.15);border:none;color:#fff;
        border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:14px;
        display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
    </div>`;

  // Reuse existing placeholder (index.html) or create+insert before .page-wrap (news.html)
  let banner = document.getElementById('featured-banner');
  if (banner) {
    banner.innerHTML = inner;
    banner.className = 'featured-banner';
    banner.style.display = '';
    banner.style.cursor = 'pointer';
  } else {
    banner = document.createElement('div');
    banner.id = 'featured-banner';
    banner.className = 'featured-banner';
    banner.style.cursor = 'pointer';
    banner.innerHTML = inner;
    const pageWrap = document.querySelector('.page-wrap');
    if (pageWrap) pageWrap.insertBefore(banner, pageWrap.firstChild);
    else document.body.insertBefore(banner, document.body.firstElementChild);
  }

  // The banner is a div, not a link, so keyboard users had no way to reach or
  // activate it. Expose it as a button and honour Enter/Space.
  banner.setAttribute('role', 'button');
  banner.setAttribute('tabindex', '0');
  banner.setAttribute('aria-label', `Featured article: ${article.title || ''}`);

  const openFeatured = () => {
    localStorage.setItem(storageKey, '1');
    if (article.slug) location.href = `article.html?slug=${encodeURIComponent(article.slug)}`;
    else openArticleModal(article);
  };

  banner.addEventListener('click', e => {
    if (e.target.closest('#featured-banner-close')) return;
    openFeatured();
  });
  banner.addEventListener('keydown', e => {
    if (e.target.closest('#featured-banner-close')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFeatured(); }
  });
  document.getElementById('featured-banner-close').addEventListener('click', e => {
    e.stopPropagation();
    localStorage.setItem(storageKey, '1');
    banner.style.display = 'none';
  });
}

// ── Card renderer ─────────────────────────────────────────────
function renderCard(a) {
  const rawExcerpt = a.summary || (a.body || '').replace(/^#+\s+.+$/gm,'').replace(/[*_`#>\[\]]/g,'').replace(/\s+/g,' ').trim();
  const excerpt = truncate(rawExcerpt, 160);
  const cat = a.category || 'General';
  const href = a.slug ? `article.html?slug=${encodeURIComponent(a.slug)}` : '#';
  return `
    <a href="${esc(href)}" class="news-card" data-id="${esc(a.id)}" style="cursor:pointer;display:block;text-decoration:none;color:inherit;">
      <div class="news-card-meta">
        <span class="news-card-category">${esc(cat)}</span>
        <span class="news-card-date">${esc(formatDate(a.published_at))}</span>
      </div>
      <div class="news-card-title">${esc(a.title)}</div>
      ${excerpt ? `<div class="news-card-summary">${esc(excerpt)}</div>` : ''}
      ${a.author_name ? `<div class="news-card-byline">By ${esc(a.author_name)}</div>` : ''}
    </a>`;
}

// ── Share helper ──────────────────────────────────────────────
async function shareArticle(article) {
  const url = `${location.origin}/article.html?slug=${encodeURIComponent(article.slug)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: article.title, text: article.summary || article.title, url });
      return;
    } catch (e) { /* fall through to clipboard */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('news-modal-share');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
      btn.style.background = '#22c55e'; btn.style.color = '#fff'; btn.style.borderColor = '#22c55e';
      setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }, 2000);
    }
  } catch {
    prompt('Copy this link:', url);
  }
}

// ── Article modal ─────────────────────────────────────────────
function openArticleModal(article) {
  let overlay = document.getElementById('news-article-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'news-article-overlay';
    overlay.style.cssText = `position:fixed;inset:0;z-index:500;background:rgba(10,15,30,.6);
      display:flex;align-items:flex-start;justify-content:center;
      padding:2rem 1rem;overflow-y:auto;`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }

  const cat = article.category || 'General';
  overlay.innerHTML = `
    <div style="background:var(--white);border-radius:8px;border:1px solid var(--border);
      width:100%;max-width:720px;overflow:hidden;box-shadow:0 20px 60px rgba(10,15,30,.25);
      margin:auto;position:relative;">
      ${safeUrl(article.image_url) ? `<div style="height:280px;background:url('${encodeURI(safeUrl(article.image_url)).replace(/['"\\]/g, encodeURIComponent)}') center/cover no-repeat;"></div>` : ''}
      <button id="news-modal-close" style="position:absolute;top:16px;right:16px;
        background:rgba(10,15,30,.5);color:#fff;border:none;border-radius:50%;
        width:32px;height:32px;cursor:pointer;font-size:16px;
        display:flex;align-items:center;justify-content:center;">✕</button>
      <div style="padding:2.5rem;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:1.25rem;flex-wrap:wrap;">
          <span class="news-card-category">${esc(cat)}</span>
          <span style="font-size:12px;color:var(--muted);">${esc(formatDate(article.published_at))}</span>
          ${article.author_name ? `<span style="font-size:12px;color:var(--muted);">By ${esc(article.author_name)}</span>` : ''}
        </div>
        <h1 style="font-family:'Times New Roman',serif;font-size:clamp(1.5rem,4vw,2.25rem);
          color:var(--blue);font-weight:700;line-height:1.2;margin-bottom:1.5rem;">${esc(article.title)}</h1>
        <div class="news-article-body" style="font-size:15px;line-height:1.8;color:var(--black);">
          ${renderMarkdown(article.body)}
        </div>
        ${article.slug ? `
        <div style="margin-top:2rem;padding-top:1.25rem;border-top:1px solid var(--border);display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;">
          <button id="news-modal-share" style="
            display:inline-flex;align-items:center;gap:7px;
            padding:0.45rem 1rem;border-radius:6px;border:1px solid var(--border);
            background:var(--white);color:var(--black);font-size:13px;font-weight:500;
            cursor:pointer;transition:background .15s;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Share
          </button>
          <a href="article.html?slug=${encodeURIComponent(article.slug)}" style="font-size:13px;color:var(--muted);text-decoration:none;">Open full page →</a>
        </div>` : ''}
      </div>
    </div>`;

  overlay.style.display = 'flex';
  document.getElementById('news-modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  if (article.slug) {
    document.getElementById('news-modal-share')?.addEventListener('click', () => shareArticle(article));
  }
  document.addEventListener('keydown', handleEsc);
}

function closeModal() {
  const overlay = document.getElementById('news-article-overlay');
  if (overlay) overlay.style.display = 'none';
  document.removeEventListener('keydown', handleEsc);
}
function handleEsc(e) { if (e.key === 'Escape') closeModal(); }

// ── Search ────────────────────────────────────────────────────
let _allArticles = [];

function applySearch(query) {
  const q = query.trim().toLowerCase();
  const indexEl  = document.getElementById('news-index');
  const emptyEl  = document.getElementById('news-empty');
  const countEl  = document.getElementById('news-search-count');
  if (!indexEl) return;

  const filtered = q
    ? _allArticles.filter(a =>
        (a.title||'').toLowerCase().includes(q) ||
        (a.summary||'').toLowerCase().includes(q) ||
        (a.author_name||'').toLowerCase().includes(q) ||
        (a.category||'').toLowerCase().includes(q))
    : _allArticles;

  if (countEl) countEl.textContent = q ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}` : '';

  if (filtered.length === 0) {
    indexEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
    indexEl.innerHTML = filtered.map(renderCard).join('');
  }
}

// ── Init ──────────────────────────────────────────────────────
const indexEl   = document.getElementById('news-index');
const loadingEl = document.getElementById('news-loading');
const errorEl   = document.getElementById('news-error');
const searchEl  = document.getElementById('news-search');

// Always fetch articles — needed for featured banner on any page, and for the news index
try {
  const { data: articles, error } = await supabase
    .from('news_articles')
    .select('id,title,slug,summary,body,category,author_name,published_at,image_url,status')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (loadingEl) loadingEl.style.display = 'none';
  if (error) throw error;

  if (articles && articles.length > 0) {
    // Featured banner — shows on every page except admin, news, account, help,
    // tasks, news-publish, archive-publish, and shop
    const BANNER_EXCLUDED_PAGES = [
      'admin.html', 'news.html', 'account.html', 'help.html',
      'tasks.html', 'news-publish.html', 'archive-publish.html', 'shop.html'
    ];
    const currentPage = location.pathname.split('/').pop() || 'index.html';
    const bannerAllowed = !BANNER_EXCLUDED_PAGES.includes(currentPage);

    // Featured is a category value like any other — the fix is just that
    // the badge below now shows it as-is instead of masking it as "General".
    const featuredArticle = articles.find(a => a.category?.toLowerCase() === 'featured');
    if (featuredArticle && bannerAllowed) renderFeaturedBanner(featuredArticle);

    // News index — only on news.html
    if (indexEl) {
      _allArticles = articles;
      indexEl.style.display = '';
      applySearch('');
      if (searchEl) searchEl.addEventListener('input', e => applySearch(e.target.value));
    }
  } else if (indexEl) {
    const emptyEl = document.getElementById('news-empty');
    if (emptyEl) emptyEl.style.display = 'block';
  }
} catch (err) {
  if (loadingEl) loadingEl.style.display = 'none';
  if (errorEl) { errorEl.textContent = `Failed to load news: ${err.message}`; errorEl.style.display = 'block'; }
}
