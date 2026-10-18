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

import { meters, walkSec, tw, hm, addDays, routeNorm, sameRoute, stationKey } from './util.mjs';
import { journeys, directs } from './rail.mjs';
import { crossings, crossed, bridgeExtra } from './rivers.mjs';
import { trainKind } from './ui.mjs';

import { W } from './lang.mjs';
export const RIDE_M_MIN = { bike: 230, ebike: 300 }; // about 14 and 18 km/h
export const DOCK_SEC = 60; // taking or returning a bike
export const BIKE_MAX_M = 12_000; // further than this, nobody wants to ride
export const NEAR_M = 500; // a station farther than this from where you are isn't "here"
export const TREK_M = 2000; // a walk to a bus or train longer than this is no way there
export const SWAP_SEC = 30 * 60; // YouBike's free (TPASS) or cheapest first half hour
const RAIL = new Set(['metro', 'tra', 'hsr', 'lightrail']);

// Which of the person's allowed ways of moving a leg is (lightrail is the metro's).
const KIND = { bus: 'bus', tra: 'tra', hsr: 'hsr', metro: 'metro', lightrail: 'metro', bike: 'bike' };
// A plan uses only what's allowed (a taxi never: TDX sometimes ends a trip with one).
export const allowed = (p, modes) => p.legs.every(l => l.mode !== 'car' && (!KIND[l.mode] || modes?.[KIND[l.mode]] !== false));

export const rideSec = (m, ebike = false) => Math.round(((m * 1.25) / (ebike ? RIDE_M_MIN.ebike : RIDE_M_MIN.bike)) * 60);
// Walking past 375 m (5 minutes at 4.5 km/h, the pace it was fitted on; not
// moved with the pace) is slow going: what a walk of m metres (as walked)
// costs on top of its time, in minutes.
const slowWalk = m => Math.max(0, m / 75 - 5) * 0.6;
// A ride's length on the roads: the straight line and a quarter; over a
// river, round by its bridge, each side of it nearly straight (竹中 → 綠41公園
// 5.3 km on the roads, 千甲's over 頭前溪橋 4.5: the way round and a quarter
// on top counted both twice).
const roadM = (a, b) => {
  const m = meters(a.lat, a.lon, b.lat, b.lon);
  const x = bridgeExtra(a, b);
  return x ? Math.max(m * 1.25, (m + x) * 1.15) : m * 1.25;
};

// A station (bike.mjs): { uid, name, lat, lon, kind, bikes, ebike, ret, ok }.
// Plans go by where stations are, never by the bikes or docks there at the
// moment (too live to plan on, the owner 2026-10-12: if one's empty when
// you get there, navigation moves the ride to a station near it). A station
// out of service isn't one (every station is YouBike 2.0's: 電輔車 at any).
// The station to take a bike from near a point, and the one to leave it at:
// with the ride's other end known (`to`, `from`), the one that makes the
// whole way quickest, walk and ride together (綠41公園 on the way home from
// 六家, not 成功國中 past it because it's a few metres nearer the door);
// without it, the nearest. A station behind you (the ride from it longer than
// from the door) is walked out to and ridden back over the same ground: both
// lost, each as slow as walking (from 成功九街 to the bus at 文興嘉興路口 or to
// 六家, 綠41公園 on the way, not 成功國中 behind; the owner, 2026-10-13). A walk
// past 5 minutes is slow going, as in the score (竹東街上: not 8 minutes on
// foot to save 2 on the bike).
// Walks by the streets where they're known (the planner asks Google's for
// the stations near each end, api walksTo): a station round the block of a
// stadium is no 4-minute walk however near it looks (新竹縣體育場 → 成功國中:
// 350 m as the crow flies, 670 on foot). → metres, or null (the straight
// line ×1.3 then).
let streetM = () => null;
export const useStreetWalks = f => (streetM = f);
function bestStation(pt, list, other, ebike) {
  if (!list.length) return null;
  if (!other) return list[0].s;
  const direct = meters(pt.lat, pt.lon, other.lat, other.lon);
  const back = x => Math.max(0, meters(x.s.lat, x.s.lon, other.lat, other.lon) - direct);
  const cost = x => {
    const road = streetM(pt, x.s);
    const walk = road != null ? road / 1.3 : x.d + bridgeExtra(pt, x.s);
    // (Choosing where to take a bike, a walk past 5 minutes counts double:
    // 光明九路停車場 511 m on foot was taken over 新竹縣體育場 151 m to save a
    // few minutes' riding; the owner, 2026-10-13.)
    return walkSec(walk + 2 * back(x)) + slowWalk(walk * 1.3) * 60 * 2 + rideSec(roadM(x.s, other) / 1.25, ebike);
  };
  return list.reduce((a, b) => (cost(b) < cost(a) ? b : a)).s;
}
const usable = s => s.ok !== false;
const within = (pt, bikes, max) => bikes.filter(usable).map(s => ({ s, d: meters(pt.lat, pt.lon, s.lat, s.lon) })).filter(x => x.d <= max).sort((a, b) => a.d - b.d);
// Where you take one, on a trip that starts with the bike (`first`): never a
// station empty as you plan (no bike there now; for a 電輔車, none of those),
// the owner's one exception to stations by place (2026-10-13). A bike taken
// later (off a train) is by place: the counts will have changed by then. A
// station full where it goes back is still the one (換附近的站 is a tap,
// navigating), and a swap's needs no bike: you take one again where you
// return yours.
const hasBike = (s, ebike) => s.bikes == null || (ebike ? s.ebike : s.bikes + s.ebike) > 0;
export function rentNear(pt, bikes, { ebike = false, max = NEAR_M, to = null, first = false } = {}) {
  return bestStation(pt, within(pt, bikes, max).filter(x => !first || hasBike(x.s, ebike)), to, ebike);
}
export function returnNear(pt, bikes, { max = NEAR_M, from = null, ebike = false } = {}) {
  return bestStation(pt, within(pt, bikes, max), from, ebike);
}

// (By the streets where known; else the straight line, over a river the way round to its bridge too.)
export const walkLeg = (from, to, dep) => {
  const road = streetM(from, to);
  const dist = road != null ? Math.round(road) : Math.round((meters(from.lat, from.lon, to.lat, to.lon) + bridgeExtra(from, to)) * 1.3);
  const dur = walkSec(dist / 1.3);
  return { mode: 'walk', from: { name: from.name || '', lat: from.lat, lon: from.lon }, to: { name: to.name || '', lat: to.lat, lon: to.lon }, dur, dist, dep, arr: dep + dur * 1000, straight: true };
};

// One ride from station to station, leaving at t.
export const rideLeg = (rent, ret, t, ebike = false) => {
  const dist = Math.round(roadM(rent, ret));
  const dur = rideSec(dist / 1.25, ebike) + 2 * DOCK_SEC;
  return { mode: 'bike', ebike, name: ebike ? W('YouBike 電輔車', 'YouBike E-bike') : 'YouBike', from: { name: rent.name, lat: rent.lat, lon: rent.lon }, to: { name: ret.name, lat: ret.lat, lon: ret.lon }, dur, dist, dep: t, arr: t + dur * 1000, rent, ret };
};

