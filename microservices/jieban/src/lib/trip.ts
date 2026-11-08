// 分享行程：依「預計時間表」判斷有沒有卡住（地下 GPS 不準，不靠定位）。
// 時間表來源：路線規劃的每段行駛秒數＋轉乘步行（已依狀況放寬）；每個節點再加電梯等待緩衝。

import { LINE_NAME, type Plan } from "./route.ts";

export const BUFFER_MIN = 5; // 每個節點的緩衝（等電梯、找出口），估計值
export const ASK_AFTER_NO_REPLY_MIN = 3; // 問「還好嗎？」後多久沒回應就通知家人
export const SNOOZE_MIN = 5; // 按「我沒事」後延後多久再問
export const TRIP_TTL_H = 6; // 連結最長有效時間

export type Milestone = {
  label: string; // 給人看：「到西門站，換板南線」
  station: string;
  expectedAt: number; // ms
  deadline: number; // expectedAt + 緩衝
};

export type TripState =
  | "on-track" // 照時間表
  | "asking" // 超時，正在問本人「還好嗎？」
  | "needs-help" // 本人按了需要幫忙
  | "no-response" // 問了沒回應
  | "arrived"
  | "ended";

export type Trip = {
  id: string;
  name: string; // 家人看到的稱呼
  origin: string;
  dest: string;
  destExit: string | null; // 求助卡用：「台大醫院站 出口1」
  milestones: Milestone[];
  reached: number; // 已到達的節點數（0 = 剛出發）
  state: TripState;
  helpReason: string | null; // 「找不到電梯」「需要幫忙」
  askedAt: number | null;
  snoozeUntil: number | null;
  updatedAt: number;
  expiresAt: number;
};

/** 由路線規劃建立節點：每段搭乘的到站、每次轉乘完成、出站。 */
export function buildMilestones(plan: Plan, startAt: number, walkMinByStation: Record<string, number>): Milestone[] {
  const out: Milestone[] = [];
  let t = startAt + 3 * 60_000; // 進站、搭電梯到月台，估計 3 分鐘
  plan.legs.forEach((leg, i) => {
    if (i > 0) {
      t += (walkMinByStation[leg.from] ?? 3) * 60_000;
      out.push({ label: `在${leg.from}轉乘${LINE_NAME[leg.line]}`, station: leg.from, expectedAt: t, deadline: t + BUFFER_MIN * 60_000 });
    }
    t += leg.sec * 1000 + 3 * 60_000; // 候車 3 分鐘
    const last = i === plan.legs.length - 1;
    out.push({
      label: last ? `到${leg.to}，準備出站` : `到${leg.to}`,
      station: leg.to,
      expectedAt: t,
      deadline: t + BUFFER_MIN * 60_000,
    });
  });
  t += 3 * 60_000; // 搭電梯出站
  out.push({ label: `從${plan.legs[plan.legs.length - 1].to}出站`, station: plan.legs[plan.legs.length - 1].to, expectedAt: t, deadline: t + BUFFER_MIN * 60_000 });
  return out;
}

/** 時間到了該做什麼（純函式，畫面每 15 秒或有動作時呼叫）。 */
export function evaluate(trip: Trip, now: number): Trip {
  if (trip.state === "arrived" || trip.state === "ended") return trip;
  if (now > trip.expiresAt) return { ...trip, state: "ended", updatedAt: now };
  if (trip.state === "needs-help" || trip.state === "no-response") return trip;
  if (trip.state === "asking") {
    if (trip.askedAt && now - trip.askedAt >= ASK_AFTER_NO_REPLY_MIN * 60_000)
      return { ...trip, state: "no-response", updatedAt: now };
    return trip;
  }
  const next = trip.milestones[trip.reached];
  if (!next) return trip;
  const snoozed = trip.snoozeUntil !== null && now < trip.snoozeUntil;
  if (now > next.deadline && !snoozed) return { ...trip, state: "asking", askedAt: now, updatedAt: now };
  return trip;
}

/** 本人按「我到了」：前進一個節點；最後一個 = 到達。 */
export function advance(trip: Trip, now: number): Trip {
  const reached = Math.min(trip.reached + 1, trip.milestones.length);
  const arrived = reached === trip.milestones.length;
  return { ...trip, reached, state: arrived ? "arrived" : "on-track", askedAt: null, snoozeUntil: null, helpReason: null, updatedAt: now };
}

export function replyOk(trip: Trip, now: number): Trip {
  return { ...trip, state: "on-track", askedAt: null, snoozeUntil: now + SNOOZE_MIN * 60_000, helpReason: null, updatedAt: now };
}

