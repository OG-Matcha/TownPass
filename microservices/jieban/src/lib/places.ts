// 選站時可以打的地點名：市府場館與服務窗口（public/data/places.json，每筆附來源與查核日期）。
// 打「台大醫院」→ 帶出離它最近的電梯／坡道出口與車站；結果頁寫出出站後尚未確認的部分與官方下一步。
import { computed, ref } from "vue";
import { entrances } from "./planner";

export type Category = "learn" | "work" | "service";
export type Place = {
  id: string;
  category: Category;
  name: string;
  kind: string;
  org: string;
  summary: string;
  address: string;
  lat: number;
  lng: number;
  coordSource: string;
  hours: string | null;
  phone: string | null;
  url: string;
  nextStep: { label: string; url: string };
  access: { known: string[]; accessSource: string | null; unknown: string[] };
  source: string;
  checkedAt: string;
};

export const places = ref<Place[]>([]);
export const placesError = ref("");
export async function loadPlaces() {
  try {
    const r = await fetch("./data/places.json");
    if (!r.ok) throw new Error(String(r.status));
    places.value = (await r.json()) as Place[];
  } catch (e) {
    placesError.value = "地點資料載入失敗。";
    console.error(e);
  }
}
export const placeById = (id: string | null | undefined) => places.value.find((p) => p.id === id) ?? null;

const meters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
};

export type Access = { station: string; exit: string; kind: "elevator" | "ramp"; meters: number };
/** 離地點最近的無障礙出入口（電梯或坡道），直線距離。 */
export function nearestAccess(p: Pick<Place, "lat" | "lng">): Access | null {
  return nearestAccessIn(p, entrances.value);
}
export function nearestAccessIn(p: Pick<Place, "lat" | "lng">, list: typeof entrances.value): Access | null {
  let best: Access | null = null;
  for (const e of list) {
    const m = meters(p.lat, p.lng, e.lat, e.lng);
    if (!best || m < best.meters) best = { station: e.station, exit: e.exit.startsWith("出口") ? e.exit : `出口${e.exit}`, kind: e.kind, meters: m };
  }
  return best;
}
export const accessOf = computed(() => new Map(places.value.map((p) => [p.id, nearestAccess(p)])));

/** 撥號用：取第一支電話的數字（官方寫法常帶「分機」或兩支號碼，全部數字串起來會撥錯）。 */
export function telOf(phone: string): string | null {
  const m = phone.match(/\(?0\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{4}/);
  return m ? m[0].replace(/\D/g, "") : null;
}

// 常用簡稱
const ALIAS: Record<string, string> = {
  "ntuh-west": "台大醫院",
  "tpech-renai": "仁愛醫院",
  "tpml-main-library": "市圖總館",
  "taipei-fine-arts-museum": "北美館",
};
/** 選站搜尋：地點名或簡稱（台/臺視為同字）。 */
export function searchPlaces(q: string): Place[] {
  const k = q.replaceAll("臺", "台").trim();
  if (!k) return [];
  return places.value.filter((p) => `${p.name}${p.kind}${ALIAS[p.id] ?? ""}`.replaceAll("臺", "台").includes(k)).slice(0, 5);
}

// ---- 目的地：結果頁、行程頁用 ----
export type Destination = {
  name: string;
  where: string;
  lat: number;
  lng: number;
  unknown: string[];
  nextStep: { label: string; url: string } | null;
  phone: string | null;
  tel: string | null;
};
export function destinationOf(ref: { kind: "place"; id: string } | null | undefined): Destination | null {
  const p = ref ? placeById(ref.id) : null;
  return p
    ? { name: p.name, where: p.address, lat: p.lat, lng: p.lng, unknown: p.access.unknown, nextStep: p.nextStep, phone: p.phone, tel: p.phone ? telOf(p.phone) : null }
    : null;
}
