// Taiwan's bus routes and timetables, built each night by Shared-Data
// (github.com/JayPengX/Shared-Data) and kept on the phone a day: a city's
// routes in one pack (新竹市, 新竹縣…), the 公路客運 in squares of 0.25°
// (only the squares a trip is in). A route's stops and timetable come from
// here, in TDX's own shape, so nothing else changes; a route not in its pack
// (or no pack to be had) is asked of TDX as before.

import { kept, keep } from './api.mjs';

export const PACKS = 'https://jaypengx.github.io/Shared-Data/bus/';
const SQUARE = 0.25;
export const squareOf = (lat, lon) => `${(Math.floor(lat / SQUARE) * SQUARE).toFixed(2)}_${(Math.floor(lon / SQUARE) * SQUARE).toFixed(2)}`;
const FRESH = 20 * 3_600_000;
const memory = new Map();
const inflight = new Map();

// A pack by its name ('Hsinchu', 'InterCity/24.75_121.00'): the copy kept
// here when it's under 20 hours old, else the site's; the kept one (any age)
// when the site can't be reached. null: no pack.
export async function pack(name, { fetchFn = fetch } = {}) {
  const now = Date.now();
  const mem = memory.get(name);
  if (mem && now - mem.at < FRESH) return mem.data;
  const disk = mem ? null : await kept(`pack/${name}`);
  const old = mem || (disk ? { at: disk.at, data: index(disk.data) } : null);
  if (old && now - old.at < FRESH) return memory.set(name, old), old.data;
  if (inflight.has(name)) return inflight.get(name);
  const p = (async () => {
    try {
      const res = await fetchFn(`${PACKS}${name}.json`);
      if (!res.ok) throw new Error(String(res.status));
      const data = index(await res.json());
      memory.set(name, { at: now, data });
      keep(`pack/${name}`, data.raw, now);
      return data;
    } catch {
      if (old) return memory.set(name, old), old.data;
      return null;
    } finally {
      inflight.delete(name);
    }
  })();
  inflight.set(name, p);
  return p;
}
const index = raw => (raw?.byUid ? raw : { raw, byUid: new Map((raw?.routes || []).map(r => [r.uid, r])) });

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const days = bits => Object.fromEntries(DAYS.map((d, i) => [d, bits & (1 << i) ? 1 : 0]));
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const N = s => ({ Zh_tw: s || '' });

// One route of a pack in TDX's shapes: { stops: StopOfRoute rows, sched: Schedule rows }.
export function expand(p, uid) {
  const r = p?.byUid?.get(uid);
  if (!r) return null;
  const st = u => p.raw.stops[u] || ['', null, null];
  const stops = r.ways.map(([sub, subName, dir, list]) => ({
    RouteUID: r.uid,
    RouteName: N(r.name),
    SubRouteUID: sub,
    SubRouteName: N(subName),
    Direction: dir,
    Stops: list.map((u, i) => ({ StopUID: u, StopName: N(st(u)[0]), StopSequence: i + 1, StopPosition: { PositionLat: st(u)[1], PositionLon: st(u)[2] } }))
  }));
  const sched = r.sched.map(([sub, dir, order, trips, freq]) => ({
    RouteUID: r.uid,
    RouteName: N(r.name),
    SubRouteUID: sub,
    Direction: dir,
    Timetables: trips.map(([bits, times, special]) => ({
      ServiceDay: days(bits),
      ...(special ? { SpecialDays: special } : {}),
      StopTimes: order.map((u, i) => [u, typeof times === 'number' ? times : times[i]]).filter(([, m]) => m >= 0).map(([u, m], i) => ({ StopUID: u, StopName: N(st(u)[0]), StopSequence: i + 1, DepartureTime: hhmm(m) }))
    })),
    Frequencys: freq.map(([bits, from, to, min, max]) => ({ ServiceDay: days(bits), StartTime: from, EndTime: to, MinHeadwayMins: min, MaxHeadwayMins: max }))
  }));
  return { stops, sched };
}

// A route's pack: its city's, or (公路客運) the square of a point on it (`near`).
export async function packRoute(route, near = null) {
  const name = route.city === 'InterCity' ? (near?.lat != null ? `InterCity/${squareOf(near.lat, near.lon)}` : null) : route.city;
  if (!name) return null;
  return expand(await pack(name).catch(() => null), route.uid);
}
