// Route plans: the proxy's (Google's transit routes and TDX's planner) plus
// plans of our own that use YouBike where it's faster, ranked by what's
// practical (not only the soonest there: few changes, heading the right way,
// little walking, what it costs you) and labelled.
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
export const SWAP_SEC = 30 * 60; // YouBike's free (TPASS) or cheapest first half hour
const RAIL = new Set(['metro', 'tra', 'hsr', 'lightrail']);

// Which of the person's allowed ways of moving a leg is (lightrail is the metro's).
const KIND = { bus: 'bus', tra: 'tra', hsr: 'hsr', metro: 'metro', lightrail: 'metro', bike: 'bike' };
// A plan uses only what's allowed (a taxi never: TDX sometimes ends a trip with one).
export const allowed = (p, modes) => p.legs.every(l => l.mode !== 'car' && (!KIND[l.mode] || modes?.[KIND[l.mode]] !== false));

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

// One ride from station to station, leaving at t.
const rideLeg = (rent, ret, t, ebike = false) => {
  const dist = Math.round(meters(rent.lat, rent.lon, ret.lat, ret.lon) * 1.25);
  const dur = rideSec(dist / 1.25, ebike) + 2 * DOCK_SEC;
  return { mode: 'bike', ebike, name: ebike ? 'YouBike 電輔車' : 'YouBike', from: { name: rent.name, lat: rent.lat, lon: rent.lon }, to: { name: ret.name, lat: ret.lat, lon: ret.lon }, dur, dist, dep: t, arr: t + dur * 1000, rent, ret };
};

// A ride over half an hour, cut where you can return the bike and take one
// again (每 30 分鐘換車: each half hour free with TPASS, or the cheapest):
// at a station with a dock and a bike, ~26 minutes in. Rides that can't be
// cut stay whole.
export function swapRides(legs, bikes) {
  const out = [];
  for (const l of legs) {
    if (l.mode !== 'bike' || l.dur <= SWAP_SEC || !l.rent || !l.ret) {
      out.push(l);
      continue;
    }
    let cur = l;
    for (let guard = 0; cur.dur > SWAP_SEC && guard < 4; guard++) {
      const f = (26 * 60) / cur.dur;
      const at = { lat: cur.from.lat + (cur.to.lat - cur.from.lat) * f, lon: cur.from.lon + (cur.to.lon - cur.from.lon) * f };
      const mid = bikes
        .filter(s => s.ok !== false && s.ret >= 1 && (cur.ebike ? s.ebike : s.bikes + s.ebike) >= 1 && s.uid !== cur.rent.uid && s.uid !== cur.ret.uid)
        .map(s => ({ s, d: meters(at.lat, at.lon, s.lat, s.lon) }))
        .filter(x => x.d <= 700)
        .sort((a, b) => a.d - b.d)[0]?.s;
      if (!mid) break;
      const first = rideLeg(cur.rent, mid, cur.dep, cur.ebike);
      if (first.dur > SWAP_SEC + 3 * 60) break;
      out.push(first);
      cur = { ...rideLeg(mid, cur.ret, first.arr + DOCK_SEC * 1000, cur.ebike), swap: true };
    }
    out.push(cur);
  }
  // The rest of the trip after a longer ride moves with it.
  for (let i = 1; i < out.length; i++) if (out[i].dep < out[i - 1].arr) {
    const d = out[i - 1].arr - out[i].dep;
    out[i] = { ...out[i], dep: out[i].dep + d, arr: out[i].arr + d };
  }
  return out;
}

