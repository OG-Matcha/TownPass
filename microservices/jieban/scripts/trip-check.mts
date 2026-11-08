// 行程分享狀態測試：node --experimental-strip-types scripts/trip-check.mts
import { readFileSync } from "node:fs";
import { planRoute, type Network } from "../src/lib/route.ts";
import { advance, askHelp, buildMilestones, departAction, endTrip, evaluate, familySummary, familyView, helpChoice, isActive, phaseOf, replyOk, type Trip } from "../src/lib/trip.ts";

const net = JSON.parse(readFileSync(new URL("../public/data/network.json", import.meta.url), "utf8")) as Network;
const plan = planRoute(net, "小南門站", "台北車站", 1.5)!;
const t0 = Date.UTC(2026, 10, 30, 2, 0);
const MIN = 60_000;
const ms = buildMilestones(plan, t0, Object.fromEntries(plan.transfers.map((t) => [t.station, t.walkMin])));
const base: Trip = {
  id: "t", name: "阿嬤", origin: "小南門站", dest: "台北車站", destExit: null, milestones: ms, reached: 0,
  state: "on-track", helpReason: null, askedAt: null, snoozeUntil: null, updatedAt: t0, expiresAt: t0 + 6 * 60 * MIN,
};

const results: [string, boolean][] = [];
const check = (n: string, ok: boolean) => results.push([n, ok]);

check("節點依時間遞增", ms.every((m, i) => i === 0 || m.expectedAt > ms[i - 1].expectedAt));
check("最後一個節點是出站", ms.at(-1)!.label.includes("出站"));
check("準時：不打擾", evaluate(base, ms[0].expectedAt).state === "on-track");
const late = evaluate(base, ms[0].deadline + 1);
check("超過緩衝：先問本人", late.state === "asking");
check("問了 2 分鐘：還在等", evaluate(late, late.askedAt! + 2 * MIN).state === "asking");
check("問了 3 分鐘沒回：通知家人", evaluate(late, late.askedAt! + 3 * MIN).state === "no-response");
const ok = replyOk(late, late.askedAt! + MIN);
check("回我沒事：5 分鐘內不再問", evaluate(ok, late.askedAt! + 4 * MIN).state === "on-track");
check("回我沒事：5 分鐘後仍超時再問", evaluate(ok, late.askedAt! + 7 * MIN).state === "asking");
const help = askHelp(late, "找不到電梯", late.askedAt! + MIN);
check("按需要幫忙：家人看到原因", familySummary(help, help.updatedAt).text.includes("找不到電梯") && familySummary(help, 0).tone === "alert");
let t = base;
for (let i = 0; i < ms.length; i++) t = advance(t, t0 + i * MIN);
check("全部回報：到達", t.state === "arrived" && familySummary(t, 0).tone === "done");
// 旅客手機鎖屏／沒電：旅客端不再更新，家人端自己依時間表判斷
check("家人端：截止前顯示正常", familyView(base, ms[0].deadline).state === "on-track");
check("家人端：超過截止沒回報 → 延誤", familySummary(familyView(base, ms[0].deadline + MIN), ms[0].deadline + MIN).tone === "warn");
check("家人端：再過 3 分鐘 → 沒有回應（紅）", familySummary(familyView(base, ms[0].deadline + 3 * MIN), 0).tone === "alert");
check("家人端：旅客按過我沒事，延後期間不警示", familyView(ok, late.askedAt! + 4 * MIN).state === "on-track");
check("過期：結束分享", evaluate(base, base.expiresAt + 1).state === "ended");
// 需要幫忙面板：用講的挑選項（簡單規則）
check("「電梯壞了」→ 換一條路", helpChoice("電梯壞了") === 1 && helpChoice("在維修") === 1 && helpChoice("排很久") === 1 && helpChoice("電梯不能用") === 1);
check("「找不到」「在哪」→ 電梯在哪", helpChoice("我找不到電梯") === 2 && helpChoice("電梯在哪裡") === 2);
check("「站務」「叫人」「幫我」→ 站務人員", helpChoice("幫我叫站務人員") === 3 && helpChoice("叫人來") === 3);
check("印尼語也能挑", helpChoice("lift rusak") === 1 && helpChoice("lift tidak ketemu") === 2 && helpChoice("panggil petugas") === 3);
check("聽不出來 → 再問", helpChoice("今天天氣真好") === null);

// ---- 生命週期：planned → active → arrived / ended；同時最多一趟 ----
const same = { origin: base.origin, dest: base.dest };
const other = { origin: base.origin, dest: "西門站" };
check("沒有行程：phase none，出發＝開新的", phaseOf(null, t0) === "none" && departAction(null, t0, same) === "start");
check("進行中：phase active", phaseOf(base, t0) === "active" && isActive(askHelp(late, "x", t0), t0));
check("進行中 + 同路線出發 → 回到原本那趟（不重開）", departAction(base, t0, same) === "resume");
check("進行中（正在問還好嗎）+ 同路線出發 → 仍是回到原本那趟", departAction(late, t0, same) === "resume");
check("進行中 + 不同路線出發 → 先問要不要結束", departAction(base, t0, other) === "switch");
check("路上換過路線（trip 已改、快照為準）→ 以現行路線比較", departAction({ ...base, dest: "西門站" }, t0, same, same) === "resume");
const done = endTrip(base, t0 + MIN);
check("結束後：phase ended、不算進行中、出發＝開新的", phaseOf(done, t0) === "ended" && !isActive(done, t0) && departAction(done, t0, same) === "start" && departAction(done, t0, other) === "start");
check("到達後：phase arrived、出發＝開新的", phaseOf(t, t0) === "arrived" && departAction(t, t0, same) === "start");
check("過期：phase ended，出發＝開新的", phaseOf(base, base.expiresAt + 1) === "ended" && departAction(base, base.expiresAt + 1, same) === "start");
check("連按兩次出發：第二次看到進行中 → resume（不會兩趟）", departAction(base, t0, same) === "resume" && departAction(base, t0 + 1, same) === "resume");

for (const [n, ok] of results) console.log(`${ok ? "✓" : "✗"} ${n}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} 項失敗` : "\n全部通過");
process.exit(failed ? 1 : 0);
