"use strict";

const CACHE_PREFIX = "servermanager-gpt-dayz-manager-";
const CACHE = CACHE_PREFIX + "v3";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "direct.js", "map.js",
  "editor.js", "tools.js", "manifest.webmanifest", "icon.svg",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png",
  "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js",
  "vendor/leaflet/images/layers.png", "vendor/leaflet/images/layers-2x.png",
  "loadout/", "loadout/index.html", "loadout/about.html",
  "loadout/browse-loadouts.html", "loadout/generator.js",
  "loadout/loadout.css", "loadout/data.js", "loadout/browse.js",
  "loadout/vendor/bootstrap.min.css",
  "loadout/vendor/bootstrap.bundle.min.js",
  "loadout/vendor/sweetalert2.min.css",
  "loadout/vendor/sweetalert2.min.js",
  "loadout/vendor/tabler-icons.min.css",
  "loadout/vendor/fonts/tabler-icons.ttf",
  "loadout/vendor/fonts/tabler-icons.woff",
  "loadout/vendor/fonts/tabler-icons.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.includes("/api/")) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      if (event.request.mode === "navigate") return cache.match("index.html");
      return Response.error();
    }
  })());
});
