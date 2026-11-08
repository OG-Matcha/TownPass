// 斷網檢查：擋掉網頁主機以外的所有請求（模擬評審關網路），規劃路線後底圖仍要載入本機圖磚。
// 用法：先 npm run dev，再 node scripts/offline-check.mjs [網址] [截圖檔]
import { chromium } from "playwright";
import { skipFirstRun, planTrip } from "./_flow.mjs";

const URL = process.argv[2] ?? "http://localhost:5173/";
const SHOT = process.argv[3];
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
await skipFirstRun(ctx);
let external = 0;
await ctx.route("**/*", (route) => {
  const u = new globalThis.URL(route.request().url());
  // 網頁本身在 App 裡是打包的，所以放行網頁所在主機，其餘一律斷線
  if (u.host === new globalThis.URL(URL).host) return route.continue();
  external++;
  return route.abort("internetdisconnected");
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const tiles = [];
page.on("response", (r) => {
  if (/\/tiles\/\d+\/\d+\/\d+\.jpg$/.test(r.url())) tiles.push(r.status());
});

await page.goto(URL);
await planTrip(page, "小南門站", "台大醫院站");
// 地圖收在「每一站怎麼走」裡，打開才載入圖磚
await page.getByText("每一站怎麼走").first().click();
for (let i = 0; i < 20 && tiles.length < 4; i++) await page.waitForTimeout(500);
await page.waitForTimeout(1500);
const map = page.locator(".maplibregl-map").first();
await map.scrollIntoViewIfNeeded();
if (SHOT) await map.screenshot({ path: SHOT });

// 放大到本機沒有的層級：要用上層圖磚放大，不能空白
const zoomIn = map.getByRole('button', { name: /zoom in|放大/i });
const before = external;
for (let i = 0; i < 3; i++) { await zoomIn.click(); await page.waitForTimeout(700); }
await page.waitForTimeout(1500);
if (SHOT) await map.screenshot({ path: SHOT.replace(/.png$/, '-zoom.png') });
const blank = await map.evaluate((el) => {
  const c = el.querySelector('canvas');
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0 && !(d[i] > 250 && d[i + 1] > 250 && d[i + 2] > 250)) n++;
  return n < 50;
});
let failed = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `（${extra}）` : ""}`);
};
check("斷網時路線規劃可用", true);
check("底圖從本機圖磚載入", tiles.length >= 4 && tiles.every((s) => s === 200), `${tiles.length} 張`);
check("放大到本機沒有的層級仍有底圖", !blank, `嘗試連線 ${external - before} 次`);
check("沒有頁面錯誤", !errors.length, errors.join("; "));
console.log(`（擋掉 ${external} 個對外請求）`);
await browser.close();
console.log(failed ? `\n共 ${failed} 個問題` : "\n全部通過");
process.exit(failed ? 1 : 0);
