// 「今天出發」：規劃今天這趟，今天沒有保養就直接開始行程（與結果頁「出發，一步一步帶我」同一套快照）。
import { checkRoute, date, dateChoice, dest, destExitOf, destPlace, doPlan, origin, result } from "./planner";
import { destinationOf } from "./places";
import { active, start, trip } from "./tripSession";

/** "trip" = 已開始行程；"result" = 去結果頁看警告或別天；"none" = 資料還沒好、規劃不了。 */
export async function departNow(o: string, d: string, opts: { date?: string } = {}): Promise<"trip" | "result" | "none"> {
  const day = opts.date ?? dateChoice(0);
  origin.value = o;
  dest.value = d;
  date.value = day;
  const place = destPlace.value?.station === d ? destinationOf(destPlace.value) : null;
  if (!doPlan(place)) return "none";
  const snap = result.value;
  if (!snap?.plan) return "result";
  if (day !== dateChoice(0) || !checkRoute(o, d, day)?.ok) return "result";
  // 已經在路上的另一趟：不蓋掉它，請本人到結果頁決定
  if (active.value && !(trip.value?.origin === o && trip.value?.dest === snap.dest)) return "result";
  if (!active.value) await start({ snap: JSON.parse(JSON.stringify(snap)), destExit: destExitOf(snap.dest) });
  return "trip";
}
