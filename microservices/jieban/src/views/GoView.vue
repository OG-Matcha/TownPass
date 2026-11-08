<script setup lang="ts">
// 第二層「去一個地方」：打字或用講的找地點 → 選一筆 → 路上需要什麼 → 查路線（沿用結果頁）。
// 不問身分、不問障別；結果最多 3 筆；不收地址（只認地點名）。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Check, ChevronRight, Mic } from "lucide-vue-next";
import ListeningSheet from "@/components/ListeningSheet.vue";
import PageHeader from "@/components/PageHeader.vue";
import { feedback } from "@/lib/feedback";
import { goDate, hits, needs, picked, query, searched } from "@/lib/goState";
import { homeDeclaredIn, isGoHome, type PlaceLite } from "@/lib/homeIntent";
import { CATEGORY_CHIPS, searchPlaces, warmPlaceSearch, type PlaceHit } from "@/lib/placeSearch";
import { accessOf, destinationOf, places } from "@/lib/places";
import { go } from "@/lib/router";
import {
  choosePlace,
  chooseOption,
  date,
  dateChoice,
  dest,
  destPlace,
  doPlan,
  formProblem,
  loading,
  origin,
  pickStation,
  result,
  savedRoutes,
  short,
  stations,
} from "@/lib/planner";
import { listenOnce, voiceSource } from "@/lib/voiceInput";

const HOME_KEY = "homeStation";
const getHome = () => {
  try {
    return localStorage.getItem(HOME_KEY) ?? "";
  } catch {
    return "";
  }
};
const homeMsg = ref("");

// 出發站：記住上次選的；沒有就帶最常走那條的起點
if (!origin.value && savedRoutes.value.length) origin.value = savedRoutes.value[0].origin;

// 深連結：#/go?to=台大醫院站&from=小南門站&date=2026-11-30（測試與從別處帶入用）
onMounted(() => {
  warmPlaceSearch();
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const to = q.get("to");
  if (q.get("from")) origin.value = q.get("from")!;
  if (q.get("date")) goDate.value = q.get("date")!;
  if (to) picked.value = { type: "station", id: `st:${to}`, name: short(to), sub: "捷運站", station: to, why: "name", score: 1 };
});

// ---- 搜尋（輸入停 250 ms 才查）----
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
async function runSearch(q: string) {
  const my = ++seq;
  const k = q.trim();
  if (!k) {
    hits.value = [];
    searched.value = false;
    return;
  }
  const r = (await searchPlaces(k, { limit: 3 })).slice(0, 3);
  if (my !== seq) return;
  hits.value = r;
  searched.value = true;
  homeMsg.value = "";
  if (!picked.value || !r.some((h) => h.id === picked.value!.id)) picked.value = r.length === 1 ? r[0] : null;
}
watch(query, (q) => {
  clearTimeout(timer);
  timer = setTimeout(() => void runSearch(q), 250);
});
onBeforeUnmount(() => clearTimeout(timer));

function chip(q: string) {
  query.value = q;
  clearTimeout(timer);
  void runSearch(q);
}
function chooseHit(h: PlaceHit) {
  picked.value = h;
  problem.value = "";
}

// ---- 回家 ----
function goHome(note = "") {
  const home = getHome();
  clearTimeout(timer);
  seq++;
  query.value = "";
  hits.value = [];
  searched.value = false;
  if (!home) {
    picked.value = null;
    homeMsg.value = note || "還不知道家在哪一站。請按麥克風說「家在○○站」。";
    return;
  }
  homeMsg.value = note;
  picked.value = { type: "station", id: "home", name: "家", sub: `${short(home)}站`, station: home, why: "alias", score: 1 };
}

