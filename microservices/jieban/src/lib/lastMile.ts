// 出站之後最後一段：出口 → 目的地附近的斜坡、人行道淨寬、施工（public/data/lastmile.json，建置時快照；查證見 docs/research/14）。
// 規則（doc 14 §1.5）：人行道淨寬 < 1.2 m 才提醒；施工只有「影響通行」且 60 m 內才警告；汽車斜坡不算。
import { ref } from "vue";

type Pt = { lat: number; lng: number };
type Ramp = Pt & { kind: "curb" | "car" };
type Sidewalk = Pt & { road: string; width: number | null; netWidth: number | null };
type Work = Pt & { addr: string; until: string; blocks: boolean };
export type LastMileData = { fetchedAt: string; ramps: Ramp[]; sidewalks: Sidewalk[]; works: Work[] };

export const lastMile = ref<LastMileData | null>(null);
let loading: Promise<void> | null = null;
export function loadLastMile(): Promise<void> {
  loading ??= fetch("./data/lastmile.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: LastMileData) => {
      lastMile.value = j;
    })
    .catch((e) => {
      loading = null;
      console.error(e);
    });
  return loading;
}

const NEAR_M = 150; // 「附近」：出口到目的地這條線兩側
const WALK_M = 80; // 人行道段的代表點離這條線多近才算
const BLOCK_M = 60; // 施工要多近才警告
const NARROW_M = 1.2;
const MIN_PLAUSIBLE_M = 0.3; // 淨寬小於 30 公分是資料錯誤（資料裡有 0.02），不採用

/** 點到線段的公尺距離（短距離用平面近似）。 */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const k = Math.cos((a.lat * Math.PI) / 180);
  const X = (q: Pt) => (q.lng - a.lng) * 111_320 * k;
  const Y = (q: Pt) => (q.lat - a.lat) * 110_540;
  const [px, py, bx, by] = [X(p), Y(p), X(b), Y(b)];
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

const roc = (s: string) => {
  const m = s.match(/^(\d+)\/(\d+)\/(\d+)$/);
  return m ? `${m[1]} 年 ${+m[2]} 月 ${+m[3]} 日` : s;
};
const roadOf = (addr: string) => {
  const first = addr.split(/[:：;；，,]/)[0].trim();
  const dup = first.match(/^(.+)\1$/);
  return (dup ? dup[1] : first).slice(0, 14);
};
const stamp = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export type LastMileInfo = {
  /** 這一帶有沒有資料（沒有 = 顯示「未確認」，不是「沒有斜坡」） */
  covered: boolean;
  ramps: number;
  narrowest: number | null;
  works: number;
  blockers: { road: string; until: string }[];
  narrow: boolean;
  dataTime: string;
};

export function summarize(d: LastMileData, exit: Pt, dest: Pt): LastMileInfo {
  const near = (p: Pt, m: number) => distToSegment(p, exit, dest) <= m;
  const ramps = d.ramps.filter((r) => r.kind === "curb" && near(r, NEAR_M)).length;
  const widths = d.sidewalks
    .filter((s) => near(s, WALK_M))
    .map((s) => s.netWidth ?? s.width)
    .filter((w): w is number => typeof w === "number" && w >= MIN_PLAUSIBLE_M);
  const works = d.works.filter((w) => near(w, NEAR_M));
  const blockers = works.filter((w) => w.blocks && near(w, BLOCK_M)).map((w) => ({ road: roadOf(w.addr), until: roc(w.until) }));
  const narrowest = widths.length ? Math.min(...widths) : null;
  return {
    covered: ramps > 0 || widths.length > 0 || works.length > 0,
    ramps,
    narrowest,
    works: works.length,
    blockers,
    narrow: narrowest !== null && narrowest < NARROW_M,
    dataTime: stamp(d.fetchedAt),
  };
}
