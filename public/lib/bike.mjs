// YouBike (and the other public bikes TDX lists): stations and what's
// there now, regular bikes and 電輔車 apart.

import { tdx, rows, bikeMs } from './api.mjs';
import { zh, learnName } from './util.mjs';
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
        name: (learnName(bikeName(zh(s.StationName)), bikeName(s.StationName?.En)), bikeName(zh(s.StationName))),
        lat: Number(s.StationPosition?.PositionLat),
        lon: Number(s.StationPosition?.PositionLon),
        cap: Number(s.BikesCapacity) || 0,
        kind: s.ServiceType === 3 ? 'Moovo' : 'YouBike 2.0',
        bikes: detail.GeneralBikes != null ? Number(detail.GeneralBikes) || 0 : Math.max(0, total - ebike),
        ebike,
        ret: Number(a?.AvailableReturnBikes) || 0,
        ok: a ? a.ServiceStatus === 1 : null,
        at: a?.UpdateTime ? Date.parse(a.UpdateTime) : null
      };
    })
    // (YouBike only: 彰化's Moovo, TDX's ServiceType 3, is another company's
    // bikes, its own app and fares, a "station" of 350; it showed and was
    // planned as YouBike at 彰化車站, where there's none. Jay 2026-11-06.)
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && s.kind !== 'Moovo')
    .map(testBikes);
}
// (The 測試工具's YouBike switch, testing.mjs: every station empty, full, down to one or closed; shown only.)
function testBikes(s) {
  const t = globalThis.ORBIT_TEST?.flags?.bikes;
  if (t === 'empty') return { ...s, bikes: 0, ebike: 0, ret: s.cap || 20, ok: true };
  if (t === 'full') return { ...s, ret: 0, ok: true };
  if (t === 'low') return { ...s, bikes: 1, ebike: 0, ret: 1, ok: true };
  if (t === 'paused') return { ...s, ok: false };
  return s;
}

// ---- YouBike's own counts, read here -----------------------------------------------------------
//
// What's at each station now comes from YouBike itself, read by the phone:
// its API answers any page (CORS *), but its firewall refuses Cloudflare,
// and TDX's free tier (3 points a month, from 2026-12-01) can't keep a map's
// counts fresh. A city's stations are covered by circles of 10 km at most
// (YouBike's limit), one ask each (新竹市 one, 12 KB gzipped). The stations'
// names stay TDX's (a day's list, kept). YouBike unreachable: the proxy's
// TDX counts, as before.
export const YB_LIVE = 'https://apis.youbike.com.tw/tw2/parkingInfo';
// A station's number's first four digits → TDX's id prefix (HSZ500401001).
const YB_PRE = { 5001: 'TPE', 5002: 'NWT', 5003: 'TAO', 5004: 'HSZ', 5082: 'HSZ', 5005: 'HSQ', 5006: 'TXG', 5007: 'MIA', 5010: 'CYI', 5011: 'CYQ', 5012: 'KHH', 5013: 'TNN', 5014: 'PIF', 5015: 'TTT' };
const YB_REACH = 9500; // (a circle's radius: within YouBike's 10,000 m)
export const ybUid = no => (YB_PRE[String(no).slice(0, 4)] || '') + no;
const metres = (a, b, c, d) => {
  const k = Math.PI / 180;
  return 6_371_000 * Math.hypot((d - b) * k * Math.cos(((a + c) / 2) * k), (c - a) * k);
};

// YouBike's answer → TDX's availability rows (what mergeBikes reads).
export function ybRows(list, at = Date.now()) {
  const time = new Date(at + 8 * 3_600_000).toISOString().slice(0, 19) + '+08:00';
  return (Array.isArray(list) ? list : [])
    .filter(s => s?.station_no && YB_PRE[String(s.station_no).slice(0, 4)])
    .map(s => {
      const d = s.available_spaces_detail || {};
      return {
        StationUID: ybUid(s.station_no),
        ServiceStatus: Number(s.status) === 1 ? 1 : Number(s.status) === 2 ? 2 : 0,
        AvailableRentBikes: Number(s.available_spaces) || 0,
        AvailableReturnBikes: Number(s.empty_spaces) || 0,
        AvailableRentBikesDetail: { GeneralBikes: (Number(d.yb2) || 0) + (Number(d.yb1) || 0), ElectricBikes: Number(d.eyb) || 0 },
        UpdateTime: time
      };
    });
}

