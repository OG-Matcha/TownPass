// 行為檢查（收斂版：首頁＝常走路線＋起訖 → 選站 → 結果 → 路上一步一步）。先 npm run dev，再 node scripts/behavior-check.mjs [網址]
import { chromium } from "playwright";
import { skipFirstRun, RESULT_RE, planTrip } from "./_flow.mjs";

const URL = process.argv[2] ?? "http://localhost:5173/";
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
await skipFirstRun(context);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
const check = (name, ok) => results.push([name, ok]);
const prompt = () => page.getByText("看起來不太好按");
const planBtn = () => page.getByRole("button", { name: "查路線" });
const goBtn = () => page.getByRole("button", { name: /去一個地方/ });
const homeReady = async () => {
  await goBtn().waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("查看中"));
};
const reset = async (qs = "") => {
  await page.goto(URL + qs);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(URL + qs);
  await homeReady();
};
// 進「去一個地方」；已經在就不動
const toGo = async () => {
  if (!(await page.evaluate(() => location.hash.startsWith("#/go")))) {
    if (!(await goBtn().count())) await page.evaluate(() => (location.hash = "#/"));
    await goBtn().click();
  }
  await planBtn().waitFor();
  await page.waitForFunction(() => !document.querySelector("button[disabled]")?.textContent?.includes("載入"));
};
// 出發站：去選站畫面選，選完回到「去一個地方」
const pickOrigin = async (station) => {
  await toGo();
  await page.getByRole("button", { name: /出發|選車站/ }).first().click();
  await page.getByLabel("打站名或地點找").fill(station.replace(/站$/, ""));
  await page.getByRole("button", { name: station, exact: true }).click();
  await planBtn().waitFor();
};
// 目的地車站：用深連結帶入（#/go?to=…&date=…），等同在搜尋結果點了這一站
const pickDest = async (station, date) => {
  const q = new URLSearchParams({ to: station, ...(date ? { date } : {}) });
  await page.evaluate((h) => (location.hash = h), `#/go?${q}`);
  await page.reload();
  await planBtn().waitFor();
  await page.waitForFunction(() => !document.querySelector("button[disabled]")?.textContent?.includes("載入"));
};
const originLine = () => page.getByRole("button", { name: /出發|選車站/ }).first().innerText();

// 1. 按偏 3 次 → 問要不要放大；同意 → 字變大、提示消失
await reset();
const b = await goBtn().boundingBox();
for (let i = 0; i < 3; i++) await page.mouse.click(b.x + b.width / 2, b.y + b.height + 8);
await page.waitForTimeout(300);
check("按偏 3 次會詢問", await prompt().isVisible());
check("詢問放在 role=status", await prompt().evaluate((el) => !!el.closest("[role=status]")));
await page.getByRole("button", { name: "放大", exact: true }).click();
check("同意後字級變大", (await page.evaluate(() => document.documentElement.style.fontSize)) === "20px");
check("同意後提示消失", (await prompt().count()) === 0);

// 2. 首頁：兩顆分流按鈕、第一次沒有自動詢問；去一個地方什麼都沒填就查 → 具體提示
await reset();
check("首頁有兩顆分流按鈕", (await goBtn().isVisible()) && (await page.getByRole("button", { name: /走常走的路/ }).isVisible()));
check("首頁沒有自動詢問「你現在哪裡不方便？」", (await page.getByRole("heading", { name: "你現在哪裡不方便？" }).count()) === 0);
await toGo();
check("第一次打開不預填別人的站", (await originLine()).includes("還沒選出發"));
await planBtn().click();
check("什麼都沒填：請先輸入或選地點", await page.getByText("請先輸入或選一個地點").isVisible());

// 3. 選站：搜尋、依路線、最近用過；選完回到「去一個地方」並記住
await pickOrigin("小南門站");
check("搜尋選站後回到「去一個地方」", (await originLine()).includes("小南門"));
await page.getByRole("button", { name: /出發/ }).first().click();
await page.getByText("淡水信義線").click();
await page.getByRole("button", { name: "台大醫院", exact: true }).click();
await planBtn().waitFor();
check("依路線選站", (await originLine()).includes("台大醫院"));
await page.getByRole("button", { name: /出發/ }).first().click();
check("最近用過會出現", await page.getByRole("button", { name: "台大醫院站" }).isVisible());
await page.getByRole("button", { name: "返回" }).click();
await planBtn().waitFor();

// 4. 結果：獨立畫面、焦點在標題、返回鍵回「去一個地方」
await pickOrigin("小南門站");
await pickDest("台大醫院站");
await planBtn().click();
await page.getByText(RESULT_RE).waitFor();
check("結果是新畫面（#/result）", (await page.evaluate(() => location.hash)) === "#/result");
check("焦點在結果標題", (await page.evaluate(() => document.activeElement?.tagName)) === "H1");
await page.getByRole("button", { name: "每一站怎麼走" }).click(); // 預設收起
check("開門側只顯示這個方向", (await page.locator("p", { hasText: "到中正紀念堂開門" }).innerText()).includes("左側開門") && !(await page.getByText(/往松山-/).count()));
check("寫出往哪個方向", await page.getByText(/往新店，坐/).isVisible());
let inside = false;
for (let i = 0; i < 20 && !inside; i++) {
  inside = await page.evaluate(() => {
    const c = document.querySelector(".maplibregl-map")?.getBoundingClientRect();
    const ms = [...document.querySelectorAll(".maplibregl-marker")].map((m) => m.getBoundingClientRect());
    return !!c && ms.length > 0 && ms.every((r) => r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom);
  });
  if (!inside) await page.waitForTimeout(500);
}
check("地圖包含起點與終點", inside);
await page.goBack();
await planBtn().waitFor();
check("返回鍵回到「去一個地方」", (await page.evaluate(() => location.hash)).startsWith("#/go"));
// 改了出發站但沒重查：結果畫面還是原本那趟（快照）
await pickOrigin("動物園站");
await page.evaluate(() => (location.hash = "#/result"));
await page.getByText(RESULT_RE).waitFor();
check("改出發站不會讓舊結果自相矛盾", (await page.locator("h1").innerText()).startsWith("小南門"));

