/**
 * Service worker of Gym Check: precaches the app shell and the vendored Chart.js for offline use.
 * Chart.js (pinned version) is served cache-first, own files network-first with cache fallback.
 */

const CACHE_PREFIX = 'gym-check-';
const CACHE = `${CACHE_PREFIX}v4`;
const NETWORK_TIMEOUT_MS = 3000;
const CHART_URL = new URL('vendor/chart.umd.min.js', self.location).href;
const LOCAL_FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'i18n.js',
  'effects.js',
  'parse.js',
  'stats.js',
  'muscles.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
];

/**
 * Precaches the app shell and Chart.js.
 * @returns {Promise<void>}
 */
async function precache() {
  const cache = await caches.open(CACHE);
  await cache.addAll([...LOCAL_FILES, CHART_URL]);
}

/**
 * Deletes older Gym Check caches (other caches of the origin stay untouched) and takes control of open pages.
 * @returns {Promise<void>}
 */
async function cleanUp() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
  await self.clients.claim();
}

/**
 * Answers from the cache and falls back to the network, caching the response.
 * @param {Request} request Request.
 * @returns {Promise<Response>} Response.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Answers from the network and updates the cache; offline or after a timeout falls back to the cache and,
 * for navigations, to index.html.
 * @param {Request} request Request.
 * @returns {Promise<Response>} Response.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      return cached;
    }
    if (request.mode === 'navigate') {
      const shell = await caches.match('index.html');
      if (shell) {
        return shell;
      }
    }
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(cleanUp());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }
  if (request.url === CHART_URL) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (new URL(request.url).origin !== self.location.origin) {
    return;
  }
  event.respondWith(networkFirst(request));
});
