// 追公車: a bus you'd miss at your stop, caught further along its way by
// YouBike (the owner, 2026-11-03: 快捷8號支, ridden to 公三公園 to catch it).
// Of the stops between where the ride boards and where it gets off, within
// a ride of you, each bus TDX sees due there ahead of the one you'd catch
// walking, that a YouBike gets you to BUS_EARLY.live before it: the earliest
// such bus, then the shortest ride to it. Only buses seen on the road: a
// timetable's time is a guess a chase can't stake on.
//
//   chasePlan  one plan, its first bus caught further on (pure: data given)
//   chases     the plans' chases, the data asked for (the planner)
//   chaseFrom  from where you are, for the bus you're walking to (navigation)

import { meters, isRide, RAIL } from './util.mjs';
import { bikeTrip, finish, walkLeg, BUS_EARLY } from './plan.mjs';
import { rideTime, wayAt } from './live.mjs';
import { routeEta, etaFor } from './bus.mjs';
import { bikesAround } from './near.mjs';

const MIN = 60_000;
// Further than this from you, a stop isn't chased to (a ride of about 20 minutes).
export const CHASE_M = 4500;
// Worth it only when it gets you there this much sooner.
const GAIN = 3 * MIN;

// `p`: a plan whose first ride is a bus (a walk to it); `x`: its way and stop
// ({ w, i, sched }: live.mjs wayAt); `due(k)`: the moments buses are due at
// stop k of the way (TDX's); `bikes`: the YouBike stations around; `start`:
// when you set out. → the plan with its first bus caught by bike, or null.
export function chasePlan(p, o, x, due, bikes, start, { prefer = false } = {}) {
  const b = p.legs.findIndex(isRide);
  const l = p.legs[b];
  if (b < 0 || l.mode !== 'bus' || !x?.w || l.to?.lat == null || p.legs.slice(0, b).some(y => y.mode === 'bike')) return null;
  const { w, i, sched } = x;
  // Where it gets off: the stop of its way nearest the leg's end, after where it boards.
  let j = -1;
  for (let k = i + 1; k < w.stops.length; k++) if (j < 0 || meters(w.stops[k].lat, w.stops[k].lon, l.to.lat, l.to.lon) < meters(w.stops[j].lat, w.stops[j].lon, l.to.lat, l.to.lon)) j = k;
  if (j < 0) return null;
  let best = null;
  for (let k = i + 1; k < j; k++) {
    const s = w.stops[k];
    if (s.lat == null || meters(o.lat, o.lon, s.lat, s.lon) > CHASE_M) continue;
    const legs = bikeTrip(o, { name: s.name, lat: s.lat, lon: s.lon }, bikes, start, { first: true, prefer });
    if (!legs?.some(y => y.mode === 'bike')) continue;
    const there = legs.at(-1).arr;
    const toK = rideTime(w, i, k, sched, l.dep) * 1000;
    // The bus you'd catch walking, there; a bus ahead of it you're at the stop for.
    const usual = l.dep + toK;
    const t = due(k).filter(a => a >= there + BUS_EARLY.live && a <= usual - 2 * MIN).sort((a1, a2) => a1 - a2)[0];
    if (t == null) continue;
    const ride = legs.filter(y => y.mode === 'bike').reduce((a, y) => a + y.dur, 0);
    // (Which bus: by when it's at your own stop; the earliest, then the least riding.)
    const bus = t - toK;
    if (!best || bus < best.bus - 2 * MIN || (Math.abs(bus - best.bus) <= 2 * MIN && ride < best.ride)) best = { k, legs, t, ride, bus };
  }
  if (!best) return null;
  const s = w.stops[best.k];
  const dur = rideTime(w, best.k, j, sched, best.t);
  const { next, nextP, seen, poly, ...rest } = l;
  const bus = { ...rest, from: { name: s.name, lat: s.lat, lon: s.lon }, dep: best.t, arr: best.t + dur * 1000, dur, stops: j - best.k, route: { ...l.route, stopUID: s.uid }, live: { at: best.t }, path: w.stops.slice(best.k, j + 1).filter(y => y.lat != null).map(y => [y.lat, y.lon]), chase: { from: l.from.name, k: best.k } };
  // What follows the bus moves with it, up to a train (which keeps its time).
  const d = bus.arr - l.arr;
  const after = [];
  let rail = false;
  for (const y of p.legs.slice(b + 1)) {
    rail ||= RAIL.has(y.mode);
    after.push(rail ? y : { ...y, dep: y.dep + d, arr: y.arr + d });
  }
  const out = finish({ ...p, src: 'chase', base: p.src, legs: [...best.legs, bus, ...after], live: true });
  return out.arr <= p.arr - GAIN ? out : null;
}

