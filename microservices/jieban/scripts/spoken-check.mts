// 逐步導引口語稿測試：node --experimental-strip-types scripts/spoken-check.mts
// 用真實資料規劃一批站對，檢查每一步的 zh short：≤40 字、無禁用符號、無阿拉伯數字、≤3 句。
import { readFileSync } from "node:fs";

// planner / i18n 會碰 localStorage、document：node 沒有，先補最小的假物件
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
await import("vue"); // 先載入 vue（它會偵測 document），再補假 document 給 settings.ts
(globalThis as any).document = { documentElement: { style: {}, dataset: {} } };

const P = await import("../src/lib/planner.ts");
const { planRoute } = await import("../src/lib/route.ts");
const { rerouteSpoken, spokenCards } = await import("../src/lib/spoken.ts");

const rd = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}.json`, import.meta.url), "utf8"));
P.net.value = rd("network");
P.entrances.value = rd("elevators").items;
P.maint.value = rd("maintenance").items;
P.anomalies.value = rd("anomalies").items;
P.facilities.value = rd("facilities").items;

const all = P.stations.value as string[];
// 確定性取樣：每隔 stride 站取一個（約 18 站 → 306 個有序站對），再補幾組已知的轉乘路線
const stride = Math.max(1, Math.floor(all.length / 18));
const sample = all.filter((_, i) => i % stride === 0);
const pairs: [string, string][] = [];
for (const a of sample) for (const b of sample) if (a !== b) pairs.push([a, b]);
pairs.push(["小南門站", "市政府站"], ["動物園站", "淡水站"], ["頂埔站", "南港展覽館站"], ["蘆洲站", "迴龍站"], ["新北投站", "小碧潭站"], ["南勢角站", "蘆洲站"]);

// 日期：今天，加上保養筆數最多的幾天（讓警示句真的出現）
const byDate = new Map<string, number>();
for (const m of P.maint.value) byDate.set(m.date, (byDate.get(m.date) ?? 0) + 1);
const busy = [...byDate.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 2).map(([d]) => d);
const dates = ["2026-11-07", ...busy];

const FORBID = /[（）()→/／：:；;、]/;
const fails: string[] = [];
const samples: { zh: string; id: string; label: string }[] = [];
let cardsN = 0, routes = 0, transferRoutes = 0, warnCards = 0, maxLen = 0, withDetail = 0;
const seenWarn = new Set<string>();

for (const date of dates) {
  for (const [o, d] of pairs) {
    const plan = planRoute(P.net.value!, o, d, 1.5);
    if (!plan) continue;
    routes++;
    if (plan.transfers.length) transferRoutes++;
    const snap = { origin: o, dest: d, date, target: null, plan, options: [], chosen: 0 };
    const steps = P.stepsOf(snap);
    const expected = steps.filter((s) => s.kind !== "enter").length;
    const zh = spokenCards(steps, date, "zh");
    const id = spokenCards(steps, date, "id");
    const tag = `${date} ${o}→${d}`;
    if (zh.length !== expected || id.length !== expected) fails.push(`${tag}：張數 ${zh.length}/${id.length}，應為 ${expected}`);
    zh.forEach((c, i) => {
      cardsN++;
      const n = [...c.short].length;
      maxLen = Math.max(maxLen, n);
      const bad: string[] = [];
      if (n > 40) bad.push(`長度 ${n}`);
      if (FORBID.test(c.short)) bad.push(`禁用符號 ${c.short.match(FORBID)![0]}`);
      if (/[0-9]/.test(c.short)) bad.push("阿拉伯數字");
      if (c.short.split("。").filter(Boolean).length > 3) bad.push("超過 3 句");
      if (/今天沒有排定|!|！/.test(c.short)) bad.push("不該出現的句子");
      if (/[0-9]/.test(c.detail ?? "") && /\d{4,}/.test(c.detail ?? "")) bad.push("detail 有長數字");
      if (bad.length) fails.push(`${tag} #${i + 1} ${bad.join("、")}：${c.short}`);
      if (id[i].short.split(/\. /).length > 3 + 1) fails.push(`${tag} #${i + 1} id 句數過多：${id[i].short}`);
      if (c.detail) withDetail++;
      if (c.short.includes("注意")) {
        warnCards++;
        const k = c.short.split("。").find((x) => x.startsWith("注意"))!.replace(/這站|[^　-鿿，]/g, "").slice(0, 14);
        if (!seenWarn.has(k)) { seenWarn.add(k); samples.push({ label: `${tag} #${i + 1}（警示）`, zh: c.short, id: id[i].short }); }
      }
    });
    if (plan.transfers.length >= 1 && samples.length < 40 && date === dates[0] && samples.filter((s) => s.label.includes("轉乘")).length < 3)
      samples.push({ label: `${tag}（轉乘）`, zh: zh.map((c) => c.short).join("\n    "), id: id.map((c) => c.short).join("\n    ") });
  }
}

