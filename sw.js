// v92 — network-first shell (no pinned/old-commit HTML)
const CACHE_NAME = 'shiaim-v92';

// Install: activate immediately, no stale precache.
self.addEventListener('install', e => {
  self.skipWaiting();
});

// Activate: drop all old caches, take control at once.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // Only manage same-origin GET. Everything else — in particular the backend
  // API calls (cross-origin POST to script.google.com) — must go straight to
  // the network untouched. Previously the SW re-issued those POSTs itself;
  // on some browsers re-fetching a POST body failed and the SW swallowed it as
  // "offline", which surfaced as "שרת ההגדרות לא זמין" and blocked login.
  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (err) {}
  if (req.method !== 'GET' || !sameOrigin) return;

  // Navigation (index.html): always revalidate against the server so a new
  // deploy is picked up without a hard refresh; fall back to cache offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(m => m || caches.match('./')))
    );
    return;
  }

  // Other same-origin assets (app.js, app.css, images, manifest):
  // network-first so fresh versions win online; cache fallback offline.
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
