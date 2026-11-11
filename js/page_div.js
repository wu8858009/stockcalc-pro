/* 配息分類、除息查詢（本期可領、除權息預告、個股股利查詢）。對照電腦版 DividendClassPage、ExDividendPage。 */
(function () {
  "use strict";
  const C = window.Core, M = window.Market, U = window.UI, T = window.CONTENT;
  const el = U.el, cell = U.cell, money = C.money;
  const g = (x) => String(Number(Number(x).toPrecision(6)));

  // ================= 配息分類 =================
  class DividendClassPage {
    constructor() {
      const App = this.App = window.App;
      this.info = {}; this.cache = U.ls.get("sc_divhist", {}); this.running = false;
      this.el = el("div");
      this.onlyHold = U.check("只顯示目前持股", true, () => this.fill(), T.WIDGET_TIPS["只顯示目前持股"]);
      this.fFreq = U.combo([["全部頻率", ""]].concat(C.FREQ_ORDER.map((f) => [f, f])), () => this.fill());
      this.fMonth = U.combo([["全部月份", 0]].concat([...Array(12)].map((_, i) => [`${i + 1}月除息`, i + 1])), () => this.fill());
      this.bRefresh = U.btn("重新偵測", () => this.refreshData(true), "", T.WIDGET_TIPS["重新偵測"]);
      this.status = el("span", { cls: "hint" }); this.summary = el("span", { cls: "hint" });
      this.table = new U.Table(["代號", "名稱", "配息頻率", "除息月份", "最近除息日", "最近每股配息", "近12月每股合計", "殖利率", "持有股數", "預估年領", "下次除息"],
        { onClick: (r) => { const c = this.info[r.cells[0].text]; if (c && c.note) U.status(c.note, 6000); }, onMenu: (r, x, y) => r && this.menu(r.cells[0].text, x, y) });
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.cal = new U.Table(["月份", "檔數", "預估可領", "除息股票"], { sortable: false, onClick: (r) => this.onMonthClick(r) });
      this.table.el.style.flex = "1 1 50%"; this.cal.el.style.flex = "1 1 50%";
      this.el.append(el("div", { cls: "row" }, this.onlyHold, el("span", null, "頻率"), this.fFreq, el("span", null, "月份"), this.fMonth, this.bRefresh, this.status, this.summary),
        this.table.el, U.hint("1~12 月除息月曆（依目前持股股數 × 該月最近一次每股配息估算；點月份可篩選上表，再點一次取消）"), this.cal.el,
        U.hint("配息資料來自 Yahoo 近 5 年除息紀錄，頻率依最近幾次除息的間隔判斷；月份為「除息月」，實際入帳通常再晚 3~5 週。預估金額未扣二代健保補充保費與匯費。"));
    }
    saveCache() { U.ls.set("sc_divhist", this.cache); }
    symbols() { return [...new Set(this.App.store.transactions.map((t) => t.symbol).concat(this.App.store.watchlist.map((w) => w.symbol)))].sort(); }
    async refreshData(force) {
      const today = C.today();
      for (const sym of Object.keys(this.cache)) this.info[sym] = C.classifyDividends(this.cache[sym].events || [], today);
      const todo = this.symbols().filter((x) => force || !this.cache[x] || C.daysBetween(this.cache[x].fetched || "2000-01-01", today) >= 7);
      this.fill();
      if (!todo.length || this.running) return;
      this.running = true; this.bRefresh.disabled = true;
      this.status.textContent = `下載 ${todo.length} 檔的配息紀錄…`;
      this.fill();
      const got = {}, errs = [];
      const queue = todo.slice();
      const worker = async () => { while (queue.length) { const x = queue.shift(); try { got[x] = await M.fetchDividendHistory(x, (this.App.stockList[x] || {}).market); } catch (e) { errs.push(`${x}：${e.message}`); } } };
      await Promise.all([...Array(4)].map(worker));
      this.running = false; this.bRefresh.disabled = false;
      for (const sym of Object.keys(got)) { this.cache[sym] = { fetched: today, events: got[sym] }; this.info[sym] = C.classifyDividends(got[sym], today); }
      if (Object.keys(got).length) this.saveCache();
      const n = C.now();
      this.status.textContent = `已更新 ${Object.keys(got).length} 檔（${n.time.slice(0, 5)}）` + (errs.length ? `　部分失敗：${errs.slice(0, 3).join("；")}` : "");
      this.fill(); this.App.fillHoldings();
    }
    held(sym) { const h = this.App.holdings[sym]; return h ? h.shares : 0; }
    fill() {
      const App = this.App, wantF = this.fFreq.value, wantM = +this.fMonth.value, rows = [];
      let totYear = 0;
      for (const sym of this.symbols()) {
        const shares = this.held(sym);
        if (this.onlyHold.input.checked && shares <= 0) continue;
        const c = this.info[sym];
        if (wantF && (!c || c.freq !== wantF)) continue;
        if (wantM && (!c || !c.months.includes(wantM))) continue;
        const name = App.stockName(sym), price = (App.store.prices[sym] || {}).price;
        if (!c) { rows.push({ id: sym, cells: [cell(sym, sym, { left: true, bold: true }), cell(name, name, { left: true }), cell(this.running ? "偵測中…" : "—", 99, { left: true })].concat([...Array(8)].map(() => cell("", ""))) }); continue; }
        const yld = price && c.ttm ? c.ttm / price * 100 : null, yearAmt = shares * c.ttm;
        totYear += yearAmt;
        rows.push({ id: sym, cells: [cell(sym, sym, { left: true, bold: true }), cell(name, name, { left: true }),
          cell(C.freqText(c), C.FREQ_ORDER.includes(c.freq) ? C.FREQ_ORDER.indexOf(c.freq) : 99, { left: true, bold: true, color: c.freq === "月配" ? "var(--ACCENT_TEXT)" : null }),
          cell(C.monthsText(c.months), c.months.length ? c.months[0] : 99, { left: true }), cell(c.last_date || "—", c.last_date, { left: true }),
          cell(c.last_amount ? g(c.last_amount) : "—", c.last_amount), cell(c.ttm ? `${g(c.ttm)}（${c.ttm_count}次）` : "—", c.ttm),
          cell(yld ? C.fixed(yld, 2) + "%" : "—", yld || 0, { color: yld && yld >= 6 ? "var(--GAIN)" : null }), cell(shares ? money(shares) : "—", shares),
          cell(yearAmt ? money(yearAmt) : "—", yearAmt), cell(c.next_month ? c.next_month + "月" : "—", c.next_month || 99)] });
      }
      U.tintRows(rows, App.store.prices);
      this.table.setRows(rows);
      this.fillCalendar();
      this.summary.textContent = `共 ${rows.length} 檔，預估年領 ${money(totYear)} 元`;
    }
    fillCalendar() {
      const rows = [], cur = +C.today().slice(5, 7);
      for (let m = 1; m <= 12; m++) {
        const names = [];
        let amt = 0;
        for (const sym of this.symbols()) {
          const shares = this.held(sym), c = this.info[sym];
          if (!c || !c.months.includes(m) || (this.onlyHold.input.checked && shares <= 0)) continue;
          names.push(`${sym} ${this.App.stockName(sym)}（${c.freq}）`);
          amt += shares * (m in c.per_month ? c.per_month[m] : c.last_amount);
        }
        rows.push({ id: "m" + m, cells: [cell(m + "月" + (m === cur ? "（本月）" : ""), m, { left: true, bold: m === cur, color: m === cur ? "var(--ACCENT_TEXT)" : null }),
          cell(String(names.length), names.length), cell(amt ? money(amt) : "—", amt), cell(names.length ? names.join("、") : "—", "", { left: true })] });
      }
      this.cal.setRows(rows);
    }
    onMonthClick(r) { const m = r.cells[0].key; this.fMonth.value = String(+this.fMonth.value === m ? 0 : m); this.fill(); }
    menu(sym, x, y) {
      const App = this.App;
      U.menu([["走勢圖", () => App.showChart(sym)], ["基本資料", () => App.showInfo(sym)], ["個股股利查詢", () => { App.goPage("個股股利查詢"); App.exdiv.query(sym); }]], x, y);
    }
  }

  // ================= 除息查詢 =================
  const STATUS_COLOR = { 即將除息: "var(--ACCENT_TEXT)", 今天除息: "var(--WARN)", "已除息・待發放": "var(--WARN)", 已發放: "var(--MUTED)" };
  class ExDividendPage {
    constructor() {
      const App = this.App = window.App;
      this.cache = U.ls.get("sc_cashdiv", {}); this.ann = []; this.annTime = 0; this.busy = false; this.curRows = []; this.sub = 0;
      this.el = el("div");
      // (1) 本期可領
      this.bRef = U.btn("重新查詢", () => this.refresh(true), "", T.WIDGET_TIPS["重新查詢"]);
      this.curSum = el("span", { cls: "hint" });
      this.tCur = new U.Table(["代號", "名稱", "狀態", "除息日", "最後買進日", "發放日", "每股現金股利", "可領股數", "股利金額", "二代健保", "匯費", "預估實領", "股利紀錄"],
        { sortable: false, onDbl: () => this.recordSelected(), onKey: (e) => { if (e.key === "Enter") this.recordSelected(); } });
      this.tCur.setHeaderTips(T.HEADER_TIPS);
      this.p1 = el("div", { cls: "col", style: { flex: "1", minHeight: "0" } },
        el("div", { cls: "row" }, this.bRef, U.btn("記錄到股利紀錄", () => this.recordSelected(), "", "快捷鍵：Enter"), this.curSum), this.tCur.el,
        U.hint("可領股數＝除息日前一天收盤時的持股（最後買進日當天收盤前買進才有）。即將除息的以目前持股估算；股利元以下捨去，單次達 20,000 元扣 2.11% 二代健保補充保費；匯費可在「設定」調整。選一列按「記錄到股利紀錄」（或連按兩下）可把實領金額記到股利紀錄。"));
      // (2) 除權息預告
      this.annKw = el("input", { placeholder: "搜尋代號或名稱", style: { maxWidth: "220px" }, oninput: () => this.fillAnn() });
      this.annMine = U.check("只看我的持股", false, () => this.fillAnn());
      this.annCash = U.check("只看除息（有現金股利）", false, () => this.fillAnn());
      this.bAnn = U.btn("重新整理", () => this.loadAnn(true));
      this.annSum = el("span", { cls: "hint" });
      this.tAnn = new U.Table(["除權息日", "最後買進日", "代號", "名稱", "類型", "每股現金股利", "配股", "市場", "我的持股", "預估可領"],
        { onDbl: (r) => this.query(r.cells[2].text), onKey: (e, r) => { if (e.key === "Enter" && r) this.query(r.cells[2].text); } });
      this.tAnn.setHeaderTips(T.HEADER_TIPS);
      this.p2 = el("div", { cls: "col", style: { flex: "1", minHeight: "0" } }, el("div", { cls: "row" }, this.annKw, this.annMine, this.annCash, this.bAnn, this.annSum), this.tAnn.el,
        U.hint("資料來源：證交所、櫃買中心除權除息預告表。現金股利空白表示尚未公告金額。連按兩下可查該股歷年股利。"));
      // (3) 個股股利查詢
      this.qSym = new U.SymbolEdit(App, { width: "260px" });
      this.qSym.onEnter = () => this.query(this.qSym.code());
      this.qSum = el("span", { cls: "hint", style: { flex: "1" } });
      this.tQ = new U.Table(["股利期別", "除息日", "每股現金股利", "發放日", "配股（元）", "填息天數", "當時可領股數", "當時可領（估）"]);
      this.tQ.setHeaderTips(T.HEADER_TIPS);
      this.p3 = el("div", { cls: "col", style: { flex: "1", minHeight: "0" } },
        el("div", { cls: "row" }, this.qSym.input, U.btn("查詢", () => this.query(this.qSym.code()), "primary"), this.qSum), this.tQ.el);
      this.el.append(this.p1, this.p2, this.p3);
      this.selectSub(0);
    }
    selectSub(i) { this.sub = i; [this.p1, this.p2, this.p3].forEach((p, k) => p.classList.toggle("hidden", k !== i)); }
    currentSub() { return this.sub; }
    save() { U.ls.set("sc_cashdiv", this.cache); }
    stale(sym, hours) { const c = this.cache[sym]; return !c || !c.t || Date.now() - c.t > (hours || 12) * 3600000; }
    market(sym) { return (this.App.stockList[sym] || {}).market; }
    symbols() { return [...new Set(this.App.store.transactions.map((t) => t.symbol))].sort(); }
    async refresh(force) {
      this.fillCurrent();
      const todo = this.symbols().filter((x) => force || this.stale(x));
      if (!todo.length || this.busy) return;
      this.busy = true; this.bRef.disabled = true;
      this.curSum.textContent = `查詢 ${todo.length} 檔的股利資料…`;
      if (force) this.loadAnn(true);
      const got = {}, errs = [], q = todo.slice();
      const worker = async () => { while (q.length) { const x = q.shift(); try { got[x] = await M.fetchCashDividends(x, this.market(x)); } catch (e) { errs.push(`${x}：${e.message}`); } } };
      await Promise.all([...Array(4)].map(worker));
      this.busy = false; this.bRef.disabled = false;
      const n = C.now(), stamp = n.date + "T" + n.time;
      Object.keys(got).forEach((s) => { this.cache[s] = { fetched: stamp, t: Date.now(), rows: got[s] }; });
      if (Object.keys(got).length) { this.save(); this.App.clearHeldDiv(); this.App.fillHoldings(); }
      this.fillCurrent();
      if (errs.length) U.status(`部分股利資料查詢失敗：${errs.slice(0, 3).join("；")}`, 8000);
    }
    currentEvents() {
      const App = this.App, today = C.today(), recent = C.addDays(today, -45), st = App.store, out = [];
      for (const sym of this.symbols()) {
        for (const r of (this.cache[sym] || {}).rows || []) {
          if (!r.cash) continue;
          const pay = r.pay;
          let status, shares;
          if (r.ex > today) { status = "即將除息"; shares = (App.holdings[sym] || {}).shares || 0; }
          else if (r.ex === today) { status = "今天除息"; shares = C.sharesBefore(st.transactions, st.dividends, sym, r.ex); }
          else if (!pay || pay >= today) { status = "已除息・待發放"; shares = C.sharesBefore(st.transactions, st.dividends, sym, r.ex); }
          else if (pay >= recent) { status = "已發放"; shares = C.sharesBefore(st.transactions, st.dividends, sym, r.ex); }
          else continue;
          if (shares <= 0) continue;
          const [gross, nhi, fee, net] = C.dividendPayout(shares, r.cash, st.settings);
          out.push(Object.assign({ sym, status, shares, gross, nhi, fee, net, recorded: this.recorded(sym, r) }, r));
        }
      }
      const order = { 今天除息: 0, 即將除息: 1, "已除息・待發放": 2, 已發放: 3 };
      out.sort((a, b) => order[a.status] - order[b.status] || ((a.pay || a.ex) < (b.pay || b.ex) ? -1 : (a.pay || a.ex) > (b.pay || b.ex) ? 1 : a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0));
      return out;
    }
    recorded(sym, r) {
      const lo = r.ex, hi = C.addDays(r.pay || r.ex, 20);
      return this.App.store.dividends.some((d) => d.symbol === sym && lo <= d.date && d.date <= hi && d.cash);
    }
    fillCurrent() {
      const App = this.App, ev = this.currentEvents(), rows = [];
      this.curRows = ev;
      let pending = 0, paid = 0;
      for (const e of ev) {
        const muted = e.status === "已發放";
        if (muted) paid += e.net; else pending += e.net;
        const lastBuy = C.CALENDAR.prevTradingDay(e.ex);
        rows.push({ id: e.sym + "|" + e.ex, ex: e.ex, cells: [cell(e.sym, e.sym, { left: true, bold: true }), cell(App.stockName(e.sym), "", { left: true }),
          cell(e.status, e.status, { left: true, bold: true, color: STATUS_COLOR[e.status] }), cell(C.shortDay(e.ex), e.ex, { left: true }),
          cell(e.status === "即將除息" ? C.shortDay(lastBuy) : "—", lastBuy, { left: true }), cell(e.pay ? C.shortDay(e.pay) : "未公告", e.pay || "9", { left: true }),
          cell(g(e.cash), e.cash), cell(money(e.shares), e.shares), cell(money(e.gross), e.gross), cell(e.nhi ? money(e.nhi) : "—", e.nhi), cell(e.fee ? money(e.fee) : "—", e.fee),
          cell(money(e.net), e.net, { color: muted ? "var(--MUTED)" : "var(--GAIN)", bold: !muted }),
          cell(e.recorded ? "已記錄" : e.status === "已發放" ? "可記錄" : "—", e.recorded, { left: true, color: e.recorded ? "var(--LOSS)" : null })] });
      }
      U.tintRows(rows, App.store.prices, 0, [2]);
      this.tCur.setRows(rows);
      this.curSum.textContent = `即將與待發放預估實領 ${money(pending)} 元　近 45 天已發放 ${money(paid)} 元${this.busy ? "　查詢中…" : ""}`;
    }
    async recordSelected() {
      const r = this.tCur.current();
      if (!r) { U.info("請先在表格選一筆股利"); return; }
      const sym = r.cells[0].text, ex = r.ex, e = this.curRows.find((x) => x.sym === sym && x.ex === ex);
      if (!e) return;
      if (e.recorded && !await U.ask("這筆股利看起來已經記錄過了，仍要再新增一筆？")) return;
      const note = `${e.period} 每股 ${g(e.cash)} × ${money(e.shares)} 股，除息 ${e.ex}`;
      await this.App.addDiv(sym, { date: e.pay || e.ex, cash: e.net, note });
      this.fillCurrent();
    }
    async loadAnn(force) {
      if (this.ann.length && !force && this.annTime && Date.now() - this.annTime < 3600000) { this.fillAnn(); return; }
      this.bAnn.disabled = true; this.annSum.textContent = "下載除權息預告…";
      let rows = [], err = "";
      try { rows = await M.fetchExdivAnnouncements(); } catch (e) { err = e.message; }
      this.bAnn.disabled = false;
      if (rows.length) { this.ann = rows; this.annTime = Date.now(); }
      this.fillAnn();
      if (err) this.annSum.textContent = `下載失敗：${err}`;
    }
    fillAnn() {
      const App = this.App, kw = this.annKw.value.trim().toLowerCase(), today = C.today(), rows = [];
      let mine = 0;
      for (let a of this.ann) {
        const held = (App.holdings[a.code] || {}).shares || 0;
        if (this.annMine.input.checked && held <= 0) continue;
        if (this.annCash.input.checked && !a.kind.includes("息")) continue;
        if (kw && !a.code.toLowerCase().includes(kw) && !a.name.toLowerCase().includes(kw)) continue;
        if (a.date < today) continue;
        let cash = a.cash, src = "";
        if (!cash && a.kind.includes("息")) {
          const y = ((this.cache[a.code] || {}).rows || []).find((r) => r.ex === a.date);
          if (y && y.cash) { cash = y.cash; src = "（Yahoo）"; }
        }
        a = Object.assign({}, a, { cash });
        const est = held && a.cash ? C.dividendPayout(held, a.cash, App.store.settings)[3] : 0;
        if (held > 0) mine++;
        const hc = held > 0 ? "var(--ACCENT_TEXT)" : null;
        rows.push({ id: a.code + "|" + a.date + "|" + a.kind, cells: [cell(C.shortDay(a.date), a.date, { left: true, color: hc, bold: held > 0 }),
          cell(C.shortDay(C.CALENDAR.prevTradingDay(a.date)), a.date, { left: true }), cell(a.code, a.code, { left: true, bold: true, color: hc }), cell(a.name, a.name, { left: true, color: hc }),
          cell(a.kind, a.kind, { left: true }), cell(a.cash ? g(a.cash) + src : a.kind.includes("息") ? "未公告" : "—", a.cash || 0), cell(a.stock ? g(a.stock) : "—", a.stock || 0),
          cell(a.market, a.market, { left: true }), cell(held ? money(held) : "—", held), cell(est ? money(est) : "—", est, { color: est ? "var(--GAIN)" : null })] });
      }
      U.tintRows(rows, App.store.prices, 2);
      this.tAnn.setRows(rows);
      const when = this.annTime ? C.tsToTw(this.annTime / 1000).time.slice(0, 5) : "—";
      this.annSum.textContent = `共 ${rows.length} 筆，其中 ${mine} 筆是你的持股（${when} 更新）`;
    }
    async query(sym) {
      sym = (sym || "").trim().toUpperCase();
      if (!sym) return;
      this.selectSub(2); this.App.syncSub(this);
      this.qSym.setText(sym);
      if (!this.stale(sym, 6)) { this.fillQuery(sym); return; }
      this.qSum.textContent = `查詢 ${sym} 的歷年股利…`;
      let rows = null, err = "";
      try { rows = await M.fetchCashDividends(sym, this.market(sym)); } catch (e) { err = e.message; }
      if (rows) {
        const n = C.now();
        this.cache[sym] = { fetched: n.date + "T" + n.time, t: Date.now(), rows };
        this.save();
        if (this.symbols().includes(sym)) this.fillCurrent();
      }
      if (this.qSym.code() === sym) { if (err) { this.qSum.textContent = `查詢失敗：${err}`; this.tQ.setRows([]); } else this.fillQuery(sym); }
    }
    fillQuery(sym) {
      const App = this.App, rowsD = (this.cache[sym] || {}).rows || [], st = App.store, traded = this.symbols().includes(sym), today = C.today(), rows = [];
      let myTotal = 0;
      rowsD.forEach((r, i) => {
        let shares = traded ? C.sharesBefore(st.transactions, st.dividends, sym, r.ex) : 0;
        if (r.ex > today) shares = (App.holdings[sym] || {}).shares || 0;
        const net = shares && r.cash ? C.dividendPayout(shares, r.cash, st.settings)[3] : 0;
        if (r.ex <= today) myTotal += net;
        rows.push({ id: r.ex + "#" + i, cells: [cell(`${r.year} ${r.period}`.trim(), r.ex, { left: true }), cell(r.ex, r.ex, { left: true }), cell(r.cash ? g(r.cash) : "—", r.cash),
          cell(r.pay || "—", r.pay || "", { left: true }), cell(r.stock ? g(r.stock) : "—", r.stock),
          cell(r.recovery !== null && r.recovery !== undefined ? String(r.recovery) : "—", r.recovery !== null && r.recovery !== undefined ? r.recovery : 99999),
          cell(shares ? money(shares) : "—", shares), cell(net ? money(net) : "—", net, { color: net ? "var(--GAIN)" : null })] });
      });
      this.tQ.setRows(rows);
      const name = App.stockName(sym), yearAgo = C.addDays(today, -365);
      const ttm = rowsD.filter((r) => yearAgo < r.ex && r.ex <= today && r.cash), ttmSum = ttm.reduce((a, r) => a + r.cash, 0);
      const price = (App.store.prices[sym] || {}).price || (App.stockList[sym] || {}).close;
      const yld = price && ttmSum ? `，以現價 ${g(price)} 計殖利率 ${C.fixed(ttmSum / price * 100, 2)}%` : "";
      const up = rowsD.filter((r) => r.ex > today);
      const nxt = up.length ? `　下次除息 ${up[up.length - 1].ex}（每股 ${g(up[up.length - 1].cash)}，${up[up.length - 1].pay || "發放日未公告"}）` : "";
      const mine = traded && myTotal ? `　你歷年共領約 ${money(myTotal)} 元` : "";
      this.qSum.textContent = rowsD.length ? `${sym} ${name}：共 ${rowsD.length} 次配發；近 12 個月現金股利 ${g(ttmSum)} 元（${ttm.length} 次）${yld}${nxt}${mine}` : `${sym} ${name}：查無股利資料`;
    }
  }
  window.App = window.App || {};
  window.App.DividendClassPage = DividendClassPage;
  window.App.ExDividendPage = ExDividendPage;
})();
