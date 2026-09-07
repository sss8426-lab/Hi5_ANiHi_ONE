const CACHE_NAME = 'kkumeum-family-shell-v2';
const STATIC_SHELL = [
  '/family/',
  '/family/index.html',
  '/family/family.css',
  '/family/family-news.css',
  '/family/family.js',
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
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
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
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (!response.ok || response.type !== 'basic') return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    })),
  );
});