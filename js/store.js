/* 資料層：登入、從 Google 試算表載入、把異動（差異）送回去，並每幾秒偵測其他裝置（含電腦版）的更新。
   電腦版的 Store.save() 是整份寫檔，這裡改成比對上次同步的內容、只送有變動的列。 */
(function (root) {
  "use strict";
  const C = root.Core;
  const COLS = ["transactions", "dividends", "watchlist", "triggers"];
  // 只存在這台裝置、不同步的設定（視窗、排序、圖表偏好、自動更新頻率、元大帳號等）
  const LOCAL_KEYS = ["window_maximized", "tray_close", "autostart", "tray_hint_shown", "relay_web_orders",
    "yuanta_enabled", "yuanta_account", "yuanta_id", "yuanta_pass", "yuanta_dll_dir", "yuanta_env",
    "sort_hold", "sort_watch", "chart_range", "chart_mode", "chart_mas", "chart_pred", "chart_levels",
    "hot_exchange", "hot_rank", "hot_limit", "hot_kind", "hot_etf_type", "auto_refresh", "refresh_sec", "only_trading_hours", "notify_popup",
    "order_enabled", "order_auto_import", "trigger_orders"];
  const LS = { token: "sc_token", pending: "sc_pending", local: "sc_local", cache: "sc_cache", remember: "sc_remember", prices: "sc_prices" };
  const POLL_MS = 4000;
  const LIMIT = { rev: 20000, load: 90000, apply: 90000, fetch: 60000 };
  const idOf = (c, it) => (c === "watchlist" ? it.symbol : it.id);

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 210000 }, base, 256));
  }
  const device = () => "網頁 " + (/iPhone|Android|Mobile/.test(navigator.userAgent) ? "手機" : "電腦");

  class Store {
    constructor(url) {
      this.url = url;
      this.token = localStorage.getItem(LS.token) || "";
      this.transactions = []; this.dividends = []; this.watchlist = []; this.triggers = [];
      this.settings = Object.assign({}, C.DEFAULT_SETTINGS);
      this.prices = UI.ls.get(LS.prices, {});
      this.rev = 0; this.snap = null; this.queue = null; this.sending = false; this.timer = 0;
      this.onRemote = () => {}; this.onStatus = () => {}; this.onAuthLost = () => {};
      this.lastOk = 0;
    }
    async call(action, payload) {
      const body = JSON.stringify(Object.assign({ action, token: this.token }, payload || {}));
      const ctl = new AbortController(), stop = setTimeout(() => ctl.abort(), LIMIT[action] || 60000);
      let data;
      try {
        const res = await fetch(this.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, redirect: "follow",
          keepalive: document.hidden && body.length < 20000, signal: ctl.signal });
        if (!res.ok) throw new Error("HTTP " + res.status);
        data = await res.json();
      } finally { clearTimeout(stop); }
      if (data.error === "auth") { this.setToken(""); this.onAuthLost(); throw new Error("auth"); }
      if (data.error === "server") throw new Error(data.message || "server");
      this.lastOk = Date.now();
      return data;
    }
    setToken(t) { this.token = t; if (t) localStorage.setItem(LS.token, t); else localStorage.removeItem(LS.token); }
    status() { return this.call("status"); }
    keyFor(pw, salt) { return deriveKey(pw, salt); }
    async setup(pw, salt) { const r = await this.call("setup", { key: await deriveKey(pw, salt), device: device() }); if (r.token) this.setToken(r.token); return r; }
    async loginKey(key) { const r = await this.call("login", { key, device: device() }); if (r.token) this.setToken(r.token); return r; }
    remembered() { return UI.ls.get(LS.remember, null); }
    remember(k) { UI.ls.set(LS.remember, { k }); }
    forget() { localStorage.removeItem(LS.remember); }
    async changePassword(oldPw, newPw, salt) {
      const r = await this.call("changePassword", { key: await deriveKey(oldPw, salt), newKey: await deriveKey(newPw, salt), device: device() });
      if (r.token) { this.setToken(r.token); if (this.remembered()) this.remember(await deriveKey(newPw, salt)); }
      return r;
    }
    async logout() { try { await this.call("logout"); } catch (_e) { /* 離線也能登出 */ } this.setToken(""); this.forget(); localStorage.removeItem(LS.pending); }

    // ---- 行情代抓 ----
    async fetchUrls(urls) { return (await this.call("fetch", { urls })).results; }

    // ---- 載入 ----
    adopt(data) {
      this.rev = data.rev || 0;
      this.transactions = data.transactions || []; this.dividends = data.dividends || [];
      this.watchlist = data.watchlist || []; this.triggers = data.triggers || [];
      const local = UI.ls.get(LS.local, {});
      this.settings = Object.assign({}, C.DEFAULT_SETTINGS, data.settings || {}, local);
      this.snap = this.takeSnapshot();
      UI.ls.set(LS.cache, { rev: this.rev, transactions: this.transactions, dividends: this.dividends, watchlist: this.watchlist, triggers: this.triggers, settings: data.settings || {} });
    }
    loadCache() { const c = UI.ls.get(LS.cache, null); if (c) this.adopt(c); return !!c; }
    async load() {
      const data = await this.call("load");
      this.adopt(data);
      const left = UI.ls.get(LS.pending, null);       // 上次關閉前沒送完的異動
      if (left) { this.applyOps(left); this.queue = left; this.flushSoon(); }
      this.startPolling();
    }
    takeSnapshot() {
      const s = {};
      for (const c of COLS) s[c] = new Map(this[c].map((it) => [String(idOf(c, it)), JSON.stringify(it)]));
      s.settings = new Map(Object.keys(this.settings).filter((k) => !LOCAL_KEYS.includes(k)).map((k) => [k, JSON.stringify(this.settings[k])]));
      return s;
    }
    // ---- 存檔：和上次同步的內容比對，只送差異 ----
    save() {
      const local = {};
      LOCAL_KEYS.forEach((k) => { if (k in this.settings) local[k] = this.settings[k]; });
      UI.ls.set(LS.local, local);
      UI.ls.set(LS.prices, this.prices);
      if (!this.snap) return;
      const ops = {}, now = this.takeSnapshot();
      let n = 0;
      for (const c of COLS.concat(["settings"])) {
        const a = this.snap[c], b = now[c], up = [], del = [];
        b.forEach((v, id) => { if (a.get(id) !== v) up.push({ id, data: JSON.parse(v) }); });
        a.forEach((_v, id) => { if (!b.has(id)) del.push(id); });
        if (up.length || del.length) { ops[c] = { upsert: up, del }; n += up.length + del.length; }
      }
      this.snap = now;
      if (!n) return;
      this.mergeQueue(ops);
      UI.ls.set(LS.cache, { rev: this.rev, transactions: this.transactions, dividends: this.dividends, watchlist: this.watchlist, triggers: this.triggers,
        settings: Object.fromEntries([...now.settings].map(([k, v]) => [k, JSON.parse(v)])) });
      this.flushSoon();
    }
    mergeQueue(ops) {
      const q = this.queue || {};
      for (const c of Object.keys(ops)) {
        const cur = q[c] || { upsert: [], del: [] };
        const ids = new Set(ops[c].upsert.map((x) => x.id).concat(ops[c].del));
        cur.upsert = cur.upsert.filter((x) => !ids.has(x.id)).concat(ops[c].upsert);
        cur.del = cur.del.filter((x) => !ids.has(x)).concat(ops[c].del);
        q[c] = cur;
      }
      this.queue = q;
      UI.ls.set(LS.pending, q);
    }
    applyOps(ops) {                    // 把還沒送出的本機異動套到剛載入的資料上
      for (const c of Object.keys(ops)) {
        if (c === "settings") {
          ops[c].upsert.forEach((x) => { this.settings[x.id] = x.data; });
          ops[c].del.forEach((id) => { delete this.settings[id]; });
          continue;
        }
        const map = new Map(this[c].map((it) => [String(idOf(c, it)), it]));
        ops[c].upsert.forEach((x) => map.set(String(x.id), x.data));
        ops[c].del.forEach((id) => map.delete(String(id)));
        this[c] = [...map.values()];
      }
      this.snap = this.takeSnapshot();
    }
    get pendingCount() { const q = this.queue; return q ? Object.values(q).reduce((a, o) => a + o.upsert.length + o.del.length, 0) : 0; }
    flushSoon() { clearTimeout(this._flushT); this._flushT = setTimeout(() => this.flush(), 300); }
    async flush() {
      if (this.sending || !this.queue) return;
      this.sending = true;
      const ops = this.queue;
      this.queue = null;
      this.onStatus("同步中…");
      try {
        const r = await this.call("apply", { ops });
        if (r.error) throw new Error(r.error);
        const mine = r.prevRev === this.rev;
        this.rev = r.rev;
        if (!this.queue) localStorage.removeItem(LS.pending);
        this.onStatus("已同步");
        if (!mine) await this.reload();              // 送出前別的裝置也改過：重新載入
      } catch (e) {
        if (e.message === "auth") { this.sending = false; return; }
        const newer = this.queue; this.queue = null;  // 送不出去：留著下次再送（之後的新異動要蓋在上面）
        this.mergeQueue(ops); if (newer) this.mergeQueue(newer);
        this.onStatus("離線，稍後重送（" + this.pendingCount + " 筆）");
        setTimeout(() => this.flush(), 8000);
      } finally { this.sending = false; }
      if (this.queue) this.flushSoon();
    }
    async reload() {
      const data = await this.call("load");
      this.adopt(data);
      if (this.queue) this.applyOps(this.queue);
      this.onRemote();
    }
    startPolling() {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.poll(), POLL_MS);
    }
    async poll() {
      if (document.hidden && Date.now() - (this._lastHiddenPoll || 0) < 60000) return;
      if (document.hidden) this._lastHiddenPoll = Date.now();
      if (this.sending || this._polling) return;
      this._polling = true;
      try {
        const r = await this.call("rev");
        this.orev = r.orev;
        if (r.rev !== this.rev && !this.sending && !this.queue) await this.reload();
        if (this.onOrev) this.onOrev(r.orev);
        this.onStatus(this.pendingCount ? "待同步 " + this.pendingCount + " 筆" : "已同步");
      } catch (e) { if (e.message !== "auth") this.onStatus("連線中斷，重試中…"); }
      finally { this._polling = false; }
    }
    // ---- 網頁下單佇列 ----
    orderSubmit(order) { return this.call("orderSubmit", { order }); }
    orderList() { return this.call("orderList"); }
    orderCancel(id) { return this.call("orderCancel", { id }); }
  }
  Store.LOCAL_KEYS = LOCAL_KEYS;
  root.Store = Store;
})(window);
