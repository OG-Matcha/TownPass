// 目的地搜尋（「去一個地方」）：使用者打字或用講的，回傳最多 3 筆地點，每筆附要去的捷運站與最近的無障礙出口。
// 介面固定，給畫面用。內部：規則層（placeRules.ts：縮寫詞典 → 名稱 → 容錯）先答；規則沒中才問裝置端 e5 語意
// （「我要去看病」→ 醫院類；閒聊低於門檻回空）。模型沒載好、超時 → 只有規則。不支援門牌地址。
import { computed, ref } from "vue";
import { embedBackend, intentReady, warmIntent, workerRequest } from "./intent";
import { entrances, short, stations } from "./planner";
import { places } from "./places";
import {
  buildIndex,
  categoryHits,
  looksLikeSpecificName,
  nearestEntrance,
  searchByRules,
  type EntranceLite,
  type Index,
  type Near,
  type OpenAlias,
  type PoiLite,
  type RuleHit,
} from "./placeRules";

export type PlaceHit = {
  /** station：捷運站；place：places.json 的市府場館；poi：開放資料擴充的地點（醫院、公園、區公所…） */
  type: "station" | "place" | "poi";
  id: string;
  /** 顯示名稱，例如「台大醫院」 */
  name: string;
  /** 第二行，例如「台大醫院站 1 號出口・有電梯」 */
  sub: string;
  /** 規劃路線用的目的地車站（站名，與 localStorage dest 同格式） */
  station: string;
  /** 怎麼找到的：alias 縮寫詞典、name 名稱、fuzzy 容錯、semantic 語意 */
  why: "alias" | "name" | "fuzzy" | "semantic";
  score: number;
  /** 地點種類（醫院、公園…）；車站為「捷運站」 */
  kind?: string;
  /** 官方全名（name 是顯示用短名，例如「台北榮總」→「臺北榮民總醫院」） */
  fullName?: string;
  /** 地點座標（車站沒有） */
  lat?: number;
  lng?: number;
  /** 出站後要走的出口與直線距離（地點才有） */
  exit?: string;
  meters?: number;
  /** 分類查詢（醫院／公園…）時，這批結果屬於哪一類 */
  category?: string;
};

/** 分類快捷鈕：按了等於搜尋 query */
export const CATEGORY_CHIPS: { label: string; query: string }[] = [
  { label: "醫院", query: "醫院" },
  { label: "公園", query: "公園" },
  { label: "區公所", query: "區公所" },
];

// ---- 資料 ----
const pois = ref<PoiLite[]>([]);
const openAliases = ref<OpenAlias[]>([]);
let poiLoading: Promise<void> | null = null;
function loadPois(): Promise<void> {
  if (poiLoading) return poiLoading;
  // 公開資料別名（Wikidata／OSM／內政部地名資料，建置時抓好）：載不到只少了別名，不擋地點
  const aliasLoad = fetch("./data/aliases.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { items: OpenAlias[] }) => {
      openAliases.value = j.items;
    })
    .catch((e) => console.warn("[placeSearch] aliases.json", e));
  poiLoading = fetch("./data/poi.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { items: PoiLite[] }) => {
      pois.value = j.items;
    })
    .then(() => aliasLoad)
    .catch((e) => {
      console.error("[placeSearch] poi.json", e);
      poiLoading = null; // 下次再試
    });
  return poiLoading;
}
// places.json 人工查核過的場館排最前（rank 0）
const placeLites = computed<PoiLite[]>(() => places.value.map((p) => ({ id: p.id, name: p.name, kind: p.kind, lat: p.lat, lng: p.lng, rank: 0 })));
const index = computed<Index>(() => buildIndex(stations.value, placeLites.value, pois.value, openAliases.value));

