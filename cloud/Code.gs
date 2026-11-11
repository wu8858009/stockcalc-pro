/* 股票計算與持股 企業版 PRO — 網頁版後端（綁定在 Google 試算表的 Apps Script）。
   1. 資料：交易、股利、自選、觸價單、設定，每筆一列（id ＋ 方便人看的欄位 ＋ 最後一欄完整 JSON）。
      網頁版與電腦版都用 apply（差異）寫入、rev 版本號偵測對方的更新。
   2. 行情轉送：瀏覽器不能跨網域讀 Yahoo／證交所，由這裡代抓（只允許白名單網站）。
   3. 網頁下單：網頁把委託放進「網頁委託」佇列，開著的電腦版取走、用元大 API 送出、回寫結果。
   部署：執行身分「我」、存取權「任何人」；資料靠密碼保護。 */

var SHEETS = {
  transactions: { name: "交易紀錄", head: ["id", "日期", "代號", "名稱", "買賣", "股數", "價格", "手續費", "證交稅", "備註", "data"] },
  dividends: { name: "股利紀錄", head: ["id", "日期", "代號", "名稱", "現金股利", "配股(股)", "備註", "data"] },
  watchlist: { name: "自選觀察", head: ["id", "代號", "名稱", "買進目標", "賣出目標", "加入日", "備註", "data"] },
  triggers: { name: "觸價單", head: ["id", "建立", "代號", "名稱", "買賣", "條件", "觸發價", "委託價", "股數", "期限", "狀態", "結果", "data"] },
  settings: { name: "設定", head: ["id", "data"] }
};
var COLLECTIONS = Object.keys(SHEETS);
var ORDER_SHEET = "網頁委託", ORDER_HEAD = ["id", "時間", "種類", "代號", "內容", "狀態", "結果", "data"];
var SESSION_DAYS = 60;
var CELL_LIMIT = 49000;
var FETCH_HOSTS = ["tw.stock.yahoo.com", "query1.finance.yahoo.com", "query2.finance.yahoo.com", "mis.twse.com.tw",
  "openapi.twse.com.tw", "www.twse.com.tw", "www.tpex.org.tw"];

// 第一次部署後在編輯器手動執行一次：跳出 Google 授權並建立工作表
function authorizeOnce() {
  ensureSheets_();
  UrlFetchApp.fetch("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", { muteHttpExceptions: true });
}

function doGet() { return json_({ ok: true, app: "stockcalc" }); }

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ error: "bad_request" }); }
  try {
    var pub = { status: status_, setup: setup_, login: login_ };
    if (pub[req.action]) return json_(pub[req.action](req));
    if (!tokenOk_(req.token)) return json_({ error: "auth" });
    var priv = {
      rev: rev_, load: load_, apply: apply_, restore: restore_, logout: logout_, changePassword: changePassword_,
      fetch: fetch_,
      orderSubmit: orderSubmit_, orderList: orderList_, orderCancel: orderCancel_,
      orderPull: orderPull_, orderDone: orderDone_, reportPush: reportPush_
    };
    if (!priv[req.action]) return json_({ error: "unknown_action" });
    return json_(priv[req.action](req));
  } catch (err) {
    return json_({ error: "server", message: String(err && err.message || err) });
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function cache_() { return CacheService.getScriptCache(); }
function sha_(s) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function same_(a, b) {
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function randomToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""); }
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function now_() { return Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss"); }

// ---- 密碼：瀏覽器／電腦版先用 PBKDF2-SHA256（21 萬次）算出 key，這裡只存 key 的雜湊 ----
function status_() {
  var p = props_(), salt = p.getProperty("salt");
  if (!salt) { salt = randomToken_(); p.setProperty("salt", salt); }
  return { needsSetup: !p.getProperty("pwHash"), salt: salt };
}
function hashKey_(key) { return sha_(props_().getProperty("salt") + ":" + key); }
function setup_(req) {
  return withLock_(function () {
    if (props_().getProperty("pwHash")) return { error: "already_setup" };
    if (!req.key) return { error: "bad_request" };
    status_();
    props_().setProperty("pwHash", hashKey_(req.key));
    ensureSheets_();
    return { token: issueToken_(req.device) };
  });
}
function login_(req) {
  var fails = Number(cache_().get("loginFails") || 0);
  if (fails >= 10) return { error: "locked" };              // 連續錯太多次先鎖 10 分鐘
  var h = props_().getProperty("pwHash");
  if (!h) return { error: "needs_setup" };
  if (!req.key || !same_(hashKey_(req.key), h)) {
    cache_().put("loginFails", String(fails + 1), 600);
    return { error: "wrong_password" };
  }
  cache_().remove("loginFails");
  return { token: issueToken_(req.device) };
}
function issueToken_(device) {
  var t = randomToken_();
  props_().setProperty("tok_" + sha_(t), JSON.stringify({ e: Date.now() + SESSION_DAYS * 86400000, d: String(device || "").slice(0, 40) }));
  pruneTokens_();
  return t;
}
function pruneTokens_() {
  var p = props_(), all = p.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("tok_") === 0) { try { if (JSON.parse(all[k]).e <= Date.now()) p.deleteProperty(k); } catch (e) { p.deleteProperty(k); } }
  });
}
function tokenOk_(t) {                   // 幾秒一次的同步走快取，避開 PropertiesService 每日讀取上限
  if (!t) return false;
  var hash = sha_(String(t)), hit = cache_().get("tk_" + hash);
  if (hit) return true;
  var v = props_().getProperty("tok_" + hash);
  if (!v) return false;
  var e = JSON.parse(v).e;
  if (e <= Date.now()) return false;
  cache_().put("tk_" + hash, "1", Math.min(21600, Math.floor((e - Date.now()) / 1000)));
  return true;
}
function logout_(req) {
  var hash = sha_(String(req.token));
  props_().deleteProperty("tok_" + hash);
  cache_().remove("tk_" + hash);
  return { ok: true };
}
function changePassword_(req) {
  if (!req.key || !same_(hashKey_(req.key), props_().getProperty("pwHash"))) return { error: "wrong_password" };
  if (!req.newKey) return { error: "bad_request" };
  props_().setProperty("pwHash", hashKey_(req.newKey));
  var p = props_(), all = p.getProperties();                  // 其他裝置全部登出
  Object.keys(all).forEach(function (k) { if (k.indexOf("tok_") === 0) p.deleteProperty(k); });
  return { token: issueToken_(req.device) };
}

