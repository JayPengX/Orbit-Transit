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

import { meters, walkSec, tw, hm, addDays } from './util.mjs';
import { journeys, directs } from './rail.mjs';
import { crossings, crossed, crossingCost, bridgeExtra } from './rivers.mjs';

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

// (Over a river, the way round to its bridge too.)
const walkLeg = (from, to, dep) => {
  const dist = Math.round((meters(from.lat, from.lon, to.lat, to.lon) + bridgeExtra(from, to, 'walk')) * 1.3);
  const dur = walkSec(dist / 1.3);
  return { mode: 'walk', from: { name: from.name || '', lat: from.lat, lon: from.lon }, to: { name: to.name || '', lat: to.lat, lon: to.lon }, dur, dist, dep, arr: dep + dur * 1000, straight: true, bridged: true };
};

// One ride from station to station, leaving at t.
const rideLeg = (rent, ret, t, ebike = false) => {
  const dist = Math.round((meters(rent.lat, rent.lon, ret.lat, ret.lon) + bridgeExtra(rent, ret, 'bike')) * 1.25);
  const dur = rideSec(dist / 1.25, ebike) + 2 * DOCK_SEC;
  return { mode: 'bike', ebike, name: ebike ? 'YouBike 電輔車' : 'YouBike', from: { name: rent.name, lat: rent.lat, lon: rent.lon }, to: { name: ret.name, lat: ret.lat, lon: ret.lon }, dur, dist, dep: t, arr: t + dur * 1000, rent, ret, bridged: true };
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
  const ride = bikeTrip(o, board.from, bikes, 0);
  if (!ride) return null;
  const took = ride.at(-1).arr; // from 0
  const leave = board.dep - 2 * 60_000 - took;
  if (at < 0 && leave < plan.dep - 60_000) return null; // no earlier than the plan already leaves (the score decides between them)
  return finish({ src: 'bike+', base: plan.src, legs: [...shift(ride, leave), ...plan.legs.slice(k)] });
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
  const starts = A.map(x => ({ key: x.s.key, at: at + x.a.sec * 1000 + 3 * 60_000, pre: x.a.sec + 180 }));
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
// wait before leaving only a third: it's spent at home), and on top of it what a person who rides YouBike to fill the gaps the buses and
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
//     station is nothing, 18 is a workout, past that every minute counts
//     four and a half times the minute it saves (28 minutes across town in work clothes
//     is not how anyone goes every day). Two short rides beat one long one.
//     (A ride cut at 30 minutes to stay free is still one ride.) And the
//     riding in all: 15 minutes to a train and 6 from it is nearly the ride
//     the whole way. 電輔車 is a
//     little easier going, not a free pass; a bike at a station with only one
//     or two left may be gone; one over a river by a main road's bridge
//     (經國大橋) is a ride few take, by a small one (竹中's) a little cost;
//   - a trip whose buses or trains go the long way round (into 新竹市 and back
//     out, when the place is the other way), or change farther from the place
//     than you started. Getting to the first one is not the long way round:
//     riding north to 竹北's station for a train south costs its minutes and
//     its ride, nothing more;
//   - what it costs in money, and a train it would now miss.
export const rideEffort = min => Math.min(min, 10) * 0.1 + Math.min(Math.max(min - 10, 0), 8) * 0.6 + Math.max(min - 18, 0) * 4.5;
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
  // when you leave. By an arrival time: how early you must leave.
  if (by === 'arrive' && deadline) add('time', (deadline - p.dep) / 60_000);
  else {
    add('time', (p.arr - p.dep) / 60_000);
    add('wait', Math.max(0, (p.dep - now) / 60_000) * 0.35);
  }
  for (let i = 1; i < rides.length; i++) {
    const [a, b] = [rides[i - 1].mode, rides[i].mode];
    add('changes', a === 'bus' && b === 'bus' ? 35 : b === 'bus' ? 10 : 7);
  }
  add('bus', rides.filter(l => l.mode === 'bus').reduce((a, l) => a + (l.dur || 0) / 60, 0) * 0.08);
  // Each bus caught: its time is a guess (early as often as late), so you're
  // at the stop early and it may still be late: a few minutes that on a short
  // trip are most of it (1–2 km: a YouBike, there when you are, over the bus
  // a minute sooner on paper). A train or the metro keeps its time.
  add('board', rides.filter(l => l.mode === 'bus').length * 4);
  // Walking past 5 minutes is slow going.
  add('walk', Math.max(0, (p.walk || 0) / 75 - 5) * 0.6);
  // The bike rides, one swapped bike to the next counted as one ride.
  let ride = null;
  const bikes = [];
  for (const l of p.legs) {
    if (l.mode !== 'bike') { ride = null; continue; }
    if (ride && l.swap) ride.min += (l.dur || 0) / 60;
    else bikes.push((ride = { min: (l.dur || 0) / 60, ebike: !!l.ebike, rent: l.rent }));
  }
  // Over a river: by the bridge it'd take (a main road's in the traffic, or
  // a small one), and the way round to it.
  for (const l of p.legs) if (l.mode === 'bike' || l.mode === 'walk') add('river', crossingCost(l.from, l.to, l.mode, l.bridged));
  for (const r of bikes) {
    add('bike', 1.5 + rideEffort(r.ebike ? r.min * 0.95 : r.min));
    const left = r.rent ? (r.ebike ? r.rent.ebike : r.rent.bikes) : null;
    if (left != null && left < 3) add('fewBikes', 3);
  }
  // And riding in all: 15 minutes to the train and 6 from it is 21 on a bike,
  // nearly what riding the whole way takes; the train saves little.
  const rideAll = bikes.reduce((a, r) => a + r.min, 0);
  if (rides.length) add('bike', Math.max(0, rideAll - 12) * 0.5);
  const placed = rides.filter(l => l.from?.lat != null && l.to?.lat != null);
  if (placed.length) {
    // The rides' own way against the straight line from the first stop to the last.
    const [a, b] = [placed[0].from, placed.at(-1).to];
    const span = Math.max(1000, meters(a.lat, a.lon, b.lat, b.lon));
    const path = placed.reduce((x, l) => x + meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon), 0);
    add('detour', Math.max(0, path / span - 1.2) * 45);
  }
  if (o && d) {
    // Heading away: a change made farther from the place than where you started.
    const direct = Math.max(1000, meters(o.lat, o.lon, d.lat, d.lon));
    if (rides.slice(0, -1).some(l => l.to?.lat != null && meters(l.to.lat, l.to.lon, d.lat, d.lon) > direct + 1500)) add('away', 8);
  }
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
// planner's names for things (快捷8號 / 快捷8, 竹北車站 / 竹北): the buses
// and metro by their line, the trains by where you get on and off.
const norm = x => String(x || '').replace(/\s+/g, '').replace(/[號线線]/g, '').replace(/[（(].*$/, '').replace(/^高鐵/, '').replace(/(火車站|車站|站)$/, '').replace(/台/g, '臺').toUpperCase();
// A station however a source writes it: 竹北火車站, 臺鐵竹北車站 and 竹北 are one.
const station = n => norm(n).replace(/^(臺鐵|高鐵)/, '').replace(/(火車站|車站|站)$/, '') || norm(n);
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
    .map(x => (x.mode === 'tra' || x.mode === 'hsr' ? `${x.mode}:${station(x.from)}>${station(x.to)}` : `${x.mode}:${norm(x.name)}`))
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
  if (n || k) return norm(l.from?.name) === norm(m.from?.name) && Math.abs((l.dep || 0) - (m.dep || 0)) <= 2 * 60_000;
  return norm(l.short || l.name) === norm(m.short || m.name) && Math.abs((l.dep || 0) - (m.dep || 0)) <= 8 * 60_000;
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
  //   - it rides most of what riding all the way would (a bus north, then 25
  //     minutes on a bike: then ride it all);
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
  // Riding it all, if that's a ride you'd take (not over 頭前溪's car bridge).
  const allBike = list.filter(p => p.bike && !vehicles(p).length && !p.legs.some(l => l.mode === 'bike' && crossings(l.from, l.to))).map(rideM);
  const bikeAll = allBike.length ? Math.min(...allBike) : null;
  const best = list[0].score;
  const weak = new Set();
  // The ride a plan is for: its longest bus or train.
  const main = p => vehicles(p).reduce((a, l) => (!a || (l.dur || 0) > (a.dur || 0) ? l : a), null);
  const sameRide = sameVehicle;
  for (const p of leads) {
    // Another way onto the same bus or train (a bike to it, not a walk and a
    // bus): no earlier out of the door, no later there, less bother. Another
    // line altogether is never this: it's a choice of its own.
    const m = main(p);
    const beaten = m && list.some(q => groups.get(pickSig(q)) !== groups.get(pickSig(p)) && q.score < p.score && q.dep >= p.dep - 60_000 && q.arr <= p.arr + 60_000 && vehicles(q).some(l => sameRide(l, m)));
    // More changes than another bus-or-train way that's no later (within 5
    // minutes) and less bother: off the train at 北新竹 for the 5608, when
    // staying on to 新竹 and riding is sooner.
    const n = segs(p).length;
    const changes = n > 1 && list.some(q => groups.get(pickSig(q)) !== groups.get(pickSig(p)) && segs(q).length >= 1 && segs(q).length < n && q.score < p.score && q.arr <= p.arr + 5 * 60_000);
    // A change for a hop: onto a bus or metro for a stop or two (a few
    // minutes, under 1.5 km) that a walk or a bike from where you got off
    // would do (新竹站, then 綠線 one stop, then a bike again).
    // (Short by its distance: 5 minutes of metro across 3 km is no hop.)
    const short = l => (l.from?.lat != null && l.to?.lat != null ? meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon) < 1500 : (l.stops != null && l.stops <= 2) || (l.dur || 0) <= 6 * 60);
    const hop = n > 1 && vehicles(p).some(l => l !== m && short(l));
    const mostlyRidden = bikeAll != null && vehicles(p).length && rideM(p) >= Math.max(3000, bikeAll * 0.6);
    // Far behind the best, unless it gets there sooner than ways ahead of
    // it (off at 竹中 and ride, over the change to the 六家線: more riding, but
    // home sooner, a real choice).
    const sooner = leads.some(q => q !== p && q.score < p.score && q.score <= best + Math.max(45, best) && q.arr > p.arr + 5 * 60_000 && vehicles(q).length);
    const far = p.score > best + Math.max(45, best) && !(sooner && p.score <= best + 2 * Math.max(45, best));
    if (beaten || changes || hop || mostlyRidden || far) for (const q of groups.get(pickSig(p))) weak.add(q);
  }
  // Never nothing: the best way stays when every way was set aside.
  if (leads.every(p => weak.has(p))) for (const q of groups.get(pickSig(leads[0]))) weak.delete(q);
  // A route's other departures: the next few, within an hour and a half of its first.
  const times = new Map();
  for (const g of groups.values()) {
    // (A ride or a walk of your own has no times: you leave when you like.)
    if (!vehicles(g[0]).length) {
      for (const q of g) times.set(q, [q]);
      continue;
    }
    const by = [...g].sort((a, b) => a.dep - b.dep).filter(q => q === g[0] || Math.abs(q.dep - g[0].dep) <= 90 * 60_000).slice(0, 6);
    for (const q of g) times.set(q, by);
  }
  // Different ways first: each recommendation rides a different main line
  // (its longest ride); then, if there are fewer, different rides at all.
  const picked = new Set();
  const mains = new Set();
  const lines = new Set();
  const shown = leads.filter(p => !weak.has(p));
  for (const p of shown) {
    if (picked.size >= top) break;
    if (mains.has(mainLine(p))) continue;
    mains.add(mainLine(p));
    lines.add(ridesSig(p));
    picked.add(p);
  }
  for (const p of shown) {
    if (picked.size >= top) break;
    if (picked.has(p) || lines.has(ridesSig(p))) continue;
    lines.add(ridesSig(p));
    picked.add(p);
  }
  const label = new Map(list.map(p => [p, []]));
  const pool = shown.length ? shown : leads;
  const by_ = (f, name) => {
    const best = pool.reduce((a, b) => (f(b) < f(a) ? b : a));
    if (pool.filter(p => f(p) === f(best)).length < pool.length) label.get(best).push(name);
  };
  label.get(pool[0]).push('推薦');
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
    if (k > 0) p.late = `中途要在${p.legs[k].from?.name || '轉乘站'}等到 ${hm(p.legs[k].dep)}${tw(p.legs[k].dep).date !== today ? '（隔天）' : ''}`;
    else if (tw(p.dep).date !== today) p.late = `${tw(p.dep).date === addDays(today, 1) ? '明天' : tw(p.dep).date.slice(5).replace('-', '/')} ${hm(p.dep)} 才有車`;
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
    out.push(...bikeOnly(o, d, bikes, now, { swap }));
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
