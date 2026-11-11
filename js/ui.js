/* 介面元件：表格（可排序、多選、右鍵、就地更新與價格閃爍）、對話框、訊息框、選單、數字欄、股票代號自動完成、提示。 */
(function (root) {
  "use strict";
  const U = {};
  const C = root.Core;

  U.el = function (tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v === null) continue;
      if (k === "cls") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "text") e.textContent = v;
      else if (k === "tip") e.dataset.tip = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
      else e.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach((x) => x && e.append(x.nodeType ? x : document.createTextNode(String(x))));
      else e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  };
  const el = U.el;
  U.esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  U.btn = (text, fn, cls, tip) => el("button", { cls, onclick: fn, tip }, text);
  U.label = (text, cls) => el("span", { cls: cls || "" }, text);
  U.hint = (text) => el("div", { cls: "hint" }, text);

  // ---------- 狀態列、提示 ----------
  let statusTimer = 0;
  U.status = function (msg, ms) {
    const s = document.getElementById("statusMsg");
    if (!s) return;
    s.textContent = msg || "";
    s.title = msg || "";
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => { if (s.textContent === msg) s.textContent = ""; }, ms);
  };
  U.toast = function (title, body, onClick, ms) {
    const box = document.getElementById("toasts");
    const t = el("div", { cls: "toast", onclick: () => { t.remove(); onClick && onClick(); } }, el("b", null, title), body || "");
    box.append(t);
    setTimeout(() => t.remove(), ms || 15000);
  };
  // 滑鼠停留提示：data-tip（純文字）或 data-tiphtml（HTML）
  const tipBox = () => document.getElementById("tip");
  let tipEl = null;
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest ? e.target.closest("[data-tip],[data-tiphtml]") : null;
    const box = tipBox();
    if (!box) return;
    if (!t) { box.classList.add("hidden"); tipEl = null; return; }
    if (t === tipEl) return;
    tipEl = t;
    if (t.dataset.tiphtml) box.innerHTML = t.dataset.tiphtml; else box.textContent = t.dataset.tip;
    box.classList.remove("hidden");
  });
  document.addEventListener("mousemove", (e) => {
    const box = tipBox();
    if (!box || box.classList.contains("hidden")) return;
    const w = box.offsetWidth, h = box.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 18;
    if (x + w > innerWidth - 8) x = Math.max(8, e.clientX - w - 10);
    if (y + h > innerHeight - 8) y = Math.max(8, e.clientY - h - 10);
    box.style.left = x + "px"; box.style.top = y + "px";
  });
  U.hideTip = () => { const b = tipBox(); if (b) b.classList.add("hidden"); tipEl = null; };

  // ---------- 右鍵選單 ----------
  let openMenu = null;
  U.menu = function (items, x, y) {
    U.closeMenu();
    const m = el("div", { cls: "menu" });
    for (const it of items) {
      if (!it) m.append(el("hr"));
      else m.append(el("div", { onclick: () => { U.closeMenu(); it[1](); } }, it[0]));
    }
    document.body.append(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.min(x, innerWidth - w - 6) + "px";
    m.style.top = Math.min(y, innerHeight - h - 6) + "px";
    openMenu = m;
  };
  U.closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  document.addEventListener("mousedown", (e) => { if (openMenu && !openMenu.contains(e.target)) U.closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) { U.closeMenu(); e.stopPropagation(); } }, true);

  // ---------- 對話框 ----------
  const dlgStack = [];
  U.dialogs = dlgStack;
  U.Dialog = class {
    constructor(title, opts) {
      opts = opts || {};
      this.modal = opts.modal !== false;
      this.ov = el("div", { cls: "overlay" + (this.modal ? "" : " free") });
      this.head = el("div", { cls: "dlgHead" }, el("span", null, title), el("button", { cls: "x", onclick: () => this.reject() }, "×"));
      this.body = el("div", { cls: "dlgBody" });
      this.foot = el("div", { cls: "dlgFoot" });
      this.box = el("div", { cls: "dlg", style: opts.width ? { width: opts.width } : null }, this.head, this.body, this.foot);
      this.ov.append(this.box);
      this.result = null;
      this.onClose = null;
      this._promise = new Promise((res) => { this._resolve = res; });
      let drag = null;
      this.head.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) return;
        const r = this.box.getBoundingClientRect();
        drag = [e.clientX - r.left, e.clientY - r.top];
        this.box.style.position = "fixed"; this.box.style.margin = "0";
        const mv = (ev) => { this.box.style.left = (ev.clientX - drag[0]) + "px"; this.box.style.top = Math.max(0, ev.clientY - drag[1]) + "px"; };
        const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
        document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
      });
      this.ov.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); this.reject(); } });
    }
    setTitle(t) { this.head.firstChild.textContent = t; }
    show() {
      if (!this.ov.isConnected) { document.body.append(this.ov); dlgStack.push(this); }
      setTimeout(() => { const f = this.box.querySelector("[autofocus], input:not([type=checkbox]):not([disabled]), select, button.primary"); if (f) f.focus(); }, 0);
      return this;
    }
    exec() { this.show(); return this._promise; }
    close(result) {
      if (!this.ov.isConnected) return;
      this.ov.remove();
      const i = dlgStack.indexOf(this); if (i >= 0) dlgStack.splice(i, 1);
      this.result = result;
      this._resolve(result);
      if (this.onClose) this.onClose(result);
    }
    accept(v) { this.close(v === undefined ? true : v); }
    reject() { this.close(null); }
    get visible() { return this.ov.isConnected; }
  };
  // 訊息框：buttons = [[文字, 回傳值, 是否主要]]，預設按鈕放第一個主要的
  U.msg = function (text, opts) {
    opts = opts || {};
    const d = new U.Dialog(opts.title || "股票計算與持股", { width: opts.width });
    d.body.append(el("div", { cls: "msgText", html: opts.html ? text : U.esc(text) }));
    if (opts.detail) {
      const det = el("pre", { cls: "msgText hidden", style: { maxHeight: "240px", overflow: "auto", background: "var(--SURFACE)", padding: "8px", borderRadius: "6px" } }, opts.detail);
      d.body.append(el("div", null, U.btn("顯示詳細資料", () => det.classList.toggle("hidden"))), det);
    }
    const buttons = opts.buttons || [["確定", true, true]];
    buttons.forEach(([t, v, primary]) => d.foot.append(el("button", { cls: primary ? "primary" : "", onclick: () => d.close(v) }, t)));
    d.reject = () => d.close(opts.cancelValue === undefined ? null : opts.cancelValue);
    return d.exec();
  };
  U.info = (text, html) => U.msg(text, { html });
  U.warn = (text) => U.msg(text, { title: "注意" });
  U.ask = (text, yes, no) => U.msg(text, { buttons: [[yes || "是", true, true], [no || "否", false]], cancelValue: false });

  // ---------- 數字欄（同 QSpinBox：千分位、單位、上下鍵與滾輪調整）----------
  U.NumBox = class {
    constructor(opts) {
      opts = opts || {};
      this.min = opts.min === undefined ? 0 : opts.min; this.max = opts.max === undefined ? 1e12 : opts.max;
      this.dec = opts.decimals || 0; this.step = opts.step || (this.dec ? Math.pow(10, -this.dec) : 1);
      this.suffix = opts.suffix || ""; this.special = opts.special || "";
      this.input = el("input", { cls: "num", inputmode: this.dec ? "decimal" : "numeric", style: opts.width ? { width: opts.width } : null });
      this.handlers = [];
      this.v = this.min;
      this.input.addEventListener("focus", () => { this.input.value = this.special && this.v === this.min ? "" : this.plain(); setTimeout(() => this.input.select(), 0); });
      this.input.addEventListener("blur", () => this.commit());
      this.input.addEventListener("input", () => {
        const x = parseFloat(this.input.value.replace(/,/g, ""));
        if (!isNaN(x)) this.set(x, true, true);
      });
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); this.stepBy(e.key === "ArrowUp" ? 1 : -1); this.input.value = this.plain(); }
      });
      this.input.addEventListener("wheel", (e) => {
        if (document.activeElement !== this.input || opts.noWheel) return;
        e.preventDefault(); this.stepBy(e.deltaY < 0 ? 1 : -1); this.input.value = this.plain();
      }, { passive: false });
      this.set(opts.value === undefined ? this.min : opts.value, false);
    }
    plain() { return this.dec ? C.fixed(this.v, this.dec) : String(Math.round(this.v)); }
    text() {
      if (this.special && this.v === this.min) return this.special;
      return C.money(this.v, this.dec) + this.suffix;
    }
    value() { return this.v; }
    set(x, emit, typing) {
      x = Number(x);
      if (isNaN(x)) x = this.min;
      x = Math.min(this.max, Math.max(this.min, x));
      x = this.dec ? C.pyRound(x, this.dec) : Math.round(x);
      const changed = x !== this.v;
      this.v = x;
      if (!typing && document.activeElement !== this.input) this.input.value = this.text();
      else if (!typing) this.input.value = this.plain();
      if (changed && emit !== false) this.handlers.forEach((h) => h(x));
    }
    setValue(x) { this.set(x, true); }
    commit() { const x = parseFloat(this.input.value.replace(/,/g, "")); this.set(isNaN(x) ? (this.special ? this.min : this.v) : x, true); this.input.value = this.text(); }
    stepBy(k) { this.set(this.v + k * this.step, true); }
    onChange(fn) { this.handlers.push(fn); return this; }
    setMax(m) { this.max = m; if (this.v > m) this.set(m, true); }
    setEnabled(on) { this.input.disabled = !on; }
  };

  // ---------- 股票代號（自動完成：代號或名稱都能找）----------
  U.SymbolEdit = class {
    constructor(app, opts) {
      opts = opts || {};
      this.app = app;
      this.input = el("input", { placeholder: opts.placeholder || "輸入代號或名稱，例如 2330 或 台積電", style: opts.width ? { width: opts.width } : null, autocomplete: "off" });
      this.list = null; this.items = []; this.idx = -1;
      this.onPick = null; this.onEnter = null;
      this.input.addEventListener("input", () => this.suggest());
      this.input.addEventListener("keydown", (e) => {
        if (this.list && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); this.move(e.key === "ArrowDown" ? 1 : -1); return; }
        if (e.key === "Enter") {
          if (this.list && this.idx >= 0) { e.preventDefault(); e.stopPropagation(); this.pick(this.items[this.idx]); return; }
          this.close();
          if (this.onEnter) { e.preventDefault(); e.stopPropagation(); this.onEnter(); }
        }
        if (e.key === "Escape" && this.list) { e.stopPropagation(); this.close(); }
      });
      this.input.addEventListener("blur", () => setTimeout(() => { this.close(); if (this.onBlur) this.onBlur(); }, 150));
    }
    code() { return this.input.value.trim().split(" ")[0].toUpperCase(); }
    text() { return this.input.value; }
    setText(t) { this.input.value = t || ""; }
    focus() { this.input.focus(); this.input.select(); }
    suggest() {
      const kw = this.input.value.trim().toLowerCase();
      this.close();
      if (!kw) return;
      const out = [];
      const lst = this.app.stockList || {};
      for (const c of Object.keys(lst).sort()) {
        const s = c + " " + lst[c].name;
        if (s.toLowerCase().includes(kw)) { out.push(s); if (out.length >= 12) break; }
      }
      if (!out.length) return;
      this.items = out; this.idx = -1;
      const r = this.input.getBoundingClientRect();
      this.list = el("div", { cls: "suggest", style: { left: r.left + "px", top: (r.bottom + 2) + "px", minWidth: r.width + "px" } });
      out.forEach((s, i) => this.list.append(el("div", { onmousedown: (e) => { e.preventDefault(); this.pick(s); } }, s)));
      document.body.append(this.list);
    }
    move(d) {
      if (!this.list) return;
      this.idx = (this.idx + d + this.items.length) % this.items.length;
      [...this.list.children].forEach((x, i) => x.classList.toggle("on", i === this.idx));
      this.list.children[this.idx].scrollIntoView({ block: "nearest" });
    }
    pick(s) { this.input.value = s; this.close(); if (this.onPick) this.onPick(); }
    close() { if (this.list) { this.list.remove(); this.list = null; } this.idx = -1; }
  };

  // ---------- 下拉、核取、分段按鈕 ----------
  U.combo = (items, onChange) => {
    const s = el("select");
    items.forEach((it) => { const [t, v] = Array.isArray(it) ? it : [it, it]; s.append(el("option", { value: v === null ? "" : String(v) }, t)); });
    if (onChange) s.addEventListener("change", () => onChange(s.selectedIndex));
    return s;
  };
  U.check = (text, checked, onChange, tip) => {
    const i = el("input", { type: "checkbox" });
    i.checked = !!checked;
    if (onChange) i.addEventListener("change", () => onChange(i.checked));
    const l = el("label", { cls: "chk", tip }, i, text);
    l.input = i;
    return l;
  };
  U.seg = (labels, onClick) => {
    const box = el("div", { cls: "seg" });
    box.buttons = labels.map((t, i) => { const b = el("button", { onclick: () => onClick(i) }, t); box.append(b); return b; });
    box.setOn = (i) => box.buttons.forEach((b, k) => b.classList.toggle("on", k === i));
    return box;
  };

  // ---------- 卡片 ----------
  U.Card = class {
    constructor(title) {
      this.t = el("div", { cls: "cardTitle" }, title);
      this.v = el("div", { cls: "cardValue" }, "—");
      this.sub = el("div", { cls: "cardSub" });
      this.el = el("div", { cls: "card" }, this.t, this.v, this.sub);
    }
    set(text, color, sub) { this.v.textContent = text; this.v.style.color = color || ""; this.sub.textContent = sub || ""; }
    title(t) { this.t.textContent = t; }
  };

  // ---------- 表格 ----------
  // cell = { text, key, color, bold, left, tip, tiphtml, html }；row.cells = [...], row.id（選取用）, row.cls（limitUp/limitDown）
  U.cell = (text, key, opts) => Object.assign({ text: text === null || text === undefined ? "" : String(text), key: key === undefined ? text : key }, opts || {});
  function cmp(a, b) {
    const an = typeof a === "number" && !isNaN(a), bn = typeof b === "number" && !isNaN(b);
    if (an && bn) return a - b;
    if (an !== bn) return an ? -1 : 1;
    const as = String(a === null || a === undefined ? "" : a), bs = String(b === null || b === undefined ? "" : b);
    return as < bs ? -1 : as > bs ? 1 : 0;
  }
  U.Table = class {
    constructor(headers, opts) {
      opts = opts || {};
      this.headers = headers.slice();
      this.sortable = opts.sortable !== false;
      this.multi = !!opts.multi;
      this.flashCol = opts.flashCol;
      this.sortCol = opts.sortCol === undefined ? -1 : opts.sortCol;
      this.sortAsc = opts.sortAsc !== false;
      this.onSort = opts.onSort || null;
      this.onDbl = opts.onDbl || null; this.onMenu = opts.onMenu || null; this.onClick = opts.onClick || null; this.onKey = opts.onKey || null;
      this.rows = []; this.view = []; this.sel = new Set(); this.cur = null; this.anchor = null;
      this.el = el("div", { cls: "tbl", tabindex: "0" });
      this.table = el("table");
      this.thead = el("thead"); this.tbody = el("tbody");
      this.table.append(this.thead, this.tbody);
      this.el.append(this.table);
      this.headerTips = {};
      this.renderHead();
      this.tbody.addEventListener("mousedown", (e) => this.mouse(e));
      this.tbody.addEventListener("dblclick", (e) => { const r = this.rowOf(e); if (r !== null && this.onDbl) this.onDbl(this.view[r], e); });
      this.tbody.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const r = this.rowOf(e);
        if (r !== null && !this.sel.has(this.view[r].id)) this.select(this.view[r].id);
        if (this.onMenu) this.onMenu(r === null ? null : this.view[r], e.clientX, e.clientY);
      });
      this.el.addEventListener("keydown", (e) => this.key(e));
    }
    setHeader(i, text) { this.headers[i] = text; this.renderHead(); }
    setHeaderTips(t) { this.headerTips = t; this.renderHead(); }
    renderHead() {
      const tr = el("tr");
      this.headers.forEach((h, i) => {
        const key = String(h).replace("（含息）", "").trim();
        const th = el("th", { cls: this.sortable ? "sortable" : "", tip: this.headerTips[key] }, h);
        if (this.sortable && i === this.sortCol) th.append(el("span", { cls: "arrow" }, this.sortAsc ? "▲" : "▼"));
        if (this.sortable) th.addEventListener("click", () => this.sortBy(i));
        tr.append(th);
      });
      this.thead.innerHTML = ""; this.thead.append(tr);
    }
    sortBy(i, asc) {
      if (asc === undefined) asc = i === this.sortCol ? !this.sortAsc : true;
      this.sortCol = i; this.sortAsc = asc;
      this.renderHead(); this.render();
      if (this.onSort) this.onSort(i, asc);
    }
    setRows(rows) {
      const old = new Map(this.view.map((r) => [r.id, r]));
      rows.forEach((r, i) => { if (r.id === undefined || r.id === null) r.id = r.cells[0] ? r.cells[0].text + "#" + i : String(i); });
      this.rows = rows;
      const ids = new Set(rows.map((r) => r.id));
      [...this.sel].forEach((id) => { if (!ids.has(id)) this.sel.delete(id); });
      if (this.cur !== null && !ids.has(this.cur)) this.cur = null;
      this.render(old);
    }
    render(old) {
      let v = this.rows.slice();
      if (this.sortable && this.sortCol >= 0) {
        const c = this.sortCol, s = this.sortAsc ? 1 : -1;
        v = v.map((r, i) => [r, i]).sort((a, b) => s * cmp(a[0].cells[c] && a[0].cells[c].key, b[0].cells[c] && b[0].cells[c].key) || a[1] - b[1]).map((x) => x[0]);
      }
      this.view = v;
      const scroll = [this.el.scrollTop, this.el.scrollLeft];
      const frag = document.createDocumentFragment();
      for (const r of v) {
        const tr = el("tr", { cls: (r.cls || "") + (this.sel.has(r.id) ? " sel" : "") });
        tr.dataset.id = r.id;
        r.cells.forEach((c, ci) => {
          const td = el("td", { cls: (c.left ? "l" : "") + (c.link ? " link" : "") });
          if (c.html) td.innerHTML = c.html; else td.textContent = c.text;
          if (c.color && !r.cls) td.style.color = c.color;
          if (c.bg) td.style.background = c.bg;
          if (c.bold) td.style.fontWeight = "700";
          if (c.tip) td.dataset.tip = c.tip;
          if (c.tiphtml) td.dataset.tiphtml = c.tiphtml;
          if (old && this.flashCol === ci && !r.cls) {
            const o = old.get(r.id);
            const ok = o && o.cells[ci] && o.cells[ci].key, nk = c.key;
            if (typeof ok === "number" && typeof nk === "number" && ok && nk !== ok && ok < 1e11 && nk < 1e11) {
              td.classList.add(nk > ok ? "flashUp" : "flashDown");
              setTimeout(() => td.classList.remove("flashUp", "flashDown"), 900);
            }
          }
          tr.append(td);
        });
        frag.append(tr);
      }
      this.tbody.innerHTML = "";
      if (!v.length && this.emptyText) { const tr = el("tr"); tr.append(el("td", { cls: "empty", colspan: String(this.headers.length) }, this.emptyText)); frag.append(tr); }
      this.tbody.append(frag);
      this.el.scrollTop = scroll[0]; this.el.scrollLeft = scroll[1];
    }
    rowOf(e) { const tr = e.target.closest("tr"); if (!tr || !tr.dataset.id) return null; return this.view.findIndex((r) => r.id === tr.dataset.id); }
    mouse(e) {
      const r = this.rowOf(e);
      if (r === null || r < 0) return;
      const id = this.view[r].id;
      if (e.button === 2) return;
      if (this.multi && (e.ctrlKey || e.metaKey)) { if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id); this.cur = id; this.anchor = id; }
      else if (this.multi && e.shiftKey && this.anchor !== null) {
        const a = this.view.findIndex((x) => x.id === this.anchor), lo = Math.min(a, r), hi = Math.max(a, r);
        this.sel = new Set(this.view.slice(lo, hi + 1).map((x) => x.id)); this.cur = id;
      } else { this.sel = new Set([id]); this.cur = id; this.anchor = id; }
      this.paintSel();
      if (this.onClick) { const td = e.target.closest("td"); this.onClick(this.view[r], td ? td.cellIndex : -1, e); }
    }
    paintSel() { [...this.tbody.children].forEach((tr) => tr.classList.toggle("sel", this.sel.has(tr.dataset.id))); }
    select(id) {
      this.sel = new Set(id === null || id === undefined ? [] : [id]); this.cur = id; this.anchor = id; this.paintSel();
      const tr = [...this.tbody.children].find((x) => x.dataset.id === id);
      if (tr) tr.scrollIntoView({ block: "nearest" });
    }
    selectAt(i) { if (this.view[i]) this.select(this.view[i].id); }
    current() { return this.cur === null ? null : this.view.find((r) => r.id === this.cur) || null; }
    currentIndex() { return this.cur === null ? -1 : this.view.findIndex((r) => r.id === this.cur); }
    selected() { return this.view.filter((r) => this.sel.has(r.id)); }
    clearSelection() { this.sel.clear(); this.cur = null; this.paintSel(); }
    key(e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = this.currentIndex(), n = this.view.length;
        if (!n) return;
        this.selectAt(i < 0 ? 0 : Math.min(n - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1))));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") { e.preventDefault(); this.copy(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && this.multi) { e.preventDefault(); this.sel = new Set(this.view.map((r) => r.id)); this.paintSel(); return; }
      if (this.onKey) this.onKey(e, this.current());
    }
    copy() {
      const rows = this.selected();
      if (!rows.length) return;
      const lines = [this.headers.join("\t")].concat(rows.map((r) => r.cells.map((c) => c.text).join("\t")));
      navigator.clipboard.writeText(lines.join("\n")).then(() => U.status(`已複製 ${rows.length} 列，可以貼到 Excel`, 3000));
    }
  };

  // 看盤配色：整列文字依今天漲跌上色；漲停紅底白字、跌停綠底白字（同電腦版 tint_rows）
  U.tintRows = function (rows, prices, codeCol, keep) {
    codeCol = codeCol || 0; keep = keep || [];
    for (const r of rows) {
      const cell = r.cells[codeCol];
      if (!cell) continue;
      const q = prices[cell.text] || {};
      if (!q.price || !q.prev) continue;
      const st = C.limitState(cell.text, q);
      if (st) {
        r.cls = st === "up" ? "limitUp" : "limitDown";
        const tip = `今天${st === "up" ? "漲停" : "跌停"}（${C.f2((st === "up" ? q.limit_up : q.limit_down) || q.price)}）`;
        r.cells.forEach((c) => { if (c && !c.tip && !c.tiphtml) c.tip = tip; });
        continue;
      }
      const color = q.price > q.prev ? "var(--GAIN)" : q.price < q.prev ? "var(--LOSS)" : "var(--TEXT)";
      r.cells.forEach((c, i) => { if (c && !keep.includes(i)) c.color = color; });
    }
    return rows;
  };
  U.pnl = (x) => (x > 0.0001 ? "var(--GAIN)" : x < -0.0001 ? "var(--LOSS)" : null);
  U.probColor = (p) => (p >= 0.55 ? "var(--GAIN)" : p <= 0.45 ? "var(--LOSS)" : null);

  // ---------- IndexedDB（大型快取，例如公司基本資料清單）----------
  U.idb = (function () {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("stockcalc", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction("kv", mode); const s = t.objectStore("kv"); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
    return {
      get: (k) => tx("readonly", (s) => s.get(k)).catch(() => null),
      set: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => null),
    };
  })();
  U.ls = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (_e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_e) { /* 空間不足就算了 */ } },
  };

  root.UI = U;
})(window);
