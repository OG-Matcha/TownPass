<script setup lang="ts">
import { ref, watch, onUnmounted, provide, shallowRef, onMounted } from "vue";
import * as MapLibreGL from "maplibre-gl";
import type { MarkerOptions } from "maplibre-gl";
import { useMap } from "./composables/useMap";
import { MARKER_KEY, type MarkerContextValue } from "./constants";

const props = defineProps<
  {
    longitude: number;
    latitude: number;
    onClick?: (e: MouseEvent) => void;
    onMouseEnter?: (e: MouseEvent) => void;
    onMouseLeave?: (e: MouseEvent) => void;
    onDragStart?: (lngLat: { lng: number; lat: number }) => void;
    onDrag?: (lngLat: { lng: number; lat: number }) => void;
    onDragEnd?: (lngLat: { lng: number; lat: number }) => void;
    draggable?: boolean;
  } & Omit<MarkerOptions, "element">
>();

const { map, isLoaded } = useMap();
const markerRef = shallowRef<MapLibreGL.Marker | null>(null);
const elementRef = ref<HTMLDivElement>();
const isReady = ref(false);

// Provide marker context
const markerContext: MarkerContextValue = {
  marker: markerRef,
  map,
  isReady,
};
provide(MARKER_KEY, markerContext);

// Use indirection for event callbacks to avoid stale closures
function handleClick(e: MouseEvent) {
  props.onClick?.(e);
}
function handleMouseEnter(e: MouseEvent) {
  props.onMouseEnter?.(e);
}
function handleMouseLeave(e: MouseEvent) {
  props.onMouseLeave?.(e);
}

// Simple approach: create marker when mounted and map is ready
onMounted(() => {
  // Check immediately if map is ready
  if (map.value && isLoaded.value && elementRef.value) {
    createMarker();
  }
});

// Watch for map loaded state
watch(isLoaded, (loaded) => {
  if (loaded && map.value && elementRef.value && !markerRef.value) {
    createMarker();
  }
});

function createMarker() {
  if (!map.value || !elementRef.value || markerRef.value) return;

  const el = elementRef.value;

  // Build marker options from all supported MarkerOptions props
  const markerOptions: Partial<MarkerOptions> = {};
  if (props.anchor !== undefined) markerOptions.anchor = props.anchor;
  if (props.offset !== undefined) markerOptions.offset = props.offset;
  if (props.rotation !== undefined) markerOptions.rotation = props.rotation;
  if (props.rotationAlignment !== undefined)
    markerOptions.rotationAlignment = props.rotationAlignment;
  if (props.pitchAlignment !== undefined)
    markerOptions.pitchAlignment = props.pitchAlignment;
  if (props.clickTolerance !== undefined)
    markerOptions.clickTolerance = props.clickTolerance;
  if (props.color !== undefined) markerOptions.color = props.color;
  if (props.scale !== undefined) markerOptions.scale = props.scale;
  if (props.subpixelPositioning !== undefined)
    markerOptions.subpixelPositioning = props.subpixelPositioning;

  const marker = new MapLibreGL.Marker({
    ...markerOptions,
    element: el,
    draggable: props.draggable ?? false,
  }).setLngLat([props.longitude, props.latitude]);

  // Events - use indirection functions to always get latest callback
  el.addEventListener("click", handleClick);
  el.addEventListener("mouseenter", handleMouseEnter);
  el.addEventListener("mouseleave", handleMouseLeave);

  marker.on("dragstart", () => {
    const lngLat = marker.getLngLat();
    props.onDragStart?.({ lng: lngLat.lng, lat: lngLat.lat });
  });
  marker.on("drag", () => {
    const lngLat = marker.getLngLat();
    props.onDrag?.({ lng: lngLat.lng, lat: lngLat.lat });
  });
  marker.on("dragend", () => {
    const lngLat = marker.getLngLat();
    props.onDragEnd?.({ lng: lngLat.lng, lat: lngLat.lat });
  });

  // Animation - use opacity only, NOT transform (MapLibre uses transform for positioning)
  el.style.opacity = "0";
  el.style.transition = "opacity 300ms ease-out";

  // Add to map
  marker.addTo(map.value);
  markerRef.value = marker;

  // Animate in - only change opacity, never touch transform (MapLibre owns it)
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    isReady.value = true;
  });
}

// Watch for position changes
watch([() => props.longitude, () => props.latitude], ([lng, lat]) => {
  markerRef.value?.setLngLat([lng, lat]);
});

// Watch for draggable changes
watch(
  () => props.draggable,
  (draggable) => {
    markerRef.value?.setDraggable(draggable ?? false);
  },
);

// Watch for offset changes
watch(
  () => props.offset,
  (offset) => {
    if (markerRef.value && offset !== undefined) {
      markerRef.value.setOffset(offset);
    }
  },
);

// Watch for rotation changes
watch(
  () => props.rotation,
  (rotation) => {
    if (markerRef.value) {
      markerRef.value.setRotation(rotation ?? 0);
    }
  },
);

// Watch for rotationAlignment changes
watch(
  () => props.rotationAlignment,
  (alignment) => {
    if (markerRef.value) {
      markerRef.value.setRotationAlignment(alignment ?? "auto");
    }
  },
);

// Watch for pitchAlignment changes
watch(
  () => props.pitchAlignment,
  (alignment) => {
    if (markerRef.value) {
      markerRef.value.setPitchAlignment(alignment ?? "auto");
    }
  },
);

// Cleanup
onUnmounted(() => {
  if (elementRef.value) {
    elementRef.value.removeEventListener("click", handleClick);
    elementRef.value.removeEventListener("mouseenter", handleMouseEnter);
    elementRef.value.removeEventListener("mouseleave", handleMouseLeave);
  }
  if (markerRef.value) {
    markerRef.value.remove();
    markerRef.value = null;
  }
});
</script>

<template>
  <!--
    Stable anchor div: MapLibre's marker.addTo(map) reparents elementRef out of
    Vue's DOM tree via appendChild. Without this wrapper, Vue loses its reference
    for sibling insertBefore operations, causing "Child to insert before is not
    a child of this node" errors when conditional siblings mount/unmount.
    display:none keeps the anchor invisible; elementRef escapes it once reparented.
  -->
  <div style="display: none">
    <div ref="elementRef" class="relative cursor-pointer">
      <slot />
    </div>
  </div>
</template>
