// 組合檢查：需求 × 輸入方式 × App 環境，每一種組合都要能走完一趟（出發 → 換步（含太早確認）→ 復原 → 求助三選項 → 結束）。
// 目的：不再有「只能用某一種方式才能走出去」的死路（例如長按觸發的確認只能用講的回答）。
// 先 npm run dev（或 npx vite --port 5186），再 node scripts/combo-check.mjs [網址] [--only=關鍵字] [--jobs=4]
//
// 環境：E1 一般瀏覽器（沒有 flutterObject，朗讀 = speechSynthesis）　E1n 同上但完全沒有朗讀
//       E2 App：語音辨識＋朗讀都正常（假的）　E3 App：有朗讀，語音辨識永遠出錯（沒裝離線中文包）　E4 App：兩個 handler 都不回（舊版 App）
// 操作模式（出發面板）：look 看畫面／listen 唸給我聽／talk 唸給我聽我用講的
// 輸入方式（這個組合「只准用」的）：
//   look   = 點畫面上看得到的按鈕
//   nolook = 只長按螢幕任何地方＋聽朗讀（要開「唸給我聽」或「按不準」才有長按）；出發、開求助這類沒有長按版本的步驟，用輔助科技（按名稱點，焦點會移到標題＝讀屏會念）
//   talk   = 只用講的（假的語音辨識）；出發同上用輔助科技
// 太早確認：不開 ?demo，用 Date.now 位移讓「正常速度」那一步不被當成太早。
import { chromium } from "playwright";
import { planTrip, skipFirstRun } from "./_flow.mjs";

const args = process.argv.slice(2);
const URL = args.find((a) => /^https?:/.test(a)) ?? "http://localhost:5186/";
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const JOBS = Number(args.find((a) => a.startsWith("--jobs="))?.slice(7) ?? 4);

// ---------- 矩陣 ----------
const ENV = {
  E1: { flutter: false, tts: "browser", stt: "none", talkOffered: false },
  E1n: { flutter: false, tts: "none", stt: "none", talkOffered: false },
  E2: { flutter: true, tts: "app", stt: "ok", talkOffered: true },
  E3: { flutter: true, tts: "app", stt: "err", talkOffered: true },
  E4: { flutter: true, tts: "app", stt: "none", talkOffered: true },
};
// [env, mode, input, 需求（noTalk oneHand-left oneHand-right imprecise xlarge hc id）]
const RAW = [
  // E1 一般瀏覽器
  ["E1", "look", "look", ""],
  ["E1", "look", "look", "noTalk"],
  ["E1", "look", "look", "oneHand-left xlarge"],
  ["E1", "look", "look", "imprecise"],
  ["E1", "look", "look", "id hc"],
  ["E1", "look", "nolook", "imprecise"],
  ["E1", "listen", "nolook", ""],
  ["E1", "listen", "nolook", "noTalk"],
  ["E1", "listen", "nolook", "id"],
  ["E1", "listen", "look", "xlarge hc"],
  ["E1n", "look", "look", ""],
  ["E1n", "look", "look", "imprecise xlarge"],
  // E2 全部正常
  ["E2", "look", "look", ""],
  ["E2", "look", "look", "noTalk"],
  ["E2", "look", "look", "oneHand-right xlarge hc"],
  ["E2", "look", "look", "imprecise"],
  ["E2", "look", "look", "id"],
  ["E2", "look", "look", "id xlarge"],
  ["E2", "look", "nolook", "imprecise noTalk"],
  ["E2", "look", "talk", ""],
  ["E2", "look", "talk", "id"],
  ["E2", "listen", "nolook", ""],
  ["E2", "listen", "nolook", "noTalk"],
  ["E2", "listen", "nolook", "oneHand-left xlarge"],
  ["E2", "listen", "nolook", "imprecise"],
  ["E2", "listen", "nolook", "id"],
  ["E2", "listen", "look", "noTalk"],
  ["E2", "listen", "talk", ""],
  ["E2", "talk", "talk", ""],
  ["E2", "talk", "talk", "oneHand-left"],
  ["E2", "talk", "talk", "xlarge hc"],
  ["E2", "talk", "talk", "id"],
  ["E2", "talk", "talk", "imprecise"],
  ["E2", "talk", "nolook", ""],
  ["E2", "talk", "look", "oneHand-right"],
  // E3 語音辨識永遠出錯
  ["E3", "look", "look", ""],
  ["E3", "look", "look", "noTalk"],
  ["E3", "listen", "nolook", ""],
  ["E3", "listen", "look", "imprecise"],
  ["E3", "talk", "nolook", ""],
  ["E3", "talk", "look", "xlarge"],
  // E4 舊版 App（兩個 handler 都不回）
  ["E4", "look", "look", ""],
  ["E4", "listen", "nolook", ""],
  ["E4", "listen", "look", "noTalk id"],
  ["E4", "talk", "nolook", ""],
];
const CONFIGS = RAW.map(([env, mode, input, n], i) => {
  const s = new Set(n.split(" ").filter(Boolean));
  return {
    name: `${String(i + 1).padStart(2, "0")} ${env}/${mode}/${input}${n ? "+" + n.replace(/ /g, "+") : ""}`,
    env,
    mode,
    input,
    noTalk: s.has("noTalk"),
    oneHand: s.has("oneHand-left") || s.has("oneHand-right"),
    hand: s.has("oneHand-left") ? "left" : "right",
    imprecise: s.has("imprecise"),
    xlarge: s.has("xlarge"),
    hc: s.has("hc"),
    indo: s.has("id"),
  };
});

