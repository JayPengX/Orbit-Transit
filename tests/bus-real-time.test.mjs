// Buses as they really come (the owner, 2026-11-03): at the stop a few
// minutes early, never a bus TDX sees gone before you're there, never
// "hurry" when hurrying can't make it, and a bus you'd miss caught further
// along its way by YouBike (快捷8號支 to 公三公園). On the real 快捷8號支
// stops and timetable of 2026-10-29 (新竹縣).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStops, etaKey } from '../public/lib/bus.mjs';
import { runsSeen, seenAt, nextCatchable, adjustPlan, rideTime } from '../public/lib/live.mjs';
import { boardEarly, BUS_EARLY } from '../public/lib/plan.mjs';
import { chasePlan, chases } from '../public/lib/chase.mjs';
import { paceOf, pastHurry } from '../public/lib/nav.mjs';
import { meters } from '../public/lib/util.mjs';

const F = name => JSON.parse(readFileSync(new URL(`./fixtures/k8-2026-10-29/${name}`, import.meta.url), 'utf8'));
const MIN = 60_000;
const t = hm => Date.parse(`2026-10-29T${hm}:00+08:00`);
const way = parseStops(F('stops-0748.json')).find(x => x.dir === 1);
const sched = F('sched-0748.json');
const at = name => way.stops.findIndex(s => s.name === name);
const I = at('文興嘉興路口');
const J = at('竹東高中');
const K = at('公三公園');
const pt = s => ({ name: s.name, lat: s.lat, lon: s.lon });
// Metres north and east of a point.
const off = (p, n, e) => ({ lat: p.lat + n / 110_540, lon: p.lon + e / (111_320 * Math.cos((p.lat * Math.PI) / 180)) });
// Home: 400 m south of 文興嘉興路口, toward 公三公園.
const HOME = { name: 'Home', ...off(way.stops[I], -400, 0) };
const leg = (dep, extra = {}) => ({ mode: 'bus', name: '快捷8號支', short: '快捷8號支', from: pt(way.stops[I]), to: pt(way.stops[J]), dep, arr: dep + rideTime(way, I, J, sched) * 1000, dur: rideTime(way, I, J, sched), route: { uid: 'HSQ0748', city: 'HsinchuCounty', dir: 1, stopUID: way.stops[I].uid }, ...extra });
// Walk to 文興嘉興路口 (6 minutes), the bus, a walk on.
function walkPlan(dep, walkFrom = t('08:20')) {
  const b = leg(dep);
  const D = off(way.stops[J], 200, 0);
  return {
    src: 'google',
    legs: [
      { mode: 'walk', from: HOME, to: pt(way.stops[I]), dep: walkFrom, arr: walkFrom + 6 * MIN, dur: 360, dist: 520 },
      b,
      { mode: 'walk', from: pt(way.stops[J]), to: { name: 'School', ...D }, dep: b.arr, arr: b.arr + 3 * MIN, dur: 180, dist: 250 }
    ],
    dep: walkFrom,
    arr: b.arr + 3 * MIN
  };
}

test('at a bus stop 5 minutes before its timetable time, 2 before a bus seen live; never before now; trains as they are', () => {
  const p = walkPlan(t('08:27'), t('08:20'));
  // (Planned to be there a minute before: 08:20 → 08:26.)
  const a = boardEarly(p, t('08:00'));
  assert.equal(a.legs[0].arr, t('08:27') - BUS_EARLY.sched);
  assert.equal(a.dep, t('08:16'));
  assert.equal(a.legs[1].dep, t('08:27'), 'the bus keeps its time');
  // Now is 08:19: leave now, there 2 minutes early.
  assert.equal(boardEarly(p, t('08:19')).dep, t('08:19'));
  // A bus TDX sees coming at 08:27: 2 minutes before it.
  const live = walkPlan(t('08:27'));
  live.legs[1].live = { at: t('08:27') };
  assert.equal(boardEarly(live, t('08:00')).legs[0].arr, t('08:25'));
  // There 10 minutes early by the planner: leaves later, 5 before.
  const early = walkPlan(t('08:27'), t('08:11'));
  assert.equal(boardEarly(early, t('08:00')).legs[0].arr, t('08:22'));
  // A train: as planned.
  const train = walkPlan(t('08:27'));
  train.legs[1] = { ...train.legs[1], mode: 'tra' };
  assert.equal(boardEarly(train, t('08:00')), train);
});

test('a bus seen is the earliest run still to come it can be; the run after it is the next you can make', () => {
  const now = t('08:20');
  // The 08:27 run early, due at 08:24.
  const runs = runsSeen(sched, way, I, [t('08:24')], now);
  assert.equal(runs[0].t, t('08:27'));
  assert.equal(runs[0].seen, t('08:24'));
  assert.equal(runs[1].seen, null);
  assert.equal(seenAt(sched, way, I, [t('08:24')], t('08:27'), now), t('08:24'));
  assert.equal(seenAt(sched, way, I, [t('08:24')], t('08:57'), now), null, 'the 08:57 is no bus seen');
  // There at 08:26: the 08:24 is gone, the 08:57 (the timetable's next) is the one.
  assert.deepEqual(nextCatchable(sched, way, I, [t('08:24')], t('08:26'), now), { at: t('08:57'), live: false });
  // There at 08:22: that bus.
  assert.deepEqual(nextCatchable(sched, way, I, [t('08:24')], t('08:22'), now), { at: t('08:24'), live: true });
  // No timetable: the first bus seen within its window.
  assert.equal(seenAt([], null, I, [t('08:24')], t('08:27'), now), t('08:24'));
});

