// v31
const CACHE_NAME = 'shiaim-v41';
const GOOD_HTML = 'https://raw.githubusercontent.com/jeru-bs/shiaim/fc784d211c2804714f80be959b4d8527c891087d/index.html';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const htmlResp = await fetch(GOOD_HTML);
      let html = await htmlResp.text();
      html = html.replace(/app\.js\?v=\d+/g, 'app.js?v=28');
      const r1 = new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      const r2 = new Response(html, {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      await cache.put(new Request('./index.html'), r1);
      await cache.put(new Request('./'), r2);
      await cache.addAll(['./app.css', './app.js?v=28', './manifest.json']);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('script.google.com')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
