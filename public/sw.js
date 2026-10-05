// public/sw.js -- Hopper service worker.
//
// RULE ONE: never serve a cached page or API response while the network
// works. Hopper burned an afternoon in July 2026 on stale data (Vercel's Data
// Cache), so pages and data are strictly network-first; the cache is only a
// fallback for when there is no connection at all. Only content-hashed build
// assets and map tiles are cache-first, because they never change.
//
// What works offline:
//   - the 10 most recently opened deals (every tab you visited) + /deals
//   - their site signals and demand results (GET /api/deals/:id/signals)
//   - map tiles you've already looked at
// Writes are never cached or replayed here; the notes outbox lives in the page
// (components/ServiceWorker.tsx).

const VERSION = "v1";
const PAGES = `hopper-pages-${VERSION}`;
const API = `hopper-api-${VERSION}`;
const STATIC = `hopper-static-${VERSION}`;
const TILES = `hopper-tiles-${VERSION}`;
const MAX_DEALS = 10;
const MAX_TILES = 800;
const DEAL_RE = /^\/deals\/([0-9a-f-]{36})(?:\/|$)/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.addAll(["/offline", "/logo-white.svg", "/logo-navy.svg"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hopper-") && !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  // Sign-out: cached pages hold deal data, so drop them.
  if (event.data === "clear") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("hopper-")).map((k) => caches.delete(k)))));
  }
});

const isTile = (url) =>
  /fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org|basemaps\.cartocdn\.com|arcgisonline\.com\/ArcGIS\/rest\/services\/.*\/tile\//.test(url.href);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (isTile(url)) {
    event.respondWith(cacheFirst(req, TILES, MAX_TILES));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa-icon/")) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(navigate(req, url));
    return;
  }

  if (/^\/api\/deals\/[0-9a-f-]{36}\/signals$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req, API));
  }
});

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    cache.put(req, res.clone());
    if (max) trim(cache, max);
  }
  return res;
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

async function navigate(req, url) {
  const cache = await caches.open(PAGES);
  const deal = url.pathname.match(DEAL_RE);
  const keep = deal || url.pathname === "/deals";
  try {
    const res = await fetch(req);
    // Never cache the login redirect or an error page as if it were the deal.
    if (keep && res.ok && !res.redirected) {
      await cache.put(req, res.clone());
      if (deal) await touchDeal(cache, deal[1]);
    }
    return res;
  } catch (e) {
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
    return hit || (await cache.match("/offline")) || Response.error();
  }
}

// Keep pages for the MAX_DEALS most recently opened deals; evict the rest.
async function touchDeal(cache, id) {
  const META = "/__hopper-recent-deals";
  let list = [];
  try {
    const m = await cache.match(META);
    if (m) list = await m.json();
  } catch {}
  list = [id, ...list.filter((x) => x !== id)];
  const evict = list.slice(MAX_DEALS);
  list = list.slice(0, MAX_DEALS);
  await cache.put(META, new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } }));
  if (!evict.length) return;
  const keys = await cache.keys();
  await Promise.all(
    keys.filter((k) => evict.some((id) => new URL(k.url).pathname.startsWith(`/deals/${id}`))).map((k) => cache.delete(k))
  );
  const api = await caches.open(API);
  const apiKeys = await api.keys();
  await Promise.all(apiKeys.filter((k) => evict.some((id) => k.url.includes(`/api/deals/${id}/`))).map((k) => api.delete(k)));
}

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}