// 排除「不可能」的組合（寫在這裡，剪枝有依據）
for (const c of CONFIGS) {
  const e = ENV[c.env];
  if (c.input === "talk" && e.stt !== "ok") throw new Error(`${c.name}: 用講的輸入需要 STT 正常`);
  if (c.input === "nolook" && !(c.mode !== "look" || c.imprecise)) throw new Error(`${c.name}: 看畫面模式又不是按不準，沒有長按`);
  if (c.noTalk && (c.mode === "talk" || c.input === "talk")) throw new Error(`${c.name}: 不方便講話不會選用講的`);
  if (e.tts === "none" && c.mode !== "look") throw new Error(`${c.name}: 沒有朗讀不會出現「唸給我聽」`);
}

// ---------- 假環境 ----------
function initScript(a) {
  const w = window;
  w.__msgs = [];
  w.__say = [];
  w.__tts = [];
  w.__skew = 0;
  w.__sttReq = 0;
  w.__sttDone = 0;
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + w.__skew;
  try {
    if (!sessionStorage.getItem("__init")) {
      for (const [k, v] of Object.entries(a.ls)) localStorage.setItem(k, v);
      sessionStorage.setItem("__init", "1");
    }
  } catch {}
  if (a.env.flutter) {
    const ls = [];
    const reply = (d) => {
      w.__sttDone++;
      ls.slice().forEach((cb) => cb({ data: JSON.stringify({ name: "speech_to_text", data: d }) }));
    };
    w.flutterObject = {
      postMessage(m) {
        const o = JSON.parse(m);
        w.__msgs.push(o);
        if (o.name === "tts" && o.data.text) w.__tts.push(o.data.text);
        if (o.name === "speech_to_text") {
          w.__sttReq++;
          if (a.env.stt === "none") return; // 舊版 App：永遠不回
          if (a.env.stt === "err") return void setTimeout(() => reply({ error: "no offline pack" }), 200);
          // 人要講話才回；6 秒沒講就當沒聽到（真實辨識器靜音逾時）
          const t0 = realNow();
          const poll = setInterval(() => {
            if (w.__say.length) {
              clearInterval(poll);
              const text = w.__say.shift();
              setTimeout(() => reply({ text }), 300);
            } else if (realNow() - t0 > 6000) {
              clearInterval(poll);
              reply({ error: "沒有聽到聲音" });
            }
          }, 100);
        }
      },
      addEventListener: (_, cb) => ls.push(cb),
      removeEventListener: (_, cb) => ls.includes(cb) && ls.splice(ls.indexOf(cb), 1),
    };
  } else if (a.env.tts === "browser") {
    // 瀏覽器朗讀：記下文字、馬上觸發 onend
    const ss = window.speechSynthesis;
    ss.speak = (u) => {
      w.__tts.push(u.text);
      setTimeout(() => u.onend?.(), 50);
    };
  } else {
    try {
      delete Window.prototype.speechSynthesis;
    } catch {}
    try {
      Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
      delete window.speechSynthesis;
    } catch {}
  }
}

// ---------- 一次組合 ----------
const PH = {
  zh: { next: "到了", back: "上一步", help: "我需要幫忙", h1: "電梯壞了", h2: "我找不到電梯", h3: "叫站務人員來", yes: "對", no: "不要", end: "結束", endYes: "確定", repeat: "再說一次" },
  id: { next: "sudah sampai", back: "kembali", help: "tolong", h1: "lift rusak", h2: "lift tidak ketemu", h3: "panggil petugas", yes: "ya", no: "tidak", end: "selesai", endYes: "ya", repeat: "ulang" },
};

