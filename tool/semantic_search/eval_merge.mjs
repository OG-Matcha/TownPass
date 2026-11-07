// 量測「規則＋語意」合併後的命中率，與 baseline.json 比較。
// 語意分數來自 scores.json（用 eval_main.dart 在模擬器上以真模型算出，見 run_eval.sh）；
// 合併用的是 tp-a11y.js 裡真正的 mergeRanking，所以這裡量到的就是 App 內會發生的結果。
//
// 用法：node tool/semantic_search/eval_merge.mjs [--variant sim-sim]
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const args = process.argv.slice(2);
const variant = args.includes("--variant") ? args[args.indexOf("--variant") + 1] : "sim-sim";

const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(read("assets/a11y/tp-a11y.js"), ctx);
const core = ctx.__tpA11yCore;

// 與 baseline.mjs 相同的 21 項清單（App 現在交給網頁的格式；沒入口的標 unavailable）
function parseServices() {
  const src = read("lib/page/city_service/model/my_service_model.dart");
  const re = /MyServiceItemId\.(\w+) => MyServiceItem\(\s*title: '([^']*)',\s*description: '([^']*)',[\s\S]*?destinationUrl: '([^']*)'/g;
  return [...src.matchAll(re)].map((m) => ({ id: m[1], title: m[2], description: m[3], url: m[4] }));
}
const all = parseServices();
if (all.length !== 21) throw new Error(`預期 21 個服務，解析到 ${all.length} 個`);
const catalog = core.toCatalog(
  all.map((s) => (s.id === "dedicatedLine" ? { ...s, tel: "1999", url: "" } : s))
);
if (catalog.length !== 21) throw new Error("toCatalog 應保留全部 21 個服務（含尚未開通的）");

const queries = JSON.parse(read("tool/semantic_search/queries.json")).queries;
const scoresFile = JSON.parse(read("tool/semantic_search/scores.json"));
let holdout = [];
try {
  holdout = JSON.parse(read("tool/semantic_search/queries_holdout.json")).queries;
} catch {}
const hasHoldoutScores = holdout.length > 0 && holdout.every((q) => scoresFile.variants[variant]?.[q.id]);
const scoresOf = (v, id) => scoresFile.variants[v]?.[id]?.scores;

function evaluate(v, cfg, list = queries) {
  const rows = list.map((q) => {
    const scores = scoresOf(v, q.id);
    const rule = core.searchServices(q.text, catalog);
    const hits = cfg === "rules" ? rule : core.mergeRanking(rule, scores, catalog, cfg).map((h) => h);
    const top = hits.map((h) => h.service.id);
    if (q.expectNone) return { id: q.id, category: q.category, none: true, correct: top.length === 0, top };
    return {
      id: q.id,
      category: q.category,
      text: q.text,
      expected: q.expected,
      top,
      top1: q.expected.includes(top[0]),
      top3: top.slice(0, 3).some((t) => q.expected.includes(t)),
    };
  });
  const scored = rows.filter((r) => !r.none);
  const none = rows.filter((r) => r.none);
  const byCategory = {};
  for (const r of scored) {
    const c = (byCategory[r.category] ??= { n: 0, top1: 0, top3: 0 });
    c.n++;
    c.top1 += r.top1;
    c.top3 += r.top3;
  }
  return {
    n: scored.length,
    top1: scored.filter((r) => r.top1).length,
    top3: scored.filter((r) => r.top3).length,
    none: { n: none.length, correct: none.filter((r) => r.correct).length },
    byCategory,
    rows,
  };
}

// 只看語意（不合併、不設門檻）：每題把相似度排序
function semanticOnly(v, list = queries) {
  const rows = list.filter((q) => !q.expectNone).map((q) => {
    const s = scoresOf(v, q.id);
    const top = Object.entries(s).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return { id: q.id, top1: q.expected.includes(top[0]), top3: top.slice(0, 3).some((t) => q.expected.includes(t)) };
  });
  return { n: rows.length, top1: rows.filter((r) => r.top1).length, top3: rows.filter((r) => r.top3).length };
}

const pct = (a, b) => `${a}/${b} (${Math.round((a / b) * 100)}%)`;
const baseline = JSON.parse(read("tool/semantic_search/baseline.json"));
const B = baseline.all21;

console.log(`向量用法：${variant}　模型：${scoresFile.meta.model}　裝置：${scoresFile.meta.device}`);
console.log(`基準（現有規則、21 項）：前 1 ${pct(B.top1, B.scored)}　前 3 ${pct(B.top3, B.scored)}　無對應題 ${B.none.correct}/${B.none.n}`);

