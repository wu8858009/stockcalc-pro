/* 主程式：登入、版面（側邊導覽、頁面標題、摘要卡片、狀態列），目前持股／交易紀錄／交割款／已實現損益／股利紀錄，
   新增交易／股利視窗、右鍵選單、快捷鍵、報價自動更新。對照電腦版 MainWindow。 */
(function () {
  "use strict";
  const C = window.Core, M = window.Market, P = window.Predict, U = window.UI, T = window.CONTENT;
  const el = U.el, cell = U.cell, money = C.money, signed = C.signed, f2 = C.f2;
  const APP_NAME = T.APP_NAME, EDITION = T.EDITION;

  const NAV_SVG = {
    pie: '<circle cx="12" cy="12" r="9"/><path d="M12 12V3M12 12l8 4"/>',
    star: '<path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7z"/>',
    fire: '<path d="M12 3c6 6 7 10 5.5 14-1.5 4-9.5 4-11 0C5 13 8 11 9 8c1 3 2 3 3-5z"/>',
    chart: '<path d="M3 18l6-7 4 3 8-9M3 21h18"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9c-2-2-6-1-5.5 1.5.5 2 5.5 1 5.3 3.5-.3 2.5-4.8 2.5-5.8 1"/>',
    grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    search: '<circle cx="9.5" cy="9.5" r="6.5"/><path d="M14 14l7 7"/>', dot: '<circle cx="12" cy="12" r="2.5"/>',
    spark: '<path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/>',
    calc: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><rect x="8" y="5.5" width="8" height="4"/><path d="M9 13h.01M15 13h.01M9 17.5h.01M15 17.5h.01"/>',
    bolt: '<path d="M13 2L5 13h6l-1 9 9-12h-6z"/>',
    gear: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.5c0-3 5.7-3 5.5.1-.2 2.2-2.8 2.2-2.8 4.6M12 17.3h.01"/>',
  };
  const NAV_ICONS = { 目前持股: "pie", 自選觀察: "star", 熱門股票: "fire", 走勢圖: "chart", 交易紀錄: "list", 交割款: "calendar", 已實現損益: "check",
    股利紀錄: "coin", 配息分類: "grid", 除息查詢: "search", 漲跌預測: "spark", 買賣試算: "calc", 連線下單: "bolt", 設定: "gear", 使用說明: "help" };

  // ================= App =================
  const App = window.App = Object.assign(window.App || {}, {      // 各頁面的類別先掛在 window.App 上
    store: null, stockList: {}, holdings: {}, realized: [], errors: [], pages: [], navItems: [],
    fetching: false, heldMemo: {},
  });
  App.stockName = function (code) {
    if (App.stockList[code]) return App.stockList[code].name;
    if (App.holdings[code]) return App.holdings[code].name;
    return (App.store.prices[code] || {}).name || "";
  };
  App.status = U.status;

  // ---------- 版面 ----------
  function buildLayout() {
    const root = document.getElementById("app");
    App.nav = el("div", { id: "nav" });
    const side = el("div", { id: "sidebar" },
      el("div", { cls: "brandBox" }, el("img", { src: "icons/icon-64.png", alt: "" }),
        el("div", null, el("div", { cls: "brand" }, APP_NAME), el("span", { cls: "proBadge" }, EDITION))),
      App.nav, el("div", { cls: "sideVer" }, "v" + T.VERSION + "（網頁版）"));
    App.pageTitle = el("span", { id: "pageTitle" }, "目前持股");
    App.pageSub = el("span", { id: "pageSub" });
    App.lblTime = el("span", { cls: "hint" });
    App.bRef = U.btn("更新股價", () => App.fetchQuotes(), "", "立即抓最新股價（快捷鍵：F5）");
    const menuBtn = U.btn("☰", () => side.classList.toggle("open"));
    menuBtn.id = "menuBtn";
    const top = el("div", { id: "topbar" }, menuBtn, App.pageTitle, App.pageSub, el("span", { cls: "spacer" }), App.lblTime, App.bRef,
      App.bDiv = U.btn("＋ 新增股利", () => App.addDiv(), "", T.WIDGET_TIPS["＋ 新增股利"] + "\n快捷鍵：Ctrl+D"),
      App.bTx = U.btn("＋ 新增交易", () => App.addTx(), "primary", T.WIDGET_TIPS["＋ 新增交易"] + "\n快捷鍵：Ctrl+N"));
    // 手機：上方按鈕改短字，一行放得下
    const shortBtns = () => { const ph = U.isPhone(); App.bDiv.textContent = ph ? "＋股利" : "＋ 新增股利"; App.bTx.textContent = ph ? "＋交易" : "＋ 新增交易";
      if (!App.bRef.disabled) App.bRef.textContent = ph ? "更新" : "更新股價"; };
    U.onDevice.push(shortBtns); shortBtns();
    App.cards = {};
    const cards = el("div", { id: "cards" });
    for (const [k, t] of [["cost", "持股總成本"], ["mv", "目前市值"], ["un", "未實現損益"], ["sell", "現在賣出實賺"], ["day", "今日損益"],
      ["re", "已實現損益"], ["div", "累計現金股利"], ["all", "總損益（含息）"], ["set", "待交割款"]]) {
      const c = new U.Card(t);
      c.el.dataset.tip = T.CARD_TIPS[t.split("（")[0]] || "";
      App.cards[k] = c; cards.append(c.el);
    }
    App.pagesBox = el("div", { id: "pages" });
    App.syncLbl = el("span", { cls: "sync" });
    const sb = el("div", { id: "statusbar" }, el("span", { id: "statusMsg" }), App.syncLbl, el("span", { cls: "edition" }, `◆ ${EDITION}　v${T.VERSION}`));
    const main = el("div", { id: "main" }, top, cards, App.pagesBox, sb);
    const shade = el("div", { id: "navShade", onclick: () => side.classList.remove("open") });   // 手機：點選單外面關閉
    root.append(side, shade, main);
    document.body.append(el("div", { id: "tip", cls: "hidden" }), el("div", { id: "toasts" }));
  }
  App.addPage = function (title, page, sub) {
    page.el.classList.add("page");
    App.pagesBox.append(page.el);
    const icon = sub ? "dot" : NAV_ICONS[title] || "dot";
    const item = el("div", { cls: "navItem" + (sub ? " sub" : ""), html: `<svg viewBox="0 0 24 24">${NAV_SVG[icon]}</svg><span>${U.esc(title)}</span>` });
    const key = (T.PAGE_KEYS.find((x) => x[1] === title) || [])[0];
    item.dataset.tip = (T.NAV_TIPS[title] || "") + (key ? "\n快捷鍵：" + key : "");
    const entry = { title, page, sub, item };
    item.addEventListener("click", () => { App.showPage(entry); document.getElementById("sidebar").classList.remove("open"); });
    App.nav.append(item);
    App.navItems.push(entry);
    if (!sub) App.pages.push(entry);
    return entry;
  };
  App.showPage = function (entry) {
    App.navItems.forEach((x) => x.item.classList.toggle("on", x === entry));
    App.pages.forEach((x) => x.page.el.classList.toggle("on", x.page === entry.page));
    App.current = entry;
    if (entry.sub) { const main = App.navItems.find((x) => x.page === entry.page && !x.sub); App.pageTitle.textContent = main.title; App.pageSub.textContent = "›  " + entry.title; }
    else { App.pageTitle.textContent = entry.title; App.pageSub.textContent = ""; }
    if (entry.sub && entry.page.selectSub) entry.page.selectSub(entry.sub.index);
    else if (!entry.sub && entry.page.selectSub && entry.page.currentSub) {
      const s = App.navItems.find((x) => x.page === entry.page && x.sub && x.sub.index === entry.page.currentSub());
      if (s) { App.navItems.forEach((x) => x.item.classList.toggle("on", x === s)); App.pageTitle.textContent = entry.title; App.pageSub.textContent = "›  " + s.title; }
    }
    document.body.dataset.home = entry.page === HoldPage ? "1" : "0";   // 手機只在「目前持股」顯示統計卡片
    if (entry.page.onShow) entry.page.onShow();
  };
  App.syncSub = function (page) {               // 子頁被程式切換時，左側選取跟著移動
    if (!App.current || App.current.page !== page) return;
    const s = App.navItems.find((x) => x.page === page && x.sub && x.sub.index === page.currentSub());
    if (s) { App.navItems.forEach((x) => x.item.classList.toggle("on", x === s)); App.pageSub.textContent = "›  " + s.title; App.current = s; }
  };
  App.goPage = function (title) { const e = App.navItems.find((x) => x.title === title); if (e) App.showPage(e); };
  App.stepPage = function (d) { const i = App.navItems.indexOf(App.current); App.showPage(App.navItems[(i + d + App.navItems.length) % App.navItems.length]); };
  App.isPage = (page) => App.current && App.current.page === page;

  // ================= 目前持股 =================
  const HoldPage = {
    el: el("div"),
    init() {
      const s = App.store.settings;
      this.seg = U.seg(["含息", "不含息"], (i) => App.setPlMode(i === 0));
      this.seg.buttons[0].dataset.tip = "含息：成本扣掉目前持股在持有期間、最近 6 個月內除息的配息總額，損益與報酬率包含配息（和元大 App「含息」相同）\n快捷鍵：Ctrl+I";
      this.seg.buttons[1].dataset.tip = "不含息：損益、報酬率只看股價差，不算配息\n快捷鍵：Ctrl+I";
      this.chkClosed = U.check("顯示已出清股票", s.show_closed, (on) => { App.store.settings.show_closed = on; App.store.save(); App.fillHoldings(); }, T.WIDGET_TIPS["顯示已出清股票"]);
      this.lblErr = el("span", { style: { color: "var(--GAIN)" } });
      const top = el("div", { cls: "row" }, this.seg, el("span", { style: { width: "12px" } }), this.chkClosed, this.lblErr, el("span", { cls: "grow" }), el("span", { cls: "menuHint" }, U.menuHint() + "可快速買進／賣出／記股利"));
      const sort = s.sort_hold || [5, 0];
      this.table = new U.Table(["代號", "名稱", "股數", "平均成本", "總成本", "現價", "漲跌", "市值", "未實現損益", "報酬率", "現在賣出實賺",
        "已實現損益", "現金股利", "含息總損益", "佔比", "下一交易日上漲機率", "配息"],
        { flashCol: 5, sortCol: sort[0], sortAsc: sort[1] === 0, onSort: (c, asc) => { App.store.settings.sort_hold = [c, asc ? 0 : 1]; App.store.save(); },
          onDbl: (r) => App.showTxOf(r.cells[0].text), onMenu: (r, x, y) => App.holdMenu(r && r.cells[0].text, x, y),
          onKey: (e, r) => { if (e.key === "Enter" && r) App.showTxOf(r.cells[0].text); } });
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.el.append(top, this.table.el);
      App.updateHoldHeaders();
    },
  };
  App.updateHoldHeaders = function () {
    const tag = App.store.settings.pl_with_div !== false ? "（含息）" : "";
    [[3, "成本均價"], [4, "持有成本"], [8, "損益"], [9, "報酬率"], [10, "現在賣出實賺"]].forEach(([c, n]) => { HoldPage.table.headers[c] = n + tag; });
    HoldPage.table.renderHead();
    HoldPage.seg.setOn(tag ? 0 : 1);
  };
  App.setPlMode = function (withDiv) {
    App.store.settings.pl_with_div = withDiv;
    App.store.save(); App.updateHoldHeaders(); App.fillHoldings();
  };
  App.heldDiv = function (sym) {
    if (!(sym in App.heldMemo)) {
      const rows = ((App.exdiv && App.exdiv.cache[sym]) || {}).rows || [];
      App.heldMemo[sym] = C.heldPeriodDividends(App.store.transactions, App.store.dividends, sym, rows, App.store.settings);
    }
    return App.heldMemo[sym];
  };
  App.clearHeldDiv = () => { App.heldMemo = {}; };
  App.holdingValues = (sym, h) => C.holdingValues(sym, h, App.store.prices[sym], App.store.settings, App.heldDiv(sym));
  App.priceCell = function (sym, price) {
    const q = App.store.prices[sym] || {}, src = q.src || "live", est = ["ref", "bid", "close"].includes(src);
    let when = q.trade_time || q.time || "";
    if (when.length > 9 && /^\d{8}/.test(when)) when = `${when.slice(4, 6)}/${when.slice(6, 8)} ${when.slice(9)}`;
    return cell(price ? f2(price) : "—", price || 1e12, { color: est ? "var(--MUTED)" : null, bold: !est, tip: `${T.PRICE_SOURCES[src] || ""}　${when}`.trim() });
  };
  App.predCell = function (sym) {
    const r = App.predict && App.predict.results[sym];
    if (!r || r.error) return cell("—", -1.0);
    const p = r.horizons[1].p;
    return cell(C.fixed(p * 100, 1) + "%", p, { color: U.probColor(p) });
  };
  App.divCell = function (sym) {
    const c = App.divclass && App.divclass.info[sym];
    if (!c) return cell("—", 99, { left: true });
    return cell(C.divLabel(c), C.FREQ_ORDER.includes(c.freq) ? C.FREQ_ORDER.indexOf(c.freq) : 99,
      { left: true, color: c.freq === "月配" ? "var(--ACCENT_TEXT)" : null, tip: `近12月每股配息 ${gfmt(c.ttm)} 元（${c.ttm_count} 次），最近除息 ${c.last_date}` });
  };
  const gfmt = (x) => String(Number(x.toPrecision(6)));       // Python :g
  App.gfmt = gfmt;
  App.fillHoldings = function () {
    const s = App.store.settings, showClosed = s.show_closed, withDiv = s.pl_with_div !== false;
    const rows = [], vals = {};
    let tCost = 0, tMv = 0, tUn = 0, tDay = 0, tRe = 0, tDiv = 0, missing = 0, tRaw = 0, tHd = 0, tSell = 0, tSellNet = 0;
    for (const sym of Object.keys(App.holdings)) {
      const h = App.holdings[sym], hv = vals[sym] = App.holdingValues(sym, h);
      tRe += h.realized; tDiv += h.div_cash; tRaw += hv.raw_unreal || 0; tHd += hv.held_div || 0;
      if (h.shares > 0) {
        tCost += hv.base_cost !== undefined ? hv.base_cost : h.cost;
        if (hv.mv !== null) { tMv += hv.mv; tUn += hv.exact_unreal; tSell += hv.sell_profit; tSellNet += hv.sell.net; tDay += hv.day || 0; }
        else missing++;
      }
    }
    const na = () => cell("—", -1e18);
    for (const sym of Object.keys(App.holdings).sort()) {
      const h = App.holdings[sym];
      if (h.shares <= 0 && !showClosed) continue;
      const hv = vals[sym];
      const base = h.shares ? (hv.base_cost !== undefined ? hv.base_cost : h.cost) : 0, avg = h.shares ? base / h.shares : 0;
      const price = hv.price, prev = hv.prev, chg = price && prev ? price - prev : null;
      const total = (hv.raw_unreal || 0) + h.realized + h.div_cash;
      const hd = hv.held_div || 0;
      const costTip = withDiv && hd ? `含息：付出成本 ${money(h.cost)} − 配息總額 ${money(hd)} ＝ 持有成本 ${money(h.cost - hd)}\n不含息成本均價 ${f2(h.cost / h.shares)}`
        : `付出成本（含買進手續費） ${money(h.cost)}`;
      rows.push({ id: sym, cells: [
        cell(sym, sym, { left: true, bold: true }), cell(h.name, h.name, { left: true }), cell(money(h.shares), h.shares),
        cell(h.shares ? f2(avg) : "—", avg, { tip: costTip }), cell(money(base), base, { tip: costTip }),
        App.priceCell(sym, price),
        chg !== null ? cell(`${C.signed(chg, 2)} (${C.signed(chg / prev * 100, 2)}%)`, chg / prev, { color: U.pnl(chg) }) : na(),
        hv.mv !== null ? cell(money(hv.mv), hv.mv) : na(),
        hv.unreal !== null ? cell(signed(hv.unreal), hv.unreal, { color: U.pnl(hv.unreal), bold: true,
          tip: withDiv ? `不含息損益 ${signed(hv.raw_unreal)} ＋ 配息總額 ${signed(hd)}（${hv.held_div_n || 0} 次）＝ 含息損益 ${signed(hv.unreal)}` : `不含息。持有期間另已領股利 ${signed(hd)}` }) : na(),
        hv.pct !== null ? cell(C.signed(hv.pct, 2) + "%", hv.pct, { color: U.pnl(hv.pct) }) : na(),
        hv.sell ? sellCell(sym, h, hv) : na(),
        cell(signed(h.realized), h.realized, { color: U.pnl(h.realized) }), cell(money(h.div_cash), h.div_cash),
        cell(signed(total), total, { color: U.pnl(total), bold: true }),
        hv.mv && tMv ? cell(C.fixed(hv.mv / tMv * 100, 1) + "%", hv.mv / tMv) : na(),
        App.predCell(sym), App.divCell(sym)] });
    }
    U.tintRows(rows, App.store.prices, 0, [10, 15, 16]);
    HoldPage.table.setRows(rows);
    const cd = App.cards, mode = withDiv ? "含息" : "不含息";
    cd.cost.title(withDiv ? "持有成本（含息）" : "持股總成本");
    cd.cost.set(money(tCost), null, `${Object.values(App.holdings).filter((h) => h.shares > 0).length} 檔持股`);
    cd.mv.set(tMv ? money(tMv) : "—", null, missing ? `${missing} 檔無報價` : "");
    cd.un.title(`未實現損益（${mode}）`);
    const tExact = tUn, tUnR = C.pyRound(tUn);
    cd.un.set(signed(tUnR), U.pnl(tUnR), tCost ? C.signed(tExact / tCost * 100, 2) + "%" : "");
    cd.sell.title(`現在賣出實賺（${mode}）`);
    cd.sell.set(signed(tSell), U.pnl(tSell), tSellNet ? `實拿 ${money(tSellNet)} 元` : "");
    cd.day.set(signed(tDay), U.pnl(tDay));
    cd.re.set(signed(tRe), U.pnl(tRe));
    cd.div.set(money(tDiv));
    const all = tRaw + tRe + (tDiv ? tDiv : tHd);
    cd.all.set(signed(all), U.pnl(all), tDiv ? "股利依股利紀錄" : (tHd ? `含自動估算股利 ${money(tHd)}` : ""));
    HoldPage.lblErr.textContent = App.errors.length ? "⚠ " + App.errors.slice(0, 3).map((e) => e.msg).join("；") : "";
    document.title = tCost ? `${signed(tUnR)}（${C.signed(tExact / tCost * 100, 2)}%）· ${APP_NAME}` : `${APP_NAME} ${EDITION}`;
  };
  function sellCell(sym, h, hv) {
    const s = App.store.settings, sell = hv.sell, withDiv = s.pl_with_div !== false, val = hv.sell_profit, disc = s.fee_discount;
    const lines = [`如果現在以 ${f2(hv.price)} 把 ${money(h.shares)} 股全部賣掉：`];
    if (sell.orders.length > 1) lines.push("（整股和零股分兩筆賣出，手續費、證交稅各算各的）");
    for (const o of sell.orders) lines.push(`　${o.shares % 1000 === 0 ? "整股" : "零股"} ${money(o.shares)} 股：價金 ${money(o.amount)}　手續費 −${money(o.fee)}　證交稅 −${money(o.tax)}`);
    lines.push(`成交價金 ${money(sell.amount)}`,
      `− 手續費 ${money(sell.fee)}（${disc >= 10 ? "不打折" : gfmt(disc) + " 折"}，整股最低 ${gfmt(s.min_fee)} 元、零股最低 ${gfmt(s.min_fee_odd)} 元）`,
      `− 證交稅 ${money(sell.tax)}（${gfmt(sell.tax_rate * 100)}%）`, `＝ 實際拿回 ${money(sell.net)}`,
      `− 當初付出成本 ${money(h.cost)}（含買進手續費）`, `＝ 股價差實賺 ${signed(sell.net - h.cost)}`);
    const hd = hv.held_div || 0;
    if (withDiv) lines.push(`＋ 配息總額 ${money(hd)} ＝ 含息實賺 ${signed(val)}`);
    else if (hd) lines.push(`（另外持有期間已領配息 ${money(hd)}，切到「含息」會加進來）`);
    lines.push("和「損益」欄不同：損益欄照元大 App 用不打折手續費估算；這欄用你設定的手續費折扣，是真的賣掉會拿到的錢。");
    return cell(signed(val), val, { color: U.pnl(val), bold: true, tip: lines.join("\n") });
  }
  App.holdMenu = function (sym, x, y) {
    const items = [];
    if (sym) {
      const h = App.holdings[sym];
      items.push([`買進 ${sym} ${h.name}`, () => App.addTx({ type: "buy", symbol: sym, name: h.name })]);
      if (h.shares > 0) items.push([`賣出 ${sym}（全部 ${money(h.shares)} 股）`, () => App.addTx({ type: "sell", symbol: sym, name: h.name, shares: h.shares })]);
      items.push(["記錄股利", () => App.addDiv(sym)]);
      items.push([`連線下單：賣出 ${sym}`, () => App.orderOf(sym, "S", h.shares)], [`連線下單：買進 ${sym}`, () => App.orderOf(sym, "B")]);
      const w = App.watch.find(sym);
      const tgt = w && (w.buy_target || w.sell_target) ? `（買 ${w.buy_target || "—"}／賣 ${w.sell_target || "—"}）` : "";
      items.push([`設定目標價（到價提醒）${tgt}`, () => App.watch.editSymbol(sym, h.name)]);
      items.push(["走勢圖", () => App.showChart(sym)], ["基本資料", () => App.showInfo(sym)], null, ["查看交易紀錄", () => App.showTxOf(sym)]);
      if (h.shares > 0) items.push(["試算賣出（實際拿回多少）", () => App.sellCalcOf(sym)]);
      items.push(["試算加碼攤平", () => App.calcOf(sym)]);
    } else items.push(["新增交易", () => App.addTx()]);
    U.menu(items, x, y);
  };

  // ================= 交易紀錄 =================
  const TxPage = {
    el: el("div"),
    init() {
      this.filter = el("input", { placeholder: "篩選代號／名稱", style: { maxWidth: "220px" }, oninput: () => App.fillTx() });
      this.lbl = el("span", { cls: "hint" });
      this.table = new U.Table(["日期", "交割日", "類型", "代號", "名稱", "股數", "成交價", "成交金額", "手續費", "證交稅", "淨收付", "備註"],
        { onDbl: () => App.editTx(), onKey: (e) => { if (e.key === "Enter") App.editTx(); if (e.key === "Delete") App.delTx(); } });
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.el.append(el("div", { cls: "row" }, this.filter, U.btn("編輯", () => App.editTx(), "", T.WIDGET_TIPS["編輯"] + "\n快捷鍵：Enter"),
        U.btn("刪除", () => App.delTx(), "danger", T.WIDGET_TIPS["刪除"] + "\n快捷鍵：Delete"), U.btn("匯出 CSV", () => App.exportTx(), "", T.WIDGET_TIPS["匯出 CSV"]), this.lbl), this.table.el);
    },
  };
  App.fillTx = function () {
    const kw = TxPage.filter.value.trim().toLowerCase();
    const txs = App.store.transactions.map((t, i) => [t, i]).sort((a, b) => {
      const ka = [a[0].date, a[0].type === "sell" ? 1 : 0], kb = [b[0].date, b[0].type === "sell" ? 1 : 0];
      return ka[0] < kb[0] ? 1 : ka[0] > kb[0] ? -1 : kb[1] - ka[1] || b[1] - a[1];
    }).map((x) => x[0]);
    const rows = [], today = C.today();
    let nBuy = 0, nSell = 0;
    for (const t of txs) {
      if (kw && !t.symbol.toLowerCase().includes(kw) && !(t.name || "").toLowerCase().includes(kw)) continue;
      const amt = C.tradeAmount(t), sell = t.type === "sell", net = sell ? amt - t.fee - t.tax : -(amt + t.fee);
      if (sell) nSell += net; else nBuy += -net;
      const sd = C.CALENDAR.settlementDate(t.date), pending = sd >= today;
      rows.push({ id: t.id, cells: [cell(t.date, t.date, { left: true }), cell(C.shortDay(sd) + (pending ? "　待交割" : ""), sd, { left: true, color: pending ? "var(--ACCENT_TEXT)" : null }),
        cell(sell ? "賣出" : "買進", t.type, { left: true, bold: true, color: sell ? "var(--LOSS)" : "var(--GAIN)" }),
        cell(t.symbol, t.symbol, { left: true }), cell(t.name || "", t.name || "", { left: true }),
        cell(money(t.shares), t.shares), cell(f2(t.price), t.price), cell(money(amt), amt), cell(money(t.fee), t.fee), cell(money(t.tax), t.tax),
        cell(signed(net), net, { color: U.pnl(net) }), cell(t.note || "", t.note || "", { left: true })] });
    }
    TxPage.table.setRows(rows);
    TxPage.lbl.textContent = `共 ${rows.length} 筆　買進付出 ${money(nBuy)}　賣出收回 ${money(nSell)}`;
  };
  App.showTxOf = function (sym) { TxPage.filter.value = sym; App.fillTx(); App.goPage("交易紀錄"); };
  App.editTx = async function () {
    const r = TxPage.table.current(); if (!r) return;
    const tx = App.store.transactions.find((t) => t.id === r.id); if (!tx) return;
    const rec = await new TxDialog({ tx }).exec();
    if (rec) { const i = App.store.transactions.indexOf(tx); App.store.transactions[i] = rec; App.afterChange(rec.symbol); }
  };
  App.delTx = async function () {
    const r = TxPage.table.current(); if (!r) return;
    const tx = App.store.transactions.find((t) => t.id === r.id); if (!tx) return;
    const txt = `${tx.date} ${tx.type === "sell" ? "賣出" : "買進"} ${tx.symbol} ${tx.name || ""} ${money(tx.shares)} 股 @ ${f2(tx.price)}`;
    if (!await U.ask(`確定刪除這筆交易？\n\n${txt}`)) return;
    const rest = App.store.transactions.filter((t) => t.id !== tx.id);
    const errs = C.computePortfolio(rest, App.store.dividends).errors;
    if (errs.length && !await U.ask("刪除後會造成賣出股數不足：\n" + errs.slice(0, 5).map((e) => e.msg).join("\n") + "\n\n仍要刪除？")) return;
    App.store.transactions = rest; App.afterChange();
  };
  App.exportTx = function () {
    const lines = [["日期", "交割日", "類型", "代號", "名稱", "股數", "成交價", "成交金額", "手續費", "證交稅", "淨收付", "備註"]];
    App.store.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((t) => {
      const amt = C.tradeAmount(t), sell = t.type === "sell";
      lines.push([t.date, C.CALENDAR.settlementDate(t.date), sell ? "賣出" : "買進", t.symbol, t.name || "", t.shares, t.price, C.pyRound(amt), t.fee, t.tax,
        C.pyRound(sell ? amt - t.fee - t.tax : -(amt + t.fee)), t.note || ""]);
    });
    const csv = lines.map((r) => r.map((x) => { const s = String(x); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\r\n");
    const a = el("a", { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: `交易紀錄_${C.today().replace(/-/g, "")}.csv` });
    a.click(); U.status("已匯出交易紀錄 CSV", 5000);
  };

  // ================= 交割款 =================
  const SettlePage = {
    el: el("div"),
    init() {
      this.chkAll = U.check("顯示已完成的交割", false, () => App.fillSettle(), T.WIDGET_TIPS["顯示已完成的交割"]);
      this.lbl = el("span", { cls: "hint" });
      this.table = new U.Table(["交割日", "狀態", "成交日", "筆數", "買進應付", "賣出應收", "淨額", "明細"], { sortable: false });
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.el.append(el("div", { cls: "row" }, this.chkAll, this.lbl), this.table.el,
        U.hint("台股為 T+2 交割：成交後第 2 個營業日交割。買進須在交割日上午 10:00 前把款項存入交割帳戶，賣出款項於交割日入帳。休市日依證交所公告自動排除。"));
    },
  };
  App.fillSettle = function () {
    const today = C.today(), groups = {};
    App.store.transactions.forEach((t) => { (groups[C.CALENDAR.settlementDate(t.date)] = groups[C.CALENDAR.settlementDate(t.date)] || []).push(t); });
    const showAll = SettlePage.chkAll.input.checked, rows = [];
    let pendPay = 0, pendGet = 0, nextDay = null;
    for (const sd of Object.keys(groups).sort()) {
      const txs = groups[sd];
      const pay = txs.filter((t) => t.type === "buy").reduce((a, t) => a + C.tradeAmount(t) + t.fee, 0);
      const get = txs.filter((t) => t.type === "sell").reduce((a, t) => a + C.tradeAmount(t) - t.fee - t.tax, 0);
      const net = get - pay;
      if (sd >= today) { pendPay += pay; pendGet += get; if (nextDay === null || sd < nextDay) nextDay = sd; }
      else if (!showAll) continue;
      const [status, color] = sd === today ? ["今天交割", "var(--WARN)"] : sd > today ? ["待交割", "var(--ACCENT_TEXT)"] : ["已交割", "var(--MUTED)"];
      const days = [...new Set(txs.map((t) => t.date))].sort();
      const detail = txs.slice().sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
        .map((t) => `${t.type === "sell" ? "賣" : "買"} ${t.symbol} ${t.name || ""} ${money(t.shares)}股`).join("、");
      rows.push([sd, { id: sd, cells: [cell(C.shortDay(sd), sd, { left: true, bold: sd >= today }), cell(status, status, { color, left: true, bold: true }),
        cell(days.map((d) => d.slice(5)).join("、"), days[0], { left: true }), cell(String(txs.length), txs.length),
        cell(pay ? money(pay) : "—", pay), cell(get ? money(get) : "—", get), cell(signed(net), net, { color: U.pnl(net), bold: true }), cell(detail, detail, { left: true })] }]);
    }
    const pending = rows.filter((r) => r[0] >= today), done = rows.filter((r) => r[0] < today).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    SettlePage.table.setRows(pending.concat(done).map((r) => r[1]));
    const net = pendGet - pendPay;
    if (nextDay) {
      const ndNet = groups[nextDay].reduce((a, t) => a + (t.type === "sell" ? C.tradeAmount(t) - t.fee - t.tax : -(C.tradeAmount(t) + t.fee)), 0);
      App.cards.set.set(`${net >= 0 ? "應收" : "應付"} ${money(Math.abs(net))}`, net >= 0 ? "var(--GAIN)" : "var(--WARN)",
        `最近 ${C.shortDay(nextDay)} ${ndNet >= 0 ? "應收" : "應付"} ${money(Math.abs(ndNet))}`);
      SettlePage.lbl.textContent = `　待交割：買進應付 ${money(pendPay)}　賣出應收 ${money(pendGet)}　淨額 ${signed(net)}`;
    } else { App.cards.set.set("0", null, "沒有待交割"); SettlePage.lbl.textContent = "　目前沒有待交割的款項"; }
  };

  // ================= 已實現損益 =================
  const RealPage = {
    el: el("div"),
    init() {
      this.year = U.combo([["全部", ""]], () => App.fillRealized());
      this.lbl = el("span", { cls: "hint" });
      this.table = new U.Table(["賣出日", "代號", "名稱", "股數", "賣出價", "平均成本", "成本", "實收", "損益", "報酬率"]);
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.el.append(el("div", { cls: "row" }, el("span", null, "年度"), this.year, this.lbl), this.table.el);
    },
  };
  App.fillYears = function () {
    const cur = RealPage.year.value;
    const years = [...new Set(App.realized.map((r) => r.date.slice(0, 4)))].sort().reverse();
    RealPage.year.innerHTML = "";
    RealPage.year.append(el("option", { value: "" }, "全部"));
    years.forEach((y) => RealPage.year.append(el("option", { value: y }, y)));
    RealPage.year.value = years.includes(cur) ? cur : "";
    App.fillRealized();
  };
  App.fillRealized = function () {
    const y = RealPage.year.value || "", rows = [];
    let tot = 0, win = 0, cnt = 0;
    App.realized.map((r, i) => [r, i]).sort((a, b) => (a[0].date < b[0].date ? 1 : a[0].date > b[0].date ? -1 : b[1] - a[1])).forEach(([r], i) => {
      if (y && !r.date.startsWith(y)) return;
      tot += r.profit; cnt++; if (r.profit > 0) win++;
      rows.push({ id: r.id + "#" + i, cells: [cell(r.date, r.date, { left: true }), cell(r.symbol, r.symbol, { left: true }), cell(r.name, r.name, { left: true }),
        cell(money(r.shares), r.shares), cell(f2(r.price), r.price), cell(f2(r.avg), r.avg), cell(money(r.cost), r.cost), cell(money(r.proceeds), r.proceeds),
        cell(signed(r.profit), r.profit, { color: U.pnl(r.profit), bold: true }), cell(C.signed(r.pct, 2) + "%", r.pct, { color: U.pnl(r.pct) })] });
    });
    RealPage.table.setRows(rows);
    const divs = App.store.dividends.filter((d) => !y || d.date.startsWith(y)).reduce((a, d) => a + (d.cash || 0), 0);
    RealPage.lbl.innerHTML = `　${cnt} 筆賣出　勝率 ${C.fixed(cnt ? win / cnt * 100 : 0, 0)}%　已實現 <span style="color:${tot >= 0 ? "var(--GAIN)" : "var(--LOSS)"}"><b>${signed(tot)}</b></span>　同期現金股利 ${money(divs)}`;
  };

  // ================= 股利紀錄 =================
  const DivPage = {
    el: el("div"),
    init() {
      this.lbl = el("span", { cls: "hint" });
      this.table = new U.Table(["發放日", "代號", "名稱", "現金股利", "股票股利(股)", "備註"],
        { onDbl: () => App.editDiv(), onKey: (e) => { if (e.key === "Enter") App.editDiv(); if (e.key === "Delete") App.delDiv(); } });
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.el.append(el("div", { cls: "row" }, U.btn("＋ 新增", () => App.addDiv()), U.btn("編輯", () => App.editDiv(), "", "快捷鍵：Enter"),
        U.btn("刪除", () => App.delDiv(), "danger", "快捷鍵：Delete"), this.lbl), this.table.el);
    },
  };
  App.fillDiv = function () {
    let tot = 0;
    const rows = App.store.dividends.map((d, i) => [d, i]).sort((a, b) => (a[0].date < b[0].date ? 1 : a[0].date > b[0].date ? -1 : b[1] - a[1])).map(([d]) => {
      tot += d.cash || 0;
      return { id: d.id, cells: [cell(d.date, d.date, { left: true }), cell(d.symbol, d.symbol, { left: true }), cell(d.name || "", d.name || "", { left: true }),
        cell(money(d.cash || 0), d.cash || 0), cell(money(d.stock_shares || 0), d.stock_shares || 0), cell(d.note || "", d.note || "", { left: true })] };
    });
    DivPage.table.setRows(rows);
    DivPage.lbl.textContent = `共 ${rows.length} 筆　現金股利合計 ${money(tot)} 元`;
  };
  App.editDiv = async function () {
    const r = DivPage.table.current(); if (!r) return;
    const rec = App.store.dividends.find((d) => d.id === r.id); if (!rec) return;
    const out = await new DivDialog({ rec }).exec();
    if (out) { App.store.dividends[App.store.dividends.indexOf(rec)] = out; App.afterChange(); }
  };
  App.delDiv = async function () {
    const r = DivPage.table.current(); if (!r) return;
    const rec = App.store.dividends.find((d) => d.id === r.id); if (!rec) return;
    if (!await U.ask(`確定刪除 ${rec.date} ${rec.symbol} 的股利紀錄？`)) return;
    App.store.dividends = App.store.dividends.filter((d) => d !== rec); App.afterChange();
  };

  // ================= 新增交易／股利視窗 =================
  const newId = () => ([...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""));
  App.newId = newId;
  class EntryDialog extends U.Dialog {
    setupButtons(editing, onAdd) {
      this.onAdd = onAdd; this.added = [];
      this.addedLbl = el("div", { cls: "addedList hidden" });
      this.form.append(el("div", { cls: "full" }, this.addedLbl),
        el("div", { cls: "full hint" }, "Enter 跳下一欄 · 在備註欄按 Enter 或任何欄位按 Ctrl+Enter 即存檔" + (editing ? "" : "並繼續下一筆")));
      if (!editing) this.foot.append(el("button", { cls: "primary", tip: "存好這筆後清空股票欄位，接著輸入下一筆（Ctrl+Enter）", onclick: () => this.onSave(true) }, "儲存並繼續新增"));
      this.foot.append(el("button", { cls: editing ? "primary" : "", onclick: () => this.onSave(false) }, editing ? "儲存" : "儲存並關閉"));
      this.cancelBtn = el("button", { onclick: () => this.reject() }, "取消");
      this.foot.append(this.cancelBtn);
      this.box.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.onSave(!editing); return; }
        const t = e.target;
        if (t === this.note) { e.preventDefault(); setTimeout(() => this.onSave(this.onAdd !== null), 0); return; }
        if (t.tagName === "INPUT" || t.tagName === "SELECT") {
          e.preventDefault();
          const f = [...this.form.querySelectorAll("input:not([type=checkbox]):not([disabled]):not([data-skip]), select")];
          const i = f.indexOf(t); if (i >= 0 && f[i + 1]) f[i + 1].focus();
        }
      });
    }
    commit(rec, desc, keep) {
      if (this.onAdd === null) { this.accept(rec); return; }
      this.onAdd(rec); this.added.push(desc);
      if (!keep) { this.accept(rec); return; }
      const lines = this.added.slice(-5), more = this.added.length - lines.length;
      this.addedLbl.innerHTML = U.esc(`✓ 本次已新增 ${this.added.length} 筆` + (more ? `（只顯示最後 5 筆，前面還有 ${more} 筆）` : "")) + "<br>" + lines.map(U.esc).join("<br>");
      this.addedLbl.classList.remove("hidden");
      this.cancelBtn.textContent = "完成";
      this.resetForNext(); this.sym.input.focus();
    }
  }
  const dateInput = (v) => el("input", { type: "date", value: v || C.today() });
  class TxDialog extends EntryDialog {
    constructor(o) {
      const tx = o.tx || null, preset = o.preset || null;
      super(tx ? "編輯交易" : "新增交易", { width: "460px" });
      this.tx = tx;
      const s = App.store.settings;
      this.type = U.combo(["買進", "賣出"]); this.date = dateInput();
      this.sym = new U.SymbolEdit(App); this.name = el("input", { "data-skip": "1" });
      this.shares = new U.NumBox({ min: 1, max: 1e9, value: 1000, suffix: " 股" });
      const lots = el("div", { cls: "row" }, this.shares.input, U.btn("1張", () => this.shares.setValue(1000)), U.btn("+100", () => this.shares.setValue(this.shares.value() + 100)));
      this.price = new U.NumBox({ min: 0, max: 100000, decimals: 2 });
      this.auto = U.check("自動計算手續費與證交稅", true, () => this.recalc());
      this.fee = new U.NumBox({ min: 0, max: 1e8 }); this.tax = new U.NumBox({ min: 0, max: 1e8 });
      this.note = el("input");
      this.summary = el("div", { cls: "calcResult" });
      this.form = el("div", { cls: "form" });
      const add = (k, w) => { this.form.append(el("label", { cls: "k", tip: T.FORM_TIPS[k] }, k), w); };
      add("類型", this.type); add("日期", this.date); add("股票", this.sym.input); add("名稱", this.name); add("股數", lots); add("成交價", this.price.input);
      this.form.append(el("span"), this.auto); add("手續費", this.fee.input); add("證交稅", this.tax.input); add("備註", this.note);
      this.form.append(el("div", { cls: "full" }, this.summary));
      this.body.append(this.form);
      this.setupButtons(!!tx, tx ? null : (o.onAdd || null));
      const src = tx || preset || {};
      if (Object.keys(src).length) {
        this.type.selectedIndex = src.type === "sell" ? 1 : 0;
        if (src.date) this.date.value = src.date;
        if (src.symbol) this.sym.setText(src.symbol);
        this.name.value = src.name || "";
        if (src.shares) this.shares.setValue(src.shares);
        if (src.price) this.price.setValue(src.price);
        if (src.note && !tx) this.note.value = src.note;
      }
      if (tx) {
        this.note.value = tx.note || ""; this.fee.setValue(tx.fee); this.tax.setValue(tx.tax);
        const af = C.calcFee(C.tradeAmount(tx), tx.shares, s), at = tx.type === "sell" ? C.calcTax(C.tradeAmount(tx), C.sellTaxRate(tx.symbol, tx.date)) : 0;
        this.auto.input.checked = af === tx.fee && at === tx.tax;
      } else if (src.symbol && !src.price) { const p = (App.store.prices[src.symbol] || {}).price; if (p) this.price.setValue(p); }
      [this.shares, this.price, this.fee, this.tax].forEach((w) => w.onChange(() => this.recalc()));
      this.type.addEventListener("change", () => this.recalc());
      this.date.addEventListener("change", () => { this.recalc(); App.ensureHolidays([+this.date.value.slice(0, 4)]); });
      this.sym.onPick = () => this.onSymbol(); this.sym.onBlur = () => this.onSymbol();
      this.onSymbol(); this.recalc();
      App.openTxDialogs.add(this); this.onClose = () => App.openTxDialogs.delete(this);
    }
    onSymbol() {
      const code = this.sym.code();
      if (!code) return;
      if (this.sym.text() !== code) this.sym.setText(code);
      const name = App.stockName(code);
      if (name && (!this.name.value || this.name.value === this._autoName)) { this.name.value = name; this._autoName = name; }
      if (this.price.value() === 0) { const p = (App.store.prices[code] || {}).price || (App.stockList[code] || {}).close; if (p) this.price.setValue(p); }
      this.recalc();
    }
    dateStr() { return this.date.value || C.today(); }
    heldBefore() {
      const code = this.sym.code(); if (!code) return null;
      const d = this.dateStr();
      const txs = App.store.transactions.filter((t) => t.symbol === code && t.date <= d && (!this.tx || t.id !== this.tx.id));
      const divs = App.store.dividends.filter((x) => x.symbol === code && x.date <= d);
      return (C.computePortfolio(txs, divs).holdings[code] || {}).shares || 0;
    }
    recalc() {
      const sell = this.type.selectedIndex === 1, amt = Math.trunc(this.shares.value() * this.price.value() + 1e-9), auto = this.auto.input.checked;
      this.fee.setEnabled(!auto); this.tax.setEnabled(!auto && sell);
      if (auto) { this.fee.set(C.calcFee(amt, this.shares.value(), App.store.settings), false); this.tax.set(sell ? C.calcTax(amt, C.sellTaxRate(this.sym.code(), this.dateStr())) : 0, false); }
      if (!sell && this.tax.value()) this.tax.set(0, false);
      let txt;
      if (sell) {
        const net = amt - this.fee.value() - this.tax.value();
        txt = `成交金額 ${money(amt)}　→　實收 <b>${money(net)}</b> 元`;
        const held = this.heldBefore();
        if (held !== null) {
          txt += `<br>此日期前持有 ${money(held)} 股`;
          const h = App.holdings[this.sym.code()];
          if (h && h.shares && !this.tx) { const prof = net - h.cost / h.shares * this.shares.value(); txt += `　預估損益 <span style="color:${prof >= 0 ? "var(--GAIN)" : "var(--LOSS)"}">${signed(prof)}</span>`; }
        }
      } else txt = `成交金額 ${money(amt)}　→　應付 <b>${money(amt + this.fee.value())}</b> 元`;
      const d = this.dateStr(), sd = C.CALENDAR.settlementDate(d);
      txt += `<br>交割日 <b style="color:var(--ACCENT_TEXT)">${sd}（${C.WEEKDAYS[C.weekday(sd)]}）</b>　T+2　` + (sell ? "款項當天入帳" : "請於當天上午 10:00 前把款項存入交割帳戶");
      if (!C.CALENDAR.isTradingDay(d)) txt += `<br><span style="color:var(--WARN)">⚠ ${d} 不是交易日（週末或休市）</span>`;
      else if (!C.CALENDAR.known(d)) txt += `<br><span class="muted">（${d.slice(0, 4)} 年休市表下載中，暫時只排除週末）</span>`;
      this.summary.innerHTML = txt;
    }
    resetForNext() { this.sym.setText(""); this.name.value = ""; this.note.value = ""; this._autoName = null; this.price.setValue(0); this.recalc(); }
    async onSave(keep) {
      this.price.commit(); this.shares.commit(); this.fee.commit(); this.tax.commit();
      const code = this.sym.code();
      if (!code) { await U.warn("請輸入股票代號"); return; }
      if (this.price.value() <= 0) { await U.warn("請輸入成交價"); return; }
      const sell = this.type.selectedIndex === 1;
      const rec = { id: this.tx ? this.tx.id : newId(), date: this.dateStr(), symbol: code, name: this.name.value.trim() || App.stockName(code) || code,
        type: sell ? "sell" : "buy", shares: this.shares.value(), price: C.pyRound(this.price.value(), 4), fee: this.fee.value(), tax: sell ? this.tax.value() : 0, note: this.note.value.trim() };
      const txs = App.store.transactions.filter((t) => !this.tx || t.id !== this.tx.id).concat([rec]);
      const errs = C.computePortfolio(txs, App.store.dividends).errors.filter((e) => e.symbol === code).map((e) => e.msg);
      if (errs.length) { await U.warn("股數不足，無法儲存：\n" + errs.join("\n")); return; }
      this.commit(rec, `${rec.date}　${sell ? "賣出" : "買進"}　${code} ${rec.name}　${money(rec.shares)} 股 @ ${f2(rec.price)}`, keep);
    }
  }
  App.TxDialog = TxDialog;
  App.openTxDialogs = new Set();
  class DivDialog extends EntryDialog {
    constructor(o) {
      const rec = o.rec || null;
      super(rec ? "編輯股利" : "新增股利", { width: "440px" });
      this.rec = rec;
      this.date = dateInput(); this.sym = new U.SymbolEdit(App); this.name = el("input", { "data-skip": "1" });
      this.cash = new U.NumBox({ min: 0, max: 1e9, suffix: " 元" }); this.stock = new U.NumBox({ min: 0, max: 1e8, suffix: " 股" });
      this.note = el("input");
      this.form = el("div", { cls: "form" });
      const add = (k, w) => this.form.append(el("label", { cls: "k", tip: T.FORM_TIPS[k] }, k), w);
      add("發放日", this.date); add("股票", this.sym.input); add("名稱", this.name); add("現金股利", this.cash.input); add("股票股利", this.stock.input); add("備註", this.note);
      this.form.append(el("div", { cls: "full hint", style: { whiteSpace: "pre-line" } }, "現金股利請填「實際入帳金額」（已扣匯費、補充保費）。\n股票股利（配股）會增加股數，不增加成本。"));
      this.body.append(this.form);
      this.setupButtons(!!rec, rec ? null : (o.onAdd || null));
      if (rec) { this.date.value = rec.date; this.sym.setText(rec.symbol); this.name.value = rec.name || ""; this.cash.setValue(rec.cash || 0); this.stock.setValue(rec.stock_shares || 0); this.note.value = rec.note || ""; }
      else if (o.symbol) this.sym.setText(o.symbol);
      if (o.preset && !rec) { if (o.preset.date) this.date.value = o.preset.date; this.cash.setValue(o.preset.cash || 0); this.note.value = o.preset.note || ""; }
      this.sym.onPick = () => this.onSymbol(); this.sym.onBlur = () => this.onSymbol();
      this.onSymbol();
    }
    onSymbol() { const code = this.sym.code(); if (code && this.sym.text() !== code) this.sym.setText(code); if (code && !this.name.value) this.name.value = App.stockName(code) || ""; }
    resetForNext() { this.sym.setText(""); this.name.value = ""; this.note.value = ""; this.cash.setValue(0); this.stock.setValue(0); }
    async onSave(keep) {
      this.cash.commit(); this.stock.commit();
      const code = this.sym.code();
      if (!code) { await U.warn("請輸入股票代號"); return; }
      if (this.cash.value() === 0 && this.stock.value() === 0) { await U.warn("請輸入現金股利或股票股利"); return; }
      const rec = { id: this.rec ? this.rec.id : newId(), date: this.date.value || C.today(), symbol: code, name: this.name.value.trim() || App.stockName(code) || code,
        cash: this.cash.value(), stock_shares: this.stock.value(), note: this.note.value.trim() };
      const parts = (rec.cash ? [`現金 ${money(rec.cash)} 元`] : []).concat(rec.stock_shares ? [`配股 ${money(rec.stock_shares)} 股`] : []);
      this.commit(rec, `${rec.date}　${code} ${rec.name}　` + parts.join("、"), keep);
    }
  }
  App.DivDialog = DivDialog;
  App.addTx = (preset) => new TxDialog({ preset, onAdd: (rec) => { App.store.transactions.push(rec); App.afterChange(rec.symbol); } }).exec();
  App.addDiv = (symbol, preset) => new DivDialog({ symbol, preset, onAdd: (rec) => { App.store.dividends.push(rec); App.afterChange(); } }).exec();

  // ================= 重算／報價 =================
  App.refreshAll = function () {
    App.clearHeldDiv();
    const r = C.computePortfolio(App.store.transactions, App.store.dividends);
    App.holdings = r.holdings; App.realized = r.realized; App.errors = r.errors;
    App.fillHoldings(); App.fillTx(); App.fillYears(); App.fillDiv(); App.fillSettle();
    if (App.calc) App.calc.refreshHoldings();
    if (App.divclass) App.divclass.fill();
    if (App.watch) App.watch.fill();
    if (App.chart) App.chart.refreshPick();
    if (App.hot && App.hot.rows.length) App.hot.fill();
    if (App.exdiv) { App.exdiv.fillCurrent(); App.exdiv.fillAnn(); }
    if (App.order) App.order.fillTriggers();
  };
  App.afterChange = function (newSymbol) {
    App.store.save(); App.refreshAll(); App.ensureHolidays();
    if (newSymbol && !App.store.prices[newSymbol]) App.fetchQuotes(true);
  };
  App.recolorPages = function () {
    for (const fn of [() => App.divclass.fill(), () => App.exdiv.fillCurrent(), () => App.exdiv.fillAnn(), () => App.predict.fill()]) { try { fn(); } catch (_e) { /* 略過 */ } }
  };
  App.applyTimer = function () {
    clearInterval(App.timer);
    const s = App.store.settings;
    if (s.auto_refresh) App.timer = setInterval(App.autoTick, Math.max(5, +s.refresh_sec || 30) * 1000);
  };
  App.autoTick = function () {
    if (App.store.settings.only_trading_hours) {
      const n = C.now();
      if (n.weekday >= 5 || !(C.hm(8, 59) <= n.minutes && n.minutes <= C.hm(13, 36))) return;
    }
    App.fetchQuotes(true);
  };
  App.quoteSymbols = function () {
    const syms = Object.keys(App.holdings).filter((s) => App.holdings[s].shares > 0);
    App.store.watchlist.forEach((w) => { if (!syms.includes(w.symbol)) syms.push(w.symbol); });
    App.store.triggers.forEach((t) => { if (t.status === "waiting" && !syms.includes(t.symbol)) syms.push(t.symbol); });
    return syms;
  };
  App.fetchQuotes = async function (silent) {
    const syms = App.quoteSymbols();
    if (!syms.length || App.fetching) { if (!syms.length && !silent) U.status("目前沒有持股也沒有觀察的股票，不需要更新股價", 3000); return; }
    App.fetching = true; App.bRef.disabled = true; App.bRef.textContent = "更新中…";
    let quotes = {}, err = "";
    try { quotes = await M.fetchQuotes(syms, App.stockList, JSON.parse(JSON.stringify(App.store.prices))); } catch (e) { err = e.message; }
    App.fetching = false; App.bRef.disabled = false; App.bRef.textContent = U.isPhone() ? "更新" : "更新股價";
    if (Object.keys(quotes).length) {
      const now = C.now().time;
      Object.keys(quotes).forEach((k) => { quotes[k].fetched = now; App.store.prices[k] = quotes[k]; });
      App.lblTime.textContent = `股價更新於 ${C.today()} ${now}`;
      UI.ls.set("sc_prices", App.store.prices);
      App.fillHoldings(); App.watch.fill(); App.recolorPages();
      if (App.isPage(App.hot)) App.hot.load();
      if (App.isPage(App.chart) && App.chart.symbol) App.chart.load(60);
      App.order.checkTriggerView();
    }
    if (err) U.status(Object.keys(quotes).length ? err : `股價更新失敗：${err}`, 10000);
  };
  App.ensureHolidays = async function (extra) {
    if (App._holidayBusy) return;
    const years = new Set(App.store.transactions.map((t) => +t.date.slice(0, 4)).concat(extra || []));
    const todo = C.CALENDAR.missingYears([...years]);
    if (!todo.length) return;
    App._holidayBusy = true;
    const errs = [];
    let got = 0;
    for (const y of todo) {
      try { const [cl, so] = await M.fetchHolidays(y); C.CALENDAR.merge(y, cl, so); got++; } catch (e) { errs.push(`${y}：${e.message}`); }
    }
    App._holidayBusy = false;
    if (got) { UI.ls.set("sc_holidays", C.CALENDAR.dump()); App.refreshAll(); App.openTxDialogs.forEach((d) => d.recalc()); }
    if (errs.length) U.status(`休市表下載失敗（交割日暫時只排除週末）：${errs.join("；")}`, 8000);
  };
  App.loadStockList = async function () {
    const c = UI.ls.get("sc_stocklist", null);
    if (c && c.list) App.stockList = c.list;
    if (!c || c.date !== C.today() || !Object.keys(App.stockList).length) {
      U.status("下載上市櫃股票清單中…");
      try { App.stockList = await M.fetchStockList(); UI.ls.set("sc_stocklist", { date: C.today(), list: App.stockList }); U.status(`股票清單已更新：${money(Object.keys(App.stockList).length)} 檔`, 4000); }
      catch (e) { U.status(`股票清單下載失敗：${e.message}`, 8000); }
    }
  };
  App.startupFetch = async function () {
    App.divclass.refreshData();
    setTimeout(() => App.exdiv.refresh(), 4000);
    setTimeout(() => App.exdiv.loadAnn(), 6000);
    setTimeout(() => M.loadBasicLists(U.idb).catch(() => null), 9000);
    App.ensureHolidays();
    await App.loadStockList();
    App.fetchQuotes(); App.predict.predictHoldings();
  };

  // ================= 跳頁、選取中的股票、快捷鍵 =================
  App.showChart = (sym) => { App.chart.refreshPick(); App.chart.showSymbol(sym); };
  App.showInfo = (sym) => { if (sym) App.StockInfo.showFor(sym); };
  App.orderOf = (sym, side, shares) => { App.order.prefill(sym, side, shares); App.goPage("連線下單"); };
  App.sellCalcOf = (sym) => { App.calc.selectSell(sym); App.goPage("買賣試算"); };
  App.calcOf = (sym) => { App.calc.pickHolding(sym); App.goPage("買賣試算"); };
  App.currentSymbols = function () {
    const p = App.current && App.current.page;
    const pick = (t, col) => t.selected().map((r) => r.cells[col] && r.cells[col].text).filter(Boolean);
    if (p === HoldPage) return pick(HoldPage.table, 0);
    if (p === App.watch) return pick(App.watch.table, 0);
    if (p === App.hot) return pick(App.hot.table, 1);
    if (p === App.chart) return App.chart.symbol ? [App.chart.symbol] : [];
    if (p === TxPage) return pick(TxPage.table, 3);
    if (p === RealPage) return pick(RealPage.table, 1);
    if (p === DivPage) return pick(DivPage.table, 1);
    if (p === App.divclass) return pick(App.divclass.table, 0);
    if (p === App.predict) return pick(App.predict.table, 0);
    if (p === App.exdiv) { const i = App.exdiv.currentSub(); return i === 0 ? pick(App.exdiv.tCur, 0) : i === 1 ? pick(App.exdiv.tAnn, 2) : (App.exdiv.qSym.code() ? [App.exdiv.qSym.code()] : []); }
    return [];
  };
  function setupShortcuts() {
    const actions = {
      "ctrl+tab": () => App.stepPage(1), "ctrl+shift+tab": () => App.stepPage(-1),
      "ctrl+n": () => { const s = App.currentSymbols(); App.addTx(s.length ? { type: "buy", symbol: s[0], name: App.stockName(s[0]) } : null); },
      "ctrl+d": () => { const s = App.currentSymbols(); App.addDiv(s[0] || null); },
      "f5": () => { App.fetchQuotes(); if (App.isPage(App.hot)) App.hot.load(true); else if (App.isPage(App.chart)) App.chart.load(0); U.status("更新中…", 2000); },
      "ctrl+f": () => {
        const p = App.current.page;
        let box = p === App.watch ? App.watch.sym.input : p === App.chart ? App.chart.sym.input : p === TxPage ? TxPage.filter : p === App.predict ? App.predict.sym.input : null;
        if (p === App.exdiv) box = { 1: App.exdiv.annKw, 2: App.exdiv.qSym.input }[App.exdiv.currentSub()] || null;
        if (!box) { App.goPage("走勢圖"); box = App.chart.sym.input; }
        box.focus(); box.select && box.select();
      },
      "ctrl+w": async () => {
        const p = App.current.page;
        if (p === App.watch) { App.watch.sym.input.focus(); return; }
        if (p === App.hot) { App.hot.addSelected(); return; }
        const s = App.currentSymbols();
        if (!s.length) { U.status("先選一檔股票再按 Ctrl+W", 4000); return; }
        const added = [];
        for (const x of s) if (await App.watch.add(x, null, true)) added.push(x);
        U.status(added.length ? "已加入自選觀察：" + added.join("、") : "都已經在自選觀察裡", 5000);
      },
      "ctrl+g": () => { const s = App.currentSymbols(); if (s.length) App.showChart(s[0]); else App.goPage("走勢圖"); },
      "ctrl+b": () => { const s = App.currentSymbols(); if (s.length) App.showInfo(s[0]); else U.status("先選一檔股票再按 Ctrl+B", 4000); },
      "ctrl+i": () => App.setPlMode(App.store.settings.pl_with_div === false),
      "ctrl+s": () => { if (App.isPage(App.settingsPage)) App.settingsPage.save(); else U.status("資料都會自動存檔；Ctrl+S 用在「設定」頁儲存設定", 4000); },
      "ctrl+/": () => { App.goPage("使用說明"); App.help.go("keys"); },
    };
    T.PAGE_KEYS.forEach(([k, t]) => { actions[k.toLowerCase()] = () => App.goPage(t); });
    document.addEventListener("keydown", (e) => {
      if (U.dialogs.length && e.key !== "F1") return;
      const k = (e.ctrlKey || e.metaKey ? "ctrl+" : "") + (e.shiftKey && e.key === "Tab" ? "shift+" : "") + e.key.toLowerCase();
      const fn = actions[k];
      if (fn) { e.preventDefault(); fn(); }
    });
  }
  App.shortcutGroups = function () {
    return [
      ["切換頁面", T.PAGE_KEYS.map(([k, t]) => [k, `切到「${t}」`]).concat([["Ctrl+Tab", "下一頁"], ["Ctrl+Shift+Tab", "上一頁"]])],
      ["常用功能", [["Ctrl+N", "新增交易（有選股票時會自動帶入）"], ["Ctrl+D", "新增股利（有選股票時會自動帶入）"], ["F5", "更新股價，並重新整理目前這一頁"],
        ["Ctrl+F", "跳到這一頁的搜尋／輸入框"], ["Ctrl+W", "把選取的股票加入自選觀察（可多選）"], ["Ctrl+G", "開啟選取股票的走勢圖"],
        ["Ctrl+B", "開啟選取股票的基本資料（公司、ETF、評價、營收、股利）"], ["Ctrl+I", "切換「含息／不含息」"], ["Ctrl+S", "在「設定」頁時儲存設定"], ["Ctrl+/", "顯示快捷鍵一覽"]]],
      ["表格裡", [["Enter", "開啟／編輯選取的那一列（持股→交易紀錄、觀察→設定目標價、熱門→加入觀察、本期可領→記錄股利）"], ["Delete", "刪除選取的那一列（交易紀錄、股利紀錄、自選觀察）"],
        ["Insert", "熱門股票：把選取的股票加入觀察"], ["Ctrl+C", "複製選取的列（含表頭，可直接貼到 Excel）"], ["Ctrl＋點選／Shift＋點選", "多選（熱門股票可一次加入多檔）"]]],
      ["走勢圖（先點一下圖）", [["← / →", "十字線往前／往後一天"], ["PageUp / PageDown", "一次移動 10 天"], ["Home / End", "跳到第一天／最後一天"], ["Esc", "取消十字線"],
        ["1 ~ 8", "切換區間：分時、5日、1月、3月、6月、1年、3年、5年"], ["K / L", "K 線／走勢線"], ["P", "開／關預測訊號"], ["B", "開／關參考買賣點"], ["I", "開啟詳細說明視窗"]]],
      ["新增交易／股利視窗", [["Enter", "跳到下一欄"], ["備註欄按 Enter", "存檔（新增時會繼續下一筆）"], ["Ctrl+Enter", "存檔並繼續新增下一筆"], ["Esc", "關閉視窗"]]],
    ];
  };

  // ================= 通知（瀏覽器通知＋畫面右下角）=================
  App.notify = function (title, body, sym, page) {
    const go = () => { window.focus(); if (page) App.goPage(page); else if (sym) { App.goPage("自選觀察"); App.watch.select(sym); } };
    U.toast(title, body, go);
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      try { const n = new Notification(title, { body, icon: "icons/icon-192.png", tag: title }); n.onclick = () => { go(); n.close(); }; } catch (_e) { /* 有些瀏覽器只能在 Service Worker 通知 */ }
    }
    return true;
  };

  // ================= 啟動、登入 =================
  async function boot() {
    App.store = new Store(window.CONFIG.CLOUD_URL);
    const st = App.store;
    M.setFetcher((urls) => st.fetchUrls(urls));
    C.CALENDAR.load(UI.ls.get("sc_holidays", null));
    st.onStatus = (t) => { App.syncLbl.textContent = "☁ " + t; };
    st.onAuthLost = () => showLogin("登入已過期，請重新輸入密碼");
    st.onRemote = () => { App.refreshAll(); U.status("已從其他裝置同步最新資料", 3000); };
    const spMsg = (t) => { if (window.splashMsg) window.splashMsg(t); };
    spMsg("連線雲端…");
    if (!st.token) { const rem = st.remembered(); if (rem) { try { await st.loginKey(rem.k); } catch (_e) { /* 改手動 */ } } }
    if (!st.token) return showLogin();
    spMsg("同步資料…");
    try { await st.load(); } catch (e) {
      if (e.message === "auth") return;
      if (!st.loadCache()) return showLogin("連不上雲端：" + e.message);
      U.status("離線：顯示上次同步的資料", 8000);
    }
    spMsg("建立畫面…");
    start();
  }
  function showLogin(msg) {
    const st = App.store;
    document.getElementById("login") && document.getElementById("login").remove();
    const pw = el("input", { type: "password", placeholder: "密碼", autocomplete: "current-password" });
    const pw2 = el("input", { type: "password", placeholder: "再輸入一次密碼", cls: "hidden" });
    const rem = U.check("記住密碼（這台裝置自動登入）", true);
    const err = el("div", { cls: "err" }, msg || "");
    const go = el("button", { cls: "primary", style: { width: "100%", marginTop: "8px" } }, "登入");
    const box = el("div", { id: "login" }, el("div", { cls: "box" },
      el("img", { src: "icons/icon-64.png", style: { width: "48px" } }), el("h1", null, APP_NAME), el("span", { cls: "proBadge" }, EDITION + "　網頁版"),
      el("p", { cls: "hint" }, "資料存在你的 Google 試算表，電腦版、手機、網頁同步。"), pw, pw2, rem, go, err));
    document.body.append(box);
    if (window.hideSplash) window.hideSplash();
    let setup = false, salt = "";
    st.status().then((s) => { salt = s.salt; setup = s.needsSetup; if (setup) { pw2.classList.remove("hidden"); go.textContent = "設定密碼並開始使用"; err.textContent = "第一次使用：請設定一組密碼（至少 6 個字）"; } })
      .catch((e) => { err.textContent = "連不上雲端：" + e.message; });
    const submit = async () => {
      err.textContent = ""; go.disabled = true;
      try {
        if (setup) {
          if (pw.value.length < 6) throw new Error("密碼至少 6 個字");
          if (pw.value !== pw2.value) throw new Error("兩次輸入的密碼不一樣");
          const r = await st.setup(pw.value, salt);
          if (r.error) throw new Error(r.error);
        } else {
          const key = await st.keyFor(pw.value, salt);
          const r = await st.loginKey(key);
          if (r.error) throw new Error(r.error === "wrong_password" ? "密碼錯誤" : r.error === "locked" ? "錯誤太多次，請 10 分鐘後再試" : r.error);
          if (rem.input.checked) st.remember(key); else st.forget();
        }
        await st.load();
        box.remove();
        if (!App.started) start(); else App.refreshAll();
      } catch (e) { err.textContent = e.message; } finally { go.disabled = false; }
    };
    go.addEventListener("click", submit);
    [pw, pw2].forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }));
    pw.focus();
  }
  function start() {
    App.started = true;
    buildLayout();
    [HoldPage, TxPage, SettlePage, RealPage, DivPage].forEach((p) => p.init());
    App.holdPage = HoldPage; App.txPage = TxPage;
    App.addPage("目前持股", HoldPage);
    App.watch = new App.WatchPage(); App.addPage("自選觀察", App.watch);
    App.hot = new App.HotPage(); App.addPage("熱門股票", App.hot);
    App.chart = new App.ChartPage(); App.addPage("走勢圖", App.chart);
    App.addPage("交易紀錄", TxPage); App.addPage("交割款", SettlePage); App.addPage("已實現損益", RealPage); App.addPage("股利紀錄", DivPage);
    App.divclass = new App.DividendClassPage(); App.addPage("配息分類", App.divclass);
    App.exdiv = new App.ExDividendPage(); App.addPage("除息查詢", App.exdiv);
    ["本期可領", "除權息預告", "個股股利查詢"].forEach((t, i) => App.addPage(t, App.exdiv, { index: i }));
    App.predict = new App.PredictPage(); App.addPage("漲跌預測", App.predict);
    App.calc = new App.CalcPage(); App.addPage("買賣試算", App.calc);
    App.order = new App.OrderPage(); App.addPage("連線下單", App.order);
    App.settingsPage = new App.SettingsPage(); App.addPage("設定", App.settingsPage);
    App.help = new App.HelpPage(); App.addPage("使用說明", App.help);
    App.goPage("目前持股");
    setupShortcuts();
    App.applyTimer();
    App.refreshAll();
    App.lblTime.textContent = "";
    setTimeout(App.startupFetch, 300);
    if (window.hideSplash) window.hideSplash();
    if ("Notification" in window && Notification.permission === "default") {
      document.addEventListener("click", function once() { Notification.requestPermission(); document.removeEventListener("click", once); });
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && App.store.queue) App.store.flush(); });
  }
  window.addEventListener("load", boot);
})();
