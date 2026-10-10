// GO - Service Worker v5 - Network First
const CACHE = "go-v5-notas-prod";

self.addEventListener("install", e => {
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(self.clients.claim());

});

self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;

  const networkResponse = fetch(e.request);
  const cacheWrite = networkResponse
    .then(res => caches.open(CACHE).then(cache => cache.put(e.request, res.clone())))
    .catch(() => undefined);

  e.waitUntil(cacheWrite);
  e.respondWith(networkResponse.catch(async () => {
    const atual = await caches.open(CACHE);
    return (await atual.match(e.request)) || caches.match(e.request);
  }));
});
