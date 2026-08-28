// ── MCA Economy — shared front-end helpers ───────────────────
// Used by economy.html (wallets) and stocks.html (exchange).
// Every figure rendered here comes from the server. Nothing in this file
// decides what a user is allowed to do — the economy_* RPCs do that, and
// a hidden button is a convenience, never a control.

import { supabase } from './supabase.js';

// ── Formatting ───────────────────────────────────────────────

// Currency is MCA Marks. Never render it with a dollar sign — this is not
// real money and must not look like it.
export function fmtMarks(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Marks';
}

export function fmtShares(n) {
  return Number(n || 0).toLocaleString();
}

// A price that has never traded must read as unknown, not as zero.
export function fmtPrice(price) {
  if (price === null || price === undefined) return 'No trades yet';
  return fmtMarks(price);
}

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export function fmtRelative(ts) {
  if (!ts) return 'never';
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + ' min ago';
  if (secs < 86400) return Math.floor(secs / 3600) + ' hr ago';
  return Math.floor(secs / 86400) + ' days ago';
}

export function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ── Errors ───────────────────────────────────────────────────

// Postgres RAISE messages here are already written for humans, so surface
// them rather than burying them behind a generic "something went wrong".
export function errText(error) {
  if (!error) return 'Unknown error.';
  const msg = error.message || String(error);
  if (/permission denied for function/i.test(msg)) {
    return 'This action is not available to your account.';
  }
  return msg;
}

export function showError(el, error) {
  if (!el) return;
  el.textContent = errText(error);
  el.style.display = 'block';
}

export function showSuccess(el, message) {
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

export function clearMessages() {
  for (const el of arguments) { if (el) el.style.display = 'none'; }
}

// ── Confirmation dialog ──────────────────────────────────────

// Consequential actions must restate the exact numbers before they run.
// Resolves true (confirmed) or false (dismissed).
export function confirmAction(opts) {
  const title = opts.title;
  const lines = opts.lines || [];
  const confirmLabel = opts.confirmLabel || 'Confirm';
  const danger = !!opts.danger;

  return new Promise(function (resolve) {
    const overlay = document.createElement('div');
    overlay.className = 'econ-modal-overlay';
    overlay.innerHTML =
      '<div class="econ-modal" role="dialog" aria-modal="true" aria-labelledby="econ-modal-title">' +
        '<div class="econ-modal-title" id="econ-modal-title">' + escapeHtml(title) + '</div>' +
        '<dl class="econ-modal-facts">' +
          lines.map(function (l) {
            return '<div class="econ-modal-fact"><dt>' + escapeHtml(l.label) +
                   '</dt><dd>' + escapeHtml(l.value) + '</dd></div>';
          }).join('') +
        '</dl>' +
        (opts.note ? '<p class="econ-modal-note">' + escapeHtml(opts.note) + '</p>' : '') +
        '<div class="econ-modal-actions">' +
          '<button class="btn btn-outline" data-econ-cancel>Cancel</button>' +
          '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-econ-ok>' +
            escapeHtml(confirmLabel) + '</button>' +
        '</div>' +
      '</div>';

    function close(result) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }
    function onKey(e) { if (e.key === 'Escape') close(false); }

    overlay.querySelector('[data-econ-cancel]').addEventListener('click', function () { close(false); });
    overlay.querySelector('[data-econ-ok]').addEventListener('click', function () { close(true); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    overlay.querySelector('[data-econ-ok]').focus();
  });
}

// ── Idempotency ──────────────────────────────────────────────

// Every financial submit carries a token, so a double-click, a retry, or a
// flaky connection can never buy or order twice. The server rejects the
// duplicate; this just makes sure a genuine retry reuses the same token.
export function newToken() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  });
}

// ── Data access ──────────────────────────────────────────────

export async function loadMyAccounts() {
  const { data, error } = await supabase.rpc('economy_my_accounts');
  if (error) throw error;
  return data || [];
}

export async function loadExchangeSettings() {
  const { data, error } = await supabase
    .from('economy_exchange_settings').select('*').limit(1).maybeSingle();
  if (error) return null;
  return data;
}

export async function loadCompanies() {
  const { data, error } = await supabase
    .from('economy_companies')
    .select('id,name,ticker,description,industry,headquarters,website,charter,status,total_shares,shares_issued,last_trade_price,last_trade_at,trading_halted,halt_reason,founder_id,account_id,created_at')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function loadMarketSummary(companyId) {
  const { data, error } = await supabase.rpc('economy_market_summary', { p_company_id: companyId });
  if (error) return null;
  return Array.isArray(data) ? data[0] : data;
}

export async function loadOrderBook(companyId, depth) {
  const { data, error } = await supabase.rpc('economy_order_book', {
    p_company_id: companyId, p_depth: depth || 10
  });
  if (error) return [];
  return data || [];
}

export async function loadRecentTrades(companyId, limit) {
  const { data, error } = await supabase
    .from('economy_trades')
    .select('quantity,price,total,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit || 25);
  if (error) return [];
  return data || [];
}

export async function loadMyOrders(accountIds) {
  if (!accountIds.length) return [];
  const { data, error } = await supabase
    .from('economy_orders')
    .select('id,company_id,account_id,side,limit_price,quantity,filled_quantity,status,reserved_amount,reserved_shares,created_at,expires_at')
    .in('account_id', accountIds)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function loadMyHoldings(accountIds) {
  if (!accountIds.length) return [];
  const { data, error } = await supabase
    .from('economy_shareholdings')
    .select('company_id,account_id,shares,reserved_shares,economy_companies(ticker,name,last_trade_price,status)')
    .in('account_id', accountIds);
  if (error) return [];
  return (data || []).filter(function (h) { return (h.shares + h.reserved_shares) > 0; });
}

export async function loadOpenOfferings() {
  const { data, error } = await supabase
    .from('economy_offerings')
    .select('*,economy_companies(id,ticker,name,description,industry,status)')
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

// Which companies is this user an officer of, and with what powers?
export async function loadMyCompanyRoles() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('economy_company_members')
    .select('*,economy_companies(id,ticker,name,status)')
    .eq('user_id', user.id);
  if (error) return [];
  return data || [];
}

// ── Cost preview ─────────────────────────────────────────────

// Mirrors what the server will reserve, so the confirmation dialog can show
// it. Preview only — the server recomputes and is the authority.
export function previewOrder(opts) {
  const qty = Math.floor(Number(opts.quantity) || 0);
  const price = Number(opts.limitPrice) || 0;
  const max = qty * price;
  return {
    quantity: qty,
    price: price,
    maxTotal: max,
    reserves: opts.side === 'buy'
      ? fmtMarks(max) + ' held until the order fills or is cancelled'
      : fmtShares(qty) + ' shares held until the order fills or is cancelled'
  };
}
