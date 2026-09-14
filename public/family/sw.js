const CACHE_PREFIX = 'kkumeum-family-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v7`;
const STATIC_SHELL = [
  '/family/',
  '/family/index.html',
  '/family/family.css',
  '/family/family-news.css',
  '/family/family-theme.css',
  '/family/family-mobile.css',
  '/family/family-mobile.js',
  '/family/kkumeum-mobile.css',
  '/data-core/assets/core-icons.svg',
  '/data-core/design-tokens.css',
  '/data-core/image-gallery.js',
  '/data-core/image-gallery.css',
  '/family/family.js',
  '/family/family-growth-labels.js',
  '/family/family-news.js',
  '/family/manifest.webmanifest',
  '/family/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Guardian/auth/feed/private images/notices are always network-only and are never written to Cache API.
  if (url.pathname.startsWith('/api/family/') || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (!STATIC_SHELL.includes(url.pathname)) return;
  // Revalidate shell assets online so existing installs see newly deployed UI.
  // Query values (including notice IDs) are never retained in cache keys.
  const cacheKey = `${url.origin}${url.pathname}`;
  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok && response.type === 'basic' && !response.redirected) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy)).catch(() => {}));
      }
      return response;
    } catch (error) {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
      throw error;
    }
  })());
});

self.addEventListener('push', (event) => {
  let noticeId = '';
  try {
    const payload = event.data ? event.data.json() : {};
    noticeId = String(payload?.noticeId || '').slice(0, 160);
  } catch {
    // Keep the notification generic when a provider payload is malformed.
  }
  const route = noticeId ? `/family/?openNotice=${encodeURIComponent(noticeId)}` : '/family/';
  event.waitUntil(self.registration.showNotification('꿈이음', {
    body: '꿈이음 새 소식이 도착했습니다.',
    tag: `kkumeum-notice-${noticeId || 'latest'}`,
    renotify: false,
    data: { route },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = String(event.notification.data?.route || '/family/');
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    return existing ? existing.focus().then(() => existing.navigate(route)) : clients.openWindow(route);
  }));
});
