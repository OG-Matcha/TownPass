// 與城市通 App 共用顯示設定（字級、高對比、慣用手）：同一份設定存在 App（操作輔助層 feat/a11y-layer 的 `a11y_settings` handler），
// 在城市通設定一次，每個微服務都適用；在這裡改了也寫回 App。不在 App 內（一般瀏覽器）或 App 沒有這個 handler → 什麼都不做，沿用本機設定。
import { watch } from "vue";
import { askApp, inTownPass } from "./bridge";
import { FONT_LEVELS, fontLevel, hand, highContrast, type FontLevel } from "./settings";

type AppA11y = { fontLevel?: string; highContrast?: boolean; hand?: string };

let applying = false;

export async function syncWithApp(): Promise<void> {
  if (!inTownPass()) return;
  const s = await askApp<AppA11y>("a11y_settings", { action: "get" }, 3000);
  if (s) {
    applying = true;
    if (FONT_LEVELS.some((l) => l.id === s.fontLevel)) fontLevel.value = s.fontLevel as FontLevel;
    if (typeof s.highContrast === "boolean") highContrast.value = s.highContrast;
    if (s.hand === "left" || s.hand === "right") hand.value = s.hand;
    applying = false;
  }
  // 沒有 handler（舊版 App）時 askApp 逾時回 null：不寫回，避免對不存在的 handler 一直送訊息
  if (!s) return;
  watch([fontLevel, highContrast, hand], () => {
    if (applying) return;
    void askApp("a11y_settings", { action: "set", settings: { fontLevel: fontLevel.value, highContrast: highContrast.value, hand: hand.value } }, 3000);
  });
}