// ---- 試算表 ----
function ensureSheets_() {
  var ss = SpreadsheetApp.getActive();
  COLLECTIONS.forEach(function (c) { mkSheet_(ss, SHEETS[c].name, SHEETS[c].head); });
  mkSheet_(ss, ORDER_SHEET, ORDER_HEAD);
}
function mkSheet_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat("@");   // 全部當文字，日期不被自動轉換
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}
function sheetByName_(name, head) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(name);
  return sh || mkSheet_(ss, name, head);
}
function sheet_(c) { return sheetByName_(SHEETS[c].name, SHEETS[c].head); }
function safe_(v) {                       // 文字不能被試算表當成公式
  var s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function view_(c, d) {                    // 給人看的欄位（程式只讀最後一欄 JSON）
  if (c === "transactions") return [d.date, d.symbol, d.name, d.type === "sell" ? "賣出" : "買進", d.shares, d.price, d.fee, d.tax, d.note || ""];
  if (c === "dividends") return [d.date, d.symbol, d.name, d.cash, d.stock_shares || 0, d.note || ""];
  if (c === "watchlist") return [d.symbol, d.name, d.buy_target || "", d.sell_target || "", d.added || "", d.note || ""];
  if (c === "triggers") return [d.created, d.symbol, d.name, d.side === "S" ? "賣" : "買", d.cond, d.trigger, d.market ? "市價" : d.price, d.shares, d.expire || "直到取消", d.status, d.result || ""];
  return [];
}
function toRow_(c, id, data) {
  var n = SHEETS[c].head.length, row = [String(id)], v = view_(c, data);
  for (var i = 0; i < n - 2; i++) row.push(safe_(v[i]));
  var s = JSON.stringify(data);
  if (s.length > CELL_LIMIT) throw new Error("單筆資料過大：" + c + " " + id);
  row.push(s);
  return row;
}
function readAll_(c) {
  var sh = sheet_(c), last = sh.getLastRow();
  if (last < 2) return [];
  var n = SHEETS[c].head.length;
  return sh.getRange(2, 1, last - 1, n).getValues().map(function (r) { return [String(r[0]), JSON.parse(r[n - 1])]; });
}
function revision_() {
  var v = cache_().get("rev");
  if (v !== null) return Number(v);
  v = Number(props_().getProperty("rev") || 0);
  cache_().put("rev", String(v), 21600);
  return v;
}
function bump_() {
  var r = Number(props_().getProperty("rev") || 0) + 1;
  props_().setProperty("rev", String(r));
  cache_().put("rev", String(r), 21600);
  return r;
}
function orev_() { return Number(cache_().get("orev") || 0); }
function obump_() { var r = Date.now(); cache_().put("orev", String(r), 21600); return r; }

function rev_() { return { rev: revision_(), orev: orev_() }; }

function load_() {
  var out = { rev: revision_() };
  ["transactions", "dividends", "watchlist", "triggers"].forEach(function (c) {
    out[c] = readAll_(c).map(function (r) { return r[1]; });
  });
  var settings = {};
  readAll_("settings").forEach(function (r) { settings[r[0]] = r[1]; });
  out.settings = settings;
  return out;
}
// ops = { 集合: { upsert: [{id, data}], del: [id] } }
function applyCollection_(c, ops) {
  if (!ops || (!(ops.upsert || []).length && !(ops.del || []).length)) return 0;
  var sh = sheet_(c), n = SHEETS[c].head.length, last = sh.getLastRow();
  var ids = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  var rowOf = {}, fresh = [], cnt = 0;
  ids.forEach(function (r, i) { rowOf[String(r[0])] = i + 2; });
  (ops.upsert || []).forEach(function (item) {
    var row = toRow_(c, item.id, item.data), at = rowOf[String(item.id)];
    if (at > 0) sh.getRange(at, 1, 1, n).setValues([row]);
    else if (at === -1) fresh[fresh.findIndex(function (f) { return f[0] === String(item.id); })] = row;
    else { fresh.push(row); rowOf[String(item.id)] = -1; }
    cnt++;
  });
  if (fresh.length) sh.getRange(last + 1, 1, fresh.length, n).setNumberFormat("@").setValues(fresh);
  var rows = (ops.del || []).map(function (id) { return rowOf[String(id)]; }).filter(function (r) { return r > 0; });
  rows.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); cnt++; });
  return cnt;
}
function apply_(req) {
  return withLock_(function () {
    var before = revision_(), n = 0;
    COLLECTIONS.forEach(function (c) { n += applyCollection_(c, (req.ops || {})[c]); });
    return { rev: n ? bump_() : before, prevRev: before };
  });
}
function restore_(req) {                  // 整份覆蓋：第一次把電腦版資料上傳
  return withLock_(function () {
    ensureSheets_();
    COLLECTIONS.forEach(function (c) {
      var sh = sheet_(c), n = SHEETS[c].head.length, last = sh.getLastRow();
      if (last >= 2) sh.deleteRows(2, last - 1);
      var items = (req.data || {})[c] || [];
      var rows = items.map(function (it) { return toRow_(c, it.id, it.data); });
      if (rows.length) sh.getRange(2, 1, rows.length, n).setNumberFormat("@").setValues(rows);
    });
    return { rev: bump_() };
  });
}

