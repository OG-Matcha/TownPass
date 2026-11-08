// 建置時抓「公開資料裡的地名別名／簡稱」存成 public/data/aliases.json，給目的地搜尋的縮寫詞典用。
// 用法：node --experimental-strip-types scripts/fetch-aliases.mjs（要讀 src/lib/*.ts，所以要帶旗標；npm run fetch:aliases）
//
// 來源（皆可合法再利用，出處寫在每筆 source）：
//   1. Wikidata（CC0）：臺北捷運車站（P16 = Q714810）與臺北車站方圓 16 公里內有座標的條目，取中文標籤與別名（skos:altLabel）
//   2. OpenStreetMap（ODbL，須標示「© OpenStreetMap contributors」）：臺北市、新北市有 short_name / alt_name 的車站、醫院、
//      公園、圖書館、博物館、景點、商場等（不收一般店家）
//   3. 內政部地政司「臺灣地區地名資料_具有地標意義公共設施類」（政府資料開放授權條款第 1 版）：臺北市、新北市有「別名」欄的
// 對應規則（寧缺勿濫）：
//   - 條目先用「正式名稱」對到我們索引裡已有的目標（捷運站、places.json、poi.json），有座標就要在 1.5 公里內才算同一個
//   - 對不到 → 地標：離最近的無障礙出入口 ≤ 400 公尺才指到那個捷運站（例：臺北小巨蛋 → 台北小巨蛋站）
//   - 捷運站條目的別名要含站名本身（「忠孝復興」可；「華山站」「榮總站」這類規劃時期站名不收，會指錯站）
//   - 丟掉：1 個字、通用詞（醫院、車站…）、簡體字、old_name、已能直接搜到的寫法（多餘）、跟別的目標正式名稱撞名的
//   - 同一個別名指到 2～3 個不同目標 → 保留成歧義（全部給使用者選）；超過 3 個 → 丟
import { readFileSync, writeFileSync } from "node:fs";
import { buildIndex, formsOf, meters, norm, stationForms, stationPoint, SHORTCUTS, PLACE_ALIASES } from "../src/lib/placeRules.ts";
import { stationsOf } from "../src/lib/route.ts";

const UA = { "User-Agent": "codefest2026-map-vue/0.1 (build-time alias fetch; matchaskill@gmail.com)" };
const read = (f) => JSON.parse(readFileSync(new URL(`../public/data/${f}.json`, import.meta.url), "utf8"));
const OUT = new URL("../public/data/aliases.json", import.meta.url);

const stations = stationsOf(read("network"));
const entrances = read("elevators").items;
const places = read("places").map((p) => ({ id: p.id, name: p.name, kind: p.kind, lat: p.lat, lng: p.lng }));
const pois = read("poi").items;
// idxHand：含手寫別名（只用來算手寫詞典涵蓋率）；idx：只有正式名稱（拿掉 PLACE_ALIASES 與 poi.json 的手寫 aliases），
// 這樣「多餘」只表示正式名稱本來就搜得到，公開資料和手寫重疊的別名仍會留在 aliases.json（拿掉手寫也撐得住）
const idxHand = buildIndex(stations, places, pois);
const handPlaceAliases = structuredClone(PLACE_ALIASES);
for (const k of Object.keys(PLACE_ALIASES)) delete PLACE_ALIASES[k];
const idx = buildIndex(stations, places, pois.map((p) => ({ ...p, aliases: [] })));

// ---- 目標：key = "station:台北車站" / "place:id" / "poi:id" ----
const tKey = (t) => `${t.type}:${t.id}`;
const placeIds = new Set(places.map((p) => p.id));
const targetOfHit = (h) => (h.type === "station" ? { type: "station", id: h.station } : { type: placeIds.has(h.poi.id) ? "place" : "poi", id: h.poi.id });
const pointOf = (t) => (t.type === "station" ? stationPoint(t.id, entrances) : idx.pois.find((p) => p.id === t.id));
/** 正式名稱寫法 → 目標（同一寫法多個目標都記） */
const formTargets = new Map();
for (const { form, hit } of idx.forms) {
  const t = targetOfHit(hit);
  const m = formTargets.get(form) ?? new Map();
  m.set(tKey(t), t);
  formTargets.set(form, m);
}
function nearestStation(lat, lng) {
  let best = null;
  for (const e of entrances) {
    const d = meters(lat, lng, e.lat, e.lng);
    if (!best || d < best.d) best = { s: e.station, d };
  }
  return best;
}

