// Already on a bus or train when a trip is asked for (Jay 2026-11-03: 回家
// tapped on a train "will reliably give you a trip, not use that mid train
// point to calculate"): which one you're on, from the last few minutes of
// fixes, and the trip from it: stay on it to one of its stops ahead, then on
// from there.
//
//   - 台鐵 / 高鐵: moving at a train's pace, and today's train (its timetable
//     with TDX's live delay) is where you are, going your way.
//   - A bus: going faster than a bike rides, along a route's stops (two fixes
//     going its way), and TDX sees that route's bus due at the stop just ahead
//     of you in about the time you'll be there. Two routes that fit: asked.
//   - The metro runs underground (no fixes): planned as before.
//
// Never a trip started by itself: only what 規劃 from 你的位置 plans from.

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
  const f = (fixes || []).filter(x => x && x.t >= now - SPAN_MS && x.lat != null && (x.acc ?? 0) <= 400).sort((a, b) => a.t - b.t);
  if (f.length < 2) return null;
  const a = f[0];
  const b = f.at(-1);
  const secs = (b.t - a.t) / 1000;
  const moved = meters(a.lat, a.lon, b.lat, b.lon);
  if (secs < 15 || moved < 100) return null;
  let top = 0;
  for (let k = 1; k < f.length; k++) {
    const s = (f[k].t - f[k - 1].t) / 1000;
    if (s >= 4) top = Math.max(top, meters(f[k - 1].lat, f[k - 1].lon, f[k].lat, f[k].lon) / s);
  }
  // (The device's own speed, when it says one.)
  for (const x of f) if (Number.isFinite(x.speed) && x.speed > 0) top = Math.max(top, x.speed);
  const v = vec(a, b);
  return { lat: b.lat, lon: b.lon, first: a, fixes: f, avg: moved / secs, top, dir: v, secs, moved };
}
// East and north metres from a to b, as a unit vector (and its length).
function vec(a, b) {
  const y = (b.lat - a.lat) * 111_320;
  const x = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m, m };
}
const dot = (u, v) => u.x * v.x + u.y * v.y;
export const trainPace = m => Boolean(m) && (m.avg >= TRAIN_MS.avg || m.top >= TRAIN_MS.top);
export const busPace = m => Boolean(m) && m.avg >= BUS_MS.avg && m.top >= BUS_MS.top;

// The train you're on, of today's (`trips`, raildata dayTrips; `live`: TDX's
// board by train number): where each running one is by its timetable with
// its delay, the nearest you (within 2.5 km, 6 for 高鐵) going your way.
// → { mode, train, delay, at (the stop index it left last), stops (the trip's,
// each with its place and its times with the delay) } or null.
export function trainAboard(trips, stations, m, live = new Map(), now = Date.now()) {
  if (!trainPace(m)) return null;
  const byKey = new Map(stations.map(s => [s.key, s]));
  let best = null;
  for (const t of trips || []) {
    if (t.sys !== 'tra' && t.sys !== 'hsr') continue;
    const lv = live.get(String(t.no));
    const delay = (lv?.delay || 0) * MIN;
    const st = t.stops.map(s => ({ ...s, p: byKey.get(s.st), dep: (s.dep ?? s.arr) + delay, arr: (s.arr ?? s.dep) + delay }));
    if (st[0].dep > now + MIN || st.at(-1).arr < now - MIN) continue;
    // Between which two of its stations it is by the clock, and how far.
    const x = st.findIndex((s, k) => k < st.length - 1 && now >= s.dep - 30_000 && now <= st[k + 1].arr + 30_000);
    if (x < 0) continue;
    const [s0, s1] = [st[x].p, st[x + 1].p];
    if (!s0 || !s1) continue;
    const f = st[x + 1].arr > st[x].dep ? Math.max(0, Math.min(1, (now - st[x].dep) / (st[x + 1].arr - st[x].dep))) : 1;
    const at = { lat: s0.lat + (s1.lat - s0.lat) * f, lon: s0.lon + (s1.lon - s0.lon) * f };
    let d = meters(m.lat, m.lon, at.lat, at.lon);
    // (And where it was at each fix, by the clock: a car beside the line keeps its own pace, not the train's.)
    const far = t.sys === 'hsr' ? 6000 : 2500;
    if (m.fixes.some(f => (clockAt(st, f.t) ? meters(f.lat, f.lon, clockAt(st, f.t).lat, clockAt(st, f.t).lon) : 0) > far)) continue;
    // (TDX's own word on where it is: its station near you counts too.)
    const ls = lv?.st && byKey.get(lv.st);
    if (ls && st.slice(x, x + 2).some(s => s.st === lv.st)) d = Math.min(d, meters(m.lat, m.lon, ls.lat, ls.lon) + 300);
    // Going its way: the way it runs between those two stations, near enough yours.
    if (dot(vec(s0, s1), m.dir) < 0.3) continue;
    if (d < far && (!best || d < best.d)) best = { d, t, st, x, delay, live: Boolean(lv) };
  }
  if (!best) return null;
  const { t, st, x } = best;
  return { mode: t.sys, train: { sys: t.sys, no: t.no, type: t.type, code: t.code }, delay: best.delay / MIN, live: best.live, headsign: t.headsign, typeFull: t.typeFull, at: x, stops: st.map(s => ({ st: s.st, name: s.p?.name || '', lat: s.p?.lat, lon: s.p?.lon, arr: s.arr, dep: s.dep })) };
}

