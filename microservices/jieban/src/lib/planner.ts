// 出門規劃的共用狀態：資料、表單（記住上次）、規劃結果快照與步驟。各畫面共用同一份。
import { computed, ref, watch } from "vue";
import { LINE_NAME, planRoute, stationsOf, type Line, type Network, type Plan } from "./route.ts";
import { doorForDirection, lineStations, stationsAhead, towardTerminal } from "./lines.ts";
import {
  nearestAlternative,
  stationStatus,
  type Anomaly,
  type Entrance,
  type Maintenance,
  type StationStatus,
} from "./station.ts";

type Feed<T> = { fetchedAt: string; items: T[] };
export type Facility = {
  station: string;
  line: Line;
  wheelchairCars: string | null;
  doorSide: string | null;
  gate: string | null;
  toilet: string | null;
  path: string | null;
};

export const LINE_COLOR: Record<Line, string> = {
  R: "#e3002c",
  BR: "#c48c31",
  BL: "#0070bd",
  G: "#008659",
  O: "#f8b61c",
  Y: "#ffdb00",
};

// 這個服務就是給要搭電梯的人：全程只走電梯或坡道，轉乘步行時間一律放寬 1.5 倍（估計值，畫面標示）
export const WALK_FACTOR = 1.5;

const load = <T>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

// ---- 資料（建置時打包；data.taipei 不開 CORS、評審可能斷網）----
export const net = ref<Network | null>(null);
export const entrances = ref<Entrance[]>([]);
export const maint = ref<Maintenance[]>([]);
export const anomalies = ref<Anomaly[]>([]);
export const facilities = ref<Facility[]>([]);
export const fetchedAt = ref<Date | null>(null);
export const loadError = ref("");
export const loading = ref(true);

export async function loadData() {
  loading.value = true;
  loadError.value = "";
  try {
    const get = <T>(f: string) =>
      fetch(`./data/${f}.json`).then((r) => {
        if (!r.ok) throw new Error(`${f} ${r.status}`);
        return r.json() as Promise<T>;
      });
    const [n, e, m, a, f] = await Promise.all([
      get<Network>("network"),
      get<Feed<Entrance>>("elevators"),
      get<Feed<Maintenance>>("maintenance"),
      get<Feed<Anomaly>>("anomalies"),
      get<Feed<Facility>>("facilities"),
    ]);
    facilities.value = f.items;
    net.value = n;
    entrances.value = e.items;
    maint.value = m.items;
    anomalies.value = a.items;
    fetchedAt.value = new Date(a.fetchedAt);
  } catch (err) {
    loadError.value = "車站資料載入失敗。";
    console.error(err);
  } finally {
    loading.value = false;
  }
}

export const stations = computed(() => (net.value ? stationsOf(net.value) : []));
export const byLine = computed(() => (net.value ? lineStations(net.value) : null));

// ---- 表單：記住上次，第一次空白（不預填別人的站）----
export const origin = ref<string>(load("origin", ""));
export const dest = ref<string>(load("dest", ""));
const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（本地時間）
export const date = ref(today());
watch(origin, (v) => save("origin", v));
watch(dest, (v) => save("dest", v));

// 選站時打地點名（例如「台大醫院」）帶入：記住是哪一個；本人改了要去的車站就不再顯示它
type DestRef = { kind: "place"; id: string; station: string };
export const destPlace = ref<DestRef | null>(load<DestRef | null>("destRef", null));
watch(destPlace, (v) => save("destRef", v));
watch(dest, (v) => {
  if (destPlace.value && destPlace.value.station !== v) destPlace.value = null;
});
export function choosePlace(id: string, station: string) {
  pickStation("dest", station);
  destPlace.value = { kind: "place", id, station };
}

// 我的常走路線：查過的路線自動記下（只在這支手機），依次數、最近排序
export type SavedRoute = { origin: string; dest: string; count: number; last: number };
export const savedRoutes = ref<SavedRoute[]>(load("savedRoutes", []));
watch(savedRoutes, (v) => save("savedRoutes", v), { deep: true });
export function rememberRoute(o: string, d: string) {
  const old = savedRoutes.value.find((r) => r.origin === o && r.dest === d);
  const rest = savedRoutes.value.filter((r) => r !== old);
  savedRoutes.value = [{ origin: o, dest: d, count: (old?.count ?? 0) + 1, last: Date.now() }, ...rest]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, 5);
}
export function forgetRoute(o: string, d: string) {
  savedRoutes.value = savedRoutes.value.filter((r) => !(r.origin === o && r.dest === d));
}