const GENERIC = new Set(
  "車站 捷運站 捷運 火車站 醫院 公園 圖書館 運動中心 區公所 公所 市場 夜市 學校 大學 國小 國中 高中 廟 寺 教堂 博物館 美術館 公司 大樓 百貨 商場 廣場 中心 分館 總館 院區 台北 台灣 臺北 新北 台北市 新北市 臺北市 市政府 政府 停車場 公車站 菜市場 黃昏市場 媽祖宮 伯公亭 兒童公園 鳥人 監察委員 地下街 體育館 福德祠 土地公廟 福德宮 媽祖廟 站 北站 南站 東站 西站".split(" ").map(norm),
);
// 常見簡體字（Wikidata 的 zh 標籤常混簡體，台灣使用者不會這樣打）；用跳脫碼寫，避免繁體檢查工具誤報
const SIMP = /[车医区东门龙馆园国纪广场会学专业书图运动万华兴乐汤汇阳观关厅铁湾桥边线这亚乡际岛宁临寻荣发电层仓处]/u;

// ---- 1. Wikidata ----
async function sparql(q) {
  const u = new URL("https://query.wikidata.org/sparql");
  u.searchParams.set("query", q);
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u, { headers: { ...UA, Accept: "application/sparql-results+json" } });
    if (r.ok) return (await r.json()).results.bindings;
    console.warn("SPARQL", r.status, "retry");
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
  throw new Error("SPARQL failed");
}
const LANGS = `FILTER(LANG(?v) IN ("zh-tw","zh-hant","zh"))`;
async function wikidata() {
  // 臺北捷運車站
  const st = await sparql(`SELECT ?x ?v ?k ?coord WHERE {
    ?x wdt:P16 wd:Q714810 . OPTIONAL { ?x wdt:P625 ?coord }
    { ?x rdfs:label ?v BIND("label" AS ?k) } UNION { ?x skos:altLabel ?v BIND("alias" AS ?k) } ${LANGS} }`);
  // 臺北車站方圓 16 公里內有座標、有中文別名的條目（P131+ 遞迴查詢會逾時，改用 wikibase:around）。
  // 排除：行政區劃、道路、公車站、中小學、公司行號、人物、事件、職位、維基清單
  const geo = await sparql(`SELECT ?x ?v ?k ?coord WHERE {
    SERVICE wikibase:around { ?x wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(121.54 25.05)"^^geo:wktLiteral ; wikibase:radius "16" . }
    FILTER EXISTS { ?x skos:altLabel ?any FILTER(LANG(?any) IN ("zh-tw","zh-hant","zh")) }
    FILTER NOT EXISTS { ?x wdt:P31/wdt:P279* ?bad VALUES ?bad { wd:Q56061 wd:Q83620 wd:Q953806 wd:Q9842 wd:Q149566 wd:Q159334 wd:Q4830453 wd:Q5 wd:Q1190554 wd:Q1656682 wd:Q4164871 wd:Q13406463 } }
    { ?x rdfs:label ?v BIND("label" AS ?k) } UNION { ?x skos:altLabel ?v BIND("alias" AS ?k) } ${LANGS} }`);
  const items = new Map();
  const add = (rows, metro) => {
    for (const b of rows) {
      const id = b.x.value.split("/").pop();
      const it = items.get(id) ?? { source: `wikidata:${id}`, license: "CC0-1.0", metro, labels: new Set(), aliases: new Set(), lat: null, lng: null };
      it.metro ||= metro;
      (b.k.value === "label" ? it.labels : it.aliases).add(b.v.value);
      const m = b.coord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      if (m) [it.lng, it.lat] = [Number(m[1]), Number(m[2])];
      items.set(id, it);
    }
  };
  add(st, true);
  add(geo, false);
  return [...items.values()];
}

