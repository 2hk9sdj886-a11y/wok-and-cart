/* Offline support. Bump VERSION whenever app files change so phones pick up the update. */
const VERSION = "wok-cart-1.3.0";
const SHELL = [
  "./", "./index.html", "./styles.css", "./config.js", "./recipes.js", "./sync.js", "./app.js", "./account.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first with a short timeout (weak signal in the store), falling back to cache.
function networkFirst(req, cacheKey) {
  return new Promise(resolve => {
    let settled = false;
    const fromCache = () => caches.match(cacheKey || req, { ignoreSearch: true });
    const t = setTimeout(async () => { const c = await fromCache(); if (c && !settled) { settled = true; resolve(c); } }, 2500);
    // no-cache: always ask GitHub whether the file changed (a cheap 304 when it hasn't)
    fetch(req, { cache: "no-cache" }).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(cacheKey || req, copy)); }
      if (!settled) { settled = true; clearTimeout(t); resolve(res); }
    }).catch(async () => {
      clearTimeout(t);
      if (!settled) { settled = true; resolve((await fromCache()) || Response.error()); }
    });
  });
}
// Fonts rarely change: serve from cache, refresh in the background.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(networkFirst(req, req.mode === "navigate" ? "./index.html" : undefined));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
  // Everything else (Supabase API calls) goes straight to the network.
});