export const recent = ref<string[]>(load("recentStations", []));
export function pickStation(field: "origin" | "dest", s: string) {
  if (field === "origin") origin.value = s;
  else dest.value = s;
  recent.value = [s, ...recent.value.filter((x) => x !== s)].slice(0, 5);
  save("recentStations", recent.value);
}
export function swap() {
  [origin.value, dest.value] = [dest.value, origin.value];
}
export const dateChoice = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE");
};

/** 表單哪裡還沒填好（給「查路線」攔截用）；都好回傳 null。 */
export function formProblem(): { field: "origin" | "dest" | "date"; text: string } | null {
  if (!origin.value) return { field: "origin", text: "請選出發的車站" };
  if (!dest.value) return { field: "dest", text: "請選要去的車站" };
  if (origin.value === dest.value) return { field: "dest", text: "出發和要去的車站不能一樣" };
  if (!date.value) return { field: "date", text: "請選哪一天出門" };
  return null;
}

// ---- 規劃結果：存快照，之後改表單不會讓結果自相矛盾 ----
/** 可比較的方案：不是只給一條「推薦」，每條寫出差在哪（UX 診斷 P0-4）。 */
export type Option = { key: string; label: string; why: string; dest: string; plan: Plan };
export type Snapshot = {
  origin: string;
  dest: string;
  date: string;
  target: { kind: "place"; id: string } | null;
  plan: Plan | null;
  options: Option[];
  chosen: number;
  /** 路上換路線：已經在站內（從月臺出發，沒有進站這一步） */
  inside?: boolean;
  /** 路上回報不能用的出口電梯（`站名|出口`），步驟不再列它 */
  avoidExits?: string[];
  /** 結果頁已自動避開預排保養（只做一次；本人按「改回原路線」後記成 declined） */
  autoFix?: { state: "done" | "declined"; prevChosen: number; ourAvoid: string[]; notes: string[] };
  /** 目的地是地點（醫院、公園…）時的資訊，結果頁「出站之後」用 */
  destInfo?: { id: string | null; name: string; kind: string | null; lat: number; lng: number };
};

const MAX_EXTRA_MIN = 15; // 比最快多太多的方案不列
/** 顯示用短站名：「小南門站」→「小南門」；「台北車站」保留（去掉「站」會變「台北車」）。 */
export const short = (s: string) => (s.endsWith("車站") ? s : s.replace(/站$/, ""));
function buildOptions(o: string, d: string, walkFactor: number, point: { lat: number; lng: number } | null): Option[] {
  const n = net.value!;
  const base = planRoute(n, o, d, walkFactor);
  if (!base) return [];
  const sig = (dst: string, p: Plan) => `${dst}|${p.transfers.map((t) => t.station).join(",")}|${p.legs.map((l) => l.line).join(",")}`;
  const out: Option[] = [
    point
      ? { key: "fast", label: `到${short(d)}下車`, why: "離目的地最近的電梯或坡道出口", dest: d, plan: base }
      : { key: "fast", label: "最快", why: "時間最短的走法", dest: d, plan: base },
  ];
  const add = (opt: Option | null) => {
    if (!opt || opt.plan.totalMin > base.totalMin + MAX_EXTRA_MIN) return;
    if (out.some((x) => sig(x.dest, x.plan) === sig(opt.dest, opt.plan))) return;
    out.push(opt);
  };
  if (base.transfers.length) {
    const p = planRoute(n, o, d, walkFactor, 0, new Set(base.transfers.map((t) => t.station)));
    if (p)
      add({
        key: "other-transfer",
        label: p.transfers.length ? `改在${p.transfers.map((t) => short(t.station)).join("、")}轉乘` : "不用轉乘",
        why: `不在${base.transfers.map((t) => short(t.station)).join("、")}轉乘`,
        dest: d,
        plan: p,
      });
    const few = planRoute(n, o, d, walkFactor, 20 * 60);
    if (few && few.transfers.length < base.transfers.length) add({ key: "fewer", label: "轉乘較少", why: `只轉乘 ${few.transfers.length} 次`, dest: d, plan: few });
  }
  if (point) {
    // 目的地附近另一個有電梯或坡道出口的車站（直線 800 公尺內）
    let best: { station: string; exit: string; m: number } | null = null;
    for (const e of entrances.value) {
      if (e.station === d || e.station === o) continue;
      const m = meters(point.lat, point.lng, e.lat, e.lng);
      if (m <= 800 && (!best || m < best.m)) best = { station: e.station, exit: e.exit, m };
    }
    if (best) {
      const p = planRoute(n, o, best.station, walkFactor);
      const ex = best.exit.startsWith("出口") ? best.exit : `出口${best.exit}`;
      if (p) add({ key: "other-station", label: `改到${short(best.station)}下車`, why: `${ex}離目的地直線約 ${Math.round(best.m)} 公尺`, dest: best.station, plan: p });
    }
  }
  return out.slice(0, 3);
}
const meters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

