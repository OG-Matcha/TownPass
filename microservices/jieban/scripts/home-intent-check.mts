// 首頁口語意圖測試：node --experimental-strip-types scripts/home-intent-check.mts
import { readFileSync } from "node:fs";
import { homeDeclaredIn, isGoHome, isSameAsLast, placeOrStationIn, routeIntent, type PlaceLite } from "../src/lib/homeIntent.ts";
import { stationsOf, type Network } from "../src/lib/route.ts";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}.json`, import.meta.url), "utf8"));
const stations = stationsOf(read("network") as Network);
const st = (id: string) => ({ "tpml-main-library": "南京三民站", "taipei-fine-arts-museum": "圓山站", "ntuh-west": "台大醫院站", "tpech-renai": "忠孝敦化站" })[id] ?? "市政府站";
const places: PlaceLite[] = (read("places") as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name, station: st(p.id) }));

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const P = (id: string) => ({ kind: "place", id, station: st(id) });
const hit = (t: string) => placeOrStationIn(t, stations, places);

eq("帶我去北美館", hit("帶我去北美館"), P("taipei-fine-arts-museum"));
eq("去市圖總館", hit("去市圖總館"), P("tpml-main-library"));
eq("市圖", hit("我想去市圖"), P("tpml-main-library"));
eq("台大醫院 → 地點", hit("去台大醫院"), P("ntuh-west"));
eq("臺大醫院 → 地點", hit("去臺大醫院"), P("ntuh-west"));
eq("仁愛醫院", hit("去仁愛醫院"), P("tpech-renai"));
eq("美術館", hit("帶我去美術館"), P("taipei-fine-arts-museum"));
eq("車站名 淡水", hit("去淡水"), { kind: "station", station: "淡水站" });
eq("車站名 動物園", hit("到動物園"), { kind: "station", station: "動物園站" });
eq("北車", hit("去北車"), { kind: "station", station: "台北車站" });
eq("沒有地點", hit("今天天氣很好"), null);
eq("空字串", hit(""), null);

const ri = (t: string) => routeIntent(t, stations, places);
eq("從家裡去仁愛醫院", ri("從家裡去仁愛醫院"), { from: null, fromHome: true, to: P("tpech-renai"), toHome: false });
eq("從北美館到淡水", ri("從北美館到淡水"), { from: P("taipei-fine-arts-museum"), fromHome: false, to: { kind: "station", station: "淡水站" }, toHome: false });
eq("帶我去北美館 無起點", ri("帶我去北美館"), { from: null, fromHome: false, to: P("taipei-fine-arts-museum"), toHome: false });
eq("回家", ri("我要回家").toHome, true);

eq("跟上次一樣", isSameAsLast("跟上次一樣"), true);
eq("老樣子", isSameAsLast("老樣子"), true);
eq("一樣的路", isSameAsLast("走一樣的路"), true);
eq("跟上次一樣 含標點", isSameAsLast("跟上次一樣，謝謝"), true);
eq("不是 same", isSameAsLast("帶我去北美館"), false);
eq("回家 isGoHome", isGoHome("我要回家"), true);
eq("回家 短", isGoHome("回家"), true);
eq("非回家", isGoHome("帶我去北美館"), false);
eq("家在淡水站", homeDeclaredIn("我家在淡水站", stations, places), "淡水站");
eq("家在 非宣告", homeDeclaredIn("從家裡去仁愛醫院", stations, places), null);

console.log(fail ? `\n${fail} 項失敗` : "\n全部通過");
process.exit(fail ? 1 : 0);
