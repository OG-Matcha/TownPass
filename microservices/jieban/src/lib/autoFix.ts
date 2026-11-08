// 出發前自動避開「預排保養」：不問使用者選哪個，直接改好、留一行小註解，可以改回原路線。
// 涵蓋：(1) 起訖站某個出口電梯當天白天保養 → 只列還能用的出口；
//       (2) 路線上有月台電梯保養／異常公告，且另一個方案問題比較少 → 改用那個方案
//          （改到另一站下車，只在原本目的地站所有出口都在保養時才做）。
// 不涵蓋：起點站所有出口都在保養（要換出發的車站，由本人決定）、臨時故障（沒有資料）。
// 預排保養是「排程」，不是「壞了」；文字一律寫「保養」。
import { chooseOption, fmtExit, isToday, mdw, result, status, stepsOf, type Snapshot, type Step } from "./planner";


export { fmtExit };

type Reason = "blocked" | "platform" | "anomaly" | "exit";
const REASON_TEXT: Record<Reason, string> = {
  blocked: "所有無障礙出口電梯白天都排定保養",
  platform: "月台電梯白天排定保養",
  anomaly: "有設施異常公告",
  exit: "出口電梯白天排定保養",
};

const maintainedExits = (station: string, date: string) => {
  const st = status(station, date);
  return st.entrances.filter((e) => st.dayExitWork.some((m) => m.place === e.exit));
};

/** 這一步還沒解決的問題。出口保養已自動改走其他出口就不算；本人改回原路線（strict）才算。 */
export function reasonsOf(s: Step, date: string, strict: boolean): Reason[] {
  if (!("st" in s)) return [];
  const out: Reason[] = [];
  const ends = s.kind === "enter" || s.kind === "exit";
  if (ends && s.st.blocked) out.push("blocked");
  if (s.st.dayPlatformWork.length) out.push("platform");
  if (s.st.anomalies.length) out.push("anomaly");
  if (strict && ends && !s.st.blocked && maintainedExits(s.st.station, date).length) out.push("exit");
  return out;
}
export type Issue = { step: Step; station: string; reasons: Reason[]; text: string };
export function issuesOf(snap: Snapshot): Issue[] {
  const strict = snap.autoFix?.state === "declined";
  return stepsOf(snap)
    .map((step) => ({ step, reasons: reasonsOf(step, snap.date, strict) }))
    .filter((x) => x.reasons.length && "st" in x.step)
    .map((x) => {
      const station = (x.step as Extract<Step, { st: unknown }>).st.station;
      return { step: x.step, station, reasons: x.reasons, text: x.reasons.map((r) => REASON_TEXT[r]).join("，") };
    });
}

export function applyAutoFix(): void {
  const r0 = result.value;
  if (!r0?.plan || r0.autoFix) return;
  const day = isToday(r0.date) ? "今天" : `在 ${mdw(r0.date)}`;
  const notes: string[] = [];

  // (2) 換方案
  const before = issuesOf(r0);
  if (before.length && r0.options.length > 1) {
    const destBlocked = before.some((i) => i.step.kind === "exit" && i.reasons.includes("blocked"));
    let best = -1;
    let bestN = before.length;
    let bestMin = Infinity;
    r0.options.forEach((o, i) => {
      if (i === r0.chosen) return;
      if (o.dest !== r0.dest && !destBlocked) return;
      const n = issuesOf({ ...r0, chosen: i, dest: o.dest, plan: o.plan }).length;
      if (n < bestN || (n === bestN && best >= 0 && o.plan.totalMin < bestMin)) {
        best = i;
        bestN = n;
        bestMin = o.plan.totalMin;
      }
    });
    if (best >= 0) {
      const o = r0.options[best];
      const first = before[0];
      chooseOption(best);
      notes.push(`${first.station}${REASON_TEXT[first.reasons[0]]}，已改走「${o.label}」（約 ${o.plan.totalMin} 分）`);
    }
  }

  // (1) 出口保養：不要列出保養中的出口
  const r1 = result.value!;
  const avoid: string[] = [];
  for (const s of stepsOf(r1)) {
    if ((s.kind !== "enter" && s.kind !== "exit") || s.st.blocked) continue;
    const bad = maintainedExits(s.st.station, r1.date);
    if (!bad.length) continue;
    const left = s.st.entrances.filter((e) => !bad.includes(e));
    avoid.push(...bad.map((e) => `${s.st.station}|${e.exit}`));
    notes.push(`${s.st.station} ${bad.map((e) => fmtExit(e.exit)).join("、")}電梯${day}白天保養，已改走 ${left.map((e) => fmtExit(e.exit)).join("、")}`);
  }

  result.value = {
    ...r1,
    avoidExits: [...(r1.avoidExits ?? []), ...avoid],
    autoFix: { state: "done", prevChosen: r0.chosen, ourAvoid: avoid, notes },
  };
}

/** 「改回原路線」：還原方案與出口，之後不再自動改。 */
export function revertAutoFix(): void {
  const r = result.value;
  const f = r?.autoFix;
  if (!r || !f || f.state !== "done") return;
  if (f.prevChosen !== r.chosen) chooseOption(f.prevChosen);
  const cur = result.value!;
  result.value = {
    ...cur,
    avoidExits: (cur.avoidExits ?? []).filter((x) => !f.ourAvoid.includes(x)),
    autoFix: { ...f, state: "declined", notes: [] },
  };
}
