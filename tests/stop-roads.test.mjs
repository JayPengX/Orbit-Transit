import { test } from 'node:test';
import assert from 'node:assert/strict';

// Jay 2026-11-07, 彰化 → 墨竹亭 → 成功九街: "after that destination it's all
// straight line", and the stop on the way had no mark. tab-map.mjs needs a
// browser; these parts are read from its source.
const src = (await import('node:fs')).readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('// The roads found for a walk or a ride'), src.indexOf('// A leg\'s way on the map'));
const make = new Function('card', 'restOf', 'TRACK_V', `${body}\nreturn { tripLegs, needsRoad, knownRoad, roadsKnown, roadKey };`);
const P = (name, lat, lon) => ({ name, lat, lon });
const shop = P('墨竹亭', 24.8334, 121.008), dock = P('文信爬蟲兩棲公園', 24.83231, 121.00963), park = P('綠41公園', 24.81614, 121.0171), home = P('成功九街', 24.8176, 121.0165);
const first = { legs: [{ mode: 'walk', from: P('', 24.8352, 121.0079), to: shop, dist: 230 }] };
const after = { legs: [{ mode: 'walk', from: shop, to: dock, dist: 252 }, { mode: 'bike', from: dock, to: park, dist: 2624 }, { mode: 'walk', from: park, to: home, dist: 250 }] };

test('navigating, the legs after a stop are the trip’s too, and drawn straight they ask for their roads', () => {
  const { tripLegs, needsRoad } = make(null, () => null, 2);
  const legs = tripLegs({ ...first, later: [after] });
  assert.equal(legs.length, 4);
  assert.deepEqual(legs.filter(needsRoad).map(l => l.mode), ['walk', 'walk', 'bike', 'walk']);
});

test('on the plans card, the stretches planned on from a way are its legs too', () => {
  const card = { plans: [first] };
  const { tripLegs } = make(card, (c, p) => (c === card && p === first ? [after] : null), 2);
  assert.equal(tripLegs(first).at(-1).to.name, '成功九街');
});

test('a stretch timed on again (a fresh copy) keeps the road found for it', () => {
  const { knownRoad, roadsKnown, roadKey } = make(null, () => null, 2);
  const ride = after.legs[1];
  roadsKnown.set(roadKey(ride), { poly: 'abc', dist: 2624 });
  const copy = { ...ride, dep: 1, arr: 2 };
  knownRoad(copy);
  assert.equal(copy.road, true);
  assert.equal(copy.poly, 'abc');
});

test('each stop on the way gets its own pin on the map', () => {
  assert.match(src, /id: `stop\$\{k\}`[^\n]*cls: 'dest stop'/);
});
