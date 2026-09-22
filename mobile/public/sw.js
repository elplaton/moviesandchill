/*
 * Service worker de la PWA. Cachea el armazon de la app (HTML, JS, CSS,
 * iconos) para que abra al instante y funcione la instalacion; la API y el
 * video van siempre a la red (son datos vivos y rangos de bytes).
 */
// __BUILD__ lo sustituye el script de compilacion por la fecha del build.
const VERSION = 'mc-m-__BUILD__';
const SHELL = ['/m/', '/m/index.html', '/m/manifest.webmanifest', '/m/icons/icon-192.png', '/m/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/m/')) return;
  // Navegaciones: red primero (para coger la version nueva), cache de respaldo.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/m/index.html')));
    return;
  }
  // Recursos con hash: cache primero, y se guardan al vuelo.
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(event.request, res.clone()));
      return res;
    })),
  );
});
