import { supabase } from './supabase.js';

// Site-wide search: a static index of the site's real public pages
// (titles and descriptions taken from each page's own <title> and meta
// description — nothing invented), plus published news articles and
// archive documents fetched live. If the live queries fail, the page
// index still works and a note says so.

const PAGES = [
  { title: 'Minecraft Club of America', desc: 'A leadership and learning organization that uses Minecraft to explore government, economics, and civics.', url: 'index.html' },
  { title: 'Server — Minecraft Club of America', desc: 'Information about the MCA Minecraft server.', url: 'server.html' },
  { title: 'Leadership — Minecraft Club of America', desc: 'Meet the leadership of the Minecraft Club of America.', url: 'leadership.html' },
  { title: 'History — Minecraft Club of America', desc: 'The history of the Minecraft Club of America.', url: 'history.html' },
  { title: 'Nations — Minecraft Club of America', desc: 'The nations of the MCA world.', url: 'nations.html' },
  { title: 'News — Minecraft Club of America', desc: 'News and announcements from the Minecraft Club of America.', url: 'news.html' },
  { title: 'Archive — Minecraft Club of America', desc: 'Browse the MCA document archive.', url: 'archive.html' },
  { title: 'Help & Support — Minecraft Club of America', desc: 'Help and support for the Minecraft Club of America website and server.', url: 'help.html' },
  { title: 'Congress — Minecraft Club of America', desc: 'The Congressional Portal for the Minecraft Club of America.', url: 'congress.html' },
  { title: 'World Court — Minecraft Club of America', desc: 'The World Court judicial portal for the Minecraft Club of America.', url: 'court.html' },
  { title: 'Economy — Minecraft Club of America', desc: 'Manage your MCA Marks wallets, send Marks, and review your transaction history.', url: 'economy.html' },
  { title: 'Stock Exchange — Minecraft Club of America', desc: 'Discover MCA companies, review their business, invest in offerings, and trade shares for Marks.', url: 'stocks.html' },
  { title: 'Shop — Minecraft Club of America', desc: 'The MCA Shop: membership and merchandise.', url: 'shop.html' },
  { title: 'Article — Minecraft Club of America', desc: 'Read news articles and announcements from the Minecraft Club of America.', url: 'article.html' },
  { title: 'Document — Minecraft Club of America', desc: 'View documents from the MCA archive.', url: 'document.html' },
  { title: 'Privacy Policy — Minecraft Club of America', desc: 'Privacy Policy for Minecraft Club of America — how we collect, use, and protect your information.', url: 'privacy.html' },
  { title: 'Refund Policy — Minecraft Club of America', desc: 'Refund and cancellation policy for Minecraft Club of America memberships and merchandise.', url: 'refund.html' },
  { title: 'Terms of Service — Minecraft Club of America', desc: 'Terms of Service for Minecraft Club of America.', url: 'terms.html' },
  { title: 'Accessibility Statement — Minecraft Club of America', desc: 'Accessibility Statement for Minecraft Club of America.', url: 'accessibility.html' },
  { title: 'Cookie Policy — Minecraft Club of America', desc: 'Cookie Policy for Minecraft Club of America — what browser storage we use and why.', url: 'cookies.html' },
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const inputEl = document.getElementById('site-search');
const statusEl = document.getElementById('search-status');
const loadingEl = document.getElementById('search-loading');
const resultsEl = document.getElementById('search-results');
const emptyEl = document.getElementById('search-empty');
const noteEl = document.getElementById('search-note');

let liveEntries = [];
let liveFailed = false;

function matches(entry, words) {
  const hay = `${entry.title} ${entry.desc}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

function render(query) {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  let entries;
  if (!words.length) {
    entries = PAGES.map(p => ({ ...p, kind: 'Page' }));
  } else {
    entries = [
      ...PAGES.filter(p => matches(p, words)).map(p => ({ ...p, kind: 'Page' })),
      ...liveEntries.filter(e => matches(e, words)),
    ];
  }
  const capped = entries.slice(0, 100);
  if (!capped.length) {
    resultsEl.style.display = 'none';
    emptyEl.style.display = 'block';
    statusEl.textContent = q ? `No results for “${query.trim()}”.` : '';
  } else {
    emptyEl.style.display = 'none';
    resultsEl.style.display = 'flex';
    resultsEl.innerHTML = capped.map(e => `
      <li class="search-result">
        <span class="search-result-kind">${esc(e.kind)}</span><br>
        <a href="${esc(e.url)}">${esc(e.title)}</a>
        ${e.desc ? `<p class="search-result-desc">${esc(e.desc)}</p>` : ''}
      </li>`).join('');
    statusEl.textContent = q
      ? `${capped.length} result${capped.length === 1 ? '' : 's'} for “${query.trim()}”.`
      : `${capped.length} pages. Type to search articles and documents too.`;
    if (entries.length > capped.length) {
      statusEl.textContent += ` Showing the first ${capped.length}.`;
    }
  }
  noteEl.style.display = liveFailed ? 'block' : 'none';
  if (liveFailed) noteEl.textContent = 'Articles and documents could not be loaded; showing pages only.';
}

async function loadLive() {
  try {
    const [arts, docs] = await Promise.all([
      supabase.from('news_articles').select('id,title,slug,summary').eq('status', 'published').order('published_at', { ascending: false }).limit(200),
      supabase.from('archive_documents').select('id,title,slug,summary').eq('status', 'published').order('published_at', { ascending: false }).limit(200),
    ]);
    if (arts.error) throw arts.error;
    if (docs.error) throw docs.error;
    liveEntries = [
      ...(arts.data || []).map(a => ({ kind: 'Article', title: a.title, desc: a.summary || '', url: `article.html?slug=${encodeURIComponent(a.slug)}` })),
      ...(docs.data || []).map(d => ({ kind: 'Document', title: d.title, desc: d.summary || '', url: `document.html?slug=${encodeURIComponent(d.slug)}` })),
    ];
  } catch (err) {
    liveFailed = true;
  }
  loadingEl.style.display = 'none';
  render(inputEl.value);
}

inputEl.addEventListener('input', () => render(inputEl.value));

const params = new URLSearchParams(location.search);
const initial = params.get('q');
if (initial) inputEl.value = initial;
render(inputEl.value);
loadLive();