// ---- 語意層（裝置端 e5，跟路上意圖共用同一個 worker）----
const SEM_CAT = "places-cat"; // 分類目的句＋閒聊句（先建，幾秒就好）
const SEM_POI = "places-poi"; // 地點名（之後在背景建；沒建好就只比分類）
/** 最高相似度低於此值 → 不是在講地點（閒聊）。只用 scripts/place-dev.json 選。 */
export const SEMANTIC_THRESHOLD = 0.86;
/** 在城市通 App 裡用 App 的 EmbeddingGemma 2 時的門檻；只用 place-dev.json 選（開發集全對的區間 0.915–0.945 取中間）。 */
export const SEMANTIC_THRESHOLD_APP = 0.93;
const SEM_TIMEOUT_MS = 2500;
// 分類的「目的」句：自己寫；只用開發集的失敗調整過
const CATEGORY_EXEMPLARS: Record<string, string[]> = {
  醫院: ["看病", "看醫生", "掛號", "急診", "回診", "拿藥", "領藥", "做檢查", "健康檢查", "住院", "探病", "看門診", "打針", "身體不舒服", "復健", "洗腎", "抽血", "照X光", "看牙齒", "我生病了"],
  公園: ["散步", "遛狗", "走走", "曬太陽", "帶小孩去玩", "溜滑梯", "野餐", "看花", "透透氣", "打太極拳", "跳舞", "吹吹風", "坐在樹下", "賞櫻", "放風箏"],
  運動中心: ["運動", "游泳", "健身", "打球", "打羽球", "打籃球", "上瑜珈課", "跑步機", "健身房", "游泳池", "做運動", "練肌肉", "桌球", "上課運動"],
  圖書館: ["借書", "還書", "看書", "讀書", "自習", "看報紙", "找書", "念書", "借雜誌", "看繪本", "聽故事"],
  區公所: ["辦戶籍謄本", "申請補助", "辦證件", "辦身分證", "辦低收入戶", "申請津貼", "遷戶口", "辦印鑑證明", "辦敬老卡", "申請老人津貼", "辦戶口名簿", "辦理補助", "區公所辦事"],
  // 不是在講地點的話（閒聊、對旁人說的）：最像這些就回空
  none: ["天氣真好", "肚子餓了", "等等再講", "你在幹嘛", "喂", "謝謝你", "我不知道", "好累喔", "現在幾點", "明天見", "車子來了", "小心", "下雨了", "好吵", "電話響了", "好冷", "我先走了", "不用了", "再看看", "沒事", "隨便", "等我一下", "你說什麼", "這個多少錢", "午餐吃麵"],
};
let semReady = false;
let poiReady = false;
let semWarming: Promise<void> | null = null;
export function placeSemanticReady(): boolean {
  return semReady;
}
export function placePoiSemanticReady(): boolean {
  return poiReady;
}
async function warmSemantic(): Promise<void> {
  await warmIntent();
  if (!intentReady()) return;
  const cats: { id: string; text: string }[] = [];
  for (const [kind, arr] of Object.entries(CATEGORY_EXEMPLARS)) for (const t of arr) cats.push({ id: `cat:${kind}`, text: t });
  const m = await workerRequest({ type: "index", name: SEM_CAT, items: cats }, 120_000);
  if (!m || typeof m.n !== "number") return;
  semReady = true;
  await loadPois();
  const items = index.value.pois.map((p) => ({ id: `poi:${p.id}`, text: `${p.name}（${p.kind}）` }));
  const m2 = await workerRequest({ type: "index", name: SEM_POI, items }, 300_000);
  if (m2 && typeof m2.n === "number") poiReady = true;
}

/** 背景預熱（載入資料與模型）；可重複呼叫。 */
export function warmPlaceSearch(): void {
  void loadPois();
  if (!semWarming) semWarming = warmSemantic().catch((e) => console.warn("[placeSearch] semantic unavailable", e));
}