/** 本人選另一個方案：步驟、地圖、行程都改用這條。 */
export function chooseOption(i: number) {
  const r = result.value;
  const opt = r?.options[i];
  if (!r || !opt) return;
  result.value = { ...r, chosen: i, dest: opt.dest, plan: opt.plan };
}
// 存在這支手機：重新整理、切回 App 後結果頁還在
export const result = ref<Snapshot | null>(load<Snapshot | null>("lastResult", null));
watch(result, (v) => save("lastResult", v));

export function doPlan(point: { lat: number; lng: number } | null = null): boolean {
  if (!net.value || formProblem()) return false;
  const options = buildOptions(origin.value, dest.value, WALK_FACTOR, point);
  result.value = {
    origin: origin.value,
    dest: dest.value,
    date: date.value,
    target: destPlace.value?.station === dest.value ? { kind: "place", id: destPlace.value.id } : null,
    plan: options[0]?.plan ?? null,
    options,
    chosen: 0,
  };
  if (options.length) rememberRoute(origin.value, dest.value);
  return true;
}

/** 首頁常走路線卡：今天的判定＋接下來 30 天最近一次白天保養（只看預排資料）。 */
export type RouteCheck = { ok: boolean; today: string; upcoming: string | null };
export function checkRoute(o: string, d: string, day = today()): RouteCheck | null {
  if (!net.value) return null;
  const p = planRoute(net.value, o, d, WALK_FACTOR);
  if (!p) return null;
  const stops = [...new Set([o, ...p.transfers.map((t) => t.station), d])];
  const issue = (s: string, dt: string) => {
    const st = status(s, dt);
    if (st.blocked) return `${s}所有電梯出口白天保養`;
    if (st.dayExitWork.length) return `${s}${st.dayExitWork.map((m) => m.place).join("、")}電梯白天保養`;
    if (st.dayPlatformWork.length) return `${s}月台電梯白天保養`;
    if (st.anomalies.length) return `${s}有設施異常公告`;
    return null;
  };
  const todayIssues = stops.map((s) => issue(s, day)).filter(Boolean) as string[];
  let upcoming: string | null = null;
  const dates = [...new Set(maint.value.filter((m) => stops.includes(m.station) && m.date > day && !m.night).map((m) => m.date))].sort();
  const limit = new Date(`${day}T00:00:00`);
  limit.setDate(limit.getDate() + 30);
  for (const dt of dates) {
    if (dt > limit.toLocaleDateString("sv-SE")) break;
    const x = stops.map((s) => (status(s, dt).dayExitWork.length || status(s, dt).dayPlatformWork.length ? issue(s, dt) : null)).find(Boolean);
    if (x) {
      upcoming = `${mdw(dt)}：${x}`;
      break;
    }
  }
  return { ok: !todayIssues.length, today: todayIssues.length ? todayIssues.join("；") : "今天沒有排定電梯保養", upcoming };
}
const WD = "日一二三四五六";
export const mdw = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  return `${x.getMonth() + 1}/${x.getDate()}（${WD[x.getDay()]}）`;
};
export const isToday = (d: string) => d === today();

export const status = (s: string, d: string): StationStatus => stationStatus(s, d, entrances.value, maint.value, anomalies.value);
const fac = (station: string, line: Line) => facilities.value.find((f) => f.station === station && f.line === line) ?? null;

export type Alt = { station: string; meters: number } | null;
export type Step =
  | { kind: "enter" | "exit"; st: StationStatus; alt: Alt; fac: Facility | null }
  | { kind: "ride"; line: Line; from: string; to: string; stops: number; min: number; cars: string | null; door: string | null; toward: string }
  | {
      kind: "transfer";
      station: string;
      to: Line;
      walkMin: number;
      st: StationStatus;
      sameLine: boolean;
    };

