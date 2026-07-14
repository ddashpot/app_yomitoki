/* よみとき service worker — アプリの外枠をキャッシュしてオフラインでも起動できるようにする。
   説明機能そのものはネットワーク（Anthropic API）が必要です。 */
const CACHE = "yomitoki-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 別オリジン（AnthropicのAPI・Google Fontsなど）はそのままネットワークへ
  if (url.origin !== self.location.origin) return;
  // 同一オリジンの静的ファイルはキャッシュ優先
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
