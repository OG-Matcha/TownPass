<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { Plus, Minus, Locate, Maximize, Loader2 } from "lucide-vue-next";
import { cn } from "@/lib/utils";
import { useMap } from "./composables/useMap";

const props = withDefaults(
  defineProps<{
    position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    showZoom?: boolean;
    showCompass?: boolean;
    showLocate?: boolean;
    showFullscreen?: boolean;
    class?: string;
    onLocate?: (coords: { longitude: number; latitude: number }) => void;
  }>(),
  {
    position: "bottom-right",
    showZoom: true,
    showCompass: false,
    showLocate: false,
    showFullscreen: false,
  },
);

const { map, isLoaded } = useMap();
const waitingForLocation = ref(false);

// Compass rotation state
const bearing = ref(0);
const pitch = ref(0);

let cleanupCompass: (() => void) | null = null;

// Update compass rotation when map moves
const stopWatch = watch(
  () => isLoaded.value,
  (loaded) => {
    if (!loaded || !map.value) return;

    const updateRotation = () => {
      if (!map.value) return;
      bearing.value = map.value.getBearing();
      pitch.value = map.value.getPitch();
    };

    map.value.on("move", updateRotation);
    updateRotation(); // Initial value

    cleanupCompass = () => {
      map.value?.off("move", updateRotation);
    };
  },
  { immediate: true },
);

onUnmounted(() => {
  stopWatch();
  if (cleanupCompass) {
    cleanupCompass();
  }
});

const positionClasses = {
  "top-left": "top-2 left-2",
  "top-right": "top-2 right-2",
  "bottom-left": "bottom-2 left-2",
  "bottom-right": "bottom-10 right-2",
};

function handleZoomIn() {
  map.value?.zoomTo(map.value.getZoom() + 1, { duration: 300 });
}

function handleZoomOut() {
  map.value?.zoomTo(map.value.getZoom() - 1, { duration: 300 });
}

function handleResetBearing() {
  map.value?.resetNorthPitch({ duration: 300 });
}

const locationError = ref<string | null>(null);

function handleLocate() {
  waitingForLocation.value = true;
  locationError.value = null;

  if (!("geolocation" in navigator)) {
    locationError.value = "Geolocation not supported";
    waitingForLocation.value = false;
    return;
  }

  // Use watchPosition for faster results — it fires as soon as *any*
  // position fix arrives (even a coarse one), then we cancel immediately.
  // This avoids the common desktop timeout where getCurrentPosition waits
  // for a high-accuracy fix that never comes.
  let resolved = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const onSuccess = (pos: GeolocationPosition) => {
    if (resolved) return;
    resolved = true;
    cleanup();

    const coords = {
      longitude: pos.coords.longitude,
      latitude: pos.coords.latitude,
    };
    map.value?.flyTo({
      center: [coords.longitude, coords.latitude],
      zoom: 14,
      duration: 1500,
    });
    props.onLocate?.(coords);
    waitingForLocation.value = false;
  };

  const onError = (error: GeolocationPositionError) => {
    if (resolved) return;
    resolved = true;
    cleanup();

    waitingForLocation.value = false;
    switch (error.code) {
      case error.PERMISSION_DENIED:
        locationError.value =
          "Location access denied. Please enable location permissions.";
        break;
      case error.POSITION_UNAVAILABLE:
        locationError.value =
          "Location unavailable. Check your device settings.";
        break;
      case error.TIMEOUT:
        locationError.value =
          "Location timed out. Try again or check your device settings.";
        break;
      default:
        locationError.value = `Location error: ${error.message || "Unknown error"}`;
    }
  };

  // Start watching — accepts first position, any accuracy
  const watchId = navigator.geolocation.watchPosition(onSuccess, onError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 60000, // Accept positions up to 60s old
  });

  // Safety net: if no response in 20s, give up
  fallbackTimer = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      navigator.geolocation.clearWatch(watchId);
      waitingForLocation.value = false;
      locationError.value =
        "Location timed out. Try again or check your device settings.";
    }
  }, 20000);

  function cleanup() {
    navigator.geolocation.clearWatch(watchId);
    if (fallbackTimer) clearTimeout(fallbackTimer);
  }
}

function handleFullscreen() {
  const container = map.value?.getContainer();
  if (!container) return;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    container.requestFullscreen();
  }
}
</script>

<template>
  <div
    :class="
      cn(
        'absolute z-10 flex flex-col gap-1.5',
        positionClasses[props.position],
        props.class,
      )
    "
  >
    <!-- Zoom Controls -->
    <div
      v-if="showZoom"
      class="flex flex-col rounded-md border border-border bg-background shadow-sm overflow-hidden"
    >
      <button
        class="flex items-center justify-center size-12 hover:bg-accent dark:hover:bg-accent/40 transition-colors"
        aria-label="放大地圖"
        @click="handleZoomIn"
      >
        <Plus class="size-6" />
      </button>
      <button
        class="flex items-center justify-center size-12 hover:bg-accent dark:hover:bg-accent/40 transition-colors border-t border-border"
        aria-label="縮小地圖"
        @click="handleZoomOut"
      >
        <Minus class="size-6" />
      </button>
    </div>

    <!-- Compass -->
    <div
      v-if="showCompass"
      class="flex flex-col rounded-md border border-border bg-background shadow-sm overflow-hidden"
    >
      <button
        class="flex items-center justify-center size-8 hover:bg-accent dark:hover:bg-accent/40 transition-colors"
        aria-label="Reset bearing to north"
        @click="handleResetBearing"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          class="transition-transform duration-200"
          :style="{
            transform: `rotateX(${pitch}deg) rotateZ(${-bearing}deg)`,
            transformStyle: 'preserve-3d',
          }"
        >
          <!-- North needle (red) -->
          <path d="M12 2L16 12H12V2Z" fill="#ef4444" />
          <path d="M12 2L8 12H12V2Z" fill="#fca5a5" />
          <!-- South needle (gray) -->
          <path d="M12 22L16 12H12V22Z" fill="#9ca3af" />
          <path d="M12 22L8 12H12V22Z" fill="#d1d5db" />
        </svg>
      </button>
    </div>

    <!-- Locate -->
    <div
      v-if="showLocate"
      class="flex flex-col rounded-md border border-border bg-background shadow-sm overflow-hidden"
    >
      <button
        :disabled="waitingForLocation"
        class="flex items-center justify-center size-8 hover:bg-accent dark:hover:bg-accent/40 transition-colors disabled:opacity-50"
        aria-label="Find my location"
        @click="handleLocate"
      >
        <Loader2 v-if="waitingForLocation" class="size-4 animate-spin" />
        <Locate v-else class="size-4" />
      </button>
    </div>

    <!-- Fullscreen -->
    <div
      v-if="showFullscreen"
      class="flex flex-col rounded-md border border-border bg-background shadow-sm overflow-hidden"
    >
      <button
        class="flex items-center justify-center size-8 hover:bg-accent dark:hover:bg-accent/40 transition-colors"
        aria-label="Toggle fullscreen"
        @click="handleFullscreen"
      >
        <Maximize class="size-4" />
      </button>
    </div>
  </div>
</template>
