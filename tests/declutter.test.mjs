import { test } from 'node:test';
import assert from 'node:assert/strict';

// tab-map.mjs needs a browser; its declutter is pure, read from the source.
const src = (await import('node:fs')).readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const markBox'), src.indexOf('let planMarks'));
const { declutter } = new Function(body.replace('export function declutter', 'function declutter') + '\nreturn { declutter };')();

// Jay 2026-11-03, the trip zoomed out near 六家: the end, a YouBike station and the stop's name in one heap.
const end = { id: 'to', lat: 24.8075, lon: 121.0405, cls: 'dest' };
const bike = { id: 'pbike:1', lat: 24.8072, lon: 121.0415, cls: 'bike plan ok' };
const off = { id: 's2:9', lat: 24.8073, lon: 121.0428, cls: 'stopdot off', name: '文興嘉興路口' };
const dot = { id: 's2:8', lat: 24.8074, lon: 121.0429, cls: 'stopdot' };

test('zoomed out, the end wins its spot: the bike station and the stop name give way, the dots stay', () => {
  const out = declutter([bike, off, dot, end], 12);
  const by = Object.fromEntries(out.map(x => [x.id, x.cls]));
  assert.equal(by.to, 'dest');
  assert.match(by['pbike:1'], /tuck/);
  assert.match(by['s2:9'], /nolabel/);
  assert.equal(by['s2:8'], 'stopdot');
});
test('zoomed in, every mark and the name are back', () => {
  const out = declutter([bike, off, dot, end], 19);
  assert.ok(out.every(x => !/tuck|nolabel/.test(x.cls)));
});

// A walk's road path to a YouBike station inside a block went on past it and back (六家, Jay 2026-11-03).
const { meters } = await import('../public/lib/util.mjs');
const tsrc = src.slice(src.indexOf('export function trimEnds'), src.indexOf('// A trip\'s YouBike stations, where you take'));
const trimEnds = new Function('meters', tsrc.replace('export function', 'function') + '\nreturn trimEnds;')(meters);
test('a line that goes on past where it ends, and back, is cut where it stops coming nearer', () => {
  const stop = { lat: 24.8100, lon: 121.0400 };
  const station = { lat: 24.8100, lon: 121.0380 };
  // West along the road to the corner by the station, then on 300 m south past it.
  const path = [[24.81, 121.04], [24.81, 121.039], [24.8101, 121.0381], [24.809, 121.0381], [24.8073, 121.0382]];
  const out = trimEnds(path, stop, station);
  assert.deepEqual(out.at(-1), [station.lat, station.lon]);
  assert.equal(out.length, 4);
  // A straight way in is left as it is.
  const plain = [[24.81, 121.04], [24.81, 121.039], [24.81, 121.0381]];
  assert.deepEqual(trimEnds(plain, stop, station), plain);
});
