import { supabase } from './supabase.js';

// ── Delegated actions (strict CSP) ────────────────────────────────
// Inline handler attributes are blocked by the strict script-src policy,
// so every button/row above is wired through these listeners instead.
// data-action names the action; data-id / data-index / data-label carry
// the values the old inline handler used to inline. Handlers run at click
// time, after this module has fully evaluated, so window-assigned page
// functions are available here exactly as they were to inline handlers.

const _ACTION_HANDLERS = {
  'toggle-faq': (el, e) => window.toggleFaq(el.dataset.id),
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


function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// FAQ answers are author-supplied markdown. Without a scheme check a link like
// [x](javascript:...) would render as a live javascript: href.
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

// Very small markdown-ish renderer for answers (bold/italic/links/paragraphs only —
// FAQ answers are meant to be short, so we keep this intentionally simple).
function renderAnswer(md) {
  if (!md) return '';
  let html = escapeHtml(md)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      // The URL arrives already HTML-escaped, so decode it before the scheme
      // check, then re-escape whatever survives.
      const raw = String(url).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      const u = safeUrl(raw);
      return u ? `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    });
  return html.split(/\n{2,}/).map(p => p.trim() ? `<p>${p.replace(/\n/g,'<br>')}</p>` : '').join('');
}

let _faqs = [];
let _filter = { search: '', category: '' };

async function loadFaqs() {
  const loadingEl = document.getElementById('faq-loading');
  const errorEl   = document.getElementById('faq-error');
  try {
    const { data, error } = await supabase
      .from('faqs')
      .select('id,question,answer,category,sort_order')
      .eq('status', 'published')
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    _faqs = data || [];

    // Populate category filter
    const categories = [...new Set(_faqs.map(f => f.category || 'General'))];
    const catSelect = document.getElementById('faq-category-select');
    categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat; opt.textContent = cat;
      catSelect.appendChild(opt);
    });

    loadingEl.style.display = 'none';
    renderFaqs();
  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorEl.textContent = 'Could not load the FAQ right now. ' + err.message;
  }
}

function renderFaqs() {
  const listEl  = document.getElementById('faq-list');
  const emptyEl = document.getElementById('faq-empty');
  const q = _filter.search.trim().toLowerCase();

  const filtered = _faqs.filter(f => {
    if (_filter.category && (f.category || 'General') !== _filter.category) return false;
    if (q && !(f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q))) return false;
    return true;
  });

  if (!filtered.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  // Group by category, preserving first-seen order
  const grouped = {};
  const order = [];
  filtered.forEach(f => {
    const cat = f.category || 'General';
    if (!grouped[cat]) { grouped[cat] = []; order.push(cat); }
    grouped[cat].push(f);
  });

  listEl.innerHTML = order.map(cat => `
    <div class="faq-group-title">${escapeHtml(cat)}</div>
    ${grouped[cat].map(f => `
      <div class="faq-item" data-id="${escapeHtml(f.id)}">
        <button class="faq-question" type="button" aria-expanded="false" data-action="toggle-faq" data-id="${escapeHtml(f.id)}">
          <span>${escapeHtml(f.question)}</span>
          <svg class="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="faq-answer">${renderAnswer(f.answer)}</div>
      </div>`).join('')}
  `).join('');
}

window.toggleFaq = (id) => {
  const item = document.querySelector(`.faq-item[data-id="${id}"]`);
  if (!item) return;
  const answer = item.querySelector('.faq-answer');
  const isOpen = item.classList.contains('open');
  const trigger = item.querySelector('.faq-question');
  if (isOpen) {
    answer.style.maxHeight = null;
    item.classList.remove('open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  } else {
    item.classList.add('open');
    answer.style.maxHeight = answer.scrollHeight + 'px';
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
  }
};

document.getElementById('faq-search').addEventListener('input', function() {
  _filter.search = this.value;
  renderFaqs();
});
document.getElementById('faq-category-select').addEventListener('change', function() {
  _filter.category = this.value;
  renderFaqs();
});

loadFaqs();

// ── Contact Us button — copies the support email to clipboard ──
// Uses the same site-config-driven email as the footer, falling back to
// the hardcoded default immediately so the button works before config loads.
function getEmail() {
  return window.EMAIL_US || 'minecraftclubofamerica@gmail.com';
}
function copyEmail(e, el) {
  e.preventDefault();
  navigator.clipboard.writeText(getEmail()).then(() => {
    const original = el.dataset.originalText ?? (el.dataset.originalText = el.innerHTML);
    el.textContent = 'Copied!';
    setTimeout(() => { el.innerHTML = original; }, 1500);
  });
}
function wireContactButtons() {
  const btn = document.getElementById('help-contact-btn');
  const inline = document.getElementById('help-contact-inline-link');
  if (btn) btn.addEventListener('click', (e) => copyEmail(e, btn));
  if (inline) inline.addEventListener('click', (e) => copyEmail(e, inline));
}
wireContactButtons();
if (window._configReady) window._configReady.then(wireContactButtons);