// A ride over half an hour, cut where you can return the bike and take one
// again (每 30 分鐘換車: each half hour free with TPASS, or the cheapest):
// at a station ~26 minutes in. Rides that can't be
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
        .filter(s => usable(s) && s.uid !== cur.rent.uid && s.uid !== cur.ret.uid)
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
// `first`: the trip starts with it (where you take one has a bike now: rentNear).
export function bikeTrip(a, b, bikes, dep, { ebike = false, swap = false, first = false } = {}) {
  // (Where you take it, towards where you're going; where you leave it, from where you took it.)
  const rent = rentNear(a, bikes, { ebike, to: b, first });
  const ret = rent && returnNear(b, bikes, { from: rent, ebike });
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
// A planner's plan whose walk (or ride) to a bus or train ends after it has
// left (TDX's, by 2–3 minutes): that way there and all before it set out
// earlier, so you're at the stop when it comes.
export function tidy(p) {
  let legs = p.legs;
  for (let i = legs.length - 1; i > 0; i--) {
    const late = legs[i - 1].arr - legs[i].dep;
    if (late > 0 && (legs[i - 1].mode === 'walk' || legs[i - 1].mode === 'bike')) legs = [...shift(legs.slice(0, i), -late), ...legs.slice(i)];
  }
  return legs === p.legs ? p : finish({ ...p, legs });
}

// All the way by bike (and by 電輔車 when one is there and it's worth it).
export function bikeOnly(o, d, bikes, now, { swap = false } = {}) {
  const dist = meters(o.lat, o.lon, d.lat, d.lon);
  if (dist > BIKE_MAX_M || dist < 300) return [];
  const out = [];
  const plain = bikeTrip(o, d, bikes, now, { swap, first: true });
  if (plain) out.push(finish({ src: 'bike', legs: plain }));
  if (dist >= 2000) {
    const e = bikeTrip(o, d, bikes, now, { ebike: true, swap, first: true });
    if (e) out.push(finish({ src: 'bike', legs: e }));
  }
  return out;
}

// The plan with its start swapped for a bike ride to its first train or
// metro: the same train, leaving later. Only when it replaces a bus or a
// walk of 600 m or more. `at`: a ride further on instead (the bus after a
// change), so the rides before it go: by bike to the one bus that goes the
// whole way.
export function bikeToRail(plan, o, bikes, { anyRide = false, at = -1 } = {}) {
  const k = at >= 0 ? at : plan.legs.findIndex(l => (anyRide ? l.mode !== 'walk' && l.mode !== 'bike' : RAIL.has(l.mode)));
  if (k <= 0) return null;
  const before = plan.legs.slice(0, k);
  if (!before.some(l => l.mode === 'bus') && before.reduce((a, l) => a + (l.mode === 'walk' ? l.dist || 0 : 0), 0) < 600) return null;
  const board = plan.legs[k];
  if (!board.from?.lat || meters(o.lat, o.lon, board.from.lat, board.from.lon) > 6000) return null;
  const ride = bikeTrip(o, board.from, bikes, 0, { first: true });
  if (!ride) return null;
  const took = ride.at(-1).arr; // from 0
  const leave = board.dep - 2 * 60_000 - took;
  if (at < 0 && leave < plan.dep - 60_000) return null; // no earlier than the plan already leaves (the score decides between them)
  return finish({ src: 'bike+', base: plan.src, legs: [...shift(ride, leave), ...plan.legs.slice(k)] });
}

// A plan's first bus, from its stop's live times (`seen`, kept by live.mjs
// adjustPlan): the first you can be at the stop for, setting out at `start`
// (now, or the time asked), not the one the plan was made around (by bike
// to 文興嘉興路口 the 19:07, not the timetable's 19:17 the walk there was
// timed for; the owner, 2026-10-12). The bus and what follows it move with
// it, up to a train (which keeps its time); the way to it leaves so as to be
// there as it comes, never before now.
const KEEPS_TIME = new Set(['tra', 'hsr', 'metro', 'lightrail']);
export function catchBus(plan, now, start = now) {
  const i = plan.legs.findIndex(l => l.mode !== 'walk' && l.mode !== 'bike');
  const l = plan.legs[i];
  if (i < 0 || l.mode !== 'bus' || !l.seen?.length) return plan;
  const before = plan.legs.slice(0, i).reduce((a, x) => a + (x.dur || 0) * 1000, 0);
  const ready = Math.max(now, start) + before;
  const bus = l.seen.find(t => t.at >= ready - 30_000);
  if (!bus) return plan;
  const live = { at: bus.at, planned: bus.planned, last: bus.last };
  const delta = bus.at - l.dep;
  if (Math.abs(delta) < 60_000) return l.live?.at === bus.at ? plan : finish({ ...plan, legs: plan.legs.map((x, k) => (k === i ? { ...x, live } : x)), live: true });
  const legs = plan.legs.map(x => ({ ...x }));
  let k = i;
  for (; k < legs.length && !(k > i && KEEPS_TIME.has(legs[k].mode)); k++) Object.assign(legs[k], { dep: legs[k].dep + delta, arr: legs[k].arr + delta });
  legs[i].live = live;
  for (let a = 0; a < i; a++) Object.assign(legs[a], { dep: legs[a].dep + delta, arr: legs[a].arr + delta });
  if (legs[0].dep < now - 60_000) {
    const back = now - legs[0].dep;
    for (let a = 0; a < i; a++) Object.assign(legs[a], { dep: legs[a].dep + back, arr: legs[a].arr + back });
  }
  const out = finish({ ...plan, legs, live: true });
  if (k < legs.length && legs[k - 1].arr + 60_000 > legs[k].dep) out.miss = W(`可能趕不上 ${legs[k].short || legs[k].name}`, `May miss ${legs[k].short || legs[k].name}`);
  return out;
}

// The plan's end swapped for a bike ride from its last train or metro.
// `at`: an earlier ride instead (the first bus, the change after it gone).
export function bikeFromRail(plan, d, bikes, { anyRide = false, at = -1 } = {}) {
  let k = at;
  if (k < 0) plan.legs.forEach((l, i) => (anyRide ? l.mode !== 'walk' && l.mode !== 'bike' : RAIL.has(l.mode)) && (k = i));
  if (k < 0 || k === plan.legs.length - 1) return null;
  const after = plan.legs.slice(k + 1);
  if (!after.some(l => l.mode === 'bus') && after.reduce((a, l) => a + (l.mode === 'walk' ? l.dist || 0 : 0), 0) < 600) return null;
  const off = plan.legs[k];
  if (!off.to?.lat || meters(off.to.lat, off.to.lon, d.lat, d.lon) > 6000) return null;
  const ride = bikeTrip(off.to, d, bikes, off.arr + 60_000);
  if (!ride) return null;
  const legs = [...plan.legs.slice(0, k + 1), ...ride];
  // No later (the score decides between riding and walking); or, with a change gone, not much later.
  if (legs.at(-1).arr > plan.arr + (at >= 0 ? 10 : 1) * 60_000) return null;
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
// Without YouBike, a bus does the same: from a station too far to walk on
// to the place (or over the river). Its time a guess here (a bus at 20 km/h
// and a wait) until the planner finds the real one (trainThenBus); a plan
// whose bus isn't found is dropped (`bus: true` on its walk).
const BUS_ACCESS = m => ({ mode: 'walk', bus: true, sec: Math.round((m * 1.3) / 330 * 60) + 8 * 60 });
export function railPlans(net, o, d, at, { n = 4, bike = false, bus = false, use = () => true } = {}) {
  if (!net || meters(o.lat, o.lon, d.lat, d.lon) < 3000) return [];
  const near = (pt, end) => {
    const all = [...net.st.values()].map(s => ({ s, m: meters(pt.lat, pt.lon, s.lat, s.lon) })).sort((a, b) => a.m - b.m);
    // Walked to: on your side of the river only (the straight line over 頭前溪
    // is no footpath: the bridge is far round and made for cars).
    const walk = all.filter(x => x.m <= RAIL_WALK_M && !crossings(pt, x.s)).slice(0, 3);
    const far = x => (x.m > BIKE_OVER_M || crossings(pt, x.s)) && x.m <= RAIL_BIKE_M && !walk.includes(x);
    // Every station a ride away, not the nearest few: one a little further
    // on the line you're on (竹中, for 竹東's trains) can be the one to take.
    const ride = bike ? all.filter(far).slice(0, 8) : [];
    const byBus = !bike && bus && end ? all.filter(far).slice(0, 3) : [];
    return [...walk.map(x => ({ ...x, a: access(x.m, bike) })), ...ride.map(x => ({ ...x, a: access(x.m, bike) })), ...byBus.map(x => ({ ...x, a: BUS_ACCESS(x.m) }))];
  };
  // A station near both ends (千甲, 北新竹 between 竹北 and 巨城) is the
  // nearer end's only: from it to itself is no train, and would be all found.
  const A0 = near(o);
  const B0 = near(d, true);
  const A = A0.filter(x => !B0.some(y => y.s.key === x.s.key && y.m < x.m));
  const B = B0.filter(x => !A.some(y => y.s.key === x.s.key));
  if (!A.length || !B.length) return [];
  // Each station timed by the quickest way you allow to it, whatever the
  // way drawn (a walk under BIKE_OVER_M, ridden instead by withBikes when a
  // bike is quicker): 竹東's station a 15-minute walk or a 7-minute ride is
  // the 7, else riding 11 to 榮華 for the same train looks like leaving later.
  const quick = x => (bike && !x.a.bus && x.m > 600 ? Math.min(x.a.sec, rideSec(x.m) + 2 * DOCK_SEC + 120) : x.a.sec);
  const starts = A.map(x => ({ key: x.s.key, at: at + quick(x) * 1000 + 3 * 60_000, pre: quick(x) + 180 }));
  const ends = B.map(x => ({ key: x.s.key, extra: quick(x) }));
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
    for (const l of j.legs) legs.push(l.walk ? { ...walkLeg(pt(l.from), pt(l.to), l.dep), arr: l.arr } : trainLeg(net, l));
    // (From the end of the journey: its last leg may be the walk over to the other railway.)
    const last = j.legs.at(-1);
    const b = reach.get(`b:${j.end}`)?.a;
    const w2 = walkLeg(pt(j.end), d, last.arr);
    if (b?.mode === 'bike') legs.push(placeholder(pt(j.end), d, last.arr, last.arr + b.sec * 1000, 'dep'));
    else if (b?.bus) legs.push({ ...w2, bus: true, arr: last.arr + b.sec * 1000, dur: b.sec });
    else if (w2.dist > 20) legs.push(w2);
    return finish({ src: 'rail', legs });
  });
}
// A train of our router's as a plan's leg.
function trainLeg(net, l) {
  const pt = k => {
    const s = net.st.get(k);
    return { name: s.sys === 'hsr' ? `高鐵${s.name.replace(/^高鐵/, '')}` : s.name, lat: s.lat, lon: s.lon };
  };
  return {
    mode: l.trip.sys,
    name: l.trip.sys === 'hsr' ? '高鐵' : l.trip.typeFull || l.trip.type,
    short: l.trip.sys === 'hsr' ? W(`${l.trip.no} 次`, `HSR ${l.trip.no}`) : `${trainKind(l.trip.type)} ${l.trip.no}`,
    headsign: l.trip.headsign,
    from: pt(l.from),
    to: pt(l.to),
    dep: l.dep,
    arr: l.arr,
    dur: Math.round((l.arr - l.dep) / 1000),
    stops: l.stops,
    agency: l.trip.sys === 'hsr' ? '台灣高鐵' : l.trip.typeFull || '台鐵',
    dist: Math.round(meters(net.st.get(l.from).lat, net.st.get(l.from).lon, net.st.get(l.to).lat, net.st.get(l.to).lon)),
    // The station it called at before you board (chasing it: see score).
    prev: l.fromK > 0 && net.st.has(l.trip.stops[l.fromK - 1]?.st) ? { ...pt(l.trip.stops[l.fromK - 1].st), dep: l.trip.stops[l.fromK - 1].dep } : null,
    train: { sys: l.trip.sys, no: l.trip.no, code: l.trip.code }
  };
}