// 5. 路上需要「少轉乘」「少走路」：選了會從方案裡挑（結果頁寫出是哪一個方案）
await reset();
await pickOrigin("小南門站");
await pickDest("台大醫院站");
await page.getByRole("checkbox", { name: "少轉乘" }).click();
await planBtn().click();
await page.getByText(RESULT_RE).waitFor();
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("routeNeeds") ?? "{}"));
check("「少轉乘」記在這支手機", stored.lessTransfer === true && stored.elevator === true);

// 6. 去一個地方用講的：fake 城市通辨識 → 辨識文字進輸入框並搜尋
{
  const c = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
  await skipFirstRun(c);
  await c.addInitScript(() => {
    const ls = [];
    window.flutterObject = {
      postMessage(m) {
        if (JSON.parse(m).name === "speech_to_text") setTimeout(() => ls.forEach((cb) => cb({ data: JSON.stringify({ name: "speech_to_text", data: { text: "美術館" } }) })), 300);
      },
      addEventListener: (_, cb) => ls.push(cb),
      removeEventListener: (_, cb) => ls.includes(cb) && ls.splice(ls.indexOf(cb), 1),
    };
  });
  const p = await c.newPage();
  await p.goto(URL);
  await p.getByRole("button", { name: /去一個地方/ }).click();
  await p.getByRole("button", { name: "用講的" }).click();
  check("按下麥克風：全幅「正在聽」", await p.getByText("正在聽").isVisible());
  await p.getByText(/聽到：美術館/).waitFor({ timeout: 5000 });
  await p.waitForFunction(() => document.querySelector("input[type=search]")?.value === "美術館", null, { timeout: 5000 });
  check("辨識文字進輸入框", true);
  await p.locator("section[aria-label='找到的地點'] li button").first().waitFor({ timeout: 15000 });
  check("辨識後直接搜尋並列出地點", (await p.locator("section[aria-label='找到的地點'] li button").count()) >= 1);
  await c.close();
}

