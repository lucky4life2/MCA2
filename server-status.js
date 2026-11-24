/* server-status.js — server status checker.
   The ping happens server-side (Supabase edge function), so this file never
   contains the server address. Include this script only on server.html. */

const STATUS_URL = 'https://hjaywokvgdzhvsoygctc.supabase.co/functions/v1/server-status';

async function checkStatus() {
  const badge  = document.getElementById('status-badge-1');
  const text   = document.getElementById('status-text-1');
  const detail = document.getElementById('status-detail-1');
  if (!badge || !text) return;

  try {
    const res  = await fetch(STATUS_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const data = await res.json();

    if (data && data.online === true) {
      const online  = data.playersOnline ?? 0;
      const max     = data.playersMax ?? '?';
      const version = data.version ?? 'Unknown';

      badge.className      = 'status-badge online';
      text.textContent     = 'Online';
      if (detail) detail.textContent = `${online} / ${max} players · ${version}`;
    } else {
      badge.className      = 'status-badge offline';
      text.textContent     = 'Offline';
      if (detail) detail.textContent = 'Server is currently unreachable';
    }
  } catch (err) {
    badge.className      = 'status-badge offline';
    text.textContent     = 'Unavailable';
    if (detail) detail.textContent = 'Could not reach status API';
  }
}

checkStatus();
setInterval(checkStatus, 30000);