// Where a train is at `t` by its stops' times (`st`, with places): at a
// station, or part way between two. → { lat, lon } or null.
function clockAt(st, t) {
  for (let k = 0; k < st.length - 1; k++) {
    const [a, b] = [st[k], st[k + 1]];
    if (!a.p || !b.p) continue;
    if (t < a.arr && k === 0) return a.p;
    if (t >= a.arr && t <= a.dep) return a.p;
    if (t > a.dep && t <= b.arr) {
      const f = b.arr > a.dep ? (t - a.dep) / (b.arr - a.dep) : 1;
      return { lat: a.p.lat + (b.p.lat - a.p.lat) * f, lon: a.p.lon + (b.p.lon - a.p.lon) * f };
    }
  }
  return st.at(-1).p || null;
}

// How far along a route's stops a point is, and how far off them: the stops
// joined straight (a route's stops are a few hundred metres apart).
// → { d (metres from its first stop), off, k (the stop before the point) } or null.
export function alongStops(stops, p) {
  let best = null;
  let cum = 0;
  for (let k = 0; k < stops.length - 1; k++) {
    const a = stops[k];
    const b = stops[k + 1];
    if (a.lat == null || b.lat == null) continue;
    const ab = vec(a, b);
    const ap = vec(a, p);
    const t = Math.max(0, Math.min(ab.m, dot(ab, ap) * ap.m));
    const q = { lat: a.lat + ((b.lat - a.lat) * t) / ab.m, lon: a.lon + ((b.lon - a.lon) * t) / ab.m };
    const off = meters(p.lat, p.lon, q.lat, q.lon);
    if (!best || off < best.off) best = { d: cum + t, off, k };
    cum += ab.m;
  }
  return best;
}
// On this way of a bus route (`w`: routeStops' { dir, stops }), from your
// fixes: every fix near its stops (within 150 m of the stops joined straight),
// going its way along them (most of what you moved), not past its last stop.
// → { j (the next stop ahead), d (metres to it) } or null.
export function onWay(w, m) {
  if (!w?.stops?.length || w.stops.length < 2) return null;
  const a = alongStops(w.stops, m.first);
  const b = alongStops(w.stops, m);
  if (!a || !b || a.off > 150 || b.off > 150) return null;
  if (m.fixes.some(x => (alongStops(w.stops, x)?.off ?? Infinity) > 200)) return null;
  if (b.d - a.d < 0.6 * m.moved) return null;
  const j = b.k + 1;
  if (j >= w.stops.length) return null;
  const s = w.stops[j];
  return { j, d: meters(m.lat, m.lon, s.lat, s.lon) };
}
// TDX's word that a bus of this way is where you are: one due at the stop
// just ahead in about the time you'll be there (at a bus's pace, two minutes
// either side), as its estimates (`rows`, the route's) say.
// → { plate, eta (s) } or null.
export function busDue(rows, w, j, d, m) {
  const r = (rows || []).find(x => x.StopUID === w.stops[j].uid && Number(x.Direction) === w.dir);
  if (!r || (Number(r.StopStatus) || 0) !== 0 || r.EstimateTime == null) return null;
  const eta = Number(r.EstimateTime);
  const mine = d / Math.max(4, m.avg);
  if (!Number.isFinite(eta) || eta > Math.max(180, mine + 120) || eta < mine - 120) return null;
  const plate = r.PlateNumb && r.PlateNumb !== '-1' ? r.PlateNumb : '';
  return { plate, eta };
}

