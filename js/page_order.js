/* 連線下單（網頁版）：畫面同電腦版 OrderPage，但網頁不直接連元大——
   委託先放進 Google 試算表的「網頁委託」佇列，由開著的電腦版（設定裡開啟「代送網頁委託」）取走、檢查後送到元大，
   結果和今日委託／成交再回傳給網頁。觸價單存在同步的 triggers 清單，由電腦版盯盤、到價送出。 */
(function () {
  "use strict";
  const C = window.Core, U = window.UI, T = window.CONTENT;
  const el = U.el, cell = U.cell, money = C.money, esc = U.esc;
  const g = (x) => String(Number(Number(x).toPrecision(6)));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
  const ST_NAMES = { pending: "排隊中（等電腦版取走）", taken: "電腦版送出中", sent: "已送到元大", failed: "失敗", withdrawn: "已撤回", expired: "已作廢" };
  const ST_COLORS = { pending: "var(--ACCENT_TEXT)", taken: "var(--WARN)", sent: "var(--LOSS)", failed: "var(--GAIN)", withdrawn: "var(--MUTED)", expired: "var(--MUTED)" };

  class OrderPage {
    constructor() {
      const App = this.App = window.App;
      this.report = []; this.queue = []; this.desktop = { online: false }; this.reportTime = ""; this.side = "B";
      this.known = {};            // 網頁委託 id → 上次看到的狀態（變成已送出／失敗時通知）
      this.el = el("div");
      this.banner = el("div", { cls: "hint grow", style: { lineHeight: "1.6" } });
      const top = el("div", { cls: "row" }, this.banner, U.btn("前往設定", () => App.goPage("設定")));

      // ---- 左：委託表單 ----
      this.sym = new U.SymbolEdit(App);
      this.sym.onPick = () => this.onSymbol(); this.sym.onEnter = () => this.onSymbol(); this.sym.onBlur = () => this.onSymbol();
      this.info = el("div", { cls: "rich" }, "—");
      this.sideSeg = U.seg(["買進", "賣出"], (i) => this.setSide(i === 0 ? "B" : "S"));
      this.ptype = U.combo(["限價", "市價（只限整股）"], () => this.recalc());
      this.price = new U.NumBox({ min: 0, max: 100000, decimals: 2, width: "120px" }); this.price.onChange(() => this.recalc());
      const prow = el("div", { cls: "row" }, this.price.input,
        ...[["現價", () => this.setPrice("now")], ["漲停", () => this.setPrice("up")], ["跌停", () => this.setPrice("down")], ["－1檔", () => this.step(-1)], ["＋1檔", () => this.step(1)]]
          .map(([t, fn]) => U.btn(t, fn)));
      this.shares = new U.NumBox({ min: 0, max: 10000000, suffix: " 股", width: "120px" }); this.shares.onChange(() => this.recalc());
      const qrow = el("div", { cls: "row" }, this.shares.input, ...[["1 張", 1000], ["100 股", 100], ["全部持股", -1]].map(([t, n]) => U.btn(t, () => this.setShares(n))));
      this.session = U.combo(C.ORDER_SESSIONS.map((x) => x[0]), () => this.recalc());
      this.tif = U.combo(["ROD（當日有效）", "IOC（立即成交否則取消）", "FOK（全部成交否則取消）"], () => this.recalc());
      this.mode = U.combo(["立即送出", "到價自動送出（觸價單）"], () => this.onMode());
      this.tCond = U.combo(["現價 ≤ 觸發價（跌到就送出）", "現價 ≥ 觸發價（漲到就送出）"], () => this.recalc());
      this.tPrice = new U.NumBox({ min: 0, max: 100000, decimals: 2, width: "120px" }); this.tPrice.onChange(() => this.onTriggerPrice());
      this.tSame = U.check("委託價＝觸發價", true, () => this.onTriggerPrice());
      this.tExpire = U.combo(["今天收盤前", "5 個交易日內", "直到我取消"], () => this.recalc());
      this.est = el("div", { cls: "rich" });
      this.bSend = el("button", { cls: "primary", onclick: () => this.send(), style: { width: "100%", marginTop: "6px" } }, "送出買進委託…");
      const form = el("div", { cls: "form" });
      const add = (k, w) => form.append(el("label", { cls: "k", tip: T.FORM_TIPS[k] }, k), w);
      add("股票", this.sym.input); form.append(el("span"), this.info); add("買賣", this.sideSeg); add("價格類別", this.ptype); add("委託價", prow); add("股數", qrow);
      add("交易時段", this.session); add("委託效期", this.tif); add("下單方式", this.mode);
      this.trigRows = [el("label", { cls: "k" }, "觸發條件"), this.tCond, el("label", { cls: "k" }, "觸發價"), el("div", { cls: "row" }, this.tPrice.input, this.tSame),
        el("label", { cls: "k" }, "有效期限"), this.tExpire];
      form.append(...this.trigRows);
      form.append(el("div", { cls: "full" }, this.est), el("div", { cls: "full" }, this.bSend));
      const left = el("div", { cls: "group", style: { flex: "2 1 380px", minWidth: "0", alignSelf: "flex-start" } }, el("span", { cls: "gtitle" }, "委託下單（現股）"), form);

      // ---- 右：網頁委託佇列／今日委託成交／觸價單 ----
      this.tabs = el("div", { cls: "tabs" });
      this.tabNames = ["網頁委託（代送）", "今日委託／成交（元大）", "觸價單（到價自動下單）"];
      this.tabEls = this.tabNames.map((t, i) => { const d = el("div", { onclick: () => this.setTab(i) }, t); this.tabs.append(d); return d; });
      // 佇列
      this.qStatus = el("div", { cls: "hint" });
      this.qTable = new U.Table(["時間", "種類", "代號", "名稱", "買賣", "內容", "狀態", "結果"], { sortable: false });
      this.qTable.emptyText = "今天還沒有從網頁送出的委託";
      const pQ = el("div", { cls: "col", style: { flex: "1", minHeight: "0" } },
        el("div", { cls: "row" }, U.btn("重新整理", () => this.loadList()), U.btn("撤回（還沒被取走的）", () => this.withdraw(), "danger")), this.qStatus, this.qTable.el);
      // 今日委託／成交
      this.repStatus = el("div", { cls: "hint" });
      this.table = new U.Table(["時間", "委託書號", "代號", "名稱", "買賣", "市場", "價格", "委託量", "成交量", "取消量", "狀態", "訊息"]);
      this.table.emptyText = "沒有資料（電腦版查到今日委託後會傳上來）";
      this.bCancel = U.btn("刪單", () => this.cancelSelected(), "danger");
      const pR = el("div", { cls: "col", style: { flex: "1", minHeight: "0" } },
        el("div", { cls: "row" }, U.btn("重新整理", () => this.loadList()), this.bCancel, U.btn("記入交易紀錄", () => this.recordSelected())), this.repStatus, this.table.el);
      // 觸價單
      this.trigStatus = el("div", { cls: "hint" });
      this.tTable = new U.Table(["建立", "代號", "名稱", "買賣", "條件", "觸發價", "委託價", "股數", "期限", "狀態", "結果"]);
      this.tTable.emptyText = "沒有觸價單";
      const pT = el("div", { cls: "col", style: { flex: "1", minHeight: "0" } },
        el("div", { cls: "row" }, U.btn("取消觸價單", () => this.cancelTrigger(), "danger"), U.btn("清除已結束", () => this.clearTriggers())), this.trigStatus, this.tTable.el);
      this.panes = [pQ, pR, pT];
      const right = el("div", { cls: "col", style: { flex: "3 1 460px", minWidth: "0", minHeight: "320px", marginTop: "16px" } }, this.tabs, ...this.panes);
      this.el.append(top, el("div", { cls: "row", style: { flex: "1", minHeight: "0", alignItems: "stretch", flexWrap: "wrap", overflow: "auto" } }, left, right));
      this.setTab(0);
      this.setSide("B");
      this.onMode();
      this.refreshBanner();
      this.fillTriggers();
      App.store.onOrev = (o) => { if (o !== this.orev) { this.orev = o; this.loadList(true); } };
      setTimeout(() => this.loadList(true), 2500);
      setInterval(() => { if (!document.hidden && this.App.isPage(this)) this.loadList(true); }, 15000);
    }
    onShow() { this.loadList(true); this.recalc(); }
    setTab(i) { this.tabIdx = i; this.tabEls.forEach((t, k) => t.classList.toggle("on", k === i)); this.panes.forEach((p, k) => p.classList.toggle("hidden", k !== i)); }

    // ---------- 狀態 ----------
    enabled() { const d = this.desktop; return !!(d.online && d.relay && d.enabled); }
    refreshBanner() {
      const d = this.desktop, s = this.App.store.settings;
      const env = d.env === "uat" ? "測試環境（UAT）" : "正式環境";
      if (this.enabled()) {
        this.banner.innerHTML = `<b style='color:var(--GAIN)'>● 電腦版在線，可代送委託</b>　${esc(d.device || "")}　${env}　單筆上限 ${money(s.order_max_amount || 100000)} 元。` +
          "網頁送出的委託會由電腦版檢查後送到元大，每筆送出前網頁會再確認一次。";
      } else if (d.online && !d.relay) {
        this.banner.innerHTML = "<b style='color:var(--WARN)'>電腦版開著，但沒有開啟「代送網頁委託」。</b>請到電腦版「設定 → 元大證券 API」勾選「代送網頁送來的委託」。";
      } else if (d.online && !d.enabled) {
        this.banner.innerHTML = "<b style='color:var(--WARN)'>電腦版的 API 下單尚未啟用。</b>請在電腦版「設定 → 元大證券 API」測試連線成功後勾選「啟用 API 下單」。";
      } else {
        this.banner.innerHTML = "<b style='color:var(--WARN)'>電腦版沒有開著（或沒有連上 Google）。</b>網頁不能直接連元大：委託會先排隊，" +
          "要等電腦版開著並開啟「代送網頁委託」才會送出；當天沒被取走的委託隔天會自動作廢。" + (d.last ? `　電腦版最後在線：${esc(d.last)}` : "");
      }
      this.recalc();
    }
    setSide(side) {
      this.side = side;
      this.sideSeg.setOn(side === "B" ? 0 : 1);
      const trig = this.mode && this.mode.selectedIndex === 1;
      this.bSend.textContent = trig ? `建立觸價單（${side === "B" ? "買進" : "賣出"}）…` : side === "B" ? "送出買進委託…" : "送出賣出委託…";
      if (trig) this.tCond.selectedIndex = side === "B" ? 0 : 1;
      this.bSend.style.background = side === "B" ? "var(--GAIN)" : "var(--LOSS)";
      this.recalc();
    }
    prefill(sym, side, shares, price) {
      this.sym.setText(sym); this.onSymbol();
      this.setSide(side || "B");
      if (shares) this.shares.setValue(Math.trunc(shares));
      if (price) this.price.setValue(+price);
      this.recalc();
    }
    onSymbol() {
      const sym = this.sym.code();
      if (!sym) return;
      const q = this.App.store.prices[sym] || {};
      this.sym.setText(`${sym} ${this.App.stockName(sym)}`.trim());
      if (q.price) this.price.setValue(q.price);
      this.recalc();
      if (!q.price) this.App.fetchQuotes(true);
    }
    isReserve() { return C.resolveSession(C.ORDER_SESSIONS[this.session.selectedIndex][1], this.shares.value()) === "reserve"; }
    quote() {
      const sym = this.sym.code(), q = Object.assign({}, this.App.store.prices[sym] || {});
      if (this.isReserve() && q.price) [q.limit_up, q.limit_down] = C.priceLimits(q.price, C.isEtf(sym));
      else if (q.prev && !q.limit_up) [q.limit_up, q.limit_down] = C.priceLimits(q.prev, C.isEtf(sym));
      return [sym, q];
    }
    setPrice(which) {
      const [, q] = this.quote();
      const v = { now: q.price, up: q.limit_up, down: q.limit_down }[which];
      if (v) { this.ptype.selectedIndex = 0; this.price.setValue(v); }
    }
    step(d) {
      const [sym] = this.quote(), p = this.price.value();
      if (p > 0) { const t = C.tickSize(d > 0 ? p : Math.max(p - 0.0001, 0.01), C.isEtf(sym)); this.price.setValue(C.pyRound(p + d * t, 2)); }
    }
    setShares(n) {
      if (n === -1) { n = (this.App.holdings[this.sym.code()] || {}).shares || 0; this.setSide("S"); }
      this.shares.setValue(n);
    }

    // ---------- 試算與檢查 ----------
    triggerMode() { return this.mode.selectedIndex === 1; }
    onMode() {
      const on = this.triggerMode();
      this.trigRows.forEach((x) => x.classList.toggle("hidden", !on));
      if (on) {
        const [, q] = this.quote();
        if (q.price && !this.tPrice.value()) this.tPrice.setValue(q.price);
        this.session.selectedIndex = 0;
        this.setTab(2);
      }
      this.setSide(this.side);
    }
    onTriggerPrice() {
      if (this.tSame.input.checked && this.tPrice.value()) { this.ptype.selectedIndex = 0; this.price.setValue(this.tPrice.value()); }
      this.recalc();
    }
    currentOrders() {
      const App = this.App, [sym, q] = this.quote(), market = this.ptype.selectedIndex === 1, tif = ["0", "3", "4"][this.tif.selectedIndex];
      let when = null;
      if (this.triggerMode()) when = Object.assign({}, C.now(), { minutes: C.hm(10, 0) });
      let [orders, errors, notes] = C.buildOrders(sym, this.side, this.shares.value(), this.price.value(), market,
        this.triggerMode() ? "auto" : C.ORDER_SESSIONS[this.session.selectedIndex][1], tif, when || undefined);
      if (this.triggerMode()) {
        notes = notes.filter((n) => !n.includes("交易時段"));
        if (this.tPrice.value() <= 0) errors.push("請輸入觸發價");
      }
      const s = App.store.settings;
      if (!sym) errors.unshift("請輸入股票代號");
      if (sym && Object.keys(App.stockList).length && !App.stockList[sym]) errors.push(`股票清單裡找不到 ${sym}`);
      const px = this.price.value();
      if (!market && px && q.limit_up && px > q.limit_up + 1e-6) errors.push(`委託價高於漲停價 ${money(q.limit_up, 2)}`);
      if (!market && px && q.limit_down && px < q.limit_down - 1e-6) errors.push(`委託價低於跌停價 ${money(q.limit_down, 2)}`);
      if (!market && px) { const tk = C.tickSize(px, C.isEtf(sym)); if (Math.abs(Math.round(px / tk) * tk - px) > 1e-6) errors.push(`委託價不符合升降單位（${g(tk)} 元）`); }
      if (this.side === "S") {
        const held = (App.holdings[sym] || {}).shares || 0;
        if (this.shares.value() > held) errors.push(`賣出 ${money(this.shares.value())} 股超過目前持股 ${money(held)} 股（本程式只下現股，不做當沖或融券）`);
      }
      const cost = C.orderCost(orders, sym, s, market && this.side === "B" ? q.limit_up : q.price);
      const limit = s.order_max_amount || 100000;
      if (cost.amount > limit) errors.push(`金額 ${money(cost.amount)} 超過單筆上限 ${money(limit)} 元（可在設定調整）`);
      return [sym, orders, errors, notes, cost];
    }
    recalc() {
      if (!this.est) return;
      const [sym, orders, errors, notes, cost] = this.currentOrders(), [, q] = this.quote();
      if (sym) {
        const held = (this.App.holdings[sym] || {}).shares || 0, f2 = (x) => (x ? money(x, 2) : "—");
        this.info.innerHTML = `${esc(this.App.stockName(sym))}　現價 <b>${f2(q.price)}</b>　漲停 ${f2(q.limit_up)}　跌停 ${f2(q.limit_down)}` + (held ? `　持有 ${money(held)} 股` : "");
      }
      const lines = orders.map((o) => `${C.AP_NAMES[o.apcode]} ${money(o.qty)} ${o.unit} @ ${o.price_flag === "M" ? "市價" : money(o.price, 2)}　${C.TIF_NAMES[o.tif]}`);
      if (orders.length) {
        const word = this.side === "B" ? "預估付出（含手續費）" : "預估拿回（扣手續費、證交稅）";
        lines.push(`價金 ${money(cost.amount)}　手續費 ${money(cost.fee)}` + (this.side === "S" ? `　證交稅 ${money(cost.tax)}` : "") + `　<b>${word} ${money(cost.net)} 元</b>`);
      }
      notes.forEach((n) => lines.push(`<span style='color:var(--WARN)'>⚠ ${esc(n)}</span>`));
      errors.forEach((e) => lines.push(`<span style='color:var(--GAIN)'>✖ ${esc(e)}</span>`));
      if (!this.enabled()) lines.push("<span style='color:var(--WARN)'>⚠ 電腦版目前不能代送：委託會先排隊，電腦版開著並開啟代送後才會送出</span>");
      let html = lines.join("<br>");
      if (this.triggerMode() && orders.length) {
        const cond = this.tCond.selectedIndex === 0 ? "≤" : "≥";
        html += `<br><b style='color:var(--ACCENT_TEXT)'>觸價單：現價 ${cond} ${money(this.tPrice.value(), 2)} 時自動送出上面的委託（${this.tExpire.options[this.tExpire.selectedIndex].text}）。` +
          "由電腦版盯盤：電腦版要開著（可縮到系統匣）、開啟「代送網頁委託」並在盤中自動更新股價。</b>";
      }
      this.est.innerHTML = html;
      this.bSend.disabled = !!errors.length || !orders.length;
    }

    // ---------- 送出（放進佇列）----------
    async send() {
      if (this.triggerMode()) { await this.createTrigger(); return; }
      const [sym, orders, errors, notes, cost] = this.currentOrders();
      if (errors.length || !orders.length) { await U.warn("無法送出：\n" + (errors.length ? errors : ["沒有委託內容"]).join("\n")); return; }
      const d = this.desktop, env = d.env === "uat" ? "測試環境（UAT）" : "正式環境（真的會成交）";
      const name = this.App.stockName(sym), side = this.side === "B" ? "買進" : "賣出";
      const detail = orders.map((o) => `　${C.AP_NAMES[o.apcode]} ${money(o.qty)} ${o.unit} @ ${o.price_flag === "M" ? "市價" : money(o.price, 2)}　${C.TIF_NAMES[o.tif]}`).join("\n");
      const word = this.side === "B" ? "預估付出" : "預估拿回";
      let kind = "";
      if (orders[0].reserve) { const td = orders[0].trade_date; kind = `【預約單：${+td.slice(5, 7)}/${+td.slice(8, 10)}（${C.WEEKDAYS[C.weekday(td)]}）開盤送出】\n`; }
      const relay = this.enabled() ? `由電腦版（${d.device || "電腦"}）代送到元大證券${env}` : "先排隊，等電腦版開著並開啟代送後才會送到元大（當天沒送出隔天作廢）";
      const msg = `${kind}確定要送出委託？\n${relay}\n\n${side}：${sym} ${name}\n${detail}\n\n${word}約 ${money(cost.net)} 元（含手續費${this.side === "S" ? "、證交稅" : ""}）` +
        (notes.length ? "\n\n" + notes.map((n) => "⚠ " + n).join("\n") : "");
      const ok = await U.msg(msg, { title: "確認委託", buttons: [[`確認${side}`, true], ["取消", false, true]], cancelValue: false });
      if (!ok) return;
      this.bSend.disabled = true; this.bSend.textContent = "送出中…";
      const summary = `${side} ${sym} ${name}：` + orders.map((o) => `${C.AP_NAMES[o.apcode]} ${money(o.qty)}${o.unit} @ ${o.price_flag === "M" ? "市價" : money(o.price, 2)}`).join("、");
      try {
        const r = await this.App.store.orderSubmit({ kind: "new", symbol: sym, name, side: this.side, summary,
          orders: orders.map((o) => ({ symbol: o.symbol, side: o.side, apcode: o.apcode, qty: o.qty, unit: o.unit, shares: o.shares, price: o.price, price_flag: o.price_flag, tif: o.tif, reserve: o.reserve, trade_date: o.trade_date })) });
        if (r.error) throw new Error(r.error);
        this.known[r.id] = "pending";
        U.status(r.desktop && r.desktop.online && r.desktop.relay ? "委託已送出，電腦版幾秒內會代送到元大" : "委託已排隊，等電腦版開著並開啟代送後送出", 8000);
        this.setTab(0);
      } catch (e) { await U.warn(`委託送出失敗：${e.message}`); }
      this.setSide(this.side);
      this.loadList(true);
    }
    async withdraw() {
      const r = this.qTable.current();
      const o = r && this.queue.find((x) => x.id === r.id);
      if (!o || o.status !== "pending") { await U.info("請先選一筆「排隊中」的網頁委託（電腦版已取走的不能撤回，請改用「刪單」）"); return; }
      if (!await U.ask(`撤回這筆網頁委託？\n${o.summary}`)) return;
      try { const x = await this.App.store.orderCancel(o.id); if (x.error) throw new Error(x.error === "already_taken" ? "電腦版已經取走了，請等它送出後用「刪單」" : x.error); }
      catch (e) { await U.warn(`撤回失敗：${e.message}`); }
      this.loadList(true);
    }

    // ---------- 佇列與今日委託 ----------
    async loadList(quiet) {
      if (this._busy) return;
      this._busy = true;
      if (!quiet) this.repStatus.textContent = "查詢中…";
      try {
        const r = await this.App.store.orderList();
        this.desktop = r.desktop || { online: false };
        this.queue = r.orders || [];
        if (r.report) { this.report = r.report.rows || []; this.reportTime = r.report.time || ""; }
        this.announce();
        this.fillQueue(); this.fillReport(); this.refreshBanner();
      } catch (e) { if (!quiet) this.repStatus.textContent = `查詢失敗：${e.message}`; }
      this._busy = false;
    }
    announce() {                       // 自己送出的網頁委託有結果時通知
      for (const o of this.queue) {
        const was = this.known[o.id];
        if (was && was !== o.status && (o.status === "sent" || o.status === "failed" || o.status === "expired")) {
          const ok = o.status === "sent";
          this.App.notify(`${ok ? "✅" : "⚠"} 網頁委託${ok ? "已送到元大" : ST_NAMES[o.status]}：${o.symbol} ${o.name || ""}`, o.result || o.summary, o.symbol, "連線下單");
        }
        this.known[o.id] = o.status;
      }
    }
    fillQueue() {
      const rows = this.queue.map((o) => ({ id: o.id, cells: [
        cell((o.created || "").slice(5, 16), o.created, { left: true }), cell(o.kind === "cancel" ? "刪單" : "新委託", o.kind, { left: true }),
        cell(o.symbol, o.symbol, { left: true, bold: true }), cell(o.name || "", o.name, { left: true }),
        cell(o.side === "B" ? "買" : o.side === "S" ? "賣" : "", o.side, { left: true, bold: true, color: o.side === "B" ? "var(--GAIN)" : "var(--LOSS)" }),
        cell(o.summary || "", o.summary, { left: true, tip: o.summary }),
        cell(ST_NAMES[o.status] || o.status, o.status, { left: true, color: ST_COLORS[o.status], bold: o.status === "pending" || o.status === "taken" }),
        cell(o.result || "", o.result, { left: true, tip: o.result })] }));
      this.qTable.setRows(rows);
      const pend = this.queue.filter((o) => o.status === "pending" || o.status === "taken").length;
      const d = this.desktop;
      this.qStatus.textContent = (d.online ? `電腦版在線（${d.device || "電腦"}，${d.relay ? "代送已開啟" : "代送未開啟"}）` : "電腦版離線" + (d.last ? `（最後在線 ${d.last}）` : "")) +
        `　今天的網頁委託 ${this.queue.length} 筆` + (pend ? `，處理中 ${pend} 筆` : "");
      this.tabEls[0].textContent = pend ? `網頁委託（處理中 ${pend}）` : this.tabNames[0];
    }
    fillReport() {
      const out = this.report.map((r) => ({ id: r.order_no || r.time, cells: [
        cell(r.time, r.time, { left: true }), cell(r.order_no, r.order_no, { left: true }), cell(r.symbol, r.symbol, { left: true, bold: true }), cell(r.name, r.name, { left: true }),
        cell(r.bs === "B" ? "買" : "賣", r.bs, { left: true, bold: true, color: r.bs === "B" ? "var(--GAIN)" : "var(--LOSS)" }),
        cell(C.AP_NAMES[r.apcode] || String(r.apcode), r.apcode, { left: true }), cell(r.price ? money(r.price, 2) : "市價", r.price),
        cell(money(r.qty), r.qty), cell(money(r.ok_qty), r.ok_qty), cell(money(r.cancel_qty), r.cancel_qty),
        cell(r.status, r.status, { left: true }), cell(r.message, r.message, { left: true })] }));
      this.table.setRows(out);
      this.repStatus.textContent = this.reportTime ? `今日委託 ${this.report.length} 筆（電腦版 ${this.reportTime.slice(11, 19)} 查詢）　委託量、成交量：整股為張、零股為股` :
        "電腦版查到今日委託／成交後會傳到這裡（電腦版要開著並開啟代送）";
    }
    selectedReport() { const r = this.table.current(); return r ? this.report.find((x) => (x.order_no || x.time) === r.id) || null : null; }
    async cancelSelected() {
      const o = this.selectedReport();
      if (!o) { await U.info("請先在表格選一筆委託"); return; }
      const left = o.qty - o.ok_qty - o.cancel_qty;
      if (left <= 0 || o.can_cancel === false) { await U.info("這筆委託已全部成交、已取消或已失效，不能刪單"); return; }
      const unit = o.apcode === 0 || o.apcode === 7 ? "張" : "股";
      if (!await U.ask(`刪除委託 ${o.order_no}（${o.symbol} ${o.name}，剩餘 ${money(left)} ${unit}）？\n刪單會由電腦版代送到元大。`)) return;
      try {
        const r = await this.App.store.orderSubmit({ kind: "cancel", symbol: o.symbol, name: o.name, side: o.bs, order_no: o.order_no,
          summary: `刪單 ${o.order_no}：${o.symbol} ${o.name} 剩餘 ${money(left)} ${unit}`,
          orders: [{ symbol: o.symbol, side: o.bs, apcode: o.apcode, qty: left, price: o.price, price_flag: o.price_flag || " ", tif: o.tif || "0", order_no: o.order_no, trade_kind: 4 }] });
        if (r.error) throw new Error(r.error);
        this.known[r.id] = "pending";
        U.status("刪單已送出，等電腦版代送", 6000);
        this.setTab(0);
      } catch (e) { await U.warn(`刪單送出失敗：${e.message}`); }
      this.loadList(true);
    }
    imported(orderNo, day) {
      const tag = `委託書號 ${orderNo}`;
      return this.App.store.transactions.filter((t) => t.date === day && (t.note || "").includes(tag)).reduce((a, t) => a + t.shares, 0);
    }
    async recordSelected() {
      const o = this.selectedReport();
      if (!o || o.ok_qty <= 0) { await U.info("請選一筆「已有成交量」的委託"); return; }
      const shares = o.ok_qty * (o.apcode === 0 || o.apcode === 7 ? 1000 : 1);
      const left = shares - this.imported(o.order_no, C.today());
      if (left <= 0) { await U.info(`委託 ${o.order_no} 的成交已經記入交易紀錄了`); return; }
      this.App.addTx({ type: o.bs === "B" ? "buy" : "sell", symbol: o.symbol, name: o.name, shares: left, price: o.deal_price || o.price, date: C.today(), note: `委託書號 ${o.order_no}` });
    }

    // ---------- 觸價單（同步清單，由電腦版盯盤）----------
    triggers() { return this.App.store.triggers; }
    async createTrigger() {
      const [sym, orders, errors, , cost] = this.currentOrders();
      if (errors.length || !orders.length) { await U.warn("無法建立：\n" + (errors.length ? errors : ["沒有委託內容"]).join("\n")); return; }
      const today = C.today(), expI = this.tExpire.selectedIndex;
      let expire = expI === 0 ? today : expI === 1 ? C.CALENDAR.nextTradingDays(today, 5).slice(-1)[0] : "";
      if (expI === 0 && !C.CALENDAR.isTradingDay(today)) expire = C.CALENDAR.nextTradingDays(today, 1)[0];
      const cond = this.tCond.selectedIndex === 0 ? "<=" : ">=", market = this.ptype.selectedIndex === 1;
      const n = C.now();
      const t = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 10),
        created: `${n.date}T${n.time}`, symbol: sym, name: this.App.stockName(sym), side: this.side, cond, trigger: C.pyRound(this.tPrice.value(), 2),
        price: C.pyRound(this.price.value(), 2), market, shares: this.shares.value(), tif: ["0", "3", "4"][this.tif.selectedIndex], expire, status: "waiting", result: "", origin: "web" };
      const side = this.side === "B" ? "買進" : "賣出";
      const detail = orders.map((o) => `　${C.AP_NAMES[o.apcode]} ${money(o.qty)} ${o.unit} @ ${o.price_flag === "M" ? "市價" : money(o.price, 2)}`).join("\n");
      const env = this.desktop.env === "uat" ? "測試環境（UAT）" : "正式環境（真的會成交）";
      const msg = `建立觸價單：當 ${sym} ${t.name} 的現價 ${cond === "<=" ? "≤" : "≥"} ${money(t.trigger, 2)} 時，電腦版會自動送出下面的委託到元大${env}，送出時不會再問你：\n\n${side}：\n${detail}\n\n` +
        `預估${this.side === "B" ? "付出" : "拿回"}約 ${money(cost.net)} 元　期限：${this.tExpire.options[expI].text}${expire ? "（到 " + expire + "）" : ""}\n\n` +
        "電腦版要開著（可縮到系統匣）、開啟「代送網頁委託」，盤中自動更新股價時才會比對。確定建立？";
      const ok = await U.msg(msg, { title: "確認觸價單", buttons: [["建立觸價單", true], ["取消", false, true]], cancelValue: false });
      if (!ok) return;
      this.triggers().push(t);
      this.App.store.save();
      this.fillTriggers(); this.setTab(2);
      U.status(`已建立觸價單：${sym} 現價 ${cond === "<=" ? "≤" : "≥"} ${g(t.trigger)} 時${side}`, 8000);
      this.App.fetchQuotes(true);
    }
    fillTriggers() {
      const names = { waiting: "盯價中", sending: "送出中", sent: "已送出", failed: "失敗", expired: "已過期", cancelled: "已取消" };
      const colors = { waiting: "var(--ACCENT_TEXT)", sent: "var(--LOSS)", failed: "var(--GAIN)", expired: "var(--MUTED)", cancelled: "var(--MUTED)" };
      const list = this.triggers().slice().sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
      const rows = list.map((t) => ({ id: t.id, cells: [
        cell(t.created.slice(5, 16).replace("T", " "), t.created, { left: true }), cell(t.symbol, t.symbol, { left: true, bold: true }), cell(t.name, t.name, { left: true }),
        cell(t.side === "B" ? "買" : "賣", t.side, { left: true, bold: true, color: t.side === "B" ? "var(--GAIN)" : "var(--LOSS)" }),
        cell(t.cond === "<=" ? "現價 ≤" : "現價 ≥", t.cond, { left: true }), cell(money(t.trigger, 2), t.trigger), cell(t.market ? "市價" : money(t.price, 2), t.price),
        cell(money(t.shares), t.shares), cell(t.expire || "直到取消", t.expire || "9999", { left: true }),
        cell(names[t.status] || t.status, t.status, { left: true, color: colors[t.status], bold: t.status === "waiting" }), cell(t.result || "", t.result || "", { left: true, tip: t.result })] }));
      this.tTable.setRows(rows);
      const n = this.triggers().filter((t) => t.status === "waiting").length;
      this.trigStatus.textContent = `盯價中 ${n} 筆。到價時（盤中 9:00–13:30、電腦版股價自動更新時比對）電腦版會自動送出委託；網頁和電腦版都會收到通知。`;
      this.tabEls[2].textContent = n ? `觸價單（盯價中 ${n}）` : this.tabNames[2];
      // 電腦版送出觸價單後（同步回來）通知
      this._tSeen = this._tSeen || {};
      for (const t of this.triggers()) {
        const was = this._tSeen[t.id];
        if (was && was !== t.status && (t.status === "sent" || t.status === "failed")) {
          this.App.notify(`${t.status === "sent" ? "✅" : "⚠"} 觸價單${t.status === "sent" ? "已送出" : "失敗"}：${t.side === "B" ? "買進" : "賣出"} ${t.symbol} ${t.name}`, t.result || "", t.symbol, "連線下單");
        }
        this._tSeen[t.id] = t.status;
      }
    }
    checkTriggerView() { if (this.App.isPage(this)) this.recalc(); }
    async cancelTrigger() {
      const r = this.tTable.current(), t = r && this.triggers().find((x) => x.id === r.id);
      if (!t || t.status !== "waiting") { await U.info("請先選一筆「盯價中」的觸價單"); return; }
      t.status = "cancelled"; t.result = "你取消了";
      this.App.store.save(); this.fillTriggers();
    }
    clearTriggers() {
      const keep = this.triggers().filter((t) => t.status === "waiting" || t.status === "sending");
      this.App.store.triggers = keep;
      this.App.store.save(); this.fillTriggers();
    }
  }
  window.App = Object.assign(window.App || {}, { OrderPage });
})();
