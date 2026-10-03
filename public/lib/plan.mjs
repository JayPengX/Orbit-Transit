// Route plans: the proxy's (Google's transit routes and TDX's planner) plus
// plans of our own that use YouBike where it's faster, ranked and labelled.
//
// YouBike ideas, each checked against the bikes and docks there now:
//   - all the way by bike (or 電輔車, faster) when it's near enough;
//   - by bike to the train or metro, instead of a bus or a long walk to it:
//     you can leave later and still make the same train;
//   - by bike from the last station, instead of a bus or a long walk: there
//     sooner.

import { meters, walkSec } from './util.mjs';
import { journeys } from './rail.mjs';

export const RIDE_M_MIN = { bike: 230, ebike: 300 }; // about 14 and 18 km/h
export const DOCK_SEC = 60; // taking or returning a bike
export const BIKE_MAX_M = 12_000; // further than this, nobody wants to ride
export const NEAR_M = 500; // a station farther than this from where you are isn't "here"
const RAIL = new Set(['metro', 'tra', 'hsr', 'lightrail']);

export const rideSec = (m, ebike = false) => Math.round(((m * 1.25) / (ebike ? RIDE_M_MIN.ebike : RIDE_M_MIN.bike)) * 60);

// A station (bike.mjs): { uid, name, lat, lon, bikes (regular), ebike, ret (docks), ok }.
// The best one to take a bike from near a point: the nearest with a bike
// (with two or more preferred if it's barely farther).
export function rentNear(pt, bikes, { ebike = false, max = NEAR_M } = {}) {
  const has = s => s.ok !== false && (ebike ? s.ebike : s.bikes) >= 1;
  const list = bikes.filter(has).map(s => ({ s, d: meters(pt.lat, pt.lon, s.lat, s.lon) })).filter(x => x.d <= max).sort((a, b) => a.d - b.d);
  if (!list.length) return null;
  const n = ebike ? x => x.s.ebike : x => x.s.bikes;
  const better = list.find(x => n(x) >= 2 && x.d <= list[0].d + 150);
  return (better || list[0]).s;
}
export function returnNear(pt, bikes, { max = NEAR_M } = {}) {
  const list = bikes.filter(s => s.ok !== false && s.ret >= 1).map(s => ({ s, d: meters(pt.lat, pt.lon, s.lat, s.lon) })).filter(x => x.d <= max).sort((a, b) => a.d - b.d);
  if (!list.length) return null;
  const better = list.find(x => x.s.ret >= 2 && x.d <= list[0].d + 150);
  return (better || list[0]).s;
}

const walkLeg = (from, to, dep) => {
  const dist = Math.round(meters(from.lat, from.lon, to.lat, to.lon) * 1.3);
  const dur = walkSec(dist / 1.3);
  return { mode: 'walk', from: { name: from.name || '', lat: from.lat, lon: from.lon }, to: { name: to.name || '', lat: to.lat, lon: to.lon }, dur, dist, dep, arr: dep + dur * 1000, straight: true };
};

// From a to b by YouBike, leaving at dep: walk, ride, walk. Null when there's
// no bike near a or no dock near b.
export function bikeTrip(a, b, bikes, dep, { ebike = false } = {}) {
  const rent = rentNear(a, bikes, { ebike });
  const ret = returnNear(b, bikes);
  if (!rent || !ret || rent.uid === ret.uid) return null;
  const legs = [];
  let t = dep;
  const w1 = walkLeg(a, { ...rent, name: rent.name }, t);
  if (w1.dist > 20) {
    legs.push(w1);
    t = w1.arr;
  }
  const dist = Math.round(meters(rent.lat, rent.lon, ret.lat, ret.lon) * 1.25);
  const dur = rideSec(dist / 1.25, ebike) + 2 * DOCK_SEC;
  legs.push({ mode: 'bike', ebike, name: ebike ? 'YouBike 電輔車' : 'YouBike', from: { name: rent.name, lat: rent.lat, lon: rent.lon }, to: { name: ret.name, lat: ret.lat, lon: ret.lon }, dur, dist, dep: t, arr: t + dur * 1000, rent, ret });
  t += dur * 1000;
  const w2 = walkLeg({ ...ret }, b, t);
  if (w2.dist > 20) legs.push(w2);
  return legs;
}