// 7. 路上：出發面板（怎麼帶路＋選用分享）、下一步卡片、詢問、需要幫忙、滑動確認、結束可復原
await reset("?demo=1");
await pickOrigin("小南門站");
await pickDest("台北車站");
await planBtn().click();
await page.getByText(RESULT_RE).waitFor();
await page.getByRole("button", { name: "每一站怎麼走" }).click();
check("轉乘不套用進出站動線", (await page.locator("li", { hasText: "換搭" }).first().innerText()).includes("沿無障礙指標"));
// 出站動線改成示意圖：方向寫在讀屏／朗讀那句（role=img 的 aria-label），要從月臺出發
const exitImg = page.locator("ol > li", { hasText: "出站" }).last().locator('[role="img"]');
const exitLabel = (await exitImg.count()) ? await exitImg.first().getAttribute("aria-label") : "";
check("出站動線方向從月台寫起", !exitLabel || /^示意圖：[^。]*出站動線。從月臺出發/.test(exitLabel));
await page.getByRole("button", { name: "出發，一步一步帶我" }).click();
const modeSheet = page.getByTestId("mode-sheet");
await modeSheet.waitFor();
check("出發：先問路上怎麼知道下一步", await page.getByRole("heading", { name: "路上你想怎麼知道下一步？" }).isVisible());
check("出發面板：看畫面、唸給我聽兩個選擇", (await modeSheet.getByTestId("mode-look").isVisible()) && (await modeSheet.getByTestId("mode-listen").isVisible()));
check("出發面板：沒有語音辨識就不給「我用講的」", !(await modeSheet.getByTestId("mode-talk").count()));
check("出發面板：分享是選用的一列，沒按不產生家人連結", (await modeSheet.getByTestId("share-row").isVisible()) && !(await page.getByTestId("family-link").count()));
await modeSheet.getByTestId("share-row").locator("summary").click();
await modeSheet.getByLabel("家人看到的稱呼").fill("阿嬤");
await modeSheet.getByRole("button", { name: "複製連結" }).click();
const link = await modeSheet.getByTestId("family-link").innerText();
await modeSheet.getByTestId("mode-look").click();
await page.getByText("第 1 步，共").first().waitFor();
check("選「看畫面就好」：不開自動唸與長按", !(await page.evaluate(() => localStorage.getItem("needs") ?? "")).match(/noLook|handsBusy/) && !(await page.getByTestId("hold-hint").count()));
check("出發後直接看到第一步", (await page.locator("main").innerText()).includes("進站"));
// 卡片只在有排定保養時才寫電梯狀況（一步只講一件事）；小南門今天沒有 → 不顯示
check("沒有保養時卡片不多寫電梯狀況", !(await page.getByText(/今天沒有排定電梯保養/).count()));
check("搭車這一步寫出約幾分鐘後到", /約 \d+ 分鐘後到/.test(await page.getByTestId("eta").innerText()));
check("不預告下一步", !(await page.locator("main").innerText()).includes("在西門站換搭"));
const pathBox = page.getByTestId("path");
check("電梯怎麼走：預設收合", (await pathBox.count()) === 0 || (await pathBox.getAttribute("open")) === null);
if (await pathBox.count()) {
  await pathBox.locator("summary").click();
  check("電梯怎麼走：點了才展開", (await pathBox.getAttribute("open")) !== null && ((await pathBox.innerText()).includes("→") || (await pathBox.getByTestId("elevator-path").count()) > 0));
}
check("底部大按鈕：我到了，下一步", await page.getByRole("button", { name: /我到西門了，下一步/ }).isVisible());
check("分享中只留一行狀態＋停止分享", (await page.getByTestId("share-status").isVisible()) && (await page.getByRole("button", { name: "停止分享" }).isVisible()));
const fam = await page.context().newPage();
await fam.goto(link);
await fam.getByText("阿嬤：小南門站 → 台北車站").waitFor();
const famText = async () => {
  await fam.waitForTimeout(400);
  return fam.locator("section[role=status] p.text-h3").innerText();
};
check("家人頁顯示出發", (await famText()).includes("從小南門站出發"));
await page.getByRole("button", { name: /我到西門了，下一步/ }).click();
await page.getByText("第 2 步，共").first().waitFor();
check("第二步是轉乘", (await page.locator("main").innerText()).includes("在西門站換搭"));
const asking = page.getByText("比預計時間晚了，還好嗎？");
for (let i = 0; i < 10 && !(await asking.isVisible()); i++) await page.getByRole("button", { name: /示範用/ }).click();
check("超時：全螢幕問本人", await page.getByRole("alertdialog").isVisible());
await page.waitForTimeout(300);
check("詢問時焦點在問題上", (await page.evaluate(() => document.activeElement?.textContent)).includes("還好嗎"));
check("家人頁顯示正在詢問", (await famText()).includes("正在詢問阿嬤"));
await page.getByRole("alertdialog").getByRole("button", { name: "需要幫忙" }).click();
const helpSheet = page.getByTestId("help-sheet");
check("需要幫忙：先問發生什麼事", await page.getByRole("heading", { name: "發生什麼事？" }).isVisible());
check("需要幫忙：三個選項", (await helpSheet.getByTestId("help-broken").isVisible()) && (await helpSheet.getByTestId("help-find").isVisible()) && (await helpSheet.getByTestId("help-staff").isVisible()));
await helpSheet.getByTestId("help-find").click();
check("找不到電梯：寫出這站電梯在哪", await page.getByRole("heading", { name: "西門站的電梯在哪裡" }).isVisible());
check("找不到電梯：不會自動通知家人", !(await famText()).includes("需要幫忙"));
check("求助面板有「向 1999 反映設施故障」", await helpSheet.getByTestId("report-1999").isVisible());
await helpSheet.getByRole("button", { name: "請站務人員來幫我" }).click();
const cardText = await page.getByRole("dialog").innerText();
check("求助卡寫出現在的站與要做什麼", /我現在在\s*西門站/.test(cardText) && cardText.includes("換搭"));
check("求助卡下方可以打給北捷客服", await page.getByRole("dialog").getByRole("button", { name: /打給北捷客服/ }).isVisible());
await page.getByRole("button", { name: "關閉", exact: true }).click();

await page.getByTestId("trip-bar").getByRole("button", { name: "需要幫忙" }).click();
await page.getByTestId("help-staff").click();
await page.getByRole("button", { name: "讓家人知道我需要幫忙" }).click();
const thumb = page.getByRole("button", { name: "確認通知家人" });
await thumb.click();
check("滑動確認：點一下不送出", !(await famText()).includes("需要幫忙"));
check("滑動確認：點一下後提供按鈕替代", await page.getByRole("button", { name: /改用按鈕確認/ }).isVisible());
const tb = await thumb.boundingBox();
const track = await thumb.locator("..").boundingBox();
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.mouse.down();
await page.mouse.move(tb.x + track.width * 0.5, tb.y + tb.height / 2, { steps: 5 });
await page.mouse.up();
check("滑動確認：滑一半不送出", !(await famText()).includes("需要幫忙"));
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await page.mouse.down();
await page.mouse.move(track.x + track.width + 20, tb.y + tb.height / 2, { steps: 8 });
await page.mouse.up();
check("滑動確認：滑到底才通知家人", (await famText()).includes("需要幫忙"));
await page.getByRole("button", { name: "問題解決了" }).click();

// 生命週期：返回結果頁再按「回到路上的下一步」＝同一趟、同一步，不會多一趟
const tripKey = () => page.evaluate(() => { const t = JSON.parse(localStorage.getItem("activeTrip")).trip; return `${t.id}:${t.reached}`; });
const keyBefore = await tripKey();
await page.goBack();
await page.getByRole("button", { name: "回到路上的下一步" }).click();
await page.getByText("第 2 步，共").first().waitFor();
check("返回後再出發：還是同一趟、同一步", (await tripKey()) === keyBefore);
// 按鈕換步也給「復原」；「看畫面就好」也能長按換步（並能復原）
await page.getByRole("button", { name: /下一步$/ }).click();
check("按鈕換步也有復原提示", await page.getByRole("button", { name: "復原" }).waitFor({ timeout: 3000 }).then(() => true, () => false));
await page.getByRole("button", { name: "復原" }).click();
await page.getByText("第 2 步，共").first().waitFor();
const holdBox = await page.getByRole("heading", { name: /第 2 步，共/ }).boundingBox();
await page.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2);
await page.mouse.down();
await page.waitForTimeout(1300);
await page.mouse.up();
await page.getByText("第 3 步，共").first().waitFor({ timeout: 3000 }).catch(() => {});
check("看畫面就好：長按一秒也能換下一步", await page.getByText("第 3 步，共").first().isVisible());
await page.getByRole("button", { name: "復原" }).click();
await page.getByText("第 2 步，共").first().waitFor();

