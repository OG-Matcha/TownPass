// 無障礙自動檢查：三段字級 × 首頁／選站（含地點搜尋）／顯示設定／結果／路上（步驟卡、詢問、求助階梯）／求助卡／家人頁／高對比，
// 跑 axe-core（WCAG 2.2 AA ＋ AAA 對比）、橫向捲動、觸控目標 ≥ 64px（城市通無障礙規範）。
// 用法：先開 dev server（npm run dev），再 node scripts/a11y-check.mjs [網址]
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { skipFirstRun, planTrip, startTrip } from "./_flow.mjs";

const URL = process.argv[2] ?? "http://localhost:5173/";
const LEVELS = ["normal", "large", "xlarge"];
const WIDTH = 360; // 常見 Android 小螢幕寬

// 優先用電腦已裝的 Chrome，免下載 Playwright 瀏覽器
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
let failed = 0;

async function scan(page, tag) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".maplibregl-canvas") // 底圖影像本身不在檢查範圍
    .analyze();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) {
    failed++;
    console.log(`${tag} ✗ 橫向捲動 ${overflow}px`);
  }
  for (const v of r.violations) {
    failed++;
    console.log(`${tag} ✗ ${v.id}（${v.impact}）${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`     ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1] ?? ""}`);
  }
  // 觸控目標 ≥ 64px（地圖內建控制鈕除外；勾選框以整個 label 為觸控區）
  const small = await page.evaluate(() => {
    const els = document.querySelectorAll('button, a[href], select, input:not([type=checkbox]):not([type=radio]), label:has(input[type=checkbox]), label:has(input[type=radio])');
    return [...els]
      .filter((el) => !el.closest(".maplibregl-map") && el.getClientRects().length)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 63.5 || r.width < 63.5)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}「${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 12)}」${Math.round(r.width)}×${Math.round(r.height)}`);
  });
  if (small.length) {
    failed++;
    console.log(`${tag} ✗ 觸控目標小於 64px：${small.slice(0, 5).join("、")}`);
  }
  if (!overflow && !r.violations.length && !small.length) console.log(`${tag} ✓ 通過 ${r.passes.length} 項規則`);
}

