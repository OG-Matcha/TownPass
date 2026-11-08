import { ref, computed, watch, onMounted, onUnmounted, useId } from "vue";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import * as MapLibreGL from "maplibre-gl";
import { useMap } from "./useMap";

export interface GeoJsonLayerStyle {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  circleRadius?: number;
  circleColor?: string;
  circleOpacity?: number;
}

export interface UseMapGeoJsonOptions {
  id?: string;
  data: FeatureCollection | Feature<Geometry>;
  layerType?: "fill" | "line" | "circle" | "symbol";
  style?: GeoJsonLayerStyle;
  fitBounds?: boolean;
  fitBoundsOptions?: MapLibreGL.FitBoundsOptions;
  interactive?: boolean;
  onClick?: (feature: Feature) => void;
  onMouseEnter?: (feature: Feature) => void;
  onMouseLeave?: () => void;
}

export function useMapGeoJson(props: UseMapGeoJsonOptions) {
  const { map, isLoaded } = useMap();
  const autoId = useId();
  const id = computed(() => props.id ?? autoId);
  const sourceId = computed(() => `geojson-source-${id.value}`);
  const layerId = computed(() => `geojson-layer-${id.value}`);
  const isSetup = ref(false);

  const layerType = () => props.layerType ?? "fill";
  const fitBounds = () => props.fitBounds ?? false;
  const interactive = () => props.interactive ?? true;

  const handleClick = (
    e: MapLibreGL.MapMouseEvent & { features?: MapLibreGL.MapGeoJSONFeature[] },
  ) => {
    if (e.features && e.features[0]) {
      props.onClick?.(e.features[0] as unknown as Feature);
    }
  };

  const handleMouseEnter = (
    e: MapLibreGL.MapMouseEvent & { features?: MapLibreGL.MapGeoJSONFeature[] },
  ) => {
    if (map.value) {
      map.value.getCanvas().style.cursor = "pointer";
    }
    if (e.features && e.features[0]) {
      props.onMouseEnter?.(e.features[0] as unknown as Feature);
    }
  };

  const handleMouseLeave = () => {
    if (map.value) {
      map.value.getCanvas().style.cursor = "";
    }
    props.onMouseLeave?.();
  };

  function getDefaultStyle(): GeoJsonLayerStyle {
    const defaults: Record<string, GeoJsonLayerStyle> = {
      fill: {
        fillColor: "#3b82f6",
        fillOpacity: 0.5,
        strokeColor: "#2563eb",
        strokeWidth: 2,
        strokeOpacity: 1,
      },
      line: {
        strokeColor: "#3b82f6",
        strokeWidth: 3,
        strokeOpacity: 0.8,
      },
      circle: {
        circleRadius: 6,
        circleColor: "#3b82f6",
        circleOpacity: 0.8,
        strokeColor: "#ffffff",
        strokeWidth: 2,
        strokeOpacity: 1,
      },
      symbol: {},
    };
    return defaults[layerType()] ?? {};
  }

  const mergedStyle = computed(() => ({
    ...getDefaultStyle(),
    ...props.style,
  }));

  function setupLayer() {
    if (!map.value || isSetup.value) return;
    if (map.value.getSource(sourceId.value)) return;

    map.value.addSource(sourceId.value, {
      type: "geojson",
      data: props.data,
    });

    const layerConfig: MapLibreGL.LayerSpecification = {
      id: layerId.value,
      type: layerType(),
      source: sourceId.value,
      layout: {},
      paint: {},
    };

    switch (layerType()) {
      case "fill": {
        const hasDataDrivenColor =
          "features" in props.data &&
          props.data.features.some(
            (f: Feature<Geometry>) => f.properties?.fillColor,
          );
        layerConfig.paint = {
          "fill-color": hasDataDrivenColor
            ? ([
                "coalesce",
                ["get", "fillColor"],
                mergedStyle.value.fillColor,
              ] as unknown as string)
            : mergedStyle.value.fillColor,
          "fill-opacity": mergedStyle.value.fillOpacity,
        };
        break;
      }
      case "line":
        layerConfig.paint = {
          "line-color": mergedStyle.value.strokeColor,
          "line-width": mergedStyle.value.strokeWidth,
          "line-opacity": mergedStyle.value.strokeOpacity,
        };
        break;
      case "circle":
        layerConfig.paint = {
          "circle-radius": mergedStyle.value.circleRadius,
          "circle-color": mergedStyle.value.circleColor,
          "circle-opacity": mergedStyle.value.circleOpacity,
          "circle-stroke-color": mergedStyle.value.strokeColor,
          "circle-stroke-width": mergedStyle.value.strokeWidth,
        };
        break;
    }

    map.value.addLayer(layerConfig);

    if (layerType() === "fill") {
      map.value.addLayer({
        id: `${layerId.value}-outline`,
        type: "line",
        source: sourceId.value,
        layout: {},
        paint: {
          "line-color": mergedStyle.value.strokeColor,
          "line-width": mergedStyle.value.strokeWidth,
          "line-opacity": mergedStyle.value.strokeOpacity,
        },
      });
    }

    isSetup.value = true;

    if (fitBounds()) {
      const bounds = new MapLibreGL.LngLatBounds();
      const features =
        "features" in props.data ? props.data.features : [props.data];

      features.forEach((feature) => {
        if (feature.geometry.type === "Point") {
          bounds.extend(feature.geometry.coordinates as [number, number]);
        } else if (feature.geometry.type === "LineString") {
          feature.geometry.coordinates.forEach((coord) => {
            bounds.extend(coord as [number, number]);
          });
        } else if (feature.geometry.type === "Polygon") {
          feature.geometry.coordinates.forEach((ring) => {
            ring.forEach((coord) => {
              bounds.extend(coord as [number, number]);
            });
          });
        }
      });

      if (!bounds.isEmpty()) {
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
    if (!map.value || !isSetup.value) return;

    if (interactive()) {
      map.value.off("click", layerId.value, handleClick);
      map.value.off("mouseenter", layerId.value, handleMouseEnter);
      map.value.off("mouseleave", layerId.value, handleMouseLeave);
    }

    try {
      if (layerType() === "fill") {
        if (map.value.getLayer(`${layerId.value}-outline`)) {
          map.value.removeLayer(`${layerId.value}-outline`);
        }
      }
      if (map.value.getLayer(layerId.value))
        map.value.removeLayer(layerId.value);
      if (map.value.getSource(sourceId.value))
        map.value.removeSource(sourceId.value);
    } catch {
      // ignore
    }

    isSetup.value = false;
  }

  function updateData() {
    if (!isLoaded.value || !map.value || !isSetup.value) return;
    const source = map.value.getSource(
      sourceId.value,
    ) as MapLibreGL.GeoJSONSource;
    if (source) {
      source.setData(props.data);
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

  watch(() => props.data, updateData, { deep: true });

  watch(
    () => props.style,
    () => {
      if (!isLoaded.value || !map.value || !map.value.getLayer(layerId.value))
        return;

      const style = mergedStyle.value;

      switch (layerType()) {
        case "fill":
          map.value.setPaintProperty(
            layerId.value,
            "fill-color",
            style.fillColor,
          );
          map.value.setPaintProperty(
            layerId.value,
            "fill-opacity",
            style.fillOpacity,
          );
          map.value.setPaintProperty(
            `${layerId.value}-outline`,
            "line-color",
            style.strokeColor,
          );
          map.value.setPaintProperty(
            `${layerId.value}-outline`,
            "line-width",
            style.strokeWidth,
          );
          break;
        case "line":
          map.value.setPaintProperty(
            layerId.value,
            "line-color",
            style.strokeColor,
          );
          map.value.setPaintProperty(
            layerId.value,
            "line-width",
            style.strokeWidth,
          );
          map.value.setPaintProperty(
            layerId.value,
            "line-opacity",
            style.strokeOpacity,
          );
          break;
        case "circle":
          map.value.setPaintProperty(
            layerId.value,
            "circle-radius",
            style.circleRadius,
          );
          map.value.setPaintProperty(
            layerId.value,
            "circle-color",
            style.circleColor,
          );
          map.value.setPaintProperty(
            layerId.value,
            "circle-opacity",
            style.circleOpacity,
          );
          break;
      }
    },
    { deep: true },
  );

  return { isSetup, sourceId, layerId, updateData };
}
