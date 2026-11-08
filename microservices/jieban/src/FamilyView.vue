<script setup lang="ts">
// 家人頁：不用裝 App，打開連結就能看。只顯示到哪一站與狀態。
import { computed, onUnmounted, ref } from "vue";
import { familySummary, familyView, type Trip } from "@/lib/trip.ts";
import { POLL_MS, watchTrip } from "@/lib/tripStore.ts";
import "@/lib/settings"; // 套用同一台裝置的字級與高對比設定
import { Check } from "lucide-vue-next";
import CallButton from "@/components/CallButton.vue";

const props = defineProps<{ id: string }>();
const trip = ref<Trip | null>(null);
const loaded = ref(false);
const nowTs = ref(Date.now());
const lastOk = ref(0); // 最近一次成功讀到的時間
const netFail = ref(false);
const stop = watchTrip(
  props.id,
  (t) => {
    trip.value = t;
    loaded.value = true;
    netFail.value = false;
    lastOk.value = Date.now();
    nowTs.value = Date.now();
  },
  () => {
    // 網路錯誤：保留上次的狀態，不要變成「找不到」
    netFail.value = true;
    loaded.value = true;
    nowTs.value = Date.now();
  },
);
const clock = setInterval(() => (nowTs.value = Date.now()), POLL_MS);
onUnmounted(() => {
  stop();
  clearInterval(clock);
});

const summary = computed(() => (trip.value ? familySummary(familyView(trip.value, nowTs.value), nowTs.value) : null));
const toneClass = computed(
  () =>
    ({
      ok: "border-primary-600",
      warn: "border-secondary-700 bg-secondary-50",
      alert: "border-red-600 bg-red-50",
      done: "border-ok",
    })[summary.value?.tone ?? "ok"],
);
const time = (ms: number) => new Date(ms).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-xl flex-col">
    <header class="sticky top-0 z-10 flex min-h-14 items-center justify-center bg-primary-500 px-4">
      <h1 class="text-center text-h3 font-semibold text-on-primary">家人的捷運行程</h1>
    </header>
    <main class="flex-1 space-y-4 p-4">
      <p v-if="!loaded" role="status" class="tp-card">載入中…</p>
      <p v-else-if="!trip && netFail" role="status" class="tp-card text-h3">網路不穩，還沒有讀到行程，會自動再試。</p>
      <p v-else-if="!trip" role="status" class="tp-card text-h3">找不到這個行程，可能已經結束或連結過期。</p>
      <template v-else>
        <p v-if="netFail" role="status" class="tp-card border-2 border-secondary-700 bg-secondary-50 text-body font-semibold">網路不穩，顯示的是 {{ time(lastOk || trip.updatedAt) }} 的狀態</p>
        <section role="status" aria-live="polite" class="tp-card space-y-2 border-2" :class="toneClass">
          <h2 class="text-title font-semibold">{{ trip.name }}：{{ trip.origin }} → {{ trip.dest }}</h2>
          <p class="text-h3 font-semibold" :class="summary?.tone === 'alert' ? 'text-red-700' : ''">{{ summary?.text }}</p>
          <p class="text-caption text-grayscale-700">最後更新 {{ time(trip.updatedAt) }}・每 15 秒自動更新</p>
        </section>

        <section v-if="summary?.tone === 'alert'" class="tp-card space-y-4">
          <h2 class="text-h3 font-semibold">可以怎麼幫</h2>
          <p class="text-body">先打電話給{{ trip.name }}確認狀況；聯絡不上可以請北捷客服通知站務人員。</p>
          <CallButton tel="0225363001" label="北捷客服" display="02-2536-3001" variant="solid" />
        </section>

        <section class="tp-card" aria-labelledby="tl">
          <h2 id="tl" class="mb-2 text-h3 font-semibold">行程</h2>
          <ol class="space-y-2">
            <li v-for="(m, i) in trip.milestones" :key="i" class="flex items-start gap-3">
              <span
                class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold"
                :class="i < trip.reached ? 'bg-primary-500 text-on-primary' : 'border border-grayscale-500 text-grayscale-700'"
                :aria-label="i < trip.reached ? '已到' : '未到'"
                ><Check v-if="i < trip.reached" class="size-5" aria-hidden="true" /><template v-else>{{ i + 1 }}</template></span
              >
              <span class="text-body">{{ m.label }}<span class="text-grayscale-700">・預計 {{ time(m.expectedAt) }}</span></span>
            </li>
          </ol>
        </section>
      </template>
    </main>
    <footer class="px-4 pb-6 text-caption text-grayscale-700">只分享車站，不分享定位；行程結束或 6 小時後連結失效。</footer>
  </div>
</template>
