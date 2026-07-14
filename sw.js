/* よみとき service worker
   アプリの外枠＋読み上げエンジン(eSpeak NG)をキャッシュし、オフラインでも起動・読み上げできるようにする。
   説明生成(API)・Google連携はネットワークが必要。別オリジンはキャッシュしない。 */
const CACHE = "yomitoki-v3";
const CORE = [
  "./", "./index.html", "./styles.css", "./app.js", "./tts.js", "./gdrive.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png",
  "./espeak-ng.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // API・Google・Fontsはネットワークへ

  // キャッシュ優先。無ければ取得してキャッシュに追加（大きな espeak-ng.wasm を初回利用時に保存）
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res && res.ok && (res.type === "basic" || res.type === "default")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
