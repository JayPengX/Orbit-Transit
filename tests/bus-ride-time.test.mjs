// How long our own bus ride takes, on the real 5608 toward 新竹 of
// 2026-11-03 (竹東高中 → 豐邦公司, 21 stops). Its timetable has the 05:34 there
// in 7 minutes, and that first run stood for every hour: a 17:03 bus "made"
// 區間 1756 at 竹中 (17:21), which it can't. The timetable's own 15:23 says
// 10 minutes; bus 953-FL left 竹東高中 at 15:23 and was at 豐邦公司 at about
// 15:46, as TDX's live estimates had it all along: those first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rideTime, liveRide } from '../public/lib/live.mjs';

const F = name => JSON.parse(readFileSync(new URL(`./fixtures/5608-2026-11-03/${name}`, import.meta.url), 'utf8'));
const [way] = F('ways.json');
const sched = F('sched.json');
const I = way.stops.findIndex(s => s.name === '竹東高中');
const J = way.stops.findIndex(s => s.name === '豐邦公司');
const t = hm => Date.parse(`2026-11-03T${hm}:00+08:00`);
const pt = s => ({ name: s.name, lat: s.lat, lon: s.lon });

test('a ride is timed by the run boarded, not the first one listed', () => {
  assert.equal(J - I, 21);
  assert.equal(rideTime(way, I, J, sched, t('05:34')), 7 * 60);
  assert.equal(rideTime(way, I, J, sched, t('17:03')), 15 * 60);
  assert.equal(rideTime(way, I, J, sched, t('08:03')), 14 * 60);
  // A moment between runs: the nearest run's.
  assert.equal(rideTime(way, I, J, sched, t('17:05')), 15 * 60);
  // No moment: the day's usual ride, never the 7-minute early one.
  assert.equal(rideTime(way, I, J, sched), 12 * 60);
});

test("buses on the road: TDX's live estimates, not the timetable's minutes", () => {
  // 15:45:51: bus 958-FL just past 竹東高中 (its row already the next bus's, none yet).
  const rows = F('eta-1545.json');
  const ride = liveRide(rows, way, I, J);
  assert.ok(ride >= 20 * 60 && ride <= 26 * 60, `${ride} s`);
  // Over twice the timetable's own run then (15:43, 12 minutes).
  assert.ok(ride > 2 * rideTime(way, I, J, sched, t('15:43')));
  // The 15:23 timed so, at 竹中 too late for 區間 1748 (15:43): 5 minutes' walk from 豐邦公司.
  assert.ok(t('15:23') + ride * 1000 + 5 * 60_000 > t('15:43'));
  // Nothing on the road, or under half the way seen: no live answer (the timetable then).
  assert.equal(liveRide([], way, I, J), null);
  assert.equal(liveRide(rows.map(r => ({ ...r, PlateNumb: '-1', EstimateTime: null })), way, I, J), null);
  // Another way's rows never count.
  assert.equal(liveRide(rows.map(r => ({ ...r, Direction: 0 })), way, I, J), null);
});