// ---- 規則命中 → 畫面用的 PlaceHit ----
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${Math.round(m / 10) * 10} 公尺`);
const accessWord = (n: Near) => (n.kind === "elevator" ? "有電梯" : "坡道");
function stationSub(st: string, list: EntranceLite[]): string {
  const es = list.filter((e) => e.station === st);
  const lifts = es.filter((e) => e.kind === "elevator").map((e) => e.exit);
  if (lifts.length) return `捷運站・${lifts.slice(0, 3).join("、")}${lifts.length > 3 ? " 等" : ""}有電梯`;
  const ramps = es.filter((e) => e.kind === "ramp");
  return ramps.length ? `捷運站・${ramps[0].exit}坡道` : "捷運站";
}
function toHit(h: RuleHit, list: EntranceLite[], category: string | null): PlaceHit | null {
  if (h.type === "station") {
    return { type: "station", id: `st:${h.station}`, name: short(h.station), sub: stationSub(h.station, list), station: h.station, why: h.why, score: h.score, kind: "捷運站" };
  }
  const near = nearestEntrance(h.poi, list);
  if (!near) return null;
  const far = near.meters > 1500 ? "・離捷運較遠" : "";
  return {
    type: h.type,
    id: h.poi.id,
    name: h.poi.name,
    sub: `${short(near.station)}站 ${near.exit}${accessWord(near)}・約 ${fmtM(near.meters)}${far}`,
    station: near.station,
    why: h.why,
    score: h.score,
    kind: h.poi.kind,
    ...(h.poi.fullName ? { fullName: h.poi.fullName } : {}),
    lat: h.poi.lat,
    lng: h.poi.lng,
    exit: near.exit,
    meters: near.meters,
    ...(category ? { category } : {}),
  };
}

/** 搜尋目的地，回傳依分數排序的結果（預設最多 3 筆）。歧義詞（例如「台大」）會回傳多筆讓使用者選。
 *  opts.origin：出發站；分類查詢（醫院／公園…）時回離它最近的幾筆。 */
export async function searchPlaces(q: string, opts: { limit?: number; origin?: string | null } = {}): Promise<PlaceHit[]> {
  const limit = opts.limit ?? 3;
  const list = entrances.value;
  const idx = index.value;
  const r = searchByRules(idx, q, list, { limit, origin: opts.origin });
  if (r.hits.length) return r.hits.map((h) => toHit(h, list, r.category)).filter((x): x is PlaceHit => !!x);
  if (!r.text || !semReady) return [];
  // 規則沒中 → 語意（只拿去掉口語後的部分問）：分類句與地點名各取最近，合併比分數
  type SemHit = { id: string; score: number };
  const [mc, mp] = await Promise.all([
    workerRequest({ type: "nearest", index: SEM_CAT, text: r.text, k: 2 }, SEM_TIMEOUT_MS),
    // 「新興醫院」這種不在資料裡的具體名字：不拿地點名去配（會配到別家醫院），只看分類句
    poiReady && !looksLikeSpecificName(r.text) ? workerRequest({ type: "nearest", index: SEM_POI, text: r.text, k: limit }, SEM_TIMEOUT_MS) : Promise.resolve(null),
  ]);
  const hits = [...((mc?.hits as SemHit[] | undefined) ?? []), ...((mp?.hits as SemHit[] | undefined) ?? [])].sort((a, b) => b.score - a.score);
  const thr = embedBackend() === "app" ? SEMANTIC_THRESHOLD_APP : SEMANTIC_THRESHOLD;
  if (!hits.length || hits[0].score < thr) return [];
  const top = hits[0];
  if (top.id === "cat:none") return [];
  if (top.id.startsWith("cat:")) {
    const kind = top.id.slice(4);
    return categoryHits(idx, kind, list, opts.origin, limit)
      .map((h) => toHit({ ...h, why: "semantic", score: top.score }, list, kind))
      .filter((x): x is PlaceHit => !!x);
  }
  const out: PlaceHit[] = [];
  for (const h of hits) {
    if (!h.id.startsWith("poi:") || h.score < thr) continue;
    const p = idx.pois.find((x) => x.id === h.id.slice(4));
    if (!p) continue;
    const hit = toHit({ type: idx.placeIds.has(p.id) ? "place" : "poi", poi: p, why: "semantic", score: h.score }, list, null);
    if (hit) out.push(hit);
  }
  return out.slice(0, limit);
}
