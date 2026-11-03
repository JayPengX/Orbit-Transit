// Already on a bus or train when a trip is asked for (Jay 2026-11-03: 回家 on
// a train "will reliably give you a trip, not use that mid train point"): the
// ride found from the fixes, the trip planned from its stops ahead, and
// navigation started on board.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, off, T, start, busTrip, show } from './navsim.mjs';
const A = await import('../public/lib/aboard.mjs');

const P = { lat: 24.8, lon: 120.97 };
// Fixes every 10 s going `ms` metres a second north (east when `east`).
const fixes = (from, n, ms, t0, { east = false, acc = 20 } = {}) => Array.from({ length: n }, (_, k) => ({ ...off(from, east ? 0 : k * 10 * ms, east ? k * 10 * ms : 0), acc, t: t0 + k * 10_000 }));

// A 台鐵 line north: stations every 4 km, a train every 4 minutes apart.
const st = Array.from({ length: 6 }, (_, k) => ({ key: `tra:${k}`, sys: 'tra', name: `站${k}`, ...off(P, k * 4000, 0) }));
const trip = (no, t0, { back = false } = {}) => ({
  sys: 'tra', no, type: '區間', code: '6', headsign: back ? '站0' : '站5',
  stops: (back ? [...st].reverse() : st).map((s, k) => ({ st: s.key, arr: t0 + k * 4 * 60_000, dep: t0 + k * 4 * 60_000 + 30_000 }))
});

test('motion: too little to say, a walk, a train', () => {
  const t = T(9);
  assert.equal(A.motion(fixes(P, 1, 20, t), t), null, 'one fix');
  assert.equal(A.motion(fixes(P, 3, 1.3, t), t + 20_000), null, 'a walk of 26 m');
  const m = A.motion(fixes(P, 6, 20, t), t + 50_000);
  assert.ok(m && A.trainPace(m) && m.dir.y > 0.99);
  assert.ok(!A.trainPace(A.motion(fixes(P, 12, 4, t), t + 110_000)), 'a bike is no train');
  assert.ok(!A.busPace(A.motion(fixes(P, 12, 4, t), t + 110_000)), 'nor a bus: never faster than 8 m/s');
});

test('trainAboard: the train where you are, going your way, its stops ahead', () => {
  const t0 = T(9);
  const trains = [trip('1201', t0), trip('1203', t0 + 8 * 60_000), trip('1202', t0, { back: true })];
  // Between 站1 and 站2, six minutes in: 1201 is half way.
  const now = t0 + 6 * 60_000 + 15_000;
  const m = A.motion(fixes(off(P, 5500, 0), 5, 17, now - 40_000), now);
  const r = A.trainAboard(trains, st, m, new Map(), now);
  assert.equal(r?.train.no, '1201');
  assert.equal(r.at, 1, 'it left 站1 last');
  // The other way round (1202) is never it, nor at walking pace.
  assert.equal(A.trainAboard([trains[2]], st, m, new Map(), now), null);
  assert.equal(A.trainAboard(trains, st, A.motion(fixes(off(P, 5500, 0), 5, 1.2, now - 40_000), now), new Map(), now), null);
  // Late 8 minutes by TDX's board: the train due here by its timetable then is 1203's slot, but 1201 is the one.
  const late = A.trainAboard([trip('1201', t0 - 8 * 60_000), trip('1203', t0)], st, m, new Map([['1201', { delay: 8 }]]), now);
  assert.equal(late?.train.no, '1201');
});

test('a trip from the train: stay on to the station nearest the place, then walk', () => {
  const t0 = T(9);
  const now = t0 + 6 * 60_000 + 15_000;
  const m = A.motion(fixes(off(P, 5500, 0), 5, 17, now - 40_000), now);
  const r = A.trainAboard([trip('1201', t0)], st, m, new Map(), now);
  const dest = { name: 'Home', ...off(st[4], 300, 200) };
  const offs = A.getOffAt(r.stops, r.at + 1, dest, m);
  assert.equal(offs[0], 4);
  const leg = A.trainLegTo(r, 4, now);
  assert.equal(leg.from.name, '站1');
  assert.equal(leg.to.name, '站4');
  assert.equal(leg.stops, 3);
  assert.ok(leg.aboard);
  const p = A.rideThenWalk(leg, dest, now);
  assert.equal(p.legs.length, 2);
  assert.equal(p.legs[1].mode, 'walk');
  assert.ok(p.legs[1].dep >= leg.arr);
  assert.ok(p.aboard);
});

