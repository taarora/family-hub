/* Family Hub — service worker
   Caches the app shell only (this HTML, CSS-in-file, JS, icons, manifest) so
   the dashboard still works if the network blips. Everything that actually
   needs to be live — calendar ICS, weather, Firestore, the ticker wall — is
   fetched fresh over the network and is deliberately NOT cached here,
   otherwise "offline" would mean "stale".

   Strategy: network-first for the shell files, falling back to cache only
   when the network fails. This is a dashboard that's normally on Wi-Fi, so
   freshness matters more than instant-from-cache speed — a network-first
   shell means one app reopen after a deploy is enough to see the update,
   rather than needing two (which a cache-first/stale-while-revalidate
   strategy would require: the first reopen serves the old cached copy while
   quietly refreshing it in the background, and only the second reopen would
   actually show it). Bump CACHE's version suffix whenever this strategy or
   the SHELL list changes, so old cached entries get swept on activate. */

const CACHE = "family-hub-shell-v3";
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
    // {cache:"no-store"} is the actual fix here: fetch(evt.request) alone still lets
    // the browser's own HTTP cache layer (underneath the service worker, driven by
    // python http.server's Last-Modified/heuristic-freshness headers) silently answer
    // without a real network round-trip -- which is indistinguishable from this
    // "network-first" strategy quietly becoming "cache-first" the moment that layer
    // decides a shell file still counts as fresh. no-store forces a genuine fetch.
    fetch(evt.request, {cache: "no-store"}).then(resp => {
      caches.open(CACHE).then(c => c.put(evt.request, resp.clone()));
      return resp;
    }).catch(() => caches.match(evt.request))
  );
});
