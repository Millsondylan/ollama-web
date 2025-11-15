/**
 * Service Worker for Ollama Web
 * Provides offline functionality and caching
 */

const CACHE_NAME = 'ollama-web-v1';
const RUNTIME_CACHE = 'ollama-web-runtime-v1';

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
  // NOTE: styles.css and app.js are NOT cached - served fresh every time
];

// API routes that should never be cached
const NO_CACHE_ROUTES = [
  '/api/chat',
  '/api/chat/stream',
  '/api/generate',
  '/api/github'
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching core assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip caching for API routes that should always be fresh
  const isNoCache = NO_CACHE_ROUTES.some((route) => url.pathname.startsWith(route));

  if (isNoCache) {
    // Network only for real-time API calls
    event.respondWith(
      fetch(request)
        .catch((error) => {
          console.warn('[SW] Network request failed:', url.pathname);
          return new Response(
            JSON.stringify({
              error: 'Offline',
              message: 'You are currently offline. This feature requires an internet connection.'
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // ALWAYS FRESH for CSS/JS - never cache these
  if (request.method === 'GET' && (
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  )) {
    event.respondWith(
      fetch(request).catch(() => new Response('Offline', { status: 503 }))
    );
    return;
  }

  // Cache-first strategy for HTML and static assets
  if (request.method === 'GET' && (
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.json') ||
    url.pathname === '/'
  )) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            console.log('[SW] Serving from cache:', url.pathname);
            return cachedResponse;
          }

          return fetch(request)
            .then((networkResponse) => {
              // Cache successful responses
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(RUNTIME_CACHE)
                  .then((cache) => {
                    cache.put(request, responseToCache);
                  });
              }
              return networkResponse;
            })
            .catch((error) => {
              console.warn('[SW] Fetch failed, returning offline page:', error);
              // Return a basic offline page if available
              return caches.match('/index.html');
            });
        })
    );
    return;
  }

  // Network-first strategy for API calls
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Cache successful GET requests
        if (request.method === 'GET' && networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(RUNTIME_CACHE)
            .then((cache) => {
              cache.put(request, responseToCache);
            });
        }
        return networkResponse;
      })
      .catch((error) => {
        console.warn('[SW] Network failed, trying cache:', url.pathname);
        return caches.match(request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            throw error;
          });
      })
  );
});

// Background sync for queued messages (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    console.log('[SW] Background sync triggered for messages');
    event.waitUntil(syncMessages());
  }
});

async function syncMessages() {
  try {
    // This would sync any queued messages when connection is restored
    console.log('[SW] Syncing queued messages...');
    // Implementation would go here
    return Promise.resolve();
  } catch (error) {
    console.error('[SW] Message sync failed:', error);
    return Promise.reject(error);
  }
}

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