// A route's other departures, so a card can offer its times: the plan with
// its one bus or train swapped for another, the way there moved to meet it
// (the same slack before it) and the way on moved with its arrival. Only for
// plans with one bus or train (a change would need both re-timed); none you
// would have to have left already for.
export function retime(plan, k, ride, now = Date.now()) {
  const old = plan.legs[k];
  const before = ride.dep - old.dep;
  const after = ride.arr - old.arr;
  const legs = plan.legs.map((l, i) => (i < k ? { ...l, dep: l.dep + before, arr: l.arr + before } : i === k ? { ...l, ...ride, live: ride.live ?? null } : { ...l, dep: l.dep + after, arr: l.arr + after }));
  if (legs[0].dep < now - 60_000) return null;
  return finish({ ...plan, legs, live: legs.some(l => l.live) });
}
const onlyRide = p => {
  const at = p.legs.map((l, i) => (l.mode !== 'walk' && l.mode !== 'bike' ? i : -1)).filter(i => i >= 0);
  return at.length === 1 ? at[0] : -1;
};
// The next trains from the same station to the same one (our timetable).
export function moreTrains(plan, net, now = Date.now(), { n = 4, use = () => true } = {}) {
  const k = onlyRide(plan);
  const l = plan.legs[k];
  if (k < 0 || !net || (l.mode !== 'tra' && l.mode !== 'hsr') || !l.from?.lat || !l.to?.lat) return [];
  const key = pt => [...net.st.entries()].filter(([, s]) => s.sys === l.mode).map(([key, s]) => ({ key, m: meters(pt.lat, pt.lon, s.lat, s.lon) })).sort((a, b) => a.m - b.m).find(x => x.m < 400)?.key;
  const [a, b] = [key(l.from), key(l.to)];
  if (!a || !b) return [];
  const no = l.train?.no || String(l.short || '').match(/\d{2,}/)?.[0];
  const reach = l.dep - plan.legs[0].dep; // from leaving to the train
  return directs(net, a, b, now + reach - 60_000, { use, n: n + 2 })
    .map(j => j.legs[0])
    .filter(x => String(x.trip.no) !== String(no))
    .slice(0, n)
    .map(x => retime(plan, k, trainLeg(net, x), now))
    .filter(Boolean);
}
// The next buses at the same stop: the times TDX gave for it (adjustPlan's `next`).
export function moreBuses(plan, now = Date.now()) {
  const k = onlyRide(plan);
  const l = plan.legs[k];
  if (k < 0 || l.mode !== 'bus' || !l.next?.length) return [];
  return l.next
    .filter(t => Math.abs(t - l.dep) > 2 * 60_000)
    .map(t => retime(plan, k, { dep: t, arr: t + (l.arr - l.dep), live: { at: t } }, now))
    .filter(Boolean);
}

const placeholder = (from, to, dep, arr, fix) => ({ mode: 'bike', placeholder: true, fix, name: 'YouBike', from: { name: from.name || '', lat: from.lat, lon: from.lon }, to: { name: to.name || '', lat: to.lat, lon: to.lon }, dep, arr, dur: Math.round((arr - dep) / 1000), dist: Math.round(meters(from.lat, from.lon, to.lat, to.lon) * 1.25) });