// ---- 行情轉送 ----
function hostOf_(url) { var m = /^https:\/\/([^\/?#]+)/.exec(url); return m ? m[1].toLowerCase() : ""; }
function fetch_(req) {
  var list = (req.urls || []).slice(0, 20), out = new Array(list.length), todo = [], idx = [];
  var cache = cache_();
  list.forEach(function (it, i) {
    var url = typeof it === "string" ? it : it.url, ttl = Math.min(Number((it && it.ttl) || 0), 21600);
    if (FETCH_HOSTS.indexOf(hostOf_(url)) < 0) { out[i] = { status: 0, error: "host_not_allowed" }; return; }
    if (ttl > 0) {
      var hit = cache.get("f_" + sha_(url));
      if (hit !== null) { out[i] = { status: 200, text: hit, cached: true }; return; }
    }
    var host = hostOf_(url), headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
    if (host === "tw.stock.yahoo.com") headers.Referer = "https://tw.stock.yahoo.com/";
    if (host === "mis.twse.com.tw") headers.Referer = "https://mis.twse.com.tw/stock/index.jsp";
    todo.push({ url: url, headers: headers, muteHttpExceptions: true, followRedirects: true });
    idx.push([i, ttl, url]);
  });
  if (todo.length) {
    var res;
    try { res = UrlFetchApp.fetchAll(todo); } catch (e) { res = todo.map(function () { return null; }); }
    res.forEach(function (r, k) {
      var i = idx[k][0], ttl = idx[k][1], url = idx[k][2];
      if (!r) { out[i] = { status: 0, error: "fetch_failed" }; return; }
      var text = r.getContentText("UTF-8"), code = r.getResponseCode();
      out[i] = { status: code, text: text };
      if (code === 200 && ttl > 0 && text.length < 90000) { try { cache.put("f_" + sha_(url), text, ttl); } catch (e) { /* 太大就不快取 */ } }
    });
  }
  return { results: out };
}

// ---- 網頁下單佇列：網頁送進來，電腦版取走執行 ----
function orderSheet_() { return sheetByName_(ORDER_SHEET, ORDER_HEAD); }
function orderRows_() {
  var sh = orderSheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, ORDER_HEAD.length).getValues().map(function (r, i) {
    return { row: i + 2, data: JSON.parse(r[ORDER_HEAD.length - 1]) };
  });
}
function putOrder_(sh, row, d) {
  var line = [d.id, d.created, d.kind === "cancel" ? "刪單" : "新委託", d.symbol || "", safe_(d.summary || ""), d.status, safe_(d.result || ""), JSON.stringify(d)];
  if (row) sh.getRange(row, 1, 1, line.length).setValues([line]);
  else sh.appendRow(line);
}
function orderSubmit_(req) {
  return withLock_(function () {
    var o = req.order || {};
    var d = { id: Utilities.getUuid().slice(0, 12), created: now_(), kind: o.kind === "cancel" ? "cancel" : "new", status: "pending",
      symbol: String(o.symbol || ""), summary: String(o.summary || "").slice(0, 300), orders: o.orders || [], order_no: o.order_no || "",
      side: o.side || "", name: o.name || "", result: "" };
    putOrder_(orderSheet_(), 0, d);
    cache_().put("opend", "1", 21600);       // 告訴電腦版有新委託要取
    obump_();
    return { ok: true, id: d.id, desktop: desktopState_() };
  });
}
function orderList_() {
  var rows = orderRows_().map(function (r) { return r.data; });
  var today = now_().slice(0, 10);
  rows = rows.filter(function (d) { return d.created.slice(0, 10) >= today || d.status === "pending"; });
  return { orders: rows.reverse().slice(0, 200), desktop: desktopState_(), report: JSON.parse(cache_().get("report") || "null"), orev: orev_() };
}
function orderCancel_(req) {              // 還沒被電腦版取走的網頁委託可以撤回
  return withLock_(function () {
    var sh = orderSheet_(), hit = orderRows_().filter(function (r) { return r.data.id === req.id; })[0];
    if (!hit) return { error: "not_found" };
    if (hit.data.status !== "pending") return { error: "already_taken" };
    hit.data.status = "withdrawn"; hit.data.result = "你在網頁撤回了";
    putOrder_(sh, hit.row, hit.data);
    obump_();
    return { ok: true };
  });
}
function desktopState_() {
  var hb = JSON.parse(cache_().get("desk") || "null");
  if (!hb) return { online: false };
  return { online: Date.now() - hb.t < 60000, relay: !!hb.relay, enabled: !!hb.enabled, device: hb.device || "", last: hb.time || "", env: hb.env || "" };
}
function orderPull_(req) {                // 電腦版每幾秒來一次：回報在線、取走待送的網頁委託
  var hb = { t: Date.now(), time: now_(), relay: !!req.relay, enabled: !!req.enabled, device: String(req.device || "").slice(0, 40), env: req.env || "" };
  cache_().put("desk", JSON.stringify(hb), 300);
  var base = rev_();                         // 順便回傳資料版本，電腦版一次呼叫就能輪詢
  base.orders = [];
  if (!req.relay || cache_().get("opend") === "0") return base;
  return withLock_(function () {
    var sh = orderSheet_(), out = [];
    orderRows_().forEach(function (r) {
      if (r.data.status !== "pending") return;
      if (r.data.created.slice(0, 10) < now_().slice(0, 10) && r.data.kind === "new") {   // 隔天才被取走的舊委託不送
        r.data.status = "expired"; r.data.result = "電腦版當天沒有開著，已作廢";
        putOrder_(sh, r.row, r.data);
        return;
      }
      r.data.status = "taken"; r.data.taken = now_(); r.data.device = hb.device;
      putOrder_(sh, r.row, r.data);
      out.push(r.data);
    });
    cache_().put("opend", "0", 21600);
    if (out.length) obump_();
    base.orders = out;
    return base;
  });
}
function orderDone_(req) {
  return withLock_(function () {
    var sh = orderSheet_(), hit = orderRows_().filter(function (r) { return r.data.id === req.id; })[0];
    if (!hit) return { error: "not_found" };
    hit.data.status = req.status === "sent" ? "sent" : "failed";
    hit.data.result = String(req.result || "").slice(0, 500);
    hit.data.done = now_();
    hit.data.items = req.items || [];
    putOrder_(sh, hit.row, hit.data);
    obump_();
    return { ok: true };
  });
}
function reportPush_(req) {               // 電腦版查到的今日委託／成交，給網頁看
  try { cache_().put("report", JSON.stringify({ time: now_(), rows: (req.rows || []).slice(0, 200) }), 21600); } catch (e) { /* 太大就算了 */ }
  obump_();
  return { ok: true };
}
