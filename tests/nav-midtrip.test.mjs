// Navigation started half way through a trip (the owner, 2026-10-22: on the
// train at 17:18, a plan timed for tomorrow said "16:12 開・1374 分後"): it
// finds where you are, puts the plan on today's clock, and goes on as a trip
// started at its start would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, tick, off, T, rental, start, busTrip, show } from './navsim.mjs';
const { shiftDays, trainNow } = await import('../public/lib/nav.mjs');

const DAY = 86_400_000;
const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(r => setImmediate(r));
};
// The same trip timed a day later (a time picked already past, a pinned trip's next run).
const tomorrow = plan => {
  for (const l of plan.legs) (l.dep += DAY), (l.arr += DAY);
  plan.dep += DAY;
  plan.arr += DAY;
  return plan;
};

test('shiftDays moves a plan by whole days onto the day you are on it', () => {
  const { plan } = busTrip();
  const dep = plan.legs[1].dep;
  tomorrow(plan);
  assert.equal(shiftDays(plan, 1, dep + 20 * 60_000), -1);
  assert.equal(plan.legs[1].dep, dep);
  assert.equal(shiftDays(plan, 1, dep + 20 * 60_000), 0, 'already today: left');
});

test('started on the bus, the plan timed for tomorrow: on board now, today, never a countdown to tomorrow', async () => {
  const { plan, st } = busTrip();
  const now = plan.legs[1].dep + 25 * 60_000; // a later bus than planned
  tomorrow(plan);
  clock.set(now);
  const { st: s } = start(plan, { here: { ...off(st[1], 0, 700), at: now } });
  await settle();
  assert.deepEqual(show(s), { i: 1, phase: 'on', reached: 1 });
  const l = s.plan.legs[1];
  assert.ok(l.dep <= now && l.arr > now, 'the ride timed around now');
  assert.ok(s.plan.arr - now < 30 * 60_000, 'there within the ride, not a day on');
});

test('at the stop after the bus has gone: on that step today (the next one taken), not the walk, not tomorrow', async () => {
  const { plan, st } = busTrip();
  const now = plan.legs[1].dep + 15 * 60_000;
  tomorrow(plan);
  clock.set(now);
  const { st: s } = start(plan, { here: { ...off(st[1], 20, 0), at: now } });
  await settle();
  assert.equal(s.i, 1);
  assert.equal(s.reached, 1);
  assert.ok(Math.abs(s.plan.legs[1].dep - now) < 3 * 3_600_000, 'today’s departure, not tomorrow’s');
});

// A walk to a YouBike, a ride east, a walk to the bus, the bus.
function bikeTrip() {
  const O = { name: 'Home', lat: 24.8, lon: 120.97 };
  const B1 = { name: 'YouBike A', ...off(O, 0, 100) };
  const B2 = { name: 'YouBike B', ...off(B1, 0, 2000) };
  const S1 = { name: '站1', ...off(B2, 0, 100) };
  const S2 = { name: '站2', ...off(S1, 0, 3000) };
  const t0 = T(8);
  const legs = [
    { mode: 'walk', from: O, to: B1, dep: t0, arr: t0 + 90e3, dur: 90 },
    { mode: 'bike', from: B1, to: B2, dep: t0 + 90e3, arr: t0 + 10 * 60e3, dur: 510 },
    { mode: 'walk', from: B2, to: S1, dep: t0 + 10 * 60e3, arr: t0 + 12 * 60e3, dur: 120 },
    { mode: 'bus', name: '5608', short: '5608', from: S1, to: S2, dep: t0 + 14 * 60e3, arr: t0 + 24 * 60e3, dur: 600, path: [[S1.lat, S1.lon], [S2.lat, S2.lon]] }
  ];
  return { plan: { legs, dep: t0, arr: legs[3].arr, dest: { name: '站2', lat: S2.lat, lon: S2.lon } }, B1 };
}

test('started half way along the YouBike ride, late: on the ride (its timer running), the bus it now misses planned again from its stop', async () => {
  const { plan, B1 } = bikeTrip();
  const now = plan.legs[1].dep + 20 * 60_000;
  tomorrow(plan);
  clock.set(now);
  const { st: s, acts } = start(plan, { here: { ...off(B1, 0, 1000), at: now } });
  await settle();
  assert.deepEqual(show(s), { i: 1, phase: 'before', reached: 1 });
  assert.ok(rental.rental(), 'the bike’s timer started');
  assert.ok(Math.abs(s.plan.legs[3].dep - now) < 3 * 3_600_000, 'today');
  // (No later bus known offline: the rest planned again from the bus's stop.)
  assert.ok(acts.some(([a, x]) => a === 'rest' && x.k === 2), JSON.stringify(acts.map(a => a[0])));
});

test('at the start of a trip planned for tomorrow: left as planned (waited for)', async () => {
  const { plan, O } = busTrip();
  const now = plan.dep - 3 * 3_600_000;
  tomorrow(plan);
  clock.set(now);
  const dep = plan.dep;
  const { st: s } = start(plan, { here: { ...O, at: now } });
  await settle();
  assert.equal(s.i, 0);
  assert.equal(s.plan.dep, dep);
});

test('looking at a step ahead, left alone: back on the step you are at after 20 s', async () => {
  const { plan, O } = busTrip();
  clock.set(plan.dep);
  const { st: s } = start(plan, { here: { ...O, at: plan.dep } });
  await settle();
  s.go(2);
  s.lookAt = clock.get();
  tick(21_000);
  assert.equal(s.i, 0);
});

// A branch line east: 竹東 (A), 榮華 (B), 上員 (C), 竹中 (D), 2 km apart.
const line = (() => {
  const A = { lat: 24.74, lon: 121.09 };
  return ['A', 'B', 'C', 'D'].map((k, n) => ({ key: `tra:${k}`, sys: 'tra', name: k, ...off(A, 0, -n * 2000) }));
})();
const run = (no, t0) => ({ sys: 'tra', no, type: '區間', stops: line.map((s, n) => ({ st: s.key, arr: t0 + n * 4 * 60e3, dep: t0 + n * 4 * 60e3 + 30e3 })) });

test('trainNow: the train you are on is today’s run nearest you on the line (its live delay counted), not the one planned', () => {
  const t0 = T(17, 10);
  const trips = [run('1825', T(16, 12)), run('1829', t0), run('1833', T(17, 40))];
  const leg = { mode: 'tra', from: line[0], to: line[3], dep: T(16, 12), train: { no: '1825' } };
  // 17:16, between 榮華 and 上員 by 1829's timetable.
  const here = off(line[1], 0, -900);
  const t = trainNow(trips, line, leg, here, new Map(), T(17, 16));
  assert.equal(t?.train.no, '1829');
  // 1829 running 6 minutes late: at 17:16 it's just reaching 榮華 — still the nearest.
  const late = trainNow(trips, line, leg, off(line[1], 0, -100), new Map([['1829', { delay: 6 }]]), T(17, 16));
  assert.equal(late?.train.no, '1829');
  assert.equal(late.delay, 6);
  // Nowhere near any train running: none.
  assert.equal(trainNow(trips, line, leg, off(line[1], 5000, 0), new Map(), T(17, 16)), null);
});
