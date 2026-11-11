/* 交叉比對：node xcheck.js cases.json —— 用網頁版 core.js / predict.js 重算 xcheck.py 的案例，逐項比對。 */
"use strict";
const fs = require("fs"), path = require("path");
require(path.join(__dirname, "..", "js", "core.js"));
require(path.join(__dirname, "..", "js", "predict.js"));
const C = globalThis.Core, P = globalThis.Predict;
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let checks = 0, fails = 0;
const close = (a, b, tol) => {
  if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) === (b === null || b === undefined);
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol) * Math.max(1, Math.abs(b));
  return a === b;
};
function deep(a, b, tol, where) {
  if (Array.isArray(b)) {
    if (!Array.isArray(a) || a.length !== b.length) return where + " 長度不同 " + JSON.stringify(a).slice(0, 200) + " vs " + JSON.stringify(b).slice(0, 200);
    for (let i = 0; i < b.length; i++) { const r = deep(a[i], b[i], tol, where + "[" + i + "]"); if (r) return r; }
    return "";
  }
  if (b && typeof b === "object") {
    for (const k of Object.keys(b)) { const r = deep(a ? a[k] : undefined, b[k], tol, where + "." + k); if (r) return r; }
    return "";
  }
  return close(a, b, tol) ? "" : where + "：網頁 " + JSON.stringify(a) + " ≠ 電腦 " + JSON.stringify(b);
}
function check(name, a, b, tol) {
  checks++;
  const r = deep(a, b, tol, name);
  if (r) { fails++; if (fails <= 40) console.log("✖", r); }
}

// 交易日曆用電腦版同一份休市表
C.CALENDAR.load(cases.holidays);
const tw = (d, h, mi) => ({ date: d, hh: h, mm: mi, ss: 0, minutes: h * 60 + mi, weekday: C.weekday(d), time: "" });

cases.fee.forEach((c, i) => { check("fee" + i, [C.calcFee(c.amt, c.sh, c.s), C.calcTax(c.amt, 0.003), C.calcTax(c.amt, 0.001)], [c.fee, c.tax3, c.tax1]); });
C.NOW.fn = () => tw("2026-11-11", 10, 0);
cases.sell_now.forEach((c, i) => check("sell_now" + i, C.sellNowEstimate(c.sym, c.sh, c.px, c.s), c.out));
cases.price_for_return.forEach((c, i) => check("pfr" + i, C.priceForReturn(c.bp, c.sh, c.etf, c.rate, c.s, c.tgt), c.out));
cases.portfolio.forEach((c, i) => {
  const r = C.computePortfolio(c.txs, c.divs);
  check("port" + i + ".h", r.holdings, c.h, 1e-9);
  check("port" + i + ".r", r.realized, c.r, 1e-9);
  check("port" + i + ".e", r.errors, c.e);
});
const real = cases.portfolio[0];
cases.held.forEach((c, i) => {
  if (c.lots) check("lots" + c.sym, C.fifoLots(real.txs, c.sym), c.lots);
  else check("held" + c.sym + c.today, C.heldPeriodDividends(real.txs, real.divs, c.sym, cases.cashdiv[c.sym] || [], {}, c.today), c.out);
});
cases.classify.forEach((c, i) => {
  const o = C.classifyDividends(c.events, c.today);
  const want = Object.assign({}, c.out, { per_month: Object.fromEntries(Object.entries(c.out.per_month).map(([k, v]) => [String(k), v])) });
  check("classify" + c.sym + c.today, o, want);
  check("divlabel" + c.sym + c.today, C.divLabel(o), c.label);
});
cases.payout.forEach((c, i) => check("payout" + i, C.dividendPayout(c.sh, c.cash, c.s), c.out));
cases.calendar.forEach((c) => {
  const [iso, trading, settle, prev, next] = c;
  check("cal" + iso, [C.CALENDAR.isTradingDay(iso), C.CALENDAR.settlementDate(iso), C.CALENDAR.prevTradingDay(iso), C.CALENDAR.nextTradingDays(iso, 2)], [trading, settle, prev, next]);
});
cases.limits.forEach((c, i) => check("lim" + i, C.priceLimits(c.prev, c.etf), c.out));
cases.levels.forEach((c, i) => {
  const o = C.computeTradeLevels(c.rows, c.sym, c.ttm);
  const want = c.out ? Object.assign({}, c.out, { yld: Object.fromEntries(Object.entries(c.out.yld || {}).map(([k, v]) => [String(k), v])) }) : null;
  check("levels" + c.sym + i, o, want, 1e-9);
});
cases.build_orders.forEach((c, i) => {
  const n = tw(c.now[0], c.now[1], c.now[2]);
  const [o, e, nt] = C.buildOrders("00900", c.side, c.sh, c.px, c.mk, c.sess, c.tif, n);
  check("orders" + i, { orders: o, errors: e, notes: nt }, { orders: c.orders, errors: c.errors, notes: c.notes });
  check("ocost" + i, C.orderCost(o.map((x) => Object.assign({}, x)), "00900", { fee_discount: 6, min_fee: 20, min_fee_odd: 1 }, 19.5), c.cost);
});
cases.holding_values.forEach((c, i) => {
  const o = C.holdingValues(c.sym, c.h, { price: c.px, prev: c.prev }, c.s, c.held);
  check("hv" + i, { mv: o.mv, unreal: o.unreal, raw_unreal: o.raw_unreal, pct: o.pct, sell_profit: o.sell_profit }, c.out, 1e-9);
});
cases.format.forEach((c, i) => check("fmt" + i, [C.money(c.x), C.money(c.x, 2), C.signed(c.x), C.signed(c.x, 2), C.pyRound(c.x), C.pyRound(c.x, 2)],
  [c.money0, c.money2, c.signed0, c.signed2, c.r0, c.r2]));
cases.predict.forEach((c) => {
  const t0 = Date.now();
  const o = P.predictSymbol(c.rows, P.indexFeatureMap(c.idx));
  const want = JSON.parse(JSON.stringify(c.out));
  const got = JSON.parse(JSON.stringify(o));
  check("predict" + c.sym + ".horizons", got.horizons, want.horizons, 1e-5);
  check("predict" + c.sym + ".signals", got.signals, want.signals, 1e-6);
  check("predict" + c.sym + ".stats", got.signal_stats, want.signal_stats, 1e-9);
  check("predict" + c.sym + ".base", [got.base_date, got.targets, got.n_days], [want.base_date, want.targets, want.n_days]);
  let tk = 0, tkBad = 0;
  for (const d of Object.keys(want.track)) { tk++; if (!close(got.track[d] && got.track[d][0], want.track[d][0], 1e-5)) tkBad++; }
  check("predict" + c.sym + ".track", tkBad, 0);
  console.log("  預測 " + c.sym + "：" + ((Date.now() - t0) / 1000).toFixed(1) + " 秒，回測 " + tk + " 天");
});
console.log(`比對 ${checks} 項，不一致 ${fails} 項`);
process.exit(fails ? 1 : 0);
