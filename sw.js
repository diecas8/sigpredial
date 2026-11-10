/* Sigpredial · trabajo sin señal
 * Guarda en el teléfono la aplicación (páginas, estilos, código y librerías) para que
 * abra aunque no haya internet. Los datos de los predios los guarda js/api.js.
 *  - Archivos del portal: primero la red (para recibir siempre la versión nueva);
 *    si no hay señal, la copia guardada.
 *  - Librerías externas (versiones fijas): primero la copia guardada.
 *  - Imágenes del mapa en línea: se guardan las que se ven, para tener fondo sin señal.
 *  - Supabase (datos y planchas): no pasa por aquí.
 */
const VERSION = 'sip-20261110f';
const APP = VERSION + '-app';
const LIBS = 'sip-libs-1';
const TESELAS = 'sip-teselas-1';
const MAX_TESELAS = 4000;

const PROPIOS = ['./', 'index.html', 'css/estilos.css', 'js/config.js', 'js/datos-demo.js', 'js/api.js', 'js/ficha.js',
  'js/app.js', 'img/logo-cbs.png', 'img/logo-cbs-horizontal.png', 'img/icono-192.png', 'manifest.webmanifest'];
const EXTERNOS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js',
  'https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.11.0/proj4.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js',
  'https://cdn.jsdelivr.net/npm/@tmcw/togeojson@7.1.2/dist/togeojson.umd.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const app = await caches.open(APP);
    await app.addAll(PROPIOS).catch(() => {});
    const libs = await caches.open(LIBS);
    await Promise.all(EXTERNOS.map(async (u) => {
      if (await libs.match(u)) return;
      try { await libs.put(u, await fetch(new Request(u, { mode: 'no-cors' }))); } catch (err) { /* se guarda al usarla */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres.filter((n) => n.endsWith('-app') && n !== APP).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const esTesela = (u) => /arcgisonline\.com|tile\.openstreetmap|tiles\.|\/tile\//i.test(u.href);
const esLibreria = (u) => /unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u.host);

async function recortar(cache) {
  const llaves = await cache.keys();
  for (let i = 0; i < llaves.length - MAX_TESELAS; i++) await cache.delete(llaves[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (/supabase\.co$/.test(u.hostname)) return;

  if (u.origin === self.location.origin) {
    // Primero la red; sin señal (o si tarda más de 4 s), la copia guardada
    e.respondWith((async () => {
      const cache = await caches.open(APP);
      const llave = new Request(u.origin + u.pathname);   // sin ?v=: una sola copia por archivo
      try {
        const red = fetch(req);
        const r = await Promise.race([red, new Promise((_, no) => setTimeout(() => no(new Error('lenta')), 4000))]);
        if (r && r.ok) cache.put(llave, r.clone());
        return r;
      } catch (err) {
        const copia = await cache.match(llave, { ignoreSearch: true }) ||
          (req.mode === 'navigate' ? (await cache.match(new Request(new URL('index.html', self.registration.scope).href)) ||
            await cache.match(new Request(self.registration.scope))) : null);
        if (copia) return copia;
        try { return await fetch(req); } catch (e2) { return new Response('Sin conexión', { status: 503 }); }
      }
    })());
    return;
  }

  if (esLibreria(u)) {
    e.respondWith((async () => {
      const cache = await caches.open(LIBS);
      const copia = await cache.match(req, { ignoreVary: true });
      if (copia) return copia;
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
      return r;
    })());
    return;
  }

  if (esTesela(u)) {
    e.respondWith((async () => {
      const cache = await caches.open(TESELAS);
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === 'opaque')) { cache.put(req, r.clone()); recortar(cache); }
        return r;
      } catch (err) {
        const copia = await cache.match(req);
        if (copia) return copia;
        throw err;
      }
    })());
  }
});
