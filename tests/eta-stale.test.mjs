// A bus whose TDX feed stopped (the owner, 2026-11-03 17:43): 快捷8號 toward
// 台大竹東分院, its estimates last made at 17:37:54. The sheet said 進站中 at
// 富貴街口 and 即將進站 at 工研院(東) with the bus 5 minutes further on, and he
// took the wrong bus. Times from a stopped feed are said as old, never
// 進站中, no bus drawn for them, and one quiet for 15 minutes is no bus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { etaOf, etaText } from '../public/lib/bus.mjs';
import { busBetween, busAt } from '../public/lib/bus-ui.mjs';
import { busWhere } from '../public/lib/navlive.mjs';
import { liveTimes } from '../public/lib/live.mjs';

const at = hms => Date.parse(`2026-11-03T${hms}+08:00`);
const row = (stop, sec, made = '17:37:54') => ({ StopUID: stop, RouteUID: 'HSQ0747', RouteName: { Zh_tw: '快捷8號' }, Direction: 1, StopStatus: 0, EstimateTime: sec, PlateNumb: '598-FT', DataTime: `2026-11-03T${made}+08:00` });
// 台鐵竹中站 (the bus after), 富貴街口, 工研院(東), 二重埔: as TDX had them at 17:37:54.
const rows = [row('HSQ299235', 3181), row('HSQ299233', 248), row('HSQ299231', 475), row('HSQ299229', 794)];

test('a fresh estimate counts down as before', () => {
  const v = etaOf(row('HSQ299229', 794, '17:43:00'), at('17:44:00'));
  assert.equal(v.stale, false);
  assert.equal(v.sec, 734);
  assert.equal(etaText(v, at('17:44:00')).main, '12 分');
  // TDX's usual lag (1 to 3.5 minutes) is no stopped feed.
  assert.equal(etaOf(row('HSQ299233', 248), at('17:41:20')).stale, false);
});

test('17:43, five minutes after its feed stopped: no 進站中, said as old', () => {
  const now = at('17:43:00');
  const [, fu, gong, er] = rows.map(r => etaOf(r, now));
  for (const v of [fu, gong, er]) assert.equal(v.stale, true);
  for (const v of [fu, gong]) {
    const t = etaText(v, now);
    assert.equal(t.main, '可能已過');
    assert.notEqual(t.tone, 'now');
    assert.equal(t.sub, '5 分鐘前資料');
  }
  assert.equal(etaText(er, now).main, '8 分');
  assert.equal(etaText(er, now).sub, '5 分鐘前資料');
});

test('no bus drawn or placed for a stopped feed', () => {
  const now = at('17:43:00');
  const lives = rows.map(r => etaOf(r, now));
  assert.deepEqual(lives.map((_, k) => busAt(lives, k)), [false, false, false, false]);
  assert.deepEqual(lives.map((_, k) => busBetween(lives, k)), [false, false, false, false]);
  const stops = rows.map(r => ({ uid: r.StopUID }));
  const eta = new Map(rows.map((r, k) => [r.StopUID, lives[k]]));
  assert.equal(busWhere(stops, 3, eta), null);
});

test('quiet 15 minutes: no live time at all, and none planned on', () => {
  const now = at('17:55:00');
  const v = etaOf(row('HSQ299229', 794), now);
  assert.equal(v.sec, null);
  assert.equal(liveTimes(rows, '快捷8號', now, { routeUID: 'HSQ0747' }).times.length, 0);
  assert.equal(liveTimes(rows, '快捷8號', at('17:40:00'), { routeUID: 'HSQ0747' }).times.length, 4);
});
