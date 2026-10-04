// Plans made from what the buses are doing now, not only their timetables
// (Taiwan's buses are seldom on time): TDX's estimates (N1, refreshed by the
// proxy every 25 s) at the stop a plan boards, matched to its route.
//
//   adjustPlan  a planner's plan with its buses re-timed: the bus you'd
//               really catch, the rest of the trip moved with it, a train
//               after it marked when it would now be missed
//   busLink     the direct buses from around one point to around another,
//               when the next ones come (a train's last station to the
//               place: 竹中 → 5608 → 竹東高中)

import { tdx, rows } from './api.mjs';
import { routeStops, routeSchedule, stationsNear, stopTimes, routeCity } from './bus.mjs';
import { finish } from './plan.mjs';
import { meters, walkSec, zh, tw, twAt } from './util.mjs';

const MIN = 60_000;
const FIELDS = '$select=StopUID,StopName,RouteUID,RouteName,Direction,EstimateTime,StopStatus,NextBusTime,IsLastBus,Estimates';

// Every bus due at the stops within r metres of a point (one TDX ask, shared
// for 20 s by everyone near the same ~10 m).
export async function etaNear(lat, lon, r = 150) {
  const j = await tdx(`advanced/v2/Bus/EstimatedTimeOfArrival/NearBy?$spatialFilter=nearby(${lat.toFixed(4)},${lon.toFixed(4)},${r})&${FIELDS}&$top=300`, { fresh: 20_000 });
  return rows(j);
}

