<script setup lang="ts">
// 電梯動線示意圖：地面 → 大廳 → 無障礙閘門 → 月臺電梯 → 月臺，底下是要上的車廂。
// 全部資料來自開放資料的動線字串；沒有的設施不畫。示意圖，不按比例。
// 家長元件接 @speak 事件去呼叫語音（這裡不直接發聲）。
import { computed } from "vue";
import { ArrowDown, ArrowUpDown, DoorOpen, Footprints, Headset, TrainFront, Volume2 } from "lucide-vue-next";
import { carNumbers, parsePath, pathSentence } from "@/lib/elevatorPath";
import { LINE_COLOR } from "@/lib/planner";
import type { Line } from "@/lib/route";

const props = defineProps<{
  path: string | null | undefined; // facilities.path
  leaving?: boolean; // true = 出站（由月臺往上走；圖一樣由上往下，月臺在最上面）
  station?: string;
  exitName?: string; // 例：「出口3」
  gate?: string | null; // facilities.gate（詢問處位置）
  cars?: string | null; // 輪椅停靠車廂，例「第1節、第6節車廂」
  door?: string | null; // 開門側，例「左側開門」
  line?: Line;
  speakable?: boolean; // 傳 false 隱藏「唸給我聽」
}>();
const emit = defineEmits<{ speak: [text: string] }>();

const nodes = computed(() => parsePath(props.path));
const sentence = computed(() =>
  pathSentence({ nodes: nodes.value, leaving: !!props.leaving, station: props.station, exitName: props.exitName, gate: props.gate, cars: props.cars, door: props.door }),
);
const color = computed(() => (props.line ? LINE_COLOR[props.line] : "#5ab4c5"));
const darkOnLine = computed(() => ["O", "Y", "BR"].includes(props.line ?? "") || !props.line);
const hl = computed(() => carNumbers(props.cars));
const cars = computed(() => Array.from({ length: Math.max(4, ...hl.value) }, (_, i) => i + 1));
// 進站、出站都由上往下照走的順序畫：出站把月臺放最上面
const shown = computed(() => (props.leaving ? [...nodes.value].reverse() : nodes.value));
const stepNo = (i: number) => i + 1;
const hasDesk = computed(() => !!props.gate && /詢問/.test(props.gate));
const nodeStyle = (kind: string) =>
  kind === "platform"
    ? { background: color.value, color: darkOnLine.value ? "#171b1d" : "#ffffff" }
    : { background: kind === "ground" ? "#ffffff" : "#edf8fa", color: "#171b1d" };
</script>

<template>
  <section v-if="nodes.length" class="space-y-3 rounded-card border-2 border-grayscale-300 bg-white p-4" data-testid="elevator-path">
    <h3 class="flex flex-wrap items-center gap-2 text-title font-semibold text-grayscale-900">
      {{ leaving ? "出站" : "進站" }}電梯動線
      <span class="rounded bg-grayscale-100 px-2 py-0.5 text-body font-normal text-grayscale-800">示意圖</span>
    </h3>

    <div role="img" :aria-label="sentence" class="space-y-3">
      <ol class="m-0 list-none p-0" aria-hidden="true">
        <li v-for="(n, i) in shown" :key="i" class="relative flex min-h-24 gap-3 pb-3 last:min-h-16 last:pb-0">
          <div class="relative w-14 shrink-0">
            <svg v-if="i < shown.length - 1" class="absolute top-7 left-0 h-[calc(100%-0.5rem)] w-14" viewBox="0 0 56 100" preserveAspectRatio="none">
              <line x1="28" y1="0" x2="28" y2="100" :stroke="color" stroke-width="6" stroke-linecap="round" />
            </svg>
            <span class="relative z-10 flex size-14 items-center justify-center rounded-full border-4 border-white shadow-[0_0_0_2px_#475259]" :style="nodeStyle(n.kind)">
              <ArrowUpDown v-if="n.kind === 'elevator'" class="size-8" />
              <DoorOpen v-else-if="n.kind === 'gate'" class="size-8" />
              <TrainFront v-else-if="n.kind === 'platform'" class="size-8" />
              <Footprints v-else class="size-8" />
            </span>
            <ArrowDown v-if="i < shown.length - 1" class="absolute bottom-3 left-4 z-10 size-6 rounded-full bg-white text-grayscale-900" :stroke-width="4" />
          </div>
          <div class="min-w-0 flex-1 pt-1">
            <p class="text-body text-grayscale-700">
              <span class="mr-1 inline-flex size-6 items-center justify-center rounded-full bg-grayscale-900 text-caption font-bold text-white">{{ stepNo(i) }}</span>{{ leaving && n.level === "往月臺" ? "往大廳" : n.level }}
            </p>
            <p class="text-h3 font-semibold text-grayscale-900">{{ n.kind === "ground" && exitName ? exitName : n.label }}</p>
            <p v-if="n.kind === 'gate' && gate" class="flex items-center gap-1 text-body text-grayscale-800"><Headset v-if="hasDesk" class="size-5 shrink-0 text-primary-800" />{{ gate }}</p>
            <p v-if="n.note" class="text-body text-danger">{{ n.note }}</p>
          </div>
        </li>
      </ol>

      <div v-if="hl.length" class="space-y-1 rounded-tp bg-grayscale-50 p-3" aria-hidden="true">
        <p class="text-body font-semibold text-grayscale-900">輪椅請到這幾節車廂<span v-if="door">（{{ door }}）</span></p>
        <div class="flex gap-1">
          <span v-for="c in cars" :key="c" class="flex min-h-12 flex-1 items-center justify-center rounded-md border-2 text-body font-bold" :class="hl.includes(c) ? 'border-grayscale-900 text-grayscale-900' : 'border-grayscale-300 bg-white text-grayscale-600'" :style="hl.includes(c) ? { background: '#f5ba4b' } : undefined">{{ c }}</span>
        </div>
        <p class="text-caption text-grayscale-700">黃色是輪椅停靠車廂；節數與長度為示意，以月臺標示為準。</p>
      </div>
    </div>

    <button v-if="speakable !== false" type="button" class="tp-btn-outline" data-testid="elevator-path-speak" @click="emit('speak', sentence)">
      <Volume2 class="size-6 shrink-0" aria-hidden="true" /><span>唸給我聽</span>
    </button>
  </section>
</template>
