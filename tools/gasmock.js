/* 本機測試用：在 Node 裡執行 cloud/Code.gs，模擬 SpreadsheetApp、PropertiesService 等 Google 服務。
   node tools/gasmock.js [port] [state.json]
   UrlFetchApp 會用 curl 真的去抓（行情轉送測試用）。 */
"use strict";
const fs = require("fs"), path = require("path"), http = require("http"), vm = require("vm"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const PORT = Number(process.argv[2] || 8790);
const STATE = process.argv[3] || path.join(__dirname, "..", "..", "gasmock_state.json");
let state = { sheets: {}, props: {}, cache: {} };
try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (_e) { /* 新的 */ }
const save = () => fs.writeFileSync(STATE, JSON.stringify(state));

function makeSheet(name) {
  if (!state.sheets[name]) state.sheets[name] = [];
  const rows = () => state.sheets[name];
  const sheet = {
    getName: () => name,
    getLastRow: () => rows().length,
    getMaxRows: () => Math.max(1000, rows().length),
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) { const row = rows()[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? "" : row[c - 1 + j]); out.push(o); }
          return out;
        },
        getValue() { return this.getValues()[0][0]; },
        setValues(v) {
          for (let i = 0; i < v.length; i++) {
            while (rows().length < r + i) rows().push([]);
            const row = rows()[r - 1 + i];
            for (let j = 0; j < v[i].length; j++) row[c - 1 + j] = v[i][j] === null || v[i][j] === undefined ? "" : String(v[i][j]);
          }
          return this;
        },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, clearContent() {
          for (let i = 0; i < nr; i++) if (rows()[r - 1 + i]) rows()[r - 1 + i] = [];
          return this;
        },
      };
    },
    setFrozenRows() {},
    appendRow(v) { rows().push(v.map((x) => (x === null || x === undefined ? "" : String(x)))); },
    deleteRow(r) { rows().splice(r - 1, 1); },
    deleteRows(r, n) { rows().splice(r - 1, n); },
  };
  return sheet;
}
const SpreadsheetApp = {
  getActive: () => ({
    getSheetByName: (n) => (state.sheets[n] ? makeSheet(n) : null),
    insertSheet: (n) => makeSheet(n),
  }),
};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (k in state.props ? state.props[k] : null),
    setProperty: (k, v) => { state.props[k] = String(v); },
    setProperties: (o) => { Object.assign(state.props, o); },
    deleteProperty: (k) => { delete state.props[k]; },
    getProperties: () => Object.assign({}, state.props),
  }),
};
const CacheService = {
  getScriptCache: () => ({
    get: (k) => { const e = state.cache[k]; return e && e.x > Date.now() ? e.v : null; },
    put: (k, v, s) => { if (String(v).length > 100000) throw new Error("too big"); state.cache[k] = { v: String(v), x: Date.now() + (s || 600) * 1000 }; },
    remove: (k) => { delete state.cache[k]; },
    getAll: (ks) => { const o = {}; ks.forEach((k) => { const e = state.cache[k]; if (e && e.x > Date.now()) o[k] = e.v; }); return o; },
  }),
};
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const Utilities = {
  DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
  computeDigest: (alg, s) => [...crypto.createHash(alg).update(s, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
  base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString("base64"),
  getUuid: () => crypto.randomUUID(),
  formatDate: (d, tz, fmt) => {
    const t = new Date(d.getTime() + 8 * 3600000), p = (n) => String(n).padStart(2, "0");
    return fmt.replace("yyyy", t.getUTCFullYear()).replace("MM", p(t.getUTCMonth() + 1)).replace("dd", p(t.getUTCDate()))
      .replace("HH", p(t.getUTCHours())).replace("mm", p(t.getUTCMinutes())).replace("ss", p(t.getUTCSeconds()));
  },
};
const ContentService = { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) };
function curl(o) {
  const args = ["-s", "-L", "--max-time", "20", "-w", "\n__HTTP__%{http_code}"];
  Object.entries(o.headers || {}).forEach(([k, v]) => { args.push("-H", k + ": " + v); });
  args.push(o.url);
  try {
    const out = execFileSync("curl", args, { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
    const i = out.lastIndexOf("\n__HTTP__");
    const code = Number(out.slice(i + 9)), text = out.slice(0, i);
    return { getResponseCode: () => code, getContentText: () => text };
  } catch (_e) { return null; }
}
const UrlFetchApp = { fetch: (url, o) => curl(Object.assign({ url }, o || {})), fetchAll: (list) => list.map(curl) };
const ctx = vm.createContext({ SpreadsheetApp, PropertiesService, CacheService, LockService, Utilities, ContentService, UrlFetchApp, console, JSON, Date, Math });
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "cloud", "Code.gs"), "utf8"), ctx);

http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json; charset=utf-8" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  if (req.method === "GET") { res.writeHead(200, cors); return res.end(ctx.doGet().s); }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const out = ctx.doPost({ postData: { contents: body } });
    save();
    res.writeHead(200, cors);
    res.end(out.s);
  });
}).listen(PORT, () => console.log("gasmock on http://localhost:" + PORT + "  state=" + STATE));
