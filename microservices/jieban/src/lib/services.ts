// 市政服務入口（public/data/services.json，查證紀錄見 docs/research/14）：依目的地種類挑最多 3 個按鈕。
// 原則：第一個是「出發前能少做一件事」（掛號、叫號、預約）。反映設施故障屬於路上，不放這裡。
import { ref } from "vue";

export type Service = {
  id: string;
  title: string;
  does: string;
  placeKinds: string[];
  keywords: string[];
  url: string;
  phone: string | null;
  loginRequired: boolean;
};

export const services = ref<Service[]>([]);
let loading: Promise<void> | null = null;
export function loadServices(): Promise<void> {
  loading ??= fetch("./data/services.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: Service[]) => {
      services.value = j;
    })
    .catch((e) => {
      loading = null;
      console.error(e);
    });
  return loading;
}

export type DestKind = { name: string; kind: string | null; id?: string | null };

/** 醫院掛號只給「確定對得上」的那一家，對不上就不放（掛錯醫院比沒有按鈕更糟）。 */
function registerId(d: DestKind): string | null {
  const n = d.name.replaceAll("臺", "台");
  if (n.includes("台大") || d.id === "ntuh-west") return "ntuh-register";
  if (n.includes("仁愛") || n.includes("聯合醫院") || d.id === "tpech-renai") return "tpech-register";
  return null;
}

// 「反映設施故障」(1999) 不放在出發前：事情發生在路上，移到行程的求助面板
const GENERIC = ["metro-a11y-guide"];
/** 目的地種類 → 服務 id 順序（docs/research/14 §2.3）。 */
function idsFor(d: DestKind | null): string[] {
  switch (d?.kind) {
    case "醫院":
      return [registerId(d) ?? "", "fgbus-book"];
    case "區公所":
      return ["district-queue", "senior-card"];
    case "輔具中心":
      return ["aid-center-book", "fgbus-book"];
    case "圖書館":
      return ["library-blind"];
    default:
      return GENERIC;
  }
}

export function servicesFor(d: DestKind | null): Service[] {
  const out: Service[] = [];
  for (const id of idsFor(d)) {
    const s = services.value.find((x) => x.id === id);
    if (s) out.push(s);
  }
  return out.slice(0, 3);
}