export function finish(p) {
  const legs = p.legs;
  const rides = legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
  const dep = legs[0].dep;
  const arr = legs.at(-1).arr;
  return { ...p, dep, arr, dur: Math.round((arr - dep) / 1000), walk: legs.filter(l => l.mode === 'walk').reduce((a, l) => a + (l.dist || 0), 0), transfers: Math.max(0, rides.length - 1), bike: legs.some(l => l.mode === 'bike') };
}
const shift = (legs, ms) => legs.map(l => ({ ...l, dep: l.dep + ms, arr: l.arr + ms }));

// All the way by bike (and by 電輔車 when one is there and it's worth it).
export function bikeOnly(o, d, bikes, now) {
  const dist = meters(o.lat, o.lon, d.lat, d.lon);
  if (dist > BIKE_MAX_M || dist < 300) return [];
  const out = [];
  const plain = bikeTrip(o, d, bikes, now);
  if (plain) out.push(finish({ src: 'bike', legs: plain }));
  if (dist >= 2000) {
    const e = bikeTrip(o, d, bikes, now, { ebike: true });
    if (e) out.push(finish({ src: 'bike', legs: e }));
  }
  return out;
}

// The plan with its start swapped for a bike ride to its first train or
// metro: the same train, leaving later. Only when it replaces a bus or a
// walk of 600 m or more.
export function bikeToRail(plan, o, bikes) {
  const k = plan.legs.findIndex(l => RAIL.has(l.mode));
  if (k <= 0) return null;
  const before = plan.legs.slice(0, k);
  if (!before.some(l => l.mode === 'bus') && before.reduce((a, l) => a + (l.mode === 'walk' ? l.dist || 0 : 0), 0) < 600) return null;
  const board = plan.legs[k];
  if (!board.from?.lat || meters(o.lat, o.lon, board.from.lat, board.from.lon) > 6000) return null;
  const ride = bikeTrip(o, board.from, bikes, 0);
  if (!ride) return null;
  const took = ride.at(-1).arr; // from 0
  const leave = board.dep - 2 * 60_000 - took;
  if (leave <= plan.dep + 60_000) return null; // not later than the plan already leaves
  return finish({ src: 'bike+', base: plan.src, legs: [...shift(ride, leave), ...plan.legs.slice(k)] });
}

// The plan's end swapped for a bike ride from its last train or metro.
export function bikeFromRail(plan, d, bikes) {
  let k = -1;
  plan.legs.forEach((l, i) => RAIL.has(l.mode) && (k = i));
  if (k < 0 || k === plan.legs.length - 1) return null;
  const after = plan.legs.slice(k + 1);
  if (!after.some(l => l.mode === 'bus') && after.reduce((a, l) => a + (l.mode === 'walk' ? l.dist || 0 : 0), 0) < 600) return null;
  const off = plan.legs[k];
  if (!off.to?.lat || meters(off.to.lat, off.to.lon, d.lat, d.lon) > 6000) return null;
  const ride = bikeTrip(off.to, d, bikes, off.arr + 60_000);
  if (!ride) return null;
  const legs = [...plan.legs.slice(0, k + 1), ...ride];
  if (legs.at(-1).arr >= plan.arr - 60_000) return null; // not sooner
  return finish({ src: 'bike+', base: plan.src, legs });
}

// Trains of our own router (台鐵 + 高鐵, the changes included) between the
// stations near both ends, for trips the planners answer with buses only.
// `net` is raildata's railNetwork. Walks to and from the stations up to 2 km.
export const RAIL_WALK_M = 2000;
export function railPlans(net, o, d, at, { n = 4 } = {}) {
  if (!net || meters(o.lat, o.lon, d.lat, d.lon) < 3000) return [];
  const near = pt =>
    [...net.st.values()]
      .map(s => ({ s, m: meters(pt.lat, pt.lon, s.lat, s.lon) }))
      .filter(x => x.m <= RAIL_WALK_M)
      .sort((a, b) => a.m - b.m)
      .slice(0, 3);
  const A = near(o);
  const B = near(d);
  if (!A.length || !B.length) return [];
  const starts = A.map(x => ({ key: x.s.key, at: at + walkSec(x.m) * 1000 + 3 * 60_000 }));
  const ends = B.map(x => ({ key: x.s.key, extra: walkSec(x.m) }));
  let found = [];
  try {
    found = journeys(net, starts, ends, at, { n });
  } catch {
    return [];
  }
  const pt = k => {
    const s = net.st.get(k);
    return { name: s.sys === 'hsr' ? `高鐵${s.name.replace(/^高鐵/, '')}` : s.name, lat: s.lat, lon: s.lon };
  };
  return found.map(j => {
    const legs = [];
    const first = j.legs[0];
    const w1 = walkLeg(o, pt(first.from), 0);
    // At the station 3 minutes before the train (or the walk on to the other railway).
    const ready = first.walk ? first.dep : first.dep - 3 * 60_000;
    if (w1.dist > 20) legs.push({ ...w1, dep: ready - w1.dur * 1000, arr: ready });
    for (const l of j.legs) {
      if (l.walk) legs.push({ ...walkLeg(pt(l.from), pt(l.to), l.dep), arr: l.arr });
      else
        legs.push({
          mode: l.trip.sys,
          name: l.trip.sys === 'hsr' ? '高鐵' : l.trip.typeFull || l.trip.type,
          short: l.trip.sys === 'hsr' ? `${l.trip.no} 次` : `${l.trip.type} ${l.trip.no}`,
          headsign: l.trip.headsign,
          from: pt(l.from),
          to: pt(l.to),
          dep: l.dep,
          arr: l.arr,
          dur: Math.round((l.arr - l.dep) / 1000),
          stops: l.stops,
          agency: l.trip.sys === 'hsr' ? '台灣高鐵' : l.trip.typeFull || '台鐵',
          dist: Math.round(meters(net.st.get(l.from).lat, net.st.get(l.from).lon, net.st.get(l.to).lat, net.st.get(l.to).lon)),
          train: { sys: l.trip.sys, no: l.trip.no, code: l.trip.code }
        });
    }
    const last = j.legs.filter(l => !l.walk).at(-1);
    const w2 = walkLeg(pt(j.end), d, last.arr);
    if (w2.dist > 20) legs.push(w2);
    return finish({ src: 'rail', legs });
  });
}

