/* server-status.js — live server status checker
   Uses the mcstatus.io public API to ping the MCA server.
   Include this script only on server.html.               */

const SERVER_IP = '172.240.79.112:2023';
const API_URL   = `https://api.mcstatus.io/v2/status/java/${SERVER_IP}`;

async function checkStatus() {
  const badge      = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const statusDetail = document.getElementById('status-detail');

  if (!badge || !statusText) return;

  try {
    const res  = await fetch(API_URL, { cache: 'no-store' });
    const data = await res.json();

    if (data && data.online === true) {
      const online  = data.players?.online ?? 0;
      const max     = data.players?.max    ?? '?';
      const version = data.version?.name_clean ?? 'Unknown';

      badge.className      = 'status-badge online';
      statusText.textContent = 'Online';
      if (statusDetail) {
        statusDetail.textContent = `${online} / ${max} players · ${version}`;
      }
    } else {
      badge.className      = 'status-badge offline';
      statusText.textContent = 'Offline';
      if (statusDetail) statusDetail.textContent = 'Server is currently unreachable';
    }

  } catch (err) {
    badge.className      = 'status-badge offline';
    statusText.textContent = 'Unavailable';
    if (statusDetail) statusDetail.textContent = 'Could not reach status API';
  }
}

// Check immediately on load, then every 30 seconds
checkStatus();
setInterval(checkStatus, 30000);
