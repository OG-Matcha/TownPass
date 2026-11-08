<script setup lang="ts">
// 第二層「走常走的路」：每條常走路線直接寫出今天能不能走，按「今天出發」就上路。
// 只有一條就只看那一條；沒有就說「走過一次就會記住」。
import { computed } from "vue";
import { ChevronRight, CircleCheck, TrainFront, TriangleAlert, X } from "lucide-vue-next";
import PageHeader from "@/components/PageHeader.vue";
import { departNow } from "@/lib/departNow";
import { resetGo } from "@/lib/goState";
import { go } from "@/lib/router";
import { checkRoute, date, dateChoice, dest, doPlan, fetchedAt, forgetRoute, loading, origin, savedRoutes, short } from "@/lib/planner";
import { showSnack } from "@/lib/snackbar";

const routes = computed(() => (loading.value ? [] : savedRoutes.value.slice(0, 3).map((r) => ({ ...r, check: checkRoute(r.origin, r.dest) }))));
function openRoute(o: string, d: string) {
  origin.value = o;
  dest.value = d;
  date.value = dateChoice(0);
  if (doPlan()) go("#/result");
}
// 一鍵出發：今天沒有保養就直接上路；有保養就到結果頁看警告
async function leaveToday(o: string, d: string) {
  const r = await departNow(o, d);
  if (r === "trip") go("#/trip");
  else if (r === "result") go("#/result");
}
function removeRoute(o: string, d: string) {
  const before = [...savedRoutes.value];
  forgetRoute(o, d);
  showSnack(`已移除 ${short(o)} → ${short(d)}`, () => (savedRoutes.value = before));
}
function toGo() {
  resetGo();
  go("#/go");
}
</script>

<template>
  <PageHeader title="走常走的路" />
  <main class="space-y-5 p-4 pb-12">
    <section v-if="savedRoutes.length" aria-label="常走的路線">
      <p v-if="loading" role="status" class="text-body">載入中…</p>
      <ul class="space-y-3">
        <li v-for="r in routes" :key="r.origin + r.dest" class="tp-card space-y-2 border-2" :class="r.check && !r.check.ok ? 'border-danger' : 'border-primary-500'">
          <button type="button" class="flex w-full items-start gap-3 text-left" @click="openRoute(r.origin, r.dest)">
            <span class="min-w-0 flex-1 space-y-1">
              <span class="block text-h3 font-semibold">{{ short(r.origin) }} → {{ short(r.dest) }}</span>
              <span v-if="r.check" class="flex items-start gap-2 text-title font-semibold" :class="r.check.ok ? 'text-ok' : 'text-danger'">
                <CircleCheck v-if="r.check.ok" class="mt-0.5 size-6 shrink-0" aria-hidden="true" />
                <TriangleAlert v-else class="mt-0.5 size-6 shrink-0" aria-hidden="true" />
                <span><span class="sr-only">{{ r.check.ok ? "沒問題：" : "注意：" }}</span>{{ r.check.today }}</span>
              </span>
              <span v-if="r.check?.upcoming" class="block text-body text-grayscale-800">接下來：{{ r.check.upcoming }}</span>
            </span>
            <ChevronRight class="mt-1 size-6 shrink-0 text-grayscale-700" aria-hidden="true" />
          </button>
          <button type="button" class="tp-btn text-title" :aria-label="`今天出發，${short(r.origin)} 到 ${short(r.dest)}`" @click="leaveToday(r.origin, r.dest)">
            <TrainFront class="size-6 shrink-0" aria-hidden="true" /><span>今天出發</span>
          </button>
          <button type="button" class="tp-link w-auto px-4 text-body" :aria-label="`從常走路線移除 ${short(r.origin)} 到 ${short(r.dest)}`" @click="removeRoute(r.origin, r.dest)">
            <X class="size-5 shrink-0" aria-hidden="true" /><span>移除</span>
          </button>
        </li>
      </ul>
      <p class="mt-3 text-caption text-grayscale-700">只看電梯預排保養與異常公告（資料 {{ fetchedAt ? fetchedAt.toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" }) : "載入中" }}），不含臨時故障。</p>
    </section>

    <section v-else class="space-y-4">
      <p class="text-title font-semibold">走過一次就會記住</p>
      <button type="button" class="tp-btn text-title" @click="toGo">去一個地方</button>
    </section>
  </main>
</template>
