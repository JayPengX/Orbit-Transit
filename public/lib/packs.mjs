// Taiwan's bus routes and timetables, built each night by Shared-Data
// (github.com/JayPengX/Shared-Data) and kept on the phone a day: a city's
// routes in one pack (新竹市, 新竹縣…), the 公路客運 in squares of 0.25°
// (only the squares a trip is in). A route's stops and timetable come from
// here, in TDX's own shape, so nothing else changes; a route not in its pack
// (or no pack to be had) is asked of TDX as before.

import * as kit from '#kit/quadra.mjs';
import { TDX_DAYS } from './util.mjs';

const SQUARE = 0.25;
export const squareOf = (lat, lon) => `${(Math.floor(lat / SQUARE) * SQUARE).toFixed(2)}_${(Math.floor(lon / SQUARE) * SQUARE).toFixed(2)}`;
const FRESH = 20 * 3_600_000;

// A pack by its name ('Hsinchu', 'InterCity/24.75_121.00'), read as every
// app reads the family's data (the kit's packJson: the copy kept here under
// 20 hours old, else the site's; the kept one, any age, when the site can't
// be reached). null: no pack. (Each pack indexed once.)
const indexed = new WeakMap();
export async function pack(name) {
  const raw = await kit.packJson(`bus/${name}.json`, { ttl: FRESH }).catch(() => null);
  if (!raw) return null;
  if (!indexed.has(raw)) indexed.set(raw, { raw, byUid: new Map((raw.routes || []).map(r => [r.uid, r])) });
  return indexed.get(raw);
}

const days = bits => Object.fromEntries(TDX_DAYS.map((d, i) => [d, bits & (1 << i) ? 1 : 0]));
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
// (Each route made into TDX's shapes once a pack: a trip asks for its stops and timetable often.)
const expanded = new WeakMap();
export async function packRoute(route, near = null) {
  const name = route.city === 'InterCity' ? (near?.lat != null ? `InterCity/${squareOf(near.lat, near.lon)}` : null) : route.city;
  if (!name) return null;
  const p = await pack(name).catch(() => null);
  if (!p) return null;
  if (!expanded.has(p)) expanded.set(p, new Map());
  const routes = expanded.get(p);
  if (!routes.has(route.uid)) routes.set(route.uid, expand(p, route.uid));
  return routes.get(route.uid);
}
