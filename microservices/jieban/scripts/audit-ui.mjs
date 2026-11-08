// 原則稽核 P1 P2 P3 P4 P5：按鍵數、念出來的句子、語音回饋時間軸、設定位置。先 npm run dev，再 node scripts/audit-ui.mjs
import { chromium } from "playwright";
import { skipFirstRun } from "./_flow.mjs";

const URL = process.argv[2] ?? "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-TW" });
await skipFirstRun(ctx);
// 假的城市通：收 tts / speech_to_text，1.5 秒後回辨識結果
await ctx.addInitScript(() => {
  const w = window;
  w.__msgs = [];
  w.__say = "下一步";
  const ls = [];
  w.flutterObject = {
    postMessage(m) {
      const o = JSON.parse(m);
      w.__msgs.push({ t: performance.now(), ...o });
      if (o.name === "speech_to_text")
        setTimeout(() => ls.forEach((cb) => cb({ data: JSON.stringify({ name: "speech_to_text", data: { text: w.__say } }) })), 1500);
    },
    addEventListener: (_, cb) => ls.push(cb),
    removeEventListener: (_, cb) => ls.splice(ls.indexOf(cb), 1),
  };
});
const page = await ctx.newPage();
let taps = 0;
const tap = async (loc) => {
  taps++;
  await loc.click();
};
const tts = async () => (await page.evaluate(() => window.__msgs.filter((m) => m.name === "tts").map((m) => m.data.text)));

await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.goto(URL);
await page.getByRole("button", { name: "查路線" }).waitFor();
await page.waitForFunction(() => !document.querySelector("button[disabled]")?.textContent?.includes("載入"));

// 1. 第一次用：從首頁到路上第一步
taps = 0;
let typed = 0;
await tap(page.getByRole("button", { name: /從哪一站出發/ }));
await page.getByLabel("打站名或地點找").fill("小南門");
typed += 3;
await tap(page.getByRole("button", { name: "小南門站", exact: true }));
await tap(page.getByRole("button", { name: /要到哪一站/ }));
await page.getByLabel("打站名或地點找").fill("市政府");
typed += 3;
await tap(page.getByRole("button", { name: "市政府站", exact: true }));
await tap(page.getByRole("button", { name: "查路線" }));
await tap(page.getByRole("button", { name: /出發，一步一步帶我/ }));
await page.getByText(/第 \d+ 步，共/).first().waitFor();
const firstTaps = taps;
const stepsTotal = Number((await page.getByText(/第 \d+ 步，共 \d+ 步/).first().innerText()).match(/共 (\d+)/)[1]);
console.log(`[步驟] 第一次用：首頁到路上第一步 ${firstTaps} 次點按＋打 ${typed} 個字；路上還要再按 ${stepsTotal} 次（小南門→市政府，${stepsTotal} 步）`);

// 2. 念出來的句子
await tap(page.getByRole("button", { name: "唸給我聽" }));
const spoken = (await tts()).at(-1);
console.log(`[聽得懂] 路上第 1 步念出來：「${spoken}」`);
console.log(`         ${spoken.length} 字，符號 ${(spoken.match(/[（）→、；：]/g) ?? []).length} 個`);

// 3. 用講的：回饋時間軸
const before = await page.getByText(/第 \d+ 步，共/).first().innerText();
await page.getByRole("button", { name: "用講的" }).click();
const t0 = Date.now();
const snaps = [];
for (const ms of [100, 1000, 2200, 3500]) {
  await page.waitForTimeout(ms - (Date.now() - t0));
  const sheet = await page.locator("[role=status]").allInnerTexts();
  const step = await page.getByText(/第 \d+ 步，共/).first().innerText();
  snaps.push(`${ms}ms：${step}｜${sheet.join(" ").replace(/\s+/g, " ").slice(0, 50)}｜正在聽畫面 ${(await page.getByText("正在聽").count()) ? "有" : "無"}`);
}
const after = await page.getByText(/第 \d+ 步，共/).first().innerText();
const ttsAfter = (await tts()).length;
console.log(`[回饋] 說「下一步」：${before} → ${after}`);
for (const s of snaps) console.log("        " + s);
console.log(`        換步後有沒有念出或複述「聽到下一步」：${ttsAfter > 1 ? "有" : "沒有"}`);

// 4. 設定入口位置
const sb = await page.getByRole("button", { name: "字級・操作" }).boundingBox();
console.log(`[原地調整] 「字級・操作」在 (${Math.round(sb.x)}, ${Math.round(sb.y)})，螢幕 390×844；右手拇指舒適區約為下半部`);
taps = 0;
await tap(page.getByRole("button", { name: "字級・操作" }));
await tap(page.getByTestId("need-oneHand"));
await tap(page.getByRole("button", { name: "完成" }));
console.log(`[原地調整] 打開單手模式：${taps} 次點按，要先找到右上角`);

// 5. 回訪：常走路線到出發
await page.getByRole("button", { name: "結束這趟" }).click();
await page.goto(URL + "#/");
await page.getByRole("button", { name: "查路線" }).waitFor();
taps = 0;
await tap(page.getByRole("button", { name: "今天出發" }).first());
console.log(`[步驟] 回訪：常走路線到路上第一步 ${taps} 次點按`);
await page.getByText(/第 \d+ 步，共/).first().waitFor();
const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
await page.evaluate(() => localStorage.setItem("needs", JSON.stringify(["noLook", "handsBusy"])));
await page.reload();
await page.getByText(/第 \d+ 步，共/).first().waitFor();
console.log(`[不看螢幕] 開「不方便看螢幕」後有長按任何地方換步：${(await page.getByTestId("hold-hint").count()) ? "有" : "沒有"}；頁高 ${scrollH}px`);
const s0 = await page.evaluate(() => window.__msgs.filter((m) => m.name === "speech_to_text").length);
await page.getByRole("button", { name: /下一步/ }).last().click();
await page.waitForTimeout(16000);
const s1 = await page.evaluate(() => window.__msgs.filter((m) => m.name === "speech_to_text").length);
console.log(`[不用手] 開「兩隻手都在忙」後念完自動聽：${s1 > s0 ? "有" : "沒有"}`);
await browser.close();