test('a plan on the timetable’s 08:27 with that bus due at 08:24, you there at 08:26: the 08:57, never the 08:27 again', async () => {
  const now = t('08:20');
  const p = walkPlan(t('08:27'));
  const near = async () => [{ RouteUID: 'HSQ0748', RouteName: { Zh_tw: '快捷8號支' }, Direction: 1, StopUID: way.stops[I].uid, StopStatus: 0, EstimateTime: 240, DataTime: new Date(now).toISOString() }];
  const out = await adjustPlan(p, now, { near, start: now, stops: async () => [way], schedule: async () => sched });
  const bus = out.legs[1];
  assert.equal(bus.dep, t('08:57'));
  assert.equal(bus.live, undefined, 'a timetable run, not a bus seen');
  // Caught walking: the bus seen is taken as it is.
  const q = walkPlan(t('08:27'), t('08:15'));
  const ok = await adjustPlan(q, t('08:15'), { near: async () => (await near()).map(r => ({ ...r, EstimateTime: 540, DataTime: new Date(t('08:15')).toISOString() })), start: t('08:15'), stops: async () => [way], schedule: async () => sched });
  assert.equal(ok.legs[1].dep, t('08:24'));
});

test('never "hurry" when hurrying can’t make it', () => {
  assert.equal(pastHurry(3 * MIN, 4 * MIN), true);
  assert.equal(pastHurry(MIN, 10 * MIN), false);
  assert.equal(pastHurry(45_000, 2 * MIN), false);
  const now = t('08:20');
  const p = walkPlan(t('08:27'));
  // You there at 08:26, the bus due 08:22.
  const times = { ready: new Map([[1, t('08:26')]]), end: [], eta: 0 };
  const pace = paceOf(p, 0, 'before', times, new Map([[1, t('08:22')]]), now);
  assert.equal(pace.tone, 'bad');
  assert.match(pace.text, /趕不上了|can’t make it/);
  // A minute behind with 6 to go: hurry.
  assert.match(paceOf(p, 0, 'before', times, new Map([[1, t('08:25')]]), now).text, /快一點|hurry/);
});

// The YouBike stations: one beside home, one beside each stop from 文興嘉豐南路口 on.
const bikes = [
  { uid: 'B0', name: 'Home YouBike', ...off(HOME, 0, 80), bikes: 5, ebike: 1, ret: 10 },
  ...way.stops.slice(I + 1, J).map((s, k) => ({ uid: `B${k + 1}`, name: `${s.name} YouBike`, ...off(s, 60, 0), bikes: 5, ebike: 0, ret: 10 }))
];
// The 08:24 bus at each stop after 文興嘉興路口, by its timetable's minutes from there.
const due = k => (k > I ? [t('08:24') + rideTime(way, I, k, sched) * 1000] : []);

test('追公車: the 08:24 gone at 文興嘉興路口, caught at 公三公園 by YouBike, there half an hour sooner than the 08:57', () => {
  const now = t('08:20');
  const p = walkPlan(t('08:57'));
  const c = chasePlan(p, HOME, { w: way, i: I, sched }, due, bikes, now);
  assert.ok(c, 'a chase');
  const bus = c.legs.find(l => l.mode === 'bus');
  assert.equal(bus.from.name, '公三公園');
  assert.equal(bus.dep, due(K)[0]);
  assert.equal(bus.route.stopUID, way.stops[K].uid);
  const bike = c.legs.find(l => l.mode === 'bike');
  assert.ok(bike && bike.to.name === '公三公園 YouBike');
  // At the stop 2 minutes or more before it.
  const there = c.legs[c.legs.indexOf(bus) - 1].arr;
  assert.ok(there <= bus.dep - BUS_EARLY.live);
  assert.ok(c.arr <= p.arr - 25 * MIN, 'there well sooner');
  // Already on time for the bus walking: no chase.
  assert.equal(chasePlan(walkPlan(t('08:24')), HOME, { w: way, i: I, sched }, due, bikes, now), null);
  // Out the door too late to beat it anywhere: none.
  assert.equal(chasePlan(p, HOME, { w: way, i: I, sched }, due, bikes, t('08:31')), null);
  // No bike near home: none.
  assert.equal(chasePlan(p, HOME, { w: way, i: I, sched }, due, bikes.slice(1), now), null);
});

test('chases: the planner’s plans, each route asked once', async () => {
  const now = t('08:20');
  const p = walkPlan(t('08:57'));
  let asked = 0;
  const eta = async () => {
    asked++;
    const m = new Map();
    for (let k = I + 1; k < way.stops.length; k++) m.set(etaKey(way.stops[k].uid, 'HSQ0748', 1), { status: 0, sec: (due(k)[0] - now) / 1000, more: [] });
    return m;
  };
  const near = async (lat, lon) => bikes.filter(s => meters(lat, lon, s.lat, s.lon) <= 1000);
  const out = await chases([p, { ...p }], HOME, now, now, { eta, way: async () => ({ w: way, i: I, sched }), near });
  assert.equal(asked, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].src, 'chase');
  assert.equal(out[0].legs.find(l => l.mode === 'bus').from.name, '公三公園');
});
