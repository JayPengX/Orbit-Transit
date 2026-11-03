// A route sheet's bus icon, on the real 快捷8號 toward 竹北火車站 of
// 2026-11-03 (the owner's screenshot, 17:28): 下山 17 分, 砂石廠 18 分, 東光
// 20 分, then 東海 19:00 and 東海國小 19:02 (the timetable), 高鐵新竹站 28 分,
// and a red bus drawn between 東海國小 and 高鐵新竹站 where none was. TDX had
// the one bus's live times at every stop; 東海's and 東海國小's were thrown out
// because the timetable times only 台大竹東分院 → 砂石廠, so theirs were the
// first stop's plus a ride guessed from the distance (18:00 for a bus there at
// 17:49), and a stop without a live time then read as "a new bus after it".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveTrusted } from '../public/lib/live.mjs';
import { parseStops } from '../public/lib/bus.mjs';
import { busBetween, busAt } from '../public/lib/bus-ui.mjs';

const F = name => JSON.parse(readFileSync(new URL(`./fixtures/k8-2026-11-03/${name}`, import.meta.url), 'utf8'));
const [way] = parseStops(F('ways.json'));
const sched = F('sched.json');
const t = hm => Date.parse(`2026-11-03T${hm}:00+08:00`);
const at = name => way.stops.findIndex(s => s.name === name);

test('a live bus at a stop the timetable doesn’t time is taken when a run left the first stop for it', () => {
  // 東海: the 17:00 from 台大竹東分院, guessed there at 18:00, there at 17:45.
  assert.equal(liveTrusted(sched, way, at('東海'), t('17:45')), true);
  assert.equal(liveTrusted(sched, way, at('東海國小'), t('17:46')), true);
  // Before the day's first run has left (06:00): a bus resting with its tracker on.
  assert.equal(liveTrusted(sched, way, at('東海'), t('05:30')), false);
  // A stop the timetable does time keeps its own window: 下山 at 15:30, its next run 16:34, is no bus.
  assert.equal(liveTrusted(sched, way, at('下山'), t('15:30')), false);
  assert.equal(liveTrusted(sched, way, at('下山'), t('17:45')), true);
});

test('every live time the one bus has, from 17:30, is taken: no stop left to the timetable', () => {
  const now = t('17:30') + 23_000;
  for (const r of F('eta-1730.json')) {
    if (r.StopStatus !== 0) continue;
    const k = way.stops.findIndex(s => s.uid === r.StopUID);
    assert.equal(liveTrusted(sched, way, k, now + r.EstimateTime * 1000), true, way.stops[k].name);
  }
});

test('a stop without a live time between two of the same bus’s is no bus', () => {
  const v = sec => ({ status: 0, sec, more: [] });
  // 下山 17, 砂石廠 18, 東光 20, 東海 —, 東海國小 —, 高鐵新竹站 28, 文興嘉豐南路口 34.
  const lives = [v(1020), v(1080), v(1200), null, null, v(1680), v(2040)];
  assert.deepEqual(lives.map((_, k) => busBetween(lives, k)), [false, false, false, false, false, false, false]);
  // A bus TDX doesn't time at the stop before (尚未發車) but sooner than the one behind it: between.
  const two = [v(1500), { status: 1, sec: null }, v(200)];
  assert.deepEqual(two.map((_, k) => busBetween(two, k)), [false, false, true]);
  // And at a stop: on its dot past a gap only when it's another bus.
  assert.equal(busAt([v(10), null, v(40)], 2), false);
  assert.equal(busAt([v(900), null, v(40)], 2), true);
});