for (const v of Object.keys(scoresFile.variants)) {
  const s = semanticOnly(v);
  console.log(`\n[${v}] 只看語意排名（無門檻）：前 1 ${pct(s.top1, s.n)}　前 3 ${pct(s.top3, s.n)}`);
  // 無對應題與有對應題的最高相似度分布，看門檻能不能分開
  const noneMax = queries.filter((q) => q.expectNone).map((q) => Math.max(...Object.values(scoresOf(v, q.id))));
  const hitBest = queries
    .filter((q) => !q.expectNone)
    .map((q) => Math.max(...q.expected.map((e) => scoresOf(v, q.id)[e])))
    .sort((a, b) => a - b);
  console.log(
    `  無對應題的最高相似度：${noneMax.map((x) => x.toFixed(3)).join("、")}；` +
      `有對應題「正確服務的相似度」最低 ${hitBest[0].toFixed(3)}、中位 ${hitBest[Math.floor(hitBest.length / 2)].toFixed(3)}、最高 ${hitBest.at(-1).toFixed(3)}`
  );
}

const cfg = core.SEMANTIC;
const e = evaluate(variant, cfg);
console.log(`\n== 採用設定 ${JSON.stringify(cfg)}（${variant}）==`);
console.log(`前 1 名：${pct(e.top1, e.n)}　前 3 名：${pct(e.top3, e.n)}　無對應題回無結果：${pct(e.none.correct, e.none.n)}`);
for (const [c, x] of Object.entries(e.byCategory)) {
  const b = B.byCategory[c];
  console.log(`  ${c.padEnd(11)} 前3 ${pct(x.top3, x.n).padEnd(11)} （基準 ${pct(b.top3, b.n)}）`);
}
console.log("\n沒答對的題：");
for (const r of e.rows.filter((r) => (r.none ? !r.correct : !r.top3))) {
  console.log(`  ${r.id} ${r.none ? "（應無結果）" : r.text} → ${r.top.slice(0, 3).join(",") || "（無結果）"}${r.expected ? "　期望 " + r.expected.join(",") : ""}`);
}

let h = null;
if (hasHoldoutScores) {
  const rules = evaluate(variant, "rules", holdout);
  h = evaluate(variant, cfg, holdout);
  console.log(`\n== 保留題組（參數定案後才量，共 ${holdout.length} 題，其中 ${h.none.n} 題無對應）==`);
  console.log(`只看規則（現況）：前 1 ${pct(rules.top1, rules.n)}　前 3 ${pct(rules.top3, rules.n)}　無對應題 ${rules.none.correct}/${rules.none.n}`);
  const so = semanticOnly(variant, holdout);
  console.log(`只看語意排名：  前 1 ${pct(so.top1, so.n)}　前 3 ${pct(so.top3, so.n)}`);
  console.log(`規則＋語意：    前 1 ${pct(h.top1, h.n)}　前 3 ${pct(h.top3, h.n)}　無對應題回無結果 ${pct(h.none.correct, h.none.n)}`);
  for (const r of h.rows.filter((r) => (r.none ? !r.correct : !r.top3))) {
    console.log(`  沒答對：${r.id} ${r.none ? "（應無結果）" : r.text} → ${r.top.slice(0, 3).join(",") || "（無結果）"}${r.expected ? "　期望 " + r.expected.join(",") : ""}`);
  }
  const zs = holdout.map((q) => {
    const vals = Object.values(scoresOf(variant, q.id));
    const mean = vals.reduce((a, b) => a + b) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return { q, z: (Math.max(...vals) - mean) / sd };
  });
  console.log(
    `  最高 z 值：有對應題最低 ${Math.min(...zs.filter((x) => !x.q.expectNone).map((x) => x.z)).toFixed(2)}、` +
      `無對應題最高 ${Math.max(...zs.filter((x) => x.q.expectNone).map((x) => x.z)).toFixed(2)}（abstainZ ${cfg.abstainZ}）`
  );
  h = { rules: { top1: rules.top1, top3: rules.top3, n: rules.n, none: rules.none }, semanticOnly: so, merged: { top1: h.top1, top3: h.top3, n: h.n, none: h.none, byCategory: h.byCategory }, rows: h.rows };
} else {
  console.log("\n（scores.json 還沒有保留題組的分數；跑 run_eval.sh 後再量）");
}

writeFileSync(
  new URL("tool/semantic_search/semantic-result.json", root),
  JSON.stringify(
    {
      variant,
      config: cfg,
      model: scoresFile.meta.model,
      device: scoresFile.meta.device,
      baselineAll21: { top1: B.top1, top3: B.top3, n: B.scored, none: B.none },
      merged: { top1: e.top1, top3: e.top3, n: e.n, none: e.none, byCategory: e.byCategory },
      semanticOnly: Object.fromEntries(Object.keys(scoresFile.variants).map((v) => [v, semanticOnly(v)])),
      rows: e.rows,
      holdout: h,
    },
    null,
    2
  ) + "\n"
);
