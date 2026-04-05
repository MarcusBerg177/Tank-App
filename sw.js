// Tank-App/switch.js
const CACHE_NAME = 'tanken-cache-v2'; // WIEDER ERHÖHT!
const urlsToCache = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  // Zwinge den neuen Worker, SOFORT aktiv zu werden
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Lösche ALLES, was nicht der aktuelle Cache ist
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Übernimm sofort die Kontrolle über alle offenen Fenster
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (
    event.request.url.includes('api.openrouteservice.org') ||
    event.request.url.includes('tankerkoenig.de')
  ) {
    return;
  }
  event.respondWith(
    caches
      .match(event.request)
      .then((response) => response || fetch(event.request))
  );
});
