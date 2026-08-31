import { supabase } from './supabase.js';
import {
  fmtMarks, fmtDate, escapeHtml, showError, showSuccess, clearMessages,
  confirmAction, loadMyAccounts
} from './economy.js';

let _accounts = [];

// ── Boot ─────────────────────────────────────────────────────
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  document.getElementById('econ-signed-out').style.display = '';
} else {
  document.getElementById('econ-main').style.display = '';
  await refresh();
  wire();
}

async function refresh() {
  try {
    _accounts = await loadMyAccounts();
  } catch (e) {
    document.getElementById('econ-wallets').innerHTML =
      '<div class="econ-muted">Could not load wallets: ' + escapeHtml(e.message) + '</div>';
    return;
  }
  renderTotals();
  renderWallets();
  fillFromSelect();
  await renderHistory();
}

function renderTotals() {
  const avail = _accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
  const held = _accounts.reduce((s, a) => s + Number(a.reserved_balance || 0), 0);
  document.getElementById('econ-total-available').textContent = fmtMarks(avail);
  document.getElementById('econ-total-reserved').textContent = fmtMarks(held);
  document.getElementById('econ-total-wallets').textContent = String(_accounts.length);
}

function renderWallets() {
  const el = document.getElementById('econ-wallets');
  if (!_accounts.length) {
    el.innerHTML = '<div class="econ-muted">No wallets yet. Create one to start holding Marks.</div>';
    return;
  }
  el.innerHTML = _accounts.map(a => {
    const held = Number(a.reserved_balance || 0);
    return '<div class="econ-row">' +
      '<div>' +
        '<div class="econ-row-main">' + escapeHtml(a.name) + '</div>' +
        '<div class="econ-row-detail">' + escapeHtml(a.type) +
          ' · ' + fmtMarks(a.balance) + ' available' +
          (held > 0 ? ' · ' + fmtMarks(held) + ' reserved' : '') +
          (a.is_frozen ? ' · frozen' : '') +
        '</div>' +
      '</div>' +
      '<div class="econ-row-actions">' +
        '<button class="btn btn-outline" data-rename="' + a.id + '">Rename</button>' +
        '<button class="btn btn-danger" data-close="' + a.id + '">Close</button>' +
      '</div>' +
    '</div>';
  }).join('');

  el.querySelectorAll('[data-rename]').forEach(b =>
    b.addEventListener('click', () => renameWallet(b.getAttribute('data-rename'))));
  el.querySelectorAll('[data-close]').forEach(b =>
    b.addEventListener('click', () => closeWallet(b.getAttribute('data-close'))));
}

function fillFromSelect() {
  const sel = document.getElementById('pay-from');
  sel.innerHTML = _accounts.map(a =>
    '<option value="' + a.id + '">' + escapeHtml(a.name) + ' — ' + fmtMarks(a.balance) + '</option>'
  ).join('');
}

