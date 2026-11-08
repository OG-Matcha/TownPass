<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import {
  ref,
  shallowRef,
  computed,
  watch,
  onMounted,
  onUnmounted,
  provide,
  useAttrs,
  type ShallowRef,
} from "vue";
import * as MapLibreGL from "maplibre-gl";
import type {
  MapOptions,
  ProjectionSpecification,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre GL v6 is ESM-only and loads its renderer worker as a separate
// module (`maplibre-gl-worker.mjs`). With a bundler, `import.meta.url` inside
// the dependency doesn't resolve to the emitted worker chunk, so the worker
// must be registered explicitly once. Vite turns this `?worker&url` import into
// a hashed, correctly-served worker URL. Without it the worker 404s (served as
// index.html) and the map renders its chrome but no tiles — a blank map.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { cn } from "@/lib/utils";
import { MAP_KEY } from "./constants";
import { NLSC_LIGHT } from "@/map/basemaps";
import { useResolvedTheme } from "./composables/useResolvedTheme";

MapLibreGL.setWorkerUrl(maplibreWorkerUrl);

export interface MapViewport {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export type MapStyleOption = string | StyleSpecification;
export type Theme = "light" | "dark";

export type { MapContextValue } from "./constants";

const props = withDefaults(
  defineProps<{
    class?: string;
    theme?: Theme;
    styles?: { light?: MapStyleOption; dark?: MapStyleOption };
    projection?: ProjectionSpecification;
    viewport?: Partial<MapViewport>;
    onViewportChange?: (viewport: MapViewport) => void;
    /** Initial center coordinates [longitude, latitude] */
    center?: [number, number];
    /** Initial zoom level */
    zoom?: number;
    /** Initial bearing in degrees */
    bearing?: number;
    /** Initial pitch in degrees */
    pitch?: number;
    /** Min zoom level */
    minZoom?: number;
    /** Max zoom level */
    maxZoom?: number;
    /** Min pitch in degrees */
    minPitch?: number;
    /** Max pitch in degrees */
    maxPitch?: number;
    /** Max bounds [[sw_lng, sw_lat], [ne_lng, ne_lat]] */
    maxBounds?: MapLibreGL.LngLatBoundsLike;
    /** Duration of fade animations in ms */
    fadeDuration?: number;
  }>(),
  {
    class: "",
  },
);

const emit = defineEmits<{
  load: [];
}>();

// Prevent declared props from falling through as attrs
defineOptions({
  inheritAttrs: false,
});

const _attrs = useAttrs();

// Modified for codefest2026: default to NLSC basemap instead of CARTO
// (CARTO commercial use needs a license; competition requires open map data).
const defaultStyles = {
  dark: NLSC_LIGHT,
  light: NLSC_LIGHT,
};

const containerRef = ref<HTMLDivElement>();
const mapInstance = shallowRef<MapLibreGL.Map | null>(null);
const isLoaded = ref(false);
const isStyleLoaded = ref(false);
const hasRendered = ref(false);
const currentStyleRef = ref<MapStyleOption | null>(null);
let styleTimeout: ReturnType<typeof setTimeout> | null = null;
let internalUpdate = false;

const themePropRef = computed(() => props.theme);
const resolvedTheme = useResolvedTheme(themePropRef);

const isControlled = computed(
  () => props.viewport !== undefined && props.onViewportChange !== undefined,
);

const mapStyles = computed(() => ({
  dark: props.styles?.dark ?? defaultStyles.dark,
  light: props.styles?.light ?? defaultStyles.light,
}));

function getViewport(map: MapLibreGL.Map): MapViewport {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function clearStyleTimeout() {
  if (styleTimeout) {
    clearTimeout(styleTimeout);
    styleTimeout = null;
  }
}

// Provide map context - combine isLoaded AND isStyleLoaded for children
provide(MAP_KEY, {
  map: mapInstance as ShallowRef<MapLibreGL.Map | null>,
  isLoaded: isLoaded,
  isStyleLoaded: isStyleLoaded,
  hasRendered: hasRendered,
});

// Expose map instance
defineExpose({
  getMap: () => mapInstance.value,
});

onMounted(() => {
  if (!containerRef.value) return;

  const initialStyle =
    resolvedTheme.value === "dark"
      ? mapStyles.value.dark
      : mapStyles.value.light;
  currentStyleRef.value = initialStyle;

  // Build MapLibre options from direct props + viewport + any extra attrs
  const maplibreOptions: Partial<MapOptions> = {};

  // Apply direct props (shorthand API)
  if (props.center !== undefined) maplibreOptions.center = props.center;
  if (props.zoom !== undefined) maplibreOptions.zoom = props.zoom;
  if (props.bearing !== undefined) maplibreOptions.bearing = props.bearing;
  if (props.pitch !== undefined) maplibreOptions.pitch = props.pitch;
  if (props.minZoom !== undefined) maplibreOptions.minZoom = props.minZoom;
  if (props.maxZoom !== undefined) maplibreOptions.maxZoom = props.maxZoom;
  if (props.minPitch !== undefined) maplibreOptions.minPitch = props.minPitch;
  if (props.maxPitch !== undefined) maplibreOptions.maxPitch = props.maxPitch;
  if (props.maxBounds !== undefined)
    maplibreOptions.maxBounds = props.maxBounds;
  if (props.fadeDuration !== undefined)
    maplibreOptions.fadeDuration = props.fadeDuration;

  const map = new MapLibreGL.Map({
    container: containerRef.value,
    style: initialStyle,
    renderWorldCopies: false,
    attributionControl: {
      compact: true,
    },
    canvasContextAttributes: { preserveDrawingBuffer: true },
    ...maplibreOptions,
    // Viewport prop overrides direct props (for controlled mode)
    ...props.viewport,
  } as MapOptions);

  const styleDataHandler = () => {
    clearStyleTimeout();
    styleTimeout = setTimeout(() => {
      isStyleLoaded.value = true;
      if (props.projection) {
        map.setProjection(props.projection);
      }
    }, 100);
  };

  const loadHandler = () => {
    isLoaded.value = true;
    emit("load");
  };

  const renderHandler = () => {
    hasRendered.value = true;
  };

  const handleMove = () => {
    if (internalUpdate) return;
    props.onViewportChange?.(getViewport(map));
  };

  map.on("load", loadHandler);
  map.on("styledata", styleDataHandler);
  map.on("move", handleMove);
  map.on("render", renderHandler);

  // MapLibre v6 restores lost WebGL contexts itself (style snapshot +
  // rebuild); custom layers such as deck.gl re-add on the next styledata.
  mapInstance.value = map;

  // ResizeObserver for responsive map sizing
  const resizeObserver = new ResizeObserver(() => {
    if (mapInstance.value) {
      mapInstance.value.resize();
    }
  });
  resizeObserver.observe(containerRef.value);

  onUnmounted(() => {
    resizeObserver.disconnect();
    clearStyleTimeout();
    map.off("load", loadHandler);
    map.off("styledata", styleDataHandler);
    map.off("move", handleMove);
    map.off("render", renderHandler);
    map.remove();
    mapInstance.value = null;
    isLoaded.value = false;
    isStyleLoaded.value = false;
  });
});

// Watch for controlled viewport changes - use jumpTo (synchronous) to avoid feedback loops
watch(
  () => props.viewport,
  (viewport) => {
    if (!mapInstance.value || !isControlled.value || !viewport) return;
    if (mapInstance.value.isMoving()) return;

    const current = getViewport(mapInstance.value);
    const next = {
      center: viewport.center ?? current.center,
      zoom: viewport.zoom ?? current.zoom,
      bearing: viewport.bearing ?? current.bearing,
      pitch: viewport.pitch ?? current.pitch,
    };

    if (
      next.center[0] === current.center[0] &&
      next.center[1] === current.center[1] &&
      next.zoom === current.zoom &&
      next.bearing === current.bearing &&
      next.pitch === current.pitch
    ) {
      return;
    }

    internalUpdate = true;
    mapInstance.value.jumpTo(next);
    internalUpdate = false;
  },
  { deep: true },
);

// Watch for theme changes
watch(resolvedTheme, (theme) => {
  if (!mapInstance.value || !theme) return;

  const newStyle =
    theme === "dark" ? mapStyles.value.dark : mapStyles.value.light;

  if (currentStyleRef.value === newStyle) return;

  clearStyleTimeout();
  currentStyleRef.value = newStyle;
  isStyleLoaded.value = false;

  mapInstance.value.setStyle(newStyle, { diff: true });
});

// Watch for style prop changes (for dynamic style switching)
watch(
  () => props.styles,
  (newStyles) => {
    if (!mapInstance.value || !resolvedTheme.value) return;

    const theme = resolvedTheme.value;
    const newStyle =
      theme === "dark"
        ? (newStyles?.dark ?? defaultStyles.dark)
        : (newStyles?.light ?? defaultStyles.light);

    if (currentStyleRef.value === newStyle) return;

    clearStyleTimeout();
    currentStyleRef.value = newStyle;
    isStyleLoaded.value = false;

    mapInstance.value.setStyle(newStyle, { diff: true });
  },
  { deep: true },
);
</script>

<template>
  <div ref="containerRef" :class="cn('relative w-full h-full', props.class)">
    <div
      v-if="!isLoaded"
      class="absolute inset-0 flex items-center justify-center bg-muted/10"
    >
      <div class="flex gap-1">
        <span
          class="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse"
        />
        <span
          class="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse [animation-delay:150ms]"
        />
        <span
          class="size-1.5 rounded-full bg-muted-foreground/60 animate-pulse [animation-delay:300ms]"
        />
      </div>
    </div>
    <!-- Only render slot when map is fully loaded and style is ready -->
    <slot v-if="isLoaded && isStyleLoaded" />
  </div>
</template>