// A route's buses due at each stop of one way, from TDX's estimates (now).
const dueOf = (map, l, w, now) => k => {
  const v = etaFor(map, { stopUID: w.stops[k].uid, routeUID: l.route.uid, dir: w.dir });
  if (!v || v.status !== 0) return [];
  return [v.sec, ...(v.more || [])].filter(Number.isFinite).map(sec => now + sec * 1000);
};
// The YouBike stations near you and near each stop you could chase to.
async function bikesFor(o, w, i, { near = bikesAround } = {}) {
  const pts = [o, ...w.stops.slice(i + 1).filter(s => s.lat != null && meters(o.lat, o.lon, s.lat, s.lon) <= CHASE_M)];
  const lists = await Promise.all(pts.map(pt => near(pt.lat, pt.lon).catch(() => [])));
  return [...new Map(lists.flat().map(s => [s.uid, s])).values()];
}

// The planner's plans whose first bus is due within the hour and walked to:
// each one's chase, where there is one (a route asked once).
export async function chases(plans, o, now = Date.now(), start = now, { prefer = false, routes = 3, eta = routeEta, way = wayAt, near = bikesAround } = {}) {
  const first = p => p.legs.find(isRide);
  const cands = plans.filter(p => {
    const l = first(p);
    return l?.mode === 'bus' && l.route?.uid && l.dep > now - 2 * MIN && l.dep < now + 60 * MIN && !p.legs.slice(0, p.legs.indexOf(l)).some(y => y.mode === 'bike');
  });
  const keys = [...new Set(cands.map(p => first(p).route.uid))].slice(0, routes);
  const data = new Map();
  await Promise.all(
    keys.map(async uid => {
      const l = first(cands.find(p => first(p).route.uid === uid));
      const x = await way(l).catch(() => null);
      if (!x) return;
      const [map, bikes] = await Promise.all([eta({ uid, name: l.short || l.name, city: l.route.city }, x.w.dir).catch(() => null), bikesFor(o, x.w, x.i, { near })]);
      if (map) data.set(uid, { x, map, bikes });
    })
  );
  const out = [];
  for (const p of cands) {
    const l = first(p);
    const d = data.get(l.route.uid);
    // (Its own way and stop: another plan's bus of the same line may board elsewhere.)
    if (!d || d.x.w.dir !== l.route.dir || d.x.w.stops[d.x.i]?.uid !== l.route.stopUID) continue;
    const c = chasePlan(p, o, d.x, dueOf(d.map, l, d.x.w, now), d.bikes, start, { prefer });
    if (c && !out.some(q => q.legs.find(isRide).dep === c.legs.find(isRide).dep && q.legs.find(isRide).from.name === c.legs.find(isRide).from.name)) out.push(c);
  }
  return out;
}

// Navigating, walking to a bus you'll now miss (or that's gone): from where
// you are, its line caught further on by bike, the rest of the trip after it.
// `legs`: the trip from that bus on. → a plan, or null.
export async function chaseFrom(pos, legs, now = Date.now(), { prefer = false, eta = routeEta, way = wayAt, near = bikesAround } = {}) {
  const l = legs[0];
  if (l?.mode !== 'bus' || !l.route?.uid || !pos) return null;
  const x = await way(l).catch(() => null);
  if (!x) return null;
  const [map, bikes] = await Promise.all([eta({ uid: l.route.uid, name: l.short || l.name, city: l.route.city }, x.w.dir).catch(() => null), bikesFor(pos, x.w, x.i, { near })]);
  if (!map) return null;
  const here = { name: '', lat: pos.lat, lon: pos.lon };
  // (The walk to its stop from here: the chase is weighed against walking there now.)
  const p = finish({ legs: [walkLeg(here, l.from, now), ...legs] });
  return chasePlan(p, here, x, dueOf(map, l, x.w, now), bikes, now, { prefer });
}
