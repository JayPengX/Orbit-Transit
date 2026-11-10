// 下雨改搭車 (Jay 11-10, the family's links): Weather's wet stretches near a
// trip's ends make a ride or a long walk in them cost more, and mark them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rainFor, wetLeg, rainCost, markWet } from '../public/lib/rain.mjs';
import { score } from '../public/lib/plan.mjs';

const M = 60_000;
const t0 = Date.UTC(2026, 10, 11, 0, 0);
const at = (lat, lon, name = '') => ({ lat, lon, name });
const A = at(24.83, 121.01, 'A');
const B = at(24.81, 121.03, 'B');
const leg = (mode, from, mins, extra = {}) => ({ mode, dep: t0 + from * M, arr: t0 + (from + mins) * M, dur: mins * 60, from: A, to: B, ...extra });
const plan = legs => ({ legs, dep: legs[0].dep, arr: legs.at(-1).arr, walk: legs.filter(l => l.mode === 'walk').reduce((a, l) => a + l.dur * 1.2, 0) });
// A YouBike there in 14 minutes, or a bus in 18 with a short walk each end.
const bike = () => plan([leg('walk', 0, 2), leg('bike', 2, 10), leg('walk', 12, 2)]);
const bus = () => plan([leg('walk', 0, 3), leg('bus', 3, 12, { name: '1' }), leg('walk', 15, 3)]);

test('Weather’s fact: the place nearest each end within 8 km, or nothing known', () => {
  const fact = { places: [{ lat: 24.83, lon: 121.01, wet: [[t0, t0 + 60 * M]] }, { lat: 25.03, lon: 121.56, wet: [] }] };
  assert.deepEqual(rainFor(fact, [A, B]), [[t0, t0 + 60 * M], [t0, t0 + 60 * M]]);
  assert.deepEqual(rainFor(fact, [at(25.04, 121.55)]), [], 'Taipei: known dry');
  assert.equal(rainFor(fact, [at(22.6, 120.3)]), null, '高雄: no Weather place near, nothing known');
  assert.equal(rainFor(null, [A]), null);
});

test('a dry trip ranks as before; in the rain the bus comes first and the ride is marked', () => {
  const o = { o: A, d: B, now: t0 };
  assert.ok(score(bike(), o) < score(bus(), o), 'dry: the YouBike is the better way');
  const wet = [[t0, t0 + 60 * M]];
  assert.equal(rainCost(bus(), wet), 0, 'walks under 3 minutes are getting on and off');
  assert.ok(score(bike(), { ...o, wet }) > score(bus(), { ...o, wet }), 'wet: the bus first');
  // (Rain only later: the ride before it is dry.)
  assert.equal(rainCost(bike(), [[t0 + 30 * M, t0 + 90 * M]]), 0);
  const [p] = markWet([bike()], wet);
  assert.equal(p.wet, true);
  assert.deepEqual(p.legs.map(l => !!l.wet), [false, true, false]);
  assert.equal(wetLeg(leg('walk', 0, 8), wet), true, 'a long walk is wet');
  assert.equal(markWet([bus()], null)[0].wet, undefined, 'nothing known: nothing marked');
});
