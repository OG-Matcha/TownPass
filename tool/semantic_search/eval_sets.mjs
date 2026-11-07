// 各題組的命中率（規則只看、規則＋語意、規則＋語意＋範圍外例句），改關鍵字或合併方式前後各跑一次比較。
// 題組：main / holdout / oos 是「改關鍵字前就看過」的；v2 是在改關鍵字前寫好、沒用來調整任何東西的。
// 用法：node tool/semantic_search/eval_sets.mjs [邊際值，預設 0]
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const margin = Number(process.argv[2] ?? 0);
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(read("assets/a11y/tp-a11y.js"), ctx);
const core = ctx.__tpA11yCore;
const re = /MyServiceItemId\.(\w+) => MyServiceItem\(\s*title: '([^']*)',\s*description: '([^']*)',[\s\S]*?destinationUrl: '([^']*)'/g;
const all = [...read("lib/page/city_service/model/my_service_model.dart").matchAll(re)].map((m) => ({ id: m[1], title: m[2], description: m[3], url: m[4] }));
const catalog = core.toCatalog(all.map((s) => (s.id === "dedicatedLine" ? { ...s, tel: "1999", url: "" } : s)));
const sc = JSON.parse(read("tool/semantic_search/scores.json")).variants;
const sets = Object.fromEntries(
  ["queries", "queries_holdout", "queries_oos", "queries_v2"].map((f) => [f.replace("queries_", "").replace("queries", "main"), JSON.parse(read(`tool/semantic_search/${f}.json`)).queries])
);

function hitsFor(q, mode) {
  const rule = core.searchServices(q.text, catalog);
  if (mode === "rules") return rule.map((h) => h.service.id);
  const sv = sc["sim-sim"][q.id].scores;
  let cfg = core.SEMANTIC;
  if (mode === "oos" && sc.oos[q.id].scores.outOfScope - Math.max(...Object.values(sv)) >= margin) cfg = { ...cfg, abstainZ: Infinity };
  return core.mergeRanking(rule, sv, catalog, cfg).map((h) => h.service.id);
}
const pct = (a, b) => `${String(a).padStart(2)}/${String(b).padEnd(2)} ${String(Math.round((a / b) * 100)).padStart(3)}%`;
console.log(`邊際值 ${margin}。格式：有對應題前3命中　｜　範圍外題正確回無結果`);
for (const mode of ["rules", "merged", "oos"]) {
  console.log(`\n[${{ rules: "只看規則", merged: "規則＋語意", oos: "規則＋語意＋範圍外例句" }[mode]}]`);
  for (const [name, list] of Object.entries(sets)) {
    const pos = list.filter((q) => !q.expectNone);
    const none = list.filter((q) => q.expectNone);
    const p = pos.filter((q) => hitsFor(q, mode).slice(0, 3).some((t) => q.expected.includes(t))).length;
    const n = none.filter((q) => hitsFor(q, mode).length === 0).length;
    console.log(`  ${name.padEnd(8)} ${pos.length ? "命中 " + pct(p, pos.length) : "".padEnd(12)}  ${none.length ? "範圍外 " + pct(n, none.length) : ""}${name === "v2" ? "　← 沒用來調整的題組" : ""}`);
  }
}
if (process.argv.includes("--detail")) {
  for (const q of sets.v2) {
    const h = hitsFor(q, "oos");
    const bad = q.expectNone ? h.length > 0 : !h.slice(0, 3).some((t) => q.expected.includes(t));
    if (bad) console.log(`  v2 沒答對 ${q.id} ${q.text} → ${h.slice(0, 3).join(",") || "無"}${q.expected ? "　期望 " + q.expected : ""}`);
  }
}
