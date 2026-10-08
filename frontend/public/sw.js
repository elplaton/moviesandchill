/*
 * Service worker de la web de escritorio.
 *
 * No cachea NADA a proposito: la web se sirve con nginx y meter una cache aqui
 * solo traeria versiones viejas pegadas en el navegador. Existe unicamente
 * porque los avisos (Web Push) necesitan un service worker: es quien despierta
 * al navegador cuando llega un episodio nuevo, aunque la pestaña este cerrada.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const titulo = d.title || 'Movies & Chill';
  event.waitUntil(self.registration.showNotification(titulo, {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // El tag agrupa: dos avisos de la misma serie se sustituyen en vez de
    // apilarse en la pantalla de bloqueo.
    tag: d.tag || 'movieschill',
    data: d,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  // La ficha vive en la URL, asi que el aviso puede abrir el titulo directo.
  // Y un aviso de descarga terminada sin ficha (un titulo que TMDB no conoce)
  // lleva a Descargas, que es donde esta lo que acaba de bajar: la portada no
  // ayudaria a encontrarlo.
  const destino = d.tmdb_id
    ? `/?ficha=${d.kind === 'series' ? 's' : 'm'}${d.tmdb_id}`
    : d.reason === 'descarga' ? '/descargas' : '/';
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cliente of abiertas) {
      if (new URL(cliente.url).origin === self.location.origin) {
        await cliente.focus();
        if ('navigate' in cliente) { try { await cliente.navigate(destino); } catch (e) { /* da igual */ } }
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