// 回首頁：首頁不放「繼續上次」；行程仍存著，重新整理後從 #/trip 回得去
await page.evaluate(() => (location.hash = "#/"));
await homeReady();
check("首頁沒有「回到下一步」", (await page.getByRole("button", { name: "回到下一步" }).count()) === 0);
await page.evaluate(() => (location.hash = "#/trip"));
await page.reload();
check("重新整理後行程還在", await page.getByText(/第 \d+ 步，共/).first().isVisible());
check("重新整理後步驟卡還在", await page.getByText("第 2 步，共").first().isVisible());

await page.getByRole("button", { name: "結束這趟" }).click();
const undoOk = await page.getByRole("button", { name: "復原" }).waitFor({ timeout: 3000 }).then(() => true, async () => (await page.screenshot({ path: "end-fail.tmp.png" }), false));
check("結束有提示與復原", undoOk);
await page.getByRole("button", { name: "復原" }).click();
await page.waitForTimeout(300);
check("復原後繼續", await page.getByRole("button", { name: "結束這趟" }).isVisible());
for (let i = 0; i < 8; i++) {
  const btn = page.getByRole("button", { name: /下一步$|^我出站了$/ });
  if (!(await btn.count())) break;
  await btn.click();
}
check("旅客端到達", await page.getByText(/已到達台北車站/).isVisible());
check("家人頁顯示到達", (await famText()).includes("已經到台北車站出站"));
await fam.close();

// 7b. 走常走的路一鍵看今天；去一個地方打地點名；有問題才給替代；其他日子不開始行程
await page.getByRole("button", { name: "回首頁" }).click();
await homeReady();
check("首頁問「今天要去哪裡？」", await page.getByRole("heading", { name: "今天要去哪裡？" }).isVisible());
check("首頁沒有活動探索", !(await page.getByText(/探索|活動/).count()));
check("首頁按鈕寫出最常走那條今天能不能走", /今天可以走|今天要注意/.test(await page.getByRole("button", { name: /走常走的路/ }).innerText()));
await page.getByRole("button", { name: /走常走的路/ }).click();
const routeCard = page.getByRole("button", { name: /小南門 → 台北車/ });
check("查過的路線出現在走常走的路", await routeCard.isVisible());
check("常走路線寫出今天的狀況", /今天沒有排定電梯保養|保養|異常/.test(await routeCard.innerText()));
await routeCard.click();
await page.getByText(RESULT_RE).waitFor();
check("常走路線一鍵看今天", (await page.locator("h1").innerText()) === "小南門 → 台北車站" && (await page.locator("#verdict").innerText()).startsWith("今天這趟"));
await page.evaluate(() => (location.hash = "#/"));
await homeReady();
await goBtn().click();
await page.getByRole("searchbox").fill("醫學院附設醫院");
await page.getByRole("button", { name: /國立臺灣大學醫學院附設醫院/ }).first().waitFor({ timeout: 15000 });
await page.getByRole("button", { name: /國立臺灣大學醫學院附設醫院/ }).first().click();
await pickOrigin("動物園站");
await planBtn().click();
await page.getByText(RESULT_RE).waitFor();
check("結果有出站之後的目的地", await page.getByRole("heading", { name: /出站之後・國立臺灣大學/ }).isVisible());
check("出站之後：寫出出口與距離", /號出口 → 直線約 \d+ 公尺/.test(await page.locator("section[aria-labelledby=after-title]").innerText()));
check("出站之後：斜坡、人行道、施工一行（附資料時間）", /附近：斜坡道 \d+ 處.*(施工 \d+ 處|沒有施工)（資料時間 /.test(await page.getByTestId("lastmile").innerText()) || /未確認/.test(await page.getByTestId("lastmile").innerText()));
const svcText = await page.getByTestId("services").innerText();
check("醫院：掛號、復康巴士（要登入），不放 1999 反映（在路上才需要），最多 3 個", /掛號臺大醫院/.test(svcText) && /預約復康巴士\s*要登入/.test(svcText) && !/反映設施故障/.test(svcText) && (await page.getByTestId("services").getByRole("button").count()) <= 3);
check("結論在最上面：今天這趟可以走（或要注意）", /^今天這趟(可以走|有 \d+ 個地方要注意)/.test(await page.locator("#verdict").innerText()));
const stepsBtn = page.getByRole("button", { name: "每一站怎麼走" });
check("每一站怎麼走預設收起", (await stepsBtn.getAttribute("aria-expanded")) === "false" && !(await page.getByText(/第 1 步，/).count()) && !(await page.getByRole("region", { name: "路線地圖" }).count()));
await stepsBtn.click();
check("展開後有步驟與地圖", (await stepsBtn.getAttribute("aria-expanded")) === "true" && (await page.getByRole("heading", { name: /從.*進站/ }).count()) > 0 && (await page.getByRole("region", { name: "路線地圖" }).count()) === 1);
check("結果頁沒有「傳給家人」（移到路上）", !(await page.getByText("傳給家人").count()));
check("沒有保養時不出現「也可以這樣走」", !(await page.getByText("也可以這樣走").count()));
// 預排保養：直接改好、一行註解、可改回（動物園站 2 號出口 11/12 白天保養；大安 → 動物園）
await planTrip(page, "大安站", "動物園站", "2026-11-12");
check("自動避開保養：結論仍是可以走", /11\/12（四）這趟可以走/.test(await page.locator("#verdict").innerText()));
const fixNote = page.getByTestId("autofix-note");
check("自動避開保養：一行註解（已改走 1 號出口）", (await fixNote.count()) === 1 && /動物園站 2 號出口電梯.*保養，已改走 1 號出口/.test(await fixNote.innerText()));
check("註解不說電梯壞了（保養是排程）", !/壞/.test(await fixNote.innerText()) && /還沒辦法確認：臨時故障/.test(await page.locator("main").innerText()));
await page.getByRole("button", { name: "改回原路線" }).click();
check("改回原路線：註解消失、改為要注意", !(await fixNote.count()) && /有 \d+ 個地方要注意/.test(await page.locator("#verdict").innerText()));
await page.getByRole("button", { name: "已記在常走路線，當天再看" }).waitFor();
await pickOrigin("小南門站");
await pickDest("台大醫院站", "2026-11-30");
await planBtn().click();
await page.getByText(RESULT_RE).waitFor();
check("有問題：判定寫出要注意", await page.getByText(/11\/30（一）這趟有 \d+ 個地方要注意/).isVisible());
check("有問題：給替代站", await page.getByRole("button", { name: /^改從/ }).isVisible());
check("其他日子不開始行程", (await page.getByRole("button", { name: "已記在常走路線，當天再看" }).isVisible()) && !(await page.getByRole("button", { name: /出發，一步一步/ }).count()));

