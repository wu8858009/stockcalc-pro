/* 走勢圖（對照電腦版 ChartWidget、ChartPage）：K 線／走勢線、均線、成交量、十字游標、買賣標記、成本線、
   目標價線、參考買賣點、模型預測（右側明天／後天、過去每天看漲看跌底色）。用 canvas 自己畫。 */
(function () {
  "use strict";
  const C = window.Core, M = window.Market, P = window.Predict, U = window.UI, T = window.CONTENT;
  const el = U.el;
  const g = (x) => String(Number(Number(x).toPrecision(6)));
  const CHART_RANGES = [["分時", "1d", "1m"], ["5日", "5d", "5m"], ["1月", "1mo", "1d"], ["3月", "3mo", "1d"],
    ["6月", "6mo", "1d"], ["1年", "1y", "1d"], ["3年", "3y", "1wk"], ["5年", "5y", "1wk"]];
  const MA_COLORS = { 5: "#f5a524", 20: "#c084fc", 60: "#38bdf8" };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
  const TH = () => ({ GAIN: css("GAIN"), LOSS: css("LOSS"), MUTED: css("MUTED"), TEXT: css("TEXT"), GRID: css("GRID"), BORDER: css("BORDER"),
    BORDER2: css("BORDER2"), SURFACE: css("SURFACE"), SURFACE2: css("SURFACE2"), ACCENT_TEXT: css("ACCENT_TEXT"), WARN: css("WARN"),
    SELECT: css("SELECT"), DISABLED: css("DISABLED") });
  const alpha = (hex, a) => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a / 255})`;
  };
  const lightness = (hex) => {
    const h = hex.replace("#", ""), n = parseInt(h, 16);
    const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
    return (Math.max(r, gg, b) + Math.min(r, gg, b)) / 2;
  };
  const fmtDT = (s, f) => {             // s = "YYYY-MM-DD HH:MM:SS"
    const Y = s.slice(0, 4), Mo = s.slice(5, 7), D = s.slice(8, 10), hm = s.slice(11, 16);
    return { "%H:%M": hm, "%m/%d %H:%M": `${Mo}/${D} ${hm}`, "%Y/%m": `${Y}/${Mo}`, "%m/%d": `${Mo}/${D}`, "%Y-%m-%d %H:%M": `${Y}-${Mo}-${D} ${hm}`, "%Y-%m-%d": `${Y}-${Mo}-${D}` }[f];
  };
  const FONT = '"Segoe UI", "Microsoft JhengHei UI", "Microsoft JhengHei", "PingFang TC", sans-serif';

  // ================= 圖 =================
  class ChartWidget {
    constructor() {
      this.page = null;
      this.rows = []; this.prev = null; this.intraday = false;
      this.mode = "K"; this.mas = [5, 20, 60];
      this.markers = []; this.cost = null; this.targets = [];
      this.message = "在上方選一檔股票";
      this.hover = null; this.mouseY = null;
      this.pred = null; this.showPred = true; this.levels = []; this.rangeLabel = "";
      this.canvas = el("canvas", { tabindex: "0" });
      this.el = el("div", { cls: "chartBox" }, this.canvas);
      this.tip = null;
      this.canvas.addEventListener("mousemove", (e) => this.mouseMove(e));
      this.canvas.addEventListener("mouseleave", () => { this.hover = null; this.hideTip(); this.update(); });
      this.canvas.addEventListener("mousedown", () => this.canvas.focus());
      this.canvas.addEventListener("keydown", (e) => this.keyPress(e));
      // 手機：手指拖曳也能看十字線
      this.canvas.addEventListener("touchmove", (e) => { const t = e.touches[0]; if (t) { e.preventDefault(); this.mouseMove(t); } }, { passive: false });
      this.canvas.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t) this.mouseMove(t); }, { passive: true });
      new ResizeObserver(() => this.update()).observe(this.el);
    }
    setData(rows, prev, intraday, mode, mas, markers, cost, targets, rangeLabel) {
      Object.assign(this, { rows, prev, intraday, mode, mas, markers, cost, targets, rangeLabel });
      this.hover = null;
      this.message = rows.length ? "" : "沒有資料";
      this.update();
    }
    setLevels(lv) { this.levels = lv || []; this.update(); }
    setPrediction(pred, show) { this.pred = pred; this.showPred = show; this.update(); }
    future() { return !!(this.showPred && this.pred && this.rows.length && !this.intraday && this.rangeLabel !== "5日"); }
    dayWords() { return this.pred && this.pred.base_date === C.lastClosedTradingDay() ? ["明天", "後天"] : ["第1日", "第2日"]; }
    predTooltip() {
      const pr = this.pred, h = pr.horizons || {}, tg = pr.targets || [], words = this.dayWords(), th = TH();
      const lines = ["<b>模型預測怎麼來的</b>",
        `依據：${pr.base_date || ""} 收盤價 ${C.money(pr.close || 0, 2)}（用近 5 年、${C.money(pr.n_days || 0)} 個交易日訓練）`];
      for (const k of [1, 2]) {
        const x = h[k];
        if (!x) continue;
        const d = tg.length >= k ? tg[k - 1] : "";
        lines.push(`<b>${words[k - 1]} ${d}：上漲機率 ${C.fixed(x.p * 100, 0)}%</b>　＝ ${d} 收盤價高於 ${pr.base_date || ""} 收盤價的機率` +
          `（模型原始 ${C.fixed(x.p_raw * 100, 0)}%，經回測校正）；回測準確率 ${C.fixed(x.acc * 100, 1)}%，每天都猜多數方向 ${C.fixed(x.baseline * 100, 1)}%`);
      }
      lines.push("<b>計算方式</b>：用這檔股票近 5 年日 K 的 19 個技術指標（1~20 日漲跌、距 5/10/20/60 日線、RSI、KD、量比、20 日波動、收盤在當日高低的位置、開盤跳空、大盤 1/5 日漲跌與距月線）訓練羅吉斯迴歸模型。",
        "<b>校正</b>：用「滾動回測」（每次只用當時已知的資料預測下一段）檢查模型準不準；模型沒把握時，機率會自動往這檔股票歷史上漲比例靠攏。",
        "<b>「後天」</b>是和依據日收盤比，不是和明天比。日期已跳過週末與休市日。",
        "<b>箭頭</b>：▲ 紅＝上漲機率 ≥ 55%，▼ 綠＝≤ 45%，－ 灰＝介於中間（方向不明）。",
        `<span style='color:${th.MUTED}'>短期股價接近隨機，請只當參考。</span>`);
      return lines.join("<br>");
    }
    futureW() { return Math.round(Math.min(ChartWidget.FUTURE_W, Math.max(84, this.size()[0] * 0.26))); }   // 手機窄螢幕縮小預測欄
    barsRight(right) { return this.future() ? right - this.futureW() : right; }
    trackFor(j) {
      if (!(this.showPred && this.pred && j > 0) || ["3年", "5年", "5日"].includes(this.rangeLabel) || this.intraday) return null;
      return (this.pred.track || {})[this.rows[j - 1][0].slice(0, 10)] || null;
    }
    showMessage(msg) { this.rows = []; this.message = msg; this.update(); }
    size() { const r = this.el.getBoundingClientRect(); return [Math.max(200, r.width), Math.max(260, r.height)]; }
    layout() {
      const [W, H] = this.size();
      const left = 14, right = W - 78, top = 40, bottom = H - 30, pb = top + (bottom - top) * 0.74;
      return [left, right, top, bottom, pb, pb + 10];
    }
    ma(n) {
      const out = []; let acc = 0;
      this.rows.forEach((r, i) => { acc += r[4]; if (i >= n) acc -= this.rows[i - n][4]; out.push(i >= n - 1 ? acc / n : null); });
      return out;
    }
    mouseMove(e) {
      if (!this.rows.length) return;
      const rc = this.canvas.getBoundingClientRect(), x = e.clientX - rc.left;
      const [left, right] = this.layout(), rb = this.barsRight(right);
      const step = (rb - left) / this.rows.length;
      const i = Math.floor((x - left) / step);
      this.hover = left <= x && x <= rb ? Math.min(Math.max(i, 0), this.rows.length - 1) : null;
      if (this.future() && x > rb) this.showTip(this.predTooltip(), e.clientX, e.clientY); else this.hideTip();
      this.mouseY = e.clientY - rc.top;
      this.update();
    }
    showTip(html, x, y) {
      const box = document.getElementById("tip");
      if (!box) return;
      box.innerHTML = html; box.classList.remove("hidden");
      const w = box.offsetWidth, h = box.offsetHeight;
      let tx = x + 14, ty = y + 18;
      if (tx + w > innerWidth - 8) tx = Math.max(8, x - w - 10);
      if (ty + h > innerHeight - 8) ty = Math.max(8, y - h - 10);
      box.style.left = tx + "px"; box.style.top = ty + "px";
      this.tip = true;
    }
    hideTip() { if (this.tip) { U.hideTip(); this.tip = null; } }
    keyPress(e) {
      const n = this.rows.length, k = e.key;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (n && ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(k)) {
        e.preventDefault();
        let i = this.hover !== null ? this.hover : n - 1;
        const step = k === "PageUp" || k === "PageDown" ? 10 : 1;
        i = k === "Home" ? 0 : k === "End" ? n - 1 : (k === "ArrowLeft" || k === "PageUp") ? i - step : i + step;
        this.hover = Math.min(Math.max(i, 0), n - 1); this.mouseY = null; this.update();
        return;
      }
      if (k === "Escape") { this.hover = null; this.update(); return; }
      const p = this.page;
      if (!p) return;
      const kk = k.toLowerCase();
      if (k >= "1" && k <= "8") { e.preventDefault(); p.setRange(+k - 1); }
      else if (kk === "k") p.setMode("K");
      else if (kk === "l") p.setMode("L");
      else if (kk === "p") { p.chkPred.input.checked = !p.chkPred.input.checked; p.togglePred(p.chkPred.input.checked); }
      else if (kk === "b") { p.chkLv.input.checked = !p.chkLv.input.checked; p.toggleLv(p.chkLv.input.checked); }
      else if (kk === "i") p.openDetail();
    }
    update() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); }); }

    paint() {
      const [W, H] = this.size(), dpr = window.devicePixelRatio || 1;
      const cv = this.canvas;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      cv.style.width = W + "px"; cv.style.height = H + "px";
      const p = cv.getContext("2d");
      p.setTransform(dpr, 0, 0, dpr, 0, 0);
      p.clearRect(0, 0, W, H);
      const th = TH();
      const small = `11.3px ${FONT}`, normal = `13px ${FONT}`;
      // 外框
      p.fillStyle = th.SURFACE; p.strokeStyle = th.BORDER; p.lineWidth = 1;
      roundRect(p, 0.5, 0.5, W - 1, H - 1, 10); p.fill(); p.stroke();
      p.textBaseline = "middle";
      if (!this.rows.length) {
        p.fillStyle = th.MUTED; p.font = normal; p.textAlign = "center";
        p.fillText(this.message, W / 2, H / 2);
        return;
      }
      const [left, right, top, bottom, pb, vt] = this.layout();
      const rows = this.rows, n = rows.length, future = this.future(), rb = this.barsRight(right);
      const step = (rb - left) / n;
      const xs = rows.map((_r, i) => left + step * (i + 0.5));
      const mas = {};
      if (!this.intraday) this.mas.forEach((k) => { mas[k] = this.ma(k); });
      let vals = rows.map((r) => r[2]).concat(rows.map((r) => r[3]));
      Object.values(mas).forEach((a) => a.forEach((v) => { if (v !== null) vals.push(v); }));
      if (this.intraday && this.prev) vals.push(this.prev);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      const extra = [this.cost].concat(this.targets.map((t) => t[1])).concat(this.levels.map((l) => l[1])).filter((x) => x);
      for (const x of extra) if (lo * 0.8 <= x && x <= hi * 1.2) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
      const pad = (hi - lo) * 0.07 || hi * 0.01 || 1;
      lo -= pad; hi += pad;
      const y = (v) => pb - (v - lo) / (hi - lo) * (pb - top);
      const line = (x1, y1, x2, y2) => { p.beginPath(); p.moveTo(x1, y1); p.lineTo(x2, y2); p.stroke(); };
      const text = (t, cx, cy, align) => { p.textAlign = align || "center"; p.fillText(t, cx, cy); };

      // 格線與價格刻度
      p.font = small;
      for (let k = 0; k < 6; k++) {
        const v = lo + (hi - lo) * k / 5, yy = y(v);
        p.strokeStyle = th.GRID; p.lineWidth = 1; p.setLineDash([]);
        line(left, yy, right, yy);
        p.fillStyle = th.MUTED; text(C.money(v, 2), right + 6, yy, "left");
      }
      // 時間刻度
      const fmt = this.rangeLabel === "分時" ? "%H:%M" : this.rangeLabel === "5日" ? "%m/%d %H:%M" : ["3年", "5年"].includes(this.rangeLabel) ? "%Y/%m" : "%m/%d";
      for (let k = 0; k < 6; k++) {
        const i = Math.round((n - 1) * k / 5);
        p.fillStyle = th.MUTED; text(fmtDT(rows[i][0], fmt), xs[i], bottom + 14);
      }
      const up = th.GAIN, dn = th.LOSS;
      // 模型過去的判斷底色
      for (let j = 1; j < n; j++) {
        const tr = this.trackFor(j);
        if (!tr) continue;
        if (tr[0] >= 0.55 || tr[0] <= 0.45) { p.fillStyle = alpha(tr[0] >= 0.55 ? up : dn, 26); p.fillRect(xs[j] - step / 2, top, step, pb - top); }
      }
      // 參考線
      const DASH = [5, 4], DOT = [1.5, 3], DASHDOT = [7, 3, 1.5, 3];
      const hline = (v, color, label, dash) => {
        if (v === null || v === undefined || !(lo <= v && v <= hi)) return;
        const yy = y(v);
        p.strokeStyle = color; p.lineWidth = 1.2; p.setLineDash(dash || DASH);
        line(left, yy, right, yy); p.setLineDash([]);
        p.fillStyle = color; roundRect(p, right + 2, yy - 9, 74, 18, 4); p.fill();
        p.fillStyle = color.startsWith("#") && lightness(color) > 120 ? "#0d1117" : th.TEXT;
        p.font = small; text(label, right + 39, yy);
      };
      if (this.intraday && this.prev) hline(this.prev, th.BORDER2, `昨收 ${g(this.prev)}`, DOT);
      if (this.cost) hline(this.cost, th.ACCENT_TEXT, `成本 ${C.money(this.cost, 2)}`);
      this.targets.forEach(([label, v]) => hline(v, th.WARN, `${label} ${g(v)}`));
      this.levels.forEach(([label, v, col]) => hline(v, col, `${label} ${g(v)}`, DASHDOT));

      // 主圖
      const closes = rows.map((r) => r[4]);
      const lineMode = this.intraday || this.mode === "L";
      if (lineMode) {
        const base = this.intraday && this.prev ? this.prev : closes[0];
        const col = closes[n - 1] >= base ? up : dn;
        p.beginPath(); p.moveTo(xs[0], y(closes[0]));
        for (let i = 1; i < n; i++) p.lineTo(xs[i], y(closes[i]));
        const path = new Path2D(); path.moveTo(xs[0], y(closes[0])); for (let i = 1; i < n; i++) path.lineTo(xs[i], y(closes[i]));
        const fill = new Path2D(path); fill.lineTo(xs[n - 1], pb); fill.lineTo(xs[0], pb); fill.closePath();
        const gr = p.createLinearGradient(0, top, 0, pb); gr.addColorStop(0, alpha(col, 90)); gr.addColorStop(1, alpha(col, 0));
        p.fillStyle = gr; p.fill(fill);
        p.strokeStyle = col; p.lineWidth = 2; p.setLineDash([]); p.lineJoin = "round"; p.stroke(path);
      } else {
        const bw = Math.max(1, step * 0.62);
        rows.forEach(([, o, h, l, c], i) => {
          const col = c >= o ? up : dn, x = xs[i];
          p.strokeStyle = col; p.lineWidth = 1; line(x, y(h), x, y(l));
          const ty = y(Math.max(o, c)), by = y(Math.min(o, c));
          p.fillStyle = col; p.fillRect(x - bw / 2, ty, bw, Math.max(1, by - ty));
        });
      }
      // 均線
      for (const k of Object.keys(mas)) {
        p.beginPath(); let started = false;
        mas[k].forEach((v, i) => { if (v === null) return; if (!started) { p.moveTo(xs[i], y(v)); started = true; } else p.lineTo(xs[i], y(v)); });
        if (started) { p.strokeStyle = MA_COLORS[k]; p.lineWidth = 1.4; p.stroke(); }
      }
      // 黃金交叉／死亡交叉
      if (mas[5] && mas[20]) {
        const a5 = mas[5], a20 = mas[20];
        p.font = small;
        for (let j = 1; j < n; j++) {
          if ([a5[j - 1], a20[j - 1], a5[j], a20[j]].includes(null)) continue;
          if (a5[j - 1] <= a20[j - 1] && a5[j] > a20[j]) { p.fillStyle = up; text("金叉", xs[j], y(rows[j][3]) + 11); }
          else if (a5[j - 1] >= a20[j - 1] && a5[j] < a20[j]) { p.fillStyle = dn; text("死叉", xs[j], y(rows[j][2]) - 11); }
        }
      }
      // 未來兩個交易日的預測
      if (future) {
        const fx0 = rb + 6;
        p.strokeStyle = th.BORDER2; p.lineWidth = 1; p.setLineDash(DASH); line(fx0, top, fx0, bottom); p.setLineDash([]);
        p.fillStyle = alpha(th.SURFACE2, 140); p.fillRect(fx0, top, right - fx0, pb - top);
        const last = rows[n - 1][4], hz = this.pred.horizons || {}, tg = this.pred.targets || [], words = this.dayWords();
        for (const k of [1, 2]) {
          const h = hz[k];
          if (!h) continue;
          const pr = h.p, col = pr >= 0.55 ? up : pr <= 0.45 ? dn : th.MUTED;
          const cx = fx0 + (right - fx0) * (k - 0.5) / 2, yy = y(last);
          const arrow = pr >= 0.55 ? "▲" : pr <= 0.45 ? "▼" : "－";
          p.fillStyle = col; p.font = `bold 19px ${FONT}`; text(arrow, cx, yy - 39);
          p.font = `bold 14px ${FONT}`; text(C.fixed(pr * 100, 0) + "%", cx, yy - 15);
          p.font = small; p.fillStyle = th.MUTED;
          text(words[k - 1], cx, yy + 3);
          if (tg.length >= k) text(tg[k - 1].slice(5).replace("-", "/"), cx, yy + 17);
        }
        p.fillStyle = th.MUTED; p.font = small;
        text(right - fx0 < 130 ? "模型預測" : U.isTouch() ? "模型預測（點一下看說明）" : "模型預測（滑鼠移上來看說明）", (fx0 + right) / 2, top + 9);
        text(`依 ${String(this.pred.base_date || "").slice(5).replace("-", "/")} 收盤`, (fx0 + right) / 2, top + 23);
      }
      // 成交量
      const vmax = Math.max(...rows.map((r) => r[5])) || 1;
      p.strokeStyle = th.GRID; p.lineWidth = 1; line(left, vt - 4, right, vt - 4);
      rows.forEach((r, i) => {
        const ref = i ? rows[i - 1][4] : (this.prev || r[1]);
        const col = (!lineMode ? r[4] >= r[1] : r[4] >= ref) ? up : dn;
        const hgt = (bottom - vt) * r[5] / vmax;
        p.fillStyle = alpha(col, 150);
        p.fillRect(xs[i] - Math.max(0.5, step * 0.31), bottom - hgt, Math.max(1, step * 0.62), hgt);
      });
      // 買賣標記
      for (const [dts, kind, price] of this.markers) {
        let idx = null;
        for (let i = 0; i < n; i++) {
          const d = rows[i][0].slice(0, 10);
          if (this.intraday || this.rangeLabel === "5日") { if (d === dts && idx === null) idx = i; }
          else if (d >= dts || (i === n - 1 && d < dts)) { idx = i; break; }
          else if (["3年", "5年"].includes(this.rangeLabel) && i + 1 < n && rows[i + 1][0].slice(0, 10) > dts && dts >= d) { idx = i; break; }
        }
        if (idx === null || !(lo <= price && price <= hi)) continue;
        const x = xs[idx], yy = y(price);
        p.beginPath();
        if (kind === "buy") { p.moveTo(x, yy + 3); p.lineTo(x - 6, yy + 13); p.lineTo(x + 6, yy + 13); }
        else { p.moveTo(x, yy - 3); p.lineTo(x - 6, yy - 13); p.lineTo(x + 6, yy - 13); }
        p.closePath(); p.fillStyle = kind === "buy" ? up : dn; p.fill(); p.strokeStyle = "white"; p.lineWidth = 1; p.stroke();
      }
      // 資訊列
      const i = this.hover !== null ? this.hover : n - 1;
      const [dt, o, h, l, c, v] = rows[i];
      const ref = i ? rows[i - 1][4] : (this.prev || o);
      const chg = c - ref;
      const dts = (lineMode && this.intraday) || this.rangeLabel === "5日" ? fmtDT(dt, "%Y-%m-%d %H:%M") : fmtDT(dt, "%Y-%m-%d");
      const segs = [[dts, th.TEXT]];
      if (!this.intraday) segs.push([`開 ${C.money(o, 2)}`, th.MUTED], [`高 ${C.money(h, 2)}`, th.MUTED], [`低 ${C.money(l, 2)}`, th.MUTED]);
      const cc = chg > 0 ? up : chg < 0 ? dn : th.TEXT;
      segs.push([`${this.intraday ? "價" : "收"} ${C.money(c, 2)}`, cc],
        [ref ? `${C.signed(chg, 2)}（${C.signed(chg / ref * 100, 2)}%）` : "", chg > 0 ? up : chg < 0 ? dn : th.MUTED],
        [v >= 1000 ? `量 ${C.money(v / 1000, 0)} 張` : `量 ${C.money(v, 0)} 股`, th.MUTED]);
      Object.keys(mas).forEach((k) => { if (mas[k][i] !== null) segs.push([`MA${k} ${C.money(mas[k][i], 2)}`, MA_COLORS[k]]); });
      const tr = this.trackFor(i);
      if (tr) {
        const ok = (tr[0] >= 0.5) === (tr[1] === 1);
        segs.push([`前一天預測上漲 ${C.fixed(tr[0] * 100, 0)}% → 實際${tr[1] ? "漲" : "跌/平"}（${ok ? "對" : "錯"}）`, ok ? th.ACCENT_TEXT : th.WARN]);
      }
      p.font = normal; p.textAlign = "left"; p.textBaseline = "alphabetic";
      let x0 = left + 2;
      for (const [t, col] of segs) {
        if (!t) continue;
        p.fillStyle = col; p.fillText(t, x0, 24);
        x0 += p.measureText(t).width + 14;
      }
      p.textBaseline = "middle";
      // 十字游標
      if (this.hover !== null) {
        const x = xs[i];
        p.strokeStyle = th.MUTED; p.lineWidth = 1; p.setLineDash(DASH);
        line(x, top, x, bottom);
        if (this.mouseY !== null && top <= this.mouseY && this.mouseY <= pb) {
          const yy = this.mouseY;
          line(left, yy, rb, yy);
          p.setLineDash([]);
          const val = lo + (pb - yy) / (pb - top) * (hi - lo);
          p.fillStyle = th.SELECT; roundRect(p, right + 2, yy - 9, 74, 18, 4); p.fill();
          p.fillStyle = th.TEXT; p.font = small; text(C.money(val, 2), right + 39, yy);
        }
        p.setLineDash([]);
      }
    }
  }
  ChartWidget.FUTURE_W = 140;
  function roundRect(p, x, y, w, h, r) {
    p.beginPath();
    p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath();
  }

  // ================= 走勢圖頁 =================
  class ChartPage {
    constructor() {
      const App = this.App = window.App, s = App.store.settings;
      this.symbol = "";
      this.rangeIdx = s.chart_range === undefined ? 3 : s.chart_range;
      this.cache = {}; this.preds = {}; this.lvCache = {}; this.lvBusy = new Set(); this.predBusy = new Set(); this.loadingKey = null;
      this.mode = s.chart_mode || "K";
      this.el = el("div");
      this.pick = el("select", { style: { minWidth: "220px" } });
      this.pick.addEventListener("change", () => { if (this.pick.value) this.showSymbol(this.pick.value); });
      this.sym = new U.SymbolEdit(App, { width: "240px" });
      this.sym.onEnter = () => this.showSymbol(this.sym.code());
      this.sym.onPick = () => this.showSymbol(this.sym.code());
      const top = el("div", { cls: "row" }, el("span", null, "持股／觀察"), this.pick, el("span", { style: { width: "8px" } }), this.sym.input,
        U.btn("查看", () => this.showSymbol(this.sym.code()), "primary", T.WIDGET_TIPS["查看"]),
        U.btn("基本資料", () => App.showInfo(this.symbol || this.sym.code()), "", T.WIDGET_TIPS["基本資料"]));
      this.rangeSeg = U.seg(CHART_RANGES.map((r) => r[0]), (i) => this.setRange(i));
      this.modeSeg = U.seg(["K線", "走勢線"], (i) => this.setMode(i === 0 ? "K" : "L"));
      const mas = s.chart_mas || [5, 20, 60];
      this.maChk = {};
      const maBox = [5, 20, 60].map((k) => { const c = U.check("MA" + k, mas.includes(k), () => this.redraw()); c.style.color = MA_COLORS[k]; this.maChk[k] = c; return c; });
      this.chkPred = U.check("預測訊號", s.chart_pred !== false, (on) => this.togglePred(on), "顯示模型對明天、後天的上漲機率，以及過去每天模型的看漲／看跌判斷（淡紅／淡綠底）");
      this.chkLv = U.check("買賣點", s.chart_levels !== false, (on) => this.toggleLv(on), T.WIDGET_TIPS["買賣點"]);
      this.bLv = U.btn("設為觀察目標價", () => this.applyLevelsToWatch(), "", T.WIDGET_TIPS["設為觀察目標價"]);
      this.status = el("span", { cls: "hint" });
      const bar = el("div", { cls: "row", style: { marginTop: "6px" } }, this.rangeSeg, el("span", { style: { width: "8px" } }), this.modeSeg,
        el("span", { style: { width: "4px" } }), ...maBox, el("span", { style: { width: "4px" } }), this.chkPred, this.chkLv, this.bLv, el("span", { cls: "grow" }), this.status);
      this.title = el("span", { cls: "chartTitle" }, "走勢圖");
      this.summary = el("span", { cls: "grow", style: { minWidth: "0" } });
      this.bDetail = U.btn("詳細說明…", () => this.openDetail(), "", "區間統計、參考買賣點的依據、模型預測的回測準確率與圖例說明（快捷鍵 I）");
      // 詳細說明用的文字（電腦版是隱藏的 QLabel）
      this.statsHtml = ""; this.lvHtml = ""; this.predHtml = "";
      this.chart = new ChartWidget(); this.chart.page = this;
      this.noteText = "▲ 紅色＝你買進的位置、▼ 綠色＝賣出；藍色虛線＝你的平均成本；黃色虛線＝觀察清單的目標價。滑鼠移到圖上可看當天開高低收與成交量。資料來源 Yahoo（分時約延遲 20 分鐘）。";
      this.detailDlg = null;
      this.el.append(top, bar, el("div", { cls: "row", style: { margin: "6px 0 4px" } }, this.title, el("span", { style: { width: "14px" } }), this.summary, this.bDetail), this.chart.el);
      this.syncButtons();
    }
    onShow() { this.chart.update(); }
    syncButtons() { this.rangeSeg.setOn(this.rangeIdx); this.modeSeg.setOn(this.mode === "K" ? 0 : 1); }
    refreshPick() {
      const App = this.App, cur = this.symbol;
      this.pick.innerHTML = "";
      this.pick.append(el("option", { value: "" }, "（選一檔）"));
      const held = Object.keys(App.holdings).filter((s) => App.holdings[s].shares > 0).sort();
      held.forEach((sym) => this.pick.append(el("option", { value: sym }, `持股　${sym} ${App.stockName(sym)}`)));
      App.store.watchlist.forEach((w) => { if (!held.includes(w.symbol)) this.pick.append(el("option", { value: w.symbol }, `觀察　${w.symbol} ${App.stockName(w.symbol) || w.name || ""}`)); });
      this.pick.value = [...this.pick.options].some((o) => o.value === cur) ? cur : "";
    }
    setRange(i) { this.rangeIdx = i; this.App.store.settings.chart_range = i; this.App.store.save(); this.syncButtons(); this.load(); }
    setMode(m) { this.mode = m; this.App.store.settings.chart_mode = m; this.App.store.save(); this.syncButtons(); this.redraw(); }

    // ---------- 參考買賣點 ----------
    toggleLv(on) { this.App.store.settings.chart_levels = on; this.App.store.save(); if (on) this.loadLv(); this.redraw(); }
    async loadLv() {
      const sym = this.symbol;
      if (!sym || this.lvBusy.has(sym)) return;
      const hit = this.lvCache[sym];
      if (hit && Date.now() - hit[0] < 600000) return;
      const cached = this.cache[sym + "|1年"];
      if (cached) { this.lvCache[sym] = [cached[0], cached[1].rows]; return; }
      this.lvBusy.add(sym);
      let rows = null;
      try { rows = (await M.fetchChart(sym, (this.App.stockList[sym] || {}).market, "1y", "1d")).rows; } catch (_e) { rows = null; }
      this.lvBusy.delete(sym);
      if (rows) this.lvCache[sym] = [Date.now(), rows];
      if (sym === this.symbol) this.redraw();
    }
    currentLevels() {
      const hit = this.lvCache[this.symbol];
      if (!hit) return null;
      const rows = hit[1].slice();
      const q = this.App.store.prices[this.symbol] || {};
      if (q.price && rows.length) {
        const last = rows[rows.length - 1];
        rows[rows.length - 1] = [last[0], last[1], Math.max(last[2], q.price), Math.min(last[3], q.price), q.price, last[5]];
      }
      const c = this.App.divclass ? this.App.divclass.info[this.symbol] : null;
      return C.computeTradeLevels(rows, this.symbol, c && c.ttm ? c.ttm : null);
    }
    detailHtml() {
      const sec = (t, body) => (body ? `<h3 style='margin:10px 0 4px 0'>${t}</h3><div>${body}</div>` : "");
      const name = this.symbol ? `${this.symbol} ${this.App.stockName(this.symbol)}` : "";
      return `<h2 style='margin:0'>${U.esc(name)}</h2>` + sec("區間統計", this.statsHtml) + sec("參考買賣點", this.lvHtml) + sec("模型預測", this.predHtml) + sec("圖例", this.noteText);
    }
    openDetail() {
      if (!this.symbol) return;
      if (!this.detailDlg || !this.detailDlg.visible) {
        const d = new U.Dialog("走勢圖詳細說明", { modal: false, width: "760px" });
        d.view = el("div", { cls: "browser", style: { height: "min(560px, 70vh)", overflow: "auto" } });
        d.body.append(d.view);
        d.foot.append(U.btn("關閉", () => d.reject()));
        this.detailDlg = d;
        d.show();
      }
      this.refreshDetail();
    }
    refreshDetail() {
      const d = this.detailDlg;
      if (!d || !d.visible) return;
      const pos = d.view.scrollTop;
      d.setTitle(`走勢圖詳細說明：${this.symbol} ${this.App.stockName(this.symbol)}`);
      d.view.innerHTML = this.detailHtml(); d.view.scrollTop = pos;
    }
    levelsText(lv) {
      const th = TH(), G = th.GAIN, L = th.LOSS, mu = th.MUTED;
      const fmt = (items, col) => items.map(([v, why]) => `<b style='color:${col}'>${C.money(v, 2)}</b>（${U.esc(why)}）`).join("　");
      const zc = lv.zone.includes("買點") ? L : lv.zone.includes("賣點") ? G : th.TEXT;
      const price = lv.price, dBuy = (lv.buy[0][0] / price - 1) * 100, dSell = (lv.sell[0][0] / price - 1) * 100;
      const parts = [`<b style='color:${zc}'>${lv.zone}</b>　（距買點 1 ${C.signed(dBuy, 1)}%、距賣點 1 ${C.signed(dSell, 1)}%；一年區間位置 ${C.fixed(lv.pos, 0)}%、RSI ${C.fixed(lv.rsi, 0)}）`,
        `參考買點：${fmt(lv.buy, L)}`, `參考賣點：${fmt(lv.sell, G)}`,
        `停損參考：<b style='color:${mu}'>${C.money(lv.stop, 2)}</b>（買點下方 1 倍 ATR，ATR≈${C.money(lv.atr, 2)}）`];
      if (lv.yld && Object.keys(lv.yld).length) parts.push("殖利率估價：" + Object.keys(lv.yld).map((k) => `${k}% → ${C.money(lv.yld[k], 2)}`).join("、"));
      const h = this.App.holdings[this.symbol];
      if (h && h.shares > 0) { const cost = h.cost / h.shares; parts.push(`你的成本 ${C.money(cost, 2)}：賣在賣點 1 約 ${C.signed((lv.sell[0][0] / cost - 1) * 100, 1)}%`); }
      return parts.join("<br>") + `<br><span style='color:${mu}'>依近一年日 K 的支撐壓力、均線、布林通道、ATR 推算，僅供參考，不保證會到價或反轉。</span>`;
    }
    async applyLevelsToWatch() {
      const App = this.App, lv = this.symbol ? this.currentLevels() : null;
      if (!lv) { await U.info("還沒有買賣點資料，請先開一檔股票並勾選「買賣點」"); return; }
      const buy = lv.buy[0][0], sell = lv.sell[0][0], w = App.watch;
      if (!w.find(this.symbol)) await w.add(this.symbol, App.stockName(this.symbol), true);
      const it = w.find(this.symbol);
      if (!it) return;
      it.buy_target = buy; it.sell_target = sell;
      [...w.alerted].forEach((a) => { if (a.split("|")[1] === this.symbol) w.alerted.delete(a); });
      App.store.save(); w.fill(); this.redraw();
      U.status(`${this.symbol} 觀察目標價已設定：買進 ${g(buy)}、賣出 ${g(sell)}（到價會提醒）`, 6000);
    }

    // ---------- 預測 ----------
    togglePred(on) { this.App.store.settings.chart_pred = on; this.App.store.save(); if (on) this.loadPred(); this.redraw(); }
    async loadPred() {
      const sym = this.symbol, App = this.App;
      if (!sym || this.predBusy.has(sym)) return;
      const hit = this.preds[sym];
      if (hit && Date.now() - hit[0] < 1800000) return;
      this.predBusy.add(sym);
      this.predHtml = "模型計算中…（下載 5 年日K）";
      const pp = App.predict;
      let res = null, err = "";
      try {
        if (pp.idxRows === null) { try { pp.idxRows = await M.yahooHistory("^TWII"); } catch (_e) { pp.idxRows = []; } pp.idxTime = Date.now(); }
        const rows = await M.yahooHistory(sym, (App.stockList[sym] || {}).market);
        await new Promise((r) => setTimeout(r, 0));
        res = P.predictSymbol(rows, P.indexFeatureMap(pp.idxRows));
      } catch (e) { err = e.message; }
      this.predBusy.delete(sym);
      if (res) { this.preds[sym] = [Date.now(), res]; pp.results[sym] = res; pp.fill(); }
      else if (sym === this.symbol) this.predHtml = `無法預測：${U.esc(err)}`;
      if (sym === this.symbol) this.redraw();
    }
    predText(res) {
      const th = TH(), h1 = res.horizons[1], h2 = res.horizons[2], tg = res.targets || [];
      const col = (pr) => (pr >= 0.55 ? th.GAIN : pr <= 0.45 ? th.LOSS : th.MUTED);
      const day = (k) => (tg.length >= k ? tg[k - 1].slice(5).replace("-", "/") : "");
      const st = res.signal_stats || {};
      const words = res.base_date === C.lastClosedTradingDay() ? ["明天", "後天"] : ["第1日", "第2日"];
      const LEVEL_TEXT = { 較佳: "較佳", 普通: "普通（接近隨機）", 偏低: "偏低（不比隨機好）" };
      const parts = [`模型預測（依 ${res.base_date || ""} 收盤）：${words[0]} ${day(1)} 上漲機率 <b style='color:${col(h1.p)}'>${C.fixed(h1.p * 100, 0)}%</b>` +
        `、${words[1]} ${day(2)} <b style='color:${col(h2.p)}'>${C.fixed(h2.p * 100, 0)}%</b>（＝那天收盤高於依據日收盤的機率）`];
      parts.push(`回測準確率 ${C.fixed(h1.acc * 100, 1)}%（每天都猜多數方向 ${C.fixed(h1.baseline * 100, 1)}%），可信度 ${LEVEL_TEXT[h1.level] || h1.level}`);
      if (st.bull_n) parts.push(`過去模型看漲（≥55%）${st.bull_n} 次，隔天真的漲 ${C.fixed(st.bull_hit * 100, 0)}%`);
      if (st.bear_n) parts.push(`看跌（≤45%）${st.bear_n} 次，隔天真的跌 ${C.fixed(st.bear_hit * 100, 0)}%`);
      return parts.join("；") + `。<span style='color:${th.MUTED}'>短期股價接近隨機，僅供參考。</span>`;
    }

    // ---------- 載入 ----------
    showSymbol(sym) {
      sym = (sym || "").trim().toUpperCase();
      if (!sym) return;
      this.symbol = sym;
      this.sym.setText(sym);
      if ([...this.pick.options].some((o) => o.value === sym)) this.pick.value = sym;
      this.App.goPage("走勢圖");
      this.load();
      if (this.chkPred.input.checked) this.loadPred();
      if (this.chkLv.input.checked) this.loadLv();
    }
    async load(maxAge) {
      if (!this.symbol) return;
      const [label, rng, iv] = CHART_RANGES[this.rangeIdx];
      const key = this.symbol + "|" + label;
      const age = maxAge !== undefined && maxAge !== null ? maxAge : (iv.endsWith("m") ? 60 : 600);
      const hit = this.cache[key];
      if (hit && Date.now() - hit[0] < age * 1000) { this.redraw(); return; }
      if (!hit) this.chart.showMessage(`載入 ${this.symbol} ${label} 走勢…`);
      this.status.textContent = "載入中…";
      this.loadingKey = key;
      let res = null, err = "";
      try { res = await M.fetchChart(this.symbol, (this.App.stockList[this.symbol] || {}).market, rng, iv); } catch (e) { err = e.message; }
      if (res) this.cache[key] = [Date.now(), res];
      if (key === this.symbol + "|" + CHART_RANGES[this.rangeIdx][0]) {
        this.status.textContent = res ? `更新於 ${C.now().time}` : `載入失敗：${err}`;
        if (res) this.redraw();
        else if (!this.cache[key]) this.chart.showMessage(`載入失敗：${err}`);
      }
    }
    redraw() {
      const App = this.App, th = TH();
      App.store.settings.chart_mas = [5, 20, 60].filter((k) => this.maChk[k].input.checked);
      const label = CHART_RANGES[this.rangeIdx][0];
      const hit = this.cache[this.symbol + "|" + label];
      const sym = this.symbol, name = App.stockName(sym);
      const q = App.store.prices[sym] || {};
      const price = q.price, prev = q.prev;
      if (price) {
        const chg = prev ? price - prev : 0;
        const col = chg > 0 ? th.GAIN : chg < 0 ? th.LOSS : th.TEXT, arrow = chg > 0 ? "▲" : chg < 0 ? "▼" : "";
        this.title.innerHTML = prev ? `${U.esc(sym)} ${U.esc(name)}　<span style='color:${col}'>${C.money(price, 2)}　${arrow}${C.money(Math.abs(chg), 2)}（${C.signed(chg / prev * 100, 2)}%）</span>`
          : `${U.esc(sym)} ${U.esc(name)}　${C.money(price, 2)}`;
      } else this.title.textContent = `${sym} ${name}`;
      if (!hit) return;
      const res = hit[1], rows = res.rows;
      const prevRef = res.intraday && prev ? prev : res.prev;
      const h = App.holdings[sym];
      const cost = h && h.shares > 0 ? h.cost / h.shares : null;
      const w = App.store.watchlist.find((x) => x.symbol === sym);
      const targets = [];
      if (w && w.buy_target) targets.push(["買點", w.buy_target]);
      if (w && w.sell_target) targets.push(["賣點", w.sell_target]);
      const firstD = rows[0][0].slice(0, 10);
      const markers = App.store.transactions.filter((t) => t.symbol === sym && t.date >= firstD).map((t) => [t.date, t.type, t.price, t.shares]);
      const mas = [5, 20, 60].filter((k) => this.maChk[k].input.checked);
      this.chart.setData(rows, prevRef, res.intraday, this.mode, mas, markers, cost, targets, label);
      const pred = (this.preds[sym] || [null, null])[1];
      this.chart.setPrediction(pred, this.chkPred.input.checked);
      let lvCur = null;
      if (this.chkLv.input.checked) {
        if (!this.lvCache[sym] && this.cache[sym + "|1年"]) this.lvCache[sym] = [this.cache[sym + "|1年"][0], this.cache[sym + "|1年"][1].rows];
        const lv = this.currentLevels();
        if (lv) {
          const lines = lv.buy.map(([v], i) => [`買點${i + 1}`, v, th.LOSS]).concat(lv.sell.map(([v], i) => [`賣點${i + 1}`, v, th.GAIN]));
          lines.push(["停損", lv.stop, th.DISABLED]);
          this.chart.setLevels(lines);
          this.lvHtml = this.levelsText(lv);
          lvCur = lv;
        } else { this.chart.setLevels([]); this.lvHtml = this.lvBusy.has(sym) ? "計算買賣點中…（下載近一年日 K）" : ""; }
      } else { this.chart.setLevels([]); this.lvHtml = ""; }
      if (!this.chkPred.input.checked) this.predHtml = "";
      else if (pred) {
        const note = ["分時", "5日", "3年", "5年"].includes(label) ? "（分時、5日不畫預測；3年、5年為週K，不畫每日底色）" : "淡紅底＝前一天模型看漲、淡綠底＝看跌；滑鼠移上去可看當天預測對不對。";
        this.predHtml = this.predText(pred) + "<br>" + note;
      }
      const hi = Math.max(...rows.map((r) => r[2])), lo = Math.min(...rows.map((r) => r[3]));
      const base = res.intraday && prevRef ? prevRef : rows[0][1];
      const last = rows[rows.length - 1][4];
      const rc = base ? (last / base - 1) * 100 : 0;
      const vol = rows.reduce((a, r) => a + r[5], 0);
      const rcCol = rc > 0 ? th.GAIN : rc < 0 ? th.LOSS : th.MUTED;
      const mine = cost ? `　你的成本 ${C.money(cost, 2)}（${C.signed((last / cost - 1) * 100, 2)}%）` : "";
      this.statsHtml = `${label}區間：最高 ${C.money(hi, 2)}　最低 ${C.money(lo, 2)}　區間漲跌 <span style='color:${rcCol}'>${C.signed(rc, 2)}%</span>　成交量 ${C.money(vol / 1000, 0)} 張　共 ${rows.length} 筆${mine}`;
      const parts = [`${label}漲跌 <b style='color:${rcCol}'>${C.signed(rc, 2)}%</b>`];
      if (cost) { const pc = (last / cost - 1) * 100; parts.push(`成本 ${C.money(cost, 2)}（<span style='color:${pc > 0 ? th.GAIN : th.LOSS}'>${C.signed(pc, 2)}%</span>）`); }
      if (lvCur) {
        const zc = lvCur.zone.includes("買點") ? th.LOSS : lvCur.zone.includes("賣點") ? th.GAIN : th.TEXT;
        parts.push(`<b style='color:${zc}'>${lvCur.zone}</b>　買 <b style='color:${th.LOSS}'>${C.money(lvCur.buy[0][0], 2)}</b>／賣 <b style='color:${th.GAIN}'>${C.money(lvCur.sell[0][0], 2)}</b>　停損 ${C.money(lvCur.stop, 2)}`);
      }
      if (pred && this.chkPred.input.checked && pred.horizons) {
        const hz = pred.horizons, words = pred.base_date === C.lastClosedTradingDay() ? ["明天", "後天"] : ["第1日", "第2日"];
        const pp = [1, 2].filter((k) => hz[k]).map((k) => `${words[k - 1]} <b style='color:${hz[k].p >= 0.55 ? th.GAIN : hz[k].p <= 0.45 ? th.LOSS : th.TEXT}'>${C.fixed(hz[k].p * 100, 0)}%</b>`);
        parts.push("上漲機率 " + pp.join("・"));
      }
      this.summary.innerHTML = `<span style='color:${th.MUTED}'>` + parts.join("　｜　") + "</span>";
      this.refreshDetail();
    }
  }
  window.App = Object.assign(window.App || {}, { ChartPage, ChartWidget, CHART_RANGES, MA_COLORS });
})();
