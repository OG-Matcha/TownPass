import type { StyleSpecification } from "maplibre-gl";
import { OFFLINE_PROTOCOL, registerOfflineTiles } from "./offlineTiles";

// 國土測繪中心 臺灣通用電子地圖（WMTS，政府開放圖資）。
// 比賽規則：地圖用開源方案，不用 Google Maps / Mapbox；mapcn 預設的 CARTO 商用要授權，所以換掉。
const ATTRIBUTION =
  '© <a href="https://maps.nlsc.gov.tw/" target="_blank">內政部國土測繪中心</a>';

function nlscRaster(layer: "EMAP" | "EMAP2" | "PHOTO2"): StyleSpecification {
  // 先用打包在網頁裡的圖磚，斷網也看得到（見 offlineTiles.ts）
  registerOfflineTiles(layer);
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      nlsc: {
        type: "raster",
        tiles: [
          `${OFFLINE_PROTOCOL}://{z}/{x}/{y}`,
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: ATTRIBUTION,
      },
    },
    layers: [{ id: "nlsc", type: "raster", source: "nlsc" }],
  };
}

export const NLSC_LIGHT = nlscRaster("EMAP");

// 備用：OpenFreeMap（OpenStreetMap 向量圖，可自訂配色）
export const OPENFREEMAP_LIBERTY = "https://tiles.openfreemap.org/styles/liberty";
