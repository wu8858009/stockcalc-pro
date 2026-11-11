/* 個股基本資料視窗（對照電腦版 StockInfoDialog）、使用說明頁（HelpPage）。 */
(function () {
  "use strict";
  const C = window.Core, M = window.Market, U = window.UI, T = window.CONTENT;
  const el = U.el, esc = U.esc;
  const g6 = (x) => String(Number(Number(x).toPrecision(6)));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
  const fnumSigned = (v) => { const x = parseFloat(String(v === null || v === undefined ? "" : v).replace(/,/g, "").trim()); return isNaN(x) ? null : x; };

  // ================= 基本資料 =================
  const opened = {};
  class StockInfo {
    static showFor(sym) {
      sym = sym.trim().toUpperCase();
      let d = opened[sym];
      if (!d || !d.dlg.visible) d = opened[sym] = new StockInfo(sym);
      d.dlg.show();
      return d;
    }
    constructor(sym) {
      const App = this.App = window.App;
      this.sym = sym; this.data = null;
      const d = this.dlg = new U.Dialog(`${sym} ${App.stockName(sym)} 基本資料`, { modal: false, width: "min(820px, 96vw)" });
      d.onClose = () => { if (opened[sym] === this) delete opened[sym]; };
      this.view = el("div", { cls: "browser info", style: { height: "min(760px, 74vh)", overflow: "auto" } });
      d.body.append(this.view);
      d.foot.append(U.btn("走勢圖", () => App.showChart(sym)),
        U.btn("加入自選觀察", () => this.addWatch()),
        U.btn("股利查詢", () => { App.goPage("除息查詢"); App.exdiv.query(sym); }),
        U.btn("重新整理", () => this.load()), el("span", { cls: "grow" }), U.btn("關閉", () => d.reject()));
      this.load();
    }
    async addWatch() {
      const ok = await this.App.watch.add(this.sym, null, true);
      U.status(ok ? `已加入自選觀察：${this.sym}` : `${this.sym} 已經在自選觀察裡`, 5000);
    }
    async load() {
      this.view.innerHTML = `<p style='color:${css("MUTED")}'>正在載入 ${esc(this.sym)} 的基本資料…</p>`;
      let data = null, err = "";
      try { data = await M.fetchBasicInfo(this.sym, (this.App.stockList[this.sym] || {}).market, U.idb); } catch (e) { err = e.message; }
      if (!this.dlg.visible) return;
      if (!data) { this.view.innerHTML = `<p style='color:${css("GAIN")}'>載入失敗：${esc(err)}</p>`; return; }
      this.data = data;
      this.view.innerHTML = this.render(data);
    }
    static rowsHtml(pairs, cols) {
      cols = cols || 2;
      const MUTED = css("MUTED");
      pairs = pairs.filter(([, v]) => !(v === null || v === undefined || v === "" || v === "—"));
      if (!pairs.length) return `<p style='color:${MUTED}'>沒有資料</p>`;
      let h = "<table width='100%' cellspacing=0 cellpadding=4>";
      for (let i = 0; i < pairs.length; i += cols) {
        h += "<tr>";
        for (const [k, v] of pairs.slice(i, i + cols)) h += `<td width='${Math.floor(40 / cols)}%' style='color:${MUTED}'>${k}</td><td width='${Math.floor(60 / cols)}%'>${v}</td>`;
        h += "</tr>";
      }
      return h + "</table>";
    }
    render(d) {
      const sym = this.sym, App = this.App, R = StockInfo.rowsHtml;
      const MUTED = css("MUTED"), GAIN = css("GAIN"), LOSS = css("LOSS"), TEXT = css("TEXT"), ACCENT = css("ACCENT"), ACCENT_TEXT = css("ACCENT_TEXT");
      const q = d.quote || {}, live = App.store.prices[sym] || {};
      const price = live.price || q.price, prev = live.prev || q.prev;
      const name = q.name || App.stockName(sym);
      const co = d.company, etf = d.etf, val = d.valuation || {}, yr = d.year;
      const mkt = { tse: "上市", otc: "上櫃" }[d.market] || "";
      const f2 = (x) => (x ? C.money(x, 2) : null);
      let h = `<h2 style='margin:0'>${esc(sym)}　${esc(name)}</h2>`;
      const tags = [];
      for (let t of [mkt, etf || C.isEtf(sym) ? "ETF" : "", q.sector]) {
        t = t && t.startsWith("櫃") && t.length > 1 ? t.slice(1) : t;
        if (t && !tags.includes(t)) tags.push(t);
      }
      h += `<p style='color:${MUTED};margin-top:2px'>${esc(tags.join("・"))}</p>`;
      if (price) {
        const chg = prev ? price - prev : 0, c = chg > 0 ? GAIN : chg < 0 ? LOSS : TEXT;
        const st = C.limitState(sym, Object.assign({}, Object.keys(live).length ? live : q, { price, prev }));
        const badge = { up: " <span style='background:#e8101a;color:#fff'>&nbsp;漲停&nbsp;</span>", down: " <span style='background:#0f9d3a;color:#fff'>&nbsp;跌停&nbsp;</span>" }[st] || "";
        h += prev ? `<p><span style='font-size:26px;font-weight:bold;color:${c}'>${C.money(price, 2)}</span>　<span style='color:${c}'>${C.signed(chg, 2)}（${C.signed(chg / prev * 100, 2)}%）</span>${badge}</p>`
          : `<p style='font-size:26px;font-weight:bold'>${C.money(price, 2)}</p>`;
      }
      // 賣什麼
      const biz = d.business || {};
      if (biz.kind === "stock") {
        h += "<h3>這家公司賣什麼</h3>";
        h += `<p style='font-size:11pt;line-height:150%'>${esc(biz.business)}</p>`;
        let sec = biz.sector || "";
        sec = sec.startsWith("櫃") && sec.length > 1 ? sec.slice(1) : sec;
        h += R([["產業類別", esc(sec)], ["所屬集團", esc(biz.group || "")]]);
      } else if (biz.kind === "etf") {
        h += "<h3>這檔 ETF 買了什麼</h3>";
        const a = biz.asset || {};
        const mix = [["stock", "股票"], ["bond", "債券"], ["cash", "現金"], ["other", "其他"]].map(([k, lbl]) => [lbl, C.fnum(a[k])]).filter(([, v]) => v).map(([lbl, v]) => `${lbl} <b>${C.fixed(v, 2)}%</b>`);
        if (mix.length) h += `<p>資產分佈：${mix.join("、")}<span style='color:${MUTED}'>（${esc(a.date || "")}）</span></p>`;
        const inds = (biz.industries || []).slice().sort((x, y) => -(C.fnum(x.weighting) || 0) + (C.fnum(y.weighting) || 0));
        if (inds.length && !(inds.length === 1 && String(inds[0].name).includes("其他"))) {
          h += `<p><b>產業比重</b><span style='color:${MUTED}'>（${esc(biz.industries_date || "")}）</span></p><table width='100%' cellspacing=0 cellpadding=3>`;
          for (const x of inds.slice(0, 8)) {
            const w = C.fnum(x.weighting) || 0;
            h += `<tr><td width='30%'>${esc(String(x.name || ""))}</td><td width='12%' align=right>${C.fixed(w, 2)}%</td><td><span style='display:inline-block;height:10px;border-radius:2px;background:${ACCENT};width:${Math.max(4, w * 3)}px'></span></td></tr>`;
          }
          h += "</table>";
        }
        const top = biz.top10 || [];
        if (top.length) {
          h += `<p><b>前十大持股</b><span style='color:${MUTED}'>（${esc(biz.top10_date || "")}）</span></p><table width='100%' cellspacing=0 cellpadding=3>`;
          h += "<tr>" + [["#", "left"], ["名稱", "left"], ["代號", "left"], ["比重", "right"]].map(([t, al]) => `<th align='${al}' style='color:${MUTED}'>${t}</th>`).join("") + "</tr>";
          top.slice(0, 10).forEach((x, i) => {
            const code = String(x.ticker || "").split(".")[0];
            h += `<tr><td>${i + 1}</td><td>${esc(String(x.name || ""))}</td><td>${esc(code)}</td><td align=right>${C.fixed(C.fnum(x.weighting) || 0, 2)}%</td></tr>`;
          });
          h += "</table>";
        }
      }
      // 行情與評價
      h += "<h3>行情與評價</h3>";
      const eps = price && val.pe ? price / val.pe : null;
      h += R([["開盤", f2(q.open)], ["昨收", f2(prev)], ["最高", f2(q.high)], ["最低", f2(q.low)],
        ["漲停價", f2(q.limit_up)], ["跌停價", f2(q.limit_down)],
        ["成交量", q.volume ? `${C.money(q.volume / 1000, 0)} 張` : null],
        ["成交金額", q.turnover ? `${C.money(q.turnover / 100, 2)} 億` : null],
        ["近一年最高", yr ? `${C.money(yr.high, 2)}（${yr.high_d}）` : null],
        ["近一年最低", yr ? `${C.money(yr.low, 2)}（${yr.low_d}）` : null],
        ["近一年漲跌", yr && yr.first ? ((r) => `<span style='color:${r >= 0 ? GAIN : LOSS}'>${C.signed(r, 2)}%</span>`)((yr.last / yr.first - 1) * 100) : null],
        ["近 20 日均量", yr && yr.avg_vol ? `${C.money(yr.avg_vol / 1000, 0)} 張` : null],
        ["本益比", val.pe ? `${C.fixed(val.pe, 2)} 倍` : null],
        ["近四季 EPS（推算）", eps ? `${C.money(eps, 2)} 元` : null],
        ["殖利率", val.yld ? `${C.fixed(val.yld, 2)}%` : null],
        ["股價淨值比", val.pb ? `${C.fixed(val.pb, 2)} 倍` : null]]);
      // 公司或 ETF 資料
      if (co) {
        const g = (...ks) => { for (const k of ks) { const v = String(co[k] === null || co[k] === undefined ? "" : co[k]).trim(); if (v) return v; } return null; };
        const cap = C.fnum(g("實收資本額", "Paidin.Capital.NTDollars")), shares = C.fnum(g("已發行普通股數或TDR原股發行股數", "IssueShares")), web = g("網址", "WebAddress");
        h += "<h3>公司資料</h3>" + R([
          ["公司全名", esc(g("公司名稱", "CompanyName") || "")], ["英文簡稱", esc(g("英文簡稱", "Symbol") || "")],
          ["董事長", esc(g("董事長", "Chairman") || "")], ["總經理", esc(g("總經理", "GeneralManager") || "")],
          ["發言人", esc(g("發言人", "Spokesman") || "")], ["電話", esc(g("總機電話", "Telephone") || "")],
          ["成立日期", M.rocDate(g("成立日期", "DateOfIncorporation"))], ["上市櫃日期", M.rocDate(g("上市日期", "DateOfListing"))],
          ["實收資本額", cap ? `${C.money(cap / 1e8, 2)} 億元` : null], ["發行股數", shares ? `${C.money(shares / 1000, 0)} 張` : null],
          ["市值（推算）", shares && price ? `${C.money(shares * price / 1e8, 0)} 億元` : null],
          ["簽證會計師", esc(g("簽證會計師事務所", "AccountingFirm") || "")], ["股務代理", esc(g("股票過戶機構", "StockTransferAgent") || "")],
          ["網站", web ? `<a href='${esc(/^https?:/i.test(web) ? web : "http://" + web)}' target='_blank' rel='noopener' style='color:${ACCENT_TEXT}'>${esc(web)}</a>` : null],
        ]) + R([["地址", esc(g("住址", "Address") || "")]], 1);
      }
      if (etf) {
        const g = (k) => String(etf[k] === null || etf[k] === undefined ? "" : etf[k]).trim() || null;
        const units = C.fnum(g("發行單位數/轉換數"));
        h += "<h3>ETF 基金資料</h3>" + R([
          ["基金全名", esc(g("基金中文名稱") || "")], ["追蹤指數", esc(g("標的指數/追蹤指數名稱") || "")],
          ["基金類型", esc(g("基金類型") || "")], ["含國外成分股", esc(g("是否包含國外成分股") || "")],
          ["成立日期", M.rocDate(g("成立日期"))], ["上市日期", M.rocDate(g("上市日期"))],
          ["基金經理人", esc(g("基金經理人") || "")], ["經理公司電話", esc(g("經理公司總機") || "")],
          ["發行單位數", units ? `${C.money(units / 1000, 0)} 張` : null],
          ["基金規模（推算）", units && price ? `${C.money(units * price / 1e8, 0)} 億元` : null],
          ["保管機構", esc(g("保管機構") || "")]], 1);
      }
      if (!co && !etf) h += `<p style='color:${MUTED}'>（證交所／櫃買中心沒有這檔的公司資料，可能是上櫃 ETF、興櫃或特別股）</p>`;
      // 月營收
      const rev = d.revenues || [];
      if (rev.length) {
        h += "<h3>近 6 個月營收</h3><table width='100%' cellspacing=0 cellpadding=4><tr>" +
          [["月份", "left"], ["營收（億）", "right"], ["月增", "right"], ["年增", "right"], ["累計年增", "right"]].map(([t, a]) => `<th align='${a}' style='color:${MUTED}'>${t}</th>`).join("") + "</tr>";
        const pc = (x) => { const v = fnumSigned(x); return v !== null ? `<span style='color:${v >= 0 ? GAIN : LOSS}'>${C.signed(v, 2)}%</span>` : "—"; };
        for (const r of rev.slice(0, 6)) {
          const amt = C.fnum(r.revenue), mo = String(r.date || "").slice(0, 7);
          h += amt ? `<tr><td>${esc(mo)}</td><td align=right>${C.money(amt / 1e8, 2)}</td>` : `<tr><td>${esc(mo)}</td><td align=right>—</td>`;
          h += `<td align=right>${pc(r.revenueMoM)}</td><td align=right>${pc(r.revenueYoY)}</td><td align=right>${pc(r.revenueYoYAcc)}</td></tr>`;
        }
        h += "</table>";
      }
      // 股利
      const divs = (d.dividends || []).filter((r) => r.cash || r.stock);
      if (divs.length) {
        let info = App.divclass ? App.divclass.info[sym] : null;
        if (!info) {
          const today = C.today();
          info = C.classifyDividends(divs.filter((r) => r.ex <= today && r.cash).map((r) => [r.ex, r.cash]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])), today);
        }
        const ttm = info && info.ttm ? info.ttm : null;
        h += "<h3>股利</h3>" + R([["配息頻率", info ? C.freqText(info) : null], ["近 12 個月每股配息", ttm ? `${g6(ttm)} 元` : null],
          ["現價殖利率（近 12 月）", ttm && price ? `${C.fixed(ttm / price * 100, 2)}%` : null]]);
        h += "<table width='100%' cellspacing=0 cellpadding=4><tr>" + [["所屬期間", "left"], ["除息日", "left"], ["現金股利", "right"], ["股票股利", "right"], ["發放日", "left"], ["填息天數", "right"]]
          .map(([t, a]) => `<th align='${a}' style='color:${MUTED}'>${t}</th>`).join("") + "</tr>";
        for (const r of divs.slice(0, 8)) {
          const per = `${r.year || ""} ${r.period || ""}`.trim();
          h += `<tr><td>${esc(per)}</td><td>${esc(r.ex)}</td><td align=right>${g6(r.cash || 0)}</td><td align=right>${g6(r.stock || 0)}</td><td>${esc(r.pay || "—")}</td>` +
            `<td align=right>${r.recovery !== null && r.recovery !== undefined ? r.recovery : "—"}</td></tr>`;
        }
        h += "</table>";
      }
      // 我的持股與自選
      const hd = App.holdings[sym];
      if (hd && hd.shares > 0) {
        const hv = App.holdingValues(sym, hd);
        h += "<h3>我的持股</h3>" + R([["股數", `${C.money(hd.shares)} 股`], ["付出成本", C.money(hd.cost)], ["成本均價", C.money(hd.cost / hd.shares, 2)],
          ["市值", hv.mv ? C.money(hv.mv) : null],
          ["損益（" + (App.store.settings.pl_with_div !== false ? "含息" : "不含息") + "）",
            hv.unreal !== null && hv.unreal !== undefined ? `<span style='color:${(hv.unreal || 0) >= 0 ? GAIN : LOSS}'>${C.signed(hv.unreal)}（${C.signed(hv.pct, 2)}%）</span>` : null],
          ["現在賣出實賺", hv.sell_profit !== null && hv.sell_profit !== undefined ? C.signed(hv.sell_profit) : null],
          ["已實現損益", C.signed(hd.realized)]]);
      }
      const w = App.store.watchlist.find((x) => x.symbol === sym);
      if (w) h += "<h3>自選觀察</h3>" + R([["買進目標價", f2(w.buy_target)], ["賣出目標價", f2(w.sell_target)], ["加入日", w.added], ["備註", esc(w.note || "")]]);
      let src = "資料來源：證交所／櫃買中心公開資料（公司、ETF、本益比、殖利率）、Yahoo 奇摩股市（報價、主要業務、ETF 持股、月營收、股利）";
      if (d.errors && d.errors.length) src += "<br>部分資料沒抓到：" + d.errors.map(esc).join("；");
      h += `<p style='color:${MUTED};font-size:11px'>${src}</p>`;
      return h;
    }
  }

  // ================= 使用說明 =================
  class HelpPage {
    constructor() {
      this.App = window.App;
      this.el = el("div");
      this.view = el("div", { cls: "browser help", style: { flex: "1", overflow: "auto" } });
      this.el.append(this.view);
      this.view.addEventListener("click", (e) => {
        const a = e.target.closest("a[href^='#']");
        if (!a) return;
        e.preventDefault(); this.go(a.getAttribute("href").slice(1));
      });
      this.render();
    }
    render() {
      const groups = this.App.shortcutGroups ? this.App.shortcutGroups() : [];
      let keys = "";
      for (const [title, rows] of groups) keys += `<p><b>${title}</b></p><table>` + rows.map(([k, d]) => `<tr><td class='key'>${k}</td><td>${d}</td></tr>`).join("") + "</table>";
      const sections = (keys ? [["keys", "快捷鍵一覽", keys]] : []).concat(T.HELP_SECTIONS);
      const toc = sections.map(([k, t]) => `<a href='#${k}'>${t}</a>`).join("　");
      const body = sections.map(([k, t, html]) => `<a name='${k}' id='help-${k}'></a><h2>${t}</h2>${html}<p class='tip'><a href='#top'>▲ 回到目錄</a></p>`).join("");
      this.view.innerHTML = `<a name='top' id='help-top'></a><h1>${esc(T.APP_NAME)} 使用說明</h1><p class='tip'>版本 v${T.VERSION}（網頁版）　·　按 F1 可隨時開啟這一頁</p>` +
        `<p class='toc'><b>目錄：</b>${toc}</p>${body}`;
    }
    go(anchor) {
      const t = this.view.querySelector("#help-" + (anchor || "top"));
      if (t) this.view.scrollTop = t.offsetTop - this.view.offsetTop;
    }
  }
  window.App = Object.assign(window.App || {}, { StockInfo, HelpPage });
})();
