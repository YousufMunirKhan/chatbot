/* Agent Inbox service worker.
 * Deliberately conservative: network-first for everything, with a tiny cache
 * used ONLY as an offline fallback for navigations. We never cache API
 * responses or anything with an Authorization/cookie-sensitive payload, so the
 * authenticated dashboard can't serve stale or cross-account data.
 */
const CACHE = 'agent-inbox-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([OFFLINE_URL])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only handle top-level navigations; let everything else hit the network
  // untouched (APIs, assets, auth).
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  if (new URL(request.url).pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r || new Response('Offline', { status: 503 }))),
  );
});
