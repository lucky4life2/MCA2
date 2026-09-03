// PWA service worker for the MCA site.
//
// This site's data (economy, congress, court, tasks, news, etc.) is loaded
// client-side from Supabase after each page load, so the HTML/CSS/JS shell
// can be cached and refreshed independently of that data. Strategy:
//   - Only same-origin GET requests are ever intercepted; everything else
//     (Supabase, esm.sh, Turnstile, mcstatus.io, and all non-GET requests)
//     is left untouched and goes straight to the network.
//   - Network-first with a cache fallback, so visitors always get the
//     latest shell when online, and something usable when offline.
// Bump this on any change to the cached set so old caches get cleared out.
const CACHE_NAME = 'mca-shell-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/nav.js',
  '/manifest.json',
  '/images/icon.ico',
  '/images/icons/icon-192.png',
  '/images/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;
        }
        return Response.error();
      })
  );
});
