/* Kraftzyklus Service Worker – hält die App-Dateien offline vor.
   Updates erkennt die App selbst durch Dateivergleich (Einstellungen › Nach Updates suchen),
   eine vergessene Versionsnummer hier verhindert also kein Update mehr. */
const VERSION = '1.5.0';
const CACHE = 'kraftzyklus-' + VERSION;
const FILES = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];
const CHECK = '_kzcheck';   // Anfragen mit diesem Parameter gehen immer ins Netz (Update-Prüfung)

// Frisch vom Server holen, an Browser- und CDN-Cache vorbei
function fresh(path) {
  const u = new URL(path, self.registration.scope);
  u.searchParams.set(CHECK, Date.now().toString(36));
  return fetch(u.href, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(path + ' ' + r.status); return r; });
}

self.addEventListener('install', (event) => {
  // Erst alles laden, dann speichern: ein abgebrochener Download hinterlässt keinen halben Stand.
  event.waitUntil(Promise.all(FILES.map((f) => fresh(f).then((r) => [f, r])))
    .then((pairs) => caches.open(CACHE).then((c) => Promise.all(pairs.map(([f, r]) => c.put(new URL(f, self.registration.scope).href, r))))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kraftzyklus-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has(CHECK)) return;           // Update-Prüfung: direkt ins Netz
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match(new URL('index.html', self.registration.scope).href).then((r) => r || fetch(req));
      return fetch(req);
    })
  );
});
