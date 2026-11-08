// 首頁口語意圖：地點簡稱、「跟上次一樣」、「回家」。純函式（不碰 Vue），可直接用 node 測。
// 不改 voiceCommand.ts；首頁先用這裡補它聽不懂的地方。
export type PlaceLite = { id: string; name: string; station: string; aliases?: string[] };
export type Hit = { kind: "station"; station: string } | { kind: "place"; id: string; station: string };

const norm = (s: string) => s.replaceAll("臺", "台").replace(/[\s，。,.!！?？]/g, "");

// 官方名稱之外，大家實際會講的簡稱（依 places.json 的 id）
const SHORT: Record<string, string[]> = {
  "ntuh-west": ["台大醫院", "台大", "台大西址"],
  "tpech-renai": ["仁愛醫院", "聯合醫院仁愛", "仁愛院區"],
  "tpml-main-library": ["市圖總館", "北市圖", "市圖", "總圖", "圖書館總館"],
  "taipei-fine-arts-museum": ["北美館", "市美館", "市立美術館", "美術館"],
  "zhongzheng-sports-center": ["中正運動中心"],
  "taipei-west-assistive-device-center": ["西區輔具中心", "輔具中心"],
  "zhongzheng-district-office": ["中正區公所"],
  "taipei-volunteer-center": ["志願服務推廣中心", "志工中心"],
  "eso-jingmei-station": ["景美就業服務站"],
  "eso-beitou-station": ["北投就業服務站"],
};
const STATION_SHORT: Record<string, string> = { 北車: "台北車站", 台北車站: "台北車站" };

function formsOf(p: PlaceLite): string[] {
  const base = norm(p.name).replace(/[（(].*?[)）]/g, "");
  const stripped = base.replace(/^(台北市立|台北市|國立台灣大學|國立)/, "");
  return [...new Set([base, stripped, ...(p.aliases ?? []), ...(SHORT[p.id] ?? [])].map(norm).filter((f) => f.length >= 2))];
}
function stationForms(st: string): string[] {
  const s = norm(st);
  const short = s.endsWith("車站") ? s : s.replace(/站$/, "");
  const parts = short.split("/").filter((x) => x.length >= 2);
  return [...new Set([s, short, ...parts])].filter((f) => f.length >= 2);
}

/** 句子裡提到的地點或車站。地點優先（台大醫院 → 地點，連同最近車站）；沒有地點才找車站。 */
export function placeOrStationIn(text: string, stations: string[], places: PlaceLite[]): Hit | null {
  const t = norm(text);
  if (!t) return null;
  let bestP: { p: PlaceLite; len: number } | null = null;
  for (const p of places)
    for (const f of formsOf(p)) if (t.includes(f) && (!bestP || f.length > bestP.len)) bestP = { p, len: f.length };
  let bestS: { s: string; len: number } | null = null;
  for (const s of stations)
    for (const f of stationForms(s)) if (t.includes(f) && (!bestS || f.length > bestS.len)) bestS = { s, len: f.length };
  for (const [k, v] of Object.entries(STATION_SHORT)) {
    const s = stations.find((x) => norm(x) === v);
    if (s && t.includes(k) && (!bestS || k.length > bestS.len)) bestS = { s, len: k.length };
  }
  // 地點名比車站名長或一樣長就用地點；車站名明顯更長（例如「從台北101站去…」）才用車站
  if (bestP && (!bestS || bestP.len >= bestS.len)) return { kind: "place", id: bestP.p.id, station: bestP.p.station };
  return bestS ? { kind: "station", station: bestS.s } : null;
}

export const isSameAsLast = (text: string): boolean => /跟上次(一樣|那樣)|照上次|同上次|老樣子|一樣的路|跟平常一樣|跟之前一樣|跟昨天一樣/.test(norm(text));
export const isGoHome = (text: string): boolean => /回家/.test(norm(text));

/** 「家在X」「我家在X站」→ 記下家的車站。 */
export function homeDeclaredIn(text: string, stations: string[], places: PlaceLite[]): string | null {
  const m = norm(text).match(/(?:我家|家)在(.+)/) ?? norm(text).match(/住在(.+)/);
  if (!m) return null;
  const h = placeOrStationIn(m[1], stations, places);
  return h?.station ?? null;
}

export type RouteIntent = { from: Hit | null; fromHome: boolean; to: Hit | null; toHome: boolean };
/** 「從X去Y」「帶我去Y」「從家裡去Y」：拆出起點和終點（起點可以是家）。 */
export function routeIntent(text: string, stations: string[], places: PlaceLite[]): RouteIntent {
  const t = norm(text);
  const out: RouteIntent = { from: null, fromHome: false, to: null, toHome: false };
  const m = t.match(/從(.*?)(?:出發)?(?:去|到|往|前往|至)(.+)$/);
  let fromPart = "";
  let toPart = t;
  if (m) {
    fromPart = m[1];
    toPart = m[2];
  } else {
    const k = t.search(/去|到|往|前往/);
    if (k >= 0) toPart = t.slice(k + 1);
    else if (t.includes("從")) {
      fromPart = t.slice(t.indexOf("從") + 1);
      toPart = "";
    } else toPart = "";
  }
  if (/^(我)?家(裡)?$/.test(fromPart)) out.fromHome = true;
  else if (fromPart) out.from = placeOrStationIn(fromPart, stations, places);
  if (/^(我)?家(裡)?$|^回家$/.test(toPart) || /回家/.test(t)) out.toHome = true;
  else if (toPart) out.to = placeOrStationIn(toPart, stations, places);
  return out;
}
