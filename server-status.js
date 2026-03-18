/* server-status.js — dual server status checker
   Pings both addresses simultaneously and updates
   their cards independently.                       */

const SERVERS = [
  {
    ip:      'mc.minecraftclubofamerica.me',
    label:   'mc.minecraftclubofamerica.me',
    badgeId: 'status-badge-1',
    textId:  'status-text-1',
    detailId:'status-detail-1',
  },
  {
    ip:      '172.240.79.112:2023',
    label:   '172.240.79.112:2023',
    badgeId: 'status-badge-2',
    textId:  'status-text-2',
    detailId:'status-detail-2',
  },
];

async function checkServer(server) {
  const badge  = document.getElementById(server.badgeId);
  const text   = document.getElementById(server.textId);
  const detail = document.getElementById(server.detailId);
  if (!badge || !text) return;

  try {
    const res  = await fetch(`https://api.mcstatus.io/v2/status/java/${server.ip}`, { cache: 'no-store' });
    const data = await res.json();

    if (data && data.online === true) {
      const online  = data.players?.online ?? 0;
      const max     = data.players?.max    ?? '?';
      const version = data.version?.name_clean ?? 'Unknown';

      badge.className    = 'status-badge online';
      text.textContent   = 'Online';
      if (detail) detail.textContent = `${online} / ${max} players · ${version}`;
    } else {
      badge.className    = 'status-badge offline';
      text.textContent   = 'Offline';
      if (detail) detail.textContent = 'Server is currently unreachable';
    }
  } catch (err) {
    badge.className    = 'status-badge offline';
    text.textContent   = 'Unavailable';
    if (detail) detail.textContent = 'Could not reach status API';
  }
}

function checkAll() {
  SERVERS.forEach(checkServer);
}

// Check immediately, then every 30 seconds
checkAll();
setInterval(checkAll, 30000);
