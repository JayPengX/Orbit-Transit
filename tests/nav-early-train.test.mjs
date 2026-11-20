// Jay 2026-11-20, 16:14: navigating to 竹東 for 區間 1831 at 17:12 (on to
// 千甲), he took 1825 an hour sooner, which ends at 竹中. Riding it out of
// 竹東, the trip kept him on the walk to 竹東, its road redrawn from wherever
// the train had got to: 1825 doesn't reach 千甲, so it was never taken for
// the train he was on. Replayed here on that afternoon's timetable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, tick, start, show, off } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(r => setImmediate(r));
};
const D = s => Date.parse(`2026-11-20T${s}:00+08:00`);
const ST = { 1250: ['竹東', 24.7379, 121.0927], 1249: ['上員', 24.76, 121.059], 1194: ['竹中', 24.7813, 121.0322], 1193: ['新莊', 24.7883, 121.0216], 1192: ['千甲', 24.7951, 121.0061] };
const sts = Object.entries(ST).map(([id, [name, lat, lon]]) => ({ key: `tra:${id}`, sys: 'tra', name, lat, lon }));
const S = id => ({ name: ST[id][0], lat: ST[id][1], lon: ST[id][2] });
const run = (no, ids, times) => ({ sys: 'tra', no, type: '區間', stops: ids.map((id, k) => ({ st: `tra:${id}`, arr: D(times[k]), dep: D(times[k]) })) });
const trips = [
  run('1825', [1250, 1249, 1194], ['16:12', '16:22', '16:28']),
  run('1831', [1250, 1249, 1194, 1193, 1192], ['17:12', '17:22', '17:27', '17:30', '17:34']),
  run('1756', [1194, 1193, 1192], ['16:43', '16:46', '16:50'])
];
const line = [1250, 1249, 1194, 1193, 1192].map(id => [ST[id][1], ST[id][2]]);
const home = { name: 'Home', ...off(S(1250), -300, 300) };
const dest = { name: 'Dest', ...off(S(1192), 300, 0) };
function trip() {
  nav.useRail({ dayTrips: async () => trips, railStations: async () => sts, traLive: async () => new Map() });
  const legs = [
    { mode: 'walk', from: home, to: S(1250), dep: D('17:02'), arr: D('17:08'), dur: 360 },
    { mode: 'tra', name: '區間', short: '區間 1831', train: { no: '1831', type: '區間' }, from: S(1250), to: S(1192), dep: D('17:12'), arr: D('17:34'), dur: 1320, path: line },
    { mode: 'walk', from: S(1192), to: dest, dep: D('17:34'), arr: D('17:38'), dur: 240 }
  ];
  return { legs, dep: legs[0].dep, arr: legs.at(-1).arr, tags: [], dest };
}
// Where 1825 is, by its clock.
const onTrain = t => {
  const seg = t < D('16:22') ? [1250, 1249, D('16:12'), D('16:22')] : [1249, 1194, D('16:22'), D('16:28')];
  const f = Math.max(0, Math.min(1, (t - seg[2]) / (seg[3] - seg[2])));
  const [a, b] = [ST[seg[0]], ST[seg[1]]];
  return { lat: a[1] + (b[1] - a[1]) * f, lon: a[2] + (b[2] - a[2]) * f };
};

async function ride({ every = 10_000, acc = 20, walked = true } = {}) {
  clock.set(D('16:00'));
  pos(home, 10);
  const r = start(trip(), { resume: { i: 0, phase: 'before', reached: 0 } });
  await settle();
  for (let t = D('16:00'); t <= D('16:20'); t += every) {
    clock.set(t);
    const w = Math.min(1, (t - D('16:00')) / 600_000);
    const p = t < D('16:10') ? { lat: home.lat + (ST[1250][1] - home.lat) * w, lon: home.lon + (ST[1250][2] - home.lon) * w } : t < D('16:12') ? S(1250) : onTrain(t);
    if (walked || t >= D('16:12')) pos(p, t >= D('16:12') ? acc : 10);
    tick(1000);
    await settle();
  }
  return r;
}
const check = r => {
  assert.deepEqual(show(r.st), { i: 1, phase: 'on', reached: 1 }, 'on the train, not the walk');
  const legs = nav.savedNav()?.plan?.legs;
  assert.equal(String(legs[1].train.no), '1825', 'the train you are on');
  assert.equal(legs[1].to.name, '竹中', 'to where it ends');
  assert.equal(String(legs[2].train.no), '1756', 'then the sooner train on from 竹中, not 1831 at 17:27');
  assert.equal(legs[2].to.name, '千甲');
  assert.equal(legs.at(-1).arr, D('16:54'), 'there at 16:54, not 17:38');
};

test('on a train an hour sooner that ends short of your stop (1825 to 竹中 for 1831 to 千甲): on it, a change at 竹中, never the walk redrawn after you', async () => {
  check(await ride());
});
test('the same with rough fixes from inside the train', async () => {
  check(await ride({ every: 20_000, acc: 200 }));
});
test('the same with no fixes on the walk (the phone asleep till on the train)', async () => {
  check(await ride({ walked: false }));
});
test('trainNow: a train that ends short of your stop on the planned train’s way is the one, cut where it ends; one off the way is not', () => {
  const leg = { mode: 'tra', from: S(1250), to: S(1192), dep: D('17:12'), train: { no: '1831' } };
  const t = nav.trainNow(trips, sts, leg, onTrain(D('16:15')), new Map(), D('16:15'), 2500, { cut: true });
  // (Not asked for one: none.)
  assert.equal(nav.trainNow(trips, sts, leg, onTrain(D('16:15')), new Map(), D('16:15')), null);
  assert.equal(t?.train.no, '1825');
  assert.equal(t.end.name, '竹中');
  assert.deepEqual([t.rest.dep, t.rest.arr, t.rest.train.no], [D('17:27'), D('17:34'), '1831']);
  // (No train planned to meet it again: none.)
  assert.equal(nav.trainNow(trips, sts, { ...leg, train: { no: '9999' } }, onTrain(D('16:15')), new Map(), D('16:15'), 2500, { cut: true }), null);
});

test('on board, the dot on the ride’s line where weak GPS puts you beside it; off it far, or not on board, where the fix says', () => {
  const plan = trip();
  const ride = plan.legs[1];
  // 400 m north-east of the track between 竹東 and 上員 (Jay 2026-11-20, 1825 across the fields).
  const mid = { lat: (ST[1250][1] + ST[1249][1]) / 2, lon: (ST[1250][2] + ST[1249][2]) / 2 };
  const fix = { ...off(mid, 280, 280), acc: 300 };
  const s = nav.onRideLine(plan, 1, 'on', fix);
  assert.ok(s.snapped);
  const k = ride.path.map(([lat, lon]) => ({ lat, lon }));
  // (On the straight between the two stations: its cross product with them ~0.)
  const cross = (k[1].lat - k[0].lat) * (s.lon - k[0].lon) - (k[1].lon - k[0].lon) * (s.lat - k[0].lat);
  assert.ok(Math.abs(cross) < 1e-9, 'on the line');
  assert.equal(nav.onRideLine(plan, 1, 'before', fix), fix, 'not on board yet: where it says');
  assert.equal(nav.onRideLine(plan, 0, 'before', fix), fix, 'walking: where it says');
  const far = { ...off(mid, 3000, 3000), acc: 30 };
  assert.equal(nav.onRideLine(plan, 1, 'on', far), far, '4 km off: where it says');
});
