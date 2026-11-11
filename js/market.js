/* 行情資料：所有網址都經過 Google Apps Script 代抓（瀏覽器不能直接讀 Yahoo／證交所），
   解析方式逐一對照電腦版的 fetch_* 函式。 */
(function (root) {
  "use strict";
  const C = root.Core;
  const M = {};
  let fetcher = null;                 // async (urls:[{url, ttl}]) => [{status, text}]
  M.setFetcher = (fn) => { fetcher = fn; };

  async function many(list) {
    const out = [];
    for (let i = 0; i < list.length; i += 20) out.push(...await fetcher(list.slice(i, i + 20)));
    return out;
  }
  function parse(r, url) {
    if (!r || r.status !== 200) throw new Error((r && (r.error || ("HTTP " + r.status))) || "連線失敗");
    try { return JSON.parse(r.text.replace(/^﻿/, "")); } catch (_e) { throw new Error("資料格式錯誤：" + url.slice(0, 60)); }
  }
  async function getJson(url, ttl) { const [r] = await fetcher([{ url, ttl: ttl || 0 }]); return parse(r, url); }
  async function getText(url, ttl) {
    const [r] = await fetcher([{ url, ttl: ttl || 0 }]);
    if (!r || r.status !== 200) throw new Error((r && (r.error || ("HTTP " + r.status))) || "連線失敗");
    return r.text;
  }
  M.getJson = getJson;
  const q = (s) => encodeURIComponent(s);
  const sufsOf = (market) => ({ tse: [".TW"], otc: [".TWO"] })[market] || [".TW", ".TWO"];
  const raw = (o) => (o && typeof o === "object" ? C.fnum(o.raw) : C.fnum(o));
  const YTW = "https://tw.stock.yahoo.com/_td-stock/api/resource/";

  // ---------- 股票清單 ----------
  M.fetchStockList = async function () {
    const res = await many([{ url: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", ttl: 3600 },
      { url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes", ttl: 3600 }]);
    const out = {};
    for (const it of parse(res[0], "STOCK_DAY_ALL")) {
      const code = String(it.Code || "").trim();
      if (code) out[code] = { name: String(it.Name || "").trim(), market: "tse", close: C.fnum(it.ClosingPrice) };
    }
    try {
      for (const it of parse(res[1], "tpex")) {
        const code = String(it.SecuritiesCompanyCode || "").trim();
        if (code && !out[code]) out[code] = { name: String(it.CompanyName || "").trim(), market: "otc", close: C.fnum(it.Close) };
      }
    } catch (_e) { /* 上櫃抓不到就算了 */ }
    const keep = {};
    Object.keys(out).forEach((k) => { if (k.length === 4 || k.startsWith("00")) keep[k] = out[k]; });
    return keep;
  };

  // ---------- 即時報價 ----------
  M.fetchYahooTw = async function (symbols, stockList) {
    const ysyms = {};
    for (const s of symbols) {
      const m = (stockList[s] || {}).market;
      for (const suf of m === "otc" ? [".TWO"] : m === "tse" ? [".TW"] : [".TW", ".TWO"]) ysyms[s + suf] = s;
    }
    const names = Object.keys(ysyms), urls = [];
    for (let i = 0; i < names.length; i += 40)
      urls.push({ url: YTW + "StockServices.stockList;fields=avgPrice%2Corderbook;symbols=" + q(names.slice(i, i + 40).join(",")), ttl: 3 });
    const res = await many(urls), out = {};
    res.forEach((r, k) => {
      let data;
      try { data = parse(r, urls[k].url); } catch (e) { if (urls.length === 1) throw e; return; }
      for (const x of Array.isArray(data) ? data : []) {
        const code = ysyms[x.symbol || ""], price = C.fnum((x.price || {}).raw);
        if (!code || price === null) continue;
        let stamp = "";
        const t = Date.parse(String(x.regularMarketTime));
        if (!isNaN(t)) { const tt = C.tsToTw(t / 1000); stamp = tt.date.replace(/-/g, "") + " " + tt.time; }
        out[code] = { price, prev: C.fnum((x.regularMarketPreviousClose || {}).raw), name: x.symbolName || "", time: stamp, trade_time: stamp, src: "ytw",
          limit_up: C.fnum((x.limitUpPrice || {}).raw), limit_down: C.fnum((x.limitDownPrice || {}).raw),
          market: String(x.symbol || "").endsWith(".TWO") ? "otc" : "tse",
          open: C.fnum((x.regularMarketOpen || {}).raw), high: C.fnum((x.regularMarketDayHigh || {}).raw), low: C.fnum((x.regularMarketDayLow || {}).raw),
          volume: raw(x.volume), turnover_m: raw(x.turnoverM) };
      }
    });
    return out;
  };
  M.yahooLastTrade = async function (symbol, market) {
    const suf = market === "otc" ? ".TWO" : ".TW";
    const data = await getJson("https://query1.finance.yahoo.com/v8/finance/chart/" + q(symbol + suf) + "?range=1d&interval=1m", 5);
    const meta = (((data.chart || {}).result || [{}])[0] || {}).meta || {};
    const price = C.fnum(meta.regularMarketPrice), ts = meta.regularMarketTime;
    if (!price || !ts) return null;
    const tt = C.tsToTw(ts);
    return [price, tt.date.replace(/-/g, "") + " " + tt.time];
  };
  M.fetchQuotes = async function (symbols, stockList, oldPrices) {
    oldPrices = oldPrices || {};
    const first = {};
    try { Object.assign(first, await M.fetchYahooTw(symbols, stockList)); } catch (_e) { /* 改用證交所 */ }
    symbols = symbols.filter((s) => !first[s]);
    if (!symbols.length) return first;
    const keys = [];
    for (const s of symbols) { const m = (stockList[s] || {}).market; if (m) keys.push(`${m}_${s}.tw`); else keys.push(`tse_${s}.tw`, `otc_${s}.tw`); }
    const result = {}, pending = {};
    for (let i = 0; i < keys.length; i += 40) {
      const url = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=" + q(keys.slice(i, i + 40).join("|")).replace(/%7C/g, "|");
      let data;
      try { data = await getJson(url, 3); } catch (_e) { continue; }
      for (const m of data.msgArray || []) {
        const code = m.c || "";
        if (!code) continue;
        const day = m.d || "";
        const base = { prev: C.fnum(m.y), name: m.n || "", market: m.ex || "", limit_up: C.fnum(m.u), limit_down: C.fnum(m.w) };
        const price = C.fnum(m.z);
        if (price !== null) { const stamp = `${day} ${m.t || ""}`.trim(); result[code] = Object.assign(base, { price, time: stamp, trade_time: stamp, src: "live" }); }
        else pending[code] = Object.assign(base, { day, volume: C.fnum(m.v) || 0, high: C.fnum(m.h), low: C.fnum(m.l), bid: C.fnum(String(m.b || "").split("_")[0]) });
      }
    }
    for (const code of Object.keys(pending)) {
      const p = pending[code];
      const info = { prev: p.prev, name: p.name, market: p.market, limit_up: p.limit_up, limit_down: p.limit_down };
      let cands = [];
      const old = oldPrices[code] || {};
      if (["yuanta", "ytw", "live", "kept", "yahoo"].includes(old.src) && String(old.trade_time || "").startsWith(p.day)) cands.push([old.trade_time, old.price, "kept"]);
      if (p.volume > 0) {
        try { const y = await M.yahooLastTrade(code, p.market); if (y && y[1].startsWith(p.day)) cands.push([y[1], y[0], "yahoo"]); } catch (_e) { /* 略過 */ }
      }
      cands = cands.filter((c) => !(p.high && p.low) || (p.low - 1e-6 <= c[1] && c[1] <= p.high + 1e-6));
      if (cands.length) {
        cands.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || (a[2] < b[2] ? -1 : 1)));
        const [stamp, price, src] = cands[cands.length - 1];
        result[code] = Object.assign(info, { price, time: stamp, trade_time: stamp, src });
      } else if (p.volume === 0 && p.prev) result[code] = Object.assign(info, { price: p.prev, time: p.day, src: "ref" });
      else if (p.bid || p.prev) result[code] = Object.assign(info, { price: p.bid || p.prev, time: p.day, src: "bid" });
    }
    for (const s of symbols) if (!result[s] && (stockList[s] || {}).close) result[s] = { price: stockList[s].close, prev: null, name: stockList[s].name, time: "最近收盤", src: "close" };
    return Object.assign(result, first);
  };

  // ---------- 休市表 ----------
  M.fetchHolidays = async function (year) {
    const data = await getJson(`https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?date=${year}0101&response=json`, 3600);
    return C.parseHolidays(data, year);
  };

  // ---------- 排行、ETF ----------
  M.fetchRank = async function (exchange, sort, limit) {
    const url = YTW + `StockServices.rank;exchange=${exchange};limit=${Math.trunc(limit || 50)};offset=0;period=1D;sortBy=${sort}`;
    const data = await getJson(url, 20);
    const rows = [];
    for (const x of data.list || []) {
      const sym = String(x.symbol || "").split(".")[0];
      if (!sym) continue;
      const num = (k) => (x[k] === null || x[k] === undefined || x[k] === "" || x[k] === "-" ? null : C.fnum(String(x[k]).replace(/%/g, "").replace(/\+/g, "")));
      const chg = C.fnumSigned(String(x.change).replace(/\+/g, "")), pct = C.fnumSigned(String(x.changePercent).replace(/%/g, "").replace(/\+/g, ""));
      rows.push({ rank: Math.trunc(x.rank || rows.length + 1), symbol: sym, name: x.symbolName || x.name || sym, price: num("price"), prev: num("previousClose"),
        change: x.change === null || x.change === undefined ? null : chg, pct: x.changePercent === null || x.changePercent === undefined ? null : pct,
        high: num("dayHigh"), low: num("dayLow"), volume: num("volume") || 0.0, turnover_k: num("turnoverK") || 0.0,
        limit_up: !!x.limitUp, limit_down: !!x.limitDown, market: exchange === "TWO" ? "otc" : "tse" });
    }
    return [rows, data.rankTime || ""];
  };
  M.fetchEtfBoard = async function (stockList, exchange) {
    exchange = exchange || "ALL";
    const syms = Object.keys(stockList).filter((k) => k.startsWith("00") && (exchange === "ALL" || stockList[k].market === (exchange === "TWO" ? "otc" : "tse")));
    const quotes = await M.fetchYahooTw(syms, stockList), rows = [];
    for (const sym of syms) {
      const qq = quotes[sym];
      if (!qq || !qq.price) continue;
      const price = qq.price, prev = qq.prev, st = C.limitState(sym, qq);
      rows.push({ rank: 0, symbol: sym, name: qq.name || stockList[sym].name || sym, price, prev, change: prev ? price - prev : null,
        pct: prev ? (price / prev - 1) * 100 : null, high: qq.high, low: qq.low, volume: qq.volume || 0.0, turnover_k: (qq.turnover_m || 0.0) * 1000,
        limit_up: st === "up", limit_down: st === "down", market: qq.market || stockList[sym].market });
    }
    const n = C.now();
    return [rows, n.date + " " + n.time.slice(0, 5)];
  };

  // ---------- 走勢、歷史 ----------
  async function dailyFromIntraday(full, days) {
    let r, qq;
    try {
      const data = await getJson("https://query1.finance.yahoo.com/v8/finance/chart/" + q(full) + "?range=5d&interval=5m", 60);
      r = data.chart.result[0]; qq = r.indicators.quote[0];
    } catch (_e) { return {}; }
    const agg = {};
    (r.timestamp || []).forEach((ts, i) => {
      const c = qq.close[i];
      if (c === null || c === undefined) return;
      const d = C.tsToTw(ts).date;
      if (!days.has(d)) return;
      const o = qq.open[i] || c, h = qq.high[i] || c, l = qq.low[i] || c, v = qq.volume[i] || 0, a = agg[d];
      agg[d] = !a ? [o, h, l, c, v] : [a[0], Math.max(a[1], h), Math.min(a[2], l), c, a[4] + v];
    });
    return agg;
  }
  M.fetchChart = async function (symbol, market, rng, interval) {
    let lastErr = null;
    for (const suf of sufsOf(market)) {
      let data;
      try { data = await getJson("https://query1.finance.yahoo.com/v8/finance/chart/" + q(symbol + suf) + `?range=${rng}&interval=${interval}`, interval.endsWith("m") ? 30 : 300); }
      catch (e) { lastErr = e; continue; }
      const res = (data.chart || {}).result;
      if (!res || !res.length) continue;
      const r = res[0], qq = ((r.indicators || {}).quote || [{}])[0] || {};
      let rows = [];
      (r.timestamp || []).forEach((ts, i) => {
        const c = (qq.close || [])[i];
        if (c === null || c === undefined) return;
        let o = (qq.open || [])[i], h = (qq.high || [])[i], l = (qq.low || [])[i];
        o = o !== null && o !== undefined ? o : c;
        h = Math.max(...[h, o, c].filter((x) => x !== null && x !== undefined));
        l = Math.min(...[l, o, c].filter((x) => x !== null && x !== undefined));
        const tt = C.tsToTw(ts);
        rows.push([tt.date + " " + tt.time, +o, +h, +l, +c, +((qq.volume || [])[i] || 0)]);
      });
      if (rows.length && interval === "1d") {
        const have = new Set(rows.map((x) => x[0].slice(0, 10)));
        const miss = C.recentMissingDays(have).filter((d) => d >= rows[0][0].slice(0, 10));
        if (miss.length) {
          const add = await dailyFromIntraday(symbol + suf, new Set(miss));
          Object.keys(add).forEach((d) => { const [o, h, l, c, v] = add[d]; rows.push([d + " 09:00:00", o, h, l, c, v]); });
          rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        }
      }
      if (rows.length) {
        const meta = r.meta || {};
        return { rows, intraday: interval.endsWith("m"), prev: C.fnum(meta.previousClose) || C.fnum(meta.chartPreviousClose) };
      }
    }
    throw new Error(`抓不到 ${symbol} 的走勢資料` + (lastErr ? `（${lastErr.message}）` : ""));
  };
  M.yahooHistory = async function (symbol, market) {
    const sufs = symbol.startsWith("^") ? [""] : sufsOf(market);
    let lastErr = null;
    for (const suf of sufs) {
      let data;
      try { data = await getJson("https://query1.finance.yahoo.com/v8/finance/chart/" + q(symbol + suf) + "?range=5y&interval=1d", 600); }
      catch (e) { lastErr = e; continue; }
      const res = (data.chart || {}).result;
      if (!res || !res.length) continue;
      const r = res[0], qq = r.indicators.quote[0], byDate = {};
      (r.timestamp || []).forEach((ts, i) => {
        const o = qq.open[i], h = qq.high[i], l = qq.low[i], c = qq.close[i], v = qq.volume[i];
        if ([o, h, l, c].some((x) => x === null || x === undefined) || c <= 0) return;
        const d = C.tsToTw(ts).date;
        byDate[d] = [d, +o, +h, +l, +c, +(v || 0)];
      });
      if (Object.keys(byDate).length) {
        const miss = C.recentMissingDays(new Set(Object.keys(byDate)));
        if (miss.length) {
          const add = await dailyFromIntraday(symbol + suf, new Set(miss));
          Object.keys(add).forEach((d) => { const [o, h, l, c, v] = add[d]; byDate[d] = [d, o, h, l, c, v]; });
        }
      }
      const rows = Object.keys(byDate).sort().map((d) => byDate[d]);
      const n = C.now();
      if (rows.length && rows[rows.length - 1][0] === n.date && n.minutes < C.hm(13, 35)) rows.pop();
      if (rows.length > 60) return rows;
    }
    throw new Error(`抓不到 ${symbol} 的歷史股價` + (lastErr ? `（${lastErr.message}）` : ""));
  };

  // ---------- 股利 ----------
  M.fetchDividendHistory = async function (symbol, market) {
    let lastErr = null;
    for (const suf of sufsOf(market)) {
      let data;
      try { data = await getJson("https://query1.finance.yahoo.com/v8/finance/chart/" + q(symbol + suf) + "?range=5y&interval=1mo&events=div", 3600); }
      catch (e) { lastErr = e; continue; }
      const res = (data.chart || {}).result;
      if (!res || !res.length) continue;
      const ev = ((res[0].events || {}).dividends) || {}, rows = {};
      for (const v of Object.values(ev)) {
        const d = parseInt(v.date, 10), a = parseFloat(v.amount);
        if (isNaN(d) || isNaN(a)) continue;
        rows[C.tsToTw(d).date] = C.pyRound(a, 4);
      }
      return Object.keys(rows).sort().map((d) => [d, rows[d]]);
    }
    throw new Error(`查不到 ${symbol} 的配息資料` + (lastErr ? `（${lastErr.message}）` : ""));
  };
  M.fetchCashDividends = async function (symbol, market) {
    let lastErr = null;
    for (const suf of sufsOf(market)) {
      let items;
      try {
        const data = await getJson(YTW + "StockServices.dividends;action=combineCashAndStock;date=;limit=100;showUpcoming=true;sortBy=-date;symbol=" + q(symbol + suf), 3600);
        items = data.dividends || [];
      } catch (e) { lastErr = e; continue; }
      const rows = [];
      for (const x of items) {
        const e = x.exDividend || {}, rt = x.exRight || {};
        const cash = C.fnum(e.cash) || 0.0, stock = C.fnum(rt.stock) || 0.0;
        const ex = String(e.date || rt.date || x.exDate || "").slice(0, 10);
        if (!ex || (!cash && !stock)) continue;
        const rec = e.recoveryDays;
        rows.push({ ex, cash, pay: String(e.cashPayDate || "").slice(0, 10), stock, stock_ex: String(rt.date || "").slice(0, 10),
          period: String(x.period || ""), year: String(x.year || ""), recovery: /^\d+$/.test(String(rec || "")) ? parseInt(rec, 10) : null });
      }
      if (rows.length || !lastErr) { rows.sort((a, b) => (a.ex < b.ex ? 1 : a.ex > b.ex ? -1 : 0)); return rows; }
    }
    throw new Error(`查不到 ${symbol} 的股利資料` + (lastErr ? `（${lastErr.message}）` : ""));
  };
  function rocToIso(s) {
    s = String(s).trim();
    const y = parseInt(s.slice(0, -4), 10) + 1911, m = parseInt(s.slice(-4, -2), 10), d = parseInt(s.slice(-2), 10);
    if (!y || !m || !d || m > 12 || d > 31) throw new Error("bad date");
    return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  M.fetchExdivAnnouncements = async function () {
    const res = await many([{ url: "https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL", ttl: 1800 },
      { url: "https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost", ttl: 1800 }]);
    const out = [], errs = [];
    try {
      for (const it of parse(res[0], "TWT48U")) {
        try {
          out.push({ date: rocToIso(it.Date || ""), code: String(it.Code || "").trim(), name: String(it.Name || "").trim(), kind: "除" + String(it.Exdividend || "").trim(),
            cash: C.fnum(it.CashDividend), stock: C.fnum(it.StockDividendRatio), market: "上市" });
        } catch (_e) { /* 略過 */ }
      }
    } catch (e) { errs.push("證交所：" + e.message); }
    try {
      for (const it of parse(res[1], "tpex")) {
        try {
          out.push({ date: rocToIso(it.ExRrightsExDividendDate || ""), code: String(it.SecuritiesCompanyCode || "").trim(), name: String(it.CompanyName || "").trim(),
            kind: String(it.ExRrightsExDividend || "").trim(), cash: C.fnum(it.CashDividend), stock: C.fnum(it.StockDividendRatio), market: "上櫃" });
        } catch (_e) { /* 略過 */ }
      }
    } catch (e) { errs.push("櫃買中心：" + e.message); }
    if (!out.length && errs.length) throw new Error(errs.join("；"));
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    return out;
  };

  // ---------- 個股基本資料 ----------
  const INFO_SOURCES = [
    ["co_tse", "https://openapi.twse.com.tw/v1/opendata/t187ap03_L", "公司代號"],
    ["co_otc", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O", "SecuritiesCompanyCode"],
    ["etf", "https://openapi.twse.com.tw/v1/opendata/t187ap47_L", "基金代號"],
    ["val_tse", "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL", "Code"],
    ["val_otc", "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis", "SecuritiesCompanyCode"],
  ];
  let infoMem = null;
  M.loadBasicLists = async function (idb) {
    const t = C.today();
    if (infoMem && infoMem.date === t) return infoMem;
    let cache = idb ? await idb.get("basic_info") : null;
    if (cache && cache.date === t) { infoMem = cache; return cache; }
    const res = await many(INFO_SOURCES.map(([, url]) => ({ url, ttl: 0 })));
    const out = { date: t };
    let got = false;
    INFO_SOURCES.forEach(([key, url, col], i) => {
      try {
        const rows = parse(res[i], url), map = {};
        rows.forEach((r) => { if (r && typeof r === "object") map[String(r[col] || "").trim()] = r; });
        out[key] = map; got = got || Object.keys(map).length > 0;
      } catch (_e) { out[key] = (cache || {})[key] || {}; }
    });
    if (got && idb) await idb.set("basic_info", out);
    infoMem = out;
    return out;
  };
  M.rocDate = function (v) {
    v = String(v || "").trim();
    if (/^\d{7}$/.test(v)) return (parseInt(v.slice(0, 3), 10) + 1911) + "-" + v.slice(3, 5) + "-" + v.slice(5);
    if (/^\d{8}$/.test(v)) return v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6);
    return v;
  };
  function extractJson(h, key) {        // 對照 Python json.JSONDecoder().raw_decode：從 key 後面取一個完整的 JSON 值
    const i = h.indexOf(key);
    if (i < 0) return null;
    const s = h.slice(i + key.length).replace(/:undefined/g, ":null");
    let depth = 0, inStr = false, esc = false, end = -1;
    const open = s[0];
    if (open !== "{" && open !== "[") return null;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { end = k; break; } }
    }
    return end < 0 ? null : JSON.parse(s.slice(0, end + 1));
  }
  M.fetchBusiness = async function (symbol, market) {
    for (const suf of sufsOf(market)) {
      if (C.isEtf(symbol)) {
        const pf = extractJson(await getText(`https://tw.stock.yahoo.com/quote/${symbol}${suf}/holding`, 0), '"portfolio":');
        if (pf) {
          const g = (k) => pf[k] || {};
          return { kind: "etf", asset: g("assetAllocation"), industries: g("investIndustryWeights").detail || [], industries_date: g("investIndustryWeights").date || "",
            top10: g("top10Holdings").holdingDetail || [], top10_date: g("top10Holdings").date || "" };
        }
      } else {
        const d = extractJson(await getText(`https://tw.stock.yahoo.com/quote/${symbol}${suf}/profile`, 0), '"fundamental":{"data":');
        if (d && d.business) return { kind: "stock", business: String(d.business || "").replace(/\s*\r?\n\s*/g, "").trim(), group: d.groupName || "", sector: d.sectorName || "", exchange: d.exchangeName || "" };
      }
    }
    return null;
  };
  M.fetchBasicInfo = async function (symbol, market, idb) {
    const out = { symbol, errors: [] }, sufs = sufsOf(market);
    const tQuote = async () => {
      for (const suf of sufs) {
        const data = await getJson(YTW + "StockServices.stockList;fields=avgPrice,orderbook;symbols=" + symbol + suf, 5);
        if (data && data.length) {
          const x = data[0], g = (k) => raw(x[k]);
          return { name: x.symbolName || "", sector: x.sectorName || "", market: suf === ".TWO" ? "otc" : "tse", price: g("price"), prev: g("regularMarketPreviousClose"),
            open: g("regularMarketOpen"), high: g("regularMarketDayHigh"), low: g("regularMarketDayLow"), volume: g("volume"), turnover: g("turnoverM"), avg: g("avgPrice"),
            limit_up: g("limitUpPrice"), limit_down: g("limitDownPrice") };
        }
      }
      return null;
    };
    const tYear = async () => {
      const rows = (await M.fetchChart(symbol, market, "1y", "1d")).rows;
      if (!rows.length) return null;
      let hi = rows[0], lo = rows[0];
      rows.forEach((r) => { if (r[2] > hi[2]) hi = r; if (r[3] < lo[3]) lo = r; });
      const tail = rows.slice(-20);
      return { high: hi[2], high_d: hi[0].slice(0, 10), low: lo[3], low_d: lo[0].slice(0, 10), first: rows[0][4], last: rows[rows.length - 1][4],
        avg_vol: tail.reduce((s, r) => s + r[5], 0) / Math.min(20, rows.length) };
    };
    const tRev = async () => {
      if (C.isEtf(symbol)) return [];
      for (const suf of sufs) {
        const rv = await getJson(YTW + `StockServices.revenues;includedQuarterRevenue=false;period=month;symbol=${symbol}${suf}`, 3600);
        const got = (((rv || {}).data || {}).result || {}).revenues || [];
        if (got.length) return got;
      }
      return [];
    };
    const tasks = { lists: [() => M.loadBasicLists(idb), "公司資料"], quote: [tQuote, "報價"], year: [tYear, "近一年走勢"], revenues: [tRev, "月營收"],
      dividends: [() => M.fetchCashDividends(symbol, market), "股利"], business: [() => M.fetchBusiness(symbol, market), "主要業務"] };
    const keys = Object.keys(tasks), res = {};
    const settled = await Promise.allSettled(keys.map((k) => tasks[k][0]()));
    settled.forEach((r, i) => {
      const k = keys[i];
      if (r.status === "fulfilled") res[k] = r.value;
      else { res[k] = null; if (k !== "revenues" || !C.isEtf(symbol)) out.errors.push(`${tasks[k][1]}：${r.reason && r.reason.message || r.reason}`); }
    });
    const lists = res.lists || {};
    out.company = (lists.co_tse || {})[symbol] || (lists.co_otc || {})[symbol] || null;
    out.etf = (lists.etf || {})[symbol] || null;
    let v = (lists.val_tse || {})[symbol];
    if (v) out.valuation = { pe: C.fnum(v.PEratio), yld: C.fnum(v.DividendYield), pb: C.fnum(v.PBratio) };
    else {
      v = (lists.val_otc || {})[symbol];
      if (v) out.valuation = { pe: C.fnum(v.PriceEarningRatio), yld: C.fnum(v.YieldRatio), pb: C.fnum(v.PriceBookRatio), dps: C.fnum(v.DividendPerShare) };
    }
    out.quote = res.quote; out.year = res.year;
    out.revenues = out.etf ? [] : (res.revenues || []);
    out.dividends = res.dividends || [];
    out.business = res.business;
    out.market = market || (out.quote || {}).market;
    return out;
  };

  root.Market = M;
})(typeof window !== "undefined" ? window : globalThis);
