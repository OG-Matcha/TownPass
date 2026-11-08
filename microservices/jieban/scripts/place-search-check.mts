// 目的地理解・規則層檢查（不含語意層）：node --experimental-strip-types scripts/place-search-check.mts [測試集.json ...]
// 預設跑 scripts/place-dev.json（自寫開發集）與 scripts/place-blind.json（另一人寫的盲測集，實作凍結後才看）。
// 測試集格式：[["輸入", 類型, 期望, 來源層], ...]
//   類型：station / place / poi / ambiguous（期望以 | 分隔，全部都要在前 3）/ category / none
//   來源層：alias / name / fuzzy / semantic（semantic 的句子規則層應回空，由 place-semantic-check.mjs 另測）
import { existsSync, readFileSync } from "node:fs";
import { PLACE_ALIASES, SHORTCUTS, buildIndex, nearestEntrance, searchByRules, unresolvedShortcuts, type OpenAlias, type PoiLite, type RuleHit } from "../src/lib/placeRules.ts";
import { stationsOf, type Network } from "../src/lib/route.ts";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}.json`, import.meta.url), "utf8"));
const stations = stationsOf(read("network") as Network);
const entrances = read("elevators").items;
const places: PoiLite[] = (read("places") as PoiLite[]).map((p) => ({ id: p.id, name: p.name, kind: p.kind, lat: p.lat, lng: p.lng, aliases: [] }));
const pois: PoiLite[] = read("poi").items;
// HAND=0 → 拿掉所有手寫別名（SHORTCUTS 除分類外、PLACE_ALIASES、poi.json 的 aliases），只留正式名稱＋公開資料別名：量公開資料單獨能撐多少
if (process.env.HAND === "0") {
  for (const k of Object.keys(SHORTCUTS)) if (!SHORTCUTS[k].every((t) => t.startsWith("#"))) delete SHORTCUTS[k];
  for (const k of Object.keys(PLACE_ALIASES)) delete PLACE_ALIASES[k];
  for (const p of pois) p.aliases = [];
}
// 公開資料別名（scripts/fetch-aliases.mjs）；OPEN_ALIASES=0 → 只用手寫詞典（比較前後用）
const openAliases: OpenAlias[] = process.env.OPEN_ALIASES === "0" || !existsSync(new URL("../public/data/aliases.json", import.meta.url)) ? [] : read("aliases").items;
const idx = buildIndex(stations, places, pois, openAliases);

type Case = [string, string, string, string];
// 盲測集格式：{q, accept:[可接受的站名／地點名／「類別:醫院」], type}；accept 空 = 應回空。轉成 [q, type, want, why]
type Blind = { q: string; accept: string[]; type: string };
const toCase = (x: Case | Blind): Case => (Array.isArray(x) ? x : [x.q, x.accept.length ? (x.accept.every((a) => a.startsWith("類別:")) ? "category" : "any") : "none", x.accept.join("|"), x.type === "describe" ? "semantic" : x.type]);
const n2 = (s: string) => s.replaceAll("臺", "台").replace(/\s/g, "");
const files = process.argv.slice(2).length ? process.argv.slice(2) : ["scripts/place-dev.json", "scripts/place-blind.json"].filter((f) => existsSync(f));
let code = 0;

const bad = unresolvedShortcuts(idx);
if (bad.length) {
  console.error("詞典目標解析不到：", bad.join("、"));
  code = 1;
}
// 每個 POI 都要算得出最近的無障礙出入口
const far = idx.pois.map((p) => ({ p, n: nearestEntrance(p, entrances) })).filter((x) => !x.n || x.n.meters > 3000);
console.log(`公開資料別名 ${idx.shortcuts.filter((x) => x.source === "open").length} 個（${openAliases.length} 筆對應）；地點 ${idx.pois.length} 筆（places ${places.length} + poi 去重後 ${idx.pois.length - places.length}）；離最近無障礙出入口超過 3 公里：${far.length} 筆${far.length ? "（" + far.map((x) => x.p.name).join("、") + "）" : ""}`);

const nameOf = (h: RuleHit) => (h.type === "station" ? h.station : h.poi.name);
const fullOf = (h: RuleHit) => (h.type === "station" ? h.station : (h.poi.fullName ?? h.poi.name));
const stringsOf = (h: RuleHit) => (h.type === "station" ? [h.station, h.station.replace(/站$/, "")] : [h.poi.name, h.poi.fullName ?? ""]).filter(Boolean).map(n2);
const has = (hits: RuleHit[], w: string, type?: string) => hits.some((h) => (nameOf(h) === w || fullOf(h) === w) && (!type || h.type === type));
/** 盲測集：任一結果的任一寫法 = 任一可接受答案 */
const hasAny = (hits: RuleHit[], want: string, category: string | null) =>
  want.split("|").some((w) => (w.startsWith("類別:") ? category === w.slice(3) : hits.some((h) => stringsOf(h).includes(n2(w)))));
const SEM = new Set(["semantic"]);
for (const f of files) {
  const cases = (JSON.parse(readFileSync(f, "utf8")) as (Case | Blind)[]).map(toCase);
  const byType: Record<string, { n: number; ok: number }> = {};
  const misses: string[] = [];
  let ruleCases = 0;
  let ruleOk = 0;
  let semanticLeak = 0;
  let semanticN = 0;
  const t0 = performance.now();
  for (const [text, type, want, why] of cases) {
    const r = searchByRules(idx, text, entrances, { limit: 3 });
    const names = r.hits.map(nameOf);
    let ok: boolean;
    if (SEM.has(why) && type !== "none") {
      // 語意句：規則層不該亂答（回空或回對都算過；回錯才算漏）
      semanticN++;
      ok = r.hits.length === 0 || (type === "category" ? want.split("|").some((w) => r.category === w.replace(/^類別:/, "")) : type === "any" ? hasAny(r.hits, want, r.category) : has(r.hits, want));
      if (!ok) semanticLeak++;
      if (!ok) misses.push(`  語意句被規則答錯: ${JSON.stringify(text)} → ${names.join("|")}${r.category ? ` [${r.category}]` : ""}`);
      continue;
    }
    if (type === "none") ok = r.hits.length === 0;
    else if (type === "category") ok = want.split("|").some((w) => r.category === w.replace(/^類別:/, ""));
    else if (type === "ambiguous") ok = want.split("|").every((w) => has(r.hits, w));
    else if (type === "any") ok = hasAny(r.hits, want, r.category);
    else ok = has(r.hits, want, type);
    ruleCases++;
    if (ok) ruleOk++;
    const k = `${type}/${why}`;
    byType[k] ??= { n: 0, ok: 0 };
    byType[k].n++;
    if (ok) byType[k].ok++;
    else misses.push(`  ${JSON.stringify(text)} 要 ${type}:${want} 得 ${names.map((n, i) => `${r.hits[i].type}:${n}(${r.hits[i].why})`).join(" | ") || "∅"}${r.category ? ` [分類 ${r.category}]` : ""}`);
  }
  const ms = performance.now() - t0;
  console.log(`\n${f}：規則可答的 ${ruleCases} 句，前 3 命中 ${ruleOk}（${((100 * ruleOk) / Math.max(1, ruleCases)).toFixed(0)}%）；語意句 ${semanticN} 句規則層答錯 ${semanticLeak}；平均 ${(ms / cases.length).toFixed(2)} ms/句`);
  for (const [k, v] of Object.entries(byType).sort()) console.log(`  ${k.padEnd(20)} ${v.ok}/${v.n}`);
  if (misses.length) console.log("漏的：\n" + misses.join("\n"));
  if (f.includes("dev") && ruleOk / Math.max(1, ruleCases) < 0.9) code = 1;
}
process.exit(code);
