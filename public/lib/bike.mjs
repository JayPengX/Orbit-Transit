// YouBike (and the other public bikes TDX lists): stations and what's
// there now, regular bikes and 電輔車 apart.

import { tdx, rows } from './api.mjs';
import { zh } from './util.mjs';
import { BIKE_CITIES } from './city.mjs';

const STATION_FIELDS = '$select=StationUID,StationName,StationPosition,BikesCapacity,ServiceType';
const LIVE_FIELDS = '$select=StationUID,ServiceStatus,AvailableRentBikes,AvailableReturnBikes,AvailableRentBikesDetail,UpdateTime';

// 「YouBike2.0_新竹火車站(東站)」 → 「新竹火車站(東站)」.
export const bikeName = n => String(n || '').replace(/^YouBike\s*\d(\.\d)?E?_/i, '').replace(/^iBike\d?(\.\d)?_?/i, '');

// TDX's station list and availability → [{ uid, name, lat, lon, cap, kind,
// bikes (regular), ebike, ret (docks), ok, at }].
export function mergeBikes(stations, live) {
  const now = new Map(rows(live).map(a => [a.StationUID, a]));
  return rows(stations)
    .map(s => {
      const a = now.get(s.StationUID);
      const detail = a?.AvailableRentBikesDetail || {};
      const total = Number(a?.AvailableRentBikes) || 0;
      const ebike = Number(detail.ElectricBikes) || 0;
      return {
        uid: s.StationUID,
        name: bikeName(zh(s.StationName)),
        lat: Number(s.StationPosition?.PositionLat),
        lon: Number(s.StationPosition?.PositionLon),
        cap: Number(s.BikesCapacity) || 0,
        kind: s.ServiceType === 1 ? 'YouBike 1.0' : s.ServiceType === 3 ? 'Moovo' : 'YouBike 2.0',
        bikes: detail.GeneralBikes != null ? Number(detail.GeneralBikes) || 0 : Math.max(0, total - ebike),
        ebike,
        ret: Number(a?.AvailableReturnBikes) || 0,
        ok: a ? a.ServiceStatus === 1 : null,
        at: a?.UpdateTime ? Date.parse(a.UpdateTime) : null
      };
    })
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

// A whole city's stations (the map), live counts refreshed each minute.
export async function cityBikes(city) {
  if (!BIKE_CITIES.has(city)) return [];
  const [st, live] = await Promise.all([tdx(`basic/v2/Bike/Station/City/${city}?${STATION_FIELDS}`, { fresh: 86_400_000, persist: true }), tdx(`basic/v2/Bike/Availability/City/${city}?${LIVE_FIELDS}`, { fresh: 50_000 })]);
  return mergeBikes(st, live);
}

// Stations within about a kilometre of a point (the planner), on a ~500 m
// grid so nearby asks share the proxy's copy.
export async function bikesNear(lat, lon) {
  const g = v => (Math.round(v * 200) / 200).toFixed(3);
  const f = `$spatialFilter=nearby(${g(lat)},${g(lon)},1000)`;
  const [st, live] = await Promise.all([tdx(`advanced/v2/Bike/Station/NearBy?${f}&$top=120&${STATION_FIELDS}`, { fresh: 86_400_000, persist: true }), tdx(`advanced/v2/Bike/Availability/NearBy?${f}&$top=120&${LIVE_FIELDS}`, { fresh: 50_000 })]);
  return mergeBikes(st, live);
}

// The marker's look: how many to take, by colour.
export const bikeLevel = s => (s.ok === false ? 'off' : s.bikes + s.ebike === 0 ? 'none' : s.bikes + s.ebike <= 3 ? 'few' : 'ok');
