// 單站的無障礙狀況：無障礙出入口、出發日保養、異常公告、附近替代站。

export type Entrance = {
  name: string;
  exit: string;
  lng: number;
  lat: number;
  kind: "elevator" | "ramp";
  station: string;
};
export type Maintenance = { date: string; station: string; place: string; isExit: boolean; night: boolean };
export type Anomaly = { time: string; line: string; station: string; text: string; resolved: boolean };

export type StationStatus = {
  station: string;
  entrances: Entrance[];
  onlyOne: boolean;
  dayExitWork: Maintenance[]; // 出發日白天保養的「出口」電梯
  dayPlatformWork: Maintenance[]; // 出發日白天保養的「月台」電梯
  nightWork: Maintenance[];
  anomalies: Anomaly[]; // 尚未修復的異常公告
  blocked: boolean; // 所有無障礙出口當天白天都排定保養（沒有坡道可替代）
};

export function stationStatus(
  station: string,
  date: string,
  entrances: Entrance[],
  maint: Maintenance[],
  anomalies: Anomaly[],
): StationStatus {
  const ents = entrances.filter((e) => e.station === station);
  const today = maint.filter((m) => m.station === station && m.date === date);
  const dayExitWork = today.filter((m) => m.isExit && !m.night);
  const elevatorExits = ents.filter((e) => e.kind === "elevator");
  // 每個無障礙出口都是電梯、而且當天白天都排定保養 → 這站當天可能進出不了
  const blocked =
    elevatorExits.length > 0 &&
    elevatorExits.length === ents.length &&
    elevatorExits.every((e) => dayExitWork.some((m) => m.place === e.exit));
  return {
    station,
    entrances: ents,
    onlyOne: ents.length === 1,
    dayExitWork,
    dayPlatformWork: today.filter((m) => !m.isExit && !m.night),
    nightWork: today.filter((m) => m.night),
    anomalies: anomalies.filter((a) => a.station === station && !a.resolved),
    blocked,
  };
}

function meters(a: Entrance, b: Entrance) {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** 最近、而且當天沒有被擋住的替代站（直線距離，僅供參考）。 */
export function nearestAlternative(
  station: string,
  date: string,
  entrances: Entrance[],
  maint: Maintenance[],
  anomalies: Anomaly[],
): { station: string; meters: number } | null {
  const here = entrances.find((e) => e.station === station);
  if (!here) return null;
  const others = [...new Set(entrances.map((e) => e.station))].filter((s) => s !== station);
  let best: { station: string; meters: number } | null = null;
  for (const s of others) {
    if (stationStatus(s, date, entrances, maint, anomalies).blocked) continue;
    const d = Math.min(...entrances.filter((e) => e.station === s).map((e) => meters(here, e)));
    if (!best || d < best.meters) best = { station: s, meters: Math.round(d) };
  }
  return best;
}