export function askHelp(trip: Trip, reason: string, now: number): Trip {
  return { ...trip, state: "needs-help", helpReason: reason, updatedAt: now };
}

export function endTrip(trip: Trip, now: number): Trip {
  return { ...trip, state: "ended", updatedAt: now };
}

/**
 * 家人頁用：旅客手機鎖屏、沒電或沒網路時，旅客端不會再更新。
 * 家人端自己依時間表判斷：超過截止時間又沒有新回報 → 視為延誤；再過 ASK_AFTER_NO_REPLY_MIN 分鐘 → 沒有回應。
 */
export function familyView(trip: Trip, now: number): Trip {
  if (trip.state !== "on-track") return trip;
  const next = trip.milestones[trip.reached];
  if (!next) return trip;
  const since = Math.max(next.deadline, trip.snoozeUntil ?? 0);
  if (now <= since || trip.updatedAt > since) return trip;
  if (now - since >= ASK_AFTER_NO_REPLY_MIN * 60_000) return { ...trip, state: "no-response" };
  return { ...trip, state: "asking", askedAt: since };
}

/** 家人頁的一句話摘要。 */
export function familySummary(trip: Trip, now: number): { tone: "ok" | "warn" | "alert" | "done"; text: string } {
  const last = trip.reached > 0 ? trip.milestones[trip.reached - 1] : null;
  const next = trip.milestones[trip.reached];
  const where = last ? `最後回報：${last.label}` : `從${trip.origin}出發`;
  const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));
  switch (trip.state) {
    case "arrived":
      return { tone: "done", text: `${trip.name}已經到${trip.dest}出站了` };
    case "ended":
      return { tone: "done", text: "行程已結束，不再分享" };
    case "needs-help":
      return { tone: "alert", text: `${trip.name}按了「${trip.helpReason ?? "需要幫忙"}」。${where}` };
    case "no-response":
      return { tone: "alert", text: `${trip.name}超過預計時間沒有回報，也沒有回應。${where}，下一站應該是${next?.station ?? trip.dest}` };
    case "asking":
      return { tone: "warn", text: `比預計晚了一點，正在詢問${trip.name}。${where}` };
    default:
      return {
        tone: "ok",
        text: next ? `${where}。預計約 ${mins(next.expectedAt - now)} 分鐘後${next.label}` : where,
      };
  }
}

/** 回上一步（說「上一步」、按錯了）：已到達的節點數減一，狀態回到照時間表。 */
export function back(trip: Trip, now: number): Trip {
  return { ...trip, reached: Math.max(0, trip.reached - 1), state: "on-track", askedAt: null, helpReason: null, updatedAt: now };
}

/**
 * 求助面板「發生什麼事？」：從一句話挑選項（簡單規則，不經模型）。
 * 1 = 電梯不能用，換一條路；2 = 找不到電梯；3 = 請站務人員來幫忙；null = 聽不出來，再問一次。
 */
export function helpChoice(text: string): 1 | 2 | 3 | null {
  if (/(壞|維修|不能用|不能搭|故障|換一條路|換路|排很久|排太久|rusak|perbaikan|tidak bisa dipakai|antre)/i.test(text)) return 1;
  if (/(找不到|在哪|tidak ketemu|di mana|dimana)/i.test(text)) return 2;
  if (/(站務|叫人|幫我|petugas|panggil)/i.test(text)) return 3;
  return null;
}

// ---- 行程生命週期 ----
// planned（已規劃、還沒按出發；不存檔）→ active（on-track / asking / needs-help / no-response）→ arrived | ended。
// 規則：同時最多一趟 active；arrived / ended / 過期的行程不算 active，下次開啟或出發時清掉。
export type TripPhase = "none" | "active" | "arrived" | "ended";
export function phaseOf(t: Trip | null, now: number): TripPhase {
  if (!t) return "none";
  if (t.state === "arrived") return "arrived";
  if (t.state === "ended" || t.expiresAt <= now) return "ended";
  return "active";
}
export const isActive = (t: Trip | null, now: number) => phaseOf(t, now) === "active";

export type DepartAction = "start" | "resume" | "switch";
/** 按「出發」：沒有進行中的行程 → 開新的；同一條路線 → 回到原本那趟；不同路線 → 先問要不要結束現在這趟。 */
export function departAction(cur: Trip | null, now: number, next: { origin: string; dest: string }, curRoute?: { origin: string; dest: string }): DepartAction {
  if (!cur || !isActive(cur, now)) return "start";
  const r = curRoute ?? cur;
  return r.origin === next.origin && r.dest === next.dest ? "resume" : "switch";
}
