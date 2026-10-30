/* The Chattanooga Thrift Trail: offline support.
   - The page itself is always fetched fresh when you're online (so updates arrive automatically)
     and the last good copy is used when you're offline.
   - Map library, fonts and map tiles you've already viewed are kept for offline use.
   - Live things (route lines, reviews, analytics) are never stored. */
var VERSION = 'ctt-v2';
var SHELL_CACHE = VERSION + '-shell';
var RUNTIME_CACHE = VERSION + '-runtime';
var TILE_CACHE = VERSION + '-tiles';
var MAX_TILES = 400;
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon.ico'];
var RUNTIME_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function(c) {
      return Promise.all(SHELL.map(function(u) { return c.add(u).catch(function() {}); }));
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k.indexOf(VERSION) !== 0; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

function trim(cacheName, max) {
  return caches.open(cacheName).then(function(c) {
    return c.keys().then(function(keys) {
      if (keys.length <= max) return;
      return Promise.all(keys.slice(0, keys.length - max).map(function(k) { return c.delete(k); }));
    });
  });
}

function staleWhileRevalidate(req, cacheName, max) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(req).then(function(hit) {
      var net = fetch(req).then(function(res) {
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone()).then(function() { if (max) trim(cacheName, max); });
        }
        return res;
      }).catch(function() { return hit; });
      return hit || net;
    });
  });
}

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (req.cache === 'no-store') return; // the page's own "is there a newer version?" check always goes to the network

  // The page: network first, saved copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then(function(res) {
        if (res && res.ok && url.origin === self.location.origin) {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function(c) { c.put(req, copy); });
        }
        return res;
      }).catch(function() {
        return caches.match(req, { ignoreSearch: true }).then(function(hit) {
          return hit || caches.match('index.html') || caches.match('./');
        });
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req, TILE_CACHE, MAX_TILES));
    return;
  }
  if (RUNTIME_HOSTS.indexOf(url.hostname) !== -1) {
    e.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }
  // everything else (routing, reviews, analytics) goes straight to the network
});
