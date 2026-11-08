// 「去一個地方」畫面的狀態：放在畫面外，去選出發站再回來時輸入的地點與選的結果還在。
import { ref, watch } from "vue";
import type { PlaceHit } from "./placeSearch";

/** 路上需要什麼：需要電梯固定採用（規劃只走有電梯或坡道的出口）；少走路、少轉乘從幾個方案裡挑。 */
export type RouteNeeds = { elevator: boolean; lessWalk: boolean; lessTransfer: boolean };
const KEY = "routeNeeds";
function loadNeeds(): RouteNeeds {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object") return { elevator: v.elevator !== false, lessWalk: !!v.lessWalk, lessTransfer: !!v.lessTransfer };
  } catch {}
  return { elevator: true, lessWalk: false, lessTransfer: false };
}
export const needs = ref<RouteNeeds>(loadNeeds());
watch(
  needs,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {}
  },
  { deep: true },
);

export const query = ref("");
export const hits = ref<PlaceHit[]>([]);
export const picked = ref<PlaceHit | null>(null);
export const searched = ref(false);
/** 指定日期（深連結 ?date=；畫面上沒有日期欄，預設今天） */
export const goDate = ref("");

export function resetGo() {
  query.value = "";
  hits.value = [];
  picked.value = null;
  searched.value = false;
  goDate.value = "";
}
