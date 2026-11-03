// A lagging bus placed by its GPS, on the real 快捷8號 of 2026-11-03 18:14:45:
// TDX's estimates for every bus last made at 18:08:53 (6 minutes), its GPS
// fixes 20 to 30 seconds old. 590-FT (toward 竹北) left 文興嘉豐南路口 at
// 18:11:22 (TDX's own stop events) and at 18:14:18 was 600 m past 文興嘉興路口
// at 31 km/h; the old estimates, counted on, still had it 2 minutes short of
// 文興嘉興路口. 596-FT (toward 台大竹東分院) stood at 高鐵新竹站.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gpsFix } from '../public/lib/busgps.mjs';
import { parseStops, etaOf } from '../public/lib/bus.mjs';
import { decodeLine } from '../public/lib/util.mjs';

const F = name => JSON.parse(readFileSync(new URL(`./fixtures/k8-gps-2026-11-03/${name}`, import.meta.url), 'utf8'));
const ways = parseStops(F('ways.json'));
const rows = F('eta-181445.json');
const gps = F('gps-181445.json');
const shape = F('shape.json');
const lines = w => shape[`HSQ0747|${w.dir}`].map(([, enc]) => decodeLine(enc));
const now = Date.parse('2026-11-03T18:14:45+08:00');
const mend = () => ways.reduce((list, w) => gpsFix(list, gps, w, lines(w), now), rows);
const row = (list, name, dir) => {
  const w = ways.find(x => x.dir === dir);
  const uid = w.stops.find(s => s.name === name).uid;
  return list.find(r => r.StopUID === uid && r.Direction === dir);
};
const sec = (list, name, dir) => etaOf(row(list, name, dir), now).sec;

test('a bus past a stop its old estimates hadn’t reached: that stop gone, the next counted from the fix', () => {
  const fixed = mend();
  // Counted on from 18:08:53, 文興嘉興路口 was still 2 minutes off.
  assert.ok(sec(rows, '文興嘉興路口', 0) > 100);
  assert.equal(sec(fixed, '文興嘉興路口', 0), null);
  // 喜來登飯店: 1.3 km on at its pace from the estimates, sooner than they had it.
  const s = sec(fixed, '喜來登飯店', 0);
  assert.ok(s > 60 && s < 300, `${s}`);
  assert.ok(s < sec(rows, '喜來登飯店', 0) - 120);
  // And no longer a stopped feed: timed from the fix.
  assert.equal(etaOf(row(fixed, '喜來登飯店', 0), now).stale, false);
});

test('a bus standing at a stop: the stops after it from there; one its estimates have right is left as is', () => {
  const fixed = mend();
  const a = sec(fixed, '東海', 1);
  const b = sec(fixed, '東光', 1);
  assert.ok(a > 0 && b > a, `${a} ${b}`);
  // The gaps between stops are the estimates' own.
  assert.equal(b - a, row(rows, '東光', 1).EstimateTime - row(rows, '東海', 1).EstimateTime);
});

test('no line, no fix, or a fix too old: the rows as they were', () => {
  const w = ways[0];
  assert.equal(gpsFix(rows, gps, w, null, now), rows);
  assert.equal(gpsFix(rows, [], w, lines(w), now), rows);
  assert.deepEqual(gpsFix(rows, gps, w, lines(w), now + 10 * 60_000), rows);
});