// From a to b by YouBike, leaving at dep: walk, ride, walk. Null when there's
// no bike near a or no dock near b.
export function bikeTrip(a, b, bikes, dep, { ebike = false, swap = false } = {}) {
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
  const ride = rideLeg(rent, ret, t, ebike);
  legs.push(...(swap ? swapRides([ride], bikes) : [ride]));
  t = legs.at(-1).arr;
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
export function bikeOnly(o, d, bikes, now, { swap = false } = {}) {
  const dist = meters(o.lat, o.lon, d.lat, d.lon);
  if (dist > BIKE_MAX_M || dist < 300) return [];
  const out = [];
  const plain = bikeTrip(o, d, bikes, now, { swap });
  if (plain) out.push(finish({ src: 'bike', legs: plain }));
  if (dist >= 2000) {
    const e = bikeTrip(o, d, bikes, now, { ebike: true, swap });
    if (e) out.push(finish({ src: 'bike', legs: e }));
  }
  return out;
}

// The plan with its start swapped for a bike ride to its first train or
// metro: the same train, leaving later. Only when it replaces a bus or a
// walk of 600 m or more.
export function bikeToRail(plan, o, bikes, { anyRide = false } = {}) {
  const k = plan.legs.findIndex(l => (anyRide ? l.mode !== 'walk' && l.mode !== 'bike' : RAIL.has(l.mode)));
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
export function bikeFromRail(plan, d, bikes, { anyRide = false } = {}) {
  let k = -1;
  plan.legs.forEach((l, i) => (anyRide ? l.mode !== 'walk' && l.mode !== 'bike' : RAIL.has(l.mode)) && (k = i));
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
// With YouBike allowed, stations this far are reached by bike (竹北 → 六家, 千甲).
export const RAIL_BIKE_M = 4500;
const BIKE_OVER_M = 1200; // past this, a station is ridden to rather than walked
// Getting to (or from) a station m metres away: { mode, sec }.
const access = (m, bike) => (bike && m > BIKE_OVER_M ? { mode: 'bike', sec: rideSec(m) + 2 * DOCK_SEC + 120 } : { mode: 'walk', sec: walkSec(m) });
export function railPlans(net, o, d, at, { n = 4, bike = false, use = () => true } = {}) {
  if (!net || meters(o.lat, o.lon, d.lat, d.lon) < 3000) return [];
  const near = pt => {
    const all = [...net.st.values()].map(s => ({ s, m: meters(pt.lat, pt.lon, s.lat, s.lon) })).sort((a, b) => a.m - b.m);
    const walk = all.filter(x => x.m <= RAIL_WALK_M).slice(0, 3);
    const ride = bike ? all.filter(x => x.m > BIKE_OVER_M && x.m <= RAIL_BIKE_M && !walk.includes(x)).slice(0, 4) : [];
    return [...walk, ...ride].map(x => ({ ...x, a: access(x.m, bike) }));
  };
  const A = near(o);
  const B = near(d);
  if (!A.length || !B.length) return [];
  const starts = A.map(x => ({ key: x.s.key, at: at + x.a.sec * 1000 + 3 * 60_000 }));
  const ends = B.map(x => ({ key: x.s.key, extra: x.a.sec }));
  const reach = new Map([...A.map(x => [`a:${x.s.key}`, x]), ...B.map(x => [`b:${x.s.key}`, x])]);
  let found = [];
  try {
    found = journeys(net, starts, ends, at, { n: bike ? n + 2 : n, use });
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
    // Ridden there: a YouBike leg whose stations are found once the bikes are known (withBikes).
    const a = reach.get(`a:${first.from}`)?.a;
    if (a?.mode === 'bike') legs.push(placeholder(o, pt(first.from), ready - a.sec * 1000, ready, 'arr'));
    else if (w1.dist > 20) legs.push({ ...w1, dep: ready - w1.dur * 1000, arr: ready });
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
    const b = reach.get(`b:${j.end}`)?.a;
    const w2 = walkLeg(pt(j.end), d, last.arr);
    if (b?.mode === 'bike') legs.push(placeholder(pt(j.end), d, last.arr, last.arr + b.sec * 1000, 'dep'));
    else if (w2.dist > 20) legs.push(w2);
    return finish({ src: 'rail', legs });
  });
}
const placeholder = (from, to, dep, arr, fix) => ({ mode: 'bike', placeholder: true, fix, name: 'YouBike', from: { name: from.name || '', lat: from.lat, lon: from.lon }, to: { name: to.name || '', lat: to.lat, lon: to.lon }, dep, arr, dur: Math.round((arr - dep) / 1000), dist: Math.round(meters(from.lat, from.lon, to.lat, to.lon) * 1.25) });

// What a plan costs you, in minutes: the time until you're there, and on
// top of it each change (a bus to a bus is the riskiest: neither keeps
// time), walking past a few minutes, riding, a trip that goes the long way
// round (into 新竹市 and back out, when the place is the other way), what
// it costs in money, and a train it would now miss.
export function score(p, { o, d, now = Date.now(), by = 'depart', deadline = null, fare = 0 } = {}) {
  const rides = p.legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
  let s = by === 'arrive' && deadline ? (deadline - p.dep) / 60_000 : (p.arr - now) / 60_000;
  for (let i = 1; i < rides.length; i++) s += rides[i - 1].mode === 'bus' && rides[i].mode === 'bus' ? 10 : 7;
  s += Math.max(0, (p.walk || 0) / 75 - 6) * 0.5;
  // Riding: a few minutes to a station is nothing; riding most of the way
  // (50–70 minutes on a YouBike) is not how anyone goes every day.
  const ride = p.legs.filter(l => l.mode === 'bike').reduce((a, l) => a + (l.dur || 0) / 60, 0);
  s += Math.min(ride, 15) * 0.15 + Math.max(0, ride - 15) * 0.6;
  if (o && d) {
    const direct = Math.max(1000, meters(o.lat, o.lon, d.lat, d.lon));
    const path = p.legs.reduce((a, l) => a + (l.from?.lat != null && l.to?.lat != null ? meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon) : 0), 0);
    s += Math.max(0, path / direct - 1.2) * 45;
    // Heading away: a change made farther from the place than where you started.
    const away = rides.slice(0, -1).some(l => l.to?.lat != null && meters(l.to.lat, l.to.lon, d.lat, d.lon) > direct + 1500);
    if (away) s += 8;
  }
  s += fare / 12;
  if (p.miss) s += 25;
  if (p.off) s += 120;
  return s;
}

// The same rides (the lines, where you get on and off), whatever the walks
// and bikes around them: also what a pinned recommendation is known by.
export const ridesSig = p =>
  p.legs
    .filter(l => l.mode !== 'walk' && l.mode !== 'bike')
    .map(l => `${l.mode}:${l.short || l.name || ''}:${l.from?.name || ''}`)
    .join('|') || `bike:${p.legs.some(l => l.ebike)}`;

// A pinned recommendation's way, whatever the day's train numbers and each
// planner's names for things (快捷8號 / 快捷8, 竹北車站 / 竹北): the buses
// and metro by their line, the trains by where you get on and off.
const norm = x => String(x || '').replace(/\s+/g, '').replace(/[號线線]/g, '').replace(/[（(].*$/, '').replace(/^高鐵/, '').replace(/(火車站|車站|站)$/, '').replace(/台/g, '臺').toUpperCase();
export const pickSig = p =>
  p.legs
    .filter(l => l.mode !== 'walk' && l.mode !== 'bike')
    .map(l => (l.mode === 'tra' || l.mode === 'hsr' ? `${l.mode}:${norm(l.from?.name)}>${norm(l.to?.name)}` : `${l.mode}:${norm(l.short || l.name)}`))
    .join('|') || 'bike';

const mainLine = p => {
  const rides = p.legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
  const m = rides.reduce((a, l) => (!a || (l.dur || 0) > (a.dur || 0) ? l : a), null);
  return m ? `${m.mode}:${m.short || m.name || ''}` : `bike:${p.legs.some(l => l.ebike)}`;
};

// Everything, ranked by what's practical (score). The first few that ride
// different lines are the recommendations (`top`); the rest stay, later.
// Each gets its labels. `cost(p)` adds what a plan costs you in money.
export function rank(plans, { now = Date.now(), o = null, d = null, by = 'depart', deadline = null, cost = () => 0, top = 4, clock = Date.now() } = {}) {
  // (By an arrival time, `now` is that time: what's gone is what left before the clock's now.)
  const all = plans.filter(p => p && p.legs?.length && p.arr != null && (by === 'arrive' && deadline ? p.dep > clock - 2 * 60_000 : p.arr > now - 60_000));
  // Leaving before the time asked (a ride to the train worked out backwards
  // from it), or arriving after it, is no plan, unless it's all there is.
  const fits = all.filter(p => (by === 'arrive' && deadline ? p.arr <= deadline + 2 * 60_000 : p.dep >= now - 2 * 60_000));
  const ok = fits.length ? fits : all;
  const sig = p => p.legs.map(l => `${l.mode}:${l.short || l.name || ''}:${Math.round((l.dep || 0) / 60_000)}`).join('|');
  const seen = new Set();
  const uniq = ok.filter(p => !seen.has(sig(p)) && seen.add(sig(p)));
  const scored = uniq.map(p => ({ p, s: score(p, { o, d, now, by, deadline, fare: cost(p) }) })).sort((a, b) => a.s - b.s || a.p.arr - b.p.arr);
  // Not running at all (末班已過, 今日未營運), or waiting hours half way (the
  // last bus gone, the first train tomorrow), is no plan, unless it's all there is.
  const longWait = p => p.legs.some((l, i) => i > 0 && l.dep - p.legs[i - 1].arr > 90 * 60_000);
  const running = scored.filter(x => !x.p.off && !longWait(x.p));
  const list = (running.length ? running : scored).slice(0, 24).map(x => ({ ...x.p, score: Math.round(x.s) }));
  if (!list.length) return [];
  // Different ways first: each recommendation rides a different main line
  // (its longest ride); then, if there are fewer, different rides at all.
  const picked = new Set();
  const mains = new Set();
  const lines = new Set();
  for (const p of list) {
    if (picked.size >= top) break;
    if (mains.has(mainLine(p))) continue;
    mains.add(mainLine(p));
    lines.add(ridesSig(p));
    picked.add(p);
  }
  for (const p of list) {
    if (picked.size >= top) break;
    if (picked.has(p) || lines.has(ridesSig(p))) continue;
    lines.add(ridesSig(p));
    picked.add(p);
  }
  const label = new Map(list.map(p => [p, []]));
  const by_ = (f, name) => {
    const best = list.reduce((a, b) => (f(b) < f(a) ? b : a));
    if (list.filter(p => f(p) === f(best)).length < list.length) label.get(best).push(name);
  };
  label.get(list[0]).push('推薦');
  by_(p => p.arr, '最快抵達');
  by_(p => p.transfers, '最少轉乘');
  by_(p => p.walk, '最少步行');
  for (const p of list) if (p.bike) label.get(p).push(p.legs.some(l => l.ebike) ? '電輔車' : 'YouBike');
  for (const p of list) if (p.live) label.get(p).push('即時');
  return list.map(p => ({ ...p, top: picked.has(p), tags: [...new Set(label.get(p))] }));
}

// Our plans added to the proxy's, from the bikes near both ends and the
// stations. `opts`: { modes (what's allowed), swap (每 30 分鐘換車), rank's own }.
export function withBikes(plans, o, d, bikes, now = Date.now(), opts = {}) {
  const { modes = null, swap = false } = opts;
  const bike = modes?.bike !== false;
  // A planner's own bike legs (TDX's YouBike first and last mile) and our
  // router's rides to a station get the stations they start and end at, with
  // the bikes and docks there now; a ride with no station near is no plan.
  const out = plans
    .map(p => (p.legs.some(l => l.mode === 'bike' && !l.rent) ? withStations(p, bikes) : p))
    .filter(Boolean)
    .map(p => (swap && p.legs.some(l => l.mode === 'bike' && l.dur > SWAP_SEC) ? finish({ ...p, legs: swapRides(p.legs, bikes) }) : p));
  if (bikes.length && bike) {
    out.push(...bikeOnly(o, d, bikes, now, { swap }));
    for (const p of plans) {
      if (p.bike) continue;
      // By bike to the train (instead of the bus to it), and to the first
      // bus too (instead of a long walk to it); the same from the end.
      for (const anyRide of [false, true]) {
        const a = bikeToRail(p, o, bikes, { anyRide });
        const b = bikeFromRail(p, d, bikes, { anyRide });
        if (a) out.push(a);
        if (b) out.push(b);
        if (a) {
          const ab = bikeFromRail(a, d, bikes, { anyRide });
          if (ab) out.push(ab);
        }
      }
    }
  }
  return rank(
    out.filter(p => allowed(p, modes)),
    { now, o, d, ...opts }
  );
}

function withStations(p, bikes) {
  const legs = p.legs
    // TDX's zero-length walks between two halves of one stop.
    .filter(l => !(l.mode === 'walk' && (l.dist || 0) < 5 && (l.dur || 0) < 30))
    .map(l => {
      if (l.mode !== 'bike' || l.rent) return l;
      const rent = rentNear(l.from, bikes, { max: 700 });
      const ret = returnNear(l.to, bikes, { max: 700 });
      // Our router's ride to a station: its stations, or the plan goes (a walk that long is no plan).
      if (l.placeholder) {
        if (!rent || !ret || rent.uid === ret.uid) return null;
        const w1 = walkLeg(l.from, rent, 0);
        const ride = rideLeg(rent, ret, 0);
        const w2 = walkLeg(ret, l.to, 0);
        const total = (w1.dist > 20 ? w1.dur : 0) + ride.dur + (w2.dist > 20 ? w2.dur : 0);
        // Timed to its end (to a train) or its start (from one).
        let t = l.fix === 'arr' ? l.arr - total * 1000 : l.dep;
        const seq = [];
        for (const x of [w1.dist > 20 ? w1 : null, ride, w2.dist > 20 ? w2 : null]) {
          if (!x) continue;
          seq.push({ ...x, dep: t, arr: t + x.dur * 1000 });
          t += x.dur * 1000;
        }
        return seq;
      }
      // Under 500 m, or one station at both ends: that's a walk, not a ride.
      if ((l.dist || 0) < 500 || (rent && ret && rent.uid === ret.uid)) {
        const w = walkLeg(l.from, l.to, l.dep);
        return { ...w, arr: Math.max(w.arr, l.arr) };
      }
      return { ...l, name: 'YouBike', rent, ret, from: rent ? { name: rent.name, lat: rent.lat, lon: rent.lon } : { ...l.from, name: l.from.name || '附近的 YouBike 站' }, to: ret ? { name: ret.name, lat: ret.lat, lon: ret.lon } : { ...l.to, name: l.to.name || '附近的 YouBike 站' } };
    });
  if (legs.some(l => l === null)) return null;
  return finish({ ...p, legs: legs.flat() });
}

// The points whose YouBike stations a set of plans needs: both ends, and
// where each plan first boards and last leaves a train or metro.
export function bikePoints(plans, o, d, { swap = false } = {}) {
  const pts = [o, d];
  // 每 30 分鐘換車: where a long ride would be cut, every ~5 km on the way.
  if (swap) {
    const n = Math.floor(meters(o.lat, o.lon, d.lat, d.lon) / 5000);
    for (let k = 1; k <= Math.min(n, 3); k++) pts.push({ lat: o.lat + ((d.lat - o.lat) * k) / (n + 1), lon: o.lon + ((d.lon - o.lon) * k) / (n + 1) });
  }
  for (const p of plans) {
    const rail = p.legs.filter(l => RAIL.has(l.mode));
    if (rail[0]?.from?.lat) pts.push(rail[0].from);
    if (rail.at(-1)?.to?.lat) pts.push(rail.at(-1).to);
    // The first and last stops of any ride, and a planner's own bike legs' ends.
    const rides = p.legs.filter(l => l.mode !== 'walk');
    if (rides[0]?.from?.lat) pts.push(rides[0].from);
    if (rides.at(-1)?.to?.lat) pts.push(rides.at(-1).to);
  }
  // One per ~400 m.
  const out = [];
  for (const p of pts) if (!out.some(q => meters(p.lat, p.lon, q.lat, q.lon) < 400)) out.push({ lat: p.lat, lon: p.lon });
  return out.slice(0, swap ? 11 : 8);
}
