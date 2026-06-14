/* ================================================================
   فروتز PWA — Service Worker v1.0
   ميزات: التخزين المؤقت + مزامنة الخلفية + إشعارات Push
================================================================ */
'use strict';

const CACHE_NAME     = 'fruitz-v1.2';
const OFFLINE_URL    = '/offline.html';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html',
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&family=Cairo:wght@400;600;700;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

/* ─── INSTALL ─── */
self.addEventListener('install', function(event) {
  console.log('[SW] Installing Fruitz Service Worker…');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('[SW] Caching app shell…');
        return cache.addAll(ASSETS_TO_CACHE.filter(url => !url.startsWith('http')));
      })
      .then(function() {
        return self.skipWaiting();
      })
      .catch(function(err) {
        console.warn('[SW] Cache install error (non-fatal):', err);
        return self.skipWaiting();
      })
  );
});

/* ─── ACTIVATE ─── */
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating Fruitz Service Worker…');
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function(name) { return name !== CACHE_NAME; })
            .map(function(name) {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(function() {
        return self.clients.claim();
      })
  );
});

/* ─── FETCH (Network First → Cache Fallback) ─── */
self.addEventListener('fetch', function(event) {
  var req = event.request;

  /* Skip non-GET and chrome-extension */
  if (req.method !== 'GET') return;
  if (req.url.startsWith('chrome-extension')) return;

  /* Images → Cache First */
  if (req.destination === 'image') {
    event.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(resp) {
          if (!resp || resp.status !== 200) return resp;
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, clone); });
          return resp;
        }).catch(function() {
          return new Response('', { status: 404 });
        });
      })
    );
    return;
  }

  /* Navigation → Network First with Offline fallback */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function() {
        return caches.match(OFFLINE_URL).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
    );
    return;
  }

  /* Everything else → Stale-While-Revalidate */
  event.respondWith(
    caches.match(req).then(function(cached) {
      var networkFetch = fetch(req).then(function(resp) {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, clone); });
        }
        return resp;
      }).catch(function() { return null; });

      return cached || networkFetch;
    })
  );
});

/* ─── PUSH NOTIFICATIONS ─── */
self.addEventListener('push', function(event) {
  var data = {};
  if (event.data) {
    try { data = event.data.json(); }
    catch(e) { data = { title: 'فروتز 🍊', body: event.data.text() }; }
  }

  var title   = data.title   || 'فروتز 🍊';
  var options = {
    body:    data.body    || 'لديك رسالة جديدة من فروتز!',
    icon:    data.icon    || '/icons/icon-192.png',
    badge:   data.badge   || '/icons/badge-72.png',
    image:   data.image   || null,
    tag:     data.tag     || 'fruitz-notification',
    data:    data.data    || { url: '/' },
    actions: data.actions || [
      { action: 'view',    title: '🛒 اطلب الآن' },
      { action: 'dismiss', title: '✕ إغلاق'     }
    ],
    requireInteraction: data.requireInteraction || false,
    dir:   'rtl',
    lang:  'ar',
    vibrate: [100, 50, 100]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/* ─── NOTIFICATION CLICK ─── */
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var action = event.action;
  var targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';

  if (action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(windowClients) {
        /* إذا كان الموقع مفتوحاً → أحضره للأمام */
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            if (targetUrl !== '/') client.navigate(targetUrl);
            return;
          }
        }
        /* وإلا → افتح نافذة جديدة */
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

/* ─── BACKGROUND SYNC (مزامنة السلة عند عودة الإنترنت) ─── */
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-cart') {
    event.waitUntil(syncCart());
  }
  if (event.tag === 'sync-order') {
    event.waitUntil(syncPendingOrders());
  }
});

function syncCart() {
  return clients.matchAll().then(function(clients) {
    clients.forEach(function(client) {
      client.postMessage({ type: 'CART_SYNCED', payload: { timestamp: Date.now() } });
    });
  });
}

function syncPendingOrders() {
  /* في بيئة إنتاجية: أرسل الطلبات المعلقة إلى الـ API */
  return clients.matchAll().then(function(clients) {
    clients.forEach(function(client) {
      client.postMessage({ type: 'ORDERS_SYNCED', payload: { timestamp: Date.now() } });
    });
  });
}

/* ─── MESSAGE من الصفحة ─── */
self.addEventListener('message', function(event) {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'GET_CACHE_SIZE':
      getCacheSize().then(function(size) {
        event.ports[0].postMessage({ size: size });
      });
      break;
  }
});

function getCacheSize() {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.keys().then(function(keys) { return keys.length; });
  });
}
