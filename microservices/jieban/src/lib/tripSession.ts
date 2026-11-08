// 旅客端的行程：跨畫面共用、存在這支手機（重新整理或切回 App 都還在）。
// 出發就有「一步一步」；分享給家人是選用的：本人按了分享才上傳，只分享「到哪一站」，可隨時結束。
import { computed, ref, watch } from "vue";
import type { Snapshot } from "./planner.ts";
import { advance, back, askHelp, buildMilestones, departAction, endTrip, evaluate, isActive, replyOk, TRIP_TTL_H, type Trip } from "./trip.ts";
import { familyLink, newTripId, newWriteToken, saveTrip } from "./tripStore.ts";
import { needs, type Need } from "./settings.ts";

const KEY = "activeTrip";
type Saved = { trip: Trip; token: string; offset: number; snap: Snapshot | null; shared: boolean; askMode?: boolean };
/** 讀出上次存的行程。只有「進行中」的才還給呼叫端；已到達、已結束、過期的在這裡清掉，
 * 過期但還沒結束的分享連結順便通知後端結束（家人頁不再顯示「進行中」）。 */
function read(): Saved | null {
  let s: Saved | null = null;
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
  } catch {
    return null;
  }
  if (!s) return null;
  if (isActive(s.trip, Date.now())) return s;
  if (s.shared && s.trip.state !== "arrived" && s.trip.state !== "ended") {
    void saveTrip({ ...s.trip, state: "ended", updatedAt: Date.now() }, s.token).catch(() => {});
  }
  try {
    localStorage.removeItem(KEY);
  } catch {}
  return null;
}
const saved = read();

export const trip = ref<Trip | null>(saved?.trip ?? null);
// 寫入權杖只留在這支手機；家人連結只有 id，只能看不能改
let token = saved?.token ?? newWriteToken();
/** 出發當下的規劃快照：路上的步驟卡用它，之後再查別的路線也不會變。 */
export const tripSnap = ref<Snapshot | null>(saved?.snap ?? null);
/** 本人有沒有把行程分享給家人（沒分享就不上傳）。 */
export const shared = ref(saved?.shared ?? false);

// ---- 出發時問一次「路上你想怎麼知道下一步？」----
// 三個選擇對應到操作設定的 needs（其他 needs 不動，仍在「字級・操作」裡改）
export type TripMode = "look" | "listen" | "talk";
const MODE_KEY = "askModeOff";
/** 本人勾了「下次不要再問」 */
export const askModeOff = ref((() => {
  try {
    return localStorage.getItem(MODE_KEY) === "1";
  } catch {
    return false;
  }
})());
watch(askModeOff, (v) => {
  try {
    localStorage.setItem(MODE_KEY, v ? "1" : "0");
  } catch {}
});
/** 這一趟還沒回答怎麼帶路（出發後第一步之前顯示） */
export const askMode = ref(saved?.askMode ?? false);
export function modeOf(ns: readonly Need[]): TripMode {
  return ns.includes("handsBusy") ? "talk" : ns.includes("noLook") ? "listen" : "look";
}
export function chooseMode(m: TripMode, dontAskAgain: boolean) {
  const rest = needs.value.filter((n) => n !== "noLook" && n !== "handsBusy" && !(m === "talk" && n === "noTalk"));
  needs.value = m === "look" ? rest : m === "listen" ? [...rest, "noLook"] : [...rest, "noLook", "handsBusy"];
  askModeOff.value = dontAskAgain;
  askMode.value = false;
  if (trip.value) void commit(trip.value);
}

// 示範用時間快轉（網址加 ?demo=1 才出現），現場不用真的等
export const demo = new URLSearchParams(location.search).has("demo");
let offset = saved?.offset ?? 0;
export const now = () => Date.now() + offset;

export const active = computed(() => !!trip.value && trip.value.state !== "ended" && trip.value.state !== "arrived");
export const link = computed(() => (trip.value ? familyLink(trip.value.id) : ""));
export const here = computed(() => {
  const t = trip.value;
  if (!t) return "";
  return t.reached > 0 ? t.milestones[t.reached - 1].station : t.origin;
});
export const next = computed(() => (trip.value ? (trip.value.milestones[trip.value.reached] ?? null) : null));

/** 分享有沒有成功送到後端（家人看不看得到）。 */
export const syncOk = ref(true);

async function commit(t: Trip) {
  trip.value = t;
  try {
    localStorage.setItem(KEY, JSON.stringify({ trip: t, token, offset, snap: tripSnap.value, shared: shared.value, askMode: askMode.value } satisfies Saved));
  } catch {}
  if (t.state === "asking") navigator.vibrate?.([300, 150, 300]);
  await pushToServer();
}

/** 把目前的行程存到後端；失敗就記下來，等連線恢復或下一輪再補。 */
async function pushToServer() {
  const t = trip.value;
  if (!t || !shared.value) return;
  try {
    await saveTrip(t, token);
    syncOk.value = true;
  } catch {
    syncOk.value = false;
  }
}

export function start(opts: { snap: Snapshot; destExit: string | null; name?: string }) {
  // 同時最多一趟進行中：已經有就不另開（要換路線請走 departFrom → confirmSwitch）
  if (active.value) return Promise.resolve();
  const plan = opts.snap.plan!;
  token = newWriteToken();
  offset = 0;
  tripSnap.value = opts.snap;
  shared.value = false;
  askMode.value = !askModeOff.value;
  const t0 = now();
  const walk = Object.fromEntries(plan.transfers.map((x) => [x.station, x.walkMin]));
  return commit({
    id: newTripId(),
    name: opts.name?.trim() || "家人",
    origin: opts.snap.origin,
    dest: opts.snap.dest,
    destExit: opts.destExit,
    milestones: buildMilestones(plan, t0, walk),
    reached: 0,
    state: "on-track",
    helpReason: null,
    askedAt: null,
    snoozeUntil: null,
    updatedAt: t0,
    expiresAt: t0 + TRIP_TTL_H * 3_600_000,
  });
}