async function run(browser, c) {
  const e = ENV[c.env];
  const out = []; // {stage, ok, note, gap}
  let at = "";
  const pass = (stage, ok, note = "") => out.push({ stage, ok: !!ok, note });
  const gap = (stage, note) => out.push({ stage, ok: true, gap: true, note });
  const ph = PH[c.indo ? "id" : "zh"];
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
  await skipFirstRun(ctx);
  const needs = [...(c.noTalk ? ["noTalk"] : []), ...(c.oneHand ? ["oneHand"] : []), ...(c.imprecise ? ["imprecise"] : [])];
  const ls = {
    needs: JSON.stringify(needs),
    hand: c.hand,
    fontLevel: c.xlarge ? "xlarge" : "normal",
    highContrast: c.hc ? "1" : "0",
    lang: c.indo ? "id" : "zh",
    needsAsked: "1",
  };
  await ctx.addInitScript(initScript, { env: e, ls });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (x) => errors.push(x.message));
  const input = c.input;
  const handsFree = c.mode === "talk";
  const sheetSel = '[role=dialog][aria-label="正在聽"], [role=dialog][aria-label="Mendengarkan"], [role=dialog][aria-label="辨識中"], [role=dialog][aria-label="沒聽清楚"], [role=dialog][aria-label="聽到了"]';

  // ---- 取得資訊 ----
  const stepNo = async () => {
    const t = await p.locator("#step-now").innerText({ timeout: 1500 }).catch(() => "");
    const m = t.match(/(\d+)\D+(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const stepTotal = async () => Number(((await p.locator("#step-now").innerText()).match(/(\d+)\D+(\d+)/) ?? [])[2] ?? 0);
  const tts = () => p.evaluate(() => window.__tts.slice());
  const waitStep = (n, to = 8000) => p.waitForFunction((n) => { const t = document.querySelector("#step-now")?.textContent ?? ""; const m = t.match(/(\d+)\D+(\d+)/); return m && Number(m[1]) === n; }, n, { timeout: to }).then(() => true, () => false);
  const bar = p.getByTestId("trip-bar");
  const nextBtn = bar.locator("button.tp-btn");
  const micBtn = bar.locator("button[aria-pressed]");
  const helpBtn = bar.locator("button.tp-tool-danger");
  const pendingYes = p.getByTestId("confirm-yes");
  const pendingNo = p.getByTestId("confirm-no");
  const snackUndo = p.getByRole("button", { name: "復原" });
  const helpSheet = p.getByTestId("help-sheet");

  // ---- 版面：上方有沒有蓋住、夠不夠大 ----
  async function layout(stage, selectors, min = 48) {
    const bad = await p.evaluate(({ selectors, min }) => {
      const bads = [];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const name = (el.textContent || el.getAttribute("aria-label") || sel).trim().slice(0, 14);
          if (r.height < min - 0.5 || r.width < min - 0.5) bads.push(`${name}: ${Math.round(r.width)}x${Math.round(r.height)} < ${min}`);
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) {
            bads.push(`${name}: 在畫面外 (${Math.round(cx)},${Math.round(cy)})`);
            continue;
          }
          const top = document.elementFromPoint(cx, cy);
          if (!top || !(el.contains(top) || top.contains(el))) bads.push(`${name}: 被 <${top?.tagName.toLowerCase()} ${(top?.className?.toString?.() ?? "").slice(0, 30)}> 蓋住`);
        }
      }
      return bads;
    }, { selectors, min });
    pass(`版面：${stage}`, !bad.length, bad.join("；"));
  }
  /** 底部浮層彼此不重疊（提示列、放大提示、操作列、確認） */
  async function overlapCheck(stage) {
    const bad = await p.evaluate(() => {
      const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r : null; };
      const q = (s) => document.querySelector(s);
      const items = {
        操作列: vis(q('[data-testid="trip-bar"]')),
        提示列: vis(q('[role=status] .pointer-events-auto')),
        放大提示: vis([...document.querySelectorAll("div.tp-card")].find((d) => d.textContent?.includes("不太好按"))),
        確認: vis(q('[role=alertdialog]')),
      };
      const names = Object.keys(items).filter((k) => items[k]);
      const bads = [];
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
          const a = items[names[i]], b = items[names[j]];
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) bads.push(`${names[i]}與${names[j]}重疊 ${Math.round(oy)}px`);
        }
      return bads;
    });
    pass(`重疊：${stage}`, !bad.length, bad.join("；"));
  }

  // ---- 輸入方式 ----
  const holdPoint = () =>
    p.evaluate(() => {
      const main = document.querySelector("main");
      for (let y = 140; y < innerHeight - 20; y += 20)
        for (let x = 20; x < innerWidth - 10; x += 24) {
          const el = document.elementFromPoint(x, y);
          if (el && main?.contains(el) && !el.closest("button, a, input, summary, label, details[open] > *, [role=dialog]")) return { x, y };
        }
      return null;
    });
  async function quiet(label) {
    // 自動聽的畫面要先過去；看得到的人可以按取消，其他人只能等
    const sheet = p.locator(sheetSel).first();
    if (!(await sheet.isVisible().catch(() => false))) return;
    if (input === "look") {
      await p.getByRole("button", { name: /^(取消|Batal)$/ }).click();
      gap(`${label}：自動聽的畫面擋住，按了取消`, "");
      return;
    }
    const t0 = Date.now();
    const ok = await p.waitForFunction((s) => !document.querySelector(s), sheetSel, { timeout: 30000 }).then(() => true, () => false);
    const secs = Math.round((Date.now() - t0) / 1000);
    if (secs >= 5) gap(`${label}：自動聽的畫面擋了 ${secs} 秒（長按沒反應）`, "");
    if (!ok) pass(`${label}：自動聽的畫面一直擋住`, false);
  }
  async function longPress(label) {
    await quiet(label);
    const pt = await holdPoint();
    if (!pt) {
      pass(`${label}：找不到可長按的空白處`, false);
      throw new Error("no hold point");
    }
    await p.mouse.move(pt.x, pt.y);
    await p.mouse.down();
    await p.waitForTimeout(1150);
    await p.mouse.up();
    await p.waitForTimeout(150);
  }
  const micOpen = () => p.evaluate(() => window.__sttReq > window.__sttDone);
  async function voice(phrase, label) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await micOpen())) {
        const overlay = (await pendingYes.isVisible().catch(() => false)) || (await helpSheet.isVisible().catch(() => false));
        if (handsFree || overlay) {
          // 兩隻手都在忙，或確認／求助面板蓋住「用講的」：靠念完後自動聽
          const ok = await p.waitForFunction(() => window.__sttReq > window.__sttDone, null, { timeout: 25000 }).then(() => true, () => false);
          if (!ok) {
            pass(`麥克風沒有自動打開：${label}（${handsFree ? "兩隻手都在忙的人走不下去" : "面板蓋住按鈕又不自動聽"}）`, false);
            if (await micBtn.count()) await micBtn.click({ timeout: 5000 });
            else throw new Error("mic closed");
          }
        } else {
          await quiet(label);
          await micBtn.click();
          await p.waitForFunction(() => window.__sttReq > window.__sttDone, null, { timeout: 3000 }).catch(() => {});
        }
      }
      await p.evaluate((t) => window.__say.push(t), phrase);
      const taken = await p.waitForFunction(() => window.__say.length === 0, null, { timeout: 3500 }).then(() => true, () => false);
      if (taken) return;
      await p.evaluate(() => (window.__say.length = 0)); // 這次的麥克風剛好逾時：收回，重來
    }
    pass(`說的話沒被收到：${label}`, false);
  }
  /** 看得到的點、長按、用講的：同一個動作「到了／下一步」 */
  async function doNext(label) {
    if (input === "look") {
      await quiet(label);
      await nextBtn.click();
    } else if (input === "nolook") await longPress(label);
    else await voice(ph.next, label);
  }
  // 正常速度：把時間往前推 45%（不開 ?demo，太早確認照常運作）
  async function skew() {
    await p.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("activeTrip"));
      const tr = s.trip;
      const i = Math.min(tr.reached, tr.milestones.length - 1);
      const prev = i ? tr.milestones[i - 1].expectedAt : Date.now();
      window.__skew += Math.max(60_000, (tr.milestones[i].expectedAt - prev) * 0.45);
    });
  }

  try {
    // ===== 1. 從結果頁出發 =====
    at = "出發";
    await p.goto(URL);
    await planTrip(p, "小南門站", "市政府站");
    await p.getByRole("button", { name: /出發，一步一步帶我/ }).click();
    const sheet = p.getByTestId("mode-sheet");
    await sheet.waitFor({ timeout: 5000 });
    pass("出發面板：看畫面一定有", await sheet.getByTestId("mode-look").count() === 1);
    pass("出發面板：唸給我聽 只在有朗讀時出現", (await sheet.getByTestId("mode-listen").count()) === (e.tts === "none" ? 0 : 1));
    pass("出發面板：用講的 只在有語音辨識時出現", (await sheet.getByTestId("mode-talk").count()) === (e.talkOffered ? 1 : 0), `talk=${await sheet.getByTestId("mode-talk").count()}`);
    for (const id of ["mode-look", "mode-listen", "mode-talk"]) await sheet.getByTestId(id).scrollIntoViewIfNeeded().catch(() => {});
    await layout("出發面板的操作模式鈕", ['[data-testid="mode-look"]', '[data-testid="mode-listen"]', '[data-testid="mode-talk"]']);
    await sheet.getByTestId(`mode-${c.mode}`).click();
    await p.getByText(/第 \d+ 步，共|Langkah \d+/).first().waitFor({ timeout: 5000 });
    pass("出發：看到第 1 步", (await stepNo()) === 1);
    const total = await stepTotal();
    pass("路線至少 4 步（測試需要）", total >= 4, String(total));
    if (c.mode !== "look" && e.tts !== "none") {
      const ok = await p.waitForFunction(() => window.__tts.length > 0, null, { timeout: 3000 }).then(() => true, () => false);
      pass("出發後念出第一步", ok);
    }
    await p.waitForTimeout(300);
    await quiet("出發");
    await layout("路上底部操作列", ['[data-testid="trip-bar"] button'], 48);
    const mainBox = await nextBtn.boundingBox();
    pass(c.imprecise ? "按不準：下一步按鈕 ≥ 64px" : "下一步按鈕 ≥ 48px", mainBox && mainBox.height >= (c.imprecise ? 64 : 48), `h=${Math.round(mainBox?.height ?? 0)}`);
    pass("不方便講話：沒有「用講的」鈕", !c.noTalk || (await micBtn.count()) === 0);
    pass("用講的鈕只在有語音辨識且沒勾不方便講話時出現", (await micBtn.count()) === (e.talkOffered && !c.noTalk ? 1 : 0), `mic=${await micBtn.count()}`);

    // ===== 放大提示（按偏 3 次）不蓋住操作列 =====
    at = "放大提示";
    if (!c.xlarge && input !== "talk") {
      const lk = p.locator("main button.tp-link").last();
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p.waitForTimeout(150);
      const b = await lk.boundingBox();
      for (let i = 0; i < 3; i++) {
        await p.mouse.click(b.x + b.width / 2, b.y - 7);
        await p.waitForTimeout(80);
      }
      const prompt = p.getByText("看起來不太好按");
      if (await prompt.isVisible().catch(() => false)) {
        await overlapCheck("放大提示");
        await layout("放大提示出現時的操作列與提示按鈕", ['[data-testid="trip-bar"] button', "div.tp-card button.tp-btn, div.tp-card button.tp-btn-outline"]);
        await p.getByRole("button", { name: "不用", exact: true }).click();
        pass("放大提示：可以按「不用」關掉", !(await prompt.isVisible()));
      } else gap("放大提示沒有被觸發", "");
      await p.evaluate(() => window.scrollTo(0, 0));
    }

    // ===== 2a. 太早：先答「不」，再答「對」 =====
    at = "太早確認";
    let n0 = await stepNo();
    if (input === "look") {
      // 按鈕是刻意按的，不問「太早」（只有長按和語音會問）
      await nextBtn.click();
      pass("按鈕換步：不問太早、直接往下一步（設計：按鈕是刻意按的）", await waitStep(n0 + 1) && !(await pendingYes.isVisible()));
      gap("按鈕太早換步：沒有確認也沒有復原（看畫面的人誤按下一步回不去）", "");
    } else if (input === "nolook") {
      const t0 = (await tts()).length;
      await longPress("太早");
      const shown = await pendingYes.isVisible().catch(() => false);
      pass("太早（長按）：出現確認", shown);
      if (e.tts !== "none") pass("太早（長按）：念出「再長按一次」", (await tts()).slice(t0).some((x) => /長按|tekan lama/.test(x)), (await tts()).slice(t0).join("|"));
      await layout("太早確認：兩顆鈕", ['[role=alertdialog] button']);
      // 「不」：什麼都不做，20 秒後視同還沒到
      const gone = await p.waitForFunction(() => !document.querySelector("[role=alertdialog]"), null, { timeout: 24000 }).then(() => true, () => false);
      pass("太早（長按）→ 不回答：20 秒後確認自動收起、留在原步", gone && (await stepNo()) === n0);
      await longPress("太早2");
      pass("太早（長按）：第二次出現確認", await pendingYes.isVisible().catch(() => false));
      await longPress("太早確認");
      pass("太早（長按）→ 再長按一次：往下一步", await waitStep(n0 + 1));
      // 長按觸發的確認，也要能用畫面上的兩顆鈕回答（看得到、按得到的人）
      const n1 = await stepNo();
      await longPress("太早（再來一次）");
      await pendingYes.waitFor({ timeout: 3000 });
      await layout("長按觸發的確認：兩顆鈕", ['[role=alertdialog] button']);
      await pendingNo.click();
      pass("長按觸發的確認 → 按「還沒」：留在原步", (await stepNo()) === n1 && !(await pendingYes.isVisible()));
      await longPress("太早（再來一次2）");
      await pendingYes.waitFor({ timeout: 3000 });
      await pendingYes.click();
      pass("長按觸發的確認 → 按「對，到了」：往下一步", await waitStep(n1 + 1));
    } else {
      await voice(ph.next, "太早");
      await pendingYes.waitFor({ timeout: 10000 });
      pass("太早（語音）：出現確認，同時念出問句", (await tts()).some((x) => /說「對」|Bilang "ya"/.test(x)));
      await voice(ph.no, "太早→不");
      pass("太早（語音）→「不要」：留在原步", await p.waitForFunction(() => !document.querySelector("[role=alertdialog]"), null, { timeout: 8000 }).then(() => true, () => false) && (await stepNo()) === n0);
      await voice(ph.next, "太早（不要之後）");
      await pendingYes.waitFor({ timeout: 10000 });
      await voice(ph.yes, "太早→對");
      pass("太早（語音）→「對」：往下一步", await waitStep(n0 + 1, 10000));
    }

    // ===== 2b. 正常速度換步 =====
    at = "正常換步";
    await skew();
    n0 = await stepNo();
    const t1 = (await tts()).length;
    await doNext("正常換步");
    pass("正常速度：直接換步（不問）", await waitStep(n0 + 1, 10000));
    if (input !== "look" && e.tts !== "none") {
      await p.waitForTimeout(300);
      pass("非按鈕換步：念出新的一步", (await tts()).length > t1);
    }

    // ===== 3. 復原 =====
    at = "復原";
    if (input === "look") {
      gap("復原：按按鈕換步沒有復原（設計如此；看畫面的人按錯了回不去）", "");
      pass("按鈕換步後沒有擋住底部的提示", true);
    } else if (input === "nolook" && handsFree && (await p.locator(sheetSel).first().isVisible().catch(() => false))) {
      // 用講的模式：換步後念完就自動聽，全幅「正在聽」會蓋住「復原」鈕（設計：這時要講「上一步」）
      if (e.stt === "ok") {
        gap("復原：提示列被「正在聽」蓋住，講「上一步」才能復原", "");
        await voice(ph.back, "復原（被蓋住，改用講的）");
        pass("復原（說「上一步」）：回上一步", await waitStep(n0, 10000));
      } else gap("復原：提示列被「正在聽」蓋住，而語音辨識沒回應（舊版 App）→ 這一步換錯了回不去", "");
    } else if (input === "nolook") {
      pass("換步後有「復原」鈕", await snackUndo.isVisible().catch(() => false));
      await layout("提示列（復原）", ["[role=status] .pointer-events-auto button"]);
      await overlapCheck("提示列與操作列");
      if (!c.xlarge) {
        // 提示列＋放大提示同時出現
        const lk = p.locator("main button.tp-link").last();
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await p.waitForTimeout(150);
        const b = await lk.boundingBox();
        for (let i = 0; i < 3; i++) {
          await p.mouse.click(b.x + b.width / 2, b.y - 7);
          await p.waitForTimeout(60);
        }
        if (await p.getByText("看起來不太好按").isVisible().catch(() => false)) {
          await overlapCheck("提示列＋放大提示同時出現");
          await layout("提示列＋放大提示：按鈕不被蓋住", ["[role=status] .pointer-events-auto button", "div.tp-card button.tp-btn, div.tp-card button.tp-btn-outline"]);
          await p.getByRole("button", { name: "不用", exact: true }).click().catch(() => {});
        }
      }
      if (await snackUndo.isVisible().catch(() => false)) {
        await snackUndo.click();
        pass("復原（點復原）：回上一步", await waitStep(n0));
      } else pass("復原：5 秒內來得及按", false);
    } else {
      await voice(ph.back, "復原");
      pass("復原（說「上一步」）：回上一步", await waitStep(n0, 10000));
    }

    // ===== 4. 求助三選項 =====
    at = "求助";
    const openHelpAT = async (stage) => {
      await quiet(stage);
      await helpBtn.click();
      await helpSheet.waitFor({ timeout: 3000 });
      if (input !== "look") {
        await p.waitForTimeout(150);
        pass(`${stage}：焦點移到求助標題（讀屏會念）`, await p.evaluate(() => document.activeElement?.id === "help-title"));
      }
    };
    const closeSheet = async (stage) => {
      await helpSheet.getByRole("button", { name: /^(關閉|Tutup)$/ }).click();
      pass(`${stage}：可以關閉求助面板`, !(await helpSheet.isVisible()));
    };
    const closeCard = async (stage) => {
      const card = p.locator('[aria-labelledby="help-card"]');
      await layout(`${stage}：求助卡的按鈕`, ['[aria-labelledby="help-card"] button, [aria-labelledby="help-card"] a']);
      await card.getByRole("button", { name: /^(關閉|Tutup)$/ }).click();
      pass(`${stage}：可以關閉求助卡`, !(await card.isVisible()));
    };
    const outcome1 = async (stage) => {
      // 換一條路：換好（有橫幅）或再問哪個出口或沒有替代路線，三種都要有下一步可走
      await p.waitForTimeout(400);
      if (await p.getByTestId("rerouted").isVisible().catch(() => false)) {
        pass(`${stage}：換好路線並說明改了什麼`, true);
        await layout(`${stage}：換路線後的提示與操作列`, ["[role=status] .pointer-events-auto button", '[data-testid="trip-bar"] button']);
        await overlapCheck(`${stage}：換路線後`);
        return "rerouted";
      }
      if (await p.getByTestId("help-all-broken").isVisible().catch(() => false)) {
        pass(`${stage}：問是哪個出口壞了（有「全部都壞」）`, true);
        await layout(`${stage}：出口選項`, ['[data-testid="help-sheet"] button']);
        return "exits";
      }
      pass(`${stage}：沒有替代路線時有出路（站務／客服）`, await helpSheet.getByRole("button", { name: /站務|petugas/i }).isVisible().catch(() => false));
      return "none";
    };
    if (input !== "talk") {
      await openHelpAT("求助");
      await layout("求助面板三選項", ['[data-testid="help-sheet"] button']);
      for (const id of ["help-broken", "help-find", "help-staff"]) pass(`求助選項 ${id} 存在`, await p.getByTestId(id).isVisible());
      // 2 找不到電梯
      const t2 = (await tts()).length;
      await p.getByTestId("help-find").click();
      await p.getByTestId("elevator-where").waitFor({ timeout: 3000 });
      pass("找不到電梯：寫出電梯在哪", true);
      if (input !== "look" && e.tts !== "none") pass("找不到電梯：同時念出來", (await tts()).length > t2);
      await layout("找不到電梯畫面", ['[data-testid="help-sheet"] button']);
      await closeSheet("找不到電梯");
      // 3 站務
      await openHelpAT("求助2");
      await p.getByTestId("help-staff").click();
      await p.getByText("請協助我，我需要搭電梯").waitFor({ timeout: 3000 });
      pass("請站務人員：求助卡出現", true);
      await closeCard("請站務人員");
      // 1 換一條路
      await openHelpAT("求助3");
      await p.getByTestId("help-broken").click();
      const o = await outcome1("換一條路");
      if (o === "rerouted") {
        if (await snackUndo.isVisible().catch(() => false)) await snackUndo.click();
      } else await closeSheet("換一條路");
    } else {
      await voice(ph.help, "求助");
      await helpSheet.waitFor({ timeout: 10000 });
      pass("求助（語音）：面板出現並問「發生什麼事」", (await tts()).some((x) => /發生什麼事|Apa yang terjadi/.test(x)));
      await voice(ph.h2, "求助2（找不到電梯）");
      await p.getByTestId("elevator-where").waitFor({ timeout: 10000 });
      pass("求助（語音）「找不到電梯」：寫出電梯在哪", true);
      await voice(ph.repeat, "關掉電梯在哪");
      pass("求助（語音）：說話就能回到這一步（面板收起）", await p.waitForFunction(() => !document.querySelector('[data-testid="help-sheet"]'), null, { timeout: 8000 }).then(() => true, () => false));
      await voice(ph.help, "求助3");
      await helpSheet.waitFor({ timeout: 10000 });
      await voice(ph.h3, "求助3（站務）");
      pass("求助（語音）「叫站務人員」：求助卡出現", await p.getByText("請協助我，我需要搭電梯").waitFor({ timeout: 8000 }).then(() => true, () => false));
      await voice(ph.repeat, "關掉求助卡");
      pass("求助（語音）：說話就能收起求助卡", await p.waitForFunction(() => !document.querySelector('[aria-labelledby="help-card"]'), null, { timeout: 8000 }).then(() => true, () => false));
      // 若求助卡沒收起，補按關閉才能繼續
      if (await p.locator('[aria-labelledby="help-card"]').isVisible().catch(() => false)) await p.locator('[aria-labelledby="help-card"]').getByRole("button", { name: /^(關閉|Tutup)$/ }).click();
      if (await helpSheet.isVisible().catch(() => false)) await helpSheet.getByRole("button", { name: /^(關閉|Tutup)$/ }).click();
      await voice(ph.help, "求助4");
      await helpSheet.waitFor({ timeout: 10000 });
      await voice(ph.h1, "求助4（換一條路）");
      const o = await outcome1("換一條路（語音）");
      if (o !== "rerouted") {
        await voice(ph.repeat, "關掉面板");
        pass("求助（語音）：說話就能收起面板", await p.waitForFunction(() => !document.querySelector('[data-testid="help-sheet"]'), null, { timeout: 8000 }).then(() => true, () => false));
        if (await helpSheet.isVisible().catch(() => false)) await helpSheet.getByRole("button", { name: /^(關閉|Tutup)$/ }).click();
      }
    }

    // ===== 5. 結束這趟 =====
    at = "結束";
    if (input === "talk") {
      await voice(ph.end, "結束");
      await pendingYes.waitFor({ timeout: 10000 });
      pass("結束（語音）：先確認，並念出問句", (await tts()).some((x) => /要結束這趟嗎|Selesai perjalanan/.test(x)));
      await layout("結束確認：兩顆鈕", ['[role=alertdialog] button']);
      await voice(ph.no, "結束→不要");
      pass("結束（語音）→「不要」：繼續這趟", await p.waitForFunction(() => !document.querySelector("[role=alertdialog]"), null, { timeout: 8000 }).then(() => true, () => false) && (await stepNo()) !== null);
      await voice(ph.end, "結束2");
      await pendingYes.waitFor({ timeout: 10000 });
      await voice(ph.endYes, "結束→確定");
    } else {
      await quiet("結束");
      const lk = p.locator("main button.tp-link").last();
      await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // 捲到最底（真人會捲到底找）
      await p.waitForTimeout(200);
      await layout("結束這趟的連結（捲到底）", ["main button.tp-link"]);
      await lk.click();
    }
    pass("結束：行程結束、顯示已結束", await p.getByText("這趟已結束").first().waitFor({ timeout: 10000 }).then(() => true, () => false));
    pass("結束後有「回首頁」", await p.getByRole("button", { name: "回首頁" }).isVisible());
    if (c.noTalk) {
      pass("不方便講話：整趟從頭到尾沒開過麥克風", (await p.evaluate(() => window.__msgs.filter((m) => m.name === "speech_to_text").length)) === 0);
    }
  } catch (err) {
    if (process.env.SHOT) await p.screenshot({ path: `${process.env.SHOT}/${c.name.replace(/[^\w+-]/g, "_")}.png` }).catch(() => {});
    if (process.env.SHOT) console.log(c.name, JSON.stringify(await p.evaluate(() => ({ tts: window.__tts.slice(-6), req: window.__sttReq, done: window.__sttDone, say: window.__say, body: document.body.innerText.slice(0, 200) })).catch(() => ({}))));
    pass(`流程中斷（${at}）：${String(err.message).split("\n")[0].slice(0, 160)}`, false);
  }
  if (errors.length) pass("沒有頁面錯誤", false, errors.join(";"));
  await ctx.close();
  return out;
}

