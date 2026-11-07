// 實驗：加入「範圍外例句」後，語意搜尋能不能分辨「資料裡沒有對應服務」的題。
// 規則（看分數之前就定好）：一句話對範圍外例句的最高相似度 ≥ 對 21 個服務的最高相似度 + 邊際值（預設 0），
// 就不列出語意結果（只留規則裡「真的提到名稱或關鍵字」的結果）。
// 通過標準（同樣事先定好）：新寫的 24 題範圍外題，正確回無結果的比例要比現況高；
// 且 49 題有對應的題（30 題組＋保留題組）不能有任何一題被誤拒答、前 3 名命中率不能下降。
//
// 用法：node tool/semantic_search/eval_oos.mjs [邊際值]
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const margin = Number(process.argv[2] ?? 0);

const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(read("assets/a11y/tp-a11y.js"), ctx);
const core = ctx.__tpA11yCore;

const src = read("lib/page/city_service/model/my_service_model.dart");
const re = /MyServiceItemId\.(\w+) => MyServiceItem\(\s*title: '([^']*)',\s*description: '([^']*)',[\s\S]*?destinationUrl: '([^']*)'/g;
const all = [...src.matchAll(re)].map((m) => ({ id: m[1], title: m[2], description: m[3], url: m[4] }));
const catalog = core.toCatalog(all.map((s) => (s.id === "dedicatedLine" ? { ...s, tel: "1999", url: "" } : s)));

const scores = JSON.parse(read("tool/semantic_search/scores.json")).variants;
const sets = {
  main: JSON.parse(read("tool/semantic_search/queries.json")).queries,
  holdout: JSON.parse(read("tool/semantic_search/queries_holdout.json")).queries,
  oos: JSON.parse(read("tool/semantic_search/queries_oos.json")).queries,
};

function run(q, m) {
  const sv = scores["sim-sim"][q.id].scores;
  const oos = scores.oos[q.id].scores.outOfScope;
  const best = Math.max(...Object.values(sv));
  const gated = m !== null && oos - best >= m;
  const rule = core.searchServices(q.text, catalog);
  const cfg = gated ? { ...core.SEMANTIC, abstainZ: Infinity } : core.SEMANTIC;
  const hits = core.mergeRanking(rule, sv, catalog, cfg).map((h) => h.service.id);
  return { gated, hits, oos, best };
}

function summarize(m) {
  const out = {};
  const pos = [...sets.main, ...sets.holdout].filter((q) => !q.expectNone);
  const posRows = pos.map((q) => ({ q, ...run(q, m) }));
  out.pos = {
    n: pos.length,
    falseAbstain: posRows.filter((r) => r.gated).map((r) => `${r.q.id} ${r.q.text}`),
    top3: posRows.filter((r) => r.hits.slice(0, 3).some((t) => r.q.expected.includes(t))).length,
    lost: posRows.filter((r) => !r.hits.slice(0, 3).some((t) => r.q.expected.includes(t))).map((r) => `${r.q.id} ${r.q.text}`),
  };
  const oldNone = [...sets.main, ...sets.holdout].filter((q) => q.expectNone);
  const oldRows = oldNone.map((q) => ({ q, ...run(q, m) }));
  out.oldNone = { n: oldNone.length, correct: oldRows.filter((r) => r.hits.length === 0).length, wrong: oldRows.filter((r) => r.hits.length).map((r) => `${r.q.id} ${r.q.text} → ${r.hits}`) };
  const freshRows = sets.oos.map((q) => ({ q, ...run(q, m) }));
  out.fresh = { n: freshRows.length, correct: freshRows.filter((r) => r.hits.length === 0).length, wrong: freshRows.filter((r) => r.hits.length).map((r) => `${r.q.id} ${r.q.text} → ${r.hits}`), rows: freshRows };
  return out;
}

const pct = (a, b) => `${a}/${b} (${Math.round((a / b) * 100)}%)`;
const show = (label, s) => {
  console.log(`\n== ${label} ==`);
  console.log(`有對應題 前3 ${pct(s.pos.top3, s.pos.n)}　誤拒答 ${s.pos.falseAbstain.length} 題${s.pos.falseAbstain.length ? "：" + s.pos.falseAbstain.join("；") : ""}`);
  if (s.pos.lost.length) console.log(`  前3 沒中：${s.pos.lost.join("；")}`);
  console.log(`舊的 6 題範圍外（已看過）：${pct(s.oldNone.correct, s.oldNone.n)}${s.oldNone.wrong.length ? "　錯：" + s.oldNone.wrong.join("；") : ""}`);
  console.log(`新寫的 24 題範圍外：${pct(s.fresh.correct, s.fresh.n)}`);
  for (const w of s.fresh.wrong) console.log(`  錯：${w}`);
};

show("現況（不用範圍外例句）", summarize(null));
show(`加範圍外例句，邊際值 ${margin}（事先定好的設定）`, summarize(margin));

console.log("\n-- 邊際值敏感度（僅供參考，不用來挑設定） --");
for (const m of [-0.03, -0.02, -0.01, 0, 0.01, 0.02]) {
  const s = summarize(m);
  console.log(`邊際 ${String(m).padStart(5)}：新 24 題 ${pct(s.fresh.correct, s.fresh.n).padEnd(11)} 舊 6 題 ${s.oldNone.correct}/${s.oldNone.n}　有對應題誤拒答 ${s.pos.falseAbstain.length}　前3 ${s.pos.top3}/${s.pos.n}`);
}

console.log("\n-- 新 24 題：對範圍外 vs 對最像的服務 --");
for (const r of summarize(margin).fresh.rows) {
  console.log(`${r.q.id} ${r.q.category.padEnd(12)} oos ${r.oos.toFixed(3)}　服務最高 ${r.best.toFixed(3)}　差 ${(r.oos - r.best).toFixed(3)}　${r.gated ? "拒答" : "放行"}　${r.q.text}`);
}
