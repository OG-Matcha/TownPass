// 快速檢查路線規劃結果（node --experimental-strip-types scripts/route-check.mts）
import { readFileSync } from "node:fs";
import { planRoute, LINE_NAME } from "../src/lib/route.ts";
const net = JSON.parse(readFileSync(new URL("../public/data/network.json", import.meta.url), "utf8"));
const cases: [string, string][] = [
  ["小南門站", "台大醫院站"],
  ["動物園站", "淡水站"],
  ["頂埔站", "南港展覽館站"],
  ["蘆洲站", "迴龍站"],
  ["新北投站", "小碧潭站"],
  ["幸福站", "大坪林站"],
  ["北投站", "新北投站"],
  ["南勢角站", "蘆洲站"],
];
for (const [o, d] of cases) {
  const p = planRoute(net, o, d, 1.5);
  if (!p) { console.log(o, "→", d, "NO ROUTE"); continue; }
  console.log(`${o} → ${d}  ${p.totalMin} 分`);
  p.legs.forEach((l) => console.log(`   ${LINE_NAME[l.line]} ${l.from}→${l.to} ${l.stops} 站 ${Math.round(l.sec / 60)} 分`));
  p.transfers.forEach((t) => console.log(`   轉乘 ${t.station} 步行約 ${t.walkMin} 分`));
}
