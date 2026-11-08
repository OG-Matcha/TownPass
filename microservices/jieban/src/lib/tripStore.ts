// 行程儲存：有設定 VITE_TRIP_API 就用雲端（worker/trip-worker.js），否則存在本機（同一台裝置的分頁之間即時同步）。
// 本機模式只能在同一台裝置示範；兩支手機要用雲端模式。
import type { Trip } from "./trip.ts";

const API = (import.meta.env.VITE_TRIP_API as string | undefined)?.replace(/\/$/, "") || null;
export const tripStoreMode: "cloud" | "local" = API ? "cloud" : "local";
export const POLL_MS = 15_000;

const KEY = (id: string) => `trip:${id}`;
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("trips") : null;

function randomToken(len: number): string {
  // 拒絕取樣，避免取餘數造成的偏差
  const out: string[] = [];
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len))) if (b < 252 && out.length < len) out.push((b % 36).toString(36));
  }
  return out.join("");
}

/** 行程 id（放在家人連結裡，只能讀）。 */
export const newTripId = () => randomToken(16);
/** 寫入權杖（只留在旅客手機，不放進連結；32 碼約 165 bits）。 */
export const newWriteToken = () => randomToken(32);

export async function saveTrip(trip: Trip, writeToken: string): Promise<void> {
  // 先轉成字串：Vue 的 reactive 物件不能直接 postMessage（DataCloneError）
  const body = JSON.stringify(trip);
  if (API) {
    const r = await fetch(`${API}/trips/${trip.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${writeToken}` },
      body,
    });
    if (!r.ok) throw new Error(`分享失敗 ${r.status}`); // 讓畫面照實說「家人暫時看不到」
    return;
  }
  try {
    localStorage.setItem(KEY(trip.id), body);
  } catch {}
  channel?.postMessage(body);
}

export async function loadTrip(id: string): Promise<Trip | null> {
  if (API) {
    const res = await fetch(`${API}/trips/${id}`);
    if (res.status === 404) return null; // 真的不存在
    if (!res.ok) throw new Error(`讀取失敗 ${res.status}`); // 網路或伺服器問題：不等於「找不到」
    return (await res.json()) as Trip;
  }
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as Trip) : null;
  } catch {
    return null;
  }
}

/** 訂閱行程更新：本機模式即時，雲端模式每 15 秒輪詢。回傳取消函式。 */
export function watchTrip(id: string, cb: (t: Trip | null) => void, onError?: () => void): () => void {
  let stopped = false;
  const pull = async () => {
    try {
      const t = await loadTrip(id);
      if (!stopped) cb(t);
    } catch {
      if (!stopped) onError?.();
    }
  };
  pull();
  const timer = setInterval(pull, POLL_MS);
  const onMsg = (e: MessageEvent<string>) => {
    const t = JSON.parse(e.data) as Trip;
    if (t.id === id) cb(t);
  };
  channel?.addEventListener("message", onMsg);
  return () => {
    stopped = true;
    clearInterval(timer);
    channel?.removeEventListener("message", onMsg);
  };
}

// 家人要能從自己的手機打開：App 內網頁是 localhost，所以有設 VITE_PUBLIC_URL（公開網址）就用它
const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/?$/, "/") || null;

export function familyLink(id: string): string {
  return `${PUBLIC_URL ?? location.origin + location.pathname}#/family/${id}`;
}
