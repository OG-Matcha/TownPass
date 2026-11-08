// 畫面路由（hash）：每個畫面一筆瀏覽紀錄 → 城市通 AppBar 的返回鍵、Android 返回鍵都能一步一步退。
// 靜態部署與 App 內離線（localhost）都能用，不需要伺服器設定。
// history.state.depth 記錄「在服務裡走了幾層」：直接開進子畫面（depth 0）時，返回改回首頁，不會離開服務。
import { ref } from "vue";

export type Route =
  | { name: "home" }
  | { name: "go" }
  | { name: "often" }
  | { name: "pick"; field: "origin" | "dest" }
  | { name: "result" }
  | { name: "trip" }
  | { name: "family"; id: string };

export function parseRoute(hash: string): Route {
  let m: RegExpMatchArray | null;
  if ((m = hash.match(/^#\/family\/([a-z0-9]+)/))) return { name: "family", id: m[1] };
  if ((m = hash.match(/^#\/pick\/(origin|dest)$/))) return { name: "pick", field: m[1] as "origin" | "dest" };
  if (/^#\/go(\?|$)/.test(hash)) return { name: "go" };
  if (hash === "#/often") return { name: "often" };
  if (hash === "#/result") return { name: "result" };
  if (hash === "#/trip") return { name: "trip" };
  return { name: "home" };
}

export const route = ref<Route>(parseRoute(location.hash));
const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0;
if (history.state?.depth == null) history.replaceState({ ...(history.state ?? {}), depth: 0 }, "");

function sync() {
  route.value = parseRoute(location.hash);
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", sync);
window.addEventListener("hashchange", sync); // 使用者自己改網址

/** 前往另一個畫面（新增一筆紀錄）。 */
export function go(hash: string) {
  if (location.hash === hash || (hash === "#/" && !location.hash)) return;
  history.pushState({ depth: depth() + 1 }, "", hash);
  sync();
}

/** 取代目前這筆紀錄（例如沒有結果時把 #/result 換回規劃頁，返回鍵不會繞回空畫面）。 */
export function replace(hash: string) {
  history.replaceState({ depth: depth() }, "", hash === "#/" ? location.pathname + location.search : hash);
  sync();
}

/** 返回上一個畫面；直接開進子畫面（沒有上一層）時回到首頁。 */
export function back() {
  if (depth() > 0) history.back();
  else replace("#/");
}
