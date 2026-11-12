// Service worker de l'application installable : l'application (HTML, scripts, polices) est gardée sur le poste ;
// les lectures de l'API passent par le réseau et, sans réseau, par la dernière réponse connue.
const VERSION = 'gs-v2';
const COQUE = ['/', '/index.html', '/manifest.webmanifest', '/icone.svg', '/icone-192.png', '/icone-512.png', '/marque/sekou-logo-sombre.svg', '/marque/sekou-logo-signature-sombre.svg', '/marque/sekou-logo.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname.startsWith('/api/')) {
    // Documents (PDF, CSV) : jamais gardés. Données JSON : réseau d'abord, dernière réponse sinon.
    if (/\/(recu|document|export|fiche|piece|photo|images)/.test(u.pathname) || u.search.includes('format=')) return;
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); }
      return r;
    }).catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ code: 'RESEAU', detail: 'Hors ligne : dernière information connue indisponible.' }), { status: 503, headers: { 'content-type': 'application/json' } }))));
    return;
  }
  // Navigation : l'application d'une seule page, depuis le cache si le réseau manque.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const copie = r.clone(); caches.open(VERSION).then((c) => c.put('/index.html', copie)); return r; })
      .catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => {
    if (r.ok && (u.pathname.startsWith('/assets/') || u.pathname.startsWith('/polices/') || u.pathname.startsWith('/marque/'))) { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); }
    return r;
  })));
});
