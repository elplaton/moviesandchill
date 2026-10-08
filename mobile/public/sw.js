/*
 * Service worker de la PWA. Cachea el armazon de la app (HTML, JS, CSS,
 * iconos) para que abra al instante y funcione la instalacion; la API y el
 * video van siempre a la red (son datos vivos y rangos de bytes).
 */
// La version llega en la query con la que se registra este archivo
// (/m/sw.js?v=20260101120000): un service worker por compilacion.
const VERSION = 'mc-m-' + (new URL(self.location.href).searchParams.get('v') || 'dev');
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

/*
 * Avisos de episodios nuevos (Web Push).
 *
 * Es el service worker quien recibe el aviso y lo enseña: por eso existen los
 * avisos aunque la app este cerrada. En el iPhone esto solo llega si la PWA
 * esta instalada en la pantalla de inicio (iOS 16.4+).
 */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const titulo = d.title || 'Movies & Chill';
  event.waitUntil(self.registration.showNotification(titulo, {
    body: d.body || '',
    icon: '/m/icons/icon-192.png',
    badge: '/m/icons/icon-192.png',
    // El tag agrupa: dos avisos de la misma serie se sustituyen en vez de
    // apilarse en la pantalla de bloqueo.
    tag: d.tag || 'movieschill',
    data: d,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  // Un aviso de descarga terminada sin ficha (un titulo que TMDB no conoce)
  // lleva a Descargas, que es donde esta lo que acaba de bajar.
  const destino = d.tmdb_id
    ? `/m/t/${d.kind === 'series' ? 'series' : 'movie'}/${d.tmdb_id}`
    : d.reason === 'descarga' ? '/m/descargas' : '/m/';
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cliente of abiertas) {
      if (new URL(cliente.url).pathname.startsWith('/m/')) {
        await cliente.focus();
        if ('navigate' in cliente) { try { await cliente.navigate(destino); } catch (e) { /* da igual */ } }
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