// ---- 用講的 ----
const voiceOk = voiceSource() !== "none";
const L = reactive({ on: false, state: "listening" as "listening" | "thinking" | "heard" | "error", text: "", hint: "" });
let listenSeq = 0;
const placesLite = (): PlaceLite[] => places.value.map((p) => ({ id: p.id, name: p.name, station: accessOf.value.get(p.id)?.station ?? "" })).filter((p) => p.station);
async function listen() {
  if (L.on) return;
  const my = ++listenSeq;
  Object.assign(L, { on: true, state: "listening", text: "", hint: "請說要去哪裡，例如「台大醫院」" });
  feedback("listen");
  let text = "";
  try {
    text = await listenOnce();
  } catch (e) {
    if (my !== listenSeq) return;
    Object.assign(L, { state: "error", hint: (e as Error).message });
    feedback("fail");
    setTimeout(() => my === listenSeq && (L.on = false), 1500);
    return;
  }
  if (my !== listenSeq) return;
  feedback("heard");
  Object.assign(L, { state: "heard", text });
  setTimeout(() => my === listenSeq && (L.on = false), 600);
  const homeSt = homeDeclaredIn(text, stations.value, placesLite());
  if (homeSt) {
    try {
      localStorage.setItem(HOME_KEY, homeSt);
    } catch {}
    return goHome(`已記下家在 ${homeSt}。`);
  }
  if (isGoHome(text)) return goHome();
  query.value = text;
  clearTimeout(timer);
  void runSearch(text);
}
function cancelListen() {
  listenSeq++;
  L.on = false;
}

// ---- 路上需要 ----
const OPTIONS = [
  { key: "elevator", label: "需要電梯" },
  { key: "lessWalk", label: "少走路" },
  { key: "lessTransfer", label: "少轉乘" },
] as const;
function toggleNeed(k: (typeof OPTIONS)[number]["key"]) {
  needs.value = { ...needs.value, [k]: !needs.value[k] };
}
/** 少轉乘、少走路：從規劃出的幾個方案（到同一站）裡挑，其他都一樣時維持最快的。需要電梯是規劃的基本條件（只走有電梯或坡道的出口）。 */
function applyNeeds() {
  const r = result.value;
  if (!r || r.options.length < 2) return;
  const d0 = r.options[0].dest;
  const walk = (i: number) => r.options[i].plan.transfers.reduce((a, t) => a + (t.walkMin ?? 0), 0);
  const tr = (i: number) => r.options[i].plan.transfers.length;
  let best = 0;
  for (let i = 1; i < r.options.length; i++) {
    if (r.options[i].dest !== d0) continue;
    const fewer = needs.value.lessTransfer && tr(i) < tr(best);
    const same = !needs.value.lessTransfer || tr(i) === tr(best);
    if (fewer || (same && needs.value.lessWalk && walk(i) < walk(best))) best = i;
  }
  if (best) chooseOption(best);
}

// ---- 查路線 ----
const problem = ref("");
const originBtn = ref<HTMLElement | null>(null);
const shown = computed<PlaceHit[]>(() => (hits.value.length ? hits.value : picked.value?.id === "home" ? [picked.value] : []));
function submit() {
  const h = picked.value ?? (hits.value.length === 1 ? hits.value[0] : null);
  if (!h) {
    problem.value = hits.value.length ? "請點一個地點。" : query.value.trim() && searched.value ? "找不到這個地方，換個說法再試一次。" : "請先輸入或選一個地點。";
    return;
  }
  const st = h.station || accessOf.value.get(h.id)?.station || "";
  if (!st) {
    problem.value = "這個地點還找不到附近的捷運站，請換一個。";
    return;
  }
  if (h.type === "place") choosePlace(h.id, st);
  else {
    pickStation("dest", st);
    destPlace.value = null;
  }
  date.value = goDate.value || dateChoice(0);
  const p = formProblem();
  if (p) {
    problem.value = p.text;
    if (p.field === "origin") originBtn.value?.focus();
    return;
  }
  problem.value = "";
  const point = destPlace.value?.station === dest.value ? destinationOf(destPlace.value) : null;
  if (doPlan(point)) {
    applyNeeds();
    go("#/result");
  }
}
</script>

