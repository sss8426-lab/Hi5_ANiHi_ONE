// 꿈이음 출결기: keep the tablet page itself available offline (presses are queued by kiosk.js).
// /api/ is never cached.
const CACHE = 'kkumeum-kiosk-v1';
const SHELL = ['/kiosk/', '/kiosk/index.html', '/kiosk/kiosk.js', '/kiosk/kiosk.css', '/kiosk/manifest.webmanifest', '/family/icon-192.png'];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('kkumeum-kiosk-') && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (!SHELL.includes(url.pathname)) return;
  const key = url.origin + url.pathname;
  event.respondWith(fetch(event.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {}); }
    return res;
  }).catch(async () => (await caches.match(key)) || Response.error()));
});