// What a plan costs you, in minutes: the time from your door to there (the
// wait before leaving only a third while it's short: it's spent at home;
// past 15 minutes, more), and on top of it what a person who rides YouBike to fill the gaps the buses and
// trains leave actually minds:
//   - each change: onto a train or metro is easy (it keeps time), onto a bus
//     is a gamble, a bus to a bus barely a plan at all: Taiwan's buses don't
//     keep their times, so the second one is as likely missed as caught (a
//     bus with a train either side of it is fine);
//   - each bus caught, a few minutes (you're at the stop early, it's late
//     anyway), and time on it a little (it's late, it's early, it's full);
//   - the minutes out of the door (leaving later for the same train is
//     better), and walking past a few minutes;
//   - each ride on a bike by its own length, not the total: 10 minutes to the
//     station is nothing, 18 is a workout, to half an hour every minute counts
//     twice (20 minutes or 25 is about the same ride: the owner, 2026-10-12),
//     past half an hour four and a half times. Two short rides beat one long
//     one. (A ride cut at 30 minutes to stay free is still one ride.)
//     電輔車 is a little easier going, not a free pass;
//   - a trip whose buses or trains go the long way round (into 新竹市 and back
//     out, when the place is the other way), or change farther from the place
//     than you started. Getting to the first one is not the long way round:
//     riding north to 竹北's station for a train south costs its minutes and
//     its ride, nothing more;
//   - what it costs in money, and a train it would now miss.
export const rideEffort = min => Math.min(min, 10) * 0.1 + Math.min(Math.max(min - 10, 0), 8) * 0.6 + Math.min(Math.max(min - 18, 0), 12) * 2 + Math.max(min - 30, 0) * 4.5;
export function score(p, opts = {}) {
  const parts = scoreParts(p, opts);
  return Object.values(parts).reduce((a, b) => a + b, 0);
}
// The score's parts, by name (scripts/replay.mjs --why shows them).
export function scoreParts(p, { o, d, now = Date.now(), by = 'depart', deadline = null, fare = 0 } = {}) {
  const out = {};
  const add = (k, v) => v && (out[k] = (out[k] || 0) + v);
  const rides = p.legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
  // Time: door to door in full; the wait before leaving (at home, at your
  // desk) only a third: a train in 25 minutes isn't 25 minutes lost, it's
  // when you leave. By an arrival time: door to door in full too, and there
  // early counted less (at school before the bell is your own time, not a
  // seat on the bus): never leaving 12 minutes later to ride 25 minutes
  // longer (06:41 → 07:52 over 06:29 → 07:17, the owner's 上學, 2026-10-18).
  if (by === 'arrive' && deadline) {
    add('time', (p.arr - p.dep) / 60_000);
    const early = Math.max(0, (deadline - p.arr) / 60_000);
    add('early', Math.min(early, 30) * 0.4 + Math.max(early - 30, 0) * 0.7);
  } else {
    add('time', (p.arr - p.dep) / 60_000);
    // (A short wait is when you leave; past a quarter of an hour it's time
    // lost, there that much later: a bus in 55 minutes is no bargain.)
    const w = Math.max(0, (p.dep - now) / 60_000);
    add('wait', Math.min(w, 15) * 0.35 + Math.max(w - 15, 0) * 0.7);
  }
  for (let i = 1; i < rides.length; i++) {
    const [a, b] = [rides[i - 1].mode, rides[i].mode];
    add('changes', a === 'bus' && b === 'bus' ? 35 : b === 'bus' ? 10 : 7);
  }
  // Each bus caught: its time is a guess (early as often as late), so you're
  // at the stop early and it may still be late: a few minutes that on a short
  // trip are most of it (1–2 km: a YouBike, there when you are, over the bus
  // a minute sooner on paper). A train or the metro keeps its time.
  add('board', rides.filter(l => l.mode === 'bus').length * 4);
  add('walk', slowWalk(p.walk || 0));
  // The bike rides, one swapped bike to the next counted as one ride.
  let ride = null;
  const bikes = [];
  for (const l of p.legs) {
    if (l.mode !== 'bike') { ride = null; continue; }
    if (ride && l.swap) ride.min += (l.dur || 0) / 60;
    else bikes.push((ride = { min: (l.dur || 0) / 60, ebike: !!l.ebike }));
  }
  for (const r of bikes) {
    add('bike', 1.5 + rideEffort(r.ebike ? r.min * 0.95 : r.min));
  }
  const placed = rides.filter(l => l.from?.lat != null && l.to?.lat != null);
  if (placed.length) {
    // The rides' own way against the straight line from the first stop to
    // the last: only a real long way round (half as far again) counts, not a
    // line's own bends.
    const [a, b] = [placed[0].from, placed.at(-1).to];
    const span = Math.max(1000, meters(a.lat, a.lon, b.lat, b.lon));
    const path = placed.reduce((x, l) => x + meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon), 0);
    add('detour', Math.max(0, path / span - 1.5) * 45);
  }
  if (o && d) {
    // Heading away: a change made farther from the place than where you started.
    const direct = Math.max(1000, meters(o.lat, o.lon, d.lat, d.lon));
    if (rides.slice(0, -1).some(l => l.to?.lat != null && meters(l.to.lat, l.to.lon, d.lat, d.lon) > direct + 1500)) add('away', 8);
  }
  // Chasing your own train: riding (or walking) on past a station it stops
  // at, nearer to you, to board it at the next (竹東's train caught at 榮華).
  // A race you can lose, for a few minutes more at home.
  const first = rides[0];
  if (o && first?.prev?.lat != null && first.from?.lat != null && meters(o.lat, o.lon, first.prev.lat, first.prev.lon) < meters(o.lat, o.lon, first.from.lat, first.from.lon)) add('chase', 6);
  add('fare', fare / 12);
  if (p.miss) add('miss', 25);
  if (p.off) add('off', 120);
  return out;
}

// No bus or train at all: by bike (電輔車 or not), or on foot.
const ownWay = p => (p.legs.some(l => l.mode === 'bike') ? `bike:${p.legs.some(l => l.ebike)}` : 'walk');
// The same rides (the lines, where you get on and off), whatever the walks
// and bikes around them: also what a pinned recommendation is known by.
export const ridesSig = p =>
  p.legs
    .filter(l => l.mode !== 'walk' && l.mode !== 'bike')
    .map(l => `${l.mode}:${l.short || l.name || ''}:${l.from?.name || ''}`)
    .join('|') || ownWay(p);