<template>
  <PageHeader title="去一個地方" />
  <main class="space-y-5 p-4 pb-12">
    <div class="space-y-3">
      <div class="flex items-stretch gap-3">
        <label class="block min-w-0 flex-1">
          <span class="sr-only">地點名稱（不收地址）</span>
          <input v-model="query" type="search" enterkeyhint="search" autocomplete="off" class="tp-field h-16" placeholder="輸入地點，例如台大醫院" @keydown.enter.prevent="runSearch(query)" />
        </label>
        <button v-if="voiceOk" type="button" class="tp-icon-btn size-16 shrink-0 rounded-tp bg-primary-500 text-on-primary" aria-label="用講的" @click="listen">
          <Mic class="size-8" aria-hidden="true" />
        </button>
      </div>

      <div class="flex flex-wrap gap-3">
        <button v-for="c in CATEGORY_CHIPS" :key="c.label" type="button" class="tp-btn-outline w-auto px-5" @click="chip(c.query)">{{ c.label }}</button>
        <button type="button" class="tp-btn-outline w-auto px-5" @click="goHome()">回家</button>
      </div>
      <p v-if="homeMsg" role="status" class="text-body font-semibold">{{ homeMsg }}</p>
    </div>

    <section v-if="shown.length || (searched && !hits.length)" aria-label="找到的地點" class="space-y-3">
      <ul v-if="shown.length" class="space-y-3">
        <li v-for="h in shown" :key="h.id">
          <button
            type="button"
            class="flex min-h-16 w-full items-center gap-3 rounded-tp border-2 px-4 py-3 text-left"
            :class="picked?.id === h.id ? 'border-primary-800 bg-primary-50' : 'border-grayscale-500 bg-white'"
            :aria-pressed="picked?.id === h.id"
            @click="chooseHit(h)"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-title font-semibold">{{ h.name }}</span>
              <span class="block text-body text-grayscale-800">{{ h.sub }}</span>
            </span>
            <Check v-if="picked?.id === h.id" class="size-7 shrink-0 text-primary-800" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <p v-else role="status" class="text-body text-grayscale-800">找不到「{{ query }}」。換個說法，或按上面的分類。</p>
    </section>
    <p v-else-if="picked" class="text-title font-semibold">
      要去：{{ picked.name }}<span v-if="picked.sub" class="block text-body font-normal">{{ picked.sub }}</span>
    </p>

    <fieldset class="space-y-3">
      <legend class="tp-label mb-2">路上需要：</legend>
      <div class="flex flex-wrap gap-3">
        <button
          v-for="o in OPTIONS"
          :key="o.key"
          type="button"
          role="checkbox"
          :aria-checked="needs[o.key]"
          class="flex min-h-16 items-center gap-1 rounded-tp border-2 px-4 text-h3 font-semibold"
          :class="needs[o.key] ? 'border-primary-800 bg-primary-50' : 'border-grayscale-500 bg-white'"
          @click="toggleNeed(o.key)"
        >
          <Check v-if="needs[o.key]" class="size-6 shrink-0 text-primary-800" aria-hidden="true" /><span>{{ o.label }}</span>
        </button>
      </div>
    </fieldset>

    <div class="space-y-3">
      <button ref="originBtn" type="button" class="flex min-h-16 w-full items-center justify-between gap-3 rounded-tp px-1 text-left text-body" @click="go('#/pick/origin')">
        <span class="text-grayscale-800">
          <template v-if="origin">從 <strong class="text-grayscale-900">{{ short(origin) }}</strong> 出發</template>
          <template v-else>還沒選出發的車站</template>
        </span>
        <span class="flex items-center font-semibold text-primary-800 underline">{{ origin ? "改" : "選車站" }}<ChevronRight class="size-6" aria-hidden="true" /></span>
      </button>
      <p v-if="problem" role="alert" class="text-title font-semibold text-danger">{{ problem }}</p>
      <button type="button" class="tp-btn text-title" :disabled="loading" @click="submit">{{ loading ? "載入中…" : "查路線" }}</button>
    </div>
  </main>
  <ListeningSheet v-if="L.on" :state="L.state" :transcript="L.text" :hint="L.hint" @cancel="cancelListen" />
</template>
