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

/* --------------------------------------------------------------------------
 * Web push.
 *
 * The caching stance above is untouched: nothing here reads or writes the
 * cache. The payload is already decrypted by the browser when it reaches us,
 * and it is deliberately small — a title, a line of body, and the in-app path
 * to open. No conversation content beyond what the notification itself says is
 * stored anywhere on the device.
 * ------------------------------------------------------------------------ */

function parsePush(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch (e) {
    // A push with a non-JSON body is not ours, but the spec still requires a
    // visible notification, so fall back to the raw text.
    try {
      return { title: event.data.text() };
    } catch (e2) {
      return null;
    }
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePush(event) || {};
  const title = payload.title || 'Agent Inbox';
  const url = typeof payload.url === 'string' && payload.url.charAt(0) === '/' ? payload.url : '/company/notifications';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      // Same tag ⇒ the newer alert replaces the older one, so a busy
      // conversation cannot bury a phone under a stack of banners.
      tag: payload.tag || 'agent-inbox',
      renotify: Boolean(payload.tag),
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      data: { url: url, type: payload.type || null, conversationId: payload.conversationId || null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/company/notifications';

  // Focus an already-open tab on the same conversation rather than opening a
  // second one; otherwise focus any open dashboard tab and navigate it; only
  // open a new window as a last resort.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i += 1) {
        const client = clientList[i];
        const path = new URL(client.url).pathname;
        if (path === target) return client.focus();
      }
      for (let j = 0; j < clientList.length; j += 1) {
        const client = clientList[j];
        if ('navigate' in client) {
          return client.navigate(target).then((navigated) => (navigated || client).focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
