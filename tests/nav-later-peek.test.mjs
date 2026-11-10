// Jay 2026-11-07 on 自強 116, a trip with a stop (墨竹亭) then home: the steps
// after the stop were greyed and did nothing when tapped, the trip's YouBike
// stations past the next train were gone from the map, and the trip under way
// kept the stretch planned before the fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { box, start, T, clock } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

const P = (name, lat, lon) => ({ name, lat, lon });
const shop = P('墨竹亭', 24.8334, 121.008), dock = P('文信爬蟲兩棲公園', 24.83231, 121.00963), school = P('成功國中', 24.81872, 121.01597), home = P('成功九街', 24.8176, 121.0165);
const trip = () => {
  const legs = [{ mode: 'walk', from: P('', 24.8352, 121.0079), to: shop, dep: T(8, 0), arr: T(8, 3), dur: 180 }];
  const after = { legs: [{ mode: 'walk', from: shop, to: dock, dep: T(8, 33), arr: T(8, 37), dur: 240 }, { mode: 'bike', name: 'YouBike', from: dock, to: school, dep: T(8, 37), arr: T(8, 47), dur: 600, rent: { uid: 'w', ...dock }, ret: { uid: 'c', ...school } }, { mode: 'walk', from: school, to: home, dep: T(8, 47), arr: T(8, 50), dur: 180 }], dep: T(8, 33), arr: T(8, 50) };
  return { legs, dep: T(8, 0), arr: T(8, 3), dest: shop, then: [home], later: [after] };
};

test('each step after a stop is a button; tapped, the map looks at it and the step you are at stays', () => {
  clock.set(T(8, 0));
  const { st, acts } = start(trip());
  assert.match(box.querySelector('.ot-nav-chips').innerHTML, /<button class="ot-nav-chip later" type="button" data-nav-peek="0:1"/);
  box.onclick({ target: { closest: q => (q === '[data-nav-peek]' ? { dataset: { navPeek: '0:1' } } : null) } });
  const peek = acts.find(([a]) => a === 'peek');
  assert.equal(peek?.[1]?.mode, 'bike');
  assert.equal(peek[1].to.name, '成功國中');
  assert.equal(st.i, 0);
});

test('stretches planned again after an update replace the old ones; otherwise a planned stretch is kept', () => {
  clock.set(T(8, 0));
  start(trip());
  const fresh = [{ ...trip().later[0], planV: 2 }];
  nav.navLater(fresh);
  assert.notEqual(nav.navNow().plan.later[0].planV, 2, 'kept: never swapped under you by itself');
  nav.navLater(fresh, { replace: true });
  assert.equal(nav.navNow().plan.later[0].planV, 2);
});

// tab-map.mjs needs a browser; navLook is read from its source.
const src = (await import('node:fs')).readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const COUNT_ZOOM'), src.indexOf('let lookBare'));
const look = (aboard, isRide) => new Function('navNow', 'navFollow', 'map', 'isRide', `${body}\nreturn navLook;`)(() => ({ aboard }), true, { zoom: () => 17 }, isRide);

test('on a train, the trip’s own YouBike stations are on the map to the last place, past the next train and the stop', () => {
  const ride = l => l.mode === 'tra';
  const legs = [{ mode: 'tra' }, { mode: 'tra' }, { mode: 'bike', rent: { uid: 'a' } }, { mode: 'walk' }, { mode: 'walk' }, { mode: 'bike', rent: { uid: 'b' } }];
  const l = look(true, ride)({ legs }, 0);
  assert.deepEqual(l.bikeLegs.filter(x => x.mode === 'bike').map(x => x.rent.uid), ['a', 'b']);
  assert.equal(l.bare, true, 'followed, a bare bike; counts once you zoom in yourself');
});

test('the trip under way is planned again when its stretches after a stop came from an older app', () => {
  assert.match(src, /const stale = resume && !p\.keep && p\.then\?\.length && p\.later\?\.length && p\.later\.some\(q => q\.planV !== PLAN_V\)/);
  assert.match(src, /laterIn\(later, \{ replace: true \}\)/);
  assert.match(src, /function laterIn\(later, opts\) \{\n  navLater\(laterNow\(later\), opts\);[^}]*navDraw\(n\.plan, n\.i\)/);
});

// Jay 2026-11-07 12:23 on the train: tapping the walk to 墨竹亭 said 走到 34.8 公里,
// 約 21:29 抵達 and moved the trip's end to 21:48: the step was timed from where he was.
test('a step looked ahead to shows its own length; the trip’s time stays as it was', async () => {
  const { pos, tick } = await import('./navsim.mjs');
  clock.set(T(8, 0));
  const p = trip();
  // Far off (on a train 30 km away) before the first step.
  p.legs = [{ mode: 'walk', from: P('', 24.6, 120.9), to: P('', 24.601, 120.9), dep: T(8, 0), arr: T(8, 2), dur: 120, dist: 120 }, { mode: 'walk', from: P('', 24.8352, 121.0079), to: shop, dep: T(8, 2), arr: T(8, 5), dur: 180, dist: 230 }];
  p.arr = T(8, 5);
  start(p);
  pos(P('', 24.6, 120.9));
  tick(1000);
  const eta = () => box.querySelector('.ot-nav-etaw').innerHTML;
  const before = eta();
  box.onclick({ target: { closest: q => (q === '[data-nav-go]' ? { dataset: { navGo: '1' } } : null) } });
  const top = box.querySelector('.ot-nav-topw').innerHTML;
  assert.match(top, /<b>230<\/b><small>公尺/);
  assert.doesNotMatch(top, /公里/);
  assert.equal(eta(), before);
});

test('a trip with a stop: the bottom bar is when you are at the stop, not the whole trip', () => {
  clock.set(T(8, 0));
  start(trip());
  const eta = box.querySelector('.ot-nav-etaw').innerHTML;
  assert.match(eta, /到 墨竹亭 還要 /);
  assert.doesNotMatch(eta, /全程剩/);
  assert.match(eta, /<b>08:0[0-9]<\/b>/);
  assert.equal(nav.stopShort('墨竹亭 燃麵本家 竹北博愛店'), '墨竹亭');
  assert.equal(nav.stopShort('國立陽明交通大學光復校區'), '國立陽明交通大…');
});
