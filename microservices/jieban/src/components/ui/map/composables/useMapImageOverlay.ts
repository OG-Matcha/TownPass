import { ref, computed, watch, onMounted, onUnmounted, useId } from "vue";
import type { ImageSource } from "maplibre-gl";
import { useMap } from "./useMap";

export interface UseMapImageOverlayOptions {
  id?: string;
  url: string;
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  opacity?: number;
}

export function useMapImageOverlay(props: UseMapImageOverlayOptions) {
  const { map, isLoaded } = useMap();
  const autoId = useId();
  const id = computed(() => props.id ?? autoId);
  const sourceId = computed(() => `image-source-${id.value}`);
  const layerId = computed(() => `image-layer-${id.value}`);
  const isSetup = ref(false);

  const opacity = () => props.opacity ?? 1;

  function setupLayer() {
    if (!map.value || isSetup.value) return;
    if (map.value.getSource(sourceId.value)) return;

    map.value.addSource(sourceId.value, {
      type: "image",
      url: props.url,
      coordinates: props.coordinates,
    });

    map.value.addLayer({
      id: layerId.value,
      type: "raster",
      source: sourceId.value,
      paint: {
        "raster-opacity": opacity(),
      },
    });

    isSetup.value = true;
  }

  function cleanupLayer() {
    if (!map.value || !isSetup.value) return;

    try {
      if (map.value.getLayer(layerId.value))
        map.value.removeLayer(layerId.value);
      if (map.value.getSource(sourceId.value))
        map.value.removeSource(sourceId.value);
    } catch {
      // ignore
    }

    isSetup.value = false;
  }

  function updateImage() {
    if (!isLoaded.value || !map.value || !isSetup.value) return;

    const source = map.value.getSource(sourceId.value) as ImageSource;
    if (source) {
      source.updateImage({
        url: props.url,
        coordinates: props.coordinates,
      });
    }
  }

  onMounted(() => {
    if (isLoaded.value) {
      setupLayer();
    } else {
      const unwatch = watch(isLoaded, (loaded) => {
        if (loaded) {
          setupLayer();
          unwatch();
        }
      });
    }
  });

  onUnmounted(cleanupLayer);

  watch(() => props.url, updateImage);
  watch(() => props.coordinates, updateImage, { deep: true });

  watch(
    () => props.opacity,
    () => {
      if (!isLoaded.value || !map.value || !map.value.getLayer(layerId.value))
        return;
      map.value.setPaintProperty(layerId.value, "raster-opacity", opacity());
    },
  );

  return { isSetup, sourceId, layerId };
}
