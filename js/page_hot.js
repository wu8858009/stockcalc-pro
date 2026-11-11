/* 熱門股票（對照電腦版 HotPage）：熱門排行、全部 ETF、篩選、加入／取消觀察。 */
(function () {
  "use strict";
  const C = window.Core, M = window.Market, U = window.UI, T = window.CONTENT;
  const el = U.el, cell = U.cell, f2 = C.f2;
  const WATCH_COL = 13;

  class HotPage {
    constructor() {
      const App = this.App = window.App, st = App.store.settings;
      this.exchange = st.hot_exchange || "TAI"; this.rankIdx = st.hot_rank || 0; this.limit = st.hot_limit === undefined ? 50 : st.hot_limit;
      this.kind = st.hot_kind || "stock"; this.etfType = st.hot_etf_type || 0;
      this.rows = []; this.rankTime = ""; this.loadedAt = 0; this.busy = false; this.divBusy = false; this.gen = 0;
      this.el = el("div");
      this.kseg = U.seg(["熱門排行", "全部 ETF"], (i) => this.setKind(i ? "etf" : "stock"));
      this.mseg = U.seg(["上市", "上櫃", "全部"], (i) => this.setExchange(["TAI", "TWO", "ALL"][i]));
      this.rseg = U.seg(C.HOT_RANKS.map((x) => x[0]), (i) => this.setRank(i));
      this.cnt = U.combo([["前 30 名", 30], ["前 50 名", 50], ["前 100 名", 100], ["全部", 0]], () => this.setLimit(+this.cnt.value));
      this.cnt.value = String(this.limit);
      this.etype = U.combo(C.ETF_TYPES.map((x, i) => [x[0], i]), () => this.setEtfType(this.etype.selectedIndex));
      this.etype.selectedIndex = this.etfType;
      this.filt = el("input", { placeholder: "篩選代號／名稱（例：高股息、美債）", style: { maxWidth: "230px" }, oninput: () => this.fill() });
      this.status = el("div", { cls: "hint" });
      this.table = new U.Table(["排名", "代號", "名稱", "現價", "漲跌", "漲跌幅", "最高", "最低", "成交量（張）", "成交值（億）", "殖利率", "配息", "狀態", "觀察"],
        { sortable: false, multi: true, flashCol: 3, onClick: (r, col) => { if (col === WATCH_COL) this.onClick(r); },
          onDbl: (r) => this.addRows([r]), onMenu: (r, x, y) => r && this.menu(r, x, y),
          onKey: (e) => { if (e.key === "Enter" || e.key === "Insert") this.addSelected(); } });
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.el.append(el("div", { cls: "row" }, this.kseg, this.mseg, this.rseg, this.cnt, this.etype, this.filt, U.btn("重新整理", () => this.load(true)),
        el("span", { cls: "grow" }), U.btn("＋ 加入觀察", () => this.addSelected(), "primary", "快捷鍵：Ctrl+W／Enter")),
        this.status, this.table.el,
        U.hint("資料來源：Yahoo 奇摩股市即時排行與報價。「全部 ETF」列出上市櫃所有 ETF，可依成交量、漲跌幅等排序，再用類型（股票型、債券、主動式、槓桿反向）或篩選字找。點「觀察」欄的「＋ 加入」或連按兩下，就會加入自選觀察，點「★ 已加入」可取消觀察；也可以選多列（Ctrl／Shift）後按右上「＋ 加入觀察」。右鍵可看基本資料、走勢圖、漲跌預測。"));
      this.sync();
    }
    onShow() { this.load(); }
    sync() {
      this.mseg.setOn(["TAI", "TWO", "ALL"].indexOf(this.exchange)); this.kseg.setOn(this.kind === "etf" ? 1 : 0);
      this.etype.classList.toggle("hidden", this.kind !== "etf"); this.rseg.setOn(this.rankIdx);
    }
    save() { Object.assign(this.App.store.settings, { hot_exchange: this.exchange, hot_rank: this.rankIdx, hot_limit: this.limit, hot_kind: this.kind, hot_etf_type: this.etfType }); this.App.store.save(); }
    setKind(k) { this.kind = k; this.sync(); this.save(); this.load(true); }
    setEtfType(i) { this.etfType = i; this.save(); this.fill(); this.ensureDiv(); }
    setExchange(ex) { this.exchange = ex; this.sync(); this.save(); this.load(true); }
    setRank(i) { this.rankIdx = i; this.sync(); this.save(); this.load(true); }
    setLimit(n) { this.limit = n; this.save(); if (this.kind === "etf") { this.fill(); this.ensureDiv(); } else this.load(true); }
    visibleRows() {
      let rows = this.rows;
      if (this.kind === "etf" && this.etfType) {
        const want = C.ETF_TYPES[this.etfType][1];
        rows = rows.filter((r) => (want === "" ? C.etfType(r.symbol) === "" : C.etfType(r.symbol) !== "" && want.includes(C.etfType(r.symbol))));
      }
      const kw = this.filt.value.trim().toLowerCase();
      if (kw) rows = rows.filter((r) => r.symbol.toLowerCase().includes(kw) || r.name.toLowerCase().includes(kw));
      if (this.kind === "etf" && this.limit) rows = rows.slice(0, this.limit);
      return rows;
    }
    async load(force) {
      if (this.busy) return;
      if (!force && this.loadedAt && Date.now() - this.loadedAt < 60000) return;
      this.busy = true;
      const [label, sort] = C.HOT_RANKS[this.rankIdx], key = [this.kind, this.exchange, sort, this.limit].join("|");
      const where = { TAI: "上市", TWO: "上櫃" }[this.exchange] || "上市＋上櫃";
      this.status.textContent = this.kind === "etf" ? `下載${where}全部 ETF 報價…` : `下載${where}${label}排行…`;
      let rows, t, err = "";
      try {
        if (this.kind === "etf") {
          [rows, t] = await M.fetchEtfBoard(this.App.stockList, this.exchange);
          if (!rows.length) throw new Error("股票清單還沒載入完成，請稍後按「重新整理」");
          rows = C.sortBoard(rows, sort);
        } else if (this.exchange === "ALL") {
          const n = this.limit || 100;
          const [a, ta] = await M.fetchRank("TAI", sort, n), [b] = await M.fetchRank("TWO", sort, n);
          rows = C.sortBoard(a.concat(b), sort, n); t = ta;
        } else [rows, t] = await M.fetchRank(this.exchange, sort, this.limit || 100);
      } catch (e) { err = e.message; }
      this.busy = false;
      if (err) { this.status.textContent = `排行下載失敗：${err}`; return; }
      if (key !== [this.kind, this.exchange, C.HOT_RANKS[this.rankIdx][1], this.limit].join("|")) { this.load(true); return; }
      this.rows = rows; this.rankTime = t; this.loadedAt = Date.now();
      setTimeout(() => this.ensureDiv(), 0);
      for (const r of rows) if (!this.App.stockList[r.symbol]) this.App.stockList[r.symbol] = { name: r.name, market: r.market, close: r.prev };
      this.fill();
    }
    fill() {
      const App = this.App, watched = new Set(App.store.watchlist.map((w) => w.symbol)), rows = [], prices = {};
      const shown = this.visibleRows(), fmt = (x) => (x ? f2(x) : "—");
      for (const r of shown) {
        const sym = r.symbol;
        prices[sym] = { price: r.price, prev: r.prev, limit_up: r.limit_up ? r.price : null, limit_down: r.limit_down ? r.price : null };
        const held = ((App.holdings[sym] || {}).shares || 0) > 0;
        const tags = [["漲停", r.limit_up], ["跌停", r.limit_down], ["持有中", held]].filter((x) => x[1]).map((x) => x[0]);
        const inWatch = watched.has(sym), c = App.divclass.info[sym];
        const yld = c && r.price && c.ttm ? c.ttm / r.price * 100 : null;
        const freq = c ? C.divLabel(c) : this.divBusy ? "查詢中…" : "—";
        rows.push({ id: sym, cells: [cell(String(r.rank), r.rank), cell(sym, sym, { left: true, bold: true }), cell(r.name, r.name, { left: true }),
          cell(fmt(r.price), r.price || 0, { bold: true }), cell(r.change !== null ? C.signed(r.change, 2) : "—", r.change || 0),
          cell(r.pct !== null ? C.signed(r.pct, 2) + "%" : "—", r.pct || 0), cell(fmt(r.high), r.high || 0), cell(fmt(r.low), r.low || 0),
          cell(C.money(r.volume / 1000), r.volume), cell(C.money(r.turnover_k / 1e5, 2), r.turnover_k), cell(yld ? C.fixed(yld, 2) + "%" : "—", yld || 0),
          cell(freq, c && C.FREQ_ORDER.includes(c.freq) ? C.FREQ_ORDER.indexOf(c.freq) : 99, { left: true }),
          cell(tags.join("、"), "", { left: true, color: r.limit_up || r.limit_down ? "var(--WARN)" : null }),
          cell(inWatch ? "★ 已加入" : "＋ 加入", inWatch, { left: true, link: true, color: inWatch ? "var(--MUTED)" : "var(--ACCENT_TEXT)", bold: !inWatch,
            tip: inWatch ? "已在自選觀察裡，點一下取消觀察" : "點一下加入自選觀察" })] });
      }
      U.tintRows(rows, prices, 1, [12, 13]);
      this.table.setRows(rows);
      const label = C.HOT_RANKS[this.rankIdx][0], when = this.rankTime.length >= 16 ? this.rankTime.slice(11, 16) : "";
      const where = { TAI: "上市", TWO: "上櫃" }[this.exchange] || "上市＋上櫃";
      let head;
      if (this.kind === "etf") {
        head = `${where}　全部 ETF 共 ${this.rows.length} 檔（依${label}排序）`;
        if (shown.length !== this.rows.length) head += `，顯示 ${shown.length} 檔` + (this.limit && shown.length === this.limit ? "（可在右邊選「全部」）" : "");
      } else head = `${where}　${label}排行 前 ${this.rows.length} 名` + (shown.length !== this.rows.length ? `，符合篩選 ${shown.length} 檔` : "");
      this.status.textContent = head + (when ? `　（時間 ${when}）` : "") + `　已在觀察 ${shown.filter((r) => watched.has(r.symbol)).length} 檔`;
    }
    async ensureDiv() {
      if (this.divBusy) return;
      const dc = this.App.divclass, today = C.today();
      const todo = this.visibleRows().slice(0, 150).map((r) => r.symbol).filter((s) => !dc.cache[s] || C.daysBetween(dc.cache[s].fetched || "2000-01-01", today) >= 7);
      if (!todo.length) return;
      this.divBusy = true; this.fill();
      const markets = Object.fromEntries(this.rows.map((r) => [r.symbol, r.market]));
      let done = 0;
      const worker = async () => {
        while (todo.length) {
          const sym = todo.shift();
          try { const ev = await M.fetchDividendHistory(sym, markets[sym]); dc.cache[sym] = { fetched: today, events: ev }; dc.info[sym] = C.classifyDividends(ev, today); } catch (_e) { /* 下次再試 */ }
          if (++done % 10 === 0) this.fill();
        }
      };
      await Promise.all([...Array(4)].map(worker));
      this.divBusy = false; dc.saveCache(); this.fill();
    }
    onClick(r) { const sym = r.cells[1].text; if (this.App.watch.find(sym)) this.removeWatch(sym); else this.addRows([r]); }
    async removeWatch(sym) {
      const W = this.App.watch, item = W.find(sym);
      if (!item) return;
      if (item.buy_target || item.sell_target || item.note) {
        const extra = [item.buy_target ? `買進目標 ${this.App.gfmt(item.buy_target)}` : "", item.sell_target ? `賣出目標 ${this.App.gfmt(item.sell_target)}` : "", item.note ? "備註" : ""].filter(Boolean).join("、");
        if (!await U.ask(`取消觀察 ${sym} ${item.name || ""}？\n（已設定的${extra}會一起刪除）`)) return;
      }
      W.items().splice(W.items().indexOf(item), 1);
      [...W.alerted].forEach((a) => { if (a.split("|")[1] === sym) W.alerted.delete(a); });
      this.App.store.save(); W.fill(); this.fill();
      U.status(`已取消觀察：${sym} ${item.name || ""}`, 5000);
    }
    async addRows(rows) {
      const added = [];
      for (const r of rows) {
        const sym = r.cells[1].text, info = this.rows.find((x) => x.symbol === sym);
        if (info && await this.App.watch.add(sym, info.name, true)) added.push(`${sym} ${info.name}`);
      }
      if (added.length) U.status("已加入自選觀察：" + added.join("、"), 6000);
      this.fill();
    }
    addSelected() {
      const rows = this.table.selected();
      if (!rows.length) { U.info("請先選擇要加入的股票（可用 Ctrl／Shift 多選）"); return; }
      this.addRows(rows);
    }
    menu(r, x, y) {
      const App = this.App, sym = r.cells[1].text, n = this.table.selected().length;
      const items = [];
      if (n <= 1 && App.watch.find(sym)) items.push([`取消觀察：${sym}`, () => this.removeWatch(sym)]);
      else items.push([n > 1 ? `加入自選觀察（${n} 檔）` : `加入自選觀察：${sym}`, () => this.addSelected()]);
      items.push(["設定目標價（到價提醒）", async () => { await App.watch.editSymbol(sym); this.fill(); }], null,
        ["基本資料", () => App.showInfo(sym)], ["走勢圖", () => App.showChart(sym)], ["漲跌預測", () => App.watch.predict(sym)],
        ["個股股利查詢", () => { App.goPage("個股股利查詢"); App.exdiv.query(sym); }]);
      U.menu(items, x, y);
    }
  }
  window.App = window.App || {};
  window.App.HotPage = HotPage;
})();
