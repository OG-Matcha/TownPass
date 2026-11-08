<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, shallowRef } from "vue";
import * as MapLibreGL from "maplibre-gl";
import type { PopupOptions } from "maplibre-gl";
import { useEventListener } from "@vueuse/core";
import { cn } from "@/lib/utils";
import { useMarkerContext } from "./composables/useMarker";

const props = defineProps<
  {
    class?: string;
  } & Omit<PopupOptions, "className" | "closeButton" | "closeOnClick">
>();

const { marker, map, isReady } = useMarkerContext();
const tooltipContainer = shallowRef<HTMLElement | null>(null);
const tooltipRef = shallowRef<MapLibreGL.Popup | null>(null);
const isAttached = ref(false);
const isVisible = ref(false);

onMounted(() => {
  if (!map.value) return;

  // Create a persistent container for the tooltip content
  const container = document.createElement("div");
  tooltipContainer.value = container;

  const tooltip = new MapLibreGL.Popup({
    ...props,
    offset: props.offset ?? 16,
    closeOnClick: true,
    closeButton: false,
  }).setMaxWidth("none");

  const handleMouseEnter = () => {
    try {
      const markerInstance = marker.value;
      if (markerInstance && map.value && tooltipContainer.value) {
        tooltip.setDOMContent(tooltipContainer.value);
        tooltip.setLngLat(markerInstance.getLngLat()).addTo(map.value);
        isVisible.value = true;
      }
    } catch {
      // Silently ignore if marker isn't ready
    }
  };

  const handleMouseLeave = () => {
    try {
      tooltip.remove();
      isVisible.value = false;
    } catch {
      // Silently ignore
    }
  };

  let stopWatching: (() => void) | null = null;

  // Wait for marker to be ready before attaching event listeners
  stopWatching = watch(
    isReady,
    (ready) => {
      if (ready && !isAttached.value) {
        try {
          const markerInstance = marker.value;
          const element = markerInstance?.getElement();
          if (element) {
            useEventListener(element, "mouseenter", handleMouseEnter);
            useEventListener(element, "mouseleave", handleMouseLeave);
            isAttached.value = true;
          }
        } catch {
          // Marker not ready yet, will try again on next watch
        }
        stopWatching?.();
      }
    },
    { immediate: true },
  );

  tooltipRef.value = tooltip;

  onUnmounted(() => {
    stopWatching?.();
    isVisible.value = false;
    try {
      tooltip.remove();
    } catch {
      // Ignore cleanup errors
    }
  });
});

// Watch for offset changes
watch(
  () => props.offset,
  (offset) => {
    if (tooltipRef.value?.isOpen()) {
      tooltipRef.value.setOffset(offset ?? 16);
    }
  },
);
</script>

<template>
  <!-- Use Teleport to render live reactive content into the tooltip container -->
  <Teleport v-if="tooltipContainer" :to="tooltipContainer">
    <div
      :class="
        cn(
          'rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md',
          props.class,
        )
      "
    >
      <slot />
    </div>
  </Teleport>
</template>