// 路上「電梯不能用，換一條路」：每一步都試換路；換到的路要能產生口語稿，換路那一句 ≤40 字、無符號、無數字
let rerouted = 0, rerouteTried = 0;
const transferAvoided: string[] = [];
for (const [o, d] of pairs) {
  const plan = planRoute(P.net.value!, o, d, 1.5);
  if (!plan) continue;
  const snap = { origin: o, dest: d, date: dates[0], target: null, plan, options: [], chosen: 0 };
  const steps = P.stepsOf(snap);
  const n = steps.filter((s) => s.kind !== "enter").length;
  for (let i = 0; i < n; i++) {
    const spot = P.spotOf(steps, i);
    if (!spot) { fails.push(`${o}→${d} 第 ${i + 1} 步找不到電梯位置`); continue; }
    rerouteTried++;
    const r = P.rerouteAround(snap, spot);
    if (!r) continue;
    rerouted++;
    const tag = `換路 ${o}→${d} #${i + 1}（${spot.kind} ${spot.station}）`;
    if (spot.kind === "transfer" && r.snap.plan!.transfers.some((t) => t.station === spot.station)) fails.push(`${tag}：還是在原站轉乘`);
    if (spot.kind === "transfer" && r.snap.plan!.legs[0].line !== spot.line) fails.push(`${tag}：不是從原本的月臺出發`);
    if (spot.kind === "transfer" && transferAvoided.length < 3) transferAvoided.push(`${tag} → ${r.change.kind === "transfer" ? r.change.via.join("、") || "不用轉乘" : ""}`);
    const st2 = P.stepsOf(r.snap);
    const cards2 = spokenCards(st2, dates[0], "zh");
    if (!cards2.length || cards2.length !== st2.filter((s) => s.kind !== "enter").length) fails.push(`${tag}：新路線口語稿張數不對`);
    if (r.snap.inside && st2[0].kind === "enter") fails.push(`${tag}：站內換路不該有進站`);
    const c = r.change;
    const say = c.kind === "transfer" ? rerouteSpoken({ kind: "transfer", via: c.via, dest: r.snap.dest }, "zh") : rerouteSpoken(c.kind === "origin" ? { kind: "origin", station: c.station } : { kind: "dest", station: c.station }, "zh");
    if ([...say].length > 40 || FORBID.test(say) || /[0-9]/.test(say)) fails.push(`${tag}：換路口語 ${say}`);
  }
}
console.log(`換路：試 ${rerouteTried} 步，找得到別的路 ${rerouted} 步。例：`);
for (const x of transferAvoided) console.log(`  ${x}`);
if (rerouted < rerouteTried * 0.5) fails.push(`換路成功率太低：${rerouted}/${rerouteTried}`);
for (const e of ["出口1", "M2", "2號出口", "單一出口"]) {
  const say = rerouteSpoken({ kind: "exit", exit: e, ramp: false, enter: true }, "zh");
  if ([...say].length > 40 || FORBID.test(say) || /[0-9]/.test(say)) fails.push(`換出口口語：${say}`);
}

// 指定範例：小南門 → 市政府第 1 步
{
  const plan = planRoute(P.net.value!, "小南門站", "市政府站", 1.5)!;
  const steps = P.stepsOf({ origin: "小南門站", dest: "市政府站", date: dates[0], target: null, plan, options: [], chosen: 0 });
  const zh = spokenCards(steps, dates[0], "zh"), id = spokenCards(steps, dates[0], "id");
  console.log("== 小南門 → 市政府（全部步驟）==");
  zh.forEach((c, i) => console.log(`  zh${i + 1} short: ${c.short}\n      detail: ${c.detail}\n  id${i + 1} short: ${id[i].short}\n      detail: ${id[i].detail}`));
}
console.log("\n== 取樣（8 筆）==");
samples.slice(0, 8).forEach((s) => console.log(`[${s.label}]\n  zh: ${s.zh}\n  id: ${s.id}`));

console.log(`\n路線 ${routes}（含轉乘 ${transferRoutes}），站對 ${pairs.length} × 日期 ${dates.length}，卡片 ${cardsN}，警示卡 ${warnCards}，有 detail ${withDetail}，最長 short ${maxLen} 字`);
if (pairs.length < 150) fails.push(`站對只有 ${pairs.length}，少於 150`);
if (fails.length) {
  console.log(`\n失敗 ${fails.length} 項（前 25）`);
  fails.slice(0, 25).forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}
console.log("\n全部通過");
