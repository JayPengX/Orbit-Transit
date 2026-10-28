// Navigation followed fix by fix, as on a phone (navsim.mjs stands in for the
// clock, the position watch and the page): the step machine's own rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, tick, off, T, rental, tripAt, start, busTrip, show, log, box } from './navsim.mjs';

test('navigation ends 90 minutes past the planned arrival with the app kept open (the screen kept on)', () => {
  const { plan, O } = busTrip();
  clock.set(plan.dep);
  const { ends } = start(plan);
  pos(off(O, 500, 0));
  tick(60 * 60_000 + (plan.arr - plan.dep) + 31 * 60_000);
  assert.equal(ends.length, 1);
});

test("walking to the stop along the bus's own road isn't being on the bus: one fix on its way is no ride, two going its way are", () => {
  const S1 = { name: '站1', lat: 24.8, lon: 120.97 };
  const st = Array.from({ length: 7 }, (_, k) => ({ name: '站' + k, ...off(S1, 0, (k - 1) * 400) }));
  const home = { name: '', ...off(S1, 0, 700) };
  const t0 = T(8);
  const legs = [
    { mode: 'walk', from: home, to: S1, dep: t0, arr: t0 + 9 * 60e3, dur: 540 },
    { mode: 'bus', short: '5608', name: '5608', from: S1, to: st[6], dep: t0 + 10 * 60e3, arr: t0 + 18 * 60e3, dur: 480, path: st.slice(1).map(s => [s.lat, s.lon]) },
    { mode: 'walk', from: st[6], to: { name: 'Dest', ...off(st[6], 200, 0) }, dep: t0 + 18 * 60e3, arr: t0 + 21 * 60e3, dur: 180 }
  ];
  const plan = { legs, dep: t0, arr: legs[2].arr, dest: legs[2].to };
  clock.set(t0 + 5 * 60e3);
  const { st: s } = start(plan);
  for (let x = 700; x >= 0; x -= 40) {
    clock.add(30e3);
    pos(off(S1, 0, x));
    assert.notEqual(s.phase, 'on', `walking west on its road, ${x} m from the stop`);
  }
  // On it: going its way.
  for (let x = 60; x <= 600; x += 60) {
    clock.add(8e3);
    pos(off(S1, 0, x));
  }
  assert.deepEqual(show(s), { i: 1, phase: 'on', reached: 1 });
});

test('off the bus only at your stop along its way: never where the place is passed first (the walk back along its road), nor where a loop passes near the stop', () => {
  const { plan, st, rs } = busTrip({ walk2E: -150, walk2N: 20 });
  clock.set(plan.legs[1].dep);
  const { st: s, ends } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  // (Off within 120 m of it, along its way: 1480 m on.)
  for (let x = 0; x < 1480; x += 40) {
    clock.add(10e3);
    pos(off(st[1], 0, x));
    assert.equal(s.i, 1, `${x} m along, 站5 at 1600`);
  }
  for (let x = 1480; x <= 1600; x += 40) {
    clock.add(10e3);
    pos(off(st[1], 0, x));
  }
  assert.equal(s.i, 2);
  assert.equal(ends.length, 0);

  // Out on one street, back on its pair 100 m north: the stop is on the way back.
  const A = { lat: 24.8, lon: 120.97 };
  const road = [A, off(A, 0, 1000), off(A, 100, 1000), off(A, 100, 400)];
  const stops = [A, off(A, 0, 500), off(A, 0, 1000), off(A, 100, 900), off(A, 100, 400)].map((p, k) => ({ name: 'Q' + k, ...p }));
  const t0 = T(8);
  const D = { name: 'D', ...off(stops[4], 150, 0) };
  const loop = { legs: [{ mode: 'bus', short: '20', name: '20', from: stops[0], to: stops[4], dep: t0, arr: t0 + 8 * 60e3, dur: 480, path: road.map(p => [p.lat, p.lon]) }, { mode: 'walk', from: stops[4], to: D, dep: t0 + 8 * 60e3, arr: t0 + 10 * 60e3, dur: 120 }], dep: t0, arr: t0 + 10 * 60e3, dest: D };
  clock.set(t0);
  const { st: s2 } = start(loop, { resume: { i: 0, phase: 'on', reached: 0 } });
  s2.ride.set(0, { stops, i: 0, j: 4 });
  for (let x = 200; x <= 500; x += 50) {
    clock.add(6e3);
    pos(off(A, 0, x));
  }
  assert.deepEqual(show(s2), { i: 0, phase: 'on', reached: 0 });
});