// 8. 高對比模式：二級入口切換，重新整理後保留
await reset();
await page.getByRole("button", { name: "字級・語言" }).click();
await page.getByRole("switch", { name: "高對比模式" }).check();
await page.getByRole("button", { name: "完成" }).click();
check("高對比模式開啟", (await page.evaluate(() => document.documentElement.dataset.contrast)) === "high");
await page.reload();
check("高對比模式重新整理後保留", (await page.evaluate(() => document.documentElement.dataset.contrast)) === "high");
await page.evaluate(() => localStorage.clear());

// 9. 路上：手被佔住也操作得了（現在哪裡不方便 → 單手、按不準）＋看護印尼語
await reset();
await planTrip(page, "小南門站", "台大醫院站");
await page.getByRole("button", { name: /出發，一步一步帶我/ }).click();
await page.getByTestId("mode-look").click();
await page.getByText(/第 \d+ 步，共/).first().waitFor();
const bar = page.getByTestId("trip-bar");
check("路上：唸、需要幫忙都在底部操作列", (await bar.getByRole("button", { name: "唸給我聽" }).count()) === 1 && (await bar.getByRole("button", { name: "需要幫忙" }).count()) === 1);
check("路上：底部沒有放大字（字級在設定裡）", !(await bar.getByRole("button", { name: "放大字" }).count()));
await page.getByRole("button", { name: "字級・操作" }).click();
await page.getByTestId("need-oneHand").click();
await page.getByRole("radio", { name: "左手" }).click();
await page.getByTestId("need-imprecise").click();
await page.getByRole("button", { name: "完成" }).click();
const bb = await bar.boundingBox();
check("只有一隻手：操作列縮窄並靠左", bb.width < 412 * 0.85 && bb.x < 30);
const nb = await bar.getByRole("button", { name: /下一步/ }).boundingBox();
check("按不準：下一步按鈕變成整片大按鈕（≥ 112px）", nb.height >= 112);
await page.reload();
await page.getByText(/第 \d+ 步，共/).first().waitFor();
check("操作設定重新整理後保留", (await page.getByTestId("trip-bar").boundingBox()).width < 412 * 0.85);
await page.getByRole("button", { name: "字級・操作" }).click();
await page.getByRole("radio", { name: "Bahasa Indonesia" }).click();
await page.getByRole("button", { name: "完成" }).click();
check("看護模式：步驟改印尼語", await page.getByText(/Langkah 1 dari \d+/).isVisible());
check("看護模式：下一步按鈕印尼語", await page.getByRole("button", { name: /Sudah sampai .+, lanjut/ }).isVisible());
check("看護模式：內容標示 lang=id", (await page.locator("main[lang=id]").count()) === 1);
await page.getByRole("button", { name: "Butuh bantuan" }).click();
check("看護模式：需要幫忙面板印尼語", (await page.getByRole("heading", { name: "Apa yang terjadi?" }).isVisible()) && (await page.getByTestId("help-broken").innerText()).includes("Lift tidak bisa dipakai"));
await page.getByTestId("help-staff").click();
check("看護模式：求助卡仍是中文給站務人員", await page.getByText("請協助我，我需要搭電梯").isVisible());
check("看護模式：求助卡上方有印尼語說明", await page.locator("[role=dialog] p[lang=id]").isVisible());
await page.getByRole("button", { name: "Tutup" }).click();
await page.evaluate(() => localStorage.clear());


