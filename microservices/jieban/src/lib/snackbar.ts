// 狀態回饋＋復原（城市通進階無障礙規範：改變狀態的操作要有明確回饋，並給 5 秒「復原」）
import { ref } from "vue";

export type Snack = { id: number; text: string; undo?: () => void };
export const snack = ref<Snack | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export const UNDO_MS = 5000;

export function showSnack(text: string, undo?: () => void) {
  clearTimeout(timer);
  const id = ++seq;
  snack.value = { id, text, undo };
  timer = setTimeout(() => {
    if (snack.value?.id === id) snack.value = null;
  }, undo ? UNDO_MS : 3500);
}

export function runUndo() {
  const s = snack.value;
  snack.value = null;
  clearTimeout(timer);
  s?.undo?.();
}
export const dismissSnack = () => {
  snack.value = null;
  clearTimeout(timer);
};
