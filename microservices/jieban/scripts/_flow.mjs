// 檢查腳本共用：規劃一趟路線。選站流程由 behavior-check 測，這裡直接帶入「上次選的站」再按查路線。
export const RESULT_RE = /約 \d+ 分・(不用轉乘|轉乘 \d+ 次)/;
export async function planTrip(page, from, to, date) {
  // 首頁 → 「去一個地方」（#/go）：出發站放在 localStorage，目的地與日期用深連結帶入（#/go?to=…&date=…），再按「查路線」
  await page.evaluate((f) => localStorage.setItem("origin", JSON.stringify(f)), from);
  const q = new URLSearchParams({ to, ...(date ? { date } : {}) });
  await page.evaluate((h) => (location.hash = h), `#/go?${q}`);
  await page.reload();
  const btn = page.getByRole("button", { name: "查路線" });
  await btn.waitFor();
  await page.waitForFunction(() => !document.querySelector("button[disabled]")?.textContent?.includes("載入"));
  await btn.click();
  await page.getByText(RESULT_RE).waitFor();
}

/**
 * 從結果頁出發（今天）：出發面板問「路上你想怎麼知道下一步？」——先打開「讓家人看到你到哪一站」，
 * 按「複製連結」開始分享，再選操作方式（預設「看畫面就好」）。回傳家人連結。
 */
export async function startTrip(page, name, mode = "look") {
  const go = page.getByRole("button", { name: /出發，一步一步帶我|回到路上的下一步/ });
  if (await go.count()) await go.click();
  const sheet = page.getByTestId("mode-sheet");
  await sheet.or(page.getByText(/第 \d+ 步，共/).first()).first().waitFor();
  if (!(await sheet.isVisible())) await page.getByRole("button", { name: "讓家人看到你到哪一站" }).click();
  await sheet.waitFor();
  const row = sheet.getByTestId("share-row");
  if ((await row.getAttribute("open")) === null) await row.locator("summary").click();
  if (name) await sheet.getByLabel("家人看到的稱呼").fill(name);
  await sheet.getByRole("button", { name: "複製連結" }).click();
  const link = (await sheet.getByTestId("family-link").innerText()).trim();
  await sheet.getByTestId(`mode-${mode}`).click();
  await page.getByText(/第 \d+ 步，共/).first().waitFor();
  return link;
}

/** 第一次打開會問「你現在哪裡不方便」；其他檢查跳過它（第一次流程在 behavior-check 另外測）。 */
export const skipFirstRun = (ctx) => ctx.addInitScript(() => {
  try {
    localStorage.setItem("needsAsked", "1");
  } catch {}
});
