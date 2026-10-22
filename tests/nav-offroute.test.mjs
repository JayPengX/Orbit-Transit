// Off the plan on the way (the owner, 2026-10-22: "I rarely encounter
// that, make sure it works"): a stop missed, off too early, off too late,
// the bus or train missed at the stop, a YouBike ride off its road. Each
// noticed from the fixes alone, and what the trip does then.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, tick, off, T, start, busTrip, show, box } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(r => setImmediate(r));
};
const topHtml = () => box.querySelector('.ot-nav-topw').innerHTML;

test('off the bus too early (walking away from its road): asked (and buzzed) about two minutes on at a walk, with 從這裡重新規劃 one tap away', async () => {
  const { plan, st, rs } = busTrip();
  clock.set(plan.legs[1].dep + 3 * 60e3);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  for (const x of [300, 500, 700]) {
    clock.add(20e3);
    pos(off(st[1], 0, x));
  }
  assert.equal(s.phase, 'on');
  // Off at 站3 (two stops early), walking north away from the road.
  // (At a walk, 1.4 m/s: 150 m off the road is under two minutes, then 30 s.)
  let n = 0;
  for (; n < 30 && !/好像已經下車了/.test((s.render(), topHtml())); n++) {
    clock.add(10e3);
    pos(off(st[3], 20 + n * 14, 0));
  }
  assert.ok(n * 10 <= 150, `asked after ${n * 10} s`);
  assert.match(topHtml(), /好像已經下車了/);
  assert.match(topHtml(), /data-nav="replan"/);
});

test('off at your stop as planned: on to the walk by itself, said 已在…下車', async () => {
  const { plan, st, rs } = busTrip();
  clock.set(plan.legs[1].dep + 3 * 60e3);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  for (let x = 300; x <= 1600; x += 100) {
    clock.add(15e3);
    pos(off(st[1], 0, x));
  }
  assert.deepEqual(show(s), { i: 2, phase: 'before', reached: 2 });
  assert.match(topHtml(), /已在 站5 下車/);
});

test('stayed on past your stop (off too late): back on the ride, off at the next stop, the rest planned again from there', async () => {
  const { plan, st, rs } = busTrip();
  clock.set(plan.legs[1].dep + 3 * 60e3);
  const { st: s, acts } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  for (let x = 300; x <= 2100; x += 100) {
    clock.add(12e3);
    pos(off(st[1], 0, x));
  }
  const stayed = acts.find(a => a[0] === 'stayed');
  assert.ok(stayed, JSON.stringify(acts.map(a => a[0])));
  assert.ok(stayed[1].k > 5, 'off at the next stop ahead');
  assert.equal(s.i, 1);
  assert.equal(s.phase, 'on');
});

// A line east: 竹東 (0) … 新竹 (4), a train every 30 minutes.
const sts = ['竹東', '榮華', '上員', '竹中', '新竹'].map((name, n) => ({ key: `tra:${n}`, sys: 'tra', name, lat: 24.74, lon: 121.09 - n * 0.02 }));
const S = n => ({ name: sts[n].name, lat: sts[n].lat, lon: sts[n].lon });
const run = (no, t0) => ({ sys: 'tra', no, type: '區間', stops: sts.map((s, n) => ({ st: s.key, arr: t0 + n * 4 * 60e3 - 30e3, dep: t0 + n * 4 * 60e3 })) });
const trips = [run('101', T(8, 0)), run('103', T(8, 30)), run('105', T(9, 0))];
nav.useRail({ dayTrips: async () => trips, railStations: async () => sts, traLive: async () => new Map() });
const trainTrip = () => {
  const O = { name: 'Home', lat: 24.742, lon: 121.0905 };
  const legs = [
    { mode: 'walk', from: O, to: S(0), dep: T(7, 52), arr: T(7, 56), dur: 240 },
    { mode: 'tra', name: '區間', short: '區間 101', train: { no: '101', type: '區間' }, from: S(0), to: S(3), dep: T(8, 0), arr: T(8, 12) - 30e3, dur: 690, path: sts.slice(0, 4).map(s => [s.lat, s.lon]) },
    { mode: 'walk', from: S(3), to: { name: 'Dest', lat: 24.742, lon: sts[3].lon }, dep: T(8, 12), arr: T(8, 16), dur: 240 }
  ];
  return { legs, dep: legs[0].dep, arr: legs[2].arr, tags: [] };
};

