// 端對端檢查：在桌面 Chrome 載入 tp-a11y.js，用假的城市通 App 橋接，驗證「找服務」的語意搜尋路徑：
// 有分數時排序、尚未開通的服務、App 失敗／沉默／格式錯誤時無聲退回規則搜尋、舊回覆不會蓋掉新結果。
// 假 App 的回覆格式與 lib/util/web_message_handler/service_rank_message_handler.dart、contract.json 一致。
//
// 用法：先 cd tool/a11y && npm ci，再 node tool/semantic_search/e2e.mjs
// 不能驗的：真的 WebView（InAppWebView）與真模型；那兩段在模擬器上量測（run_eval.sh）。
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../a11y/", import.meta.url));
const { chromium } = require("playwright");
const { serve } = await import("../a11y/serve.mjs");

const contract = JSON.parse(readFileSync(new URL("./contract.json", import.meta.url), "utf8"));
const server = await serve(0);
const SERVICE = `http://127.0.0.1:${server.address().port}/demo/service.html`;
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());

let failed = 0;
const errors = [];
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
}

// 假 App：21 個服務（含 14 個尚未開通），service_rank 依 window.__rank 的設定回覆
const FAKE_APP = (contractJson) => {
  const IDS = ["dedicatedLine", "districtOffice", "reportIssue", "reservation", "iVoting", "dashboard", "survey", "police", "neighborhood", "disasterReport", "vaccineAppointment", "medicalAppointment", "cityRadio", "familyCenter", "greenMap", "petFriendlyMap", "waterMeter", "essentialGoods", "library", "locationSearch", "zoo"];
  const TITLES = { dedicatedLine: "1999", districtOffice: "申辦服務", reportIssue: "有話要說", reservation: "臨櫃叫號", iVoting: "網路投票", dashboard: "市政資訊儀表板", survey: "意見調查", police: "警政服務", neighborhood: "里辦服務", disasterReport: "災情通報", vaccineAppointment: "疫苗預約", medicalAppointment: "聯醫掛號", cityRadio: "台北電台", familyCenter: "親子館", greenMap: "簡單森呼吸", petFriendlyMap: "寵物安心遛", waterMeter: "用水服務", essentialGoods: "民生物資", library: "圖書借閱", locationSearch: "找地點", zoo: "愛遊動物園" };
  const OPEN = { districtOffice: 1, reportIssue: 1, reservation: 1, dashboard: 1, disasterReport: 1, library: 1, locationSearch: 1 };
  const catalog = IDS.map((id) =>
    id === "dedicatedLine"
      ? { id, title: TITLES[id], description: "播打網路語音通話", category: "市政服務", tel: "1999" }
      : OPEN[id]
        ? { id, title: TITLES[id], description: "d", category: "x", url: `https://taipei-pass-service.vercel.app/${id}/` }
        : { id, title: TITLES[id], description: "d", category: "x", unavailable: true }
  );
  const listeners = new Set();
  window.__posted = [];
  window.__openFind = "false";
  window.__rank = { mode: "ok", top: {}, byQuery: null, delays: [] }; // top：服務 id → 突出的分數
  const reply = (name, data, delay = 20) => setTimeout(() => listeners.forEach((f) => f({ data: JSON.stringify({ name, data }) })), delay);
  window.flutterObject = {
    postMessage(raw) {
      const msg = JSON.parse(raw);
      window.__posted.push(msg);
      if (msg.name === "open_find_service") {
        // openFind：true＝App 接手（開 Flutter 頁）、false＝不處理（用網頁內建搜尋）、silent＝沒回應
        if (window.__openFind !== "silent") reply("open_find_service", window.__openFind === "true", 10);
        return;
      }
      if (msg.name === "service_catalog") reply("service_catalog", catalog, 10);
      if (msg.name === "a11y_settings") reply("a11y_settings", { enabled: true, fontLevel: "normal", highContrast: false, hand: "right" }, 10);
      if (msg.name === "service_rank") {
        const rid = msg.data.rid;
        const call = window.__posted.filter((m) => m.name === "service_rank").length - 1;
        const delay = window.__rank.delays[call] ?? 20;
        const m = window.__rank.mode;
        if (m === "silent") return; // 沒有回覆（逾時）
        if (m === "fail") return reply("service_rank", { ok: false, rid, reason: "not_ready" }, delay);
        if (m === "garbage") return reply("service_rank", { ok: true, rid, scores: "不是物件" }, delay);
        if (m === "otherRid") return reply("service_rank", { ok: true, rid: rid + 999, scores: Object.fromEntries(IDS.map((id) => [id, 0.8])) }, delay);
        const scores = {};
        IDS.forEach((id, i) => (scores[id] = 0.8 + (i % 3) * 0.004));
        // top 可以是 { 服務id: 分數 }，或 byQuery：{ 問句包含的字: { 服務id: 分數 } }
        const bq = window.__rank.byQuery;
        const key = bq && Object.keys(bq).find((k) => msg.data.query.includes(k));
        const picks = key ? bq[key] : window.__rank.top;
        Object.assign(scores, picks);
        reply("service_rank", { ok: true, rid, scores, model: "fake" }, delay);
      }
    },
    addEventListener: (_t, f) => listeners.add(f),
    removeEventListener: (_t, f) => listeners.delete(f),
  };
};

