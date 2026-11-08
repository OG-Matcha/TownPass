// 首頁分流檢查（兩顆大按鈕 → 去一個地方／走常走的路）：自己開 vite（預設 5174，PORT=… 可改；該埠已有服務就直接用），測完關掉。node scripts/home-flow-check.mjs
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { skipFirstRun } from "./_flow.mjs";

const PORT = Number(process.env.PORT ?? 5174);
const URL = `http://localhost:${PORT}/`;
const read = (f) => JSON.parse(readFileSync(new globalThis.URL(`../public/data/${f}.json`, import.meta.url), "utf8"));

// ---- 啟動 vite ----
const already = await fetch(URL).then((r) => r.ok, () => false);
const vite = already ? { pid: 0 } : spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "ignore" });
const stopVite = () => {
  if (already) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" });
    else vite.kill("SIGTERM");
  } catch {}
};
process.on("exit", stopVite);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(URL)).ok) break;
  } catch {}
  if (i > 60) {
    console.error("vite 沒有在 30 秒內啟動");
    stopVite();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}

// ---- 挑日期：有白天保養的一天（不能走）、整天沒有白天保養的一天（能走）----
const maint = read("maintenance").items.filter((m) => !m.night);
const badItem = maint.find((m) => m.date >= "2026-11-09") ?? maint[0];
const BAD_DAY = badItem.date;
const busyDays = new Set(maint.map((m) => m.date));
let OK_DAY = "";
for (let d = new Date("2026-11-09T00:00:00"); !OK_DAY; d.setDate(d.getDate() + 1)) {
  const s = d.toLocaleDateString("sv-SE");
  if (!busyDays.has(s)) OK_DAY = s;
}
const BAD = { origin: badItem.station, dest: badItem.station === "市政府站" ? "動物園站" : "市政府站" };
const OK = { origin: "動物園站", dest: "淡水站" };
console.log(`能走的日子 ${OK_DAY}（${OK.origin} → ${OK.dest}）；不能走的日子 ${BAD_DAY}（${BAD.origin} → ${BAD.dest}）`);

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? `  ${extra}` : ""}`);
};
const errors = [];

async function open(day, seed) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
  await skipFirstRun(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(`${day}T12:00:00`));
  await page.goto(URL);
  await page.evaluate((s) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
  }, seed);
  await page.goto(URL);
  await page.waitForFunction(() => !document.body.innerText.includes("載入車站中"));
  let n = 0;
  return { ctx, page, tap: async (loc) => (n++, loc.click()), count: () => n };
}
const saved = (r, count = 3) => ({ savedRoutes: [{ origin: r.origin, dest: r.dest, count, last: Date.now() }], origin: r.origin, dest: r.dest });
const hash = (page) => page.evaluate(() => location.hash);
const waitHash = (page, re) => page.waitForFunction((s) => new RegExp(s).test(location.hash), re.source, { timeout: 8000 }).then(() => true, () => false);

const btn = (page, name) => page.getByRole("button", { name });
const gone = async (page) => (await page.getByRole("heading", { name: "你現在哪裡不方便？" }).count()) === 0;
const groupItems = (page) => page.locator("section[aria-label='找到的地點'] li button");

// 1. 首頁：兩顆分流大按鈕、沒有自動詢問、沒有「繼續上次」或求助鈕
{
  const s = await open(OK_DAY, saved(OK));
  const go = btn(s.page, /去一個地方/);
  const often = btn(s.page, /走常走的路/);
  check("首頁有「去一個地方」", await go.isVisible());
  check("首頁有「走常走的路」", await often.isVisible());
  check("「去一個地方」寫著醫院、公園、區公所", (await go.innerText()).includes("醫院、公園、區公所"));
  const t = await often.innerText();
  check("「走常走的路」寫出最常走那條今天能不能走", t.includes("去淡水") && t.includes("今天可以走"), t.replace(/\n/g, "／"));
  const hb = await go.boundingBox();
  const ob = await often.boundingBox();
  check("兩顆按鈕高度 >= 64px", hb.height >= 64 && ob.height >= 64, `${Math.round(hb.height)}／${Math.round(ob.height)}px`);
  check("沒有自動詢問「你現在哪裡不方便？」", await gone(s.page));
  check("首頁沒有「繼續上次」或「求助」按鈕", (await s.page.getByRole("button", { name: /繼續|回到下一步|求助/ }).count()) === 0);
  check("首頁沒有查路線表單", (await s.page.getByRole("button", { name: "查路線" }).count()) === 0);
  await s.ctx.close();
}
// 1b. 沒有常走路線：寫「走過一次就會記住」，進去有按鈕帶到「去一個地方」
{
  const s = await open(OK_DAY, {});
  check("沒有常走路線時按鈕寫「走過一次就會記住」", (await btn(s.page, /走常走的路/).innerText()).includes("走過一次就會記住"));
  await s.tap(btn(s.page, /走常走的路/));
  check("沒有路線：說明並給「去一個地方」", (await waitHash(s.page, /#\/often/)) && (await s.page.getByText("走過一次就會記住").first().isVisible()));
  await s.tap(s.page.getByRole("button", { name: "去一個地方" }));
  check("按了到 #/go", await waitHash(s.page, /#\/go/));
  await s.ctx.close();
}
// 2. 走常走的路 → 今天出發：能走的路線 2 下到路上
{
  const s = await open(OK_DAY, saved(OK));
  await s.tap(btn(s.page, /走常走的路/));
  const go = s.page.getByRole("button", { name: /^今天出發/ });
  await go.first().waitFor();
  const box = await go.first().boundingBox();
  check("「今天出發」按鈕高度 >= 64px", box.height >= 64, `${Math.round(box.height)}px`);
  await s.tap(go.first());
  check("能走的路線：首頁起 2 下到 #/trip", (await waitHash(s.page, /#\/trip/)) && s.count() === 2, `共 ${s.count()} 下`);
  check("行程頁有步驟卡", await s.page.getByText(/第 \d+ 步，共/).first().isVisible());
  await s.ctx.close();
}
// 3. 有保養：去結果頁看警告，不直接上路
{
  const s = await open(BAD_DAY, saved(BAD));
  check("首頁按鈕提醒今天要注意", (await btn(s.page, /走常走的路/).innerText()).includes("今天要注意"));
  await s.tap(btn(s.page, /走常走的路/));
  await s.tap(s.page.getByRole("button", { name: /^今天出發/ }).first());
  check("不能走的路線：去 #/result", await waitHash(s.page, /#\/result/));
  check("結果頁看得到警告", await s.page.getByText(/個地方要注意/).first().isVisible());
  await s.ctx.close();
}
// 4. 多條路線：各自一張；移除仍在、卡片本體仍進結果頁
{
  const s = await open(OK_DAY, { savedRoutes: [{ ...saved(OK).savedRoutes[0] }, { origin: "小南門站", dest: "台北車站", count: 1, last: Date.now() }] });
  await s.tap(btn(s.page, /走常走的路/));
  check("列出每一條", (await s.page.getByRole("button", { name: /^今天出發/ }).count()) === 2);
  check("「移除」還在", await s.page.getByRole("button", { name: /從常走路線移除/ }).first().isVisible());
  await s.page.locator("ul li button").first().click();
  check("點卡片本體仍進結果頁", await waitHash(s.page, /#\/result/));
  await s.ctx.close();
}
// 5. 去一個地方：打字、最多 3 筆、選一筆、查路線；出發站預設帶最常走的起點
{
  const s = await open(OK_DAY, { savedRoutes: saved(OK).savedRoutes });
  await s.tap(btn(s.page, /去一個地方/));
  check("到 #/go", await waitHash(s.page, /#\/go/));
  const line = await s.page.getByRole("button", { name: /出發/ }).first().innerText();
  check("出發站空白時帶入常走路線的起點", line.includes("動物園"), line.replace(/\s+/g, " "));
  const box = s.page.getByRole("searchbox");
  check("輸入欄提示不提地址", !/地址/.test((await box.getAttribute("placeholder")) ?? ""));
  await box.fill("市立");
  const items = groupItems(s.page);
  await items.first().waitFor({ timeout: 15000 });
  const n = await items.count();
  check("找到的地點最多 3 筆", n >= 1 && n <= 3, `${n} 筆`);
  await s.page.getByRole("button", { name: "查路線" }).click();
  check("有多筆但沒選：請點一個", await s.page.getByText("請點一個地點").isVisible());
  await items.filter({ hasText: "美術館" }).first().click();
  await s.page.getByRole("button", { name: "查路線" }).click();
  check("選了地點按查路線：到 #/result", await waitHash(s.page, /#\/result/));
  check("結果頁有路線", await s.page.getByText(/約 \d+ 分・(不用轉乘|轉乘 \d+ 次)/).isVisible());
  await s.ctx.close();
}
// 6. 分類快捷鈕、沒有出發站要提示、改出發站連到選站再回來
{
  const s = await open(OK_DAY, {});
  await s.tap(btn(s.page, /去一個地方/));
  await btn(s.page, "醫院").click();
  const items = groupItems(s.page);
  await items.first().waitFor({ timeout: 15000 });
  check("按「醫院」就搜尋（框內帶入）", (await s.page.getByRole("searchbox").inputValue()) === "醫院" && (await items.count()) >= 1);
  await items.first().click();
  await s.page.getByRole("button", { name: "查路線" }).click();
  check("沒有出發站：提示請選出發的車站", await s.page.getByText("請選出發的車站").first().isVisible());
  await btn(s.page, /選車站/).first().click();
  check("改出發站連到 #/pick/origin", await waitHash(s.page, /#\/pick\/origin/));
  await s.page.getByLabel("打站名或地點找").fill("動物園");
  await s.page.getByRole("button", { name: "動物園站", exact: true }).click();
  check("選完回到「去一個地方」，輸入與出發站都在", (await waitHash(s.page, /#\/go/)) && (await s.page.getByRole("searchbox").inputValue()) === "醫院" && (await s.page.getByText(/動物園/).first().isVisible()));
  await s.ctx.close();
}
// 7. 路上需要：記住上次的選擇
{
  const s = await open(OK_DAY, saved(OK));
  await s.tap(btn(s.page, /去一個地方/));
  const walk = s.page.getByRole("checkbox", { name: "少走路" });
  check("需要電梯預設勾選", (await s.page.getByRole("checkbox", { name: "需要電梯" }).getAttribute("aria-checked")) === "true");
  check("少走路預設沒勾", (await walk.getAttribute("aria-checked")) === "false");
  await walk.click();
  await s.page.reload();
  check("重新整理後仍記得「少走路」", (await s.page.getByRole("checkbox", { name: "少走路" }).getAttribute("aria-checked")) === "true");
  const bx = await s.page.getByRole("checkbox", { name: "少轉乘" }).boundingBox();
  check("選項觸控目標 >= 48px", bx.height >= 48 && bx.width >= 48, `${Math.round(bx.width)}×${Math.round(bx.height)}`);
  await s.ctx.close();
}
// 8. 回家：沒存家就說怎麼辦；存了就直接選好
{
  const s = await open(OK_DAY, saved(OK));
  await s.tap(btn(s.page, /去一個地方/));
  await btn(s.page, "回家").click();
  check("沒存家：說明怎麼設定", await s.page.getByText(/還不知道家在哪一站/).isVisible());
  await s.ctx.close();
}
{
  const s = await open(OK_DAY, saved(OK));
  await s.page.evaluate(() => localStorage.setItem("homeStation", "淡水站"));
  await s.page.reload();
  await s.tap(btn(s.page, /去一個地方/));
  await btn(s.page, "回家").click();
  check("有存家：列出「家」與車站", await s.page.getByText("淡水站").first().isVisible());
  await s.page.getByRole("button", { name: "查路線" }).click();
  check("回家按查路線：到結果頁", await waitHash(s.page, /#\/result/));
  await s.ctx.close();
}

await browser.close();
stopVite();

if (errors.length) console.log("頁面錯誤：", errors.slice(0, 3));
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} 項失敗` : "\n全部通過");

// ---- homeIntent 單元檢查 ----
let unit = 0;
try {
  execSync("node --experimental-strip-types scripts/home-intent-check.mts", { stdio: "inherit", cwd: new globalThis.URL("..", import.meta.url) });
} catch {
  unit = 1;
}
process.exit(failed.length || errors.length || unit ? 1 : 0);
