// 單元測試：tp-a11y.js 的 mergeRanking（規則＋語意合併）與 toCatalog（保留尚未開通的服務）。
// 用法：node tool/semantic_search/merge.test.mjs（不需要安裝套件）
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { spawnSync } from "node:child_process";

const src = readFileSync(new URL("../../assets/a11y/tp-a11y.js", import.meta.url), "utf8");
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(src, ctx);
const core = ctx.__tpA11yCore;

let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    想要 ${JSON.stringify(want)}\n    得到 ${JSON.stringify(got)}`}`);
}
const ok = (name, cond, detail = "") => eq(name + (detail && !cond ? `（${detail}）` : ""), !!cond, true);

// 假目錄：12 個服務，分數用函式生成
const catalog = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, title: `服務${i}`, desc: `說明${i}`, url: `https://example.invalid/${i}`, tel: "" }));
catalog[11] = { id: "s11", title: "尚未開通的服務", desc: "x", url: "", tel: "", unavailable: true };
/** 大部分服務分數相近（0.80 上下），指定的服務高出一截 */
function scoresWith(high = {}) {
  const scores = {};
  catalog.forEach((sv, i) => (scores[sv.id] = 0.8 + (i % 3) * 0.005));
  return { ...scores, ...high };
}
const noRule = [];
const ruleHit = (id, score, reasons) => ({ service: catalog.find((s) => s.id === id), score, reasons });
const ids = (hits) => hits.map((h) => h.service.id);

// ---- 無聲退回：scores 不可用就原封不動回傳規則結果 ----
const rules = [ruleHit("s1", 5, ["借書"])];
for (const [name, bad] of [["null", null], ["undefined", undefined], ["字串", "x"], ["陣列", [0.9, 0.8]], ["數字", 3]]) {
  ok(`scores 是${name} → 原封不動回傳規則結果`, core.mergeRanking(rules, bad, catalog) === rules);
}
ok("分數少於 minScores → 退回規則結果", core.mergeRanking(rules, { s0: 0.9, s1: 0.8, s2: 0.7 }, catalog) === rules);
ok("所有分數相同（標準差 0）→ 退回規則結果", core.mergeRanking(rules, Object.fromEntries(catalog.map((s) => [s.id, 0.8])), catalog) === rules);
ok("分數不是有限數字的服務被忽略，其餘仍可算", Array.isArray(core.mergeRanking(noRule, { ...scoresWith({ s3: 0.95 }), s5: NaN, s6: Infinity, s7: "0.9" }, catalog)));

// ---- 語意把突出的服務排前面 ----
let hits = core.mergeRanking(noRule, scoresWith({ s3: 0.95 }), catalog);
eq("突出的服務排第一，其他不夠突出的不列", ids(hits), ["s3"]);
ok("標記為語意命中（畫面會顯示「意思和你說的很接近」）", hits[0].semantic === true && hits[0].reasons.length === 0);

hits = core.mergeRanking(noRule, scoresWith({ s3: 0.95, s4: 0.93 }), catalog);
eq("兩個都突出：分數高的在前", ids(hits), ["s3", "s4"]);

// ---- 沒有任何服務特別像：語意不表態 ----
eq("沒有服務突出、也沒有關鍵字 → 空（畫面會說找不到並提供 1999）", ids(core.mergeRanking(noRule, scoresWith(), catalog)), []);
eq("沒有服務突出，但說到關鍵字的仍然列出", ids(core.mergeRanking([ruleHit("s1", 5, ["借書"])], scoresWith(), catalog)), ["s1"]);

// ---- 規則的雜訊會被擋掉 ----
eq("只有相同兩字詞的弱規則命中（沒有 reasons），語意又不像 → 不列", ids(core.mergeRanking([ruleHit("s2", 1, [])], scoresWith({ s3: 0.95 }), catalog)), ["s3"]);
hits = core.mergeRanking([ruleHit("s3", 5, ["借書"])], scoresWith({ s3: 0.95 }), catalog);
ok("規則與語意都指向同一個服務 → 分數比單獨語意更高", hits[0].score > core.mergeRanking(noRule, scoresWith({ s3: 0.95 }), catalog)[0].score);

// ---- 其他 ----
eq("尚未開通的服務一樣可以被找到，並保留標記", core.mergeRanking(noRule, scoresWith({ s11: 0.96 }), catalog).map((h) => [h.service.id, !!h.service.unavailable]), [["s11", true]]);
const many = Object.fromEntries(catalog.map((s, i) => [s.id, 0.7 + (i < 8 ? 0.2 : 0)]));
ok("最多列 5 個", core.mergeRanking(noRule, many, catalog).length <= 5);
ok("沒給 catalog 也不會出錯（用內建備用清單）", Array.isArray(core.mergeRanking([], { dedicatedLine: 0.9, districtOffice: 0.8, reportIssue: 0.8, reservation: 0.8, library: 0.8, locationSearch: 0.8 })));
ok("設定值與註解一致（abstainZ 介於實測的 1.91 與 2.07 之間）", core.SEMANTIC.abstainZ > 1.91 && core.SEMANTIC.abstainZ < 2.07);

// ---- toCatalog：保留尚未開通的服務，但網址與電話仍要檢查 ----
const list = [
  { id: "a", title: "有網址", description: "d", url: "https://example.invalid/a" },
  { id: "b", title: "有電話", description: "d", tel: "1999" },
  { id: "c", title: "沒入口", description: "d", unavailable: true },
  { id: "d", title: "危險網址", description: "d", url: "javascript:alert(1)" },
  { id: "e", title: "怪電話", description: "d", tel: "1999;rm -rf" },
  { id: "f", description: "沒有標題" },
  { title: "沒有 id" },
  null,
  "字串",
];
const c = core.toCatalog(list);
eq("toCatalog 保留所有有 id 與標題的服務", c.map((x) => x.id), ["a", "b", "c", "d", "e"]);
eq("有網址或電話的不是 unavailable", c.map((x) => !!x.unavailable), [false, false, true, true, true]);
eq("javascript: 網址被丟掉、怪電話被丟掉（因此標成尚未開通，而不是可點的連結）", [c[3].url, c[4].tel], ["", ""]);
eq("不是陣列 → null（網頁會用備用清單）", core.toCatalog({}), null);
eq("空陣列 → null", core.toCatalog([]), null);

// ---- parity.json 要是用最新的 JS 算出來的（Dart 測試拿它當標準答案）----
const parity = spawnSync(process.execPath, [new URL("./make_parity.mjs", import.meta.url).pathname, "--check"], { encoding: "utf8" });
eq("parity.json 是用最新的 JS 與題目算出來的（過期了要重跑 make_parity.mjs）", parity.status, 0);
if (parity.status !== 0) console.log(parity.stderr);

console.log(fail ? `\n${fail} 項失敗` : "\n全部通過");
process.exit(fail ? 1 : 0);