export const steps = computed<Step[]>(() => stepsOf(result.value));
/** 由規劃快照算出步驟（行程中用出發當下的快照，不受之後再查別的路線影響）。 */
export function stepsOf(r: Snapshot | null): Step[] {
  const p = r?.plan;
  if (!r || !p || !net.value) return [];
  const avoid = new Set(r.avoidExits ?? []);
  const st = (s: string): StationStatus => {
    const x = status(s, r.date);
    const left = x.entrances.filter((e) => !avoid.has(`${s}|${e.exit}`));
    const y = left.length && left.length < x.entrances.length ? { ...x, entrances: left, onlyOne: left.length === 1 } : x;
    // 最好的出口排第一：目的地站用目的地座標（已知時）排距離；其他站電梯優先、依資料順序
    return { ...y, entrances: orderExits(y.entrances, s === r.dest ? (r.destInfo ?? null) : null) };
  };
  const alt = (s: string): Alt =>
    st(s).blocked ? nearestAlternative(s, r.date, entrances.value, maint.value, anomalies.value) : null;
  const first = p.legs[0].line;
  const last = p.legs[p.legs.length - 1].line;
  const out: Step[] = r.inside ? [] : [{ kind: "enter", st: st(r.origin), alt: alt(r.origin), fac: fac(r.origin, first) }];
  p.legs.forEach((l, i) => {
    if (i > 0) {
      const t = p.transfers.find((x) => x.station === l.from)!;
      out.push({
        kind: "transfer",
        station: l.from,
        to: l.line,
        walkMin: t.walkMin,
        st: st(l.from),
        sameLine: t.from === t.to,
      });
    }
    const ahead = stationsAhead(net.value!, l);
    const terminal = towardTerminal(net.value!, l, ahead); // 「往 X 方向」
    out.push({
      kind: "ride",
      line: l.line,
      from: l.from,
      to: l.to,
      stops: l.stops,
      min: Math.max(1, Math.round(l.sec / 60)),
      cars: fac(l.from, l.line)?.wheelchairCars ?? null,
      door: doorForDirection(fac(l.to, l.line)?.doorSide ?? null, ahead),
      toward: terminal,
    });
  });
  out.push({ kind: "exit", st: st(r.dest), alt: alt(r.dest), fac: fac(r.dest, last) });
  return out;
}

// ---- 路上「電梯不能用，幫我換一條路」----
/** 這一步要用到的電梯在哪一站、本人現在在哪、在哪條線上（null = 還在站外）。 */
export type Spot = { station: string; kind: "enter" | "transfer" | "exit"; from: string; line: Line | null };
/** 第 idx 張步驟卡（不含進站）對應的電梯位置。 */
export function spotOf(steps: Step[], idx: number): Spot | null {
  const cards = steps.map((s, i) => [s, i] as const).filter(([s]) => s.kind !== "enter");
  const hit = cards[idx];
  if (!hit) return null;
  const [s, i] = hit;
  const prev = steps[i - 1];
  const next = steps[i + 1];
  const lastRide = (j: number) => {
    for (let k = j; k >= 0; k--) {
      const x = steps[k];
      if (x.kind === "ride") return x.line;
    }
    return null;
  };
  if (s.kind === "ride") {
    if (prev?.kind === "enter") return { station: prev.st.station, kind: "enter", from: prev.st.station, line: null };
    if (next?.kind === "transfer") return { station: next.station, kind: "transfer", from: s.from, line: s.line };
    if (next?.kind === "exit") return { station: next.st.station, kind: "exit", from: s.from, line: s.line };
    return null;
  }
  if (s.kind === "transfer") return { station: s.station, kind: "transfer", from: s.station, line: lastRide(i - 1) };
  if (s.kind === "exit") return { station: s.st.station, kind: "exit", from: s.st.station, line: lastRide(i - 1) };
  return null;
}
/** 這站還能用的電梯或坡道出口（扣掉已回報不能用的）。 */
export function exitsLeft(snap: Snapshot, station: string): Entrance[] {
  const avoid = new Set(snap.avoidExits ?? []);
  return entrances.value.filter((e) => e.station === station && !avoid.has(`${station}|${e.exit}`));
}
/** 同一站改走另一個出口：只把壞掉的出口拿掉，路線不變。 */
export const avoidExit = (snap: Snapshot, station: string, exit: string): Snapshot => ({ ...snap, avoidExits: [...(snap.avoidExits ?? []), `${station}|${exit}`] });