async function renderHistory() {
  const el = document.getElementById('econ-history');
  const ids = _accounts.map(a => a.id);
  if (!ids.length) { el.innerHTML = '<div class="econ-muted">Nothing yet.</div>'; return; }

  const { data, error } = await supabase
    .from('economy_transactions')
    .select('amount,type,category,memo,created_at,from_account_id,to_account_id')
    .or('from_account_id.in.(' + ids.join(',') + '),to_account_id.in.(' + ids.join(',') + ')')
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) { el.innerHTML = '<div class="econ-muted">Could not load history.</div>'; return; }
  if (!data.length) { el.innerHTML = '<div class="econ-muted">No transactions yet.</div>'; return; }

  el.innerHTML = '<table class="econ-table"><thead><tr>' +
    '<th>When</th><th>Type</th><th>Detail</th><th class="econ-num">Amount</th>' +
    '</tr></thead><tbody>' +
    data.map(t => {
      const incoming = ids.indexOf(t.to_account_id) !== -1;
      const sign = incoming ? '+' : '−';
      const color = incoming ? '#2d7d2f' : 'var(--mid)';
      return '<tr>' +
        '<td>' + escapeHtml(fmtDate(t.created_at)) + '</td>' +
        '<td>' + escapeHtml(String(t.type).replace(/_/g, ' ')) + '</td>' +
        '<td>' + escapeHtml(t.memo || '—') + '</td>' +
        '<td class="econ-num" style="color:' + color + ';">' + sign + ' ' + fmtMarks(t.amount) + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

// ── Actions ──────────────────────────────────────────────────
function wire() {
  const createForm = document.getElementById('form-create');
  const payForm = document.getElementById('form-pay');

  document.getElementById('btn-show-create').addEventListener('click', () => {
    createForm.style.display = createForm.style.display === 'block' ? 'none' : 'block';
  });
  document.getElementById('btn-cancel-create').addEventListener('click', () => {
    createForm.style.display = 'none';
  });
  document.getElementById('btn-show-pay').addEventListener('click', () => {
    payForm.style.display = payForm.style.display === 'block' ? 'none' : 'block';
    fillFromSelect();
  });
  document.getElementById('btn-cancel-pay').addEventListener('click', () => {
    payForm.style.display = 'none';
  });

  document.getElementById('btn-create').addEventListener('click', createWallet);
  document.getElementById('btn-pay').addEventListener('click', sendMarks);
}

async function createWallet() {
  const errEl = document.getElementById('create-error');
  clearMessages(errEl);
  const type = document.getElementById('create-type').value;
  const name = document.getElementById('create-name').value.trim();
  if (!name) { showError(errEl, { message: 'Give the wallet a name.' }); return; }

  const btn = document.getElementById('btn-create');
  btn.disabled = true;
  const { error } = await supabase.rpc('economy_create_account', {
    p_type: type, p_name: name, p_nation_id: null
  });
  btn.disabled = false;

  if (error) { showError(errEl, error); return; }
  document.getElementById('create-name').value = '';
  document.getElementById('form-create').style.display = 'none';
  await refresh();
}

async function renameWallet(id) {
  const wallet = _accounts.find(a => a.id === id);
  if (!wallet) return;
  const name = window.prompt('New name for "' + wallet.name + '":', wallet.name);
  if (name === null) return;

  const { error } = await supabase.rpc('economy_rename_account', {
    p_account_id: id, p_name: name.trim()
  });
  if (error) { window.alert(error.message); return; }
  await refresh();
}

async function closeWallet(id) {
  const wallet = _accounts.find(a => a.id === id);
  if (!wallet) return;

  // The server enforces the zero-balance rule; showing the numbers first
  // means the refusal is never a surprise.
  const ok = await confirmAction({
    title: 'Close this wallet?',
    lines: [
      { label: 'Wallet', value: wallet.name },
      { label: 'Available', value: fmtMarks(wallet.balance) },
      { label: 'Reserved', value: fmtMarks(wallet.reserved_balance) }
    ],
    note: 'A wallet can only be closed once it holds no Marks and no shares. Its transaction history is kept — closing hides the wallet and stops it receiving Marks, it does not erase the ledger.',
    confirmLabel: 'Close wallet',
    danger: true
  });
  if (!ok) return;

  const { error } = await supabase.rpc('economy_close_account', { p_account_id: id });
  if (error) { window.alert(error.message); return; }
  await refresh();
}

async function sendMarks() {
  const errEl = document.getElementById('pay-error');
  const okEl = document.getElementById('pay-success');
  clearMessages(errEl, okEl);

  const fromId = document.getElementById('pay-from').value;
  const toRaw = document.getElementById('pay-to').value.trim();
  const amount = Number(document.getElementById('pay-amount').value);
  const memo = document.getElementById('pay-memo').value.trim() || null;

  if (!fromId) { showError(errEl, { message: 'Pick a wallet to send from.' }); return; }
  if (!toRaw) { showError(errEl, { message: 'Say who you are sending to.' }); return; }
  if (!(amount > 0)) { showError(errEl, { message: 'Enter an amount greater than zero.' }); return; }

  // Resolve the destination: one of your own wallets by name, else a username.
  let toAccountId = null;
  const own = _accounts.find(a => a.name.toLowerCase() === toRaw.toLowerCase() && a.id !== fromId);
  if (own) {
    toAccountId = own.id;
  } else {
    // Must be public_profiles, not profiles: a member can only read their own
    // profiles row, so looking a recipient up by username always came back
    // empty and every transfer failed with "No player or wallet found".
    const { data: profile } = await supabase
      .from('public_profiles').select('id,username,display_name')
      .ilike('username', toRaw).limit(1).maybeSingle();
    if (!profile) { showError(errEl, { message: 'No player or wallet found called "' + toRaw + '".' }); return; }
    const { data: acctId } = await supabase.rpc('economy_get_personal_account_id', {
      p_target_user_id: profile.id
    });
    if (!acctId) { showError(errEl, { message: 'That player does not have a wallet yet.' }); return; }
    toAccountId = acctId;
  }

  const from = _accounts.find(a => a.id === fromId);
  const ok = await confirmAction({
    title: 'Send Marks?',
    lines: [
      { label: 'From', value: from ? from.name : 'wallet' },
      { label: 'To', value: toRaw },
      { label: 'Amount', value: fmtMarks(amount) },
      { label: 'Memo', value: memo || '—' }
    ],
    note: 'Transfers are final. They move Marks between wallets and never create new ones.',
    confirmLabel: 'Send'
  });
  if (!ok) return;

  const btn = document.getElementById('btn-pay');
  btn.disabled = true;
  const { error } = await supabase.rpc('economy_transfer', {
    p_from: fromId, p_to: toAccountId, p_amount: amount, p_memo: memo
  });
  btn.disabled = false;

  if (error) { showError(errEl, error); return; }
  showSuccess(okEl, 'Sent ' + fmtMarks(amount) + ' to ' + toRaw + '.');
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-memo').value = '';
  await refresh();
}
