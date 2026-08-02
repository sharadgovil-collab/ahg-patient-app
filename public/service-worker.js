// Amazing Hearing Patient App -- Service Worker
// Minimal offline-first caching. Adjust CACHE_NAME on every deploy
// so old caches get cleared and patients pull the latest version.

const CACHE_NAME = "ah-patient-app-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Network-first for page loads and API/data calls (so auth redirects and
// fresh deploys always get current code), cache-first for static assets
// (icons, manifest) since those rarely change.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isApiCall = url.pathname.startsWith("/api/");
  const isNavigation = request.mode === "navigate" || request.destination === "document";

  if (isApiCall || isNavigation) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