test('the train missed, still at the station: the next one taken by itself, said and buzzed (never tomorrow’s)', async () => {
  const plan = trainTrip();
  clock.set(T(8, 3));
  const { st: s } = start(plan, { resume: { i: 1, phase: 'before', reached: 1 } });
  pos(off(S(0), 20, 0));
  await settle();
  tick(25e3);
  await settle();
  assert.equal(String(s.plan.legs[1].train.no), '103');
  assert.equal(s.plan.legs[1].dep, T(8, 30));
  assert.match(topHtml(), /沒趕上/);
});

test('on the train past your station (off too late): back on it, off at the next station, the rest planned again from there', async () => {
  const plan = trainTrip();
  plan.legs[1].to = S(2);
  plan.legs[1].path = sts.slice(0, 3).map(s => [s.lat, s.lon]);
  plan.legs[2].from = S(2);
  clock.set(T(8, 1));
  const { st: s, acts } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  await settle();
  // Along the line at a train's pace, through 上員 (2) and on toward 竹中 (3).
  for (let f = 0.1; f <= 2.75; f += 0.08) {
    clock.add(15e3);
    pos({ lat: 24.74, lon: 121.09 - f * 0.02 });
    await settle();
  }
  const stayed = acts.find(a => a[0] === 'stayed');
  assert.ok(stayed, JSON.stringify(acts.map(a => a[0])));
  assert.equal(stayed[1].stop.name, '竹中');
});

test('off a YouBike ride’s road (a wrong turn): its way found again from where you are (asked of the router), never stuck on the old one', async () => {
  const O = { name: 'A', lat: 24.8, lon: 120.97 };
  const B = { name: 'B', ...off(O, 0, 2000) };
  const legs = [
    { mode: 'bike', from: O, to: B, dep: T(8), arr: T(8, 8), dur: 480, poly: undefined, path: [[O.lat, O.lon], [B.lat, B.lon]] },
    { mode: 'walk', from: B, to: { name: 'C', ...off(B, 100, 0) }, dep: T(8, 8), arr: T(8, 10), dur: 120 }
  ];
  clock.set(T(8, 2));
  const { st: s } = start({ legs, dep: T(8), arr: T(8, 10), tags: [] }, { resume: { i: 0, phase: 'before', reached: 0 } });
  for (let n = 1; n <= 6; n++) {
    clock.add(10e3);
    pos(off(O, n * 60, 300));
  }
  // Still on the ride (a wrong turn isn't the next step), what's left counted from where you are.
  assert.equal(s.i, 0);
  assert.ok(s.pos && Math.abs(s.pos.lat - off(O, 360, 300).lat) < 1e-6);
});

test('told to get off by stops: passing the last stop about 4 minutes before yours (an express: the one before; a city route: a few before), never over 6 minutes early', () => {
  const { offAlertStop } = nav;
  const t0 = T(17, 30);
  // 快捷8號: stops 4 minutes apart: the stop before yours.
  const express = { i: 0, j: 8 };
  assert.equal(offAlertStop(express, k => t0 + k * 4 * 60e3), 7);
  // A city route, a stop a minute: four stops before.
  assert.equal(offAlertStop({ i: 0, j: 12 }, k => t0 + k * 60e3), 8);
  // A long gap (9 minutes) before the stop before yours: that one, not 10+ minutes early.
  assert.equal(offAlertStop({ i: 0, j: 5 }, k => t0 + (k <= 3 ? k : 3 + 9 + (k - 4) * 1) * 60e3 ), 4);
  // No times: the stop before yours.
  assert.equal(offAlertStop({ i: 0, j: 5 }, () => null), 4);
});