test('joinRide: a plan from the stop that boards the same train again is that ride carried on', () => {
  const now = T(9, 10);
  const ride = { mode: 'tra', short: '區間 1201', train: { no: '1201' }, from: { name: '站1' }, to: { name: '站3' }, dep: T(9, 4), arr: T(9, 12), stops: 2, dist: 8000, aboard: { at: now } };
  const q = { legs: [{ mode: 'walk', dist: 10, dep: T(9, 13), arr: T(9, 13), dur: 0 }, { mode: 'tra', short: '區間 1201', train: { no: '1201' }, from: { name: '站3' }, to: { name: '站5' }, dep: T(9, 13), arr: T(9, 20), stops: 2, dist: 8000 }, { mode: 'walk', dist: 300, dep: T(9, 20), arr: T(9, 24), dur: 240 }] };
  const p = A.joinRide(ride, q, now);
  assert.deepEqual(p.legs.map(l => l.mode), ['tra', 'walk']);
  assert.equal(p.legs[0].to.name, '站5');
  assert.equal(p.legs[0].stops, 4);
  assert.equal(p.arr, T(9, 24));
  // Another train there: a change.
  const q2 = { legs: [{ ...q.legs[1], short: '自強 111', train: { no: '111' } }] };
  assert.equal(A.joinRide(ride, q2, now).transfers, 1);
});

// A bus route east along a straight road, stops every 400 m.
const way = { dir: 0, headsign: '站9', stops: Array.from({ length: 10 }, (_, k) => ({ uid: `s${k}`, name: `站${k}`, ...off(P, 0, k * 400) })) };
test('a bus: on its way only with its bus due just ahead, at a bus’s pace', async () => {
  const now = T(17);
  // 50 s east at 9 m/s from 站2 + 100 m: the next stop (站4) 350 m ahead... about 40 s.
  const f = fixes(off(P, 0, 900), 6, 9, now - 50_000, { east: true });
  const m = A.motion(f, now);
  assert.ok(A.busPace(m));
  const at = A.onWay(way, m);
  assert.equal(at?.j, 4);
  const rows = [{ StopUID: 's4', Direction: 0, StopStatus: 0, EstimateTime: 50, PlateNumb: 'KKA-1' }];
  assert.deepEqual(A.busDue(rows, way, at.j, at.d, m), { plate: 'KKA-1', eta: 50 });
  // The bus due there in 9 minutes is not the one you're on (a car beside the route).
  assert.equal(A.busDue([{ ...rows[0], EstimateTime: 540 }], way, at.j, at.d, m), null);
  // The other way round, or off the road by a block: not on it.
  assert.equal(A.onWay({ ...way, stops: [...way.stops].reverse() }, m), null);
  assert.equal(A.onWay(way, A.motion(f.map(x => ({ ...x, ...off(x, 300, 0) })), now)), null);
  // busesAboard puts it together, one per route.
  const station = { lat: way.stops[4].lat, lon: way.stops[4].lon, stops: [{ routeUID: 'HSZ5608', route: '5608' }, { routeUID: 'HSZ5608A', route: '5608' }] };
  const got = await A.busesAboard(m, { stationsAround: async () => [station], routeStops: async () => [way], busEta: async () => ({ rows }), routeCity: () => 'Hsinchu' });
  assert.equal(got.length, 1);
  assert.equal(got[0].route.name, '5608');
  const leg = A.busLegTo(got[0], 7, (j, k) => (k - j) * 60, now);
  assert.equal(leg.from.name, '站3');
  assert.equal(leg.to.name, '站7');
  assert.equal(leg.arr, now + 50_000 + 3 * 60_000);
  assert.ok(leg.dep <= now && leg.aboard);
});

test('navigation of a trip planned on board starts on the ride, not walking to it', () => {
  const { plan, st: stops } = busTrip({ on: 1, offAt: 5, depMin: 0 });
  clock.set(plan.legs[1].dep + 3 * 60_000);
  const legs = plan.legs.slice(1).map((l, k) => (k === 0 ? { ...l, aboard: { at: clock.get() } } : l));
  const p = { ...plan, legs, dep: clock.get() };
  const { st } = start(p, { here: { ...off(stops[2], 0, 100), at: clock.get() } });
  assert.deepEqual(show(st), { i: 0, phase: 'on', reached: 0 });
});
