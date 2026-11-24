// Already on a train when a trip is asked for (Jay 2026-11-03: 回家 tapped
// on a train "will reliably give you a trip, not use that mid train point to
// calculate"): only when navigation says you're on it (its leg's train), the
// trip from it: stay on it to one of its stops ahead, then on from there.
// Guessing a train or a bus from the fixes alone went (Jay 11-24: "not
// reliable as I use it"; a kilometre from the line, a train going by was
// taken for yours). How you're moving (motion, the paces) is still read:
// navigation's own boarding and the beam on your dot use it.

import { meters, isRide, tw } from './util.mjs';
import { finish, walkLeg } from './plan.mjs';
import { trainKind } from './ui.mjs';
import { W } from '#kit/lang.mjs';

const MIN = 60_000;
// The fixes looked at: the last two and a half minutes.
const SPAN_MS = 150_000;
// A train's pace (m/s): 20 km/h on average (北新竹 → 新竹 is 22 as the crow
// flies), or 45 between two fixes.
const TRAIN_MS = { avg: 5.5, top: 12.5 };
// A bus's: faster than a YouBike goes (a 電輔車 stops helping at 25 km/h) between two fixes.
const BUS_MS = { avg: 3, top: 8 };

// How you've been moving: the last fix, metres a second (average, and the
// quickest between two fixes), which way (a unit vector east, north), over
// how long. → null when there's too little to say (two fixes, 15 s, 100 m).
export function motion(fixes, now = Date.now()) {
  const f = steadyFixes((fixes || []).filter(x => x && x.t >= now - SPAN_MS && x.lat != null && (x.acc ?? 0) <= 400).sort((a, b) => a.t - b.t));
  if (f.length < 2) return null;
  // (Ends: of the first three and the last three, the one nearest the other
  // two: the newest fix, a jump, had read as going at a bus's pace.)
  const a = f.length >= 6 ? medoid(f.slice(0, 3)) : f[0];
  const b = f.length >= 6 ? medoid(f.slice(-3)) : f.at(-1);
  const secs = (b.t - a.t) / 1000;
  // (Only what's beyond the two fixes' own error counts as moved: standing
  // still, two rough fixes 80 m apart aren't a walk, nor 30 m in 4 s a bus.)
  const moved = beyond(a, b);
  if (secs < 15 || moved < 100) return null;
  let top = 0;
  for (let k = 1; k < f.length; k++) {
    // (Over 15 s at least, beyond both fixes' error: a jump between two fixes 4 s apart isn't a train.)
    let j = k - 1;
    while (j > 0 && f[k].t - f[j].t < 15_000) j--;
    const s = (f[k].t - f[j].t) / 1000;
    if (s >= 4) top = Math.max(top, beyond(f[j], f[k], 0.25) / s);
  }
  // (The device's own speed, when it says one.)
  for (const x of f) if (Number.isFinite(x.speed) && x.speed > 0) top = Math.max(top, x.speed);
  const v = vec(a, b);
  return { lat: b.lat, lon: b.lon, first: a, fixes: f, avg: moved / secs, top, dir: v, secs, moved };
}
const medoid = xs => xs.reduce((best, x) => {
  const sum = xs.reduce((n, y) => n + meters(x.lat, x.lon, y.lat, y.lon), 0);
  return sum < best.sum ? { x, sum } : best;
}, { x: xs[0], sum: Infinity }).x;
// Metres between two fixes past what their own error (`share` of each's accuracy) could make of standing still.
const beyond = (a, b, share = 0.5) => Math.max(0, meters(a.lat, a.lon, b.lat, b.lon) - ((a.acc ?? 0) + (b.acc ?? 0)) * share);
// A phone's fixes without its jumps (Jay 2026-11-12: real GPS is rough; it jumps
// 100 m and more with its accuracy still saying 20): a fix far from both its
// neighbours while they're near each other is one. The newest has no
// neighbour after it: kept, and whoever acts on it waits for the next (nav.mjs `held`).
export function steadyFixes(f) {
  if (f.length < 3) return f;
  const d = (x, y) => meters(x.lat, x.lon, y.lat, y.lon);
  return f.filter((x, k) => {
    if (k === 0 || k === f.length - 1) return true;
    const p = f[k - 1], q = f[k + 1];
    const slack = 60 + (p.acc ?? 0) + (q.acc ?? 0) + 2 * (x.acc ?? 0);
    return d(p, x) + d(x, q) <= 2 * d(p, q) + slack;
  });
}
// East and north metres from a to b, as a unit vector (and its length).
function vec(a, b) {
  const y = (b.lat - a.lat) * 111_320;
  const x = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m, m };
}
// (Its top alone only when moving on too: walking in a city, a jump of 300 m
// had read as a train's pace and flipped 下車了 to 搭錯車; Jay 2026-11-12.)
export const trainPace = m => Boolean(m) && (m.avg >= TRAIN_MS.avg || (m.top >= TRAIN_MS.top && m.avg >= 2));
export const busPace = m => Boolean(m) && m.avg >= BUS_MS.avg && m.top >= BUS_MS.top;

