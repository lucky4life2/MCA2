const SUPABASE_URL = 'https://hjaywokvgdzhvsoygctc.supabase.co';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return esc(iso); }
}

const params = new URLSearchParams(window.location.search);
const userId = params.get('uid');
const token  = params.get('token');
const ptoken = params.get('ptoken');

const show = (id) => {
  ['pc-loading','pc-invalid','pc-ask','pc-approved','pc-declined','pc-portal','pc-portal-done'].forEach(x => {
    document.getElementById(x).style.display = x === id ? 'block' : 'none';
  });
};

if (ptoken) {
  initPortal();
} else if (!userId || !token) {
  show('pc-invalid');
} else {
  show('pc-ask');
  wireOneTime();
}

// ── One-time approve/decline link ──────────────────────────────
function wireOneTime() {
  async function respond(decision) {
    const errEl = document.getElementById('pc-error');
    errEl.style.display = 'none';
    document.getElementById('pc-approve').disabled = true;
    document.getElementById('pc-decline').disabled = true;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/confirm-parental-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, token, decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        errEl.textContent = json.error || 'Something went wrong. Please try again.';
        errEl.style.display = 'block';
        document.getElementById('pc-approve').disabled = false;
        document.getElementById('pc-decline').disabled = false;
        return;
      }
      show(decision === 'approve' ? 'pc-approved' : 'pc-declined');
    } catch (e) {
      errEl.textContent = 'Network error. Please try again.';
      errEl.style.display = 'block';
      document.getElementById('pc-approve').disabled = false;
      document.getElementById('pc-decline').disabled = false;
    }
  }

  document.getElementById('pc-approve').addEventListener('click', () => respond('approve'));
  document.getElementById('pc-decline').addEventListener('click', () => {
    if (confirm('Are you sure you want to decline? The account will remain inactive.')) respond('decline');
  });
}

// ── Permanent parent portal ──────────────────────────────────────
async function portalCall(action) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/parent-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, portalToken: ptoken, action }),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

const STATUS_LABEL = {
  pending: 'Waiting for your response',
  approved: 'Approved — account is active',
  declined: 'Declined',
  revoked: 'Revoked',
};

async function initPortal() {
  if (!userId) { show('pc-invalid'); return; }
  const { ok, json } = await portalCall('review');
  if (!ok || json.error) { show('pc-invalid'); return; }

  renderPortal(json);
  show('pc-portal');

  document.getElementById('pc-revoke').addEventListener('click', async () => {
    if (!confirm('Revoke consent? This immediately restricts the account and queues deletion of the information collected. This cannot be undone.')) return;
    await runPortalAction('revoke');
  });
  document.getElementById('pc-delete').addEventListener('click', async () => {
    if (!confirm('Request deletion? This immediately restricts the account and queues deletion of the information collected. This cannot be undone.')) return;
    await runPortalAction('request_deletion');
  });
}

async function runPortalAction(action) {
  const errEl = document.getElementById('pc-portal-error');
  errEl.style.display = 'none';
  document.getElementById('pc-revoke').disabled = true;
  document.getElementById('pc-delete').disabled = true;
  const { ok, json } = await portalCall(action);
  if (!ok || json.error) {
    errEl.textContent = json.error || 'Something went wrong. Please try again.';
    errEl.style.display = 'block';
    document.getElementById('pc-revoke').disabled = false;
    document.getElementById('pc-delete').disabled = false;
    return;
  }
  show('pc-portal-done');
}

function renderPortal(data) {
  const c = data.consent || {};
  const collected = data.collected || {};

  document.getElementById('pc-portal-status').innerHTML = `
    <dl style="margin:0;">
      <dt>Status</dt><dd>${esc(STATUS_LABEL[c.status] || c.status || 'Unknown')}</dd>
      <dt>Consent method</dt><dd>${esc(c.consentMethod || '—')}</dd>
      <dt>Notice sent</dt><dd>${esc(fmtDate(c.noticeSentAt))}</dd>
      <dt>Consent given</dt><dd>${esc(fmtDate(c.approvedAt))}</dd>
      <dt>Consent declined</dt><dd>${esc(fmtDate(c.declinedAt))}</dd>
      <dt>Consent revoked</dt><dd>${esc(fmtDate(c.revokedAt))}</dd>
    </dl>`;

  document.getElementById('pc-portal-collected').innerHTML = `
    <dt>Date of birth on file</dt><dd>${esc(collected.dateOfBirth || '—')}</dd>
    <dt>Email (sign-in only, never public)</dt><dd>${esc(collected.childEmail || '—')}</dd>
    <dt>Display name</dt><dd>${esc(collected.displayName || '(not set — account is restricted)')}</dd>
    <dt>Username</dt><dd>${esc(collected.username || '(not set)')}</dd>
    <dt>Minecraft username</dt><dd>${esc(collected.minecraftUsername || '(not linked)')}</dd>
    <dt>Discord linked</dt><dd>${collected.discordLinked ? 'Yes' : 'No'}</dd>
    <dt>Google linked</dt><dd>${collected.googleLinked ? 'Yes' : 'No'}</dd>
    <dt>Account status</dt><dd>${esc(collected.accountStatus || '—')}</dd>`;

  document.getElementById('pc-portal-disclosure').textContent = c.thirdPartyDisclosureReason || '';

  document.getElementById('pc-revoke').style.display = c.status === 'approved' ? 'inline-block' : 'none';
}