export type Reroute = { snap: Snapshot; change: { kind: "origin" | "dest"; station: string; meters: number } | { kind: "transfer"; via: string[] } };
/**
 * 這站的電梯不能用 → 換一條路。進站：改從最近、當天沒被擋住的車站進站；
 * 轉乘：從現在的月臺出發、不在這站轉乘；出站：同一條線的鄰站出站。找不到回傳 null。
 */
export function rerouteAround(snap: Snapshot, spot: Spot): Reroute | null {
  const n = net.value;
  if (!n) return null;
  const base = { ...snap, options: [], chosen: 0 };
  if (spot.kind === "enter") {
    const alt = nearestAlternative(spot.station, snap.date, entrances.value, maint.value, anomalies.value);
    const plan = alt && alt.station !== snap.dest ? planRoute(n, alt.station, snap.dest, WALK_FACTOR) : null;
    if (!alt || !plan) return null;
    return { snap: { ...base, origin: alt.station, plan, inside: false }, change: { kind: "origin", station: alt.station, meters: alt.meters } };
  }
  if (spot.kind === "transfer") {
    // 也不在現在這站再轉一次（從月臺出發的路線，第一段一定是本人現在這條線）
    const plan = planRoute(n, spot.from, snap.dest, WALK_FACTOR, 0, new Set([spot.station, spot.from]), spot.line);
    if (!plan || plan.legs[0].line !== spot.line || plan.transfers.some((t) => t.station === spot.station || t.station === spot.from)) return null;
    return { snap: { ...base, origin: spot.from, plan, inside: true }, change: { kind: "transfer", via: plan.transfers.filter((t) => t.from !== t.to).map((t) => t.station) } };
  }
  // 出站：同一條線的鄰站，當天沒有被擋住、有無障礙出口；挑出口離原本那站最近的
  const here = entrances.value.filter((e) => e.station === spot.station);
  const nbrs = [...new Set(n.items.filter((e) => e.line === spot.line && (e.a === spot.station || e.b === spot.station)).map((e) => (e.a === spot.station ? e.b : e.a)))];
  let best: { station: string; meters: number } | null = null;
  for (const s of nbrs) {
    if (s === spot.from) continue;
    const ents = entrances.value.filter((e) => e.station === s);
    if (!ents.length || status(s, snap.date).blocked) continue;
    const m = Math.min(...ents.flatMap((e) => (here.length ? here : ents).map((h) => meters(h.lat, h.lng, e.lat, e.lng))));
    if (!best || m < best.meters) best = { station: s, meters: Math.round(m) };
  }
  if (!best) return null;
  const plan = planRoute(n, spot.from, best.station, WALK_FACTOR, 0, new Set([spot.from]), spot.line);
  if (!plan || plan.legs[0].line !== spot.line || plan.transfers.some((t) => t.station === spot.from)) return null;
  return { snap: { ...base, origin: spot.from, dest: best.station, plan, inside: true }, change: { kind: "dest", station: best.station, meters: best.meters } };
}

/** 要特別注意的地方（保養、異常、全部出口保養）。 */
export const warnings = computed(() =>
  steps.value.filter(
    (s) => "st" in s && (s.st.blocked || s.st.anomalies.length || s.st.dayPlatformWork.length || s.st.dayExitWork.length),
  ),
);

