"""產生交叉比對案例：用電腦版 stock_app.py 算出答案，xcheck.js 用網頁版 core.js 重算比對。
用法：python xcheck.py <資料資料夾(有 data.json 等)> <輸出 cases.json>
需要網路（下載幾檔股票的日 K 做預測與買賣點比對）。"""
import json, os, random, sys
from datetime import date, datetime, timedelta

data_dir, out_path = sys.argv[1], sys.argv[2]
os.environ["STOCKCALC_DATA"] = data_dir
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
import stock_app as m  # noqa: E402

random.seed(7)
cases = {}
S1 = dict(m.DEFAULT_SETTINGS, fee_discount=6.0, min_fee=20, min_fee_odd=1)
S2 = dict(m.DEFAULT_SETTINGS)

# 1. 手續費、稅、試算
fee = []
for _ in range(3000):
    amt = random.choice([random.randint(1, 5000), random.randint(1, 3_000_000), random.randint(0, 200)])
    sh = random.choice([random.randint(1, 999), random.randint(1, 9) * 1000, random.randint(1, 5000)])
    s = random.choice([S1, S2, dict(S1, fee_discount=2.8)])
    fee.append(dict(amt=amt, sh=sh, s=s, fee=m.calc_fee(amt, sh, s), tax3=m.calc_tax(amt, 0.003), tax1=m.calc_tax(amt, 0.001)))
cases["fee"] = fee
syms = ["00900", "2330", "00679B", "0056", "3529", "1101"]
sne = []
for _ in range(1500):
    sym, sh = random.choice(syms), random.randint(1, 12000)
    px = round(random.uniform(5, 3000), 2)
    s = random.choice([S1, S2])
    sne.append(dict(sym=sym, sh=sh, px=px, s=s, out=m.sell_now_estimate(sym, sh, px, s)))
cases["sell_now"] = sne
pfr = []
for _ in range(300):
    sym = random.choice(syms); etf = m.is_etf(sym)
    bp, sh, tgt = round(random.uniform(8, 900), 2), random.choice([1, 50, 1000, 2000, 333]), random.choice([0, 5, 10, -3])
    rate = m.sell_tax_rate(sym, "2026-11-11")
    pfr.append(dict(bp=bp, sh=sh, etf=etf, rate=rate, s=S1, tgt=tgt, out=m.price_for_return(bp, sh, etf, rate, S1, tgt)))
cases["price_for_return"] = pfr

# 2. 持股：使用者真實資料＋隨機
with open(os.path.join(data_dir, "data.json"), encoding="utf-8") as f:
    real = json.load(f)
port = []
def run_port(txs, divs):
    h, r, e = m.compute_portfolio(txs, divs)
    return dict(txs=txs, divs=divs, h=h, r=r, e=e)
port.append(run_port(real["transactions"], real["dividends"]))
for _ in range(200):
    txs, d0 = [], date(2024, 1, 1)
    for i in range(random.randint(1, 40)):
        sym = random.choice(syms[:3]); d = (d0 + timedelta(days=random.randint(0, 900))).isoformat()
        sh, px = random.choice([random.randint(1, 600), 1000, 2000]), round(random.uniform(10, 60), 2)
        typ = random.choice(["buy", "buy", "sell"])
        txs.append(dict(id=f"x{i}", date=d, symbol=sym, name=sym, type=typ, shares=sh, price=px,
                        fee=random.randint(1, 40), tax=random.randint(0, 30) if typ == "sell" else 0))
    divs = [dict(id=f"d{i}", date=(d0 + timedelta(days=random.randint(0, 900))).isoformat(), symbol=random.choice(syms[:3]),
                 cash=random.randint(0, 500), stock_shares=random.choice([0, 0, 0, 10])) for i in range(random.randint(0, 5))]
    port.append(run_port(txs, divs))
cases["portfolio"] = port

# 3. 配息：快取的股利資料
with open(os.path.join(data_dir, "cash_dividends.json"), encoding="utf-8") as f:
    cashdiv = json.load(f)
with open(os.path.join(data_dir, "dividend_history.json"), encoding="utf-8") as f:
    divhist = json.load(f)
held = []
for sym in ["00900", "00918", "00919", "00929"]:
    rows = cashdiv.get(sym, {}).get("rows", [])
    for t in ["2026-10-21", "2026-11-11", "2026-04-30", "2026-08-31", "2026-12-31"]:
        held.append(dict(sym=sym, today=t, out=list(m.held_period_dividends(real["transactions"], real["dividends"], sym, rows, S1, t))))
    held.append(dict(sym=sym, lots=m.fifo_lots(real["transactions"], sym)))
cases["held"] = held
cases["cashdiv"] = {k: v.get("rows", []) for k, v in cashdiv.items()}
cls = []
for sym, v in divhist.items():
    ev = v.get("events", [])
    for t in ["2026-11-11", "2026-01-15", "2025-06-30"]:
        cls.append(dict(sym=sym, events=ev, today=t, out=m.classify_dividends(ev, date.fromisoformat(t))))
cases["classify"] = cls
for c in cls:
    c["label"] = m.div_label(c["out"])
pay = []
for _ in range(500):
    sh, cash = random.randint(1, 200000), round(random.uniform(0.01, 5), 4)
    s = random.choice([S1, dict(S1, div_nhi=False, div_fee=0)])
    pay.append(dict(sh=sh, cash=cash, s=s, out=list(m.dividend_payout(sh, cash, s))))
cases["payout"] = pay

