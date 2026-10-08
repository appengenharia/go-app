// GO - Service Worker v4 - Network First
const CACHE = "go-v4";

self.addEventListener("install", e => {
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k =>
            k.startsWith("cfo-") ||
            k.startsWith("go-")
          )
          .filter(k => k !== CACHE)
          .map(k => caches.delete(k))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;

  const networkResponse = fetch(e.request);
  const cacheWrite = networkResponse
    .then(res => caches.open(CACHE).then(cache => cache.put(e.request, res.clone())))
    .catch(() => undefined);

  e.waitUntil(cacheWrite);
  e.respondWith(networkResponse.catch(() => caches.match(e.request)));
});
