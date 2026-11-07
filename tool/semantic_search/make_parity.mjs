// 用 tp-a11y.js 的真實函式算出「標準答案」，存成 parity.json。
// Dart 版（lib/util/semantic/service_search.dart）的測試逐題比對它，確保兩邊排序一致。
// 改了 JS 或 Dart 任一邊的搜尋／合併邏輯，都要重跑這支並讓兩邊測試通過。
// 用法：node tool/semantic_search/make_parity.mjs          （重新產生 parity.json）
//       node tool/semantic_search/make_parity.mjs --check  （只比對、不寫檔；parity.json 過期就失敗）
import { readFileSync, writeFileSync } from "node:fs";
const check = process.argv.includes("--check");
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(read("assets/a11y/tp-a11y.js"), ctx);
const core = ctx.__tpA11yCore;

const src = read("lib/page/city_service/model/my_service_model.dart");
const re = /MyServiceItemId\.(\w+) => MyServiceItem\(\s*title: '([^']*)',\s*description: '([^']*)',[\s\S]*?destinationUrl: '([^']*)'/g;
const all = [...src.matchAll(re)].map((m) => ({ id: m[1], title: m[2], description: m[3], url: m[4] }));
if (all.length !== 21) throw new Error("預期 21 個服務");
const catalog = core.toCatalog(all.map((s) => (s.id === "dedicatedLine" ? { ...s, tel: "1999", url: "" } : s)));

const queries = [
  ...JSON.parse(read("tool/semantic_search/queries.json")).queries,
  ...JSON.parse(read("tool/semantic_search/queries_holdout.json")).queries,
];
const scores = JSON.parse(read("tool/semantic_search/scores.json")).variants["sim-sim"];
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const rows = queries.map((q) => {
  const rule = core.searchServices(q.text, catalog);
  const s = scores[q.id]?.scores ?? null;
  const merged = core.mergeRanking(rule, s, catalog);
  return {
    id: q.id,
    text: q.text,
    rule: rule.map((h) => [h.service.id, h.score, h.reasons]),
    merged: merged.map((h) => [h.service.id, r6(h.score), !!h.semantic, h.reasons]),
  };
});
// 關鍵字表與常見問題也要一致（52 題只碰得到其中一部分）
const out = JSON.stringify({ n: rows.length, keywords: core.KEYWORDS, examples: core.SEARCH_EXAMPLES, rows }) + "\n";
const target = new URL("tool/semantic_search/parity.json", root);
if (check) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {}
  if (current !== out) {
    console.error("parity.json 已過期：JS 的搜尋邏輯、關鍵字、範例句或測試題改過，請執行 node tool/semantic_search/make_parity.mjs，並確認 Dart 測試仍通過。");
    process.exit(1);
  }
  console.log(`parity.json 是最新的（${rows.length} 題）`);
} else {
  writeFileSync(target, out);
  console.log(`parity.json：${rows.length} 題`);
}
