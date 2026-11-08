<script setup lang="ts">
// 操作設定（二級入口）：主畫面只放一顆按鈕，點開才看到選項（漸進式揭露）。
// 不問「你是誰」，只問「現在哪裡不方便」：可以複選、隨時改（孕婦、手受傷、推輪椅的看護都是暫時的）。
import { onMounted, ref } from "vue";
import { Contrast, SlidersHorizontal, X } from "lucide-vue-next";
import { FONT_LEVELS, NEEDS, fontLevel, hand, has, highContrast, lang, needs, needsAsked, type Need } from "@/lib/settings";

// autoAsk：第一次打開首頁時直接問一次「你現在哪裡不方便？」，不用使用者自己找設定
const props = defineProps<{ autoAsk?: boolean; label?: string; text?: boolean }>();
const open = ref(false);
const firstRun = ref(false);
onMounted(() => {
  if (props.autoAsk && !needsAsked.value) (firstRun.value = true), (open.value = true);
});
function close() {
  open.value = false;
  firstRun.value = false;
  needsAsked.value = true;
}
function toggle(n: Need) {
  needs.value = has(n) ? needs.value.filter((x) => x !== n) : [...needs.value, n];
}
</script>

<template>
  <button type="button" :class="text ? 'tp-link' : 'tp-btn-outline w-auto'" aria-haspopup="dialog" @click="open = true">
    <SlidersHorizontal class="size-6 shrink-0" aria-hidden="true" />
    <span>{{ label ?? "字級・操作" }}</span>
  </button>

  <!-- 移到 body：放在 sticky 標題列裡時才不會被底部操作列蓋住 -->
  <Teleport to="body">
  <div v-if="open" class="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center" data-miss-ignore @click.self="close">
    <div role="dialog" aria-modal="true" aria-labelledby="settings-title" class="tp-sheet sm:mx-auto sm:max-w-xl sm:rounded-2xl">
      <div class="tp-sheet-handle" aria-hidden="true" />
      <div class="flex items-center gap-3">
        <h2 id="settings-title" class="flex-1 text-title font-semibold">{{ firstRun ? "你現在哪裡不方便？" : "字級與操作方式" }}</h2>
        <button type="button" class="tp-icon-btn -mr-3" aria-label="關閉" @click="close">
          <X class="size-7" aria-hidden="true" />
        </button>
      </div>

      <p v-if="firstRun" class="text-body text-grayscale-800">勾選後，路上的按法會跟著改。沒有不方便可以直接按「好了」，之後也能在「字級・操作」裡改。</p>
      <fieldset class="space-y-2">
        <legend class="tp-label">{{ firstRun ? "可以複選" : "現在哪裡不方便？（可以複選，隨時改）" }}</legend>
        <label v-for="n in NEEDS" :key="n.id" class="flex min-h-16 cursor-pointer items-center gap-4 rounded-tp border border-grayscale-500 px-4 py-2" :data-testid="`need-${n.id}`">
          <input type="checkbox" class="size-7 shrink-0 accent-primary-800" :checked="has(n.id)" @change="toggle(n.id)" />
          <span class="flex-1">
            <span class="block text-h3 font-semibold">{{ n.label }}</span>
            <span class="block text-body text-grayscale-700">{{ n.hint }}</span>
          </span>
        </label>
        <div v-if="has('oneHand')" role="radiogroup" aria-label="用哪一隻手" class="grid grid-cols-2 gap-4 pl-11">
          <button
            v-for="h in [{ id: 'left', label: '左手' }, { id: 'right', label: '右手' }] as const"
            :key="h.id"
            type="button"
            role="radio"
            class="min-h-16 rounded-tp border text-h3 font-semibold"
            :class="hand === h.id ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-grayscale-500 bg-white text-grayscale-800'"
            :aria-checked="hand === h.id"
            @click="hand = h.id"
          >
            {{ h.label }}
          </button>
        </div>
      </fieldset>

      <div role="radiogroup" aria-labelledby="font-label" class="space-y-2">
        <p id="font-label" class="tp-label">字的大小</p>
        <div class="grid grid-cols-3 gap-4">
          <button
            v-for="lv in FONT_LEVELS"
            :key="lv.id"
            type="button"
            role="radio"
            class="min-h-16 rounded-tp border font-semibold"
            :class="fontLevel === lv.id ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-grayscale-500 bg-white text-grayscale-800'"
            :style="{ fontSize: `${lv.px}px` }"
            :aria-checked="fontLevel === lv.id"
            @click="fontLevel = lv.id"
          >
            {{ lv.label }}
          </button>
        </div>
      </div>

      <label class="flex min-h-16 cursor-pointer items-center gap-4 rounded-tp border border-grayscale-500 px-4">
        <Contrast class="size-7 shrink-0" aria-hidden="true" />
        <span class="flex-1 text-h3 font-semibold">高對比模式</span>
        <input v-model="highContrast" type="checkbox" role="switch" class="size-7 accent-primary-800" />
      </label>

      <fieldset class="space-y-2">
        <legend class="tp-label">替人帶路時，路上的語言</legend>
        <div role="radiogroup" aria-label="路上的語言" class="grid grid-cols-2 gap-4">
          <button
            type="button"
            role="radio"
            class="min-h-16 rounded-tp border text-h3 font-semibold"
            :class="lang === 'zh' ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-grayscale-500 bg-white text-grayscale-800'"
            :aria-checked="lang === 'zh'"
            @click="lang = 'zh'"
          >
            中文
          </button>
          <button
            type="button"
            role="radio"
            lang="id"
            class="min-h-16 rounded-tp border text-h3 font-semibold"
            :class="lang === 'id' ? 'border-primary-500 bg-primary-500 text-on-primary' : 'border-grayscale-500 bg-white text-grayscale-800'"
            :aria-checked="lang === 'id'"
            @click="lang = 'id'"
          >
            Bahasa Indonesia
          </button>
        </div>
        <p class="text-body text-grayscale-700">給推輪椅的看護用。給站務人員看的求助卡維持中文。</p>
      </fieldset>

      <button type="button" class="tp-btn" @click="close">{{ firstRun ? "好了" : "完成" }}</button>
    </div>
  </div>
  </Teleport>
</template>
