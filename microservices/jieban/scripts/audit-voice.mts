// 原則稽核 P2：一般人自然的說法，規則能聽懂幾成。node --experimental-strip-types scripts/audit-voice.mts
import { readFileSync } from "node:fs";
import { parseTripVoice, parseVoice } from "../src/lib/voiceCommand.ts";
import { stationsOf, type Network } from "../src/lib/route.ts";

const net = JSON.parse(readFileSync(new URL("../public/data/network.json", import.meta.url), "utf8")) as Network;
const stations = stationsOf(net);

// [說法, 期望意圖]
const trip: [string, string][] = [
  ["好了", "next"], ["到了", "next"], ["我下車了", "next"], ["接下來呢", "next"], ["然後呢", "next"], ["下一個", "next"],
  ["我在西門了", "next"], ["已經上車了", "next"], ["我進站了", "next"], ["OK 走吧", "next"], ["繼續", "next"],
  ["再講一遍", "speak"], ["剛剛說什麼", "speak"], ["我沒聽清楚", "speak"], ["要往哪走", "speak"], ["現在要幹嘛", "speak"], ["念一下", "speak"],
  ["電梯在哪裡", "help"], ["找不到電梯", "help"], ["我迷路了", "help"], ["電梯壞了", "help"], ["我需要人幫忙", "help"], ["救命", "help"],
  ["字太小了", "bigger"], ["看不到", "bigger"], ["大一點", "bigger"],
  ["上一步", "back"], ["回去上一步", "back"], ["我按錯了", "back"],
  ["結束", "end"], ["不去了", "end"],
];
let hit = 0;
const missT: string[] = [];
for (const [s, want] of trip) {
  const got = parseTripVoice(s);
  if (got === want) hit++;
  else missT.push(`${s}（要 ${want}，得 ${got}）`);
}
console.log(`路上自然說法：聽懂 ${hit}/${trip.length}`);
console.log("  聽不懂或聽錯：" + missT.join("、"));

const home: [string, (c: ReturnType<typeof parseVoice>) => boolean][] = [
  ["我要去台大醫院", (c) => c.some((x) => x.type === "route" && x.to === "台大醫院站")],
  ["帶我去北美館", (c) => c.length > 0],
  ["我想去台大醫院看病", (c) => c.some((x) => x.type === "route")],
  ["從家裡去仁愛醫院", (c) => c.length > 0],
  ["我在小南門，要去台大醫院", (c) => c.some((x) => x.type === "route" && x.from === "小南門站" && x.to === "台大醫院站")],
  ["去市圖總館", (c) => c.length > 0],
  ["回家", (c) => c.length > 0],
  ["跟上次一樣", (c) => c.length > 0],
  ["去淡水", (c) => c.some((x) => x.type === "route" && x.to === "淡水站")],
  ["明天早上要去台北車站", (c) => c.some((x) => x.type === "route") && c.some((x) => x.type === "date")],
];
let h2 = 0;
const missH: string[] = [];
for (const [s, ok] of home) {
  const c = parseVoice(s, stations);
  if (ok(c)) h2++;
  else missH.push(`${s}→${JSON.stringify(c)}`);
}
console.log(`首頁自然說法：聽懂 ${h2}/${home.length}`);
console.log("  聽不懂：" + missH.join("；"));
