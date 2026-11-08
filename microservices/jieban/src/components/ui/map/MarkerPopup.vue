<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef } from "vue";
import * as MapLibreGL from "maplibre-gl";
import type { PopupOptions } from "maplibre-gl";
import { X } from "lucide-vue-next";
import { cn } from "@/lib/utils";
import { useMarkerContext } from "./composables/useMarker";

const props = withDefaults(
  defineProps<
    {
      class?: string;
      closeButton?: boolean;
    } & Omit<PopupOptions, "className" | "closeButton">
  >(),
  {
    closeButton: false,
    offset: 16,
  },
);

const { marker, map, isReady } = useMarkerContext();
const containerRef = ref<HTMLDivElement>();
const popupRef = shallowRef<MapLibreGL.Popup | null>(null);

onMounted(() => {
  if (!map.value || !containerRef.value) return;

  const popup = new MapLibreGL.Popup({
    ...props,
    closeButton: false,
  })
    .setMaxWidth("none")
    .setDOMContent(containerRef.value);

  // Wait for marker to be ready before setting popup
  watch(
    isReady,
    (ready) => {
      if (ready && marker.value) {
        marker.value.setPopup(popup);
      }
    },
    { immediate: true },
  );

  popupRef.value = popup;

  onUnmounted(() => {
    if (marker.value) {
      marker.value.setPopup(null);
    }
    popup.remove();
  });
});

function handleClose() {
  popupRef.value?.remove();
}

// Watch for offset changes
watch(
  () => props.offset,
  (offset) => {
    if (popupRef.value?.isOpen()) {
      popupRef.value.setOffset(offset ?? 16);
    }
  },
);
</script>

<template>
  <div ref="containerRef" class="contents">
    <div
      :class="
        cn(
          'relative rounded-md border bg-popover p-3 text-popover-foreground shadow-md',
          props.class,
        )
      "
    >
      <button
        v-if="closeButton"
        type="button"
        class="absolute top-1 right-1 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        aria-label="Close popup"
        @click="handleClose"
      >
        <X class="h-4 w-4" />
        <span class="sr-only">Close</span>
      </button>
      <slot />
    </div>
  </div>
</template>
