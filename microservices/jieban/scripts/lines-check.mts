// 路線站序與開門方向（node --experimental-strip-types scripts/lines-check.mts）
import { readFileSync } from "node:fs";
import { planRoute } from "../src/lib/route.ts";
import { doorForDirection, lineStations, stationsAhead, towardTerminal } from "../src/lib/lines.ts";

const net = JSON.parse(readFileSync(new URL("../public/data/network.json", import.meta.url), "utf8"));
let failed = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `（${extra}）` : ""}`);
};

const seq = lineStations(net);
const main = seq.R.slice(0, seq.R.indexOf("新北投站"));
check("淡水信義線主線從淡水排到廣慈", [main[0], main[main.length - 1]].sort().join("/") === ["淡水站", "廣慈/奉天宮站"].sort().join("/"), main[0] + "…" + main[main.length - 1]);
check("新北投支線排在主線後面", seq.R[seq.R.length - 1] === "新北投站");
check("每條線都有站", Object.values(seq).every((l) => l.length > 5));
check("站數合計涵蓋所有站", new Set(Object.values(seq).flat()).size === new Set(net.items.flatMap((e: { a: string; b: string }) => [e.a, e.b])).size);

// 小南門 → 西門（往松山方向）：西門站「往松山-左側開門，往新店-右側開門」→ 左側
const leg1 = planRoute(net, "小南門站", "西門站")!.legs[0];
const ahead1 = stationsAhead(net, leg1);
check("往松山方向前方有松山站", ahead1.has("松山站") && !ahead1.has("新店站"));
check("西門站往松山 → 左側", doorForDirection("往松山-左側開門，往新店-右側開門", ahead1) === "左側開門");

// 西門 → 小南門（往新店方向）
const leg2 = planRoute(net, "西門站", "小南門站")!.legs[0];
check("往新店方向 → 右側", doorForDirection("往松山-左側開門，往新店-右側開門", stationsAhead(net, leg2)) === "右側開門");

// 中正紀念堂（淡水信義線）往大安方向：「往淡水-左側開門，往象山、大安-右側開門」
const leg3 = planRoute(net, "台北車站", "中正紀念堂站")!.legs[0];
check("台北車站→中正紀念堂（往象山）→ 右側", doorForDirection("往淡水-左側開門，往象山、大安-右側開門", stationsAhead(net, leg3)) === "右側開門");

check("小南門→西門 往松山方向", towardTerminal(net, leg1, ahead1) === "松山站", towardTerminal(net, leg1, ahead1));
const lz = planRoute(net, "三重國小站", "蘆洲站")!.legs[0];
check("往蘆洲支線 → 蘆洲", towardTerminal(net, lz, stationsAhead(net, lz)) === "蘆洲站", towardTerminal(net, lz, stationsAhead(net, lz)));
const lt = planRoute(net, "北投站", "淡水站")!.legs[0];
check("北投→淡水 往淡水（不是新北投）", towardTerminal(net, lt, stationsAhead(net, lt)) === "淡水站", towardTerminal(net, lt, stationsAhead(net, lt)));
check("沒有方向的資料原樣保留", doorForDirection("左側開門", new Set()) === "左側開門");
check("兩側都寫的資料改成白話", doorForDirection("左側開門，右側開門", new Set())!.includes("兩側"));
check("空值", doorForDirection(null, new Set()) === null);

console.log(failed ? `\n共 ${failed} 個問題` : "\n全部通過");
process.exit(failed ? 1 : 0);
