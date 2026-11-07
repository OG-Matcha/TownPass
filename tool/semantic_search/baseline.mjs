// 基準測量：用現有的規則式 searchServices 跑 queries.json，報前 1／前 3 名命中率。
// 之後加向量後，用同一份題目再量一次比較。
// 用法：node tool/semantic_search/baseline.mjs（不需要安裝套件）；結果同時寫到 tool/semantic_search/baseline.json
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

// 載入 tp-a11y.js 的純函式（和 tool/a11y/unit.mjs 相同的做法）
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(read("assets/a11y/tp-a11y.js"), ctx);
const core = ctx.__tpA11yCore;

// 從 my_service_model.dart 讀出 21 個服務（id、標題、說明、網址），避免手抄漂移
function parseServices() {
  const src = read("lib/page/city_service/model/my_service_model.dart");
  const re = /MyServiceItemId\.(\w+) => MyServiceItem\(\s*title: '([^']*)',\s*description: '([^']*)',[\s\S]*?destinationUrl: '([^']*)'/g;
  const out = [];
  for (const m of src.matchAll(re)) out.push({ id: m[1], title: m[2], description: m[3], url: m[4] });
  return out;
}
const all = parseServices();
if (all.length !== 21) throw new Error(`預期 21 個服務，解析到 ${all.length} 個`);

// 情境 A「現況」：App 的 service_catalog handler 實際交給網頁的清單（只有網址或 1999 電話）
const catalogNow = core.toCatalog(
  all
    .filter((s) => s.id === "dedicatedLine" || s.url)
    .map((s) => (s.id === "dedicatedLine" ? { ...s, tel: "1999", url: "" } : s))
);
// 情境 B「21 項全給」：假設 handler 把 21 個都交出來（階段 2 要做的事），規則仍只有原本 8 個服務的關鍵字
const catalogAll = all.map((s) => ({ id: s.id, title: s.title, desc: s.description, url: s.url, tel: "" }));

const queries = JSON.parse(read("tool/semantic_search/queries.json")).queries;
const phrases = JSON.parse(read("tool/semantic_search/phrases.json")).services;

function rank(q, catalog) {
  return core.searchServices(q, catalog).map((r) => r.service.id);
}

function evaluate(catalog) {
  const ids = new Set(catalog.map((s) => s.id));
  const rows = queries.map((q) => {
    const top = rank(q.text, catalog);
    if (q.expectNone) {
      return { id: q.id, category: q.category, text: q.text, top, expectNone: true, correct: top.length === 0 };
    }
    const reachable = q.expected.some((e) => ids.has(e));
    return {
      id: q.id,
      category: q.category,
      text: q.text,
      expected: q.expected,
      top,
      reachable,
      top1: q.expected.includes(top[0]),
      top3: top.slice(0, 3).some((t) => q.expected.includes(t)),
    };
  });
  const scored = rows.filter((r) => !r.expectNone);
  const none = rows.filter((r) => r.expectNone);
  const byCategory = {};
  for (const r of scored) {
    const c = (byCategory[r.category] ??= { n: 0, top1: 0, top3: 0 });
    c.n++;
    c.top1 += r.top1 ? 1 : 0;
    c.top3 += r.top3 ? 1 : 0;
  }
  return {
    catalogSize: catalog.length,
    scored: scored.length,
    top1: scored.filter((r) => r.top1).length,
    top3: scored.filter((r) => r.top3).length,
    unreachable: scored.filter((r) => !r.reachable).length,
    none: { n: none.length, correct: none.filter((r) => r.correct).length },
    byCategory,
    rows,
  };
}

// 每個服務的例句，用規則式能不能在前 3 名找到自己（情境 B）。
// 注意：例句之後會拿去建向量，所以這項只用來看「規則式對哪些服務完全沒輒」，不拿來比命中率。
function coverage(catalog) {
  const out = {};
  for (const [id, v] of Object.entries(phrases)) {
    const hits = v.phrases.filter((p) => rank(p, catalog).slice(0, 3).includes(id)).length;
    out[id] = { title: v.title, phrases: v.phrases.length, top3: hits };
  }
  return out;
}

const result = {
  generatedAt: new Date().toISOString(),
  engine: "tp-a11y.js searchServices（規則式：關鍵字、服務名稱、相同兩字詞）",
  keywordServices: Object.keys(core.KEYWORDS),
  now: evaluate(catalogNow),
  all21: evaluate(catalogAll),
  phraseCoverage: coverage(catalogAll),
};
writeFileSync(new URL("tool/semantic_search/baseline.json", root), JSON.stringify(result, null, 2) + "\n");

const pct = (a, b) => (b ? `${a}/${b} (${Math.round((a / b) * 100)}%)` : "-");
for (const [label, key] of [["情境 A 現況（網頁只拿到 8 個服務）", "now"], ["情境 B 21 項全給 + 現有規則", "all21"]]) {
  const e = result[key];
  console.log(`\n== ${label} ==`);
  console.log(`  前 1 名：${pct(e.top1, e.scored)}　前 3 名：${pct(e.top3, e.scored)}　期望服務不在清單內：${e.unreachable} 題`);
  console.log(`  無對應題正確回「無結果」：${pct(e.none.correct, e.none.n)}`);
  for (const [c, v] of Object.entries(e.byCategory)) console.log(`  - ${c}：前1 ${pct(v.top1, v.n)}　前3 ${pct(v.top3, v.n)}`);
}
console.log("\n== 例句覆蓋（情境 B，前 3 名找得到自己的比例）==");
for (const [id, v] of Object.entries(result.phraseCoverage)) console.log(`  ${id.padEnd(20)} ${v.top3}/${v.phrases}  ${v.title}`);
