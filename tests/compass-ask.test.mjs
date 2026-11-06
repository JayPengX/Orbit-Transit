// The direction (compass) question goes up only from a tap on 我的位置, once a
// launch, never after a no (Jay 2026-11-06: Transit asked almost every open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
let asks = 0;
let answer = 'granted';
globalThis.DeviceOrientationEvent = { requestPermission: async () => (asks++, answer) };
const docTaps = [];
globalThis.addEventListener = () => {};

const { watchHeading, askCompass, shouldAsk } = await import('../public/lib/compass.mjs');
globalThis.document = { addEventListener: type => docTaps.push(type), removeEventListener() {} };

test('opening (the dot drawn, the heading watched) never asks, even after an earlier yes', () => {
  store.set('orbit-transit.compass.v1', 'true');
  const stop = watchHeading(() => {});
  assert.equal(asks, 0);
  assert.deepEqual(docTaps.filter(t => t === 'click' || t === 'touchend' || t === 'pointerdown'), []);
  stop();
});
test('我的位置 asks once a launch', async () => {
  await askCompass();
  await askCompass();
  assert.equal(asks, 1);
});
test('a no is kept: never asked again', () => {
  assert.equal(shouldAsk({ needs: true, said: false, askedNow: false, turning: false }), false);
  assert.equal(shouldAsk({ needs: true, said: null, askedNow: false, turning: false }), true);
  assert.equal(shouldAsk({ needs: true, said: true, askedNow: false, turning: false }), true);
  assert.equal(shouldAsk({ needs: false, said: null, askedNow: false, turning: false }), false);
  assert.equal(shouldAsk({ needs: true, said: null, askedNow: true, turning: false }), false);
});
test('the map asks for the compass only inside the 我的位置 tap', () => {
  const src = readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/askCompass\(\)/g)].map(m => m.index);
  const locate = src.indexOf('async function locateMe()');
  const after = src.indexOf('\nfunction ', locate);
  assert.ok(calls.length >= 1);
  for (const at of calls) assert.ok(at > locate && at < after, 'askCompass() outside locateMe');
  for (const f of ['app.mjs', 'lib/nav.mjs', 'lib/tab-go.mjs']) {
    const s = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    assert.ok(!/requestPermission/.test(s.replace(/Notification\.requestPermission/g, '')), `${f} asks for motion`);
  }
});
