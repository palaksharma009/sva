/* ============================================================================
   Service worker — lets Sva be installed on a phone and opened without signal.
   Only runs when the app is served over https (or localhost), not from file://.

   Network first: when online you always get the newest files (the browser's own
   short-lived copy is skipped too); the copy kept
   here is only used when the network fails.
   ============================================================================ */

const CACHE = 'sva-v19';
const FILES = [
  './', 'index.html', 'main.css', 'main.js', 'schedule.js', 'sync.js', 'cloud-config.js', 'yarn.js', 'lotus.js', 'anime.min.js',
  'dot.html', 'styles.css', 'app.js', 'config.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })      // ask the server every time, so an update shows at once
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});

/* Tapping a reminder notification brings Sva to the front. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    }));
});