// ---------- 執行 ----------
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const list = CONFIGS.filter((c) => !only || c.name.includes(only));
const results = new Array(list.length);
let next = 0;
const t0 = Date.now();
await Promise.all(
  Array.from({ length: JOBS }, async () => {
    while (next < list.length) {
      const i = next++;
      const c = list[i];
      const t = Date.now();
      results[i] = await run(browser, c).catch((e) => [{ stage: `例外 ${e.message}`, ok: false, note: "" }]);
      const bad = results[i].filter((r) => !r.ok).length;
      console.log(`${bad ? "✗" : "✓"} ${c.name}  (${results[i].length} 項, ${Math.round((Date.now() - t) / 1000)}s)${bad ? `  失敗 ${bad}` : ""}`);
    }
  }),
);
await browser.close();
let failed = 0;
let gaps = 0;
for (let i = 0; i < list.length; i++) {
  const bad = results[i].filter((r) => !r.ok);
  const g = results[i].filter((r) => r.gap);
  gaps += g.length;
  if (bad.length || g.length) console.log(`\n${list[i].name}`);
  for (const r of bad) console.log(`  ✗ ${r.stage}${r.note ? "  → " + r.note : ""}`);
  for (const r of g) console.log(`  ・${r.stage}`);
  failed += bad.length;
}
const total = results.reduce((s, r) => s + r.length, 0);
console.log(`\n${list.length} 組合、${total} 項斷言、${Math.round((Date.now() - t0) / 1000)} 秒；${gaps} 項註記`);
console.log(failed ? `${failed} 項失敗` : "全部通過");
process.exit(failed ? 1 : 0);
