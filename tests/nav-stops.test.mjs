// A trip with stops navigated as one (the owner, 2026-11-03: the first
// stretch had been a trip of its own): the whole trip's end, the YouBike
// kept or returned at a stop (asked, with how long each takes on), and the
// stations to swap bikes at after 25 minutes on one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRide, parkAsk, laterEnd } from '../public/lib/nav.mjs';

const MIN = 60_000;
const T = m => Date.parse('2026-11-03T08:00:00+08:00') + m * MIN;
const P = (lat, lon, name = '') => ({ name, lat, lon });
const A = P(24.8, 120.97, 'Home');
const S1 = P(24.8, 120.975, 'YouBike A');
const S2 = P(24.8, 121.02, 'YouBike B');
const STOP = P(24.8005, 121.021, '全家');
const NEXT = P(24.81, 121.03, '學校');

// Walk to a station, a 25-minute ride, a walk to the stop; school after it.
function trip({ later = true } = {}) {
  const legs = [
    { mode: 'walk', from: A, to: S1, dep: T(0), arr: T(3), dur: 180 },
    { mode: 'bike', name: 'YouBike', from: S1, to: S2, dep: T(3), arr: T(28), dur: 1500, rent: { uid: 'a', ...S1 }, ret: { uid: 'b', ...S2 } },
    { mode: 'walk', from: S2, to: STOP, dep: T(28), arr: T(30), dur: 120 }
  ];
  const next = { legs: [{ mode: 'walk', from: STOP, to: P(24.805, 121.025, '站'), dep: T(30), arr: T(33), dur: 180 }, { mode: 'bus', short: '5608', name: '5608', from: P(24.805, 121.025, '站'), to: NEXT, dep: T(35), arr: T(45), dur: 600 }], dep: T(30), arr: T(45) };
  return { legs, dep: T(0), arr: T(30), dest: STOP, then: [NEXT], ...(later ? { later: [next] } : {}) };
}

test('the whole trip ends when its last stretch does, later by as much as this one runs late', () => {
  const p = trip();
  assert.equal(laterEnd(p, T(30)), T(45));
  assert.equal(laterEnd(p, T(34)), T(49));
  assert.equal(laterEnd(p, T(27)), T(45), 'early here: the bus after the stop keeps its time');
  assert.equal(laterEnd(trip({ later: false }), T(30)), T(30));
});

test('on a YouBike to a stop with more after it: keep it or return it, with how long each takes on; asked once', () => {
  const p = trip();
  const a = parkAsk(p, 1);
  assert.equal(a.back, 15);
  assert.ok(a.keep > 0 && a.keep < a.back - 2);
  assert.equal(a.text, `停著騎過去快 ${a.back - a.keep} 分`);
  // The bus after it sooner than riding on: returning it said to be.
  const far = trip();
  far.then = [P(24.9, 121.2, '遠方')];
  const b = parkAsk(far, 1);
  assert.ok(b.keep > b.back + 2);
  assert.equal(b.text, `還車搭 5608 快 ${b.keep - b.back} 分`);
  // The last place: nothing after it, nothing to ask.
  assert.equal(parkAsk({ ...p, then: [] }, 1), null);
  // A walk: not asked.
  assert.equal(parkAsk(p, 0), null);
  // Answered: not again.
  p.legs[1].asked = true;
  assert.equal(parkAsk(p, 1), null);
  // Not planned on yet: the keeping alone.
  assert.equal(parkAsk(trip({ later: false }), 1).back, null);
  // 全程 YouBike: kept already, not asked.
  const k = trip();
  k.legs[1].park = true;
  assert.equal(parkAsk(k, 1), null);
  // The stretch after on this same bike: no way to return it planned, the keeping alone.
  const s = trip();
  s.later = [{ legs: [{ mode: 'bike', kept: true, from: STOP, to: NEXT, dep: T(30), arr: T(40), dur: 600 }], dep: T(30), arr: T(40) }];
  assert.equal(parkAsk(s, 1).back, null);
});

test('附近換車: the ride cut at a station on its way, the second a new rental, the rest moved with it', () => {
  const p = trip();
  const mid = { uid: 'm', name: 'YouBike M', lat: 24.8, lon: 121.0 };
  const here = P(24.8, 120.998);
  assert.equal(splitRide(p, 1, mid, here, T(25)), true);
  assert.equal(p.legs.length, 4);
  const [, a, b, w] = p.legs;
  assert.equal(a.to.name, 'YouBike M');
  assert.equal(a.park, false);
  assert.equal(b.from.name, 'YouBike M');
  assert.equal(b.swap, true);
  assert.equal(b.to.name, 'YouBike B');
  assert.ok(b.dep >= a.arr && b.arr > b.dep);
  assert.equal(w.dep, b.arr, 'the walk on starts when the second ride ends');
  assert.equal(p.arr, w.arr);
  // A walk can't be cut.
  assert.equal(splitRide(p, 0, mid, here, T(25)), false);
});