// Circles of YB_REACH that cover every station (each one's centre a station not yet covered).
export function circlesOf(stations) {
  const pts = rows(stations)
    .map(s => [Number(s.StationPosition?.PositionLat), Number(s.StationPosition?.PositionLon)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const p of pts) if (!out.some(c => metres(c[0], c[1], p[0], p[1]) <= YB_REACH)) out.push(p);
  return out;
}

const ybKept = new Map(); // 'lat,lon,r' → { at, rows } | { going }
async function ybNear(lat, lon, r) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${r}`;
  const k = ybKept.get(key);
  if (k?.rows && Date.now() - k.at < bikeMs() - 1000) return k.rows;
  if (k?.going) return k.going;
  const going = (async () => {
    const res = await fetch(YB_LIVE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lng: lon, maxDistance: r }), signal: AbortSignal.timeout?.(6000) });
    if (!res.ok) throw new Error(`youbike ${res.status}`);
    const j = await res.json();
    const list = Array.isArray(j?.retVal) ? j.retVal : j?.retVal?.data;
    if (!Array.isArray(list)) throw new Error('youbike: no list');
    const got = ybRows(list);
    ybKept.set(key, { at: Date.now(), rows: got });
    return got;
  })();
  ybKept.set(key, { ...k, going });
  try {
    return await going;
  } catch (err) {
    ybKept.set(key, k?.rows ? { at: k.at, rows: k.rows } : {});
    // (Its last counts within 10 minutes, else the proxy's.)
    if (k?.rows && Date.now() - k.at < 10 * 60_000) return k.rows;
    throw err;
  }
}
// (Stopped trying for a few minutes once YouBike can't be reached: the proxy's at once.)
let ybDown = 0;
const ybFlat = new Map(); // the circles → { parts, all } (the same list while no part changed)
async function ybLive(points, r) {
  if (Date.now() - ybDown < 3 * 60_000) throw new Error('youbike down');
  try {
    const parts = await Promise.all(points.map(([a, b]) => ybNear(a, b, r)));
    const key = `${r}:${points.join(';')}`;
    const was = ybFlat.get(key);
    if (was && was.parts.length === parts.length && was.parts.every((p, i) => p === parts[i])) return was.all;
    const all = parts.flat();
    ybFlat.set(key, { parts, all });
    return all;
  } catch (err) {
    ybDown = Date.now();
    throw err;
  }
}

// (Tests: forget YouBike's counts.)
export const ybDrop = () => (ybKept.clear(), ybFlat.clear());

const merged = new Map(); // city → { st, live, list }
const circles = new WeakMap(); // a station list → its circles
// A whole city's stations (the map, a trip's bikes), live counts refreshed
// each minute; YouBike slow or away, the proxy's (the last counts at once, api tdx `late`).
export async function cityBikes(city) {
  if (!BIKE_CITIES.has(city)) return [];
  const st = await tdx(`basic/v2/Bike/Station/City/${city}?${STATION_FIELDS}`, { fresh: 86_400_000, persist: true });
  let live;
  if (st && typeof st === 'object' && Object.values(YB_PRE).some(p => rows(st)[0]?.StationUID?.startsWith(p))) {
    if (!circles.has(st)) circles.set(st, circlesOf(st));
    live = await ybLive(circles.get(st), 10_000).catch(() => null);
  }
  live ||= await tdx(`basic/v2/Bike/Availability/City/${city}?${LIVE_FIELDS}`, { fresh: 'bike', swr: 20 * 60_000, late: 2500, max: 2e6 });
  // (Merged once a copy: a trip asks for its city's bikes at a dozen points.)
  const m = merged.get(city);
  if (m?.st === st && m.live === live) return m.list;
  const list = mergeBikes(st, live);
  merged.set(city, { st, live, list });
  return list;
}

// Stations within about a kilometre of a point (the planner): YouBike's
// counts there, names from their cities' lists; YouBike away, the proxy's.
export async function bikesNear(lat, lon) {
  try {
    const live = await ybLive([[Math.round(lat * 2000) / 2000, Math.round(lon * 2000) / 2000]], 1000);
    const pre = new Set(live.map(r => r.StationUID.slice(0, 3)));
    const cities = [...BIKE_CITIES].filter(c => pre.has(CITY_PRE[c]));
    const lists = await Promise.all(cities.map(c => tdx(`basic/v2/Bike/Station/City/${c}?${STATION_FIELDS}`, { fresh: 86_400_000, persist: true })));
    const want = new Set(live.map(r => r.StationUID));
    return mergeBikes(lists.flatMap(l => rows(l)).filter(s => want.has(s.StationUID)), live);
  } catch {}
  const g = v => (Math.round(v * 200) / 200).toFixed(3);
  const f = `$spatialFilter=nearby(${g(lat)},${g(lon)},1000)`;
  const [st, live] = await Promise.all([tdx(`advanced/v2/Bike/Station/NearBy?${f}&$top=120&${STATION_FIELDS}`, { fresh: 86_400_000, persist: true }), tdx(`advanced/v2/Bike/Availability/NearBy?${f}&$top=120&${LIVE_FIELDS}`, { fresh: 'bike', late: 2500 })]);
  return mergeBikes(st, live);
}
const CITY_PRE = { Taipei: 'TPE', NewTaipei: 'NWT', Taoyuan: 'TAO', Hsinchu: 'HSZ', HsinchuCounty: 'HSQ', Taichung: 'TXG', MiaoliCounty: 'MIA', Chiayi: 'CYI', ChiayiCounty: 'CYQ', Kaohsiung: 'KHH', Tainan: 'TNN', PingtungCounty: 'PIF', TaitungCounty: 'TTT' };

// A bike to take at a station now (a 電輔車, with `ebike`), and a free dock to return one.
export const canRent = (s, ebike = false) => s.ok !== false && (ebike ? s.ebike || 0 : s.bikes + (s.ebike || 0)) > 0;
export const canReturn = s => s.ok !== false && s.ret > 0;

// The marker's look: how many to take, by colour.
export const bikeLevel = s => (s.ok === false ? 'off' : !canRent(s) ? 'none' : s.bikes + s.ebike <= 3 ? 'few' : 'ok');