/** 「出口2」→「2 號出口」，「出口2A」→「2A 號出口」，「M2」→「M2 出口」，單一出口照原樣。 */
export function fmtExit(exit: string): string {
  const m = exit.match(/^出口\s*(\w+)$/);
  if (m) return `${m[1]} 號出口`;
  const n = exit.match(/^(\d+\w?)\s*號出口$/);
  if (n) return `${n[1]} 號出口`;
  if (/^[A-Za-z]+\d+$/.test(exit)) return `${exit} 出口`;
  return exit;
}
const dist = (e: Entrance, p: { lat: number; lng: number }) => meters(e.lat, e.lng, p.lat, p.lng);
/** 出口排序：電梯在前；有目標點（目的地）就依直線距離，沒有就維持資料順序。 */
export function orderExits(ents: Entrance[], point: { lat: number; lng: number } | null): Entrance[] {
  return ents
    .map((e, i) => ({ e, i, k: e.kind === "elevator" ? 0 : 1, d: point ? dist(e, point) : 0 }))
    .sort((a, b) => a.k - b.k || a.d - b.d || a.i - b.i)
    .map((x) => x.e);
}
/** 這個站要走的那「一個」出口：「芝山站 2 號出口」（坡道加註）。stepsOf 已把最好的排第一。 */
export function exitList(st: StationStatus) {
  const e = st.entrances[0];
  if (!e) return st.station;
  const x = fmtExit(e.exit);
  const name = /^單一/.test(e.exit) ? `${st.station}${x}` : `${st.station} ${x}`;
  return e.kind === "ramp" ? `${name}（走坡道）` : name;
}
/** 另一個出口（同一種方式）：「也可以走 1 號出口」；沒有就 null。 */
export function exitAlt(st: StationStatus): string | null {
  const [a, ...rest] = st.entrances;
  const alt = rest.filter((e) => a && e.kind === a.kind && !/^單一/.test(e.exit)).slice(0, 2);
  return alt.length ? `也可以走 ${alt.map((e) => fmtExit(e.exit)).join(" 或 ")}` : null;
}
/** 資料裡的動線是「出口→月台」（進站方向）；出站時反過來念。 */
export const pathText = (p: string, exit = false) => {
  const parts = p.split(/-{1,2}/).map((x) => x.trim()).filter(Boolean);
  return (exit ? parts.reverse() : parts).join(" → ");
};
/** 開放資料沒有轉乘動線，不套用進出站動線。 */
export const TRANSFER_HINT = "沿無障礙指標找電梯；找不到可以按電梯旁的對講機，或問詢問處";

export function stepText(s: Step): string {
  if (s.kind === "ride")
    return (
      `搭${LINE_NAME[s.line]}往${s.toward.replace(/站$/, "")}方向，從${s.from}坐 ${s.stops} 站到${s.to}，約 ${s.min} 分鐘。` +
      (s.cars ? `輪椅停靠在${s.cars}。` : "") +
      (s.door ? `到站時${s.door}。` : "")
    );
  if (s.kind === "transfer")
    return s.sameLine
      ? `在${s.station}下車，換搭支線的車。`
      : `在${s.station}換搭${LINE_NAME[s.to]}，轉乘步行約 ${s.walkMin} 分鐘。${TRANSFER_HINT}。`;
  const verb = s.kind === "enter" ? "進站" : "出站";
  const alt = exitAlt(s.st);
  let t = `從${exitList(s.st)}${verb}${alt ? `（${alt}）` : ""}。`;
  if (s.st.blocked) t += "注意，這站所有無障礙出口電梯，當天白天都排定保養，實際時間以車站公告為準。";
  if (s.alt) t += `可以改從${s.alt.station}，直線距離約 ${s.alt.meters} 公尺。`;
  return t;
}

export function summaryText(): string {
  const r = result.value;
  if (!r?.plan) return "找不到路線";
  const w = warnings.value.length;
  return `從${r.origin}到${r.dest}，大約 ${r.plan.totalMin} 分鐘${w ? `，有 ${w} 個地方要注意` : "，沿途沒有排定的電梯保養"}。`;
}

/** 目的地出口（求助卡、分享用）。台北車站資料寫「M2」→ 補「出口」。 */
export function destExitOf(station: string, point: { lat: number; lng: number } | null = null) {
  const x = orderExits(entrances.value.filter((e) => e.station === station), point)[0]?.exit ?? null;
  return x ? fmtExit(x) : x;
}
export const gateAt = (station: string) => facilities.value.find((f) => f.station === station)?.gate ?? null;

/** 離某個位置最近的車站（用無障礙出入口座標算直線距離）。 */
export function nearestStation(lat: number, lng: number): { station: string; meters: number } | null {
  let best: { station: string; meters: number } | null = null;
  for (const e of entrances.value) {
    const dLat = ((e.lat - lat) * Math.PI) / 180;
    const dLng = ((e.lng - lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((e.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const m = 2 * 6371000 * Math.asin(Math.sqrt(h));
    if (!best || m < best.meters) best = { station: e.station, meters: Math.round(m) };
  }
  return best;
}

export { LINE_NAME };
