// Bay Shows PWA - Service Worker
// Cache version — bump this to force full cache refresh
const CACHE_VERSION = ‘bay-shows-v3’;
const DATA_CACHE = ‘bay-shows-data-v1’;

const STATIC_ASSETS = [
‘/’,
‘/index.html’,
‘/auth.html’,
‘/manifest.json’,
‘/icon-192.svg’,
‘/icon-512.svg’,
‘https://unpkg.com/react@18/umd/react.production.min.js’,
‘https://unpkg.com/react-dom@18/umd/react-dom.production.min.js’,
‘https://unpkg.com/@babel/standalone/babel.min.js’,
‘https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400&display=swap’,
‘https://accounts.google.com/gsi/client’,
];

// Install: pre-cache static shell
self.addEventListener(‘install’, (event) => {
event.waitUntil(
caches.open(CACHE_VERSION).then((cache) => {
return cache.addAll(STATIC_ASSETS).catch((err) => {
console.warn(’[SW] Pre-cache partial failure:’, err);
});
}).then(() => self.skipWaiting())
);
});

// Activate: delete old caches
self.addEventListener(‘activate’, (event) => {
event.waitUntil(
caches.keys().then((keys) =>
Promise.all(
keys
.filter((k) => k !== CACHE_VERSION && k !== DATA_CACHE)
.map((k) => caches.delete(k))
)
).then(() => self.clients.claim())
);
});

// Fetch strategy:
//   - Drive JSON export → network-first with DATA_CACHE fallback
//   - Google Fonts → cache-first (long-lived)
//   - Everything else → cache-first with network fallback
self.addEventListener(‘fetch’, (event) => {
const url = new URL(event.request.url);

// Drive data URL — network first, cache on success
if ((url.hostname === ‘docs.google.com’ && url.pathname.includes(‘export’)) || url.hostname === ‘accounts.google.com’) {
event.respondWith(
fetch(event.request)
.then((response) => {
if (response.ok) {
const clone = response.clone();
caches.open(DATA_CACHE).then((cache) => cache.put(event.request, clone));
}
return response;
})
.catch(() => caches.match(event.request))
);
return;
}

// Google Fonts — cache first, very long TTL is fine
if (url.hostname === ‘fonts.googleapis.com’ || url.hostname === ‘fonts.gstatic.com’) {
event.respondWith(
caches.match(event.request).then((cached) => {
if (cached) return cached;
return fetch(event.request).then((response) => {
const clone = response.clone();
caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
return response;
});
})
);
return;
}

// App shell and CDN scripts — cache first
event.respondWith(
caches.match(event.request).then((cached) => {
if (cached) return cached;
return fetch(event.request).then((response) => {
if (response.ok && event.request.method === ‘GET’) {
const clone = response.clone();
caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
}
return response;
}).catch(() => {
// Offline fallback for navigation requests
if (event.request.mode === ‘navigate’) {
return caches.match(’/bay-shows/index.html’) || caches.match(’/index.html’);
}
});
})
);
});

// Message handler: force refresh data cache
self.addEventListener(‘message’, (event) => {
if (event.data && event.data.type === ‘SKIP_WAITING’) {
self.skipWaiting();
}
if (event.data && event.data.type === ‘CLEAR_DATA_CACHE’) {
caches.delete(DATA_CACHE).then(() => {
event.ports[0] && event.ports[0].postMessage({ cleared: true });
});
}
});