// ---- 2. OpenStreetMap（Overpass）----
async function osm() {
  const q = `[out:json][timeout:120];
area["name:en"~"^(Taipei|New Taipei)$"]["admin_level"="4"]->.a;
nwr(area.a)["name"][~"^(short_name|alt_name|short_name:zh|alt_name:zh|short_name:zh-Hant|alt_name:zh-Hant)$"~"."]->.all;
(
  nwr.all["railway"="station"];
  nwr.all["amenity"~"^(hospital|library|townhall|courthouse|university|college|arts_centre|theatre|marketplace|bus_station|community_centre|social_facility)$"];
  nwr.all["leisure"~"^(park|stadium|sports_centre|garden)$"];
  nwr.all["tourism"~"^(attraction|museum|zoo|theme_park|gallery|viewpoint)$"];
  nwr.all["historic"];
  nwr.all["shop"~"^(mall|department_store)$"];
  nwr.all["office"="government"];
  nwr.all["amenity"="place_of_worship"]["wikidata"];
  nwr.all["place"~"^(neighbourhood|quarter|suburb)$"];
);
out center tags;`;
  const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
  if (!r.ok) throw new Error(`Overpass ${r.status}`);
  const j = await r.json();
  return j.elements.map((e) => {
    const t = e.tags;
    const split = (v) => (v ? v.split(";").map((x) => x.trim()).filter(Boolean) : []);
    const labels = new Set([t.name, t["name:zh"], t["name:zh-Hant"], t["name:zh-TW"], t.official_name, t["official_name:zh"]].filter(Boolean));
    const aliases = new Set(["short_name", "alt_name", "short_name:zh", "alt_name:zh", "short_name:zh-Hant", "alt_name:zh-Hant"].flatMap((k) => split(t[k])));
    const lat = e.lat ?? e.center?.lat ?? null;
    const lng = e.lon ?? e.center?.lon ?? null;
    const metro = t.railway === "station" && (t.station === "subway" || /捷運/.test(t.network ?? ""));
    return { source: `osm:${e.type}/${e.id}`, license: "ODbL-1.0", metro, labels, aliases, lat, lng };
  });
}


