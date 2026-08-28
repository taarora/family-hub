/* Family Hub — service worker
   Caches the app shell only (this HTML, CSS-in-file, JS, icons, manifest) so
   the dashboard chrome loads instantly and works if the network blips.
   Everything that actually needs to be live — calendar ICS, weather,
   Firestore, the ticker wall — is fetched fresh over the network and is
   deliberately NOT cached here, otherwise "offline" would mean "stale". */

const CACHE = "family-hub-shell-v1";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (evt) => {
  evt.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evt) => {
  const url = new URL(evt.request.url);
  const isShellFile = url.origin === self.location.origin && SHELL.some(s => url.pathname.endsWith(s.replace("./", "")));
  if (!isShellFile) return; // let everything else (APIs, iframe, CDN scripts) go straight to the network

  evt.respondWith(
    caches.match(evt.request).then(cached => {
      const network = fetch(evt.request).then(resp => {
        caches.open(CACHE).then(c => c.put(evt.request, resp.clone()));
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
