// 雲端分享檢查：旅客和家人用兩個互不共用儲存的瀏覽器（模擬兩支手機），經過正式後端同步。
// 用法：node scripts/cloud-check.mjs [網址]（預設正式站）
import { chromium } from "playwright";
import { skipFirstRun, planTrip, startTrip } from "./_flow.mjs";

const URL = process.argv[2] ?? "https://codefest-mrt.jushenhuang-jason.workers.dev/";
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
let failed = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? `（${extra}）` : ""}`);
};

const meCtx = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
await skipFirstRun(meCtx);
const me = await meCtx.newPage();
await me.goto(URL + "?demo=1");
await planTrip(me, "動物園站", "淡水站");
const link = await startTrip(me);
check("家人連結是公開網址", link.startsWith(URL) && link.includes("#/family/"), link);

const fam = await (await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" })).newPage();
await fam.goto(link);
const loaded = await fam.getByText(/：動物園站 → 淡水站/).waitFor({ timeout: 20000 }).then(() => true, () => false);
check("另一支手機打開連結看得到行程", loaded);

// 旅客按「我需要幫忙」→ 滑到底 → 家人頁輪詢後出現
const asking = me.getByText("比預計時間晚了，還好嗎？");
for (let i = 0; i < 30 && !(await asking.isVisible()); i++) await me.getByRole("button", { name: /示範用/ }).click();
await me.getByRole("button", { name: "我需要幫忙" }).click();
const thumb = me.getByRole("button", { name: "確認通知家人" });
const tb = await thumb.boundingBox();
const track = await thumb.locator("..").boundingBox();
await me.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await me.mouse.down();
await me.mouse.move(track.x + track.width + 20, tb.y + tb.height / 2, { steps: 8 });
await me.mouse.up();
const t0 = Date.now();
const got = await fam.getByText(/需要幫忙/).first().waitFor({ timeout: 40000 }).then(() => true, () => false);
check("求助在家人的手機出現", got, `${Math.round((Date.now() - t0) / 1000)} 秒`);

// 家人頁只能讀：用 id 但沒有權杖寫入要被拒
const id = link.split("#/family/")[1];
const api = "https://codefest-trip.jushenhuang-jason.workers.dev/trips/" + id;
const r = await fetch(api, { method: "PUT", headers: { authorization: "Bearer " + "x".repeat(32) }, body: JSON.stringify({ id }) });
check("拿到連結的人不能改行程", r.status === 403, String(r.status));
const body = await (await fetch(api)).text();
check("讀取結果不含權杖雜湊", !body.includes("tokenHash"));

await me.getByRole("button", { name: "問題解決了" }).click();
await me.getByRole("button", { name: "結束這趟" }).click();
await browser.close();
console.log(failed ? `\n共 ${failed} 個問題` : "\n全部通過");
process.exit(failed ? 1 : 0);
