// Keeps the app openable in under a second even while Render's free tier is
// asleep, or when there's no signal at all. Stale-while-revalidate so a deploy
// lands on the next open without any cache version to remember to bump.
const CACHE = 'planner';
const SHELL = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/dom.js',
  '/store.js',
  '/util.js',
  '/screens/today.js',
  '/screens/inbox.js',
  '/screens/week.js',
  '/screens/projects.js',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // sync must never read a cache

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = e.request.mode === 'navigate' ? '/index.html' : e.request;
      const cached = await cache.match(key);
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
