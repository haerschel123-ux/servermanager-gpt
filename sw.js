"use strict";

const CACHE = "dayz-manager-v2";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "direct.js", "map.js",
  "editor.js", "tools.js", "manifest.webmanifest", "icon.svg",
  "vendor/leaflet/leaflet.css", "vendor/leaflet/leaflet.js",
  "vendor/leaflet/images/layers.png", "vendor/leaflet/images/layers-2x.png",
  "loadout/", "loadout/index.html", "loadout/browse.html",
  "loadout/style.css", "loadout/data.js", "loadout/examples.js",
  "loadout/loadout.js", "loadout/browse.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.includes("/api/")) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => {
    if (cached) return cached;
    if (event.request.mode === "navigate") return caches.match("index.html");
    return Response.error();
  })));
});