// Everything, ranked: the soonest there first. Each gets its labels.
export function rank(plans, { now = Date.now() } = {}) {
  const ok = plans.filter(p => p && p.legs?.length && p.arr != null && p.arr > now - 60_000);
  // Every plan is shown, however much later it arrives (the owner's ask): every
  // transit plan, and YouBike's ideas around them up to 12 in all, soonest first.
  const sig = p => p.legs.map(l => `${l.mode}:${l.short || l.name || ''}:${Math.round((l.dep || 0) / 60_000)}`).join('|');
  const seen = new Set();
  const uniq = ok.filter(p => !seen.has(sig(p)) && seen.add(sig(p))).sort((a, b) => a.arr - b.arr || a.dur - b.dur);
  const transit = uniq.filter(p => !p.bike);
  const bikes = uniq.filter(p => p.bike).slice(0, Math.max(4, 12 - transit.length));
  const list = [...transit, ...bikes].sort((a, b) => a.arr - b.arr || a.dur - b.dur);
  if (!list.length) return [];
  const label = new Map(list.map(p => [p, []]));
  const by = (f, name) => {
    const best = list.reduce((a, b) => (f(b) < f(a) ? b : a));
    if (list.filter(p => f(p) === f(best)).length < list.length) label.get(best).push(name);
  };
  label.get(list[0]).push('最快抵達');
  by(p => p.dur, '最省時');
  by(p => p.transfers, '最少轉乘');
  by(p => p.walk, '最少步行');
  for (const p of list) if (p.bike) label.get(p).push(p.legs.some(l => l.ebike) ? '電輔車' : 'YouBike');
  return list.map(p => ({ ...p, tags: [...new Set(label.get(p))] }));
}

// Our plans added to the proxy's, from the bikes near both ends and the stations.
export function withBikes(plans, o, d, bikes, now = Date.now()) {
  const out = [...plans];
  if (bikes.length) {
    out.push(...bikeOnly(o, d, bikes, now));
    for (const p of plans) {
      const a = bikeToRail(p, o, bikes);
      const b = bikeFromRail(p, d, bikes);
      if (a) out.push(a);
      if (b) out.push(b);
      if (a) {
        const ab = bikeFromRail(a, d, bikes);
        if (ab) out.push(ab);
      }
    }
  }
  return rank(out, { now });
}

// The points whose YouBike stations a set of plans needs: both ends, and
// where each plan first boards and last leaves a train or metro.
export function bikePoints(plans, o, d) {
  const pts = [o, d];
  for (const p of plans) {
    const rail = p.legs.filter(l => RAIL.has(l.mode));
    if (rail[0]?.from?.lat) pts.push(rail[0].from);
    if (rail.at(-1)?.to?.lat) pts.push(rail.at(-1).to);
  }
  // One per ~400 m.
  const out = [];
  for (const p of pts) if (!out.some(q => meters(p.lat, p.lon, q.lat, q.lon) < 400)) out.push({ lat: p.lat, lon: p.lon });
  return out.slice(0, 6);
}
