// A route's two ways at a stop they share, and the timetable behind a live
// bus, on the real 快捷8號 / 8號支 of 2026-10-29 06:57 (新竹縣): 高鐵新竹站 is
// on both ways, a 8號支 bus early at 上員 had its own timetable time still
// said at 員山路口 behind it, and the planner's 07:28 at 文興嘉興路口 wasn't
// in the timetable (07:55).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { etaMap, etaKey, etaFor, parseStops } from '../public/lib/bus.mjs';
import { nextUnseen, officialPlan } from '../public/lib/live.mjs';

const F = name => JSON.parse(readFileSync(new URL(`./fixtures/k8-2026-10-29/${name}`, import.meta.url), 'utf8'));
// (The answers made at 06:57:3x: their DataTime.)
const NOW = Date.parse('2026-10-29T06:57:40+08:00');
const HSR = 'HSQ299242';

test('a stop on both ways: each way its own bus, not the sooner of the two', () => {
  const rows = F('eta-0747.json').map(r => ({ ...r, DataTime: undefined, SrcUpdateTime: undefined, UpdateTime: undefined }));
  const m = etaMap(rows);
  // Toward 竹北 (dir 0) a bus is 175 s off; toward 台大竹東分院 (dir 1) 604 s.
  assert.equal(m.get(etaKey(HSR, 'HSQ0747', 0)).sec, 175);
  assert.equal(m.get(etaKey(HSR, 'HSQ0747', 1)).sec, 604);
  // One way asked for: only its rows.
  assert.equal(etaMap(rows, 1).get(HSR).sec, 604);
  // A pinned stop: its own route and way's.
  assert.equal(etaFor(m, { stopUID: HSR, routeUID: 'HSQ0747', dir: 1 }).sec, 604);
  assert.equal(etaFor(m, { stopUID: HSR, routeUID: 'HSQ0748', dir: 1 }), undefined);
});

test("the timetable behind a live bus: not that bus's own time again", () => {
  const w = parseStops(F('stops-0748.json')).find(x => x.dir === 1);
  const sched = F('sched-0748.json');
  const k = w.stops.findIndex(s => s.name === '員山路口');
  // The bus 528-FT just past 上員, due at 榮華 in a minute; its run is the 06:20 from 竹北 (員山路口 06:57).
  const at = NOW - 4 * 60_000;
  const lives = w.stops.map(s => (s.name === '榮華' ? { status: 0, sec: 120 } : s.name === '竹東' ? { status: 0, sec: 360 } : null));
  const p = nextUnseen(sched, w, k, lives, at);
  assert.equal(new Date(p.at).toISOString(), '2026-10-29T00:48:00.000Z'); // 08:48, the 08:00's
  // With no bus on the road, the timetable's next as it is.
  assert.equal(new Date(nextUnseen(sched, w, k, w.stops.map(() => null), at).at).toISOString(), '2026-10-28T22:57:00.000Z');
});

test("a planner's bus soon, at a time the timetable doesn't have: the timetable's", async () => {
  const ways = parseStops(F('stops-0747.json'));
  const w = ways.find(x => x.dir === 1);
  const on = w.stops.find(s => s.name === '文興嘉興路口');
  const off = w.stops.find(s => s.name === '竹東火車站');
  const t = hm => Date.parse(`2026-10-29T${hm}:00+08:00`);
  const plan = {
    src: 'google',
    legs: [
      { mode: 'walk', dep: t('07:26'), arr: t('07:28'), dur: 120, from: { lat: on.lat + 0.001, lon: on.lon }, to: { lat: on.lat, lon: on.lon } },
      { mode: 'bus', name: '快捷八號', short: '快捷8號', stops: 20, dep: t('07:28'), arr: t('08:03'), dur: 35 * 60, from: { name: on.name, lat: on.lat, lon: on.lon }, to: { name: off.name, lat: off.lat, lon: off.lon } }
    ]
  };
  const near = async () => [{ lat: on.lat, lon: on.lon, stops: [{ stopUID: on.uid, routeUID: 'HSQ0747', route: '快捷8號' }] }];
  const out = await officialPlan(plan, NOW, { near, stops: async () => ways, schedule: async () => F('sched-0747.json') });
  const bus = out.legs.find(l => l.mode === 'bus');
  assert.equal(bus.route.uid, 'HSQ0747');
  assert.equal(bus.dep, t('07:55'));
});