// 10. 第一次打開：不問「哪裡不方便」，直接分流；「字級・語言」仍在，要用才打開
{
  const c = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
  const p = await c.newPage();
  await p.goto(URL);
  await p.getByRole("button", { name: /去一個地方/ }).waitFor();
  check("第一次打開：首頁兩顆分流按鈕", (await p.getByRole("button", { name: /去一個地方/ }).isVisible()) && (await p.getByRole("button", { name: /走常走的路/ }).isVisible()));
  check("第一次打開：不自動詢問哪裡不方便", (await p.getByRole("heading", { name: "你現在哪裡不方便？" }).count()) === 0);
  await p.getByRole("button", { name: "字級・語言" }).click();
  check("字級・語言可以自己打開", await p.getByRole("heading", { name: "字級與操作方式" }).isVisible());
  await p.getByTestId("need-handsBusy").click();
  await p.getByRole("button", { name: "完成" }).click();
  await p.reload();
  await p.getByRole("button", { name: /去一個地方/ }).waitFor();
  check("自己勾的設定有保留", (await p.evaluate(() => localStorage.getItem("needs"))).includes("handsBusy"));
  await c.close();
}

// 11. 語音：用假的城市通（flutterObject）模擬裝置端辨識與朗讀
{
  const c = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
  await skipFirstRun(c);
  await c.addInitScript(() => {
    const w = window;
    w.__msgs = [];
    w.__say = [];
    const ls = [];
    w.flutterObject = {
      postMessage(m) {
        const o = JSON.parse(m);
        w.__msgs.push(o);
        if (o.name === "speech_to_text") {
          const text = w.__say.shift();
          setTimeout(() => ls.forEach((cb) => cb({ data: JSON.stringify({ name: "speech_to_text", data: text ? { text } : { error: "沒有聽到聲音" } }) })), 300);
        }
      },
      addEventListener: (_, cb) => ls.push(cb),
      removeEventListener: (_, cb) => ls.includes(cb) && ls.splice(ls.indexOf(cb), 1),
    };
  });
  const p = await c.newPage();
  const tts = () => p.evaluate(() => window.__msgs.filter((m) => m.name === "tts" && m.data.text).map((m) => m.data.text));
  const sttCount = () => p.evaluate(() => window.__msgs.filter((m) => m.name === "speech_to_text").length);
  const stepNo = async () => Number((await p.getByText(/第 \d+ 步，共/).first().innerText()).match(/第 (\d+)/)[1]);
  const sayNext = (...t) => p.evaluate((t) => window.__say.push(...t), t);
  await p.goto(URL + "?demo");
  await planTrip(p, "小南門站", "市政府站");
  await p.getByRole("button", { name: /出發，一步一步帶我/ }).click();
  await p.getByTestId("mode-look").click();
  await p.getByText(/第 \d+ 步，共/).first().waitFor();

  await p.getByRole("button", { name: "唸給我聽" }).click();
  const first = (await tts()).at(-1) ?? "";
  check("口語念稿：40 字內、不念括號箭頭", first.length <= 40 && !/[（）→()：]/.test(first));

  await sayNext("好我們下車了");
  await p.getByRole("button", { name: "用講的" }).click();
  check("按下用講的：馬上出現全幅「正在聽」", await p.getByText("正在聽").isVisible());
  await p.getByText(/聽到：好我們下車了/).waitFor({ timeout: 5000 });
  check("聽到後複述聽到的話", true);
  await p.waitForFunction(() => /第 2 步/.test(document.body.innerText), null, { timeout: 8000 });
  check("自然說法「好我們下車了」→ 下一步", (await stepNo()) === 2);
  await p.waitForTimeout(300);
  check("換步後念出新的一步", (await tts()).some((x) => /第二步|第 2 步|2 步/.test(x)));

  await sayNext("我按錯了回上一步");
  await p.getByRole("button", { name: "用講的" }).click();
  await p.waitForFunction(() => /第 1 步/.test(document.body.innerText), null, { timeout: 8000 });
  check("「我按錯了回上一步」→ 上一步", (await stepNo()) === 1);

  const n0 = (await tts()).length;
  await sayNext("今天天氣真好");
  await p.getByRole("button", { name: "用講的" }).click();
  await p.waitForTimeout(2500);
  check("聽不懂：不亂動，反問要下一步還是再聽", (await stepNo()) === 1 && (await tts()).slice(n0).some((x) => x.includes("沒聽懂")));

  // 兩隻手都在忙：念完自動聽，不用先按
  await p.getByRole("button", { name: "字級・操作" }).click();
  await p.getByTestId("need-handsBusy").click();
  await p.getByTestId("need-noLook").click();
  await p.getByRole("button", { name: "完成" }).click();
  const s0 = await sttCount();
  await p.getByRole("button", { name: /下一步/ }).last().click();
  await p.waitForFunction((s0) => window.__msgs.filter((m) => m.name === "speech_to_text").length > s0, s0, { timeout: 20000 }).catch(() => {});
  check("兩隻手都在忙：念完自動開麥克風", (await sttCount()) > s0);
  // 長按與主動提醒只開「不方便看螢幕」測（自動聽的全幅畫面會蓋住要長按的位置）
  await p.waitForFunction(() => !document.body.innerText.includes("正在聽"), null, { timeout: 5000 }).catch(() => {});
  await p.getByRole("button", { name: "字級・操作" }).click();
  await p.getByTestId("need-handsBusy").click();
  await p.getByRole("button", { name: "完成" }).click();

  // 長按任何地方 1 秒換步；短按、滑動不算（防口袋誤觸）
  await p.waitForTimeout(1500);
  check("不方便看螢幕：顯示長按提示", await p.getByTestId("hold-hint").isVisible());
  const before = await stepNo();
  const box = await p.getByTestId("hold-hint").boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y - 40;
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.waitForTimeout(300);
  await p.mouse.up();
  await p.waitForTimeout(300);
  check("短按不換步（防誤觸）", (await stepNo()) === before);
  await p.mouse.down();
  await p.waitForTimeout(400);
  await p.mouse.move(x + 40, y + 40);
  await p.waitForTimeout(900);
  await p.mouse.up();
  check("按著滑動不換步（防誤觸）", (await stepNo()) === before);
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.waitForTimeout(1300);
  await p.mouse.up();
  await p.waitForTimeout(300);
  check("長按一秒換下一步", (await stepNo()) === before + 1);
  check("換步後可以復原", await p.getByRole("button", { name: /復原/ }).isVisible().catch(() => false));

  // 快到站主動提醒（依時間表）
  const n1 = (await tts()).length;
  for (let i = 0; i < 8 && !(await tts()).slice(n1).some((x) => /快到|到.+了嗎/.test(x)); i++) {
    const ok = p.getByRole("button", { name: "我沒事" });
    if (await ok.isVisible()) await ok.click(); // 超時的「還好嗎」會蓋住畫面
    await p.getByRole("button", { name: "示範用：時間快轉 5 分鐘" }).click();
    await p.waitForTimeout(1300);
  }
  check("快到站會主動提醒", (await tts()).slice(n1).some((x) => /快到|到.+了嗎/.test(x)));
  await c.close();
}

