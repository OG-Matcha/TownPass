// 按偏／手抖偵測：只觀察、不改任何東西。累積到門檻時呼叫 onStruggle，由畫面「先問」使用者要不要放大。
// 訊號（都在裝置端計算，不送出任何資料）：
//  1. 按偏：點在空白處，但 NEAR_PX 內有可按的東西
//  2. 連點：同一個東西 REPEAT_MS 內被按兩次以上（手抖或以為沒按到）
// WINDOW_MS 內累積 THRESHOLD 次就觸發；地圖區域不算（拖曳地圖本來就會點在空白處）。

const INTERACTIVE = 'button, a[href], input, select, textarea, label, [role="button"], [role="radio"], [role="checkbox"]';
export const NEAR_PX = 24;
export const REPEAT_MS = 600;
export const WINDOW_MS = 30_000;
export const THRESHOLD = 3;

export type TapEvent = { kind: "miss" | "repeat"; t: number };

/** 點 (x,y) 到矩形的距離（在矩形內為 0）。 */
export function distToRect(x: number, y: number, r: { left: number; right: number; top: number; bottom: number }) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/** 視窗內的事件數是否達門檻。 */
export function struggling(events: TapEvent[], now: number) {
  return events.filter((e) => now - e.t <= WINDOW_MS).length >= THRESHOLD;
}

export function watchMissTaps(onStruggle: () => void, root: Document = document): () => void {
  let events: TapEvent[] = [];
  let last: { el: Element; t: number } | null = null;

  const record = (kind: TapEvent["kind"]) => {
    const now = performance.now();
    events = [...events.filter((e) => now - e.t <= WINDOW_MS), { kind, t: now }];
    if (struggling(events, now)) {
      events = [];
      onStruggle();
    }
  };

  const handler = (ev: PointerEvent) => {
    if (!ev.isPrimary) return;
    const target = ev.target as Element | null;
    if (!target || target.closest(".maplibregl-map, [data-miss-ignore]")) return;
    const hit = target.closest(INTERACTIVE);
    const now = performance.now();
    if (hit) {
      if (last && last.el === hit && now - last.t < REPEAT_MS) record("repeat");
      last = { el: hit, t: now };
      return;
    }
    last = null;
    for (const el of root.querySelectorAll(INTERACTIVE)) {
      const r = el.getBoundingClientRect();
      if (r.width && distToRect(ev.clientX, ev.clientY, r) <= NEAR_PX) {
        record("miss");
        return;
      }
    }
  };

  root.addEventListener("pointerdown", handler, { capture: true, passive: true });
  return () => root.removeEventListener("pointerdown", handler, { capture: true });
}
