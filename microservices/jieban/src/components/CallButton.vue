<script setup lang="ts">
// 撥號按鈕：先跳滑動確認，避免誤撥（城市通無障礙規範：撥號專線屬高風險操作）
import { ref } from "vue";
import { Phone } from "lucide-vue-next";
import SlideConfirm from "./SlideConfirm.vue";
import { callPhone } from "@/lib/bridge";

const props = defineProps<{ tel: string; label: string; display: string; variant?: "solid" | "outline" | "link" }>();
const open = ref(false);
function call() {
  open.value = false;
  callPhone(props.tel); // App 內走 phone_call handler（WebView 不處理 tel:）
}
</script>

<template>
  <button
    type="button"
    :class="props.variant === 'link' ? 'tp-link' : props.variant === 'solid' ? 'tp-btn' : 'tp-btn-outline'"
    @click="open = true"
  >
    <Phone class="size-6 shrink-0" aria-hidden="true" />
    <span>{{ props.label }}</span>
  </button>
  <SlideConfirm
    v-if="open"
    :title="`要撥打${props.label}嗎？`"
    :detail="props.display"
    action-label="撥打"
    @confirm="call"
    @cancel="open = false"
  />
</template>
