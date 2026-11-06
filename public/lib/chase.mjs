// 追公車: a bus you'd miss at your stop, caught further along its way by
// YouBike (the owner, 2026-11-03: 快捷8號支, ridden to 公三公園 to catch it).
// Of the stops between where the ride boards and where it gets off, within
// a ride of you, each bus TDX sees due there ahead of the one you'd catch
// walking, that a YouBike gets you to with room to spare (chaseSlack): the
// earliest such bus, then the shortest ride to it. Only buses seen on the
// road, by a feed that's still live: a timetable's time is a guess a chase
// can't stake on.
// (Jay 2026-11-06: "it keep switching between the close one and the further
// one, and the further one … not safe enough to catch it".) So a chase is
// offered only when it clearly helps (chaseGain), at the stop well before the
// bus by what can go wrong on the way (chaseSlack), kept while it can still
// be made (chaseHold, plan.mjs; chaseNow), and once a trip shows one of the
// two, the other takes its place only when it's there CHASE_SWITCH sooner or
// the shown one can't be made any more (steadyLead).
//
//   chasePlan  one plan, its first bus caught further on (pure: data given)
//   chases     the plans' chases, the data asked for (the planner)
//   chaseNow   a chase planned earlier, from now (rolled on, or null: missed)
//   steadyLead the near stop or the further one, whichever a trip showed, kept

import { meters, isRide, RAIL } from './util.mjs';
import { bikeTrip, finish, pickSig, chaseHold, BUS_EARLY } from './plan.mjs';
import { rideTime, wayAt } from './live.mjs';
import { routeEta, etaFor } from './bus.mjs';
import { bikesAround } from './near.mjs';

const MIN = 60_000;
// Further than this from you, a stop isn't chased to (a ride of about 20 minutes).
export const CHASE_M = 4500;
// Worth it only when it gets you there clearly sooner: 8 minutes at least,
// and half the riding it takes (20 minutes on a bike to be in 6 sooner is no help).
export const chaseGain = rideMs => Math.max(8 * MIN, rideMs / 2);
// How long before the bus to be at the stop: the 2 minutes of any bus seen
// live, and what can go wrong on the way there (a red light, a bike hard to
// find: 15% of the trip to the stop) and with the bus (one due further off is
// a looser guess: 10% of its countdown), 4 minutes at least.
export const chaseSlack = (toStopMs, dueInMs) => Math.round(Math.max(4 * MIN, BUS_EARLY.live + 0.15 * Math.max(0, toStopMs) + 0.1 * Math.max(0, dueInMs)));
// A trip that showed the near stop (or the further one) keeps showing it
// unless the other gets you there this much sooner.
export const CHASE_SWITCH = 10 * MIN;

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
    // The bus you'd catch walking, there; a bus ahead of it you're at the stop for, with room to spare.
    const usual = l.dep + toK;
    const t = due(k).filter(a => a >= there + chaseSlack(there - start, a - start) && a <= usual - 2 * MIN).sort((a1, a2) => a1 - a2)[0];
    if (t == null) continue;
    const ride = legs.filter(y => y.mode === 'bike').reduce((a, y) => a + y.dur, 0);
    // (Which bus: by when it's at your own stop; the earliest, then the least riding.)
    const bus = t - toK;
    if (!best || bus < best.bus - 2 * MIN || (Math.abs(bus - best.bus) <= 2 * MIN && ride < best.ride)) best = { k, legs, t, ride, bus, there };
  }
  if (!best) return null;
  const s = w.stops[best.k];
  const dur = rideTime(w, best.k, j, sched, best.t);
  const { next, nextP, seen, poly, ...rest } = l;
  // (`slack`: how early it has you there; `by`: the latest you can set out and still be.)
  const slack = chaseSlack(best.there - start, best.t - start);
  const chase = { from: l.from.name, k: best.k, slack, by: best.t - slack - (best.there - start) };
  const bus = { ...rest, from: { name: s.name, lat: s.lat, lon: s.lon }, dep: best.t, arr: best.t + dur * 1000, dur, stops: j - best.k, route: { ...l.route, stopUID: s.uid }, live: { at: best.t }, path: w.stops.slice(best.k, j + 1).filter(y => y.lat != null).map(y => [y.lat, y.lon]), chase };
  // What follows the bus moves with it, up to a train (which keeps its time).
  const d = bus.arr - l.arr;
  const after = [];
  let rail = false;
  for (const y of p.legs.slice(b + 1)) {
    rail ||= RAIL.has(y.mode);
    after.push(rail ? y : { ...y, dep: y.dep + d, arr: y.arr + d });
  }
  const out = finish({ ...p, src: 'chase', base: p.src, legs: [...best.legs, bus, ...after], live: true });
  return out.arr <= p.arr - chaseGain(best.ride * 1000) ? out : null;
}

// A plan whose first bus is caught further on by bike: that bus's leg.
export const chaseOf = p => p?.legs?.find(l => l.mode === 'bus' && l.chase) || null;

// A chase planned a while ago, now: its way to the bus set out from now
// while there's still time to be at the stop chaseHold before it (`by` keeps
// all its room; a little of it may go); past that, null (the near stop's way).
export function chaseNow(p, now = Date.now()) {
  const b = chaseOf(p);
  if (!b) return p;
  const by = b.chase.by ?? b.dep - b.chase.slack - (b.dep - p.dep);
  if (now > by + b.chase.slack - chaseHold(b)) return null;
  if (p.dep >= now) return p;
  const d = now - p.dep;
  const i = p.legs.indexOf(b);
  return finish({ ...p, legs: p.legs.map((l, k) => (k < i ? { ...l, dep: l.dep + d, arr: l.arr + d } : l)) });
}

// A trip's ways found again (or the later round in): the near stop's way
// and the chase of the same bus line share one card (pickSig), and the one the
// card showed keeps it while it's still there and can be made, unless the
// other gets you there CHASE_SWITCH sooner. `prev`: the ways shown before.
// The list keeps its order (a card's times point into it).
export function steadyLead(next, prev, now = Date.now()) {
  if (!next?.length || !prev?.length) return next;
  const live = p => p.dep >= now - 2 * MIN && !p.lost;
  const kind = p => (chaseOf(p) ? `chase:${chaseOf(p).from?.name || ''}` : 'near');
  let out = next;
  for (const was of prev.filter(p => p.lead && live(p))) {
    const sig = pickSig(was);
    const n = out.findIndex(p => p.lead && pickSig(p) === sig);
    if (n < 0 || kind(out[n]) === kind(was) || (!chaseOf(out[n]) && !chaseOf(was))) continue;
    let k = -1;
    out.forEach((p, j) => {
      if (j !== n && !p.lead && live(p) && pickSig(p) === sig && kind(p) === kind(was) && (k < 0 || p.dep < out[k].dep)) k = j;
    });
    if (k < 0 || out[k].arr - out[n].arr >= CHASE_SWITCH) continue;
    const [N, K] = [out[n], out[k]];
    out = out.slice();
    out[k] = { ...K, lead: true, top: N.top, weak: N.weak, tags: N.tags, score: N.score, times: N.times };
    out[n] = { ...N, lead: false, top: false };
  }
  return out;
}

// A route's buses due at each stop of one way, from TDX's estimates (now).
const dueOf = (map, l, w, now) => k => {
  const v = etaFor(map, { stopUID: w.stops[k].uid, routeUID: l.route.uid, dir: w.dir });
  // (A feed that stopped, 3–12 minutes behind in 新竹縣: its bus may be well past what it says.)
  if (!v || v.status !== 0 || v.stale) return [];
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
