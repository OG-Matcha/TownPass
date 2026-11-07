// 整合檢查：在桌面 Chrome 把 tp-a11y.js 載入模擬微服務，逐項驗證交接包第 7 節的驗收條件。
// 用法：cd tool/a11y && npm ci && node check.mjs
// 不需要 App：App 的橋接（flutterObject）用假的物件模擬，回覆格式與 lib/util/web_message_handler/ 一致。
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { serve } from "./serve.mjs";

const server = await serve(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const SERVICE = `${BASE}/demo/service.html`;
const OWN = `${BASE}/demo/own.html`;
const VIEW = { width: 360, height: 800 }; // 常見 Android 小螢幕

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
let failed = 0;
const errors = [];
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
}

// 假的城市通 App 橋接：記錄網頁送出的訊息，並照 handler 的格式回覆
const FAKE_APP = () => {
  const listeners = new Set();
  window.__posted = [];
  window.__appSettings = { enabled: true, fontLevel: "xlarge", highContrast: false, hand: "left" };
  window.flutterObject = {
    postMessage(raw) {
      const msg = JSON.parse(raw);
      window.__posted.push(msg);
      setTimeout(() => {
        let data = null;
        if (msg.name === "a11y_settings") {
          if (msg.data.action === "set") window.__appSettings = { ...msg.data.settings, enabled: true };
          data = window.__appSettings;
        }
        if (msg.name === "tts") data = { ok: true };
        if (msg.name === "speech_to_text") data = { text: "下一步" };
        if (data) listeners.forEach((f) => f({ data: JSON.stringify({ name: msg.name, data }) }));
      }, 30);
    },
    addEventListener: (_t, f) => listeners.add(f),
    removeEventListener: (_t, f) => listeners.delete(f),
  };
};

async function open(url, { app = false, settings = null, block = false, reduce = false } = {}) {
  const ctx = await browser.newContext({ viewport: VIEW, locale: "zh-TW", reducedMotion: reduce ? "reduce" : "no-preference" });
  if (app) await ctx.addInitScript(FAKE_APP);
  if (settings) await ctx.addInitScript((s) => (window.__TP_A11Y_SETTINGS__ = s), settings);
  if (block) await ctx.route("**/tp-a11y.js", (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${url}: ${e.message}`));
  await page.goto(url);
  if (!block) await page.waitForFunction(() => !!window.__tpA11y);
  return { ctx, page };
}

const layer = (page) => page.locator("tp-a11y-layer");
const zoom = (page) => page.evaluate(() => getComputedStyle(document.body).zoom);
const visibleIn = (page, sel) => layer(page).locator(sel).isVisible();

async function axe(page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(" ")}`));
}

/** 在「刪除預約」小按鈕右側 14px 的空白處點一下（24px 內有可按元件 → 算按偏）。 */
async function missTap(page, text = "刪除預約") {
  const box = await page.getByRole("button", { name: text, exact: true }).boundingBox();
  await page.mouse.click(box.x + box.width + 14, box.y + box.height / 2);
}

/** 等操作輔助的進場動畫跑完（動畫中途量到的是縮小的尺寸）。 */
const settle = (page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .querySelector("tp-a11y-layer")
        .shadowRoot.getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    ),
  );

