// The direction (compass) question goes up only from a tap on your own dot, once a
// launch, never after a no (Jay 2026-11-06, twice: Transit asked every open,
// first from any tap, then from 我的位置, which he taps each launch).
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
test('your dot asks once a launch', async () => {
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
test('the map asks for the compass only from a tap on your own dot', () => {
  const src = readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');
  const calls = [...src.matchAll(/askCompass\(\)/g)].map(m => m.index);
  assert.equal(calls.length, 1);
  const line = src.slice(src.lastIndexOf('\n', calls[0]), calls[0]);
  assert.match(line, /if \(it\.id === 'me'\)/, 'askCompass() only for the dot');
  assert.ok(calls[0] > src.indexOf('\nfunction pick(it)') && calls[0] < src.indexOf('\nfunction ', src.indexOf('\nfunction pick(it)') + 1), 'askCompass() outside pick');
  const locate = src.slice(src.indexOf('async function locateMe()'), src.indexOf('\nfunction ', src.indexOf('async function locateMe()')));
  assert.ok(!/askCompass/.test(locate), '我的位置 asks for the compass');
  for (const f of ['app.mjs', 'lib/nav.mjs', 'lib/tab-go.mjs']) {
    const s = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    assert.ok(!/requestPermission/.test(s.replace(/Notification\.requestPermission/g, '')), `${f} asks for motion`);
  }
});
