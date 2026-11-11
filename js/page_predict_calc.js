/* 漲跌預測、買賣試算（對照電腦版 PredictPage、CalcPage）。 */
(function () {
  "use strict";
  const C = window.Core, M = window.Market, P = window.Predict, U = window.UI, T = window.CONTENT;
  const el = U.el, cell = U.cell, money = C.money, signed = C.signed, f2 = C.f2;
  const g = (x) => String(Number(Number(x).toPrecision(6)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ================= 漲跌預測 =================
  const LEVEL_TEXT = { 較佳: "較佳", 普通: "普通（接近隨機）", 偏低: "偏低（不比隨機好）" };
  class PredictPage {
    constructor() {
      const App = this.App = window.App;
      this.results = {}; this.idxRows = null; this.idxTime = 0; this.running = false;
      this.el = el("div");
      this.sym = new U.SymbolEdit(App, { width: "260px" });
      this.sym.onEnter = () => this.predictInput();
      this.bOne = U.btn("預測此股", () => this.predictInput(), "", T.WIDGET_TIPS["預測此股"]);
      this.bAll = U.btn("預測全部持股", () => this.predictHoldings(), "primary", T.WIDGET_TIPS["預測全部持股"]);
      this.status = el("span", { cls: "hint" });
      this.table = new U.Table(["代號", "名稱", "依據收盤日", "收盤", "下一交易日上漲機率", "再下一交易日上漲機率", "回測準確率（下一日）", "猜多數方向的準確率", "可信度"],
        { onClick: () => this.showDetail(), onKey: () => setTimeout(() => this.showDetail(), 0) });
      this.table.setHeaderTips(T.HEADER_TIPS);
      this.detail = el("div", { cls: "browser", style: { flex: "1 1 50%", minHeight: "120px" } });
      this.table.el.style.flex = "1 1 50%";
      this.el.append(el("div", { cls: "row" }, this.sym.input, this.bOne, this.bAll, this.status), this.table.el, this.detail,
        U.hint("⚠ 以近 5 年日K的技術指標與大盤走勢訓練統計模型，「上漲」指收盤價高於依據日收盤價。短期股價接近隨機漫步，回測準確率通常只有 50% 上下，本預測僅供參考，不構成投資建議。"));
      this.detail.innerHTML = `<p class="muted">按「預測全部持股」或輸入代號後按「預測此股」。</p>`;
    }
    predictInput() { const code = this.sym.code(); if (code) { this.sym.setText(code); this.run([code]); } }
    predictHoldings() {
      const syms = Object.keys(this.App.holdings).filter((s) => this.App.holdings[s].shares > 0).sort();
      if (!syms.length) { this.status.textContent = "目前沒有持股，可以直接輸入代號預測"; return; }
      this.run(syms);
    }
    async run(syms) {
      if (this.running) return;
      this.running = true; this.bOne.disabled = true; this.bAll.disabled = true;
      this.status.textContent = `下載歷史股價與計算中…（共 ${syms.length} 檔）`;
      if (this.idxRows === null || Date.now() - this.idxTime > 1800000) {
        try { this.idxRows = await M.yahooHistory("^TWII"); } catch (_e) { this.idxRows = this.idxRows || []; }
        this.idxTime = Date.now();
      }
      const idxMap = P.indexFeatureMap(this.idxRows);
      for (const s of syms) {
        try {
          const rows = await M.yahooHistory(s, (this.App.stockList[s] || {}).market);
          await sleep(0);
          const res = P.predictSymbol(rows, idxMap);
          res.no_index = !Object.keys(idxMap).length;
          this.onOne(s, res, "");
        } catch (e) { this.onOne(s, null, e.message); }
      }
      this.running = false; this.bOne.disabled = false; this.bAll.disabled = false;
      const errs = Object.values(this.results).filter((r) => r.error).length;
      this.status.textContent = `完成，${C.now().time}` + (errs ? `　${errs} 檔失敗` : "");
      this.App.fillHoldings();
    }
    onOne(sym, res, err) {
      this.results[sym] = res === null ? { error: err } : res;
      this.fill();
      if (Object.keys(this.results).length === 1 || this.table.currentIndex() < 0) this.select(sym);
    }
    select(sym) { this.table.select(sym); this.showDetail(); }
    fill() {
      const App = this.App, rows = [];
      for (const sym of Object.keys(this.results).sort()) {
        const r = this.results[sym], name = App.stockName(sym);
        if (r.error) { rows.push({ id: sym, cells: [cell(sym, sym, { left: true, bold: true }), cell(name, name, { left: true }), cell("失敗：" + r.error, "", { left: true, color: "var(--WARN)" })].concat([...Array(6)].map(() => cell("", ""))) }); continue; }
        const h1 = r.horizons[1], h2 = r.horizons[2];
        rows.push({ id: sym, cells: [cell(sym, sym, { left: true, bold: true }), cell(name, name, { left: true }), cell(r.base_date, r.base_date, { left: true }), cell(f2(r.close), r.close),
          cell(`${C.fixed(h1.p * 100, 1)}%　${C.shortDay(r.targets[0])}`, h1.p, { color: U.probColor(h1.p), bold: true }),
          cell(`${C.fixed(h2.p * 100, 1)}%　${C.shortDay(r.targets[1])}`, h2.p, { color: U.probColor(h2.p), bold: true }),
          cell(C.fixed(h1.acc * 100, 1) + "%", h1.acc), cell(C.fixed(h1.baseline * 100, 1) + "%", h1.baseline), cell(LEVEL_TEXT[h1.level], h1.level, { left: true })] });
      }
      U.tintRows(rows, App.store.prices, 0, [4, 5, 6, 7, 8]);
      this.table.setRows(rows);
    }
    showDetail() {
      const cur = this.table.current();
      if (!cur) return;
      const sym = cur.id, r = this.results[sym];
      if (!r) return;
      const name = this.App.stockName(sym);
      if (r.error) { this.detail.innerHTML = `<h3>${sym} ${U.esc(name)}</h3><p>無法預測：${U.esc(r.error)}</p>`; return; }
      const sg = r.signals, h = [`<h3 style="margin:0">${sym} ${U.esc(name)}</h3>`,
        `<p class="muted">依據 ${r.base_date} 收盤價 ${f2(r.close)}，使用 ${money(r.n_days)} 個交易日資料` + (r.no_index ? "（大盤資料下載失敗，未納入大盤指標）" : "") + "</p>"];
      h.push(`<table cellpadding=6 cellspacing=0 style="border-collapse:collapse"><tr style="background:var(--HEADER);color:var(--MUTED)"><th align=left>預測日</th><th>上漲機率</th><th>回測準確率</th><th>猜多數方向</th><th>歷史上漲比例</th><th>回測天數</th><th align=left>可信度</th></tr>`);
      for (const [hz, lbl] of [[1, "下一交易日"], [2, "再下一交易日"]]) {
        const x = r.horizons[hz], c = U.probColor(x.p);
        h.push(`<tr><td>${lbl} ${C.shortDay(r.targets[hz - 1])}</td><td align=center style="${c ? "color:" + c + ";" : ""}font-weight:bold;font-size:16px">${C.fixed(x.p * 100, 1)}%</td>` +
          `<td align=center>${C.fixed(x.acc * 100, 1)}%</td><td align=center>${C.fixed(x.baseline * 100, 1)}%</td><td align=center>${C.fixed(x.up_rate * 100, 1)}%</td><td align=center>${x.n_test}</td><td>${LEVEL_TEXT[x.level]}</td></tr>`);
      }
      h.push("</table>", `<p class="muted">「回測準確率」是模型在過去沒看過的資料上逐段預測的命中率；若它沒有明顯高於「猜多數方向」，代表這檔股票的短期漲跌幾乎無法從技術面預測，機率會自動往歷史上漲比例靠攏。</p>`);
      h.push(`<b>模型主要依據（下一交易日）</b><ul style="margin-top:2px">`);
      for (const [fname, v] of r.horizons[1].factors) {
        if (Math.abs(v) < 0.005) continue;
        h.push(`<li>${fname}　${v > 0 ? '<span style="color:var(--GAIN)">▲ 偏多</span>' : '<span style="color:var(--LOSS)">▼ 偏空</span>'}（影響 ${C.signed(v, 3)}）</li>`);
      }
      h.push("</ul>");
      const tips = [], price = r.close;
      for (const [n, key] of [["5日線", "ma5"], ["20日線（月線）", "ma20"], ["60日線（季線）", "ma60"]]) {
        const ma = sg[key];
        tips.push(`收盤${price >= ma ? "站上" : "跌破"}${n} ${f2(ma)}（${C.signed((price / ma - 1) * 100, 1)}%）`);
      }
      tips.push(`RSI14 = ${C.fixed(sg.rsi, 0)}` + (sg.rsi >= 70 ? "，過熱區" : sg.rsi <= 30 ? "，超賣區" : ""));
      let kd = `KD = ${C.fixed(sg.K, 0)} / ${C.fixed(sg.D, 0)}`;
      if (sg.K_prev <= sg.D_prev && sg.K > sg.D) kd += "，黃金交叉"; else if (sg.K_prev >= sg.D_prev && sg.K < sg.D) kd += "，死亡交叉";
      tips.push(kd, `成交量為 20 日均量的 ${C.fixed(sg.volr, 2)} 倍` + (sg.volr >= 1.5 ? "，明顯放量" : sg.volr <= 0.6 ? "，量縮" : ""), `近 5 日漲跌 ${C.signed(sg.r5 * 100, 2)}%`);
      h.push(`<b>技術面現況</b><ul style="margin-top:2px">` + tips.map((t) => `<li>${t}</li>`).join("") + "</ul>");
      this.detail.innerHTML = h.join("");
    }
  }

  // ================= 買賣試算 =================
  const TYPES = [["股票（證交稅 0.3%）", false, 0.003], ["ETF（證交稅 0.1%）", true, 0.001], ["債券 ETF（免證交稅）", true, 0.0], ["當沖股票（證交稅 0.15%）", false, 0.0015]];
  const table = (rows) => '<table cellspacing=0 cellpadding=3 width="100%">' + rows.map(([k, v]) => (k ? `<tr><td class="muted">${k}</td><td align=right>${v}</td></tr>` : '<tr><td colspan=2><hr style="border:none;border-top:1px solid var(--BORDER2)"></td></tr>')).join("") + "</table>";
  class CalcPage {
    constructor() {
      const App = this.App = window.App;
      this.el = el("div", { cls: "row", style: { alignItems: "stretch", flexWrap: "wrap", overflow: "auto" } });
      this.el.classList.add("scroll");
      const box = (title) => { const b = el("div", { cls: "group", style: { flex: "1 1 320px", minWidth: "300px" } }, el("span", { cls: "gtitle" }, title)); return b; };
      const form = () => el("div", { cls: "form" });
      const add = (f, k, w) => f.append(el("label", { cls: "k", tip: T.FORM_TIPS[k] }, k), w);
      // 持股賣出試算
      const b0 = box("持股賣出試算（實際拿回多少）"), f0 = form();
      this.sPick = el("select"); this.sPick.addEventListener("change", () => this.onSellPick());
      this.sShares = new U.NumBox({ min: 1, max: 1e9, value: 1000, suffix: " 股" });
      this.sPrice = new U.NumBox({ min: 0.01, max: 100000, decimals: 2, value: 10 });
      add(f0, "持股", this.sPick); add(f0, "賣出股數", this.sShares.input); add(f0, "賣出價", this.sPrice.input);
      f0.append(el("div", { cls: "full row" }, U.btn("全部股數", () => this.sShares.setValue(this.sShares.max)), U.btn("用現價", () => { const p = (App.store.prices[this.sPick.value] || {}).price; if (p) this.sPrice.setValue(p); })));
      this.out0 = el("div", { cls: "full calcResult" }); f0.append(this.out0);
      b0.append(f0);
      [this.sShares, this.sPrice].forEach((w) => w.onChange(() => this.recalcSell()));
      // 買賣損益試算
      const b1 = box("買賣損益試算"), f1 = form();
      this.kind = U.combo(TYPES.map((t, i) => [t[0], i]), () => this.recalc());
      this.buy = new U.NumBox({ min: 0, max: 100000, decimals: 2, value: 100 });
      this.sell = new U.NumBox({ min: 0, max: 100000, decimals: 2, value: 110 });
      this.shares = new U.NumBox({ min: 1, max: 1e9, value: 1000, suffix: " 股" });
      this.target = new U.NumBox({ min: -99, max: 10000, decimals: 1, value: 10, suffix: " %" });
      add(f1, "類型", this.kind); add(f1, "買進價", this.buy.input); add(f1, "賣出價", this.sell.input); add(f1, "股數", this.shares.input); add(f1, "目標報酬率", this.target.input);
      this.out = el("div", { cls: "full calcResult" }); f1.append(this.out);
      b1.append(f1);
      // 加碼攤平
      const b2 = box("加碼攤平試算"), f2_ = form();
      this.pick = el("select"); this.pick.addEventListener("change", () => this.onPick());
      this.hShares = new U.NumBox({ min: 0, max: 1e9, value: 1000, suffix: " 股" });
      this.hAvg = new U.NumBox({ min: 0, max: 100000, decimals: 2, value: 120 });
      this.aShares = new U.NumBox({ min: 0, max: 1e9, value: 1000, suffix: " 股" });
      this.aPrice = new U.NumBox({ min: 0, max: 100000, decimals: 2, value: 100 });
      f2_.append(el("div", { cls: "full" }, this.pick));
      add(f2_, "目前股數", this.hShares.input); add(f2_, "目前均價（含費）", this.hAvg.input); add(f2_, "加碼股數", this.aShares.input); add(f2_, "加碼價格", this.aPrice.input);
      this.out2 = el("div", { cls: "full calcResult" }); f2_.append(this.out2);
      b2.append(f2_);
      [this.buy, this.sell, this.shares, this.target, this.hShares, this.hAvg, this.aShares, this.aPrice].forEach((w) => w.onChange(() => this.recalc()));
      this.el.append(b0, b1, b2);
      this.recalc();
    }
    refreshHoldings() {
      const App = this.App, cur = this.sPick.value;
      this.pick.innerHTML = ""; this.pick.append(el("option", { value: "" }, "（從目前持股帶入）"));
      this.sPick.innerHTML = "";
      for (const sym of Object.keys(App.holdings).sort()) {
        const h = App.holdings[sym];
        if (h.shares <= 0) continue;
        this.pick.append(el("option", { value: sym }, `${sym} ${h.name}`));
        this.sPick.append(el("option", { value: sym }, `${sym} ${h.name}（${money(h.shares)} 股）`));
      }
      const has = cur && [...this.sPick.options].some((o) => o.value === cur);
      if (has) { this.sPick.value = cur; this.sShares.setMax(App.holdings[cur].shares); this.recalcSell(); }
      else { this.sPick.selectedIndex = this.sPick.options.length ? 0 : -1; this.onSellPick(); }
    }
    onSellPick() {
      const sym = this.sPick.value, h = sym ? this.App.holdings[sym] : null;
      if (h && h.shares) {
        this.sShares.setMax(h.shares); this.sShares.set(h.shares, false);
        const p = (this.App.store.prices[sym] || {}).price;
        if (p) this.sPrice.set(p, false);
      }
      this.recalcSell();
    }
    selectSell(sym) { if ([...this.sPick.options].some((o) => o.value === sym)) { this.sPick.value = sym; this.onSellPick(); } }
    pickHolding(sym) { if ([...this.pick.options].some((o) => o.value === sym)) { this.pick.value = sym; this.onPick(); } }
    recalcSell() {
      const App = this.App, sym = this.sPick.value, h = sym ? App.holdings[sym] : null;
      if (!h || !h.shares) { this.out0.innerHTML = '<span class="muted">目前沒有持股可以試算。</span>'; return; }
      const st = App.store, n = Math.min(this.sShares.value(), h.shares), price = this.sPrice.value();
      const r = C.trialSell(st.transactions, st.dividends, sym, n, price, st.settings), est = r.est, s = st.settings;
      const c = r.profit >= 0 ? "var(--GAIN)" : "var(--LOSS)", disc = s.fee_discount, rows = [];
      if (est.orders.length > 1) {
        for (const o of est.orders) rows.push([`${o.shares % 1000 === 0 ? "整股" : "零股"} ${money(o.shares)} 股`, `價金 ${money(o.amount)}・費 ${money(o.fee)}・稅 ${money(o.tax)}`]);
        rows.push(["", ""]);
      }
      const left = r.left_shares ? `${money(r.left_shares)} 股，成本 ${money(r.left_cost)}（均價 ${f2(r.left_cost / r.left_shares)}）` : "0 股（全部出清）";
      rows.push(["成交價金", money(est.amount)], [`賣出手續費（${disc >= 10 ? "不打折" : g(disc) + " 折"}）`, `−${money(est.fee)}`],
        [`證交稅（${g(est.tax_rate * 100)}%）`, `−${money(est.tax)}`], ["實際拿回", `<b>${money(est.net)}</b>`], ["", ""],
        ["這些股的成本（先進先出）", `−${money(r.cost)}`], ["實際賺 / 賠", `<b style="color:${c};font-size:18px">${signed(r.profit)}</b>`],
        ["報酬率", `<b style="color:${c}">${C.signed(r.pct, 2)}%</b>`], ["", ""], ["賣出後剩下", left]);
      this.out0.innerHTML = table(rows) + '<p class="muted">成本含當初買進手續費；先賣最早買的那幾批，和元大一樣。超過 1 張又有零股時，整股與零股分兩筆賣，手續費、證交稅各算各的。持有期間領過的股利不算在內。</p>';
    }
    onPick() {
      const sym = this.pick.value, h = sym ? this.App.holdings[sym] : null;
      if (!h || !h.shares) return;
      this.hShares.setValue(h.shares); this.hAvg.setValue(h.cost / h.shares);
      const p = (this.App.store.prices[sym] || {}).price;
      if (p) this.aPrice.setValue(p);
    }
    recalc() {
      const s = this.App.store.settings, [, etf, rate] = TYPES[+this.kind.value || 0], n = this.shares.value();
      const bAmt = Math.trunc(this.buy.value() * n + 1e-9), sAmt = Math.trunc(this.sell.value() * n + 1e-9);
      const bFee = C.calcFee(bAmt, n, s), sFee = C.calcFee(sAmt, n, s), tax = C.calcTax(sAmt, rate);
      const cost = bAmt + bFee, net = sAmt - sFee - tax, prof = net - cost, pct = cost ? prof / cost * 100 : 0;
      const be = C.priceForReturn(this.buy.value(), n, etf, rate, s, 0), tp = C.priceForReturn(this.buy.value(), n, etf, rate, s, this.target.value());
      const c = prof >= 0 ? "var(--GAIN)" : "var(--LOSS)";
      this.out.innerHTML = table([["買進金額", money(bAmt)], ["買進手續費", money(bFee)], ["買進總成本", `<b>${money(cost)}</b>`], ["", ""], ["賣出金額", money(sAmt)], ["賣出手續費", money(sFee)],
        ["證交稅", money(tax)], ["賣出實收", `<b>${money(net)}</b>`], ["", ""], ["淨損益", `<b style="color:${c}">${signed(prof)}</b>`], ["報酬率", `<b style="color:${c}">${C.signed(pct, 2)}%</b>`],
        ["總交易成本", money(bFee + sFee + tax)], ["", ""], ["損益兩平賣價", be ? `<b>${f2(be)}</b>` : "—"], [`達 ${g(this.target.value())}% 賣價`, tp ? `<b>${f2(tp)}</b>` : "—"]]);
      const hs = this.hShares.value(), ha = this.hAvg.value(), as = this.aShares.value(), ap = this.aPrice.value();
      const addAmt = as * ap, addFee = as ? C.calcFee(addAmt, as, s) : 0, totSh = hs + as, totCost = hs * ha + addAmt + addFee, newAvg = totSh ? totCost / totSh : 0;
      let be2 = null;
      if (totSh) {
        let p = Math.max(0.01, newAvg);
        for (let i = 0; i < 200000; i++) {
          const amt = p * totSh;
          if (amt - C.calcFee(amt, totSh, s) - C.calcTax(amt, rate) >= totCost) { be2 = p; break; }
          p = C.pyRound(p + C.tickSize(p, etf), 2);
        }
      }
      this.out2.innerHTML = table([["加碼金額（含費）", money(addAmt + addFee)], ["加碼後股數", `${money(totSh)} 股`], ["加碼後總成本", money(totCost)], ["加碼後均價", `<b>${f2(newAvg)}</b>`],
        ["均價下降", `${f2(ha - newAvg)}（${C.fixed(ha ? (ha - newAvg) / ha * 100 : 0, 2)}%）`], ["損益兩平賣價", be2 ? `<b>${f2(be2)}</b>` : "—"]]);
    }
  }
  window.App = window.App || {};
  window.App.PredictPage = PredictPage;
  window.App.CalcPage = CalcPage;
})();