// Which bus you're on, if any: the routes stopping near you, each way of each
// one you're going along, confirmed by its bus due just ahead. `deps`:
// stationsAround, routeStops, busEta, routeCity (bus.mjs, near.mjs).
// → [{ route: { uid, name, city }, w, j, eta, plate }] (one per route name).
export async function busesAboard(m, { stationsAround, routeStops, busEta, routeCity }) {
  if (!busPace(m)) return [];
  const sts = (await stationsAround(m.lat, m.lon).catch(() => [])).filter(s => meters(m.lat, m.lon, s.lat, s.lon) <= 400);
  const routes = new Map();
  for (const s of sts) for (const x of s.stops || []) if (!routes.has(x.routeUID)) routes.set(x.routeUID, { uid: x.routeUID, name: x.route, city: routeCity(x.routeUID) });
  const found = [];
  await Promise.all([...routes.values()].slice(0, 12).map(async route => {
    const ways = await routeStops(route, m).catch(() => null);
    const fits = (ways || []).map(w => ({ w, at: onWay(w, m) })).filter(x => x.at);
    if (!fits.length) return;
    const rows = await busEta(route.city, { route: route.uid }).then(x => x.rows, () => []);
    for (const { w, at } of fits) {
      const due = busDue(rows, w, at.j, at.d, m);
      if (due) found.push({ route, w, j: at.j, d: at.d, eta: due.eta, plate: due.plate });
    }
  }));
  const one = new Map();
  for (const f of found.sort((a, b) => a.d - b.d)) if (!one.has(f.route.name)) one.set(f.route.name, f);
  return [...one.values()];
}

// The ride you're on as a plan's first leg, to stop `k` of its stops: from
// the stop it left last (its time then), `aboard` so navigation starts on it.
// A train: `ride` from trainAboard. A bus: from busesAboard, `rideSec(j, k)`
// how long it takes from the stop ahead to k.
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
export function busLegTo(bus, k, rideSec, now = Date.now()) {
  const { w, j } = bus;
  const s0 = w.stops[j - 1] || w.stops[j];
  const s1 = w.stops[k];
  const atJ = now + bus.eta * 1000;
  const dep = Math.min(now, atJ - 60_000);
  const arr = atJ + (k > j ? rideSec(j, k) * 1000 : 0);
  return {
    mode: 'bus',
    name: bus.route.name,
    short: bus.route.name,
    headsign: w.headsign,
    from: { name: s0.name, lat: s0.lat, lon: s0.lon },
    to: { name: s1.name, lat: s1.lat, lon: s1.lon },
    dep,
    arr,
    dur: Math.round((arr - dep) / 1000),
    stops: k - (j - 1),
    dist: Math.round(meters(s0.lat, s0.lon, s1.lat, s1.lon) * 1.3),
    agency: '',
    route: { uid: bus.route.uid, city: bus.route.city, dir: w.dir, stopUID: s0.uid },
    live: { at: dep },
    ...(bus.plate ? { plate: bus.plate } : {}),
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
// For the 除錯紀錄: what was seen, no places.
export const aboardTrace = (m, found) => ({ avg: m ? Math.round(m.avg * 3.6) : null, top: m ? Math.round(m.top * 3.6) : null, secs: m ? Math.round(m.secs) : null, n: m?.fixes.length ?? 0, found: (found || []).map(f => f.train?.no || f.route?.name || ''), at: tw().hm });
