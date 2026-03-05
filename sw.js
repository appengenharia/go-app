// CFO - Service Worker v1
const CACHE = "cfo-v1";
const ASSETS = [
  "./",
  "./index.html"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // só intercepta GET
  if (e.request.method !== "GET") return;
  // não intercepta Firebase/Cloudinary
  if (e.request.url.includes("firebaseio.com") ||
      e.request.url.includes("googleapis.com") ||
      e.request.url.includes("cloudinary.com")) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(res => {
        // atualiza cache com resposta nova
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    }).catch(() => caches.match("./index.html"))
  );
});