/**
 * 路上換路線（電梯不能用）：步驟改用新的快照、時間表從現在重算，回到新路線的第一步。
 * 路線沒變（只是同站換出口）就只換快照、留在同一步。回傳換之前的狀態給「復原」。
 */
export function reroute(snap: Snapshot, opts: { sameRoute: boolean; destExit: string | null }) {
  const before = { trip: trip.value, snap: tripSnap.value };
  const t = trip.value;
  if (!t || !snap.plan) return before;
  tripSnap.value = snap;
  if (opts.sameRoute) {
    void commit({ ...t, updatedAt: now() });
    return before;
  }
  const t0 = now();
  const walk = Object.fromEntries(snap.plan.transfers.map((x) => [x.station, x.walkMin]));
  const milestones = buildMilestones(snap.plan, t0, walk);
  // 已經在站內：不用再算進站的 3 分鐘
  if (snap.inside) for (const m of milestones) (m.expectedAt -= 3 * 60_000), (m.deadline -= 3 * 60_000);
  void commit({ ...t, dest: snap.dest, destExit: opts.destExit, milestones, reached: 0, state: "on-track", askedAt: null, snoozeUntil: null, helpReason: null, updatedAt: t0 });
  return before;
}
/** 換路線的復原 */
export function undoReroute(b: { trip: Trip | null; snap: Snapshot | null }) {
  if (!b.trip) return;
  tripSnap.value = b.snap;
  return commit({ ...b.trip, updatedAt: now() });
}

// ---- 出發／換路線：永遠只有一趟 ----
/** 「要結束現在這趟，改走新的嗎？」等本人回答的新路線（由 App.vue 顯示） */
export const pendingSwitch = ref<{ snap: Snapshot; destExit: string | null } | null>(null);
/**
 * 按「出發」。回傳 "go"＝可以進行程頁（新開的，或同一條路線回到原本那趟）；
 * "ask"＝路線不同，已排入 pendingSwitch，等本人選。
 */
export async function departFrom(snap: Snapshot, destExit: string | null): Promise<"go" | "ask"> {
  const cur = tripSnap.value ?? snap;
  const a = departAction(trip.value, now(), { origin: snap.origin, dest: snap.dest }, { origin: cur.origin, dest: cur.dest });
  if (a === "resume") return "go";
  if (a === "switch") {
    pendingSwitch.value = { snap, destExit };
    return "ask";
  }
  clearLocal(); // 上一趟已到達／結束：清掉再開新的
  await start({ snap, destExit });
  return "go";
}
/** 本人選「結束這趟，改走新的」：先結束舊的（分享中的連結一併失效），再開新的。 */
export async function confirmSwitch(): Promise<boolean> {
  const p = pendingSwitch.value;
  pendingSwitch.value = null;
  if (!p) return false;
  if (trip.value) await commit(endTrip(trip.value, now()));
  clearLocal();
  await start({ snap: p.snap, destExit: p.destExit });
  return true;
}
export function cancelSwitch() {
  pendingSwitch.value = null;
}

export function reevaluate() {
  if (!trip.value) return;
  const t = evaluate(trip.value, now());
  if (t !== trip.value) void commit(t);
}
function retrySync() {
  if (!syncOk.value && shared.value) void pushToServer();
}
setInterval(() => {
  reevaluate();
  retrySync();
}, 15_000);
window.addEventListener("online", retrySync);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && reevaluate());

/** 本人決定分享：設定家人看到的稱呼，開始上傳。 */
export function share(name: string) {
  if (!trip.value) return;
  shared.value = true;
  return commit({ ...trip.value, name: name.trim() || "家人", updatedAt: now() });
}
/** 停止分享：家人的連結顯示已結束；之後再分享會是新的連結（舊連結不會復活）。行程本身繼續。 */
/** 回傳 false：伺服器沒收到（例如斷網），家人的連結可能仍有效 → 保留舊 token 讓使用者重試，不假裝已停止。 */
export async function stopShare(): Promise<boolean> {
  const t = trip.value;
  if (!t || !shared.value) return true;
  try {
    await saveTrip({ ...t, state: "ended", updatedAt: now() }, token);
  } catch {
    return false;
  }
  shared.value = false;
  token = newWriteToken();
  commit({ ...t, id: newTripId(), updatedAt: now() });
  return true;
}
export const arrivedAtNext = () => trip.value && commit(advance(trip.value, now()));
export const goBack = () => trip.value && commit(back(trip.value, now()));
export const imOk = () => trip.value && commit(replyOk(trip.value, now()));
export const needHelp = (reason: string) => trip.value && commit(askHelp(trip.value, reason, now()));
export const end = () => trip.value && commit(endTrip(trip.value, now()));
/** 結束分享的「復原」：5 秒內可以收回。 */
export function restore(t: Trip) {
  return commit({ ...t, updatedAt: now() });
}
/** 清掉本機的行程（不碰後端）。 */
function clearLocal() {
  trip.value = null;
  tripSnap.value = null;
  shared.value = false;
  askMode.value = false;
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
export function clearIfDone() {
  if (trip.value && !active.value) clearLocal();
}
export function fastForward() {
  offset += 5 * 60_000;
  reevaluate();
}
