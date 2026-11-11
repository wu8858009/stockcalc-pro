/* 雲端（Google Apps Script 網頁應用程式）網址：部署後填入。
   本機測試時可用 ?api=http://localhost:8790 改接模擬後端（只在 localhost 有效）。 */
window.CONFIG = {
  CLOUD_URL: "https://script.google.com/macros/s/AKfycbzVDIz2sbkaMLLyo7T6RsVNJTsi_Vjc-6V44GzSDvu61QejS4qGpxnqYeGwFlGny-Yd/exec",
};
(function () {
  const q = new URLSearchParams(location.search).get("api");
  if (q && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(q)) window.CONFIG.CLOUD_URL = q;
})();
