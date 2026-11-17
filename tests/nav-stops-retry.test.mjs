// A ride's stops whose read failed (11-17): TDX busy or a blip as the trip
// started, and navigation kept "no stops" for the whole ride: no stop you're
// coming to, no buzz at the one before yours, the bus without live times.
// Read again a minute on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, T, start } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(r => setImmediate(r));
};
const sts = ['竹東', '榮華', '上員', '竹中', '新竹'].map((name, n) => ({ key: `tra:${n}`, sys: 'tra', name, lat: 24.74, lon: 121.09 - n * 0.02 }));
const S = n => ({ name: sts[n].name, lat: sts[n].lat, lon: sts[n].lon });
const run = (no, t0) => ({ sys: 'tra', no, type: '區間', stops: sts.map((s, n) => ({ st: s.key, arr: t0 + n * 4 * 60e3 - 30e3, dep: t0 + n * 4 * 60e3 })) });
const trips = [run('101', T(8, 0)), run('103', T(8, 30))];

test("a train's day unread as the trip starts (TDX failing, nothing kept): its stops read again a minute on, not none for the whole ride", async () => {
  let unread = true;
  nav.useRail({ dayTrips: async () => (unread ? [] : trips), railStations: async () => sts, traLive: async () => new Map() });
  try {
    const O = { name: 'Home', lat: 24.742, lon: 121.0905 };
    const legs = [
      { mode: 'walk', from: O, to: S(0), dep: T(7, 52), arr: T(7, 56), dur: 240 },
      { mode: 'tra', name: '區間', short: '區間 101', train: { no: '101', type: '區間' }, from: S(0), to: S(3), dep: T(8, 0), arr: T(8, 12) - 30e3, dur: 690, path: sts.slice(0, 4).map(s => [s.lat, s.lon]) },
      { mode: 'walk', from: S(3), to: { name: 'Dest', lat: 24.742, lon: sts[3].lon }, dep: T(8, 12), arr: T(8, 16), dur: 240 }
    ];
    clock.set(T(7, 57));
    const { st: s } = start({ legs, dep: legs[0].dep, arr: legs[2].arr, tags: [] }, { resume: { i: 1, phase: 'before', reached: 1 } });
    pos(S(0));
    await settle();
    assert.equal(nav.navRide(1), null, 'nothing yet');
    // TDX answers again; a minute on, the trip looks again (back in the app).
    unread = false;
    clock.add(70e3);
    s.onShow();
    await settle();
    assert.deepEqual(
      nav.navRide(1)?.stops.slice(nav.navRide(1).i, nav.navRide(1).j + 1).map(x => x.name),
      ['竹東', '榮華', '上員', '竹中']
    );
  } finally {
    nav.useRail({});
  }
});
