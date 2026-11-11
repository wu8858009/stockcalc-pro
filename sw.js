/* 離線快取：程式檔案先用網路（拿最新版），失敗才用快取；資料一律走網路（Apps Script）。 */
const CACHE = "stockcalc-v1.35.0-m2";
const FILES = ["./", "index.html", "manifest.webmanifest", "css/styles.css", "icons/icon-64.png", "icons/icon-192.png",
  "js/config.js", "js/content.js", "js/core.js", "js/predict.js", "js/market.js", "js/ui.js", "js/store.js", "js/page_watch.js", "js/page_hot.js",
  "js/page_chart.js", "js/page_div.js", "js/page_predict_calc.js", "js/page_order.js", "js/page_settings.js", "js/page_info_help.js", "js/app.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow("./"))));
});