// 12. 出發面板三種帶路方式＋下次不要再問；需要幫忙三選一（換一條路、電梯在哪、站務人員）；用講的挑選項
{
  const c = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
  await skipFirstRun(c);
  await c.addInitScript(() => {
    const w = window;
    w.__msgs = [];
    w.__say = [];
    const ls = [];
    w.flutterObject = {
      postMessage(m) {
        const o = JSON.parse(m);
        w.__msgs.push(o);
        if (o.name === "speech_to_text") {
          const text = w.__say.shift();
          setTimeout(() => ls.forEach((cb) => cb({ data: JSON.stringify({ name: "speech_to_text", data: text ? { text } : { error: "沒有聽到聲音" } }) })), 300);
        }
      },
      addEventListener: (_, cb) => ls.push(cb),
      removeEventListener: (_, cb) => ls.includes(cb) && ls.splice(ls.indexOf(cb), 1),
    };
  });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  const tts = () => p.evaluate(() => window.__msgs.filter((m) => m.name === "tts" && m.data.text).map((m) => m.data.text));
  const needsNow = () => p.evaluate(() => JSON.parse(localStorage.getItem("needs") ?? "[]"));
  const stepNo = async () => Number((await p.getByText(/第 \d+ 步，共/).first().innerText()).match(/第 (\d+)/)[1]);
  const depart = async () => {
    await planTrip(p, "小南門站", "台北車站");
    await p.getByRole("button", { name: /出發，一步一步帶我/ }).click();
    await p.getByText(/第 \d+ 步，共/).first().waitFor();
  };
  const endTrip = async () => {
    await p.getByRole("button", { name: "結束這趟" }).click();
    await p.getByText("這趟已結束").waitFor({ timeout: 8000 }).catch(async (e) => {
      await p.screenshot({ path: "end-fail.tmp.png" });
      throw e;
    });
  };
  await p.goto(URL + "?demo");

  // 唸給我聽 → noLook（自動念、長按），不開自動聽
  await depart();
  const sheet = p.getByTestId("mode-sheet");
  check("出發面板：有語音辨識時三個選擇都在", (await sheet.getByTestId("mode-look").isVisible()) && (await sheet.getByTestId("mode-listen").isVisible()) && (await sheet.getByTestId("mode-talk").isVisible()));
  check("出發面板出現時還沒開始念", !(await tts()).length);
  await sheet.getByTestId("mode-listen").click();
  const n1 = await needsNow();
  check("選「唸給我聽」：開啟不方便看螢幕、不開自動聽", n1.includes("noLook") && !n1.includes("handsBusy"));
  await p.waitForTimeout(500);
  check("選「唸給我聽」：馬上念第一步", (await tts()).length > 0);
  check("選「唸給我聽」：顯示長按提示", await p.getByTestId("hold-hint").isVisible());

  // 需要幫忙 → 找不到電梯：念出並大字寫出電梯在哪
  await p.getByTestId("trip-bar").getByRole("button", { name: "需要幫忙" }).click();
  const n0 = (await tts()).length;
  await p.getByTestId("help-find").click();
  await p.waitForTimeout(400);
  check("找不到電梯：大字寫出出口", (await p.getByTestId("elevator-where").innerText()).includes("出口"));
  check("找不到電梯：念出電梯怎麼走", (await tts()).slice(n0).some((x) => /電梯|出口/.test(x)));
  await p.getByRole("button", { name: "關閉", exact: true }).click();

  // 第 2 步在西門轉乘 → 電梯不能用：從西門月臺出發、不在西門轉乘
  await p.getByRole("button", { name: /我到西門了，下一步/ }).click();
  await p.getByText("第 2 步，共").first().waitFor();
  check("第二步是西門轉乘", (await p.locator("main").innerText()).includes("在西門站換搭"));
  await p.getByTestId("trip-bar").getByRole("button", { name: "需要幫忙" }).click();
  const n2 = (await tts()).length;
  await p.getByTestId("help-broken").click();
  await p.getByTestId("rerouted").waitFor({ timeout: 3000 }).catch(() => {});
  const main = await p.locator("main").innerText();
  check("電梯不能用：換一條路，不在西門轉乘", (await p.getByTestId("rerouted").isVisible()) && !main.includes("在西門站換搭"));
  check("電梯不能用：從西門月臺接著走（沒有進站這一步）", (await stepNo()) === 1 && !/從.+進站/.test(main.split("全部步驟")[0]));
  await p.waitForTimeout(400);
  const said = (await tts()).slice(n2).find((x) => x.startsWith("好"));
  check("電梯不能用：念一句短的（≤40 字、無符號）", !!said && [...said].length <= 40 && !/[（）()→/／：:；;、]/.test(said));
  check("電梯不能用：可以復原", await p.getByRole("button", { name: "復原" }).isVisible());
  // 再找一次：找站務人員 → 全螢幕求助卡
  await p.getByTestId("trip-bar").getByRole("button", { name: "需要幫忙" }).click();
  await p.getByTestId("help-staff").click();
  check("請站務人員：打開求助卡", await p.getByText("請協助我，我需要搭電梯").isVisible());
  await p.getByRole("button", { name: "關閉", exact: true }).click();

  // 用講的挑選項：「我找不到電梯」→ 直接到電梯在哪
  await p.evaluate(() => window.__say.push("我找不到電梯"));
  await p.getByTestId("trip-bar").getByRole("button", { name: "用講的" }).click();
  await p.getByTestId("elevator-where").waitFor({ timeout: 8000 }).catch(() => {});
  check("用講的「我找不到電梯」→ 電梯在哪", await p.getByTestId("elevator-where").isVisible());
  await p.getByRole("button", { name: "關閉", exact: true }).click();
  await endTrip();

  // 唸給我聽，我用講的 → noLook + handsBusy；勾「下次不要再問」
  await depart();
  await sheet.getByLabel("下次不要再問").check();
  await sheet.getByTestId("mode-talk").click();
  const n3 = await needsNow();
  check("選「我用講的」：不方便看螢幕＋兩隻手都在忙", n3.includes("noLook") && n3.includes("handsBusy"));
  await p.waitForFunction(() => !document.body.innerText.includes("正在聽"), null, { timeout: 8000 }).catch(() => {});
  await endTrip();
  await depart();
  await p.waitForTimeout(300);
  check("勾了下次不要再問：出發不再跳出面板", !(await sheet.count()));
  await p.reload();
  await p.getByText(/第 \d+ 步，共/).first().waitFor();
  check("下次不要再問：重新整理後也不跳出", !(await sheet.count()));
  await c.close();
}

