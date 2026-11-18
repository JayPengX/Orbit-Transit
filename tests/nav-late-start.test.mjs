// Jay 2026-11-18, 16:4x at 竹中 on 區間 1792 to 六家: it left a minute or
// two late, 台鐵's live board said nothing of it yet, and the trip took him,
// still sitting on it at the platform, for having missed it: 已開走, moved to
// 1794 at 16:59. Then on the way to 六家, rough fixes from inside the train,
// it never saw him on 1792. Replayed here (stations near enough, the times
// that afternoon's).
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, tick, start, show } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(r => setImmediate(r));
};
const D = s => Date.parse(`2026-11-18T${s}:00+08:00`);
const ST = { 1194: ['竹中', 24.7813, 121.0322], 1203: ['六家', 24.8076, 121.0405] };
const sts = Object.entries(ST).map(([id, [name, lat, lon]]) => ({ key: `tra:${id}`, sys: 'tra', name, lat, lon }));
const S = id => ({ name: ST[id][0], lat: ST[id][1], lon: ST[id][2] });
const run = (no, a, b) => ({ sys: 'tra', no, type: '區間', stops: [{ st: 'tra:1194', arr: D(a), dep: D(a) }, { st: 'tra:1203', arr: D(b), dep: D(b) }] });
const trips = [run('1792', '16:40', '16:45'), run('1794', '16:59', '17:04')];
const line = [1194, 1203].map(id => [ST[id][1], ST[id][2]]);
const dest = { name: 'Dest', lat: 24.809, lon: 121.043 };
function trip(live) {
  nav.useRail({ dayTrips: async () => trips, railStations: async () => sts, traLive: async () => live });
  const legs = [
    { mode: 'walk', from: { name: 'Home', lat: 24.779, lon: 121.03 }, to: S(1194), dep: D('16:30'), arr: D('16:35'), dur: 300 },
    { mode: 'tra', name: '區間', short: '區間 1792', train: { no: '1792', type: '區間' }, from: S(1194), to: S(1203), dep: D('16:40'), arr: D('16:45'), dur: 300, path: line },
    { mode: 'walk', from: S(1203), to: dest, dep: D('16:45'), arr: D('16:49'), dur: 240 }
  ];
  return { legs, dep: legs[0].dep, arr: legs.at(-1).arr, tags: [], dest };
}
const along = f => ({ lat: ST[1194][1] + (ST[1203][1] - ST[1194][1]) * f, lon: ST[1194][2] + (ST[1203][2] - ST[1194][2]) * f });

// On board at 竹中 from 16:38; it leaves late (16:42 by default, 2 late), followed till 16:46, short of 六家 (16:47).
async function ride({ live = new Map(), every = 20_000, acc = 30, leaves = '16:42' } = {}) {
  clock.set(D('16:38'));
  const r = start(trip(live), { resume: { i: 1, phase: 'before', reached: 1 } });
  const nos = new Set();
  for (let t = D('16:38'); t <= D('16:46'); t += every) {
    clock.set(t);
    const f = Math.max(0, Math.min(1, (t - D(leaves)) / (D('16:47') - D(leaves))));
    pos(along(f), f > 0 ? acc : 15);
    tick(1000);
    await settle();
    nos.add(nav.savedNav?.()?.plan?.legs?.[1]?.train?.no);
  }
  return { r, nos: [...nos] };
}

test('a train leaving 2 to 4 minutes late, its delay not on the board yet: you on it at the platform are not taken as having missed it', async () => {
  for (const leaves of ['16:42', '16:43', '16:44']) {
    const { r, nos } = await ride({ leaves });
    assert.deepEqual(nos, ['1792'], `left ${leaves}: never moved to 1794`);
    assert.deepEqual(show(r.st), { i: 1, phase: 'on', reached: 1 });
  }
});

test('the same with rough fixes from inside the train, one every 30 s', async () => {
  const { r, nos } = await ride({ every: 30_000, acc: 250, leaves: '16:43' });
  assert.deepEqual(nos, ['1792'], 'never moved to 1794');
  assert.deepEqual(show(r.st), { i: 1, phase: 'on', reached: 1 });
});

test('really missed, still at the platform 5 minutes after: the next train', async () => {
  clock.set(D('16:38'));
  const r = start(trip(new Map()), { resume: { i: 1, phase: 'before', reached: 1 } });
  for (let t = D('16:38'); t <= D('16:48'); t += 20_000) {
    clock.set(t);
    pos(along(0), 15);
    tick(1000);
    await settle();
  }
  assert.equal(nav.savedNav?.()?.plan?.legs?.[1]?.train?.no, '1794');
  assert.equal(show(r.st).phase, 'before');
});
