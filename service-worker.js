// Offline cache for the installable PWA. Cache-first with background refresh.
const CACHE = 'tracklands-v2.0.0';
const ASSETS = [
  './',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './index.html',
  './manifest.json',
  './src/Game.js',
  './src/debug/RailTests.js',
  './src/debug/RailFuzz.js',
  './src/ui/RailUI.js',
  './src/ui/Overlays.js',
  './src/rail/RailFurniture.js',
  './src/trains/Consist.js',
  './src/i18n_rail.js',
  './src/audio/Audio.js',
  './src/config.js',
  './src/core/CameraController.js',
  './src/core/Input.js',
  './src/core/ModelBuilder.js',
  './src/economy/Economy.js',
  './src/i18n.js',
  './src/main.js',
  './src/progression/Progression.js',
  './src/progression/Stats.js',
  './src/rail/Construction.js',
  './src/rail/RailNetwork.js',
  './src/rail/RailRenderer.js',
  './src/rail/Stations.js',
  './src/save/Save.js',
  './src/services/Monetization.js',
  './src/title/TitleScene.js',
  './src/trains/TrainModels.js',
  './src/trains/Trains.js',
  './src/ui/Tutorial.js',
  './src/ui/UI.js',
  './src/ui/icons.js',
  './src/util.js',
  './src/vfx/Particles.js',
  './src/world/Decor.js',
  './src/world/Environment.js',
  './src/world/Industries.js',
  './src/world/Towns.js',
  './src/world/WorldGen.js',
  './src/world/WorldView.js',
  './styles/main.css',
  './vendor/three/LICENSE',
  './vendor/three/three.core.js',
  './vendor/three/three.module.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || net;
    })
  );
});