// A pinned recommendation's way, whatever the day's train numbers and each
// planner's names for things (快捷8號 / 快捷八號, 竹北車站 / 竹北): the buses
// and metro by their line (util's routeNorm), the trains by where you get on
// and off (stationKey). (Each name worked out once: the ranking compares
// every plan with every other.)
const once = f => {
  const seen = new Map();
  return x => {
    const k = String(x || '');
    let v = seen.get(k);
    if (v === undefined) {
      if (seen.size > 2000) seen.clear();
      seen.set(k, (v = f(k)));
    }
    return v;
  };
};
const station = once(n => stationKey(n.replace(/[（(].*$/, '')).toUpperCase());
const line = once(routeNorm);
// A plan's rides, a train changed for another train one ride (竹東 → 新竹
// straight through, or changing at 竹中: the train either way), from where
// you board the first to where you leave the last.
export const segs = p => {
  const out = [];
  for (const l of p.legs) {
    if (l.mode === 'walk' || l.mode === 'bike') continue;
    const last = out.at(-1);
    if (last && last.mode === l.mode && (l.mode === 'tra' || l.mode === 'hsr') && last.to === l.from?.name) out[out.length - 1] = { ...last, to: l.to?.name, arr: l.arr, legs: [...last.legs, l] };
    else out.push({ mode: l.mode, from: l.from?.name, to: l.to?.name, name: l.short || l.name, dep: l.dep, arr: l.arr, legs: [l] });
  }
  return out;
};
export const pickSig = p =>
  segs(p)
    .map(x => (x.mode === 'tra' || x.mode === 'hsr' ? `${x.mode}:${station(x.from)}>${station(x.to)}` : `${x.mode}:${line(x.name)}`))
    .join('|') || (p.legs.some(l => l.mode === 'bike') ? 'bike' : 'walk');

// Two plans are one way when they ride the same buses and trains, whatever
// gets you on and off them: each train by its number, each bus or metro by its
// line and when it leaves (within a few minutes: the next stop down the road).
// All the way by bike is one way.
const vehicles = p => p.legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
const trainNo = l => l.train?.no || (RAIL.has(l.mode) && l.mode !== 'metro' && String(l.short || '').match(/\d{2,}/)?.[0]) || null;
export function sameWay(a, b) {
  const [x, y] = [vehicles(a), vehicles(b)];
  if (x.length !== y.length) return false;
  if (!x.length) return !y.length && a.legs.some(l => l.mode === 'bike') === b.legs.some(l => l.mode === 'bike');
  // Off the last one somewhere else (a kilometre or more apart) is a way of
  // its own: off at 竹中 and ride home is not the same train on to 千甲 and a
  // ride over 經國大橋, and only the best of one way is kept.
  const [p, q] = [x.at(-1).to, y.at(-1).to];
  if (p?.lat != null && q?.lat != null && meters(p.lat, p.lon, q.lat, q.lon) >= 1000) return false;
  return x.every((l, i) => {
    const m = y[i];
    if (l.mode !== m.mode) return false;
    return sameVehicle(l, m);
  });
}
// One bus or train, whatever each planner calls it: a train by its number,
// or (a planner that gives none, Google's 六家-新竹) by where and when it
// leaves; a bus or metro by its line and when it leaves.
function sameVehicle(l, m) {
  if (l.mode !== m.mode) return false;
  const [n, k] = [trainNo(l), trainNo(m)];
  if (n && k) return n === k;
  // (Or boarded a stop apart: the train ours left 竹東 on is TDX's from 竹東.)
  const at = (x, y) => station(x?.name) === station(y.from?.name) && Math.abs((x.dep || 0) - (y.dep || 0)) <= 2 * 60_000;
  if (n || k) return at(l.from && { ...l.from, dep: l.dep }, m) || (l.prev && at(l.prev, m)) || (m.prev && at(m.prev, l));
  return sameRoute(l.short || l.name, m.short || m.name) && Math.abs((l.dep || 0) - (m.dep || 0)) <= 8 * 60_000;
}

// q sets out on the same bus or train as p, changes no more, rides home
// about as long after its last (8 minutes more at most), and is there no
// later (off at 竹中 rather than on to 千甲; 竹中 → 六家 rather than on to
// 北新竹 or 新竹 and back up to 竹北: the ride home from each is the same 15
// minutes, the change the same, and 六家 is home first).
const rideAfter = p => {
  const k = p.legs.findLastIndex(l => l.mode !== 'walk' && l.mode !== 'bike');
  return p.legs.slice(k + 1).reduce((a, l) => a + (l.mode === 'bike' ? l.dur || 0 : 0), 0) / 60;
};
function offSooner(q, p) {
  const [x, y] = [vehicles(q), vehicles(p)];
  if (!x.length || x.length > y.length || !sameVehicle(x[0], y[0])) return false;
  if (x.length === y.length && x.every((l, i) => sameVehicle(l, y[i])) && !(x.at(-1).arr < y.at(-1).arr - 60_000)) return false;
  const [a, b] = [rideAfter(q), rideAfter(p)];
  return a > 0 && b > 0 && a <= b + 8;
}

const mainLine = p => {
  const rides = p.legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
  const m = rides.reduce((a, l) => (!a || (l.dur || 0) > (a.dur || 0) ? l : a), null);
  return m ? `${m.mode}:${m.short || m.name || ''}` : ownWay(p);
};

// Everything, ranked by what's practical (score). The first few that ride
// different lines are the recommendations (`top`); the rest stay, later.
// Each gets its labels. `cost(p)` adds what a plan costs you in money.
// Each ride leaves after what comes before it is over (2 minutes' grace).
export const inOrder = p => p.legs.every((l, i) => i === 0 || l.mode === 'walk' || l.mode === 'bike' || l.dep == null || p.legs[i - 1].arr == null || l.dep >= p.legs[i - 1].arr - 2 * 60_000);
export function rank(plans, { now = Date.now(), o = null, d = null, by = 'depart', deadline = null, cost = () => 0, top = 4, clock = Date.now(), keep = null } = {}) {
  // Only what `keep` allows (inside your TPASS's area: what the pass takes), unless that's nothing.
  if (keep) {
    const kept = plans.filter(p => p?.legs?.length && keep(p));
    if (kept.length) plans = kept;
  }
  // A plan that can't be done as written (a planner's bus leaving before the
  // walk to it is over, two minutes or more): never shown.
  plans = plans.filter(p => !p?.legs || inOrder(p));
  // (By an arrival time, `now` is that time: what's gone is what left before the clock's now.)
  // A planner's plan set out a few minutes before the time asked, on the
  // metro only (a train every few minutes): the same, a train later.
  const FREQUENT = new Set(['metro', 'lightrail']);
  if (by !== 'arrive')
    plans = plans.map(p => {
      if (!p?.legs?.length || p.dep >= now - 2 * 60_000 || p.dep < now - 15 * 60_000) return p;
      const rides = p.legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
      return rides.length && rides.every(l => FREQUENT.has(l.mode)) ? finish({ ...p, legs: shift(p.legs, now - p.dep) }) : p;
    });
  const all = plans.filter(p => p && p.legs?.length && p.arr != null && (by === 'arrive' && deadline ? p.dep > clock - 2 * 60_000 : p.arr > now - 60_000));
  // Leaving before the time asked (a ride to the train worked out backwards
  // from it), or arriving after it, is no plan, unless it's all there is.
  const fits = all.filter(p => (by === 'arrive' && deadline ? p.arr <= deadline + 2 * 60_000 : p.dep >= now - 2 * 60_000));
  const ok = fits.length ? fits : all;
  // By a time already out of reach (07:21 for 08:00): ranked as leaving now,
  // the soonest there first; "how long before the time you leave" would put
  // the one leaving latest first (16:20, the owner's 上學, 2026-10-16).
  if (by === 'arrive' && deadline && !fits.length) [by, now, deadline] = ['depart', clock, null];
  // One plan per way (sameWay): walking or riding to the same bus, boarding
  // the same train a station up the line, 電輔車 or not: only the best of them.
  const scored = [];
  for (const x of ok.map(p => ({ p, s: score(p, { o, d, now, by, deadline, fare: cost(p) }) })).sort((a, b) => a.s - b.s || a.p.arr - b.p.arr))
    if (!scored.some(y => sameWay(x.p, y.p))) scored.push(x);
  // Not running at all (末班已過, 今日未營運), or waiting hours half way (the
  // last bus gone, the first train tomorrow), is no plan, unless it's all there is.
  const longWait = p => p.legs.some((l, i) => i > 0 && l.dep - p.legs[i - 1].arr > 90 * 60_000);
  const running = scored.filter(x => !x.p.off && !longWait(x.p));
  const list = (running.length ? running : scored).slice(0, 80).map(x => ({ ...x.p, score: x.s }));
  if (!list.length) return [];
  // One card per route (pickSig: the same lines, the trains by their
  // stations), its other departures the times to choose from: the best of
  // them leads it. Then a route nobody would take is set aside (`weak`):
  //   - another way is no worse in every way: leaves no earlier, there no
  //     later, less bother (walking 10 minutes to a bus to the train, when a
  //     bike gets you to the same train or a later one);
  //   - one of its rides is most of what riding all the way would (a bus
  //     north, then 25 minutes on a bike: then ride it all; two short rides
  //     around a train are not);
  //   - it's far behind the best.
  // Only when bikes are allowed do bike plans exist to set others aside.
  const group = () => {
    const g = new Map();
    for (const p of list) {
      const k = pickSig(p);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(p);
    }
    return g;
  };
  // A route that comes often forgives a missed one (the next is minutes
  // away); one every half hour doesn't: the wait to its next departure
  // counts a little (the train every 10 minutes over the bus every 30, when
  // they're otherwise close).
  const rideOf = p => vehicles(p).reduce((a, l) => (!a || (l.dur || 0) > (a.dur || 0) ? l : a), null);
  for (const g of group().values()) {
    const byDep = [...g].sort((a, b) => a.dep - b.dep);
    byDep.forEach((q, i) => {
      const r = rideOf(q);
      if (!r) return;
      const next = byDep[i + 1] ? rideOf(byDep[i + 1])?.dep : r.next?.find(t => t > r.dep + 60_000);
      if (next) q.score += Math.min((next - r.dep) / 60_000, 40) * 0.12;
    });
  }
  list.sort((a, b) => a.score - b.score || a.arr - b.arr);
  const groups = group();
  const leads = [...groups.values()].map(g => g[0]);
  const rideM = p => p.legs.reduce((a, l) => a + (l.mode === 'bike' ? l.dist || 0 : 0), 0);
  // Riding it all.
  const allBike = list.filter(p => p.bike && !vehicles(p).length).map(rideM);
  const bikeAll = allBike.length ? Math.min(...allBike) : null;
  // A plan's longest ride (one swapped bike to the next one ride): two short
  // rides around a train are gap-fillers, not riding most of the way
  // (巨城 → 成功九街: 7 minutes to 新竹站 and 15 from 竹北, not one 30).
  const longRideM = p => {
    let [run, most] = [0, 0];
    for (const l of p.legs) {
      if (l.mode !== 'bike') run = 0;
      else most = Math.max(most, (run = (l.swap ? run : 0) + (l.dist || 0)));
    }
    return most;
  };
  const best = list[0].score;
  const weak = new Set();
  // The ride a plan is for: its longest bus or train.
  const main = p => vehicles(p).reduce((a, l) => (!a || (l.dur || 0) > (a.dur || 0) ? l : a), null);
  const sameRide = sameVehicle;
  // The bother of a plan: everything but its time (changes, buses, walking,
  // riding, the long way round, money). A way is set aside by another only
  // when that other is no more bother, never because a total came out a
  // point lower: home a little sooner never makes a worse way "beat" one.
  const bothers = new Map();
  const bother = x => {
    if (!bothers.has(x)) bothers.set(x, Object.entries(scoreParts(x, { o, d, now, by, deadline, fare: cost(x) })).reduce((a, [k, v]) => (k === 'time' || k === 'wait' ? a : a + v), 0));
    return bothers.get(x);
  };
  // Over the river on the bike, before or after a bus or train, when a way
  // whose bus or train takes you over it, or riding the whole way (40
  // minutes at most), gets there within 20 minutes of it (新竹站 → 成功九街:
  // the train to 竹北 and a ride, or riding it all, not the train to 千甲 and
  // a ride over 頭前溪: riding 20 minutes anyway, you'd ride the whole way).
  // The bus or the train is for the crossing. (20 minutes, not a fine line a
  // minute decides.) Set aside first: what's set aside sets nothing else
  // aside (off at 新莊 and over the river never beats the change to the 六家線).
  const bikeOver = x => x.legs.some(l => l.mode === 'bike' && crossings(l.from, l.to));
  const longest = x => Math.max(0, ...x.legs.filter(l => l.mode === 'bike').map(l => l.dur || 0)) / 60;
  const crossesAnyway = (p, q) => !q.off && q.arr <= p.arr + 20 * 60_000 && q.dep >= p.dep - 20 * 60_000 && (vehicles(q).length ? !bikeOver(q) : q.bike && longest(q) <= 40);
  const over = new Set(leads.filter(p => vehicles(p).length && bikeOver(p) && list.some(q => q !== p && crossesAnyway(p, q))).map(p => groups.get(pickSig(p))));
  // A bus then another bus: Taiwan's buses don't keep their times, so the
  // change is a gamble nobody plans on (the owner, 2026-10-12: 5673 then
  // 5614 shown as 最快抵達). Set aside whenever any way without one is there.
  const busChain = x => vehicles(x).some((l, i, a) => i > 0 && l.mode === 'bus' && a[i - 1].mode === 'bus');
  const noChain = list.some(q => !busChain(q) && !q.off);
  for (const p of leads) if (noChain && busChain(p)) over.add(groups.get(pickSig(p)));
  // A walk nobody takes to a bus or train (over 2 km in one go: 5.4 km to
  // 千甲 at 04:48 for an 08:00 at school, without YouBike; the owner,
  // 2026-10-12), whenever a way without one is there.
  const trek = x => vehicles(x).length && x.legs.some(l => l.mode === 'walk' && (l.dist || 0) > TREK_M);
  const noTrek = list.some(q => !trek(q) && !q.off);
  for (const p of leads) if (noTrek && trek(p)) over.add(groups.get(pickSig(p)));
  // Of those, one by train and one by bus stay listed under the
  // recommendations, never one themselves: the fewest trains and buses, then
  // the best (the owner, 2026-10-15: the train to 竹中 and a ride home is a
  // choice to see, 竹東高中 → 成功九街).
  // (Riding two thirds of what riding it all would, it's riding it all: a
  // bus a little way, then 25 minutes on the bike.)
  const kind = p => (vehicles(p).some(l => l.mode === 'bus') ? 'bus' : 'rail');
  const rideMin = p => p.legs.reduce((a, l) => a + (l.mode === 'bike' ? l.dur || 0 : 0), 0);
  const allMin = Math.min(...list.filter(p => p.bike && !vehicles(p).length).map(rideMin));
  const river = new Set();
  for (const k of ['rail', 'bus']) {
    const g = [...over].map(x => x[0]).filter(p => kind(p) === k && !busChain(p) && !trek(p) && rideMin(p) <= allMin * 2 / 3).sort((a, b) => vehicles(a).length - vehicles(b).length || a.score - b.score)[0];
    if (g) river.add(groups.get(pickSig(g)));
  }
  const other = (q, p) => groups.get(pickSig(q)) !== groups.get(pickSig(p)) && !over.has(groups.get(pickSig(q)));
  for (const p of leads) {
    // Another way onto the same bus or train (a bike to it, not a walk and a
    // bus): no earlier out of the door, no later there, less bother. Another
    // line altogether is never this: it's a choice of its own.
    const m = main(p);
    // (Its rides only, each one of this plan's: a change onto another train
    // after it, 1242 to 竹北 rather than 1758 to 六家, is a way of its own.)
    const beaten = m && list.some(q => other(q, p) && bother(q) < bother(p) && q.dep >= p.dep - 60_000 && q.arr <= p.arr + 60_000 && vehicles(q).some(l => sameRide(l, m)) && vehicles(q).every(l => vehicles(p).some(x => sameRide(l, x))));
    // More changes than another bus-or-train way that's no later (within 5
    // minutes) and less bother: off the train at 北新竹 for the 5608, when
    // staying on to 新竹 and riding is sooner.
    const n = segs(p).length;
    const changes = n > 1 && list.some(q => other(q, p) && segs(q).length >= 1 && segs(q).length < n && bother(q) <= bother(p) && q.arr <= p.arr + 5 * 60_000);
    // A change for a hop: onto a bus or metro for a stop or two (a few
    // minutes, under 1.5 km) that a walk or a bike from where you got off
    // would do (新竹站, then 綠線 one stop, then a bike again).
    // (Short by its distance: 5 minutes of metro across 3 km is no hop.)
    const short = l => (l.from?.lat != null && l.to?.lat != null ? meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon) < 1500 : (l.stops != null && l.stops <= 2) || (l.dur || 0) <= 6 * 60);
    const hop = n > 1 && vehicles(p).some(l => l !== m && short(l));
    const mostlyRidden = bikeAll != null && vehicles(p).length && longRideM(p) >= Math.max(3000, bikeAll * 0.6);
    // The same first bus or train, then on further (or onto another) only to
    // ride a little less after it, or no less, home no sooner (offSooner):
    // the extra train is for nothing. (However each sets out for that first
    // train: walking to it a minute sooner is no reason to keep the other.)
    const overByBike = over.has(groups.get(pickSig(p)));
    const further = m && list.some(q => other(q, p) && offSooner(q, p) && q.arr <= p.arr);
    // The same last train, onto it from another first one, out no earlier,
    // there no later, less bother: the way to it is all that differs (by
    // bike to 六家 and the 六家線 to 竹中 for the 1804, over riding to 竹北
    // and changing at 北新竹 for it; the owner, 2026-10-12).
    const lastOf = x => vehicles(x).at(-1);
    const feeder = vehicles(p).length > 1 && list.some(q => other(q, p) && vehicles(q).length === vehicles(p).length && sameRide(lastOf(q), lastOf(p)) && !sameRide(vehicles(q)[0], vehicles(p)[0]) && bother(q) < bother(p) && q.dep >= p.dep - 60_000 && q.arr <= p.arr + 60_000);
    // Far behind the best, unless it gets there sooner than ways ahead of
    // it (off at 竹中 and ride, over the change to the 六家線: more riding, but
    // home sooner, a real choice).
    // (By a time, sooner there is no merit: you said when.)
    const sooner = by !== 'arrive' && leads.some(q => q !== p && q.score < p.score && q.score <= best + Math.max(45, best) && q.arr > p.arr + 5 * 60_000 && vehicles(q).length);
    // (Riding it all is a choice of its own however it scores: the owner,
    // 2026-10-12, wants it under the rest, 成功九街 → 竹東高中 by 電輔車.)
    const far = p.score > best + Math.max(45, best) && !(sooner && p.score <= best + 2 * Math.max(45, best)) && !(p.bike && !vehicles(p).length);
    if (beaten || changes || hop || mostlyRidden || further || feeder || (overByBike && !river.has(groups.get(pickSig(p)))) || far) for (const q of groups.get(pickSig(p))) weak.add(q);
  }
  // Never nothing: the best way stays when every way was set aside.
  if (leads.every(p => weak.has(p))) for (const q of groups.get(pickSig(leads[0]))) weak.delete(q);
  // A route's other departures: the next few, within an hour and a half of
  // its first; and a route that runs seldom (5615, a few buses a day) its
  // next three all the same, up to four hours on: its card always offers a
  // later bus when there is one (it had none, while 182's every-20-minutes
  // did, 2026-10-10).
  const times = new Map();
  for (const g of groups.values()) {
    // (A ride or a walk of your own has no times: you leave when you like.)
    if (!vehicles(g[0]).length) {
      for (const q of g) times.set(q, [q]);
      continue;
    }
    const by = [...g].sort((a, b) => a.dep - b.dep).filter((q, k) => q === g[0] || Math.abs(q.dep - g[0].dep) <= 90 * 60_000 || (k < 3 && q.dep - g[0].dep <= 4 * 3_600_000)).slice(0, 6);
    for (const q of g) times.set(q, by);
  }
  // Different ways first: each recommendation rides a different main line
  // (its longest ride); then, if there are fewer, different rides at all.
  const picked = new Set();
  const mains = new Set();
  const lines = new Set();
  const shown = leads.filter(p => !weak.has(p));
  const behind = p => river.has(groups.get(pickSig(p)));
  for (const p of shown) {
    if (picked.size >= top) break;
    if (behind(p)) continue;
    if (mains.has(mainLine(p))) continue;
    mains.add(mainLine(p));
    lines.add(ridesSig(p));
    picked.add(p);
  }
  for (const p of shown) {
    if (picked.size >= top) break;
    if (picked.has(p) || behind(p) || lines.has(ridesSig(p))) continue;
    lines.add(ridesSig(p));
    picked.add(p);
  }
  // And only when it gets there 5 minutes sooner than the recommendations
  // of its kind (of any, when none is): what it's for (竹中 and a ride, 18:54, over the
  // 六家線's 19:04; never north on the bus and back over the river for 新竹站).
  for (const p of shown.filter(behind)) {
    const tops = [...picked].filter(q => vehicles(q).length);
    const mine = tops.filter(q => kind(q) === kind(p));
    if ((mine.length ? mine : tops).some(q => q.arr < p.arr + 5 * 60_000)) for (const q of groups.get(pickSig(p))) weak.add(q);
  }
  const label = new Map(list.map(p => [p, []]));
  const pool = shown.length ? shown.filter(p => !weak.has(p)) : leads;
  const by_ = (f, name) => {
    const best = pool.reduce((a, b) => (f(b) < f(a) ? b : a));
    if (pool.filter(p => f(p) === f(best)).length < pool.length) label.get(best).push(name);
  };
  label.get(pool.find(p => picked.has(p)) || pool[0]).push('推薦');
  by_(p => p.arr, '最快抵達');
  by_(p => p.transfers, '最少轉乘');
  by_(p => p.walk, '最少步行');
  for (const p of list) if (p.bike) label.get(p).push(p.legs.some(l => l.ebike) ? '電輔車' : 'YouBike');
  for (const p of list) if (p.live) label.get(p).push('即時');
  // Each plan: `lead` (its route's card), `weak` (set aside), `times` (its
  // route's departures, as indexes into the list returned).
  // The rivers a plan's rides and walks cross (shown on it: 騎車過頭前溪).
  const rivers = p => [...new Set(p.legs.filter(l => l.mode === 'bike' || l.mode === 'walk').flatMap(l => crossed(l.from, l.to)))];
  const riverBy = p => (p.legs.some(l => l.mode === 'bike' && crossings(l.from, l.to)) ? '騎車' : '步行');
  const out = list.map(p => ({ ...p, rivers: rivers(p), riverBy: riverBy(p), score: Math.round(p.score), top: picked.has(p), lead: groups.get(pickSig(p))[0] === p, weak: weak.has(p), tags: [...new Set(label.get(p))] }));
  out.forEach((p, i) => (p.times = times.get(list[i]).map(q => list.indexOf(q))));
  // Said on the plan: a wait overnight half way (nothing else gets there
  // tonight), or setting out on another day than asked.
  const today = tw(by === 'arrive' && deadline ? deadline : now).date;
  for (const p of out) {
    const k = p.legs.findIndex((l, i) => i > 0 && l.dep - p.legs[i - 1].arr > 90 * 60_000);
    if (k > 0) p.late = W(`中途要在${p.legs[k].from?.name || '轉乘站'}等到 ${hm(p.legs[k].dep)}${tw(p.legs[k].dep).date !== today ? '（隔天）' : ''}`, `Wait at ${p.legs[k].from?.name || 'the change'} until ${hm(p.legs[k].dep)}${tw(p.legs[k].dep).date !== today ? ' (next day)' : ''}`);
    else if (tw(p.dep).date !== today) p.late = W(`${tw(p.dep).date === addDays(today, 1) ? '明天' : tw(p.dep).date.slice(5).replace('-', '/')} ${hm(p.dep)} 才有車`, `First ride ${tw(p.dep).date === addDays(today, 1) ? 'tomorrow' : tw(p.dep).date.slice(5).replace('-', '/')} ${hm(p.dep)}`);
  }
  return out;
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
    // (To be there by a time: setting out so as to get in 5 minutes before it.)
    const ridden = bikeOnly(o, d, bikes, now, { swap });
    out.push(...(opts.by === 'arrive' && opts.deadline ? ridden.map(p => finish({ ...p, legs: shift(p.legs, opts.deadline - 5 * 60_000 - p.arr) })) : ridden));
    // (From the plans with their stations: a train reached by bike can still end by bike.)
    for (const p of out.slice()) {
      if (p.legs.some(l => l.placeholder) || (p.bike && !p.legs.some(l => l.mode !== 'walk' && l.mode !== 'bike'))) continue;
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
      // A change gone: by bike to the bus (or train) after it, which goes
      // the rest of the way; or off the first one and on by bike.
      const rides = p.legs.map((l, i) => (l.mode !== 'walk' && l.mode !== 'bike' ? i : -1)).filter(i => i >= 0);
      for (const k of rides.slice(1)) {
        const a = bikeToRail(p, o, bikes, { at: k });
        if (a) out.push(a);
      }
      for (const k of rides.slice(0, -1)) {
        const b = bikeFromRail(p, d, bikes, { at: k });
        if (b) out.push(b);
        // And by bike to that first one too (成功九街 → 竹東高中: to 文興嘉興路口
        // by bike, not a 16-minute walk, then off the 快捷8號支 and on by bike).
        const ab = b && bikeToRail(b, o, bikes, { anyRide: true });
        if (ab) out.push(ab);
      }
    }
  }
  // Each plan's first bus as you'd catch it, its way there as it is now (a bike to it built above).
  const clock = opts.clock ?? now;
  return rank(
    out.filter(p => allowed(p, modes)).map(p => catchBus(p, clock, opts.by === 'arrive' ? clock : now)),
    { now, o, d, ...opts }
  );
}