# 4. 交易日曆
with open(os.path.join(data_dir, "holidays.json"), encoding="utf-8") as f:
    hol = json.load(f)
cal = []
d = date(2024, 1, 1)
while d <= date(2026, 12, 31):
    iso = d.isoformat()
    cal.append([iso, m.CALENDAR.is_trading_day(iso), m.CALENDAR.settlement_date(iso), m.CALENDAR.prev_trading_day(iso),
                m.CALENDAR.next_trading_days(iso, 2)])
    d += timedelta(days=1)
cases["holidays"] = hol
cases["calendar"] = cal

# 5. 漲跌停、買賣點
lim = []
for _ in range(3000):
    prev = round(random.uniform(1, 3000), 2); sym = random.choice(syms)
    lim.append(dict(prev=prev, etf=m.is_etf(sym), out=list(m.price_limits(prev, m.is_etf(sym)))))
cases["limits"] = lim
lv = []
for sym in ["00900", "2330", "0056", "00679B", "1101", "3529"]:
    try:
        rows = m.fetch_chart(sym, None, "1y", "1d")["rows"]
    except Exception as ex:
        print("skip", sym, ex); continue
    rr = [[r[0].date().isoformat(), r[1], r[2], r[3], r[4], r[5]] for r in rows]
    for cut in (0, 20, 60):
        sub = rows[:len(rows) - cut]
        for ttm in (None, 1.2, 24.0):
            out = m.compute_trade_levels(sub, sym, ttm)
            lv.append(dict(sym=sym, rows=rr[:len(rr) - cut], ttm=ttm, out=out))
cases["levels"] = lv

# 6. 下單拆單
TZ = m.TW_TZ
bo = []
for _ in range(1500):
    dd = date(2026, 10, random.randint(1, 31))
    now = datetime(dd.year, dd.month, dd.day, random.randint(6, 22), random.choice([0, 15, 29, 30, 31, 39, 40, 45]), tzinfo=TZ)
    sess = random.choice(["auto", "board", "odd", "after_odd", "after_fix", "reserve"])
    sh = random.choice([0, 50, 999, 1000, 1270, 3000, 2500])
    px = random.choice([0, 19.7, 2400.0])
    mk = random.random() < 0.2
    tif = random.choice(["0", "3", "4"])
    o, e, n = m.build_orders("00900", random.choice("BS"), sh, px, mk, sess, tif, now=now)
    side = o[0]["side"] if o else "B"
    cost = m.order_cost([dict(x) for x in o], "00900", S1, 19.5)
    bo.append(dict(now=[now.date().isoformat(), now.hour, now.minute], sess=sess, sh=sh, px=px, mk=mk, tif=tif, side=side,
                   orders=o, errors=e, notes=n, cost=cost))
cases["build_orders"] = bo

# 7. 持股數值（holding_values 的公式）
hv = []
h, _, _ = m.compute_portfolio(real["transactions"], real["dividends"])
for sym, hh in h.items():
    if hh["shares"] <= 0:
        continue
    for px in (19.74, 30.12, 34.59, 29.34, 18.0):
        for wd in (True, False):
            for mode in ("broker", "mine"):
                s = dict(S1, pl_with_div=wd, est_fee_mode=mode)
                held_ = (447.0, 6) if wd else (0.0, 0)
                # 直接重現 MainWindow.holding_values 的公式
                mv = int(px * hh["shares"] + 0.5); net = mv
                fee_ = max(int(mv * m.FEE_RATE + 1e-9), 20) if mode == "broker" else m.calc_fee(mv, hh["shares"], s)
                net -= fee_ + m.calc_tax(mv, m.sell_tax_rate(sym))
                exact = net - mv + px * hh["shares"]
                base = hh["cost"] - held_[0] if wd else hh["cost"]
                sell = m.sell_now_estimate(sym, hh["shares"], px, s)
                hv.append(dict(sym=sym, h=hh, px=px, prev=px - 0.2, s=s, held=list(held_),
                               out=dict(mv=mv, unreal=round(exact - base), raw_unreal=round(exact - hh["cost"]),
                                        pct=(exact - base) / base * 100 if base > 0 else 0,
                                        sell_profit=sell["net"] - hh["cost"] + (held_[0] if wd else 0))))
cases["holding_values"] = hv

# 8. 格式
fm = []
for _ in range(3000):
    x = random.choice([random.uniform(-1e7, 1e7), random.randint(-100000, 100000) + 0.5, random.randint(-999, 999) / 8, 0.0])
    fm.append(dict(x=x, money0=m.money(x), money2=m.money(x, 2), signed0=m.signed(x), signed2=m.signed(x, 2), r0=round(x), r2=round(x, 2)))
cases["format"] = fm

# 9. 預測模型（真實 5 年日 K）
pred = []
try:
    idx = m.yahoo_history("^TWII")
    imap = m.index_feature_map(idx)
    for sym in ["00900", "2330"]:
        rows = m.yahoo_history(sym)
        res = m.predict_symbol(rows, imap)
        pred.append(dict(sym=sym, rows=[list(r) for r in rows], idx=[list(r) for r in idx], out=res))
except Exception as ex:
    print("predict skip", ex)
cases["predict"] = pred

def default(o):
    if isinstance(o, (set, tuple)):
        return list(o)
    if hasattr(o, "item"):
        return o.item()
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    raise TypeError(type(o))
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(cases, f, ensure_ascii=False, default=default)
print("cases:", {k: len(v) for k, v in cases.items()})
