// server-status: public server-status probe for the website.
//
// The game server's address lives ONLY here (server-side). The website calls
// this function and gets back online / players / version — never the address,
// so nothing joinable ever appears in the site's pages or scripts.
const CORS = {
  'Access-Control-Allow-Origin': 'https://minecraftclubofamerica.me',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MCSTATUS_URL = 'https://api.mcstatus.io/v2/status/java/mc.minecraftclubofamerica.me';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const res = await fetch(MCSTATUS_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`mcstatus ${res.status}`);
    const data = await res.json();
    // Only the display fields leave this function. host / ip_address / port
    // from the mcstatus response are deliberately dropped.
    const body = {
      online: data?.online === true,
      playersOnline: data?.players?.online ?? 0,
      playersMax: data?.players?.max ?? null,
      version: data?.version?.name_clean ?? 'Unknown',
    };
    return new Response(JSON.stringify(body), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: 'Status unavailable.' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