function withStations(p, bikes) {
  const legs = p.legs
    // TDX's zero-length walks between two halves of one stop.
    .filter(l => !(l.mode === 'walk' && (l.dist || 0) < 5 && (l.dur || 0) < 30))
    .map((l, i, all) => {
      if (l.mode !== 'bike' || l.rent) return l;
      const rent = rentNear(l.from, bikes, { max: 700, to: l.to, first: all.slice(0, i).every(x => x.mode === 'walk') });
      const ret = returnNear(l.to, bikes, { max: 700, from: rent || l.from });
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
      return { ...l, name: 'YouBike', rent, ret, from: rent ? { name: rent.name, lat: rent.lat, lon: rent.lon } : { ...l.from, name: l.from.name || W('附近的 YouBike 站', 'Nearby YouBike dock') }, to: ret ? { name: ret.name, lat: ret.lat, lon: ret.lon } : { ...l.to, name: l.to.name || W('附近的 YouBike 站', 'Nearby YouBike dock') } };
    });
  if (legs.some(l => l === null)) return null;
  // (A ride to the stop turned into a walk takes longer: set out earlier.)
  return tidy(finish({ ...p, legs: legs.flat() }));
}

// The points whose YouBike stations a set of plans needs: both ends, and
// where each plan first boards and last leaves a train or metro.
export function bikePoints(plans, o, d) {
  const pts = [o, d];
  // The stations of trains first (a ride to one has no plan without their
  // docks: the cut below once dropped 六家's), then the rest.
  for (const p of plans) {
    const rail = p.legs.filter(l => RAIL.has(l.mode));
    if (rail[0]?.from?.lat) pts.push(rail[0].from);
    if (rail.at(-1)?.to?.lat) pts.push(rail.at(-1).to);
  }
  for (const p of plans) {
    // The first and last stops of any ride, and a planner's own bike legs' ends.
    const rides = p.legs.filter(l => l.mode !== 'walk');
    if (rides[0]?.from?.lat) pts.push(rides[0].from);
    if (rides.at(-1)?.to?.lat) pts.push(rides.at(-1).to);
    // Where a later ride boards near the start, an earlier one ends near the end (a change ridden round).
    for (const l of rides.slice(1)) if (l.from?.lat && meters(o.lat, o.lon, l.from.lat, l.from.lon) < 6000) pts.push(l.from);
    for (const l of rides.slice(0, -1)) if (l.to?.lat && meters(d.lat, d.lon, l.to.lat, l.to.lon) < 6000) pts.push(l.to);
  }
  // One per ~400 m.
  const out = [];
  for (const p of pts) if (!out.some(q => meters(p.lat, p.lon, q.lat, q.lon) < 400)) out.push({ lat: p.lat, lon: p.lon });
  return out.slice(0, 16);
}

