// 顯示設定：字級三段、高對比模式。存在本機，所有頁面（規劃頁、家人頁）共用。
// 字級只改根字級（全部尺寸都用 rem）；高對比只換 CSS 變數（style.css 的 [data-contrast="high"]）。
import { ref, watchEffect } from "vue";

export const FONT_LEVELS = [
  { id: "normal", label: "標準", px: 16 },
  { id: "large", label: "大", px: 20 },
  { id: "xlarge", label: "特大", px: 24 },
] as const;
export type FontLevel = (typeof FONT_LEVELS)[number]["id"];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {}
}

const savedLevel = read("fontLevel");
export const fontLevel = ref<FontLevel>(
  FONT_LEVELS.some((l) => l.id === savedLevel) ? (savedLevel as FontLevel) : "normal",
);
export const highContrast = ref(read("highContrast") === "1");

watchEffect(() => {
  const lv = FONT_LEVELS.find((l) => l.id === fontLevel.value)!;
  document.documentElement.style.fontSize = `${lv.px}px`;
  write("fontLevel", lv.id);
});
watchEffect(() => {
  if (highContrast.value) document.documentElement.dataset.contrast = "high";
  else delete document.documentElement.dataset.contrast;
  write("highContrast", highContrast.value ? "1" : "0");
});

/** 往大（+1）或往小（-1）調一級，回傳新的字級名稱。 */
export function stepFont(dir: 1 | -1): string {
  const i = FONT_LEVELS.findIndex((l) => l.id === fontLevel.value);
  const j = Math.max(0, Math.min(FONT_LEVELS.length - 1, i + dir));
  fontLevel.value = FONT_LEVELS[j].id;
  return FONT_LEVELS[j].label;
}

// ---- 現在哪裡不方便（可以複選、隨時切換；不問身分，只問當下的身體狀況）----
// 點不準 → 路上的「下一步」變成整片下方的大按鈕
// 只有一隻手 → 路上的按鈕都排在拇指那一側（hand）
// 兩隻手都在忙 → 每次念完自動開麥克風聽一句（不用先按「用講的」）
// 不方便看螢幕 → 自動念、快到站主動提醒、長按任何地方換步（本人打開才會出聲，符合 AV2）
// 不方便講話 → 不顯示「用講的」，全部用按的
export const NEEDS = [
  { id: "imprecise", label: "手不穩、按不準", hint: "「下一步」變成整片大按鈕" },
  { id: "oneHand", label: "只有一隻手方便", hint: "按鈕排在拇指那一邊" },
  { id: "handsBusy", label: "兩隻手都在忙", hint: "念完自動聽你說「到了」，不用按" },
  { id: "noLook", label: "不方便一直看螢幕", hint: "自動念、快到站會提醒；長按螢幕任何地方換下一步" },
  { id: "noTalk", label: "不方便講話", hint: "不顯示「用講的」" },
] as const;
export type Need = (typeof NEEDS)[number]["id"];
function readNeeds(): Need[] {
  try {
    const v = JSON.parse(read("needs") ?? "[]");
    return Array.isArray(v) ? v.filter((x) => NEEDS.some((n) => n.id === x)) : [];
  } catch {
    return [];
  }
}
export const needs = ref<Need[]>(readNeeds());
/** 第一次打開時問過「現在哪裡不方便」了沒（問一次，之後在設定裡改） */
export const needsAsked = ref(read("needsAsked") === "1");
watchEffect(() => needsAsked.value && write("needsAsked", "1"));
export const has = (n: Need) => needs.value.includes(n);
export const hand = ref<"right" | "left">(read("hand") === "left" ? "left" : "right");
/** 路上畫面的介面語言（看護模式）。求助卡永遠是中文。 */
export const lang = ref<"zh" | "id">(read("lang") === "id" ? "id" : "zh");
watchEffect(() => write("needs", JSON.stringify(needs.value)));
watchEffect(() => write("hand", hand.value));
watchEffect(() => write("lang", lang.value));
