/* 股票計算與持股 — 計算核心（逐行對照電腦版 stock_app.py，結果需一致；改邏輯時兩邊都要改）。
   日期一律用 "YYYY-MM-DD" 字串；「現在」以台灣時間為準。 */
(function (root) {
  "use strict";
  const FEE_RATE = 0.001425;
  const NHI_RATE = 0.0211, NHI_THRESHOLD = 20000;
  const WEEKDAYS = "一二三四五六日";
  const FREQ_ORDER = ["月配", "雙月配", "季配", "半年配", "年配", "不定期", "不配息"];
  const DEFAULT_SETTINGS = {
    fee_discount: 10.0, min_fee: 20, min_fee_odd: 20, auto_refresh: true, refresh_sec: 30, only_trading_hours: true,
    unreal_deduct_cost: true, notify_popup: true, order_enabled: false, order_max_amount: 100000, order_auto_import: true,
    est_fee_mode: "broker", show_closed: false, pl_with_div: true, div_fee: 10, div_nhi: true,
  };

  // ---------- Python 相容的數字處理 ----------
  const trunc = Math.trunc;
  function pyRound(x, d) {            // Python round()：剛好一半時取偶數（只在二進位剛好是 .5 時才會發生）
    d = d || 0;
    const m = Math.pow(10, d), y = x * m, f = Math.floor(y), diff = y - f;
    let r;
    if (diff === 0.5) r = f % 2 === 0 ? f : f + 1;
    else r = Math.round(y);
    return d ? r / m : r;
  }
  function fixed(x, d) {              // 等同 Python f"{x:.{d}f}"（剛好一半取偶數）
    const m = Math.pow(10, d), y = Math.abs(x) * m;
    let s;
    if (y % 1 === 0.5) { const f = Math.floor(y), r = f % 2 === 0 ? f : f + 1; s = (r / m).toFixed(d); }
    else s = Math.abs(x).toFixed(d);
    return (x < 0 || Object.is(x, -0) ? "-" : "") + s;            // Python 會留下「-0」
  }
  function commas(s) {
    const neg = s[0] === "-", body = neg ? s.slice(1) : s, i = body.indexOf(".");
    const intp = i < 0 ? body : body.slice(0, i), frac = i < 0 ? "" : body.slice(i);
    return (neg ? "-" : "") + intp.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + frac;
  }
  const money = (x, d) => commas(fixed(Number(x) || 0, d || 0));
  const signed = (x, d) => { const s = money(x, d); return s[0] === "-" ? s : "+" + s; };
  const f2 = (x) => money(x, 2);
  function fnum(v) {
    if (v === null || v === undefined) return null;
    const x = parseFloat(String(v).replace(/,/g, "").trim());
    return isFinite(x) && x > 0 && /^\s*[-+]?[\d,]*\.?\d+(e[-+]?\d+)?\s*$/i.test(String(v)) ? x : null;
  }
  function fnumSigned(v) {
    const x = parseFloat(String(v).replace(/,/g, "").trim());
    return isFinite(x) ? x : null;
  }

  // ---------- 日期（台灣時間）----------
  function twNow() {
    const t = new Date(Date.now() + 8 * 3600000);
    const p = (n) => String(n).padStart(2, "0");
    return {
      date: t.getUTCFullYear() + "-" + p(t.getUTCMonth() + 1) + "-" + p(t.getUTCDate()),
      hh: t.getUTCHours(), mm: t.getUTCMinutes(), ss: t.getUTCSeconds(),
      time: p(t.getUTCHours()) + ":" + p(t.getUTCMinutes()) + ":" + p(t.getUTCSeconds()),
      minutes: t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60,
      weekday: (t.getUTCDay() + 6) % 7, ms: Date.now(),
    };
  }
  const NOW = { fn: twNow };            // 測試時可換成固定時間
  const now = () => NOW.fn();
  const today = () => now().date;
  const hm = (h, m) => h * 60 + m;
  function dayNum(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000; }
  function isoOf(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
  const addDays = (iso, k) => isoOf(dayNum(iso) + k);
  const weekday = (iso) => (new Date(dayNum(iso) * 86400000).getUTCDay() + 6) % 7;
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);
  function monthDays(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function shortDay(iso) { return (+iso.slice(5, 7)) + "/" + (+iso.slice(8, 10)) + "（" + WEEKDAYS[weekday(iso)] + "）"; }
  function tsToTw(ts) {               // Unix 秒 → {date, time, stamp}
    const t = new Date(ts * 1000 + 8 * 3600000), p = (n) => String(n).padStart(2, "0");
    const date = t.getUTCFullYear() + "-" + p(t.getUTCMonth() + 1) + "-" + p(t.getUTCDate());
    return { date, time: p(t.getUTCHours()) + ":" + p(t.getUTCMinutes()) + ":" + p(t.getUTCSeconds()), hh: t.getUTCHours(), mi: t.getUTCMinutes() };
  }

  // ---------- 手續費、稅 ----------
  const isEtf = (s) => String(s).startsWith("00");
  const isBondEtf = (s) => isEtf(s) && String(s).toUpperCase().endsWith("B");
  function sellTaxRate(symbol, onDate) {
    const d = onDate || today();
    if (isBondEtf(symbol) && d <= "2026-12-31") return 0.0;
    return isEtf(symbol) ? 0.001 : 0.003;
  }
  function calcFee(amount, shares, s) {
    if (amount <= 0) return 0;
    const fee = trunc(amount * FEE_RATE * s.fee_discount / 10 + 1e-9);
    const minimum = shares % 1000 === 0 ? s.min_fee : s.min_fee_odd;
    return Math.max(fee, trunc(minimum));
  }
  const tradeAmount = (t) => trunc(t.shares * t.price + 1e-9);
  const calcTax = (amount, rate) => (amount > 0 ? trunc(amount * rate + 1e-9) : 0);
  function tickSize(price, etf) {
    if (etf) return price < 50 ? 0.01 : 0.05;
    for (const [limit, tick] of [[10, 0.01], [50, 0.05], [100, 0.1], [500, 0.5], [1000, 1.0]]) if (price < limit) return tick;
    return 5.0;
  }
  function sellNowEstimate(symbol, shares, price, s) {
    const rate = sellTaxRate(symbol), orders = [];
    for (const q of [Math.floor(shares / 1000) * 1000, shares % 1000]) {
      if (q) {
        const amt = trunc(q * price + 1e-9);
        orders.push({ shares: q, amount: amt, fee: calcFee(amt, q, s), tax: calcTax(amt, rate) });
      }
    }
    const amount = orders.reduce((a, o) => a + o.amount, 0), fee = orders.reduce((a, o) => a + o.fee, 0), tax = orders.reduce((a, o) => a + o.tax, 0);
    return { orders, amount, fee, tax, net: amount - fee - tax, tax_rate: rate };
  }
  function trialSell(transactions, dividends, symbol, shares, price, s) {
    const est = sellNowEstimate(symbol, shares, price, s);
    const fake = { id: "__trial__", date: "9999-12-31", symbol, name: "", type: "sell", shares, price, fee: est.fee, tax: est.tax };
    const r = computePortfolio(transactions.concat([fake]), dividends);
    const hit = r.realized.find((x) => x.id === "__trial__");
    const cost = hit ? hit.cost : 0.0, left = r.holdings[symbol] || {};
    const profit = est.net - cost;
    return { est, cost, profit, pct: cost ? profit / cost * 100 : 0.0, left_shares: left.shares || 0, left_cost: left.cost || 0.0 };
  }
  function priceForReturn(buyPrice, shares, etf, taxRate, s, targetPct) {
    targetPct = targetPct || 0;
    if (buyPrice <= 0 || shares <= 0) return null;
    const buyAmt = buyPrice * shares, cost = buyAmt + calcFee(buyAmt, shares, s), target = cost * (1 + targetPct / 100);
    const est = target / shares / (1 - FEE_RATE * s.fee_discount / 10 - taxRate);
    let p = Math.max(0.01, est * 0.98);
    const t = tickSize(p, etf);
    p = pyRound(trunc(p / t) * t, 2);
    for (let i = 0; i < 200000; i++) {
      const amt = p * shares, net = amt - calcFee(amt, shares, s) - calcTax(amt, taxRate);
      if (net >= target - 1e-9) return p;
      p = pyRound(p + tickSize(p, etf), 2);
    }
    return null;
  }

  // ---------- 持股（先進先出）----------
  function computePortfolio(transactions, dividends) {
    const events = [];
    transactions.forEach((t, i) => events.push([t.date, t.type === "buy" ? 0 : 2, i, "tx", t]));
    dividends.forEach((d, i) => events.push([d.date, 1, i, "div", d]));
    events.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || a[2] - b[2]));
    const holdings = {}, realized = [], errors = [], lots = {};
    const get = (sym, name) => {
      let h = holdings[sym];
      if (!h) h = holdings[sym] = { name, shares: 0, cost: 0.0, realized: 0.0, div_cash: 0.0, buy_total: 0.0, sell_total: 0.0 };
      if (name) h.name = name;
      return h;
    };
    for (const [, , , kind, rec] of events) {
      const h = get(rec.symbol, rec.name || "");
      if (kind === "div") {
        h.div_cash += Number(rec.cash || 0) || 0;
        const extra = trunc(Number(rec.stock_shares || 0) || 0);
        if (extra) { h.shares += extra; (lots[rec.symbol] = lots[rec.symbol] || []).push([extra, 0.0]); }
        continue;
      }
      const amt = tradeAmount(rec);
      if (rec.type === "buy") {
        h.shares += rec.shares;
        h.cost += amt + rec.fee;
        (lots[rec.symbol] = lots[rec.symbol] || []).push([rec.shares, amt + rec.fee]);
        h.buy_total += amt + rec.fee;
      } else {
        let sold = rec.shares;
        if (sold > h.shares) {
          errors.push({ id: rec.id, symbol: rec.symbol, date: rec.date, msg: `${rec.date} 賣出 ${money(sold)} 股，但當時只持有 ${money(h.shares)} 股` });
          sold = h.shares;
        }
        const q = (lots[rec.symbol] = lots[rec.symbol] || []);
        let costPart = 0.0, left = sold;
        while (left > 0 && q.length) {
          const [n, c] = q[0];
          if (n <= left) { costPart += c; left -= n; q.shift(); }
          else {
            const keep = Math.ceil(c * (n - left) / n - 1e-9);
            costPart += c - keep;
            q[0] = [n - left, keep];
            left = 0;
          }
        }
        const avg = sold ? costPart / sold : 0.0;
        const ratio = rec.shares ? sold / rec.shares : 0;
        const proceeds = (amt - rec.fee - rec.tax) * ratio, profit = proceeds - costPart;
        h.shares -= sold;
        h.cost = q.reduce((a, x) => a + x[1], 0);
        if (h.shares === 0) h.cost = 0.0;
        h.realized += profit;
        h.sell_total += proceeds;
        realized.push({ id: rec.id, date: rec.date, symbol: rec.symbol, name: h.name, shares: sold, price: rec.price, avg, cost: costPart,
          proceeds, profit, pct: costPart ? profit / costPart * 100 : 0.0 });
      }
    }
    return { holdings, realized, errors };
  }
  function sharesBefore(transactions, dividends, symbol, exIso) {
    const txs = transactions.filter((t) => t.symbol === symbol && t.date < exIso);
    const divs = dividends.filter((d) => d.symbol === symbol && d.date < exIso);
    return ((computePortfolio(txs, divs).holdings[symbol]) || {}).shares || 0;
  }
  function fifoLots(transactions, symbol) {
    const lots = [];
    const list = transactions.filter((t) => t.symbol === symbol).map((t, i) => [t, i]);
    list.sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : (a[0].type === "sell") - (b[0].type === "sell") || a[1] - b[1]));
    for (const [t] of list) {
      if (t.type === "buy") lots.push([t.date, t.shares]);
      else {
        let left = t.shares;
        while (left && lots.length) {
          const k = Math.min(left, lots[0][1]);
          lots[0][1] -= k; left -= k;
          if (lots[0][1] === 0) lots.shift();
        }
      }
    }
    return lots.filter((x) => x[1] > 0);
  }
  function heldPeriodDividends(transactions, dividends, symbol, divRows, settings, todayIso) {
    todayIso = todayIso || today();
    const y0 = +todayIso.slice(0, 4), m0 = +todayIso.slice(5, 7), d0 = +todayIso.slice(8, 10);
    const [y, mth] = m0 > 6 ? [y0, m0 - 6] : [y0 - 1, m0 + 6];
    const since = y + "-" + String(mth).padStart(2, "0") + "-" + String(Math.min(d0, monthDays(y, mth))).padStart(2, "0");
    const lots = fifoLots(transactions, symbol);
    if (!lots.length || !divRows || !divRows.length) return [0.0, 0];
    const first = lots[0][0];
    let total = 0, n = 0;
    for (const r of divRows) {
      if (!r.cash || r.ex <= first) continue;
      if (r.ex > todayIso || r.ex < since) continue;
      const got = lots.reduce((a, [d, q]) => a + (d < r.ex ? trunc(q * r.cash + 1e-9) : 0), 0);
      if (got) { total += got; n += 1; }
    }
    return [total, n];
  }
  function dividendPayout(shares, cash, settings) {
    const gross = trunc(shares * cash + 1e-9);
    if (gross <= 0) return [0, 0, 0, 0];
    const nhi = (settings.div_nhi !== false) && gross >= NHI_THRESHOLD ? pyRound(gross * NHI_RATE) : 0;
    const fee = Math.min(trunc(settings.div_fee === undefined ? 10 : settings.div_fee), gross - nhi);
    return [gross, nhi, fee, gross - nhi - fee];
  }

  // ---------- 配息分類 ----------
  function classifyDividends(events, todayIso) {
    todayIso = todayIso || today();
    const ev = events.filter(([, a]) => a && a > 0);
    const out = { freq: "不配息", months: [], last_date: "", last_amount: 0.0, ttm: 0.0, ttm_count: 0, per_month: {}, next_month: null, note: "" };
    if (!ev.length) { out.note = "近 5 年沒有配息紀錄"; return out; }
    const [lastD, lastA] = ev[ev.length - 1];
    out.last_date = lastD; out.last_amount = lastA;
    const t = dayNum(todayIso), yearAgo = t - 365;
    const ttm = ev.filter(([d]) => dayNum(d) > yearAgo);
    out.ttm = pyRound(ttm.reduce((a, [, x]) => a + x, 0), 4);
    out.ttm_count = ttm.length;
    if (t - dayNum(lastD) > 550) { out.freq = "不配息"; out.note = `最後一次除息 ${lastD}，之後沒有再配息`; return out; }
    const recent = ev.filter(([d]) => dayNum(d) > t - 3 * 365).map(([d]) => dayNum(d));
    const gaps = [];
    for (let i = 1; i < recent.length; i++) if (recent[i] - recent[i - 1] >= 10) gaps.push(recent[i] - recent[i - 1]);
    gaps.sort((a, b) => a - b);
    let freq;
    if (!gaps.length) { freq = "年配"; out.note = "近 3 年只配過 1 次，暫列年配"; }
    else {
      const g = gaps[Math.floor(gaps.length / 2)];
      freq = g < 45 ? "月配" : g < 75 ? "雙月配" : g < 135 ? "季配" : g < 270 ? "半年配" : g < 450 ? "年配" : "不定期";
    }
    out.freq = freq;
    const window = ["月配", "雙月配", "季配"].includes(freq) ? 400 : 730;
    let perMonth = {};
    for (const [d, a] of ev) if (dayNum(d) > t - window) perMonth[+d.slice(5, 7)] = a;
    if (freq === "月配" && Object.keys(perMonth).length) {
      const latest = ev[ev.length - 1][1], pm = {};
      for (let m = 1; m <= 12; m++) pm[m] = m in perMonth ? perMonth[m] : latest;
      perMonth = pm;
    }
    out.per_month = perMonth;
    out.months = Object.keys(perMonth).map(Number).sort((a, b) => a - b);
    if (out.months.length) {
      const ty = +todayIso.slice(0, 4), tm = +todayIso.slice(5, 7);
      const paid = ev.some(([d]) => +d.slice(0, 4) === ty && +d.slice(5, 7) === tm);
      const later = out.months.filter((m) => m > tm || (m === tm && !paid));
      out.next_month = later.length ? later[0] : out.months[0];
    }
    return out;
  }
  function freqText(info) {
    if (!info) return "—";
    if (info.freq === "不配息" && !info.last_date) return "無配息紀錄";
    return info.freq + (info.freq === "不定期" && info.months.length ? `（${info.months.length} 個月）` : "");
  }
  function monthsText(months) {
    if (!months || !months.length) return "—";
    if (months.length === 12) return "每月";
    return months.map((m) => m + "月").join("、");
  }
  function divLabel(info) {
    let t = freqText(info);
    if (info && !["月配", "不配息"].includes(info.freq) && info.months.length) t += "・" + monthsText(info.months);
    return t;
  }

  // ---------- 交易日曆 ----------
  const TYPHOON_CLOSED = new Set(["2024-07-24", "2024-07-25", "2024-10-02", "2024-10-03", "2024-10-31"]);
  const FALLBACK_CLOSED = new Set(["2024-01-01", "2024-02-08", "2024-02-09", "2024-02-12", "2024-02-13", "2024-02-14", "2024-02-28",
    "2024-04-04", "2024-04-05", "2024-06-10", "2024-09-17", "2024-10-10",
    "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31", "2025-02-28",
    "2025-04-03", "2025-04-04", "2025-05-30", "2025-09-29", "2025-10-06", "2025-10-10", "2025-10-24", "2025-12-25"]);
  const FALLBACK_YEARS = new Set([2024, 2025]);
  function parseHolidays(data, year) {
    if (data.stat !== "ok" || Number(data.queryYear || year) !== year) throw new Error(`證交所沒有 ${year} 年的休市表`);
    const closed = new Set(), settleOnly = new Set();
    for (const row of data.data || []) {
      const d = String(row[0]).trim(), name = row[1], desc = row.length > 2 ? row[2] : "", text = name + desc;
      if (text.includes("無交易") && text.includes("結算交割")) settleOnly.add(d);
      else if (name.includes("開始交易") || name.includes("最後交易")) continue;
      else closed.add(d);
    }
    return [closed, settleOnly];
  }
  class TradingCalendar {
    constructor() { this.closed = new Set(); this.settleOnly = new Set(); this.years = new Set(); this.fetched = {}; }
    load(o) {
      if (!o || typeof o.fetched !== "object") return;
      this.closed = new Set(o.closed || []); this.settleOnly = new Set(o.settle_only || []);
      this.fetched = {}; Object.keys(o.fetched).forEach((k) => { this.fetched[+k] = o.fetched[k]; });
      this.years = new Set(Object.keys(this.fetched).map(Number));
    }
    dump() { return { fetched: this.fetched, closed: [...this.closed].sort(), settle_only: [...this.settleOnly].sort() }; }
    missingYears(years) {
      const t = today(), ty = +t.slice(0, 4), tm = +t.slice(5, 7), out = new Set();
      years.forEach((y) => { if (!this.years.has(y) && y >= 1990 && y <= ty + 1) out.add(y); });
      for (const y of [ty, ty + 1]) {
        const got = this.fetched[y];
        if ((y === ty || tm === 12) && (!got || daysBetween(got, t) >= 7)) out.add(y);
      }
      return [...out].sort();
    }
    merge(year, closed, settleOnly) {
      this.closed = new Set([...this.closed].filter((d) => +d.slice(0, 4) !== year).concat([...closed]));
      this.settleOnly = new Set([...this.settleOnly].filter((d) => +d.slice(0, 4) !== year).concat([...settleOnly]));
      this.years.add(year); this.fetched[year] = today();
    }
    known(iso) { const y = +iso.slice(0, 4); return this.years.has(y) || FALLBACK_YEARS.has(y); }
    isClosed(iso) {
      if (TYPHOON_CLOSED.has(iso)) return true;
      if (this.years.has(+iso.slice(0, 4))) return this.closed.has(iso);
      return FALLBACK_CLOSED.has(iso);
    }
    isSettlementDay(iso) { return weekday(iso) < 5 && !this.isClosed(iso); }
    isTradingDay(iso) { return this.isSettlementDay(iso) && !this.settleOnly.has(iso); }
    settlementDate(tradeIso, n) {
      n = n === undefined ? 2 : n;
      let d = tradeIso, count = 0;
      while (count < n) { d = addDays(d, 1); if (this.isSettlementDay(d)) count++; }
      return d;
    }
    prevTradingDay(iso) {
      let d = iso;
      for (let i = 0; i < 30; i++) { d = addDays(d, -1); if (this.isTradingDay(d)) break; }
      return d;
    }
    nextTradingDays(baseIso, n) {
      n = n === undefined ? 2 : n;
      let d = baseIso; const out = [];
      while (out.length < n) { d = addDays(d, 1); if (this.isTradingDay(d)) out.push(d); }
      return out;
    }
  }
  const CALENDAR = new TradingCalendar();
  function lastClosedTradingDay() {
    const n = now();
    let d = n.date;
    if (!(CALENDAR.isTradingDay(d) && n.minutes >= hm(13, 35))) d = CALENDAR.prevTradingDay(d);
    return d;
  }
  function recentMissingDays(have, back) {
    back = back || 7;
    const last = lastClosedTradingDay(), out = [];
    for (let i = 0; i < back; i++) { const d = addDays(last, -i); if (CALENDAR.isTradingDay(d) && !have.has(d)) out.push(d); }
    return out.sort();
  }

  // ---------- 漲跌停 ----------
  function priceLimits(prev, etf) {
    const snap = (x, up) => { const t = tickSize(x, etf); const n = up ? Math.floor(x / t + 1e-9) : Math.ceil(x / t - 1e-9); return pyRound(n * t, 2); };
    return [snap(prev * 1.1, true), snap(prev * 0.9, false)];
  }
  function limitState(symbol, q) {
    const price = q.price, prev = q.prev;
    if (!price || !prev) return null;
    let up = q.limit_up, down = q.limit_down;
    if ((up === null || up === undefined) && (down === null || down === undefined) && !("limit_up" in q)) [up, down] = priceLimits(prev, isEtf(symbol));
    if (up && price >= up - 1e-6) return "up";
    if (down && price <= down + 1e-6) return "down";
    return null;
  }

  // ---------- 參考買賣點 ----------
  function tickRound(price, etf, up) {
    const t = tickSize(price, etf);
    let q = price / t;
    q = trunc(q) + (up && q !== trunc(q) ? 1 : 0);
    return pyRound(q * t, 2);
  }
  function computeTradeLevels(rows, symbol, ttm) {
    if (rows.length < 40) return null;
    const etf = isEtf(symbol || "");
    const hi = rows.map((r) => r[2]), lo = rows.map((r) => r[3]), cl = rows.map((r) => r[4]);
    const n = rows.length, price = cl[n - 1];
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const ma = (k) => (n >= k ? sum(cl.slice(-k)) / k : null);
    const ma20 = ma(20), ma60 = ma(60);
    const sd20 = ma20 ? Math.sqrt(sum(cl.slice(-20).map((x) => (x - ma20) ** 2)) / 20) : 0;
    const bbUp = ma20 + 2 * sd20, bbDn = ma20 - 2 * sd20;
    const trs = [];
    for (let i = 1; i < n; i++) trs.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1])));
    const atr = sum(trs.slice(-14)) / Math.min(14, trs.length);
    let g = 0, l = 0;
    for (let i = n - 14; i < n; i++) { g += Math.max(cl[i] - cl[i - 1], 0); l += Math.max(cl[i - 1] - cl[i], 0); }
    const rsi = g + l ? 100 * g / (g + l) : 50;
    const k = 5, pivLo = [], pivHi = [];
    for (let i = k; i < n - k; i++) {
      if (lo[i] === Math.min(...lo.slice(i - k, i + k + 1))) pivLo.push(lo[i]);
      if (hi[i] === Math.max(...hi.slice(i - k, i + k + 1))) pivHi.push(hi[i]);
    }
    const cluster = (vals) => {
      const zones = [];
      for (const v of vals.slice().sort((a, b) => a - b)) {
        if (zones.length && v <= zones[zones.length - 1][zones[zones.length - 1].length - 1] * 1.015) zones[zones.length - 1].push(v);
        else zones.push([v]);
      }
      return zones.map((z) => [sum(z) / z.length, z.length]);
    };
    const sup = cluster(pivLo).filter(([v]) => v < price * 0.995).sort((a, b) => b[0] - a[0]);
    const res = cluster(pivHi).filter(([v]) => v > price * 1.005).sort((a, b) => a[0] - b[0]);
    const buyC = [], sellC = [];
    sup.slice(0, 3).forEach(([v, c]) => buyC.push([v, `支撐（${c} 次轉折）`]));
    res.slice(0, 3).forEach(([v, c]) => sellC.push([v, `壓力（${c} 次轉折）`]));
    for (const [v, name] of [[ma20, "月線 MA20"], [ma60, "季線 MA60"]]) {
      if (v && v < price * 0.995) buyC.push([v, name]);
      else if (v && v > price * 1.005) sellC.push([v, name]);
    }
    if (bbDn < price) buyC.push([bbDn, "布林下軌"]);
    if (bbUp > price) sellC.push([bbUp, "布林上軌"]);
    const yld = {};
    if (ttm) {
      for (const pct of [6, 5, 4]) yld[pct] = ttm / (pct / 100);
      if (price * 0.7 <= yld[6] && yld[6] < price * 0.995) buyC.push([yld[6], "殖利率 6% 價"]);
      if (price * 1.005 < yld[4] && yld[4] <= price * 1.5) sellC.push([yld[4], "殖利率 4% 價"]);
    }
    const hi60 = Math.max(...hi.slice(-60)), lo60 = Math.min(...lo.slice(-60));
    if (!sellC.length) { sellC.push([price + 2 * atr, "股價＋2 倍 ATR（上方無壓力）"]); sellC.push([price + 4 * atr, "股價＋4 倍 ATR"]); }
    if (!buyC.length) buyC.push([price - 2 * atr, "股價－2 倍 ATR（下方無支撐）"]);
    const pick = (cands, below) => {
      const s = cands.map((c, i) => [c, i]).sort((a, b) => (below ? b[0][0] - a[0][0] : a[0][0] - b[0][0]) || a[1] - b[1]).map((x) => x[0]);
      const out = [];
      for (const [v, why] of s) {
        if (out.length && Math.abs(v - out[out.length - 1][0]) / out[out.length - 1][0] < 0.015) out[out.length - 1] = [out[out.length - 1][0], out[out.length - 1][1] + "、" + why];
        else out.push([v, why]);
      }
      return out.slice(0, 2);
    };
    const buys = pick(buyC, true).map(([v, why]) => [tickRound(v, etf), why]);
    const sells = pick(sellC, false).map(([v, why]) => [tickRound(v, etf, true), why]);
    const stop = tickRound(Math.min(...buys.map((b) => b[0])) - atr, etf);
    const yLo = Math.min(...lo), yHi = Math.max(...hi);
    const pos = yHi > yLo ? (price - yLo) / (yHi - yLo) * 100 : 50;
    const zone = price <= buys[0][0] * 1.01 ? "接近參考買點" : price >= sells[0][0] * 0.99 ? "接近參考賣點" : "介於買點與賣點之間";
    const last = rows[n - 1][0];
    return { price, buy: buys, sell: sells, stop, atr, rsi, ma20, ma60, bb_up: bbUp, bb_dn: bbDn, pos, zone, yld, hi60, lo60,
      date: typeof last === "string" ? last.slice(0, 10) : last.date };
  }

  // ---------- 下單 ----------
  const ORDER_SESSIONS = [["自動判斷（收盤後自動改預約單）", "auto"], ["整股（盤中）", "board"], ["盤中零股", "odd"],
    ["盤後零股（13:40–14:30）", "after_odd"], ["盤後定價（14:00–14:30，整股）", "after_fix"], ["預約單（下一個交易日開盤送出）", "reserve"]];
  const ORDER_STATUS = { 0: "傳輸中", 5: "預約單", 10: "委託失敗", 20: "委託成功", 24: "委託失效", 25: "價穩失效", 30: "取消成功" };
  const AP_NAMES = { 0: "整股", 2: "盤後零股", 4: "盤中零股", 7: "盤後定價" };
  const TIF_NAMES = { "0": "ROD", "3": "IOC", "4": "FOK" };
  function reserveTarget(n) {
    n = n || now();
    if (CALENDAR.isTradingDay(n.date) && n.minutes < hm(8, 30)) return n.date;
    return CALENDAR.nextTradingDays(n.date, 1)[0];
  }
  function resolveSession(session, shares, n) {
    n = n || now();
    if (session !== "auto") return session;
    const t = n.minutes, trading = CALENDAR.isTradingDay(n.date);
    if (trading && hm(8, 30) <= t && t <= hm(13, 30)) return "mixed";
    if (trading && hm(13, 40) <= t && t <= hm(14, 30)) return shares % 1000 === 0 ? "after_fix" : "after_odd";
    if (trading && hm(13, 30) < t && t < hm(13, 40)) return "mixed";
    return "reserve";
  }
  function buildOrders(symbol, side, shares, price, marketOrder, session, tif, n) {
    n = n || now();
    const t = n.minutes, errors = [], notes = [], out = [];
    if (shares <= 0) { errors.push("股數要大於 0"); return [out, errors, notes]; }
    if (!marketOrder && price <= 0) errors.push("請輸入委託價格");
    session = resolveSession(session, shares, n);
    const reserve = session === "reserve";
    const tradeDate = reserve ? reserveTarget(n) : n.date;
    if (reserve) {
      if (CALENDAR.isTradingDay(n.date) && hm(8, 30) <= t && t <= hm(14, 30)) errors.push("現在是交易時段，不能下預約單，請直接選「自動判斷」下單");
      session = "mixed";
    }
    const lots = Math.floor(shares / 1000), odd = shares % 1000;
    if (session === "mixed" || session === "board") {
      if (session === "board" && odd) errors.push("「整股」只能下 1,000 股的倍數；有零股請選「自動判斷」或「盤中零股」");
      if (lots) out.push({ apcode: 0, qty: lots, shares: lots * 1000, unit: "張" });
      if (odd && session === "mixed") out.push({ apcode: 4, qty: odd, shares: odd, unit: "股" });
    } else if (session === "odd") {
      out.push({ apcode: 4, qty: shares, shares, unit: "股" });
      if (lots) notes.push("盤中零股一次超過 999 股也可以，但整股市場通常價格較好");
    } else if (session === "after_odd") {
      if (lots) errors.push("盤後零股一次最多 999 股");
      out.push({ apcode: 2, qty: shares, shares, unit: "股" });
    } else if (session === "after_fix") {
      if (odd) errors.push("盤後定價只能下 1,000 股的倍數");
      out.push({ apcode: 7, qty: lots, shares: lots * 1000, unit: "張" });
    }
    for (const o of out) {
      const oddMkt = o.apcode === 2 || o.apcode === 4;
      Object.assign(o, { symbol, side, price: marketOrder && !oddMkt ? 0.0 : price, price_flag: marketOrder && !oddMkt ? "M" : " ",
        tif: o.apcode === 0 ? tif : "0" });
      if (marketOrder && oddMkt) errors.push("零股不能下市價單，請改用限價");
      if (o.apcode !== 0 && tif !== "0") notes.push(`${AP_NAMES[o.apcode]}只接受 ROD，已自動改成 ROD`);
      Object.assign(o, { reserve, trade_date: tradeDate });
      if (reserve && o.tif !== "0") { o.tif = "0"; notes.push("預約單只接受 ROD，已自動改成 ROD"); }
    }
    if (reserve) {
      notes.unshift(`預約單：會在 ${+tradeDate.slice(5, 7)}/${+tradeDate.slice(8, 10)}（${WEEKDAYS[weekday(tradeDate)]}）開盤時送進交易所；` +
        "元大受理預約約在收盤後到隔天 8:30，實際以元大回覆為準，送出後可在右邊查看或刪單");
    } else if (session === "mixed" && (t > hm(13, 30) || t < hm(8, 30))) notes.push("現在不是盤中交易時段，委託可能被拒絕");
    return [out, errors, notes];
  }
  function orderCost(orders, symbol, s, priceHint) {
    let amtT = 0, feeT = 0, taxT = 0;
    const rate = sellTaxRate(symbol);
    for (const o of orders) {
      const px = o.price || priceHint || 0, amt = trunc(o.shares * px + 1e-9), fee = calcFee(amt, o.shares, s), tax = o.side === "S" ? calcTax(amt, rate) : 0;
      Object.assign(o, { est_amount: amt, est_fee: fee, est_tax: tax });
      amtT += amt; feeT += fee; taxT += tax;
    }
    const side = orders.length ? orders[0].side : "B";
    return { amount: amtT, fee: feeT, tax: taxT, net: side === "B" ? amtT + feeT : amtT - feeT - taxT };
  }
  const maskAccount = (a) => { a = a || ""; return a.length > 8 ? a.slice(0, 5) + "***" + a.slice(-3) : a; };

  // ---------- 持股數值（同電腦版 holding_values）----------
  function holdingValues(sym, h, q, s, held) {
    q = q || {};
    const price = q.price, res = { price, prev: q.prev, mv: null, unreal: null, pct: null, day: null };
    if (price && h.shares) {
      const mv = trunc(price * h.shares + 0.5);
      let net = mv;
      if (s.unreal_deduct_cost) {
        const fee = (s.est_fee_mode || "broker") === "broker" ? Math.max(trunc(mv * FEE_RATE + 1e-9), 20) : calcFee(mv, h.shares, s);
        net -= fee + calcTax(mv, sellTaxRate(sym));
      }
      const exact = net - mv + price * h.shares;
      const un = pyRound(exact - h.cost);
      const [hd, hn] = held || [0, 0];
      const withDiv = s.pl_with_div !== false;
      const base = withDiv ? h.cost - hd : h.cost;
      const show = pyRound(exact - base);
      const sell = sellNowEstimate(sym, h.shares, price, s);
      Object.assign(res, { sell, sell_profit: sell.net - h.cost + (withDiv ? hd : 0), mv, unreal: show, exact_unreal: exact - base, raw_unreal: un,
        held_div: hd, held_div_n: hn, base_cost: base, pct: base > 0 ? (exact - base) / base * 100 : 0 });
      if (q.prev) res.day = (price - q.prev) * h.shares;
    }
    return res;
  }

  // ---------- 熱門／ETF ----------
  const HOT_RANKS = [["成交量", "-volume"], ["成交值", "-turnoverK"], ["漲幅", "-changePercent"], ["跌幅", "changePercent"], ["振幅", "-dayHighLowDiff"], ["股價最高", "-price"]];
  const ETF_TYPES = [["全部類型", null], ["股票型", ""], ["債券型（B）", "B"], ["主動式（A／D）", "AD"], ["槓桿／反向（L／R）", "LR"], ["期貨（U）", "U"]];
  const etfType = (code) => (code && /[A-Za-z]$/.test(code) ? code.slice(-1).toUpperCase() : "");
  function sortBoard(rows, sort, limit) {
    const keyf = {
      "-volume": (r) => r.volume || 0, "-turnoverK": (r) => r.turnover_k || 0,
      "-changePercent": (r) => (r.pct !== null && r.pct !== undefined ? r.pct : -1e9),
      "changePercent": (r) => -(r.pct !== null && r.pct !== undefined ? r.pct : 1e9),
      "-dayHighLowDiff": (r) => (r.prev ? ((r.high || 0) - (r.low || 0)) / r.prev : 0),
      "-price": (r) => r.price || 0,
    }[sort];
    let out = rows.map((r, i) => [r, i]).sort((a, b) => keyf(b[0]) - keyf(a[0]) || a[1] - b[1]).map((x) => x[0]);
    if (limit) out = out.slice(0, limit);
    out.forEach((r, i) => { r.rank = i + 1; });
    return out;
  }

  root.Core = {
    FEE_RATE, NHI_RATE, NHI_THRESHOLD, WEEKDAYS, FREQ_ORDER, DEFAULT_SETTINGS, NOW,
    pyRound, fixed, money, signed, f2, fnum, fnumSigned, twNow, now, today, hm, dayNum, isoOf, addDays, weekday, daysBetween, monthDays, shortDay, tsToTw,
    isEtf, isBondEtf, sellTaxRate, calcFee, tradeAmount, calcTax, tickSize, sellNowEstimate, trialSell, priceForReturn,
    computePortfolio, sharesBefore, fifoLots, heldPeriodDividends, dividendPayout,
    classifyDividends, freqText, monthsText, divLabel,
    parseHolidays, TradingCalendar, CALENDAR, lastClosedTradingDay, recentMissingDays,
    priceLimits, limitState, tickRound, computeTradeLevels,
    ORDER_SESSIONS, ORDER_STATUS, AP_NAMES, TIF_NAMES, reserveTarget, resolveSession, buildOrders, orderCost, maskAccount,
    holdingValues, HOT_RANKS, ETF_TYPES, etfType, sortBoard,
  };
})(typeof window !== "undefined" ? window : globalThis);
