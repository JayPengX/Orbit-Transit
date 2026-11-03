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
