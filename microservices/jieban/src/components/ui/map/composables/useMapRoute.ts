import { ref, computed, watch, onMounted, onUnmounted, useId } from "vue";
import * as MapLibreGL from "maplibre-gl";
import { useMap } from "./useMap";

export interface UseMapRouteOptions {
  id?: string;
  coordinates: [number, number][];
  color?: string;
  width?: number;
  opacity?: number;
  dashArray?: [number, number];
  animated?: boolean;
  animationDuration?: number;
  fitBounds?: boolean;
  fitBoundsOptions?: MapLibreGL.FitBoundsOptions;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  interactive?: boolean;
}

export function useMapRoute(props: UseMapRouteOptions) {
  const { map, isLoaded } = useMap();
  const autoId = useId();
  const id = computed(() => props.id ?? autoId);
  const sourceId = computed(() => `route-source-${id.value}`);
  const layerId = computed(() => `route-layer-${id.value}`);
  const animationFrame = ref<number>();
  const isSetup = ref(false);

  const color = () => props.color ?? "#4285F4";
  const width = () => props.width ?? 3;
  const opacity = () => props.opacity ?? 0.8;
  const animated = () => props.animated ?? false;
  const animationDuration = () => props.animationDuration ?? 2000;
  const fitBounds = () => props.fitBounds ?? false;
  const interactive = () => props.interactive ?? true;

  // Event handlers
  const handleClick = () => props.onClick?.();
  const handleMouseEnter = () => {
    if (map.value) {
      map.value.getCanvas().style.cursor = "pointer";
    }
    props.onMouseEnter?.();
  };
  const handleMouseLeave = () => {
    if (map.value) {
      map.value.getCanvas().style.cursor = "";
    }
    props.onMouseLeave?.();
  };

  function animateRoute(coordinates: [number, number][]) {
    if (!map.value || !animated()) return;

    const startTime = performance.now();
    const duration = animationDuration();
    const totalPoints = coordinates.length;

    function step(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const pointCount = Math.max(2, Math.floor(easedProgress * totalPoints));
      const currentCoordinates = coordinates.slice(0, pointCount);

      const source = map.value!.getSource(sourceId.value) as
        | MapLibreGL.GeoJSONSource
        | undefined;
      if (source) {
        source.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: currentCoordinates },
        });
      }

      if (progress < 1) {
        animationFrame.value = requestAnimationFrame(step);
      }
    }

    animationFrame.value = requestAnimationFrame(step);
  }

  function setupLayer() {
    if (!map.value || isSetup.value) return;
    if (map.value.getSource(sourceId.value)) return;

    map.value.addSource(sourceId.value, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [] },
      },
    });

    map.value.addLayer({
      id: layerId.value,
      type: "line",
      source: sourceId.value,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": color(),
        "line-width": width(),
        "line-opacity": opacity(),
        ...(props.dashArray && { "line-dasharray": props.dashArray }),
      },
    });

    isSetup.value = true;

    if (props.coordinates.length >= 2) {
      if (animated()) {
        animateRoute(props.coordinates);
      } else {
        const source = map.value.getSource(
          sourceId.value,
        ) as MapLibreGL.GeoJSONSource;
        source.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: props.coordinates },
        });
      }

      if (fitBounds()) {
        const bounds = new MapLibreGL.LngLatBounds();
        props.coordinates.forEach((coord) => {
          bounds.extend(coord as [number, number]);
        });
        map.value.fitBounds(bounds, {
          padding: 50,
          ...props.fitBoundsOptions,
        });
      }
    }

    if (interactive()) {
      map.value.on("click", layerId.value, handleClick);
      map.value.on("mouseenter", layerId.value, handleMouseEnter);
      map.value.on("mouseleave", layerId.value, handleMouseLeave);
    }
  }

  function cleanupLayer() {
    if (animationFrame.value) {
      cancelAnimationFrame(animationFrame.value);
    }
    if (!map.value || !isSetup.value) return;

    if (interactive()) {
      map.value.off("click", layerId.value, handleClick);
      map.value.off("mouseenter", layerId.value, handleMouseEnter);
      map.value.off("mouseleave", layerId.value, handleMouseLeave);
    }

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

  watch(
    () => props.coordinates,
    (coordinates) => {
      if (
        !isLoaded.value ||
        !map.value ||
        coordinates.length < 2 ||
        !isSetup.value
      )
        return;
      const source = map.value.getSource(
        sourceId.value,
      ) as MapLibreGL.GeoJSONSource;
      if (source) {
        if (animated()) {
          animateRoute(coordinates);
        } else {
          source.setData({
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          });
        }
      }
    },
    { deep: true },
  );

  watch(
    [
      () => props.color,
      () => props.width,
      () => props.opacity,
      () => props.dashArray,
    ],
    () => {
      if (!isLoaded.value || !map.value || !map.value.getLayer(layerId.value))
        return;
      map.value.setPaintProperty(layerId.value, "line-color", color());
      map.value.setPaintProperty(layerId.value, "line-width", width());
      map.value.setPaintProperty(layerId.value, "line-opacity", opacity());
      if (props.dashArray) {
        map.value.setPaintProperty(
          layerId.value,
          "line-dasharray",
          props.dashArray,
        );
      }
    },
  );

  return { isSetup, sourceId, layerId };
}