// A trip with stops, whole: after a way to the first stop, each next
// stretch's way from when you're there (the owner, 2026-10-15: the first
// stretch alone made a 3′ walk the trip). `rests`: each later stretch's
// plans as ranked; a walk or a ride of its own goes whenever you're there, a
// bus or train only while it's still to leave; its recommendation first,
// else the soonest there. → the later stretches' plans, or null while one
// isn't planned; where nothing gets there, those before it, `short` that
// stretch's number (0: the first after p).
export function chainOn(p, rests) {
  const out = [];
  let t = p.arr;
  for (const plans of rests) {
    if (!plans) return null;
    const fit = (plans || [])
      .map(q => (vehicles(q).length ? q : shiftPlan(q, t - q.dep)))
      .filter(q => q.dep >= t - 60_000);
    const q = fit.find(x => x.top) || fit.filter(x => !x.weak).sort((a, b) => a.arr - b.arr)[0] || fit.sort((a, b) => a.arr - b.arr)[0];
    if (!q) return Object.assign(out, { short: out.length });
    out.push(q);
    t = q.arr;
  }
  return out;
}
const shiftPlan = (q, d) => (d ? { ...q, dep: q.dep + d, arr: q.arr + d, legs: q.legs.map(l => ({ ...l, dep: l.dep + d, arr: l.arr + d })) } : q);