for (const level of LEVELS) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 800 }, locale: "zh-TW" });
  await skipFirstRun(ctx);
  await ctx.addInitScript((lv) => localStorage.setItem("fontLevel", lv), level);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tag = (stage) => `[${level}｜${stage}]`;
  // 首頁（兩顆分流按鈕）→ 去一個地方（空白、有結果、沒填提示）→ 選站（含地點搜尋）→ 顯示設定
  await page.goto(URL + "?demo=1");
  await page.getByRole("heading", { name: "今天要去哪裡？" }).waitFor();
  await scan(page, tag("首頁"));
  await page.getByRole("button", { name: /去一個地方/ }).click();
  await page.getByRole("button", { name: "查路線" }).waitFor();
  await page.waitForFunction(() => !document.querySelector("button[disabled]")?.textContent?.includes("載入"));
  await scan(page, tag("去一個地方・空白"));
  await page.getByRole("searchbox").fill("市立");
  await page.locator("section[aria-label='找到的地點'] li button").first().waitFor({ timeout: 15000 });
  await scan(page, tag("去一個地方・有結果"));
  await page.getByRole("button", { name: "查路線" }).click();
  await page.waitForTimeout(400);
  // 按了底部的查路線後頁面捲到下面，固定的標題列會半蓋住上方的快捷鈕；axe 會把「捲動中被固定列蓋住」算成目標太小。
  // 回到頂端再掃，檢查的是提示本身與整頁元件，不是捲動位置。
  await page.evaluate(() => window.scrollTo(0, 0));
  await scan(page, tag("去一個地方・沒填提示"));
  await page.getByRole("button", { name: /選車站|出發/ }).first().click();
  await page.getByText("淡水信義線").click();
  await scan(page, tag("選站"));
  await page.getByLabel("打站名或地點找").fill("台大醫院");
  await scan(page, tag("選站・地點搜尋"));
  await page.evaluate(() => (location.hash = "#/"));
  await page.getByRole("button", { name: "字級・語言" }).click();
  await scan(page, tag("顯示設定"));
  await page.getByRole("button", { name: "完成" }).click();

  // 結果：有問題（小南門 11/30 全部出口保養）、長路線、今天
  await planTrip(page, "小南門站", "台大醫院站", "2026-11-30");
  await scan(page, tag("結果・出口保養"));
  await planTrip(page, "動物園站", "淡水站", "2026-11-30");
  await scan(page, tag("結果・長路線"));
  await planTrip(page, "動物園站", "淡水站");
  await scan(page, tag("結果・今天"));
  await page.getByRole("button", { name: "每一站怎麼走" }).click();
  await page.getByRole("region", { name: "路線地圖" }).waitFor();
  await scan(page, tag("結果・每一站怎麼走展開"));
  await planTrip(page, "大安站", "動物園站", "2026-11-12");
  await page.getByTestId("autofix-note").waitFor();
  await scan(page, tag("結果・自動避開保養"));
  // 目的地是醫院：出站之後（出口、斜坡人行道施工、市政服務按鈕）
  await page.goto(URL + "?demo=1");
  await page.getByRole("button", { name: /去一個地方/ }).click();
  await page.getByRole("button", { name: "查路線" }).waitFor();
  await page.getByRole("searchbox").fill("醫學院附設醫院");
  const hosp = page.getByRole("button", { name: /國立臺灣大學醫學院附設醫院/ }).first();
  await hosp.waitFor({ timeout: 15000 });
  await hosp.click();
  await page.getByRole("button", { name: /出發|選車站/ }).first().click();
  await page.getByLabel("打站名或地點找").fill("動物園");
  await page.getByRole("button", { name: "動物園站", exact: true }).click();
  await page.getByRole("button", { name: "查路線" }).click();
  await page.getByTestId("services").waitFor();
  await scan(page, tag("結果・出站之後"));

  // 首頁有常走路線 → 走常走的路
  await page.goto(URL + "?demo=1");
  await page.getByRole("heading", { name: "今天要去哪裡？" }).waitFor();
  await page.getByText(/今天可以走|今天要注意/).waitFor();
  await scan(page, tag("首頁・常走路線"));
  await page.getByRole("button", { name: /走常走的路/ }).click();
  await page.getByRole("button", { name: /^今天出發/ }).first().waitFor();
  await scan(page, tag("走常走的路"));
  await planTrip(page, "動物園站", "淡水站");

  // 路上：出發面板（怎麼帶路＋選用分享）、步驟卡、詢問、需要幫忙（三選一、電梯在哪）、求助卡、家人頁
  await page.getByRole("button", { name: /出發，一步一步帶我/ }).click();
  await page.getByTestId("mode-sheet").waitFor();
  await scan(page, tag("出發面板"));
  await page.getByTestId("share-row").locator("summary").click();
  await scan(page, tag("出發面板・分享"));
  const link = await startTrip(page);
  await scan(page, tag("路上・步驟卡"));
  const asking = page.getByText("比預計時間晚了，還好嗎？");
  for (let i = 0; i < 30 && !(await asking.isVisible()); i++) await page.getByRole("button", { name: /示範用/ }).click();
  await asking.waitFor();
  await scan(page, tag("路上・詢問"));
  await page.getByRole("alertdialog").getByRole("button", { name: "需要幫忙" }).click();
  await scan(page, tag("需要幫忙"));
  await page.getByTestId("help-find").click();
  await scan(page, tag("需要幫忙・電梯在哪"));
  await page.getByTestId("help-sheet").getByRole("button", { name: "請站務人員來幫我" }).click();
  await scan(page, tag("求助卡"));
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  const fam = await ctx.newPage();
  fam.on("pageerror", (e) => errors.push(e.message));
  await fam.goto(link);
  await fam.getByText(/：動物園站 → 淡水站/).waitFor();
  await scan(fam, tag("家人頁"));
  await page.getByRole("button", { name: "結束這趟" }).click();
  await scan(page, tag("路上・已結束"));

  // 高對比模式
  await page.evaluate(() => localStorage.setItem("highContrast", "1"));
  await planTrip(page, "小南門站", "台大醫院站", "2026-11-30");
  await scan(page, tag("高對比・結果"));
  await page.evaluate(() => localStorage.setItem("highContrast", "0"));

  if (errors.length) {
    failed++;
    console.log(`[${level}] ✗ 頁面錯誤：${errors.join("; ")}`);
  }
  await ctx.close();
}
await browser.close();
console.log(failed ? `\n共 ${failed} 個問題` : "\n全部通過");
process.exit(failed ? 1 : 0);
