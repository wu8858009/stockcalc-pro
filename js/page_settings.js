/* 設定（對照電腦版 SettingsPage）。手續費、股利、預估手續費等設定會同步到 Google（電腦版也用同一份）；
   自動更新頻率、通知只存在這個瀏覽器。元大帳號、啟用下單、單筆上限只能在電腦版設定（網頁不碰帳號密碼）。 */
(function () {
  "use strict";
  const C = window.Core, U = window.UI, T = window.CONTENT;
  const el = U.el, money = C.money;

  class SettingsPage {
    constructor() {
      const App = this.App = window.App;
      this.el = el("div", { cls: "scroll" });
      this.el.classList.add("scroll");
      const s = App.store.settings;
      const group = (title, ...kids) => el("div", { cls: "group" }, el("span", { cls: "gtitle" }, title), ...kids);
      const form = (rows) => { const f = el("div", { cls: "form" }); rows.forEach(([k, w]) => { if (k === null) f.append(el("div", { cls: "full" }, w)); else f.append(el("label", { cls: "k", tip: T.FORM_TIPS[k] }, k), w); }); return f; };

      this.disc = new U.NumBox({ min: 0.1, max: 10, decimals: 2, suffix: " 折", value: s.fee_discount, width: "160px" });
      this.minfee = new U.NumBox({ min: 0, max: 100, suffix: " 元", value: s.min_fee, width: "160px" });
      this.minodd = new U.NumBox({ min: 0, max: 100, suffix: " 元", value: s.min_fee_odd, width: "160px" });
      const g1 = group("手續費", form([["手續費折數（10 = 不打折）", this.disc.input], ["整股最低手續費", this.minfee.input], ["零股最低手續費", this.minodd.input],
        [null, U.hint("手續費 = 成交金額 × 0.1425% × 折數，無條件捨去，不足最低收費以最低收費計。\n證交稅：股票 0.3%、ETF 0.1%、債券 ETF 免徵（至 2026-12-31），代號 00 開頭視為 ETF。")]]));

      this.auto = U.check("自動更新股價", s.auto_refresh);
      this.sec = new U.NumBox({ min: 5, max: 3600, suffix: " 秒", value: s.refresh_sec, width: "160px" });
      this.hours = U.check("只在交易時段（週一至週五 9:00–13:35）自動更新", s.only_trading_hours);
      this.deduct = U.check("未實現損益扣除預估賣出手續費與證交稅", s.unreal_deduct_cost);
      this.estFee = U.combo([["同券商 App（不打折、最低 20 元，和元大 App 一致）", "broker"], ["依我的手續費折數與最低收費", "mine"]]);
      this.estFee.value = s.est_fee_mode || "broker";
      this.notifyCb = U.check("到價時跳出瀏覽器通知（網頁在背景時）", s.notify_popup !== false);
      this.permLbl = el("span", { cls: "hint" });
      const nrow = el("div", { cls: "row" }, this.notifyCb, U.btn("允許通知", () => this.askPermission()), U.btn("測試通知", () => this.testNotify()), this.permLbl);
      const g2 = group("報價與顯示", form([[null, this.auto], ["更新間隔", this.sec.input], [null, this.hours], [null, this.deduct], [null, nrow], ["預估賣出手續費", this.estFee],
        [null, U.hint("「自動更新股價」「更新間隔」「通知」只存在這個瀏覽器；其他設定會和電腦版、其他裝置同步。")]]));

      this.divFee = new U.NumBox({ min: 0, max: 100, suffix: " 元／次", value: s.div_fee === undefined ? 10 : s.div_fee, width: "160px" });
      this.divNhi = U.check("扣二代健保補充保費（單次股利達 20,000 元扣 2.11%）", s.div_nhi !== false);
      const g3 = group("現金股利計算", form([["股利匯費", this.divFee.input], [null, this.divNhi],
        [null, U.hint("匯費依銀行而定（同一家銀行常為 0 元，跨行多為 10 元）。可領股數以「除息日前一天」的持股計算。")]]));

      this.orderInfo = el("div", { cls: "rich" });
      const g4 = group("連線下單（元大 API）", this.orderInfo,
        U.hint("網頁版不會儲存元大帳號密碼，也不直接連元大。委託會放進你的 Google 試算表，由開著的電腦版（勾選「代送網頁送來的委託」）檢查後送出；" +
          "元大帳號、啟用下單、單筆上限都只能在電腦版的「設定」修改。"));

      this.syncInfo = el("div", { cls: "rich" });
      this.old = el("input", { type: "password", placeholder: "目前密碼", autocomplete: "current-password" });
      this.pw1 = el("input", { type: "password", placeholder: "新密碼（至少 6 個字）", autocomplete: "new-password" });
      this.pw2 = el("input", { type: "password", placeholder: "再輸入一次新密碼", autocomplete: "new-password" });
      const g5 = group("Google 雲端同步", this.syncInfo,
        form([["變更密碼", el("div", { cls: "row" }, this.old, this.pw1, this.pw2, U.btn("變更", () => this.changePassword()))]]),
        el("div", { cls: "row", style: { marginTop: "8px" } }, U.btn("立即同步", () => this.syncNow()), U.btn("下載備份（JSON）", () => this.backup()),
          U.btn("登出這台裝置", () => this.logout(), "danger")),
        U.hint("變更密碼後，其他已登入的裝置（含電腦版）要用新密碼重新登入。"));

      const save = U.btn("儲存設定", () => this.save(), "primary", "快捷鍵：Ctrl+S");
      this.el.append(g1, g2, g3, g4, g5, el("div", { cls: "row", style: { margin: "14px 0" } }, save),
        el("div", { cls: "hint", style: { whiteSpace: "pre-wrap", marginBottom: "20px" } }, `${T.APP_NAME} v${T.VERSION}（網頁版）\n資料存在你的 Google 試算表，電腦版與每台裝置同步。`));
      this.el.querySelectorAll("label.k").forEach((x) => { x.style.minWidth = "180px"; });
    }
    onShow() { this.load(); }
    load() {                                  // 其他裝置改了設定後，再開這頁時顯示最新值
      const s = this.App.store.settings;
      this.disc.set(s.fee_discount, false); this.minfee.set(s.min_fee, false); this.minodd.set(s.min_fee_odd, false);
      this.auto.input.checked = !!s.auto_refresh; this.sec.set(s.refresh_sec, false); this.hours.input.checked = !!s.only_trading_hours;
      this.deduct.input.checked = !!s.unreal_deduct_cost; this.estFee.value = s.est_fee_mode || "broker"; this.notifyCb.input.checked = s.notify_popup !== false;
      this.divFee.set(s.div_fee === undefined ? 10 : s.div_fee, false); this.divNhi.input.checked = s.div_nhi !== false;
      const d = (this.App.order && this.App.order.desktop) || {};
      this.orderInfo.innerHTML = `單筆委託上限：<b>${money(s.order_max_amount || 100000)} 元</b>（電腦版設定）<br>` +
        (d.online ? `電腦版在線：${U.esc(d.device || "")}　API 下單 ${d.enabled ? "<b style='color:var(--LOSS)'>已啟用</b>" : "未啟用"}　代送網頁委託 ${d.relay ? "<b style='color:var(--LOSS)'>已開啟</b>" : "未開啟"}`
          : "電腦版目前離線" + (d.last ? `（最後在線 ${U.esc(d.last)}）` : ""));
      const st = this.App.store;
      this.syncInfo.innerHTML = `同步狀態：${U.esc(this.App.syncLbl ? this.App.syncLbl.textContent.replace("☁ ", "") : "")}` +
        `　交易 ${st.transactions.length} 筆、股利 ${st.dividends.length} 筆、觀察 ${st.watchlist.length} 檔、觸價單 ${st.triggers.length} 筆`;
      this.updatePerm();
    }
    updatePerm() {
      const p = "Notification" in window ? Notification.permission : "unsupported";
      this.permLbl.textContent = { granted: "已允許", denied: "已封鎖（請到瀏覽器網站設定開啟）", default: "尚未允許", unsupported: "這個瀏覽器不支援通知" }[p];
    }
    async askPermission() { if ("Notification" in window) { await Notification.requestPermission(); this.updatePerm(); } }
    testNotify() {
      U.toast("🔔 股票到價提醒（測試）", "到買點、到賣點時會像這樣通知你");
      if ("Notification" in window && Notification.permission === "granted") { try { new Notification("🔔 股票到價提醒（測試）", { body: "到買點、到賣點時會像這樣通知你", icon: "icons/icon-192.png" }); } catch (_e) { /* 手機要用 Service Worker */ } }
      else U.status("瀏覽器通知尚未允許：按「允許通知」", 5000);
    }
    save() {
      const App = this.App, s = App.store.settings;
      [this.disc, this.minfee, this.minodd, this.sec, this.divFee].forEach((b) => b.commit());
      Object.assign(s, { fee_discount: this.disc.value(), min_fee: this.minfee.value(), min_fee_odd: this.minodd.value(),
        auto_refresh: this.auto.input.checked, refresh_sec: this.sec.value(), only_trading_hours: this.hours.input.checked,
        unreal_deduct_cost: this.deduct.input.checked, div_fee: this.divFee.value(), div_nhi: this.divNhi.input.checked,
        est_fee_mode: this.estFee.value, notify_popup: this.notifyCb.input.checked });
      App.store.save(); App.applyTimer(); App.refreshAll();
      if (App.calc && App.calc.recalc) App.calc.recalc();
      if (App.order) App.order.recalc();
      U.status("設定已儲存", 3000);
    }
    async changePassword() {
      if (this.pw1.value.length < 6) { await U.warn("新密碼至少 6 個字"); return; }
      if (this.pw1.value !== this.pw2.value) { await U.warn("兩次輸入的新密碼不一樣"); return; }
      try {
        const st = this.App.store, salt = (await st.status()).salt;
        const r = await st.changePassword(this.old.value, this.pw1.value, salt);
        if (r.error) throw new Error(r.error === "wrong_password" ? "目前密碼錯誤" : r.error === "locked" ? "錯誤太多次，請 10 分鐘後再試" : r.error);
        this.old.value = this.pw1.value = this.pw2.value = "";
        await U.info("密碼已變更。其他裝置（含電腦版）要用新密碼重新登入。");
      } catch (e) { await U.warn(`變更失敗：${e.message}`); }
    }
    async syncNow() {
      const st = this.App.store;
      U.status("同步中…");
      try { await st.flush(); await st.reload(); this.load(); U.status("已同步", 3000); } catch (e) { U.status(`同步失敗：${e.message}`, 6000); }
    }
    backup() {
      const st = this.App.store;
      const data = { app: "stockcalc", version: T.VERSION, exported: `${C.today()} ${C.now().time}`, transactions: st.transactions, dividends: st.dividends,
        watchlist: st.watchlist, triggers: st.triggers, settings: Object.fromEntries(Object.entries(st.settings).filter(([k]) => !window.Store.LOCAL_KEYS.includes(k))) };
      const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })), download: `股票資料備份_${C.today()}.json` });
      document.body.append(a); a.click(); a.remove();
    }
    async logout() {
      if (!await U.ask("登出這台裝置？資料仍保存在 Google，之後輸入密碼即可再登入。")) return;
      await this.App.store.logout();
      location.reload();
    }
  }
  window.App = Object.assign(window.App || {}, { SettingsPage });
})();