async function open({ app = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: "zh-TW", reducedMotion: "reduce" });
  if (app) await ctx.addInitScript(FAKE_APP, contract);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(SERVICE);
  await page.waitForFunction(() => !!window.__tpA11y);
  const layer = page.locator("tp-a11y-layer");
  await layer.locator("#fab").click();
  await page.waitForTimeout(300);
  await layer.locator("#find").click();
  await page.waitForTimeout(300);
  await page.waitForTimeout(100); // 讓 service_catalog 的回覆進來
  return { ctx, page, layer };
}
const setRank = (page, cfg) => page.evaluate((c) => Object.assign(window.__rank, c), cfg);
async function search(layer, page, text) {
  await layer.locator("#q").fill(text);
  await layer.locator("#q").press("Enter");
  await page.waitForTimeout(400);
}
const titles = (layer) => layer.locator("#results .result .l").allTextContents();
const status = async (layer) => (await layer.locator("#search-status").textContent()) || "";
const posted = (page, name) => page.evaluate((n) => window.__posted.filter((m) => m.name === n), name);

// ---------- 1. 語意分數：口語句找得到沒有任何關鍵字的服務 ----------
{
  const { ctx, page, layer } = await open();
  await setRank(page, { top: { petFriendlyMap: 0.95 } });
  await search(layer, page, "我家毛小孩想出去透透氣");
  const t = await titles(layer);
  check("口語句（規則搜尋找不到）靠語意分數找到「寵物安心遛」", t[0] === "寵物安心遛", t.join("、"));
  check("查詢送出的格式符合契約（query、ids 為 21 個、rid）", await (async () => {
    const m = (await posted(page, "service_rank"))[0];
    return m && m.data.query === "我家毛小孩想出去透透氣" && m.data.ids.length === 21 && typeof m.data.rid === "number" && Object.keys(m.data).sort().join() === Object.keys(contract.service_rank.request.data).sort().join();
  })());

  // ---------- 2. 尚未開通的服務 ----------
  check("尚未開通的服務卡片說明「還沒開通」並提供「撥 1999」", (await layer.locator("#results .result .why").first().textContent()).includes("還沒開通") && (await layer.locator("#results .result .go").first().textContent()) === "撥 1999");
  await layer.locator("#results .result").first().click();
  await page.waitForTimeout(200);
  const calls = await posted(page, "phone_call");
  check("點尚未開通的服務 → 走 App 撥 1999，不會導向任何網址", calls.length === 1 && calls[0].data === "1999" && page.url() === SERVICE, JSON.stringify(calls));
  await ctx.close();
}

// ---------- 2b. 有入口的服務、沒有關鍵字：說明是「意思很接近」 ----------
{
  const { ctx, page, layer } = await open();
  await setRank(page, { top: { locationSearch: 0.95 } });
  await search(layer, page, "我迷路了");
  const t = await titles(layer);
  const why = await layer.locator("#results .result .why").first().textContent();
  check("沒有關鍵字、只靠語意找到「找地點」，說明是「意思很接近」", t[0] === "找地點" && why.includes("意思"), `${t[0]}｜${why}`);
  check("有入口的服務按鈕是「前往」", (await layer.locator("#results .result .go").first().textContent()) === "前往");
  await ctx.close();
}

// ---------- 3. 有網址的服務照常前往；規則與語意並存 ----------
{
  const { ctx, page, layer } = await open();
  await page.route("https://taipei-pass-service.vercel.app/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>x</title><p>ok</p>" }));
  await setRank(page, { top: { library: 0.95 } });
  await search(layer, page, "想借書");
  const t = await titles(layer);
  check("說到關鍵字又語意很像 → 排第一", t[0] === "圖書借閱", t.join("、"));
  check("有關鍵字時說明引用關鍵字", (await layer.locator("#results .result .why").first().textContent()).includes("借書"));
  await layer.locator("#results .result").first().click();
  await page.waitForURL("**/library/**", { timeout: 3000 }).catch(() => {});
  check("有網址的服務照常前往", page.url().includes("/library/"), page.url());
  await ctx.close();
}