// The train you're on, said by navigation (it follows you on it: `no`): where
// it is by its clock and delay (`at`: the stop it left last). → null when it
// isn't running now. (Guessing the train or bus from the fixes alone went,
// Jay 11-24: "not reliable as I use it"; only navigation says you're on one.)
export function trainRide(trips, stations, no, live = new Map(), now = Date.now()) {
  const t = (trips || []).find(x => (x.sys === 'tra' || x.sys === 'hsr') && String(x.no) === String(no));
  if (!t?.stops?.length) return null;
  const byKey = new Map(stations.map(s => [s.key, s]));
  const lv = live.get(String(t.no));
  const delay = (lv?.delay || 0) * MIN;
  const st = t.stops.map(s => ({ ...s, p: byKey.get(s.st), dep: (s.dep ?? s.arr) + delay, arr: (s.arr ?? s.dep) + delay }));
  if (st[0].dep > now + MIN || st.at(-1).arr < now - MIN) return null;
  let x = 0;
  while (x < st.length - 2 && st[x + 1].dep <= now) x++;
  return { mode: t.sys, train: { sys: t.sys, no: t.no, type: t.type, code: t.code }, delay: delay / MIN, live: Boolean(lv), headsign: t.headsign, typeFull: t.typeFull, at: x, stops: st.map(s => ({ st: s.st, name: s.p?.name || '', lat: s.p?.lat, lon: s.p?.lon, arr: s.arr, dep: s.dep })) };
}

// The train you're on as a plan's first leg, to stop `k` of its stops: from
// the stop it left last (its time then), `aboard` so navigation starts on it.
export function trainLegTo(ride, k, now = Date.now()) {
  const s0 = ride.stops[ride.at];
  const s1 = ride.stops[k];
  const t = ride.train;
  return {
    mode: ride.mode,
    name: ride.mode === 'hsr' ? '高鐵' : ride.typeFull || t.type,
    short: ride.mode === 'hsr' ? W(`${t.no} 次`, `HSR ${t.no}`) : `${trainKind(t.type)} ${t.no}`,
    headsign: ride.headsign,
    from: { name: s0.name, lat: s0.lat, lon: s0.lon },
    to: { name: s1.name, lat: s1.lat, lon: s1.lon },
    dep: s0.dep,
    arr: s1.arr,
    dur: Math.round((s1.arr - s0.dep) / 1000),
    stops: k - ride.at,
    agency: ride.mode === 'hsr' ? '台灣高鐵' : ride.typeFull || '台鐵',
    dist: Math.round(meters(s0.lat, s0.lon, s1.lat, s1.lon)),
    train: t,
    ...(ride.live ? { live: { at: s0.dep, delay: ride.delay } } : {}),
    aboard: { at: now }
  };
}
// Where to get off, of the stops ahead (`stops`, from `from` on: each { lat,
// lon, arr }): the one nearest the place, and another a kilometre and more
// from it, nearer the place than you are (a change there may be quicker).
// → stop indexes, best first (two at most).
export function getOffAt(stops, from, to, here) {
  const ahead = stops.map((s, k) => ({ k, s })).filter(({ k, s }) => k >= from && s.lat != null);
  if (!ahead.length) return [];
  const dist = s => meters(s.lat, s.lon, to.lat, to.lon);
  const byNear = [...ahead].sort((a, b) => dist(a.s) - dist(b.s));
  const out = [byNear[0].k];
  const far = here ? meters(here.lat, here.lon, to.lat, to.lon) : Infinity;
  const two = byNear.find(x => x.k !== out[0] && meters(x.s.lat, x.s.lon, stops[out[0]].lat, stops[out[0]].lon) >= 1000 && dist(x.s) < far);
  if (two && dist(byNear[0].s) > 800) out.push(two.k);
  return out;
}

// The ride you're on, then a plan from where it gets you off (`q`, planned
// from that stop): one plan. The same train or bus boarded again there (the
// planner kept you on it) is the ride carried on to where it gets off.
const sameRide = (a, b) => a.mode === b.mode && (a.train?.no ? String(a.train.no) === String(b.train?.no ?? '') : String(a.short || a.name) === String(b.short || b.name));
export function joinRide(ride, q, now = Date.now()) {
  let legs = [...(q?.legs || [])];
  // (The few steps of a walk from the stop to itself: none.)
  while (legs[0]?.mode === 'walk' && (legs[0].dist || 0) < 60 && isRide(legs[1])) legs = legs.slice(1);
  let first = { ...ride };
  if (legs[0] && isRide(legs[0]) && sameRide(ride, legs[0])) {
    const on = legs.shift();
    first = { ...first, to: on.to, arr: on.arr, dur: Math.round((on.arr - first.dep) / 1000), stops: (first.stops || 0) + (on.stops || 0), dist: (first.dist || 0) + (on.dist || 0) };
  }
  // (Nothing after it: you're there when it gets in.)
  legs = legs.map(l => (l.dep != null && l.dep < first.arr && !isRide(l) ? { ...l, dep: first.arr, arr: first.arr + (l.dur || 0) * 1000 } : l));
  const p = finish({ ...(q || {}), src: `aboard${q?.src ? `+${q.src}` : ''}`, legs: [first, ...legs] });
  return { ...p, aboard: { at: now } };
}
// On board and getting off near the place: the ride, then the walk.
export function rideThenWalk(ride, to, now = Date.now()) {
  const w = walkLeg(ride.to, to, ride.arr);
  return joinRide(ride, { legs: w.dist > 20 ? [w] : [] }, now);
}

// Said of the ride on the plans card's start: 區間 1234 上 / On 5608.
export const aboardName = l => (l ? W(`${l.short || l.name} 上`, `On ${l.short || l.name}`) : '');