// A trip with stops by one YouBike, kept (locked by each place) and returned
// only near the last (the owner, 2026-10-15). `have`: you're on it already
// (navigating, at a stop): it rides from o. → each stretch's plan (the bike
// taken at the first, returned at the last), or null with no bike near o, no
// dock near the last place, or a ride too long.
// `swap` (TPASS's free half hour, or 每 30 分鐘換車): still the one bike
// through the stops, but before a ride would take the rental past half an
// hour (from `since`, when it was taken: a stop's stay counts, so
// navigating it's the real one) it's returned at a dock by the stop it
// leaves and another taken there; a ride over half an hour itself changed
// on the way (swapRides). → each stretch's plan; the first has `rentAt`,
// when the rental it ends with began.
export function keepBike(o, places, bikes, dep, { have = false, swap = false, since = dep } = {}) {
  const last = places.at(-1);
  const rent = have ? null : rentNear(o, bikes, { to: places[0], first: true });
  const ret = returnNear(last, bikes, { from: places.at(-2) || rent || o });
  if ((!have && !rent) || !ret) return null;
  // (The station nearest the bike's way at the first stop rather than here: there on foot, the bike from there.)
  if (rent && places.length > 1 && meters(rent.lat, rent.lon, places[0].lat, places[0].lon) < meters(rent.lat, rent.lon, o.lat, o.lon)) {
    const w = walkLeg(o, places[0], dep);
    const rest = keepBike(places[0], places.slice(1), bikes, w.arr, { swap });
    return rest && [finish({ src: 'keep', keep: true, legs: [w] }), ...rest];
  }
  // (A ride from or to a place, not a station: no docking there.)
  const ride = (a, b, t, { take = false, give = false } = {}) => {
    const dist = Math.round(roadM(a, b));
    const dur = rideSec(dist / 1.25) + (take + give) * DOCK_SEC;
    return { mode: 'bike', name: 'YouBike', from: { name: a.name || '', lat: a.lat, lon: a.lon }, to: { name: b.name || '', lat: b.lat, lon: b.lon }, dur, dist, dep: t, arr: t + dur * 1000, ...(take ? { rent: a } : { kept: true }), ...(give ? { ret: b } : { park: true }) };
  };
  const out = [];
  let at = have ? o : rent;
  let t = dep;
  let rentAt = have ? since : null;
  for (const [k, pl] of places.entries()) {
    const legs = [];
    if (!k && !have) {
      const w = walkLeg(o, rent, t);
      if (w.dist > 20) legs.push(w), (t = w.arr);
      rentAt = t;
    }
    const end = k === places.length - 1;
    let r = ride(at, end ? ret : pl, t, { take: !k && !have, give: end });
    if (r.dist > BIKE_MAX_M) return null;
    // Past the half hour on this ride: back at a dock by this stop, another bike from it.
    const dock = swap && (have || k > 0) && (t - rentAt) / 1000 + r.dur > SWAP_SEC - 120 ? returnNear(at, bikes) : null;
    if (dock) {
      const back = ride(at, dock, t, { give: true });
      legs.push({ ...back, park: undefined });
      t = back.arr;
      r = { ...ride(dock, end ? ret : pl, t, { take: true, give: end }), swap: true };
      rentAt = t;
    }
    const long = swap ? swapRides([{ ...r, rent: r.rent || { ...r.from }, ret: r.ret || { ...r.to } }], bikes) : [r];
    if (long.length > 1) {
      // (Its first part as the ride was: on the bike you had, or the one taken.)
      legs.push({ ...long[0], rent: r.rent, kept: r.kept }, ...long.slice(1, -1));
      const tail = long.at(-1);
      legs.push({ ...r, ...tail, rent: tail.rent, ret: r.ret, park: r.park, kept: undefined });
      rentAt = tail.dep;
    } else legs.push(r);
    t = legs.at(-1).arr;
    if (end) {
      const w = walkLeg(ret, last, t);
      if (w.dist > 20) legs.push(w), (t = w.arr);
    }
    out.push(finish({ src: 'keep', keep: true, legs, rentAt }));
    at = pl;
  }
  return out;
}

// A trip with stops: one YouBike kept is the recommendation (the owner,
// 2026-10-15: buses between stops are poor, the bike works best overall),
// unless a stop is far (a ride over 20 minutes to it) or walking it all
// gets there sooner. `keep`: keepBike's stretches; `whole`: the recommended
// way, each stretch's plan.
export const KEEP_RIDE_MAX = 20 * 60;
export function keepWins(keep, whole) {
  if (!keep?.length) return false;
  if (keep.some(q => q.legs.some(l => l.mode === 'bike' && l.dur > KEEP_RIDE_MAX))) return false;
  const walked = whole?.length && whole.every(q => q.legs.every(l => l.mode === 'walk'));
  return !(walked && whole.at(-1).arr <= keep.at(-1).arr);
}

