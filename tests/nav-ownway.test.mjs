// Gone off the plan your own way (the owner, 2026-10-28/29): a YouBike
// from another station, the bike given up and walked straight to the
// station, a train that left a little late with rough fixes on board, and
// the position watch gone silent. Never stuck where the trip thought you were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, tick, off, T, start, box } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(r => setImmediate(r));
};
const topText = () => box.querySelector('.ot-nav-topw').innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

// A line east: 竹東 (0) … 新竹 (4), a train every 30 minutes.
const sts = ['竹東', '榮華', '上員', '竹中', '新竹'].map((name, n) => ({ key: `tra:${n}`, sys: 'tra', name, lat: 24.74, lon: 121.09 - n * 0.02 }));
const S = n => ({ name: sts[n].name, lat: sts[n].lat, lon: sts[n].lon });
const run = (no, t0) => ({ sys: 'tra', no, type: '區間', stops: sts.map((s, n) => ({ st: s.key, arr: t0 + n * 4 * 60e3 - 30e3, dep: t0 + n * 4 * 60e3 })) });
const trips = [run('101', T(8, 0)), run('103', T(8, 30)), run('105', T(9, 0))];
nav.useRail({ dayTrips: async () => trips, railStations: async () => sts, traLive: async () => new Map() });

test('a train that left a little late, the trip sure it was missed, fixes rough on board: on it after all, by itself, no restart', async () => {
  const O = { name: 'Home', lat: 24.742, lon: 121.0905 };
  const legs = [
    { mode: 'walk', from: O, to: S(0), dep: T(7, 52), arr: T(7, 56), dur: 240 },
    { mode: 'tra', name: '區間', short: '區間 101', train: { no: '101', type: '區間' }, from: S(0), to: S(3), dep: T(8, 0), arr: T(8, 12) - 30e3, dur: 690, path: sts.slice(0, 4).map(s => [s.lat, s.lon]) },
    { mode: 'walk', from: S(3), to: { name: 'Dest', lat: 24.742, lon: sts[3].lon }, dep: T(8, 12), arr: T(8, 16), dur: 240 }
  ];
  clock.set(T(7, 58));
  const { st: s } = start({ legs, dep: legs[0].dep, arr: legs[2].arr, tags: [] }, { resume: { i: 1, phase: 'before', reached: 1 } });
  // On the platform till 08:03: the trip takes the next one (103).
  for (let n = 0; n < 30; n++) {
    clock.add(10e3);
    pos(off(S(0), 20, 0));
    await settle();
  }
  assert.equal(String(s.plan.legs[1].train.no), '103');
  // 101 pulls out three minutes late; in the train, every fix 160 m out.
  for (let f = 0.02; f <= 0.6; f += 0.04) {
    clock.add(15e3);
    pos({ lat: 24.74, lon: 121.09 - f * 0.02 }, 160);
    await settle();
  }
  assert.equal(s.phase, 'on');
  assert.equal(String(s.plan.legs[1].train.no), '101');
  assert.doesNotMatch(topText(), /沒趕上/);
});

// Home → walk to YouBike A (south-west) → ride to B (east) → walk to the station → train.
const ownTrip = () => {
  const O = { name: 'Home', lat: 24.8, lon: 120.97 };
  const A = { name: 'YouBike A', ...off(O, -300, -200) };
  const B = { name: 'YouBike B', ...off(O, -100, 1500) };
  const St = { name: '竹中車站', ...off(O, 0, 1600) };
  const Far = { name: '新竹車站', ...off(O, 0, 9000) };
  const legs = [
    { mode: 'walk', from: O, to: A, dep: T(8), arr: T(8, 5), dur: 300 },
    { mode: 'bike', from: A, to: B, dep: T(8, 5), arr: T(8, 13), dur: 480 },
    { mode: 'walk', from: B, to: St, dep: T(8, 13), arr: T(8, 15), dur: 120 },
    { mode: 'tra', name: '區間', short: '區間 999', train: { no: '999', type: '區間' }, from: St, to: Far, dep: T(8, 40), arr: T(8, 52), dur: 720, path: [[St.lat, St.lon], [Far.lat, Far.lon]] }
  ];
  return { plan: { legs, dep: T(8), arr: T(8, 52), tags: [] }, O, A, B, St };
};

test('the bike given up, walked straight to the station: on the walk to it by itself, said 改走去', async () => {
  const { plan, O } = ownTrip();
  clock.set(T(8));
  const { st: s } = start(plan, { resume: { i: 0, phase: 'before', reached: 0 } });
  for (let n = 1; n <= 12; n++) {
    clock.add(10e3);
    pos(off(O, 0, n * 14));
    await settle();
  }
  assert.equal(s.i, 2);
  assert.equal(s.reached, 2);
  assert.match(topText(), /改走去 竹中車站/);
});

test('an e-bike taken at another station, ridden another way: on the bike step by itself (its timer running)', async () => {
  const { plan, O } = ownTrip();
  clock.set(T(8));
  const { st: s } = start(plan, { resume: { i: 0, phase: 'before', reached: 0 } });
  // A station 100 m north, then off east-north-east at 18 km/h.
  for (let n = 1; n <= 8; n++) {
    clock.add(10e3);
    pos(off(O, 100 + n * 20, n * 45));
    await settle();
  }
  assert.equal(s.i, 1);
  assert.match(topText(), /已騎上 YouBike/);
});

test('walking the planned way: never taken off it (a road that turns away first stays this step)', async () => {
  const { plan, O, A } = ownTrip();
  clock.set(T(8));
  const { st: s } = start(plan, { resume: { i: 0, phase: 'before', reached: 0 } });
  for (let n = 1; n <= 12; n++) {
    clock.add(10e3);
    const f = n / 14;
    pos({ lat: O.lat + (A.lat - O.lat) * f, lon: O.lon + (A.lon - O.lon) * f });
    await settle();
  }
  assert.equal(s.i, 0);
  assert.doesNotMatch(topText(), /不照這條路走了/);
});

test('walking away from all of it: asked 不照這條路走了？ with 從這裡重新規劃', async () => {
  const { plan, O } = ownTrip();
  clock.set(T(8));
  const { st: s } = start(plan, { resume: { i: 0, phase: 'before', reached: 0 } });
  for (let n = 1; n <= 12; n++) {
    clock.add(10e3);
    pos(off(O, n * 14, -n * 4));
    await settle();
  }
  s.render();
  assert.equal(s.i, 0);
  assert.match(topText(), /不照這條路走了/);
});

test('the position watch gone silent while navigating: the device watch started over, not only listened to again', async () => {
  const geo = navigator.geolocation;
  let starts = 0;
  const was = geo.watchPosition;
  geo.watchPosition = (...a) => (starts++, was(...a));
  try {
    const { plan, O } = ownTrip();
    clock.set(T(8));
    start(plan, { resume: { i: 0, phase: 'before', reached: 0 } });
    pos(O);
    const before = starts;
    tick(45e3);
    assert.ok(starts > before, 'started over');
  } finally {
    geo.watchPosition = was;
  }
});
