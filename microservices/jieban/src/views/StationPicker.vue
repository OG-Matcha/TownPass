<script setup lang="ts">
// 選站（全螢幕）：搜尋站名或地點名、離我最近、最近使用、依路線分組。取代 119 站的原生下拉選單。
// 打地點名（例如「台大醫院」）→ 帶出離它最近的電梯／坡道出口，選了就用那一站。
import { computed, ref } from "vue";
import { LocateFixed, Search } from "lucide-vue-next";
import PageHeader from "@/components/PageHeader.vue";
import { back } from "@/lib/router";
import { currentPosition } from "@/lib/bridge";
import { LINE_COLOR, LINE_NAME, byLine, choosePlace, nearestStation, pickStation, recent, stations } from "@/lib/planner";
import { accessOf, searchPlaces, type Place } from "@/lib/places";
import type { Line } from "@/lib/route";

const props = defineProps<{ field: "origin" | "dest" }>();
const title = computed(() => (props.field === "origin" ? "從哪一站出發" : "要到哪一站"));
const q = ref("");
// 輸入「台大」「台北車站」「北車」都要找得到：去掉「站」、台/臺視為同字
const norm = (s: string) => s.replace(/站$/, "").replaceAll("臺", "台").trim();
const ALIAS: Record<string, string> = { 北車: "台北車站", 北門: "北門站" };
const matches = computed(() => {
  const k = norm(q.value);
  if (!k) return [];
  const alias = ALIAS[k];
  return stations.value.filter((s) => norm(s).includes(k) || s === alias).slice(0, 12);
});

const placeHits = computed(() => searchPlaces(q.value).map((p) => ({ p, acc: accessOf.value.get(p.id) ?? null })).filter((x) => x.acc));
function chooseP(p: Place, station: string) {
  if (props.field === "dest") choosePlace(p.id, station);
  else pickStation("origin", station);
  back();
}
function choose(s: string) {
  pickStation(props.field, s);
  back();
}

const locating = ref(false);
const nearMsg = ref("");
const near = ref<{ station: string; meters: number } | null>(null);
async function locate() {
  locating.value = true;
  nearMsg.value = "正在找你的位置…";
  const p = await currentPosition();
  locating.value = false;
  if (!p) {
    nearMsg.value = "拿不到位置。可以用上面的搜尋，或從下面的路線找。";
    return;
  }
  near.value = nearestStation(p.lat, p.lng);
  nearMsg.value = near.value ? "" : "附近找不到捷運站。";
}
const km = (m: number) => (m < 1000 ? `${m} 公尺` : `${(m / 1000).toFixed(1)} 公里`);
const LINES: Line[] = ["BR", "R", "G", "O", "BL", "Y"];
</script>

<template>
  <PageHeader :title="title" />
  <main class="space-y-6 p-4 pb-10">
    <label class="block">
      <span class="tp-label">打站名或地點找</span>
      <span class="relative block">
        <Search class="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-grayscale-700" aria-hidden="true" />
        <input v-model="q" class="tp-field pl-12" type="search" enterkeyhint="search" autocomplete="off" placeholder="例如：台大醫院" />
      </span>
    </label>

    <ul v-if="q" class="space-y-2" aria-label="搜尋結果">
      <li v-for="s in matches" :key="s">
        <button type="button" class="tp-btn-outline justify-start text-title" @click="choose(s)">{{ s }}</button>
      </li>
      <li v-for="h in placeHits" :key="h.p.id">
        <button type="button" class="tp-btn-outline h-auto flex-col items-start gap-1 py-3 text-left" @click="chooseP(h.p, h.acc!.station)">
          <span class="text-title font-semibold">{{ h.p.name }}</span>
          <span class="text-body font-normal">最近的無障礙出口：{{ h.acc!.station }} {{ h.acc!.exit }}（{{ h.acc!.kind === "elevator" ? "電梯" : "坡道" }}），直線約 {{ h.acc!.meters }} 公尺</span>
        </button>
      </li>
      <li v-if="!matches.length && !placeHits.length" class="text-body text-grayscale-700">找不到「{{ q }}」。試試少打幾個字，例如「台大」。</li>
    </ul>

    <template v-else>
      <section class="space-y-2" aria-labelledby="near-title">
        <h2 id="near-title" class="sr-only">離我最近</h2>
        <button v-if="!near" type="button" class="tp-btn-outline" :disabled="locating" @click="locate">
          <LocateFixed class="size-6 shrink-0" aria-hidden="true" />
          <span>{{ locating ? "找位置中…" : "用我的位置找最近的站" }}</span>
        </button>
        <button v-else type="button" class="tp-btn justify-between text-title" @click="choose(near.station)">
          <span>{{ near.station }}</span>
          <span class="text-body font-normal">離你約 {{ km(near.meters) }}</span>
        </button>
        <p v-if="nearMsg" role="status" class="text-body text-grayscale-700">{{ nearMsg }}</p>
      </section>

      <section v-if="recent.length" class="space-y-2" aria-labelledby="recent-title">
        <h2 id="recent-title" class="tp-label">最近用過</h2>
        <div class="flex flex-wrap gap-2">
          <button v-for="s in recent" :key="s" type="button" class="tp-btn-outline w-auto px-4" @click="choose(s)">{{ s }}</button>
        </div>
      </section>

      <section v-if="byLine" class="space-y-2" aria-labelledby="lines-title">
        <h2 id="lines-title" class="tp-label">依路線找</h2>
        <details v-for="l in LINES" :key="l" class="tp-card p-0">
          <summary class="flex min-h-16 cursor-pointer items-center gap-3 px-4 text-title font-semibold">
            <span class="h-8 w-2 shrink-0 rounded" :style="{ background: LINE_COLOR[l] }" aria-hidden="true" />
            {{ LINE_NAME[l] }}
          </summary>
          <ul class="grid grid-cols-2 gap-2 px-4 pb-4">
            <li v-for="s in byLine[l]" :key="s">
              <button type="button" class="tp-btn-outline px-2 text-body" @click="choose(s)">{{ s.replace(/站$/, "") }}</button>
            </li>
          </ul>
        </details>
      </section>
    </template>
  </main>
</template>
