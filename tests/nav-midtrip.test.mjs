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

// The owner's own case (2026-10-22, 17:18): a trip planned for 16:00
// (walk, YouBike to 竹東, 區間 1825 16:12 to 竹中, 區間 1754 16:43 on to
// 新竹, walk, YouBike, walk), timed for tomorrow, started on board a later
// train between 榮華 and 上員.
test('started on a moving train (內灣線 near 榮華 at 17:18, the plan timed for tomorrow): on today’s 1831 it’s on, the change at 竹中 moved to the next train, there today', async () => {
  const { useRail } = await import('../public/lib/nav.mjs');
  const A = { lat: 24.7382, lon: 121.0947 };
  const sts = ['竹東', '榮華', '上員', '竹中', '新竹'].map((name, n) => ({ key: `tra:${n}`, sys: 'tra', name, ...off(A, n * 1400, -n * 1400) }));
  const S = n => ({ name: sts[n].name, lat: sts[n].lat, lon: sts[n].lon });
  // A train calling at stations a..b, 4 minutes apart, leaving the first at t0.
  const run = (no, a, b, t0) => ({ sys: 'tra', no, type: '區間', stops: sts.slice(a, b + 1).map((s, n) => ({ st: s.key, arr: t0 + n * 4 * 60e3 - 30e3, dep: t0 + n * 4 * 60e3 })) });
  const at = (h, m) => T(h, m) + 3 * DAY;
  const trips = [run('1825', 0, 3, at(16, 12)), run('1831', 0, 3, at(17, 12)), run('1754', 3, 4, at(16, 43)), run('1760', 3, 4, at(17, 43))];
  useRail({ dayTrips: async () => trips, railStations: async () => sts, traLive: async () => new Map([['1831', { delay: 1, st: 'tra:1', status: 2 }]]) });
  const home = { name: 'Home', ...off(A, -800, 300) };
  const bk = { name: 'YouBike 竹東高中', ...off(A, -700, 250) };
  const dest = { name: '巨城', ...off(sts[4], 900, 600) };
  const bk2 = { name: 'YouBike 新竹站', ...off(sts[4], 50, 30) };
  const bk3 = { name: 'YouBike 巨城', ...off(dest, -150, 0) };
  const t = (h, m) => at(h, m) + DAY; // tomorrow
  const path = (a, b) => sts.slice(a, b + 1).map(s => [s.lat, s.lon]);
  const legs = [
    { mode: 'walk', from: home, to: bk, dep: t(15, 57), arr: t(15, 58), dur: 60 },
    { mode: 'bike', from: bk, to: { name: 'YouBike 竹東站', ...off(A, -40, 0) }, dep: t(15, 58), arr: t(16, 4), dur: 360 },
    { mode: 'walk', from: { name: 'YouBike 竹東站', ...off(A, -40, 0) }, to: S(0), dep: t(16, 4), arr: t(16, 5), dur: 60 },
    { mode: 'tra', name: '區間', short: '區間 1825', train: { no: '1825', type: '區間' }, from: S(0), to: S(3), dep: t(16, 12), arr: t(16, 24) - 30e3, dur: 690, path: path(0, 3) },
    { mode: 'tra', name: '區間', short: '區間 1754', train: { no: '1754', type: '區間' }, from: S(3), to: S(4), dep: t(16, 43), arr: t(16, 47) - 30e3, dur: 210, path: path(3, 4) },
    { mode: 'walk', from: S(4), to: bk2, dep: t(16, 47), arr: t(16, 48), dur: 60 },
    { mode: 'bike', from: bk2, to: bk3, dep: t(16, 48), arr: t(17, 3), dur: 900 },
    { mode: 'walk', from: bk3, to: dest, dep: t(17, 3), arr: t(17, 7), dur: 240 }
  ];
  const plan = { legs, dep: legs[0].dep, arr: legs.at(-1).arr, tags: [], dest };
  // 17:18: 1831 (a minute late) left 榮華 at 17:17, a third of the way on to 上員.
  const now = at(17, 18);
  clock.set(now);
  const here = { lat: sts[1].lat + (sts[2].lat - sts[1].lat) / 3, lon: sts[1].lon + (sts[2].lon - sts[1].lon) / 3, at: now };
  const { st: s } = start(plan, { here });
  await settle();
  assert.deepEqual(show(s), { i: 3, phase: 'on', reached: 3 }, 'on the train, the walk and the bike to it done');
  const p = s.plan;
  assert.equal(String(p.legs[3].train.no), '1831', 'the train you’re really on');
  assert.equal(p.legs[3].dep, at(17, 12));
  assert.equal(String(p.legs[4].train.no), '1760', 'the change at 竹中: the next train you can catch');
  assert.ok(p.legs.at(-1).arr > now && p.legs.at(-1).arr - now < 60 * 60_000, 'there within the hour, today, not 23 hours on');
  assert.equal(p.legs[0].dep < now, true, 'the steps behind you are today’s too');
  useRail({});
});

test('a block past the stop on a bus that has come (快捷8號 at 竹中, 2026-10-22): on board, not still 進站了・招手上車', () => {
  const { plan, st } = busTrip();
  clock.set(plan.legs[1].dep - 30e3);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'before', reached: 1 } });
  for (const x of [0, 10, 40, 75, 110]) {
    clock.add(8e3);
    pos(off(st[1], 0, x));
  }
  assert.deepEqual(show(s), { i: 1, phase: 'on', reached: 1 });
});

test('waiting at the stop, the bus not due for 10 minutes: pacing 60 m up its road is still waiting', () => {
  const { plan, st } = busTrip();
  clock.set(plan.legs[1].dep - 10 * 60e3);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'before', reached: 1 } });
  for (const x of [0, 30, 70, 100]) {
    clock.add(8e3);
    pos(off(st[1], 0, x));
  }
  assert.equal(s.phase, 'before');
});
