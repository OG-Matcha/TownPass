// 開發用：把網頁內建的「找服務」畫面截圖（桌面 Chrome、手機寬度），拿來和 Flutter 版對照樣式。
// 用法：node tool/semantic_search/shot_js.mjs <輸出 png 路徑> [查詢字串]
import { createRequire } from "node:module";
const require = createRequire(new URL("../a11y/", import.meta.url));
const { chromium } = require("playwright");
const { serve } = await import("../a11y/serve.mjs");
const [out, query] = process.argv.slice(2);
const server = await serve(0);
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 449, height: 1000 }, deviceScaleFactor: 2, locale: "zh-TW", reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/demo/service.html`);
await page.waitForFunction(() => !!window.__tpA11y);
const layer = page.locator("tp-a11y-layer");
await layer.locator("#fab").click();
await page.waitForTimeout(400);
await layer.locator("#find").click();
await page.waitForTimeout(400);
if (query) { await layer.locator("#q").fill(query); await layer.locator("#q").press("Enter"); await page.waitForTimeout(500); }
await page.screenshot({ path: out });
await browser.close(); server.close();