// 13. 行程生命週期：同路線出發＝回到原本那趟；不同路線先問；結束／到達後可以開新的；永遠只有一趟
{
  const c = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: "zh-TW" });
  await skipFirstRun(c);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  const key = () => p.evaluate(() => { const t = JSON.parse(localStorage.getItem("activeTrip") ?? "null")?.trip; return t ? `${t.id}|${t.dest}|${t.reached}` : null; });
  await p.goto(URL + "?demo");
  await p.evaluate(() => localStorage.setItem("askModeOff", "1"));
  await planTrip(p, "小南門站", "台北車站");
  await p.getByRole("button", { name: "出發，一步一步帶我" }).click();
  await p.getByText(/第 \d+ 步，共/).first().waitFor();
  await p.getByRole("button", { name: /下一步$/ }).click();
  await p.getByText("第 2 步，共").first().waitFor();
  const k0 = await key();
  await p.goBack();
  await p.getByRole("button", { name: "回到路上的下一步" }).click();
  await p.getByText("第 2 步，共").first().waitFor();
  check("返回→再出發：同一趟、同一步（沒有多一趟）", (await key()) === k0);
  // 連按兩次出發也只有一趟
  await p.goBack();
  await p.getByRole("button", { name: "回到路上的下一步" }).evaluate((b) => (b.click(), b.click())); // 同一瞬間按兩次
  await p.getByText("第 2 步，共").first().waitFor();
  check("連按兩次出發：仍是同一趟", (await key()) === k0);
  // 不同路線：先問
  await p.goBack();
  await p.goBack().catch(() => {});
  await planTrip(p, "小南門站", "松山站");
  await p.getByRole("button", { name: "回到路上的下一步" }).click();
  const sw = p.getByTestId("switch-trip");
  await sw.waitFor({ timeout: 3000 });
  check("換路線：問「要結束現在這趟，改走新的嗎？」兩個按鈕", (await sw.innerText()).includes("要結束現在這趟，改走新的嗎？") && (await sw.getByRole("button").count()) === 2);
  check("問的時候原本那趟沒被動", (await key()) === k0);
  await sw.getByTestId("switch-no").click();
  await p.getByText("第 2 步，共").first().waitFor();
  check("選繼續原本這趟：回到原本那趟同一步", (await key()) === k0);
  await p.goBack();
  await p.getByRole("button", { name: "回到路上的下一步" }).click();
  await p.getByTestId("switch-yes").click();
  await p.getByText("第 1 步，共").first().waitFor();
  const k1 = await key();
  check("選改走新的：新的一趟（不同 id、目的地換了、回到第 1 步）", k1 && k1 !== k0 && k1.includes("松山站") && k1.endsWith("|0"));
  // 結束後再出發 = 開新的；已結束的不會被當成進行中
  await p.getByRole("button", { name: "結束這趟" }).click();
  await p.getByText("這趟已結束").waitFor();
  await p.reload();
  await p.waitForTimeout(500);
  check("結束後重新整理：沒有進行中的行程（不會被拉回路上）", (await key()) === null && !(await p.evaluate(() => location.hash)).includes("trip"));
  await c.close();
}

check("沒有頁面錯誤", !errors.length);
await browser.close();
for (const [n, ok] of results) console.log(`${ok ? "✓" : "✗"} ${n}`);
if (errors.length) console.log(errors.join("\n"));
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} 項失敗` : "\n全部通過");
process.exit(failed ? 1 : 0);
