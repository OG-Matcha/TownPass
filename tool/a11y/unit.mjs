// 單元測試：tp-a11y.js 的純函式（語音指令解析、按偏判斷、對比計算、設定清理）。
// 用法：node tool/a11y/unit.mjs（不需要安裝套件）
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../../assets/a11y/tp-a11y.js", import.meta.url), "utf8");
const ctx = { globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(src, ctx);
const core = ctx.__tpA11yCore;

let fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    想要 ${JSON.stringify(want)}\n    得到 ${JSON.stringify(got)}`}`);
}

// 測試頁畫面上的按鈕（依畫面順序）
const names = ["09:00", "09:30", "10:00", "刪除預約", "上一步", "下一步", "查詢路線", "確認"];
const cmds = [
  ["返回", { type: "back" }],
  ["回上一頁", { type: "back" }],
  ["請幫我回去", { type: "back" }],
  ["往下", { type: "scroll", dir: "down" }],
  ["看上面一點", { type: "scroll", dir: "up" }],
  ["回到最上面", { type: "scroll", dir: "top" }],
  ["放大", { type: "font", dir: 1 }],
  ["字太小了看不清楚", { type: "font", dir: 1 }],
  ["字小一點", { type: "font", dir: -1 }],
  ["念給我聽", { type: "read" }],
  ["唸這頁", { type: "read" }],
  ["停止", { type: "stop" }],
  ["不要念了", { type: "stop" }],
  ["開高對比", { type: "contrast", on: true }],
  ["關掉高對比", { type: "contrast", on: false }],
  ["換左手", { type: "hand", hand: "left" }],
  ["可以說什麼", { type: "help" }],
  // 按鈕：完全相同 > 同義詞 > 部分相符；頁面有「上一步」按鈕時按按鈕，不當成返回
  ["下一步", { type: "press", index: 5 }],
  ["上一步", { type: "press", index: 4 }],
  ["繼續", { type: "press", index: 5 }],
  ["確定", { type: "press", index: 7 }],
  ["按查詢", { type: "press", index: 6 }],
  ["點 10:00", { type: "press", index: 2 }],
  ["按付款", { type: "notfound", target: "付款" }],
  ["今天天氣很好", { type: "unknown", text: "今天天氣很好" }],
  ["", { type: "unknown", text: "" }],
];
for (const [text, want] of cmds) eq(`指令「${text}」`, core.parseCommand(text, names), want);
// 沒有「上一步」按鈕時，「上一步」就是返回
eq("沒有上一步按鈕時當返回", core.parseCommand("上一步", ["下一步"]), { type: "back" });

eq("危險操作：刪除預約", core.isDangerous("刪除預約"), true);
eq("危險操作：送出申請", core.isDangerous("送出申請"), true);
eq("一般操作：下一步", core.isDangerous("下一步"), false);

// 按偏判斷
const r = { left: 100, right: 140, top: 100, bottom: 132 };
eq("矩形內距離為 0", core.distToRect(120, 110, r), 0);
eq("右側 20px", core.distToRect(160, 110, r), 20);
eq("24px 內算按偏", core.distToRect(150, 150, r) <= core.MISS.NEAR_PX, true);
eq("30 秒內 3 次 → 觸發", core.struggling([{ t: 0 }, { t: 10_000 }, { t: 20_000 }], 25_000), true);
eq("超過 30 秒的不算", core.struggling([{ t: 0 }, { t: 10_000 }, { t: 20_000 }], 35_000), false);

// 對比：城市通灰 #91a0a8 在白底只有 2.6:1；主色底配深字 ≥ 7
const rgb = (s) => core.parseRgb(s);
const W = rgb("rgb(255, 255, 255)");
eq("淺灰字對白底不足 7:1", core.contrast(rgb("rgb(145, 160, 168)"), W) < 7, true);
eq("主色底選深字", core.bestInk(rgb("rgb(90, 180, 197)")).r, 11);
eq("主色底深字 ≥ 7:1", core.contrast(core.bestInk(rgb("rgb(90, 180, 197)")), rgb("rgb(90, 180, 197)")) >= 7, true);
eq("深色底選白字", core.bestInk(rgb("rgb(34, 71, 78)")).r, 255);
eq("rgba 解析", core.parseRgb("rgba(0, 0, 0, 0.5)"), { r: 0, g: 0, b: 0, a: 0.5 });
eq("空格語法解析", core.parseRgb("rgb(0 0 0 / 50%)"), { r: 0, g: 0, b: 0, a: 0.5 });

// 設定清理：不認得的值回到預設
eq("設定清理", core.sanitizeSettings({ fontLevel: "huge", hand: "left", highContrast: "yes", evil: 1 }), {
  enabled: true,
  fontLevel: "normal",
  highContrast: false,
  hand: "left",
});
eq("字級往上到頂不再變", core.stepLevel("xlarge", 1), "xlarge");
eq("字級往下", core.stepLevel("large", -1), "normal");

// 找服務：市民的一句話 → 第一個推薦的服務
const top = (q) => core.searchServices(q)[0]?.service.id ?? null;
for (const [q, want] of [
  ["路燈壞了", "reportIssue"],
  ["我要預約臨櫃", "reservation"],
  ["戶政事務所要排隊嗎", "reservation"],
  ["家門口淹水", "disasterReport"],
  ["附近的無障礙廁所", "surrounding"],
  ["申請身障補助", "districtOffice"],
  ["借書", "library"],
  ["我不知道要找誰，想問人", "dedicatedLine"],
  ["臨櫃叫號", "reservation"],
  ["今天天氣很好", null],
  ["", null],
]) eq(`找服務「${q}」`, top(q), want);
eq("推薦理由列出命中的關鍵字", core.searchServices("路燈壞了")[0].reasons, ["路燈", "壞了"]);
eq("最多 5 個結果", core.searchServices("附近 申請 預約 淹水 借書 路燈 電話").length <= 5, true);

console.log(fail ? `\n${fail} 項失敗` : "\n全部通過");
process.exit(fail ? 1 : 0);