/** 浮動列與操作輔助自己的觸控目標都要 ≥ 64px。 */
async function smallTargets(page) {
  await settle(page);
  return page.evaluate(() => {
    const root = document.querySelector("tp-a11y-layer").shadowRoot;
    return [...root.querySelectorAll("button, input")]
      .filter((el) => el.getClientRects().length)
      .map((el) => ({ id: el.id || el.textContent.trim(), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 63.5 || r.height < 63.5)
      .map(({ id, r }) => `${id} ${Math.round(r.width)}×${Math.round(r.height)}`);
  });
}

// ---------- 驗收 6：載入前後 axe 沒有新增違規 ----------
{
  const before = await open(SERVICE, { block: true });
  const base = await axe(before.page);
  await before.ctx.close();
  const { ctx, page } = await open(SERVICE);
  const states = { 收起: [] };
  states.收起 = await axe(page);
  await layer(page).locator("#fab").click();
  states.操作列展開 = await axe(page);
  await page.keyboard.press("Escape");
  for (let i = 0; i < 3; i++) await missTap(page);
  await layer(page).locator("#ask").waitFor({ state: "visible" });
  states.按偏詢問 = await axe(page);
  await layer(page).locator("#ask-yes").click();
  states.放大後 = await axe(page);
  for (const [name, list] of Object.entries(states)) {
    const added = list.filter((v) => !base.includes(v));
    check(`axe：${name}沒有新增違規`, added.length === 0, added.slice(0, 4).join("；") || `頁面原有 ${base.length} 項`);
  }
  await ctx.close();
}

// ---------- 驗收 1：浮動列出現、不擋主要按鈕；自己的觸控目標 ≥ 64 ----------
{
  const { ctx, page } = await open(SERVICE);
  await settle(page);
  const fab = await layer(page).locator("#fab").boundingBox();
  const bar = await page.locator(".bar").boundingBox();
  check("浮動鈕出現在右下角", fab && fab.x + fab.width <= VIEW.width - 15 && fab.y + fab.height <= VIEW.height - 96, `距底 ${Math.round(VIEW.height - fab.y - fab.height)}px`);
  check("浮動鈕不擋頁面底部按鈕列", fab.y + fab.height <= bar.y, `浮動鈕底 ${Math.round(fab.y + fab.height)}、按鈕列頂 ${Math.round(bar.y)}`);
  check("浮動鈕 64×64", Math.round(fab.width) === 64 && Math.round(fab.height) === 64);
  await layer(page).locator("#fab").click();
  const small = await smallTargets(page);
  check("操作列觸控目標都 ≥ 64px", small.length === 0, small.join("、"));
  await ctx.close();
}

// ---------- 驗收 2：按偏 3 次 → 詢問 → 同意 → 放大，重新開啟仍維持 ----------
{
  const { ctx, page } = await open(SERVICE);
  await missTap(page);
  await missTap(page);
  check("按偏 2 次還不問", !(await visibleIn(page, "#ask")));
  await missTap(page);
  await layer(page).locator("#ask").waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  check("按偏第 3 次跳出詢問", await visibleIn(page, "#ask"));
  const focused = await page.evaluate(() => document.querySelector("tp-a11y-layer").shadowRoot.activeElement?.id);
  check("詢問出現時焦點在「放大」", focused === "ask-yes", focused);
  check("詢問卡觸控目標 ≥ 64px", (await smallTargets(page)).length === 0);
  await layer(page).locator("#ask-yes").click();
  check("同意後整頁放大到 1.25", (await zoom(page)) === "1.25", await zoom(page));
  await page.reload();
  await page.waitForFunction(() => !!window.__tpA11y);
  check("重新開啟仍維持放大", (await zoom(page)) === "1.25");
  // 特大也不能出現橫向捲動
  await page.evaluate(() => window.__tpA11y.setSettings({ fontLevel: "xlarge" }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("特大字級沒有橫向捲動", overflow <= 0, `${overflow}px`);
  await ctx.close();
}
{
  const { ctx, page } = await open(SERVICE);
  for (let i = 0; i < 3; i++) await missTap(page);
  await layer(page).locator("#ask-no").click();
  await page.waitForTimeout(100);
  for (let i = 0; i < 3; i++) await missTap(page);
  await page.waitForTimeout(800);
  check("說「不用」後這次不再問", !(await visibleIn(page, "#ask")));
  await ctx.close();
}
{
  const { ctx, page } = await open(SERVICE);
  const slot = page.getByRole("button", { name: "10:00", exact: true });
  for (let i = 0; i < 4; i++) await slot.click({ delay: 0 });
  await layer(page).locator("#ask").waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  check("同一顆按鈕 600ms 內連點也會問", await visibleIn(page, "#ask"));
  await ctx.close();
}

// ---------- 驗收 5：頁面宣告 own:font,own:misstap 時不重複處理 ----------
{
  const { ctx, page } = await open(OWN);
  const chip = await page.getByRole("button", { name: "甲" }).boundingBox();
  for (let i = 0; i < 3; i++) await page.mouse.click(chip.x + 4, chip.y + chip.height + 12);
  await page.waitForTimeout(800);
  check("own:misstap → 不跳按偏詢問", !(await visibleIn(page, "#ask")));
  await layer(page).locator("#fab").click();
  await layer(page).locator("#font-up").click();
  check("own:font → 不縮放頁面", (await zoom(page)) === "1");
  check("own:font → 頁面收到設定自己放大", (await page.locator("#got").textContent()) === "large");
  await ctx.close();
}

// ---------- 驗收 4：用講的（指令解析在 unit.mjs，這裡測畫面上真的會動） ----------
{
  const { ctx, page } = await open(SERVICE);
  await page.getByRole("button", { name: "09:30" }).click();
  await page.evaluate(() => window.__tpA11y.runCommand("下一步"));
  await page.locator("#step2").waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  check("說「下一步」→ 按下頁面的下一步", await page.locator("#step2").isVisible());
  await page.evaluate(() => window.__tpA11y.runCommand("返回"));
  await page.locator("#step1").waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  check("說「返回」→ 回上一頁", await page.locator("#step1").isVisible());
  await page.evaluate(() => window.__tpA11y.runCommand("刪除預約"));
  check("說「刪除預約」→ 先確認，不直接按", (await visibleIn(page, "#confirm")) && (await page.locator("#del-result").textContent()) === "");
  await layer(page).locator("#confirm-yes").click();
  await page.waitForTimeout(700);
  check("確認後才按下", (await page.locator("#del-result").textContent()).includes("已刪除"));
  // 從畫面操作：輔助 → 用講的 → 打字
  await layer(page).locator("#fab").click();
  await layer(page).locator("#voice").click();
  check("用講的面板出現", await visibleIn(page, "#listen"));
  check("用講的面板觸控目標 ≥ 64px", (await smallTargets(page)).length === 0, (await smallTargets(page)).join("、"));
  await layer(page).locator("#typed").fill("今天天氣很好");
  await layer(page).locator("#typed").press("Enter");
  const help = await layer(page).locator("#listen-status").textContent();
  const hint = await layer(page).locator("#listen-hint").textContent();
  check("聽不懂時給例句", help.includes("不知道要做什麼") && hint.includes("返回") && hint.includes("下一步"), help);
  await layer(page).locator("#typed").fill("字大一點");
  await layer(page).locator("#typed").press("Enter");
  check("打字「字大一點」→ 放大", (await zoom(page)) === "1.25");
  await ctx.close();
}

// ---------- App 內：設定以 App 為準、朗讀與語音走 App handler ----------
{
  const { ctx, page } = await open(SERVICE, { app: true });
  await page.waitForFunction(() => getComputedStyle(document.body).zoom === "1.5", null, { timeout: 3000 }).catch(() => {});
  check("App 內套用 App 存的設定（特大、左手）", (await zoom(page)) === "1.5" && (await layer(page).getAttribute("data-hand")) === "left");
  await layer(page).locator("#fab").click();
  await layer(page).locator("#font-down").click();
  await page.waitForTimeout(100);
  const sets = await page.evaluate(() => window.__posted.filter((m) => m.name === "a11y_settings" && m.data.action === "set"));
  check("改字級會存回 App", sets.at(-1)?.data.settings.fontLevel === "large");
  check("調字級後操作列保持展開（可以連按）", await visibleIn(page, "#panel"));
  await layer(page).locator("#read").click();
  const tts = await page.evaluate(() => window.__posted.find((m) => m.name === "tts"));
  check("朗讀交給 App 的 tts（語速 0.85）", tts && tts.data.rate === 0.85 && tts.data.text.startsWith("臨櫃預約"), tts?.data.text.slice(0, 40));
  check("朗讀內容包含主要內容外的按鈕與輸入欄", tts && tts.data.text.includes("這頁的按鈕還有：上一步、下一步") && tts.data.text.includes("輸入欄：手機號碼"), tts?.data.text.slice(-60));
  await layer(page).locator("#fab").click();
  await layer(page).locator("#read").click();
  const stop = await page.evaluate(() => window.__posted.filter((m) => m.name === "tts").at(-1));
  check("再按一次送出停止（空字串）", stop.data.text === "");
  await layer(page).locator("#fab").click();
  await layer(page).locator("#voice").click();
  await page.locator("#step2").waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check("語音走 App 的 speech_to_text，辨識結果「下一步」會執行", await page.locator("#step2").isVisible());
  await ctx.close();
}

// ---------- 驗收 7：關掉時完全不注入；注入設定時一載入就套用 ----------
{
  const off = await open(SERVICE, { settings: { enabled: false } });
  check("enabled:false → 沒有浮動列、頁面不被修改", (await layer(off.page).count()) === 0 && (await zoom(off.page)) === "1");
  await off.ctx.close();
  const on = await open(SERVICE, { settings: { fontLevel: "large" } });
  check("App 注入的設定一載入就套用", (await zoom(on.page)) === "1.25");
  await on.ctx.close();
}

// ---------- 高對比：把對比不足 7:1 的字加深 ----------
{
  const { ctx, page } = await open(SERVICE);
  const enhanced = async () =>
    (await new AxeBuilder({ page }).withRules(["color-contrast-enhanced"]).analyze()).violations.reduce((n, v) => n + v.nodes.length, 0);
  const before = await enhanced();
  await layer(page).locator("#fab").click();
  await layer(page).locator("#contrast").click();
  await page.keyboard.press("Escape");
  const fixed = await page.evaluate(() => window.__tpA11y.contrastFixed());
  const after = await enhanced();
  check("高對比：對比不足 7:1 的文字清零", after === 0, `開啟前 ${before} 處、加深 ${fixed} 個元素、開啟後 ${after} 處`);
  await layer(page).locator("#fab").click();
  await layer(page).locator("#contrast").click();
  const restored = await page.evaluate(() => getComputedStyle(document.querySelector(".muted")).color);
  check("關掉高對比會還原原本顏色", restored === "rgb(145, 160, 168)", restored);
  await ctx.close();
}

// ---------- 鍵盤與減少動態 ----------
{
  const { ctx, page } = await open(SERVICE);
  await layer(page).locator("#fab").focus();
  await page.keyboard.press("Enter");
  const first = await page.evaluate(() => document.querySelector("tp-a11y-layer").shadowRoot.activeElement?.id);
  check("鍵盤 Enter 打開操作列，焦點移到第一項", first === "read", first);
  check("操作列展開時 aria-expanded=true", (await layer(page).locator("#fab").getAttribute("aria-expanded")) === "true");
  await page.keyboard.press("Escape");
  const back = await page.evaluate(() => document.querySelector("tp-a11y-layer").shadowRoot.activeElement?.id);
  check("Esc 收起並把焦點還給浮動鈕", back === "fab" && !(await visibleIn(page, "#panel")));
  await ctx.close();
}
{
  const anim = async (reduce) => {
    const { ctx, page } = await open(SERVICE, { reduce });
    await layer(page).locator("#fab").click();
    const n = await page.evaluate(() => document.querySelector("tp-a11y-layer").shadowRoot.getAnimations().length);
    await ctx.close();
    return n;
  };
  const normal = await anim(false);
  const reduced = await anim(true);
  check("有動畫；使用者要求減少動態時關閉", normal > 0 && reduced === 0, `一般 ${normal} 個、減少動態 ${reduced} 個`);
}

check("沒有頁面錯誤", errors.length === 0, errors.join("；"));
await browser.close();
server.close();
console.log(failed ? `\n共 ${failed} 項失敗` : "\n全部通過");
process.exit(failed ? 1 : 0);
