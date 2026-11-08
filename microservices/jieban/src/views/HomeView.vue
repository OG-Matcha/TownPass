<script setup lang="ts">
// 首頁：先分流「你要做什麼」，不問障別。兩顆大按鈕，各帶一行關鍵資訊。
// 去一個地方 → #/go；走常走的路 → #/often（最常走那條今天能不能走，直接寫在按鈕上）。
import { computed } from "vue";
import { CircleCheck, Repeat, Search, TriangleAlert } from "lucide-vue-next";
import DisplaySettings from "@/components/DisplaySettings.vue";
import { resetGo } from "@/lib/goState";
import { go } from "@/lib/router";
import { checkRoute, fetchedAt, loadData, loadError, loading, savedRoutes, short } from "@/lib/planner";

const top = computed(() => {
  const r = savedRoutes.value[0];
  if (!r) return null;
  let home = "";
  try {
    home = localStorage.getItem("homeStation") ?? "";
  } catch {}
  return { label: r.dest === home ? "回家" : `去${short(r.dest)}`, check: loading.value ? null : checkRoute(r.origin, r.dest) };
});
function toGo() {
  resetGo();
  go("#/go");
}
</script>

<template>
  <main class="flex min-h-dvh flex-col space-y-6 p-4 pb-6">
    <div class="-mx-4 -mt-4 bg-primary-500 px-4 py-3 text-on-primary">
      <p class="text-title font-semibold">捷伴</p>
    </div>

    <h1 class="text-h2 font-semibold">今天要去哪裡？</h1>

    <div v-if="loadError" role="alert" class="tp-card space-y-3 border-2 border-danger">
      <p class="text-body font-semibold text-danger">{{ loadError }}</p>
      <button type="button" class="tp-btn-outline" @click="loadData">重新載入</button>
    </div>

    <div class="space-y-4">
      <button type="button" class="flex min-h-32 w-full items-center gap-4 rounded-tp bg-primary-500 px-5 py-4 text-left text-on-primary" @click="toGo">
        <Search class="size-10 shrink-0" aria-hidden="true" />
        <span class="min-w-0 space-y-1">
          <span class="block text-h2 font-semibold">去一個地方</span>
          <span class="block text-title">醫院、公園、區公所</span>
        </span>
      </button>

      <button
        type="button"
        class="flex min-h-32 w-full items-center gap-4 rounded-tp border-2 bg-white px-5 py-4 text-left"
        :class="top?.check && !top.check.ok ? 'border-danger' : 'border-primary-500'"
        @click="go('#/often')"
      >
        <Repeat class="size-10 shrink-0 text-primary-800" aria-hidden="true" />
        <span class="min-w-0 space-y-1">
          <span class="block text-h2 font-semibold">走常走的路</span>
          <span v-if="!top" class="block text-title text-grayscale-800">走過一次就會記住</span>
          <span v-else class="flex items-start gap-2 text-title" :class="!top.check ? 'text-grayscale-800' : top.check.ok ? 'text-ok' : 'text-danger'">
            <template v-if="top.check">
              <CircleCheck v-if="top.check.ok" class="mt-0.5 size-6 shrink-0" aria-hidden="true" />
              <TriangleAlert v-else class="mt-0.5 size-6 shrink-0" aria-hidden="true" />
              <span>{{ top.label }}・{{ top.check.ok ? "今天可以走" : "今天要注意" }}</span>
            </template>
            <span v-else>{{ top.label }}・查看中…</span>
          </span>
        </span>
      </button>
    </div>

    <details class="px-1 text-caption text-grayscale-700">
      <summary class="flex min-h-16 cursor-pointer items-center font-semibold">資料來源與更新時間</summary>
      <div class="space-y-1 pb-4">
        <p>資料時間：{{ fetchedAt ? fetchedAt.toLocaleString("zh-TW") : "載入中" }}（打包在服務裡，斷網也能查）</p>
        <p>臺北市資料大平臺：臺北捷運出入口無障礙電梯與坡道座標、電梯維修預排時程表、車站無障礙設施、無障礙設施異常公告、相鄰兩站行駛時間、轉乘步行時間。</p>
        <p>電梯保養是「預定排程」，不含臨時故障，實際以車站現場公告為準。不需要登入、不問身分，路線只記在這支手機。</p>
        <p>底圖：內政部國土測繪中心｜地圖元件：mapcn-vue（MIT）｜圖示：Lucide（ISC）</p>
      </div>
    </details>

    <div class="mt-auto flex justify-center pt-4">
      <DisplaySettings text label="字級・語言" />
    </div>
  </main>
</template>