test('stayed on past your stop: only at a ride’s speed (walking on along its road isn’t), and asked once, never back and forth', () => {
  // Off at 站4, then walking on east at 1.4 m/s.
  const { plan, st, rs } = busTrip({ offAt: 4, walk2E: 900, walk2N: 0 });
  clock.set(plan.legs[1].dep);
  const { st: s, acts } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  for (let x = 0; x <= 1200; x += 60) {
    clock.add(8e3);
    pos(off(st[1], 0, x));
  }
  assert.equal(s.i, 2);
  for (let x = 1220; x <= 1560; x += 14) {
    clock.add(10e3);
    pos(off(st[1], 0, x));
  }
  assert.equal(acts.filter(a => a[0] === 'stayed').length, 0, 'walking');

  // Really on it: past 站4 and on, the replan not in yet.
  const S1 = { lat: 24.8, lon: 120.97 };
  const xs = [0, 400, 800, 1200, 1600, 2400, 3200];
  const stops = xs.map((x, k) => ({ name: '站' + k, ...off(S1, 0, x) }));
  const D = { name: 'Dest', ...off(stops[4], 15, 450) };
  const t0 = T(8);
  const legs = [
    { mode: 'walk', from: off(S1, 100, 0), to: stops[0], dep: t0, arr: t0 + 2 * 60e3, dur: 120 },
    { mode: 'bus', short: '5608', name: '5608', from: stops[0], to: stops[4], dep: t0 + 5 * 60e3, arr: t0 + 11 * 60e3, dur: 360, path: stops.slice(0, 5).map(p => [p.lat, p.lon]) },
    { mode: 'walk', from: stops[4], to: D, dep: t0 + 11 * 60e3, arr: t0 + 16 * 60e3, dur: 300 }
  ];
  clock.set(t0 + 5 * 60e3);
  const r = start({ legs, dep: t0, arr: legs[2].arr, dest: D }, { resume: { i: 1, phase: 'on', reached: 1 } });
  r.st.ride.set(1, { stops, i: 0, j: 4 });
  for (let x = 300; x <= 2380; x += 40) {
    clock.add(5e3);
    pos(off(S1, 0, x));
  }
  assert.equal(r.acts.filter(a => a[0] === 'stayed').length, 1);
});

test("a rough fix (a cell tower's) never moves the trip on, nor starts the YouBike timer", () => {
  const O = { name: '', lat: 24.8, lon: 120.97 };
  const dock = { name: 'Dock', ...off(O, 300, 0) };
  const way = [dock, off(dock, 0, 100), off(dock, -1000, 100)];
  const end = { name: 'End', ...way[2] };
  const D = { name: 'Dest', ...off(end, 0, 60) };
  const t0 = T(8);
  const legs = [
    { mode: 'walk', from: O, to: dock, dep: t0, arr: t0 + 4 * 60e3, dur: 240 },
    { mode: 'bike', name: 'YouBike', from: dock, to: end, dep: t0 + 4 * 60e3, arr: t0 + 10 * 60e3, dur: 360, rent: dock, ret: end, path: way.map(p => [p.lat, p.lon]) },
    { mode: 'walk', from: end, to: D, dep: t0 + 10 * 60e3, arr: t0 + 11 * 60e3, dur: 60 }
  ];
  clock.set(t0);
  const { st: s } = start({ legs, dep: t0, arr: legs[2].arr, dest: D });
  for (let y = 0; y <= 100; y += 20) {
    clock.add(15e3);
    pos(off(O, y, 0));
  }
  pos(off(O, 100, 110), 120);
  assert.deepEqual(show(s), { i: 0, phase: 'before', reached: 0 });
  assert.equal(rental.rental(), null);
});

