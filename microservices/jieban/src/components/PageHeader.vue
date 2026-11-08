<script setup lang="ts">
// 次級畫面頂部＋畫面標題。進畫面時把焦點放在標題，讀屏會先念「現在在哪一頁」。
// 一般瀏覽器：青綠標題列＋看得見的返回鍵（城市通進階無障礙規範：不只靠系統返回手勢）。
// 城市通 App 裡：App 自己已有青綠標題列（返回＝網頁上一頁、關閉）→ 這裡改成白底「頁面標題列」，不再放第二個返回，
//   避免兩條同色標題列、兩個返回。例外：直接被帶進這頁（沒有上一頁，App 不顯示返回）時，給一個「回首頁」。
import { computed, onMounted, ref } from "vue";
import { ChevronLeft, House } from "lucide-vue-next";
import { back, go } from "@/lib/router";
import { inTownPass } from "@/lib/bridge";

defineProps<{ title: string; backLabel?: string }>();
const h = ref<HTMLElement | null>(null);
onMounted(() => h.value?.focus({ preventScroll: true }));
const inApp = inTownPass();
const noHistory = computed(() => ((history.state as { depth?: number } | null)?.depth ?? 0) === 0);
</script>

<template>
  <header
    v-if="inApp"
    class="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-grayscale-200 bg-white px-4 text-grayscale-900"
  >
    <h1 ref="h" tabindex="-1" class="flex-1 truncate text-title font-semibold outline-none">{{ title }}</h1>
    <button v-if="noHistory" type="button" class="flex min-h-12 items-center gap-1 px-2 text-body font-semibold text-primary-800" @click="go('#/')">
      <House class="size-5 shrink-0" aria-hidden="true" />回首頁
    </button>
    <slot />
  </header>
  <header v-else class="sticky top-0 z-20 flex min-h-16 items-center gap-1 bg-primary-500 pr-4 text-on-primary">
    <button type="button" class="flex min-h-16 min-w-16 items-center gap-1 pr-3 pl-2 text-body font-semibold" @click="back">
      <ChevronLeft class="size-7 shrink-0" aria-hidden="true" />
      <span>{{ backLabel ?? "返回" }}</span>
    </button>
    <h1 ref="h" tabindex="-1" class="flex-1 truncate text-title font-semibold outline-none">{{ title }}</h1>
    <slot />
  </header>
</template>
