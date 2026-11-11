/* 自選觀察（對照電腦版 WatchPage、WatchDialog、detect_watch_levels）。 */
(function () {
  "use strict";
  const C = window.Core, M = window.Market, U = window.UI, T = window.CONTENT;
  const el = U.el, cell = U.cell, money = C.money, f2 = C.f2;

  async function detectWatchLevels(App, sym) {
    const hit = App.chart && App.chart.lvCache[sym];
    let rows;
    if (hit && Date.now() - hit[0] < 600000) rows = hit[1].slice();
    else rows = (await M.fetchChart(sym, (App.stockList[sym] || {}).market, "1y", "1d")).rows;
    const q = App.store.prices[sym] || {};
    if (q.price && rows.length) {
      const last = rows[rows.length - 1];
      rows = rows.slice(0, -1).concat([[last[0], last[1], Math.max(last[2], q.price), Math.min(last[3], q.price), q.price, last[5]]]);
    }
    const c = App.divclass && App.divclass.info[sym];
    const lv = C.computeTradeLevels(rows, sym, c && c.ttm ? c.ttm : null);
    if (!lv) throw new Error("歷史資料不足 40 天，無法判斷");
    return lv;
  }

  class WatchDialog extends U.Dialog {
    constructor(App, item) {
      super(`觀察設定：${item.symbol} ${item.name || ""}`, { width: "560px" });
      this.App = App; this.sym = item.symbol; this.lv = null;
      const price = (App.store.prices[item.symbol] || {}).price;
      this.buy = new U.NumBox({ min: 0, max: 100000, decimals: 2, special: "不設定", value: item.buy_target || 0 });
      this.sell = new U.NumBox({ min: 0, max: 100000, decimals: 2, special: "不設定", value: item.sell_target || 0 });
      this.note = el("input", { value: item.note || "" });
      const form = el("div", { cls: "form" });
      const add = (k, w) => form.append(el("label", { cls: "k", tip: T.FORM_TIPS[k] }, k), w);
      add("現價", el("span", null, price ? f2(price) : "—"));
      add("買進目標價（跌到以下提醒）", this.buy.input); add("賣出目標價（漲到以上提醒）", this.sell.input); add("備註", this.note);
      this.lvInfo = el("div", { cls: "rich" }, "偵測中…");
      this.lvBtns = el("div", { cls: "row" });
      this.bApply = U.btn("套用建議（買點 1／賣點 1）", () => this.applyLv(0, 0)); this.bApply.disabled = true;
      const grp = el("div", { cls: "group full" }, el("span", { cls: "gtitle" }, "自動偵測買賣價位"), this.lvInfo, this.lvBtns,
        el("div", { cls: "row", style: { marginTop: "6px" } }, this.bApply, U.btn("重新偵測", () => this.detect())));
      form.append(grp, el("div", { cls: "full hint" }, "填 0 表示不設定。到價時該列會標示並在狀態列提醒（每天每種提醒一次）。"));
      this.body.append(form);
      this.foot.append(U.btn("儲存", () => { this.buy.commit(); this.sell.commit(); this.accept(this.values()); }, "primary"), U.btn("取消", () => this.reject()));
      this.detect();
    }
    async detect() {
      this.lvInfo.innerHTML = `<span class="muted">正在用近一年日 K 偵測 ${U.esc(this.sym)} 的支撐、壓力…</span>`;
      this.bApply.disabled = true;
      let lv = null, err = "";
      try { lv = await detectWatchLevels(this.App, this.sym); } catch (e) { err = e.message; }
      if (!this.visible) return;
      this.lv = lv; this.lvBtns.innerHTML = "";
      if (!lv) { this.lvInfo.innerHTML = `<span style="color:var(--GAIN)">偵測失敗：${U.esc(err)}</span>`; return; }
      const price = lv.price, d = (v) => C.signed((v / price - 1) * 100, 1) + "%";
      const lines = [`<b>${lv.zone}</b>（現價 ${f2(price)}，一年區間位置 ${C.fixed(lv.pos, 0)}%，RSI ${C.fixed(lv.rsi, 0)}）`];
      lv.buy.forEach(([v, why], i) => lines.push(`買點 ${i + 1}：<b style="color:var(--LOSS)">${f2(v)}</b>（${d(v)}，${U.esc(why)}）`));
      lv.sell.forEach(([v, why], i) => lines.push(`賣點 ${i + 1}：<b style="color:var(--GAIN)">${f2(v)}</b>（${d(v)}，${U.esc(why)}）`));
      lines.push(`停損參考：${f2(lv.stop)}`, `<span class="muted">點下面的價位可直接帶入；依近一年日 K 推算，僅供參考。</span>`);
      lv.buy.forEach(([v], i) => this.lvBtns.append(U.btn("買 " + f2(v), () => this.applyLv(i, null))));
      lv.sell.forEach(([v], i) => this.lvBtns.append(U.btn("賣 " + f2(v), () => this.applyLv(null, i))));
      this.bApply.disabled = false;
      if (!this.buy.value() && !this.sell.value()) {
        this.applyLv(0, 0);
        lines.splice(1, 0, `<span style="color:var(--ACCENT_TEXT)">還沒設定目標價，已自動帶入買點 1／賣點 1，可再修改。</span>`);
      }
      this.lvInfo.innerHTML = lines.join("<br>");
    }
    applyLv(bi, si) {
      if (!this.lv) return;
      if (bi !== null) this.buy.setValue(this.lv.buy[bi][0]);
      if (si !== null) this.sell.setValue(this.lv.sell[si][0]);
    }
    values() { return { buy_target: this.buy.value() || null, sell_target: this.sell.value() || null, note: this.note.value.trim() }; }
  }

  class WatchPage {
    constructor() {
      const App = window.App;
      this.App = App; this.alerted = new Set();
      this.el = el("div");
      this.sym = new U.SymbolEdit(App, { width: "280px" });
      this.sym.onEnter = () => this.addInput(); this.sym.onPick = null;
      this.bAuto = U.btn("自動偵測買賣價", () => this.autoLevels(), "", T.WIDGET_TIPS["自動偵測買賣價"]);
      this.summary = el("span", { cls: "hint" });
      const top = el("div", { cls: "row" }, this.sym.input, U.btn("＋ 加入觀察", () => this.addInput(), "primary", (T.WIDGET_TIPS["＋ 加入觀察"] || "") + "\n快捷鍵：Ctrl+W／Enter"),
        U.btn("設定目標價", () => this.editSelected(), "", (T.WIDGET_TIPS["設定目標價"] || "") + "\n快捷鍵：Enter"), this.bAuto,
        U.btn("移除", () => this.removeSelected(), "danger", "快捷鍵：Delete"), this.summary, el("span", { cls: "grow" }), el("span", { cls: "menuHint" }, U.menuHint() + "可買進／預測／查股利"));
      const sort = App.store.settings.sort_watch || [2, 0];
      this.table = new U.Table(["代號", "名稱", "現價", "漲跌", "漲跌幅", "開盤", "最高", "最低", "買進目標", "賣出目標", "提醒", "加入時價格", "加入後漲跌", "殖利率", "配息", "備註", "加入日"],
        { flashCol: 2, multi: true, sortCol: sort[0], sortAsc: sort[1] === 0, onSort: (c, asc) => { App.store.settings.sort_watch = [c, asc ? 0 : 1]; App.store.save(); },
          onDbl: () => this.editSelected(), onMenu: (r, x, y) => r && this.menu(r.cells[0].text, x, y),
          onKey: (e) => { if (e.key === "Enter") this.editSelected(); if (e.key === "Delete") this.removeSelected(); } });
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.el.append(top, this.table.el, U.hint("觀察中的股票會和持股一起自動更新股價。買進目標：現價跌到目標價以下會提醒；賣出目標：現價漲到目標價以上會提醒。連按兩下或「設定目標價」可修改。新加入的股票會自動偵測參考買賣價並帶入；「自動偵測買賣價」可一次重算全部（或多選的幾檔）。"));
    }
    items() { return this.App.store.watchlist; }
    find(sym) { return this.items().find((w) => w.symbol === sym) || null; }
    async add(sym, name, quiet) {
      const App = this.App;
      sym = (sym || "").trim().toUpperCase();
      if (!sym) return false;
      if (this.find(sym)) { if (!quiet) { U.status(`${sym} 已經在觀察清單裡`, 4000); this.select(sym); } return false; }
      name = name || App.stockName(sym);
      if (!name && Object.keys(App.stockList).length && !App.stockList[sym]) { if (!await U.ask(`股票清單裡找不到「${sym}」，仍要加入觀察？`)) return false; }
      const price = (App.store.prices[sym] || {}).price || (App.stockList[sym] || {}).close || null;
      this.items().push({ symbol: sym, name: name || sym, added: C.today(), added_price: price, buy_target: null, sell_target: null, note: "" });
      App.store.save(); this.fill();
      this.detectInBg([sym], true, false);
      if (!quiet) { this.select(sym); U.status(`已加入觀察：${sym} ${name}`, 4000); }
      App.fetchQuotes(true); App.divclass.refreshData();
      return true;
    }
    async addInput() { if (await this.add(this.sym.code())) this.sym.setText(""); }
    selected() { const r = this.table.current(); return r ? this.find(r.cells[0].text) : null; }
    select(sym) { this.table.select(sym); }
    async detectInBg(syms, onlyEmpty, ask) {
      const job = { syms: syms.slice(), done: {}, errs: {} };
      if (ask) { this.bAuto.disabled = true; this.bAuto.textContent = `偵測中 0/${syms.length}`; }
      let next = 0;
      const worker = async () => {
        while (next < job.syms.length) {
          const sym = job.syms[next++];
          try { const lv = await detectWatchLevels(this.App, sym); job.done[sym] = lv; this.onAutoLv(sym, lv, job, ask); }
          catch (e) { job.errs[sym] = e.message; this.onAutoLv(sym, null, job, ask); }
        }
      };
      await Promise.all([...Array(Math.min(8, syms.length))].map(worker));
      if (ask) await this.finishAuto(job);
    }
    onAutoLv(sym, lv, job, ask) {
      const n = Object.keys(job.done).length + Object.keys(job.errs).length;
      if (ask) { this.bAuto.textContent = `偵測中 ${n}/${job.syms.length}`; return; }
      if (lv) {
        const it = this.find(sym);
        if (it && !it.buy_target && !it.sell_target) {
          Object.assign(it, { buy_target: lv.buy[0][0], sell_target: lv.sell[0][0] });
          this.App.store.save(); this.fill();
          U.status(`${sym} 已自動設定參考買進 ${this.App.gfmt(lv.buy[0][0])}、賣出 ${this.App.gfmt(lv.sell[0][0])}（可按「設定目標價」修改）`, 6000);
        }
      }
    }
    async finishAuto(job) {
      this.bAuto.disabled = false; this.bAuto.textContent = "自動偵測買賣價";
      const rows = [];
      let nSet = 0;
      for (const s of job.syms) {
        const it = this.find(s), lv = job.done[s];
        if (lv && it) {
          const has = !!(it.buy_target || it.sell_target);
          nSet += has ? 1 : 0;
          rows.push(`${s} ${it.name || ""}：買進 ${f2(lv.buy[0][0])}　賣出 ${f2(lv.sell[0][0])}　${has ? `（原 ${it.buy_target || "—"}／${it.sell_target || "—"}）` : ""}`);
        } else if (s in job.errs) rows.push(`${s}：偵測失敗（${job.errs[s]}）`);
      }
      const nd = Object.keys(job.done).length, ne = Object.keys(job.errs).length;
      if (!nd) { await U.warn("偵測失敗：\n" + rows.slice(0, 20).join("\n")); return; }
      const shown = rows.slice(0, 15).concat(rows.length > 15 ? [`…另外 ${rows.length - 15} 檔（按「顯示詳細資料」看全部）`] : []);
      const pick = await U.msg(`偵測完成：${nd} 檔有參考價位` + (ne ? `、${ne} 檔失敗（資料不足）` : "") + `。其中 ${nSet} 檔原本已有目標價。要怎麼套用？（到價時會提醒）\n\n` + shown.join("\n"),
        { buttons: [["全部更新", "all", !nSet], ["只填還沒設定的", "empty", !!nSet], ["取消", null]], detail: rows.length > 15 ? rows.join("\n") : null });
      if (!pick) return;
      let nUpd = 0;
      for (const s of Object.keys(job.done)) {
        const it = this.find(s), lv = job.done[s];
        if (!it || (pick === "empty" && (it.buy_target || it.sell_target))) continue;
        nUpd++; Object.assign(it, { buy_target: lv.buy[0][0], sell_target: lv.sell[0][0] });
        [...this.alerted].forEach((a) => { if (a.split("|")[1] === s) this.alerted.delete(a); });
      }
      this.App.store.save(); this.fill();
      U.status(`已更新 ${nUpd} 檔的目標價`, 6000);
    }
    autoLevels() {
      const sel = this.table.selected();
      let syms = sel.length > 1 ? sel.map((r) => r.cells[0].text) : [];
      if (!syms.length) syms = this.items().map((w) => w.symbol);
      if (!syms.length) { U.info("觀察清單是空的"); return; }
      this.detectInBg(syms, false, true);
    }
    async editSymbol(sym, name) {
      const App = this.App;
      let it = this.find(sym), added = false;
      if (!it) {
        name = name || App.stockName(sym) || sym;
        const price = (App.store.prices[sym] || {}).price || (App.stockList[sym] || {}).close || null;
        it = { symbol: sym, name, added: C.today(), added_price: price, buy_target: null, sell_target: null, note: "" };
        this.items().push(it); added = true;
      }
      const v = await new WatchDialog(App, it).exec();
      if (v) {
        Object.assign(it, v);
        [...this.alerted].forEach((a) => { if (a.split("|")[1] === sym) this.alerted.delete(a); });
        App.store.save(); this.fill();
        U.status(`${sym} 目標價已設定：買進 ${it.buy_target || "—"}、賣出 ${it.sell_target || "—"}（到價會提醒）` + (added ? "，並已加入自選觀察" : ""), 6000);
        if (added) App.fetchQuotes(true);
        if (App.hot) App.hot.fill();
      } else if (added) { const i = this.items().indexOf(it); if (i >= 0) this.items().splice(i, 1); }
    }
    async editSelected() {
      const it = this.selected();
      if (!it) { U.info("請先選一檔觀察中的股票"); return; }
      const v = await new WatchDialog(this.App, it).exec();
      if (v) {
        Object.assign(it, v);
        [...this.alerted].forEach((a) => { if (a.split("|")[1] === it.symbol) this.alerted.delete(a); });
        this.App.store.save(); this.fill();
      }
    }
    async removeSelected() {
      const it = this.selected();
      if (!it) return;
      if (!await U.ask(`把 ${it.symbol} ${it.name || ""} 從觀察清單移除？`)) return;
      this.items().splice(this.items().indexOf(it), 1);
      this.App.store.save(); this.fill();
    }
    menu(sym, x, y) {
      const App = this.App, it = this.find(sym);
      if (!it) return;
      const name = it.name || "";
      U.menu([["設定目標價／備註", () => this.editSelected()], [`買進 ${sym} ${name}`, () => App.addTx({ type: "buy", symbol: sym, name })],
        [`連線下單：買進 ${sym}`, () => App.orderOf(sym, "B")], null, ["基本資料", () => App.showInfo(sym)], ["走勢圖", () => App.showChart(sym)],
        ["漲跌預測", () => this.predict(sym)], ["個股股利查詢", () => { App.goPage("個股股利查詢"); App.exdiv.query(sym); }], null,
        ["從觀察清單移除", () => this.removeSelected()]], x, y);
    }
    predict(sym) { this.App.goPage("漲跌預測"); this.App.predict.sym.setText(sym); this.App.predict.run([sym]); }
    fill() {
      const App = this.App, rows = [], hits = [], today = C.today();
      const na = () => cell("—", -1e18), fmt = (x) => (x ? f2(x) : "—");
      for (const it of this.items()) {
        const sym = it.symbol, q = App.store.prices[sym] || {}, price = q.price, prev = q.prev;
        const name = App.stockName(sym) || it.name || sym, chg = price && prev ? price - prev : null;
        const bt = it.buy_target, st = it.sell_target;
        let alert = "", acolor = null;
        if (price && bt && price <= bt) { alert = "到買點"; acolor = "var(--WARN)"; }
        else if (price && st && price >= st) { alert = "到賣點"; acolor = "var(--WARN)"; }
        else if (price && bt) alert = `距買點 ${C.signed((price / bt - 1) * 100, 1)}%`;
        else if (price && st) alert = `距賣點 ${C.signed((price / st - 1) * 100, 1)}%`;
        if (alert.startsWith("到")) hits.push([sym, name, alert, price]);
        const ap = it.added_price, since = price && ap ? (price / ap - 1) * 100 : null;
        const c = App.divclass && App.divclass.info[sym];
        const yld = c && price && c.ttm ? c.ttm / price * 100 : null;
        const held = (App.holdings[sym] || {}).shares || 0;
        rows.push({ id: sym, cells: [cell(sym, sym, { left: true, bold: true }), cell(name + (held > 0 ? "（持有中）" : ""), name, { left: true }), App.priceCell(sym, price),
          chg !== null ? cell(C.signed(chg, 2), chg, { color: U.pnl(chg) }) : na(), chg !== null ? cell(C.signed(chg / prev * 100, 2) + "%", chg / prev * 100, { color: U.pnl(chg) }) : na(),
          cell(fmt(q.open), q.open || 0), cell(fmt(q.high), q.high || 0), cell(fmt(q.low), q.low || 0), cell(fmt(bt), bt || 0), cell(fmt(st), st || 0),
          cell(alert || "—", alert, { left: true, color: acolor, bold: !!acolor }), cell(fmt(ap), ap || 0),
          since !== null ? cell(C.signed(since, 2) + "%", since, { color: U.pnl(since) }) : na(), cell(yld ? C.fixed(yld, 2) + "%" : "—", yld || 0),
          cell(C.freqText(c), c ? c.freq : "", { left: true }), cell(it.note || "", it.note || "", { left: true }), cell(it.added || "", it.added || "", { left: true })] });
      }
      U.tintRows(rows, App.store.prices, 0, [10]);
      this.table.setRows(rows);
      this.summary.textContent = `觀察 ${rows.length} 檔` + (hits.length ? `，${hits.length} 檔到價` : "");
      const fresh = hits.filter((h) => !this.alerted.has(`${today}|${h[0]}|${h[2]}`));
      fresh.forEach((h) => this.alerted.add(`${today}|${h[0]}|${h[2]}`));
      if (fresh.length) {
        U.status("到價提醒：" + fresh.map(([s, n, a, p]) => `${s} ${n} ${a}（${App.gfmt(p)}）`).join("；"), 15000);
        if (App.store.settings.notify_popup !== false && fresh.length > 3) {      // 一次很多檔到價：合成一則，不要洗版
          App.notify(`🔔 ${fresh.length} 檔觀察股票到價`, fresh.map(([s, n, a, p]) => `${s} ${n} ${a}（${f2(p)}）`).join("\n"), null, "自選觀察");
        } else if (App.store.settings.notify_popup !== false) {
          for (const [s, n, a, p] of fresh) {
            const it = this.find(s) || {}, tgt = a === "到買點" ? it.buy_target : it.sell_target;
            App.notify(`${a === "到買點" ? "📉" : "📈"} ${s} ${n} ${a}`, tgt ? `現價 ${f2(p)}，已${a === "到買點" ? "跌到買進" : "漲到賣出"}目標價 ${f2(tgt)}` : `現價 ${f2(p)}`, s);
          }
        }
      }
    }
  }
  window.App = window.App || {};
  window.App.WatchPage = WatchPage;
  window.App.WatchDialog = WatchDialog;
  window.App.detectWatchLevels = detectWatchLevels;
})();