test('the YouBike timer: ended when the step after the bike was passed with the phone locked; started on a trip that begins with the bike, at its station', () => {
  const { plan, st, O } = busTrip();
  plan.legs.unshift({ mode: 'bike', name: 'YouBike', from: { name: 'Dock', ...O }, to: plan.legs[0].from, dep: plan.dep - 6 * 60e3, arr: plan.dep, dur: 360, rent: O, ret: plan.legs[0].from });
  plan.dep -= 6 * 60e3;
  clock.set(plan.dep);
  const { st: s } = start(plan, { here: { ...O, at: clock.get() } });
  assert.ok(rental.rental(), 'started at the station');
  clock.add(14 * 60e3);
  pos(off(st[1], 0, 100));
  for (const x of [300, 500]) {
    clock.add(20e3);
    pos(off(st[1], 0, x));
  }
  assert.equal(s.i, 2);
  assert.equal(rental.rental(), null, 'the bike behind you was given back');
});

test('started a few minutes late, still at its start: on the walk, not past it', () => {
  const { plan, O } = busTrip();
  plan.legs[0].arr = plan.dep + 5 * 60e3;
  clock.set(plan.dep + 6 * 60e3 + 10e3);
  const { st: s } = start(plan, { here: { ...O, at: clock.get() } });
  assert.deepEqual(show(s), { i: 0, phase: 'before', reached: 0 });
});

test('looking ahead on the bus still follows it: your stop next, back on the ride and buzzed', () => {
  const { plan, st, rs } = busTrip();
  clock.set(plan.legs[1].dep);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  pos(off(st[1], 0, 250));
  s.look = { k: 1 };
  s.go(2);
  for (let x = 300; x <= 1600; x += 50) {
    clock.add(6e3);
    pos(off(st[1], 0, x));
  }
  assert.equal(s.reached, 2);
  // (Told once, at the stop before yours.)
  assert.equal(log.filter(x => x[0] === 'buzz').length, 1);
});

test('tripAt says how far along a ride you are', () => {
  const { plan, st } = busTrip();
  const a = tripAt(plan, off(st[1], 0, 600), 0, plan.legs[1].dep);
  assert.equal(a.phase, 'on');
  assert.ok(Math.abs(a.d - 600) < 20);
});

test('the YouBike step looked at while walking to its station: only shown (its ride not redrawn from you, not begun); at the station, on to it', () => {
  const O = { name: '', lat: 24.8, lon: 120.97 };
  const dock = { name: '綠41公園', ...off(O, -150, 150) };
  const end = { name: 'End', ...off(dock, -1500, 1500) };
  const D = { name: 'Dest', ...off(end, 0, 60) };
  const t0 = T(8);
  const legs = [
    { mode: 'walk', from: O, to: dock, dep: t0, arr: t0 + 3 * 60e3, dur: 180, path: [[O.lat, O.lon], [dock.lat, dock.lon]] },
    { mode: 'bike', name: 'YouBike', from: dock, to: end, dep: t0 + 3 * 60e3, arr: t0 + 18 * 60e3, dur: 900, rent: dock, ret: end, path: [[dock.lat, dock.lon], [end.lat, end.lon]] },
    { mode: 'walk', from: end, to: D, dep: t0 + 18 * 60e3, arr: t0 + 19 * 60e3, dur: 60 }
  ];
  clock.set(t0);
  const { st: s } = start({ legs, dep: t0, arr: legs[2].arr, dest: D });
  pos(off(O, -20, 20));
  box.onclick({ target: { closest: q => (q === '[data-nav-go]' ? { dataset: { navGo: '1' } } : null) } });
  assert.equal(s.i, 1);
  for (const k of [40, 60, 80]) {
    clock.add(10e3);
    pos(off(O, -k, k));
  }
  assert.equal(s.reached, 0, 'still walking to it');
  assert.ok(!s.offWay, 'its ride not taken as yours, nor redrawn from you');
  assert.equal(s.plan.legs[1].from.name, '綠41公園');
  assert.equal(rental.rental(), null, 'no timer before the bike');
  pos(off(dock, 10, 0));
  assert.equal(s.reached, 1, 'at the station: on the bike step');
});
