// On the last train past midnight (11-17): navigation looked for you among
// today's trains only, and TDX files a train under the day it leaves its
// first station: at 00:10 the 區間 that left at 23:40 is yesterday's. No train
// was found where you were (taken for off it), its stops weren't known, and
// 下一班 had nothing. The trains around now are the day before's too until
// 03:00, and from 21:00 tomorrow's first.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nav from '../public/lib/nav.mjs';

const at = s => Date.parse(`${s}+08:00`);
const sts = [
  { key: 'tra:1210', sys: 'tra', name: '新竹', lat: 24.8016, lon: 120.9716 },
  { key: 'tra:1250', sys: 'tra', name: '竹南', lat: 24.6866, lon: 120.8810 }
];
// 區間 3199 leaves 新竹 23:58 on the 17th, 竹南 at 00:16 on the 18th: filed under the 17th.
const late = { sys: 'tra', no: '3199', type: '區間', code: '6', stops: [{ st: 'tra:1210', arr: at('2026-11-17T23:58:00'), dep: at('2026-11-17T23:58:00') }, { st: 'tra:1250', arr: at('2026-11-18T00:16:00'), dep: at('2026-11-18T00:16:00') }] };
const first = { sys: 'tra', no: '1101', type: '區間', code: '6', stops: [{ st: 'tra:1210', arr: at('2026-11-18T05:30:00'), dep: at('2026-11-18T05:30:00') }, { st: 'tra:1250', arr: at('2026-11-18T05:50:00'), dep: at('2026-11-18T05:50:00') }] };
const days = { '2026-11-17': [late], '2026-11-18': [first] };

test('at 00:08 on the 23:58 train: found where you are among the trains still running from yesterday', async () => {
  nav.useRail({ dayTrips: async d => days[d] || [], railStations: async () => sts, traLive: async () => new Map() });
  try {
    const now = at('2026-11-18T00:08:00');
    const trips = await nav.trainsAround(now);
    assert.deepEqual(trips.map(t => t.no).sort(), ['1101', '3199']);
    const leg = { mode: 'tra', from: sts[0], to: sts[1], dep: late.stops[0].dep, arr: late.stops[1].arr, train: { no: '3199' } };
    // Half way, between 新竹 and 竹南.
    const pos = { lat: (sts[0].lat + sts[1].lat) / 2, lon: (sts[0].lon + sts[1].lon) / 2 };
    assert.equal(nav.trainNow(trips, sts, leg, pos, new Map(), now)?.train.no, '3199');
    // (At noon, yesterday's aren't asked for.)
    assert.deepEqual((await nav.trainsAround(at('2026-11-18T12:00:00'))).map(t => t.no), ['1101']);
  } finally {
    nav.useRail({});
  }
});

test('from 21:00 the next train may be tomorrow’s first (下一班 after the last tonight)', async () => {
  nav.useRail({ dayTrips: async d => days[d] || [], railStations: async () => sts, traLive: async () => new Map() });
  try {
    const trips = await nav.trainsAround(at('2026-11-17T23:59:30'), { next: true });
    assert.deepEqual(trips.map(t => t.no), ['3199', '1101']);
  } finally {
    nav.useRail({});
  }
});

test('navigation asks for its trains by the time around now, never by today’s date alone', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/lib/nav.mjs', import.meta.url), 'utf8');
  assert.ok(!/rail\.dayTrips\(tw\(/.test(src), 'no train looked for in one day’s timetable');
});
