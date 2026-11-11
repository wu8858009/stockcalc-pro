/* 漲跌預測模型（對照電腦版 build_features / fit_logit / predict_symbol，numpy 改成純 JS）。
   rows：[[date, open, high, low, close, volume], ...]，由舊到新。 */
(function (root) {
  "use strict";
  const C = root.Core;
  const FEATURE_NAMES = ["1日漲跌", "2日漲跌", "5日漲跌", "10日漲跌", "20日漲跌", "距5日線", "距10日線",
    "距20日線", "距60日線", "RSI14", "K值", "K-D差", "量比", "20日波動度",
    "收盤在當日高低位置", "開盤跳空", "大盤1日漲跌", "大盤5日漲跌", "大盤距20日線"];
  const NaN_ = NaN;

  function ma(x, n) {                   // 同 numpy cumsum 寫法，數值誤差一致
    const out = new Array(x.length).fill(NaN_);
    if (x.length >= n) {
      const cs = [0];
      for (let i = 0; i < x.length; i++) cs.push(cs[i] + x[i]);
      for (let i = n - 1; i < x.length; i++) out[i] = (cs[i + 1] - cs[i + 1 - n]) / n;
    }
    return out;
  }
  function lr(x, n) {
    const out = new Array(x.length).fill(NaN_);
    for (let i = n; i < x.length; i++) out[i] = Math.log(x[i] / x[i - n]);
    return out;
  }
  function roll(x, n, fn) {
    const out = new Array(x.length).fill(NaN_);
    for (let i = n - 1; i < x.length; i++) out[i] = fn(x.slice(i - n + 1, i + 1));
    return out;
  }
  const amin = (a) => Math.min(...a), amax = (a) => Math.max(...a);
  function astd(a) {                    // numpy std（母體），numpy 用成對加總，誤差極小
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
  }

  function indexFeatureMap(rows) {
    if (!rows || !rows.length) return {};
    const c = rows.map((r) => r[4]), a = lr(c, 1), b = lr(c, 5), m = ma(c, 20), out = {};
    rows.forEach((r, i) => { out[r[0]] = [a[i], b[i], c[i] / m[i] - 1]; });
    return out;
  }

  function buildFeatures(rows, idxMap) {
    const dates = rows.map((r) => r[0]);
    const o = rows.map((r) => r[1]), h = rows.map((r) => r[2]), l = rows.map((r) => r[3]), c = rows.map((r) => r[4]), v = rows.map((r) => r[5]);
    const N = c.length;
    const r1 = lr(c, 1);
    const diff = c.map((x, i) => (i ? x - c[i - 1] : 0));
    const gain = ma(diff.map((d) => Math.max(d, 0)), 14), loss = ma(diff.map((d) => Math.max(-d, 0)), 14);
    const rsi = gain.map((g, i) => (isNaN(g) ? NaN_ : g + loss[i] > 0 ? 100 * g / (g + loss[i] + 1e-12) : 50.0));
    const lo9 = roll(l, 9, amin), hi9 = roll(h, 9, amax);
    const rsv = c.map((x, i) => (hi9[i] > lo9[i] ? (x - lo9[i]) / (hi9[i] - lo9[i] + 1e-12) * 100 : 50.0));
    const K = new Array(N).fill(NaN_), D = new Array(N).fill(NaN_);
    let k = 50.0, d = 50.0;
    for (let i = 8; i < N; i++) { k = k * 2 / 3 + rsv[i] / 3; d = d * 2 / 3 + k / 3; K[i] = k; D[i] = d; }
    const mv20 = ma(v, 20);
    const volr = v.map((x, i) => Math.log((x + 1) / (mv20[i] + 1)));
    const vol20 = roll(r1.map((x) => (isNaN(x) ? 0 : x)), 20, astd);
    const rng = c.map((x, i) => (h[i] > l[i] ? (x - l[i]) / (h[i] - l[i] + 1e-12) : 0.5));
    const gap = c.map((x, i) => (i ? Math.log(o[i] / c[i - 1]) : NaN_));
    let ix;
    if (idxMap && Object.keys(idxMap).length) {
      let last = [NaN_, NaN_, NaN_];
      ix = dates.map((dt) => { if (idxMap[dt]) last = idxMap[dt]; return last; });
    } else ix = dates.map(() => [0, 0, 0]);
    const m5 = ma(c, 5), m10 = ma(c, 10), m20 = ma(c, 20), m60 = ma(c, 60);
    const l2 = lr(c, 2), l5 = lr(c, 5), l10 = lr(c, 10), l20 = lr(c, 20);
    const X = c.map((x, i) => [r1[i], l2[i], l5[i], l10[i], l20[i], x / m5[i] - 1, x / m10[i] - 1, x / m20[i] - 1, x / m60[i] - 1,
      rsi[i] / 100, K[i] / 100, (K[i] - D[i]) / 100, volr[i], vol20[i], rng[i], gap[i], ix[i][0], ix[i][1], ix[i][2]]);
    const aux = { rsi, K, D, ma5: m5, ma20: m20, ma60: m60, volr, r5: l5 };
    return { dates, c, X, aux };
  }

  const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  function solve(A, b) {                // 高斯消去（部分選主元）
    const n = b.length, M = A.map((r, i) => r.slice().concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      [M[col], M[piv]] = [M[piv], M[col]];
      const p = M[col][col];
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / p;
        if (f) for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
      x[r] = s / M[r][r];
    }
    return x;
  }
  function newtonLogit(Z, y, R) {
    const m = Z[0].length, n = Z.length;
    let w = new Array(m).fill(0);
    for (let it = 0; it < 30; it++) {
      const H = R.map((r) => r.slice()), g = new Array(m).fill(0);
      for (let j = 0; j < m; j++) for (let k2 = 0; k2 < m; k2++) g[j] += R[j][k2] * w[k2];
      for (let i = 0; i < n; i++) {
        const zi = Z[i];
        let s = 0;
        for (let j = 0; j < m; j++) s += zi[j] * w[j];
        const p = sigmoid(s), wt = p * (1 - p), e = p - y[i];
        for (let j = 0; j < m; j++) {
          g[j] += zi[j] * e;
          const a = zi[j] * wt;
          for (let k2 = j; k2 < m; k2++) H[j][k2] += a * zi[k2];
        }
      }
      for (let j = 0; j < m; j++) for (let k2 = 0; k2 < j; k2++) H[j][k2] = H[k2][j];
      const step = solve(H, g);
      w = w.map((x, j) => x - step[j]);
      if (Math.max(...step.map(Math.abs)) < 1e-7) break;
    }
    return w;
  }
  function fitLogit(X, y, lamRatio) {
    lamRatio = lamRatio === undefined ? 0.05 : lamRatio;
    const n = X.length, m = X[0].length, mu = new Array(m).fill(0), sd = new Array(m).fill(0);
    for (const r of X) for (let j = 0; j < m; j++) mu[j] += r[j];
    for (let j = 0; j < m; j++) mu[j] /= n;
    for (const r of X) for (let j = 0; j < m; j++) sd[j] += (r[j] - mu[j]) ** 2;
    for (let j = 0; j < m; j++) { sd[j] = Math.sqrt(sd[j] / n); if (sd[j] < 1e-12) sd[j] = 1.0; }
    const Z = X.map((r) => [1].concat(r.map((x, j) => (x - mu[j]) / sd[j])));
    const R = [];
    for (let i = 0; i <= m; i++) { R.push(new Array(m + 1).fill(0)); R[i][i] = lamRatio * n; }
    R[0][0] = 1e-6;
    return [newtonLogit(Z, y, R), mu, sd];
  }
  function predictLogit(model, X) {
    const [w, mu, sd] = model;
    return X.map((r) => { let s = w[0]; for (let j = 0; j < r.length; j++) s += (r[j] - mu[j]) / sd[j] * w[j + 1]; return sigmoid(s); });
  }
  function fitCalibration(p, y) {
    const z = p.map((x) => { const pc = Math.min(Math.max(x, 1e-4), 1 - 1e-4); return Math.log(pc / (1 - pc)); });
    const [a, b] = newtonLogit(z.map((v) => [1, v]), y, [[1e-6, 0], [0, 1e-3 * z.length]]);
    if (b <= 0) {
      const mean = y.reduce((s, v) => s + v, 0) / y.length, r = Math.min(Math.max(mean, 0.01), 0.99);
      return [Math.log(r / (1 - r)), 0.0];
    }
    return [a, Math.min(b, 1.2)];
  }

  function predictSymbol(rows, idxMap) {
    if (rows.length < 320) throw new Error(`歷史資料只有 ${rows.length} 天，至少需要約 320 個交易日`);
    const { dates, c, X, aux } = buildFeatures(rows, idxMap);
    const N = c.length;
    const valid = X.map((r) => r.every((x) => !isNaN(x)));
    if (!valid[N - 1]) throw new Error("最新一天的指標無法計算（可能缺大盤資料）");
    const out = { base_date: dates[N - 1], close: c[N - 1], n_days: valid.filter(Boolean).length,
      targets: C.CALENDAR.nextTradingDays(dates[N - 1]), horizons: {} };
    for (const hz of [1, 2]) {
      const y = new Array(N).fill(NaN_);
      for (let i = 0; i < N - hz; i++) y[i] = c[i + hz] > c[i] ? 1 : 0;
      const lab = [];
      for (let i = 0; i < N; i++) if (valid[i] && !isNaN(y[i])) lab.push(i);
      const P = [], Y = [], B = [], I = [];
      for (let s0 = Math.max(250, Math.trunc(lab.length * 0.4)); s0 < lab.length; s0 += 20) {
        const tr = lab.slice(0, Math.max(0, s0 - hz)), te = lab.slice(s0, s0 + 20);
        const m = fitLogit(tr.map((i) => X[i]), tr.map((i) => y[i]));
        const pp = predictLogit(m, te.map((i) => X[i]));
        const base = tr.reduce((s, i) => s + y[i], 0) / tr.length;
        te.forEach((i, k) => { P.push(pp[k]); Y.push(y[i]); B.push(base); I.push(i); });
      }
      if (hz === 1) {
        out.track = {};
        I.forEach((i, k) => { out.track[dates[i]] = [P[k], Y[k]]; });
        const bull = P.map((p) => p >= 0.55), bear = P.map((p) => p <= 0.45);
        const nb = bull.filter(Boolean).length, nr = bear.filter(Boolean).length;
        out.signal_stats = {
          bull_n: nb, bull_hit: nb ? Y.filter((_, k) => bull[k]).reduce((s, v) => s + v, 0) / nb : null,
          bear_n: nr, bear_hit: nr ? 1 - Y.filter((_, k) => bear[k]).reduce((s, v) => s + v, 0) / nr : null,
        };
      }
      const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
      const acc = mean(P.map((p, k) => ((p > 0.5) === (Y[k] === 1) ? 1 : 0)));
      const upRate = mean(Y), baseline = Math.max(upRate, 1 - upRate);
      const brier = mean(P.map((p, k) => (p - Y[k]) ** 2)), brier0 = mean(B.map((b, k) => (b - Y[k]) ** 2));
      const [a, b] = fitCalibration(P, Y);
      const full = fitLogit(lab.map((i) => X[i]), lab.map((i) => y[i]));
      const pRaw = predictLogit(full, [X[N - 1]])[0];
      const p = sigmoid(a + b * Math.log(pRaw / (1 - pRaw)));
      const [w, mu, sd] = full;
      const contrib = X[N - 1].map((x, j) => w[j + 1] * (x - mu[j]) / sd[j]);
      const order = contrib.map((v, j) => [Math.abs(v), j]).sort((p1, p2) => p2[0] - p1[0] || p1[1] - p2[1]).slice(0, 5).map((x) => x[1]);
      const edge = acc - baseline, skill = brier0 > 0 ? 1 - brier / brier0 : 0.0;
      const level = edge >= 0.03 && skill > 0.01 ? "較佳" : edge >= 0.0 && skill > -0.005 ? "普通" : "偏低";
      out.horizons[hz] = { p, p_raw: pRaw, acc, baseline, up_rate: mean(lab.map((i) => y[i])), n_test: Y.length, skill, level, calib_b: b,
        factors: order.map((j) => [FEATURE_NAMES[j], contrib[j]]) };
    }
    const i = N - 1;
    out.signals = { rsi: aux.rsi[i], K: aux.K[i], D: aux.D[i], K_prev: aux.K[i - 1], D_prev: aux.D[i - 1],
      ma5: aux.ma5[i], ma20: aux.ma20[i], ma60: aux.ma60[i], volr: Math.exp(aux.volr[i]), r5: Math.expm1(aux.r5[i]) };
    return out;
  }

  root.Predict = { FEATURE_NAMES, indexFeatureMap, buildFeatures, fitLogit, predictLogit, fitCalibration, predictSymbol };
})(typeof window !== "undefined" ? window : globalThis);
