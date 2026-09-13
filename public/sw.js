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
  '/timeselect.js',
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

  const key = e.request.mode === 'navigate' ? '/index.html' : e.request;

  // Revalidation runs under waitUntil, called synchronously here: returning the
  // cached copy from respondWith ends the event, and without waitUntil the
  // worker can be killed before the new copy is ever written.
  const revalidate = caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    try {
      const res = await fetch(e.request);
      if (!res.ok) return cached || res;
      // Serving the cached copy first means a deploy only showed up on the
      // *second* open. Compare ETags and tell the page it is running stale code.
      const changed = cached && cached.headers.get('etag') !== res.headers.get('etag');
      await cache.put(key, res.clone());
      if (changed) {
        const windows = await self.clients.matchAll({ type: 'window' });
        for (const c of windows) c.postMessage({ type: 'shell-updated' });
      }
      return res;
    } catch {
      return cached;
    }
  });

  e.waitUntil(revalidate);
  e.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(key))
      .then((cached) => cached || revalidate)
  );
});