// ---------- 4. 沒有服務特別像 → 說找不到、提供 1999 ----------
{
  const { ctx, page, layer } = await open();
  await setRank(page, { top: {} });
  await search(layer, page, "幫我訂高鐵票");
  check("沒有服務突出 → 找不到並提供 1999", (await status(layer)).includes("1999") && (await titles(layer)).length === 0);
  await ctx.close();
}

// ---------- 5. 降級：App 失敗、沉默、亂回、回錯 rid → 用規則搜尋，使用者看不到任何錯誤 ----------
for (const [label, cfg, wait] of [
  ["App 回 ok:false（模型還沒準備好）", { mode: "fail" }, 400],
  ["App 回的分數不是物件", { mode: "garbage" }, 400],
  ["App 回了別次查詢的 rid", { mode: "otherRid" }, 2600],
  ["App 完全沒回覆（逾時）", { mode: "silent" }, 2600],
]) {
  const { ctx, page, layer } = await open();
  await setRank(page, cfg);
  await layer.locator("#q").fill("路燈壞了");
  await layer.locator("#q").press("Enter");
  await page.waitForTimeout(wait);
  const t = await titles(layer);
  const s = await status(layer);
  check(`${label} → 退回規則搜尋，結果與一般瀏覽器相同`, t[0] === "有話要說" && /找到 \d+ 個/.test(s), `${t.slice(0, 2).join("、")}｜${s}`);
  check(`${label} → 畫面沒有任何錯誤字眼`, !/錯誤|失敗|無法|error/i.test(await layer.locator("#panel").innerText()));
  await ctx.close();
}

// ---------- 6. 連續輸入：慢的舊回覆不能蓋掉新結果 ----------
{
  const { ctx, page, layer } = await open();
  await setRank(page, { byQuery: { 借書: { library: 0.95 }, 動物: { zoo: 0.95 } }, delays: [900, 20] });
  await layer.locator("#q").fill("借書");
  await layer.locator("#q").press("Enter");
  await page.waitForTimeout(100);
  await layer.locator("#q").fill("想去看動物");
  await layer.locator("#q").press("Enter");
  await page.waitForTimeout(1500);
  const t = await titles(layer);
  check("先問的慢回覆晚到，畫面仍是最新一次查詢的結果", t[0] === "愛遊動物園" && !t.includes("圖書借閱"), t.join("、"));
  await ctx.close();
}

// ---------- 7. 一般瀏覽器（沒有 App）：只有規則搜尋，不送任何訊息 ----------
{
  const { ctx, page, layer } = await open({ app: false });
  await search(layer, page, "路燈壞了");
  const t = await titles(layer);
  check("沒有 App 橋接時照常用規則搜尋", t[0] === "有話要說", t.join("、"));
  await ctx.close();
}

// ---------- 8. 在 App 內按「找服務」→ 交給 Flutter ----------
async function openPanelOnly(openFind) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: "zh-TW", reducedMotion: "reduce" });
  await ctx.addInitScript(FAKE_APP, contract);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(SERVICE);
  await page.waitForFunction(() => !!window.__tpA11y);
  await page.evaluate((v) => (window.__openFind = v), openFind);
  const layer = page.locator("tp-a11y-layer");
  await layer.locator("#fab").click();
  await page.waitForTimeout(300);
  return { ctx, page, layer };
}
{
  const { ctx, page, layer } = await openPanelOnly("true");
  await layer.locator("#find").click();
  await page.waitForTimeout(500);
  const msgs = await posted(page, "open_find_service");
  check("App 接手：送出 open_find_service（不帶資料）", msgs.length === 1 && msgs[0].data === null, JSON.stringify(msgs));
  check("App 接手：網頁內建的搜尋頁不會出現，選單收起", !(await layer.locator("#view-search").isVisible()) && !(await layer.locator("#panel").isVisible()));
  check("App 接手：不再自己送 service_rank", (await posted(page, "service_rank")).length === 0);
  await ctx.close();
}
for (const [label, mode, wait] of [["App 回 false（不處理）", "false", 600], ["App 沒回應（舊版 App）", "silent", 2200]]) {
  const { ctx, page, layer } = await openPanelOnly(mode);
  await layer.locator("#find").click();
  await page.waitForTimeout(wait);
  check(`${label} → 退回網頁內建的搜尋頁，使用者不會卡住`, await layer.locator("#view-search").isVisible());
  await layer.locator("#q").fill("路燈壞了");
  await layer.locator("#q").press("Enter");
  await page.waitForTimeout(500);
  check(`${label} → 內建搜尋照常可用`, (await titles(layer))[0] === "有話要說");
  await ctx.close();
}

check("沒有頁面錯誤", errors.length === 0, errors.join("；"));
await browser.close();
server.close();
console.log(failed ? `\n共 ${failed} 項失敗` : "\n全部通過");
process.exit(failed ? 1 : 0);
