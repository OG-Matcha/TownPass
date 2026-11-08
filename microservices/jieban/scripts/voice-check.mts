// 語音指令解析測試：node --experimental-strip-types scripts/voice-check.mts
import { readFileSync } from "node:fs";
import { parseTripVoice, parseVoice } from "../src/lib/voiceCommand.ts";
import { stationsOf, type Network } from "../src/lib/route.ts";

const net = JSON.parse(readFileSync(new URL("../public/data/network.json", import.meta.url), "utf8")) as Network;
const stations = stationsOf(net);
const today = new Date(2026, 10, 7); // 11/7

const cases: [string, unknown[]][] = [
  ["從小南門到台大醫院", [{ type: "route", from: "小南門站", to: "台大醫院站" }]],
  ["我要從臺大醫院站去淡水，幫我規劃", [{ type: "route", from: "台大醫院站", to: "淡水站" }, { type: "plan" }]],
  ["我要去淡水", [{ type: "route", to: "淡水站" }]],
  ["從南港展覽館出發", [{ type: "route", from: "南港展覽館站" }]],
  ["台北車站到南港", [{ type: "route", from: "台北車站", to: "南港站" }]],
  ["明天從動物園到淡水", [{ type: "date", date: "2026-11-08" }, { type: "route", from: "動物園站", to: "淡水站" }]],
  ["十一月三十號", [{ type: "date", date: "2026-11-30" }]],
  ["1月5日", [{ type: "date", date: "2027-01-05" }]],
  ["從台北101到世貿", [{ type: "route", from: "台北101/世貿站" }]],
  ["市政府到台北101", [{ type: "route", from: "市政府站", to: "台北101/世貿站" }]],
  ["念給我聽", [{ type: "speak" }]],
  ["字大一點", [{ type: "font", bigger: true }]],
  ["字太小了看不清楚", [{ type: "font", bigger: true }]],
  ["字小一點", [{ type: "font", bigger: false }]],
  ["怎麼走", [{ type: "plan" }]],
  ["今天天氣很好", [{ type: "date", date: "2026-11-07" }]],
  ["嗯嗯", []],
];

let fail = 0;
for (const [text, want] of cases) {
  const got = parseVoice(text, stations, today);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${text}${ok ? "" : `\n    想要 ${JSON.stringify(want)}\n    得到 ${JSON.stringify(got)}`}`);
}
// 路上指令（中文＋印尼語）
const trip: [string, string | null][] = [
  ["下一步", "next"], ["我到西門了", "next"], ["換好了", "next"], ["我出站了", "next"],
  ["唸給我聽", "speak"], ["再說一次", "speak"], ["找不到電梯", "help"], ["我需要幫忙", "help"],
  ["字大一點", "bigger"], ["縮小", "smaller"],
  ["lanjut", "next"], ["sudah sampai", "next"], ["baca", "speak"], ["tolong", "help"], ["lift tidak ketemu", "help"],
  ["今天天氣很好", null],
];
for (const [text, want] of trip) {
  const got = parseTripVoice(text);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} 路上：${text}${ok ? "" : ` 想要 ${want} 得到 ${got}`}`);
}
console.log(fail ? `\n${fail} 項失敗` : "\n全部通過");
process.exit(fail ? 1 : 0);
