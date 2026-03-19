/* server-status.js — server status checker for Global Dawn
   Pings mc.minecraftclubofamerica.me via the mcstatus.io API.
   Include this script only on server.html.                   */

const SERVER_IP = 'mc.minecraftclubofamerica.me';
const API_URL   = `https://api.mcstatus.io/v2/status/java/${SERVER_IP}`;

async function checkStatus() {
  const badge  = document.getElementById('status-badge-1');
  const text   = document.getElementById('status-text-1');
  const detail = document.getElementById('status-detail-1');
  if (!badge || !text) return;

  try {
    const res  = await fetch(API_URL, { cache: 'no-store' });
    const data = await res.json();

    if (data && data.online === true) {
      const online  = data.players?.online ?? 0;
      const max     = data.players?.max    ?? '?';
      const version = data.version?.name_clean ?? 'Unknown';

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