// Google's and TDX's names for one route differ (快捷8經興隆大橋, 快捷8號;
// 藍1區間車, 藍1): the same when one is the other plus words, never 5 and 5608.
export const routeNorm = s => String(s || '').replace(/\s+/g, '').replace(/[號线線]/g, '').replace(/[（(].*$/, '').replace(/台/g, '臺').toUpperCase();
export function sameRoute(a, b) {
  const x = routeNorm(a);
  const y = routeNorm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return l.startsWith(s) && !/\d/.test(l[s.length]) && !/^\d+$/.test(l.slice(s.length));
}

// A route's buses at those stops, as moments: [{ at, last, plate }], and
// whether it isn't running (末班已過, 今日未營運).
export function liveTimes(list, name, now = Date.now(), { dir = null, routeUID = '' } = {}) {
  const mine = list.filter(r => (routeUID ? r.RouteUID === routeUID : sameRoute(zh(r.RouteName), name)) && (dir == null || Number(r.Direction) === dir));
  const times = [];
  let off = 0;
  for (const r of mine) {
    const st = Number(r.StopStatus) || 0;
    if (r.EstimateTime != null && st === 0) times.push({ at: now + Number(r.EstimateTime) * 1000, last: r.IsLastBus === true, plate: r.PlateNumb || '' });
    for (const x of r.Estimates || []) if (Number.isFinite(Number(x.EstimateTime))) times.push({ at: now + Number(x.EstimateTime) * 1000, last: x.IsLastBus === true, plate: x.PlateNumb || '' });
    if (st === 1 && r.NextBusTime) times.push({ at: Date.parse(r.NextBusTime), last: r.IsLastBus === true, plate: '', planned: true });
    if (st === 3 || st === 4) off = st;
  }
  const seen = new Set();
  const uniq = times.filter(t => Number.isFinite(t.at) && !seen.has(Math.round(t.at / 30_000)) && seen.add(Math.round(t.at / 30_000))).sort((a, b) => a.at - b.at);
  return { found: mine.length > 0, times: uniq, off: uniq.length ? 0 : off };
}

const FIXED = new Set(['tra', 'hsr', 'metro', 'lightrail']);

// One plan, its first two buses re-timed by what TDX says now. Only for
// buses due within the next 90 minutes (further out, estimates mean
// nothing). The plan comes back unchanged when TDX has nothing for it.
// A route's departures at the i-th stop of one way on a day, as moments:
// the timetable's own times there, or (公路客運 often lists only when a bus
// leaves its first stop, the same time at every stop) the first stop's plus
// the ride from it; else its headway (every 15–20 minutes) from `after`.
export function departuresAt(sched, w, i, after, n = 4) {
  if (!sched?.length) return [];
  const d = tw(after);
  const at = k => stopTimes(sched, { stopUID: w.stops[k].uid, name: w.stops[k].name, dir: w.dir }, d.date, d.dow);
  const here = at(i);
  let times = here.times;
  let shift = 0;
  if (i > 0) {
    const first = at(0).times;
    if (!times.length || (first.length && first.join() === times.join())) {
      times = first;
      shift = rideTime(w, 0, i) * 1000;
    }
  }
  const out = times.map(hm => twAt(d.date, hm.slice(0, 5)) + shift).filter(t => t >= after).sort((x, y) => x - y);
  const f = here.every.find(x => x.from <= d.hm && d.hm <= x.to);
  const gap = f ? ((f.min || f.max) + (f.max || f.min)) / 2 : 0;
  while (gap && out.length < n) out.push((out.at(-1) ?? after) + gap * MIN);
  return out.slice(0, n);
}

// Which way of a route a ride is, and its stops: the way where the stop
// nearest where you get on comes before the one nearest where you get off.
export function wayOf(ways, from, to) {
  let best = null;
  for (const w of ways) {
    const d = s => meters(s.lat, s.lon, from.lat, from.lon);
    const i = w.stops.reduce((a, s, k) => (d(s) < d(w.stops[a]) ? k : a), 0);
    const e = s => meters(s.lat, s.lon, to.lat, to.lon);
    let j = -1;
    for (let k = i + 1; k < w.stops.length; k++) if (j < 0 || e(w.stops[k]) < e(w.stops[j])) j = k;
    if (j < 0) continue;
    const cost = d(w.stops[i]) + e(w.stops[j]);
    if (!best || cost < best.cost) best = { w, i, j, cost };
  }
  return best;
}

// A bus ride's later buses (its card's times): TDX's estimates for that
// way at that stop, then its timetable there. `list`: the estimates near the
// stop (etaNear). Three at most.
export async function laterBuses(list, l, after, { now = Date.now(), stops = routeStops, schedule = routeSchedule } = {}) {
  const name = l.short || l.name;
  const r = list.find(x => sameRoute(zh(x.RouteName), name) && x.RouteUID);
  if (!r) return [];
  const route = { uid: r.RouteUID, name: zh(r.RouteName), city: routeCity(r.RouteUID) };
  const [ways, sched] = await Promise.all([stops(route, l.from).catch(() => []), schedule(route, l.from).catch(() => [])]);
  const way = l.to?.lat != null ? wayOf(ways, l.from, l.to) : null;
  const live = liveTimes(list, name, now, { routeUID: r.RouteUID, ...(way ? { dir: way.w.dir } : {}) }).times.map(t => t.at).filter(t => t > after + MIN);
  const out = [...live];
  if (way) for (const t of departuresAt(sched, way.w, way.i, after + MIN, 4)) if (out.length < 3 && !out.some(x => Math.abs(x - t) < 3 * MIN)) out.push(t);
  return out.sort((x, y) => x - y).slice(0, 3);
}
// A plan's first bus, its later buses, when TDX gave no estimate for it (a
// trip later in the day; a planner's bus).
export async function busTimes(plan, { near = etaNear, now = Date.now() } = {}) {
  const l = plan.legs.find(x => x.mode !== 'walk' && x.mode !== 'bike');
  if (!l || l.mode !== 'bus' || !l.from?.lat) return [];
  const list = await near(l.from.lat, l.from.lon, 150).catch(() => []);
  return laterBuses(list, l, l.dep, { now });
}

export async function adjustPlan(plan, now = Date.now(), { near = etaNear } = {}) {
  let legs = plan.legs.map(l => ({ ...l }));
  let changed = false;
  let miss = '';
  let off = '';
  let done = 0;
  for (let i = 0; i < legs.length && done < 2; i++) {
    const l = legs[i];
    if (l.mode !== 'bus' || !l.from?.lat || l.dep == null) continue;
    if (l.dep > now + 90 * MIN || l.dep < now - 2 * MIN) break;
    done++;
    let list;
    try {
      list = await near(l.from.lat, l.from.lon, 150);
    } catch {
      continue;
    }
    const { found, times, off: stopped } = liveTimes(list, l.short || l.name, now);
    if (!found) continue;
    const first = legs.findIndex(x => x.mode !== 'walk' && x.mode !== 'bike');
    const before = legs.slice(0, i).reduce((a, x) => a + (x.dur || 0) * 1000, 0);
    // When you can be at the stop: now plus the walk (or ride) to it, else after the leg before.
    const ready = i === first ? Math.max(now, legs[0].dep ?? now) + before : (legs[i - 1]?.arr ?? l.dep) + 30_000;
    const bus = times.find(t => t.at >= ready - 30_000);
    if (!bus) {
      if (stopped) off = stopped === 3 ? `${l.short || l.name} 末班已過` : `${l.short || l.name} 今日未營運`;
      continue;
    }
    l.live = { at: bus.at, planned: Boolean(bus.planned), last: bus.last };
    // The buses after it, for the route's other times (moreBuses).
    // (Not waited for here: the planner waits for them all at once, beside the bikes.)
    if (i === first) l.nextP = laterBuses(list, l, bus.at, { now });
    const delta = bus.at - l.dep;
    if (Math.abs(delta) < 60_000) continue;
    changed = true;
    // This bus and what follows it move with it, up to the next train (which keeps its time).
    let k = i;
    for (; k < legs.length; k++) {
      if (k > i && FIXED.has(legs[k].mode)) break;
      legs[k] = { ...legs[k], dep: legs[k].dep + delta, arr: legs[k].arr + delta };
    }
    if (k < legs.length && legs[k - 1].arr + 60_000 > legs[k].dep) miss = `可能趕不上 ${legs[k].short || legs[k].name}`;
    // The way to the first bus: you leave so as to be there a minute before it.
    if (i === first) for (let a = 0; a < i; a++) legs[a] = { ...legs[a], dep: legs[a].dep + delta, arr: legs[a].arr + delta };
    if (legs[0].dep < now - 60_000) {
      const back = now - legs[0].dep;
      for (let a = 0; a < i; a++) legs[a] = { ...legs[a], dep: legs[a].dep + back, arr: legs[a].arr + back };
    }
  }
  const out = changed ? finish({ ...plan, legs }) : { ...plan, legs };
  out.live = legs.some(l => l.live);
  if (miss) out.miss = miss;
  if (off) out.off = off;
  return out;
}

// ---- A direct bus between two places ---------------------------------------------------------

const BUS_M_MIN = 350; // about 21 km/h, stops included roughly
const STOP_SEC = 20;

// How long a bus takes from stop i to stop j of a way: the timetable's own
// minutes when a trip lists both, else the distance along its stops.
export function rideTime(way, i, j, sched = null) {
  if (sched?.length) {
    const a = way.stops[i].uid;
    const b = way.stops[j].uid;
    for (const r of sched) {
      if (Number(r.Direction) !== way.dir) continue;
      for (const t of r.Timetables || []) {
        const x = (t.StopTimes || []).find(s => s.StopUID === a);
        const y = (t.StopTimes || []).find(s => s.StopUID === b);
        const hm = s => {
          const [h, m] = String(s.DepartureTime || s.ArrivalTime || '').split(':').map(Number);
          return Number.isFinite(h) ? h * 60 + m : null;
        };
        if (x && y && hm(x) != null && hm(y) != null && hm(y) > hm(x)) return (hm(y) - hm(x)) * 60;
      }
    }
  }
  let m = 0;
  for (let k = i; k < j; k++) m += meters(way.stops[k].lat, way.stops[k].lon, way.stops[k + 1].lat, way.stops[k + 1].lon);
  return Math.round(((m * 1.15) / BUS_M_MIN) * 60 + (j - i - 1) * STOP_SEC);
}

const walkTo = (a, b, dep) => {
  const dist = Math.round(meters(a.lat, a.lon, b.lat, b.lon) * 1.3);
  const dur = walkSec(dist / 1.3);
  return { mode: 'walk', from: { name: a.name || '', lat: a.lat, lon: a.lon }, to: { name: b.name || '', lat: b.lat, lon: b.lon }, dur, dist, dep, arr: dep + dur * 1000, straight: true };
};

// The buses from within `fromM` of a to within `toM` of b with no change,
// leaving after `at`: up to `n` plans [walk, bus, walk], soonest there first.
// Live times when the bus is due within 90 minutes, else the timetable's.
export async function busLink(a, b, at = Date.now(), { fromM = 450, toM = 700, n = 2, routes = 6, now = Date.now(), trace = null } = {}) {
  if (meters(a.lat, a.lon, b.lat, b.lon) < 800) return [];
  const [boardSt, alightSt] = await Promise.all([stationsNear(a.lat, a.lon), stationsNear(b.lat, b.lon)]);
  const boards = boardSt.filter(s => meters(a.lat, a.lon, s.lat, s.lon) <= fromM);
  const alights = alightSt.filter(s => meters(b.lat, b.lon, s.lat, s.lon) <= toM);
  if (!boards.length || !alights.length) return [];
  // Routes stopping at both ends.
  const there = new Map();
  for (const s of alights)
    for (const x of s.stops) {
      if (!there.has(x.routeUID)) there.set(x.routeUID, []);
      there.get(x.routeUID).push({ ...x, st: s });
    }
  const cands = new Map();
  for (const s of boards) for (const x of s.stops) if (there.has(x.routeUID) && !cands.has(x.routeUID)) cands.set(x.routeUID, { route: x.route, uid: x.routeUID });
  // What was found, for the 除錯紀錄: the lines near each end, and those at both.
  if (trace) Object.assign(trace, { near: [...new Set(boards.flatMap(s => s.stops.map(x => x.route)))], there: [...new Set(alights.flatMap(s => s.stops.map(x => x.route)))], both: [...cands.values()].map(c => c.route), kept: [], why: [] });
  if (!cands.size) return [];
  const live = at - now < 90 * MIN ? await etaNear(a.lat, a.lon, fromM).catch(() => []) : [];
  const out = [];
  // Each line looked at side by side (its stops and timetable are asks of their own).
  await Promise.all([...cands.values()].slice(0, routes).map(async c => {
    const route = { uid: c.uid, name: c.route, city: routeCity(c.uid) };
    let ways;
    try {
      ways = await routeStops(route, a);
    } catch {
      return void trace?.why.push(`${c.route}: no stops`);
    }
    const sched = await routeSchedule(route, a).catch(() => []);
    const boardUIDs = new Set(boards.flatMap(s => s.stops.filter(x => x.routeUID === c.uid).map(x => x.stopUID)));
    const alightUIDs = new Set(there.get(c.uid).map(x => x.stopUID));
    let best = null;
    for (const w of ways) {
      const is = w.stops.map((s, k) => (boardUIDs.has(s.uid) ? k : -1)).filter(k => k >= 0);
      const js = w.stops.map((s, k) => (alightUIDs.has(s.uid) ? k : -1)).filter(k => k >= 0);
      for (const i of is)
        for (const j of js) {
          if (j <= i) continue;
          const bs = w.stops[i];
          const as = w.stops[j];
          const cost = walkSec(meters(a.lat, a.lon, bs.lat, bs.lon)) + rideTime(w, i, j, sched) + walkSec(meters(as.lat, as.lon, b.lat, b.lon));
          if (!best || cost < best.cost) best = { w, i, j, cost };
        }
    }
    if (!best) return void trace?.why.push(`${c.route}: not this way round`);
    const { w, i, j } = best;
    const bs = w.stops[i];
    const as = w.stops[j];
    const w1 = walkTo(a, bs, at);
    const ready = w1.arr;
    // When the bus comes: TDX's estimate, else today's timetable at that stop.
    let dep = null;
    let isLive = false;
    const lt = liveTimes(live, c.route, now, { dir: w.dir, routeUID: c.uid });
    const t = lt.times.find(x => x.at >= ready - 30_000);
    if (t) {
      dep = t.at;
      isLive = !t.planned;
    } else if (sched.length) {
      dep = departuresAt(sched, w, i, ready - 30_000, 1)[0] ?? null;
    }
    if (dep == null || dep - ready > 75 * MIN) return void trace?.why.push(`${c.route}: ${dep == null ? 'no bus now' : 'next in over 75 min'}`);
    const ride = rideTime(w, i, j, sched);
    const bus = { mode: 'bus', name: c.route, short: c.route, headsign: w.headsign, from: { name: bs.name, lat: bs.lat, lon: bs.lon }, to: { name: as.name, lat: as.lat, lon: as.lon }, dep, arr: dep + ride * 1000, dur: ride, stops: j - i, dist: Math.round(meters(bs.lat, bs.lon, as.lat, as.lon) * 1.3), agency: '', route: { uid: c.uid, city: route.city, dir: w.dir, stopUID: bs.uid }, ...(isLive ? { live: { at: dep } } : {}) };
    // The buses after it (its card's times): TDX's, else the timetable's, else its headway.
    const later = lt.times.filter(x => x.at > dep + MIN).map(x => x.at);
    for (const t of departuresAt(sched, w, i, dep + MIN, 4)) if (later.length < 3 && !later.some(x => Math.abs(x - t) < 3 * MIN)) later.push(t);
    bus.next = later.sort((x, y) => x - y).slice(0, 3);
    const legs = [];
    if (w1.dist > 20) legs.push({ ...w1, dep: dep - 60_000 - w1.dur * 1000, arr: dep - 60_000 });
    legs.push(bus);
    const w2 = walkTo(as, b, bus.arr);
    if (w2.dist > 20) legs.push(w2);
    out.push(finish({ src: 'bus', legs, live: isLive }));
    trace?.kept.push(c.route);
    }));
  return out.sort((x, y) => x.arr - y.arr).slice(0, n);
}