// ---- 3. 內政部 地名資料（具有地標意義公共設施類）----
const MOI_URL = "https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/ADE629B4-0A35-418B-A623-E54281140BCB/resource/D31502F8-FC87-4B4D-AFDF-4AF22A326510/download";
async function moi() {
  const r = await fetch(MOI_URL, { headers: UA });
  if (!r.ok) throw new Error(`MOI ${r.status}`);
  const lines = (await r.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const h = lines[0].split(",");
  const col = (c, k) => c[h.indexOf(k)]?.trim() ?? "";
  const out = [];
  for (const l of lines.slice(1)) {
    const c = l.split(","); // 這份 CSV 沒有引號欄位（已實測）；欄數不對就跳過
    if (c.length !== h.length) continue;
    if (!/^(臺北市|新北市)$/.test(col(c, "County")) || !col(c, "AnotherName")) continue;
    const name = col(c, "PlaceName");
    out.push({
      source: `moi-placename:${col(c, "TownCode")}:${name}`,
      license: "政府資料開放授權條款-第1版",
      metro: false,
      labels: new Set([name]),
      aliases: new Set(col(c, "AnotherName").split(/[、;；/]/).map((x) => x.trim()).filter(Boolean)),
      lat: Number(col(c, "Latitude")) || null,
      lng: Number(col(c, "Longitude")) || null,
    });
  }
  return out;
}

// ---- 對應 ----
const stats = { items: {}, mapped: {}, viaName: {}, viaNearest: {}, aliasesRaw: {}, dropped: {} };
const bump = (o, src, k = "_") => {
  o[src] ??= {};
  o[src][k] = (o[src][k] ?? 0) + 1;
};
const NEAR_M = 400;
// 有座標的「事件」條目（空難、案件、博覽會…）不是目的地
const EVENTISH = /事件|空難|案$|案件|殺童|奧運|運動會|博覽會|遊行|游行|示威|選舉|地震|火災/;
/** 條目 → 我們的目標（或 null） */
function resolve(it) {
  const found = new Map();
  for (const l of it.labels) {
    const forms = it.metro ? stationForms(l.replace(/^捷運/, "")) : formsOf({ id: "", name: l, kind: "", lat: 0, lng: 0 });
    for (const f of forms) for (const [k, t] of formTargets.get(f) ?? []) if (!it.metro || t.type === "station") found.set(k, t);
  }
  // 有座標：同名但距離超過 1.5 公里 → 不是同一個（例如別縣市的同名公園）
  const close = [...found.values()].filter((t) => {
    if (it.lat == null) return true;
    const p = pointOf(t);
    return !p || meters(it.lat, it.lng, p.lat, p.lng) <= 1500;
  });
  if (close.length === 1) return { target: close[0], via: "name" };
  if (close.length > 1) return null; // 正式名稱本身就歧義，不猜
  if (it.metro || it.lat == null) return null;
  const n = nearestStation(it.lat, it.lng);
  if (n && n.d <= NEAR_M && !EVENTISH.test([...it.labels].join("|"))) return { target: { type: "station", id: n.s }, via: "nearest", meters: n.d };
  return null;
}

const pairs = []; // 所有對應到的 (別名, 目標)，含多餘的；算涵蓋率用
async function main() {
  const fetched = {};
  const srcList = [];
  try {
    fetched.wikidata = await wikidata();
    srcList.push({ name: "Wikidata", license: "CC0-1.0", url: "https://query.wikidata.org/", query: "臺北捷運車站（P16=Q714810）與 P131+ 臺北市/新北市、有座標的條目之中文標籤與別名" });
  } catch (e) {
    console.error("Wikidata 失敗", e.message);
  }
  try {
    fetched.osm = await osm();
    srcList.push({ name: "OpenStreetMap", license: "ODbL-1.0", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", query: "Overpass：臺北市、新北市有 short_name / alt_name 的地物" });
  } catch (e) {
    console.error("OSM 失敗", e.message);
  }
  try {
    fetched.moi = await moi();
    srcList.push({ name: "內政部地政司 臺灣地區地名資料_具有地標意義公共設施類", license: "政府資料開放授權條款-第1版", url: "https://data.gov.tw/dataset/40454", query: "臺北市、新北市有 AnotherName（別名）的地標" });
  } catch (e) {
    console.error("內政部地名資料 失敗", e.message);
  }
  if (!Object.keys(fetched).length) throw new Error("沒有任何來源抓到資料，不覆寫 aliases.json");

  for (const [src, items] of Object.entries(fetched)) {
    stats.items[src] = { _: items.length };
    for (const it of items) {
      const r = resolve(it);
      if (!r) continue;
      bump(stats.mapped, src);
      bump(r.via === "name" ? stats.viaName : stats.viaNearest, src);
      const base = r.target.type === "station" ? norm(r.target.id).replace(/站$/, "") : null;
      const cands = new Set([...it.aliases, ...(r.via === "nearest" ? it.labels : [])]);
      for (const raw of cands) {
        bump(stats.aliasesRaw, src);
        const a = norm(raw.replace(/[（(].*?[)）]/g, ""));
        const drop = (why) => bump(stats.dropped, src, why);
        if ([...a].length < 2) { drop("1 個字"); continue; }
        if (GENERIC.has(a)) { drop("通用詞"); continue; }
        if (SIMP.test(a)) { drop("簡體字"); continue; }
        if (/[a-z]{4,}/.test(a)) { drop("外文"); continue; }
        if (it.metro && base && !base.split("/").some((x) => a.includes(x))) { drop("規劃時期站名"); continue; }
        pairs.push({ alias: a, target: r.target, source: it.source, license: it.license, via: r.via, meters: r.meters });
      }
    }
  }

  // 逐別名整理
  const byAlias = new Map();
  for (const p of pairs) {
    const m = byAlias.get(p.alias) ?? new Map();
    if (!m.has(tKey(p.target))) m.set(tKey(p.target), p);
    byAlias.set(p.alias, m);
  }
  const out = [];
  const dropAgg = { 多餘: 0, 撞正式名稱: 0, 歧義過多: 0 };
  for (const [alias, m] of byAlias) {
    const own = formTargets.get(alias);
    const list = [...m.values()];
    if (own) {
      // 已經是某個目標的正式寫法：同目標 → 多餘；不同目標 → 撞名，丟
      if (list.every((p) => own.has(tKey(p.target)))) dropAgg.多餘++;
      else dropAgg.撞正式名稱++;
      continue;
    }
    if (list.length > 3) { dropAgg.歧義過多++; continue; }
    for (const p of list)
      out.push({ alias, target: p.target, source: p.source, license: p.license, ...(p.via === "nearest" ? { via: "nearest-station", meters: p.meters } : {}) });
  }
  out.sort((a, b) => a.alias.localeCompare(b.alias, "zh-Hant") || tKey(a.target).localeCompare(tKey(b.target)));

  // ---- 手寫詞典有多少也在公開資料裡 ----
  const pubSet = new Set(pairs.map((p) => `${p.alias}→${tKey(p.target)}`));
  const pubAliasOnly = new Set(pairs.map((p) => p.alias));
  const hand = [];
  for (const k of Object.keys(SHORTCUTS)) {
    const s = idxHand.shortcuts.find((x) => x.key === norm(k));
    if (!s || !s.hits.length) continue; // 只有分類（#醫院）的不算
    hand.push({ alias: norm(k), targets: s.hits.map((h) => tKey(targetOfHit(h))), from: "SHORTCUTS" });
  }
  for (const [id, as] of Object.entries(handPlaceAliases)) for (const a of as) hand.push({ alias: norm(a), targets: [`place:${id}`], from: "PLACE_ALIASES" });
  for (const p of idxHand.pois) if (!placeIds.has(p.id)) for (const a of p.aliases ?? []) hand.push({ alias: norm(a), targets: [`poi:${p.id}`], from: "poi.json aliases（fetch-poi.mjs 手寫）" });
  const cov = {};
  const covered = [];
  const notCovered = [];
  for (const h of hand) {
    cov[h.from] ??= { n: 0, same: 0, aliasOnly: 0 };
    cov[h.from].n++;
    if (h.targets.some((t) => pubSet.has(`${h.alias}→${t}`))) {
      cov[h.from].same++;
      if (h.from === "SHORTCUTS") covered.push(h.alias);
    } else {
      if (pubAliasOnly.has(h.alias)) cov[h.from].aliasOnly++;
      if (h.from === "SHORTCUTS") notCovered.push(h.alias);
    }
  }
  const handKeys = new Set(hand.map((h) => h.alias));
  const newOnes = [...new Set(out.map((o) => o.alias))].filter((a) => !handKeys.has(a));

  const doc = {
    fetchedAt: new Date().toISOString(),
    sources: srcList,
    stats: { ...stats, dropAgg, kept: out.length, keptAliases: new Set(out.map((o) => o.alias)).size, newAliases: newOnes.length, handCoverage: cov, handCovered: covered },
    items: out,
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
  console.log(JSON.stringify({ ...doc.stats, handCovered: undefined }, null, 1));
  console.log("\n手寫 SHORTCUTS 也在公開資料（同目標）：", covered.join("、"));
  console.log("\n手寫 SHORTCUTS 沒有公開來源：", notCovered.join("、"));
  console.log("\n公開資料新增：", newOnes.map((a) => `${a}→${out.filter((o) => o.alias === a).map((o) => o.target.id).join("|")}`).join("、"));
}
await main();
