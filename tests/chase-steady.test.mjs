// 追公車 steady and safe (Jay 2026-11-06: "it keep switching between the
// close one and the further one, and the further one recommendation is still
// kind of suck and not safe enough to catch it"). On the real 快捷8號支 stops
// and timetable of 2026-10-29 (新竹縣), the case it was made for: home 400 m
// from 文興嘉興路口, the 08:24 caught at 公三公園 by YouBike.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStops, etaKey } from '../public/lib/bus.mjs';
import { adjustPlan, rideTime } from '../public/lib/live.mjs';
import { boardEarly, score, pickSig, BUS_EARLY } from '../public/lib/plan.mjs';
import { chasePlan, chases, chaseSlack, chaseGain, chaseNow, chaseOf, steadyLead, CHASE_SWITCH } from '../public/lib/chase.mjs';
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
const off = (p, n, e) => ({ lat: p.lat + n / 110_540, lon: p.lon + e / (111_320 * Math.cos((p.lat * Math.PI) / 180)) });
const HOME = { name: 'Home', ...off(way.stops[I], -400, 0) };
const X = { w: way, i: I, sched };
const leg = dep => ({ mode: 'bus', name: '快捷8號支', short: '快捷8號支', from: pt(way.stops[I]), to: pt(way.stops[J]), dep, arr: dep + rideTime(way, I, J, sched) * 1000, dur: rideTime(way, I, J, sched), route: { uid: 'HSQ0748', city: 'HsinchuCounty', dir: 1, stopUID: way.stops[I].uid } });
function walkPlan(dep, walkFrom = t('08:20')) {
  const b = leg(dep);
  const D = off(way.stops[J], 200, 0);
  return {
    src: 'google',
    legs: [{ mode: 'walk', from: HOME, to: pt(way.stops[I]), dep: walkFrom, arr: walkFrom + 6 * MIN, dur: 360, dist: 520 }, b, { mode: 'walk', from: pt(way.stops[J]), to: { name: 'School', ...D }, dep: b.arr, arr: b.arr + 3 * MIN, dur: 180, dist: 250 }],
    dep: walkFrom,
    arr: b.arr + 3 * MIN
  };
}
const bikes = [{ uid: 'B0', name: 'Home YouBike', ...off(HOME, 0, 80), bikes: 5, ebike: 1, ret: 10 }, ...way.stops.slice(I + 1, J).map((s, k) => ({ uid: `B${k + 1}`, name: `${s.name} YouBike`, ...off(s, 60, 0), bikes: 5, ebike: 0, ret: 10 }))];
// The 08:24 bus (or one `shift` later) at each stop after 文興嘉興路口.
const dueAt = (shift = 0) => k => (k > I ? [t('08:24') + shift + rideTime(way, I, k, sched) * 1000] : []);
const busOf = p => p.legs.find(l => l.mode === 'bus');

test('the room at the stop grows with the ride there and the bus’s countdown, 4 minutes at least', () => {
  assert.equal(chaseSlack(5 * MIN, 8 * MIN), 4 * MIN);
  assert.ok(chaseSlack(20 * MIN, 25 * MIN) >= 7 * MIN);
  assert.ok(chaseSlack(20 * MIN, 25 * MIN) > chaseSlack(10 * MIN, 25 * MIN));
  assert.ok(chaseSlack(10 * MIN, 40 * MIN) > chaseSlack(10 * MIN, 15 * MIN));
});

test('a chase has you at the stop with that room, and leaves no later than keeps it', () => {
  const now = t('08:20');
  const c = chasePlan(walkPlan(t('08:57')), HOME, X, dueAt(), bikes, now);
  assert.ok(c, 'the case it was made for still stands');
  const b = busOf(c);
  const there = c.legs[c.legs.indexOf(b) - 1].arr;
  assert.ok(b.dep - there >= b.chase.slack && b.chase.slack >= 4 * MIN, `at the stop ${(b.dep - there) / MIN} min early`);
  // Shown with its leave time: never pushed later to be there only 2 minutes early.
  const shown = boardEarly(c, now);
  assert.ok(b.dep - shown.legs[shown.legs.indexOf(busOf(shown)) - 1].arr >= b.chase.slack - 1000);
});

test('too tight is no chase: a bus due 3 minutes after you’d be at its stop is not offered', () => {
  const now = t('08:20');
  // The bus 2½ minutes nearer than the timetable says: 公三公園 with 3 minutes to spare
  // (the old 2-minute room took it), every other stop already past.
  const tight = k => (k === K ? [t('08:24') - 2.5 * MIN + rideTime(way, I, K, sched) * 1000] : []);
  assert.equal(chasePlan(walkPlan(t('08:57')), HOME, X, tight, bikes, now), null);
});

test('only when it clearly helps: 7 minutes sooner is no reason to ride', () => {
  const now = t('08:20');
  // The bus you'd walk to comes at 08:31: the 08:24 caught further on gets you in about 7 minutes sooner.
  const p = walkPlan(t('08:31'));
  const c = chasePlan(p, HOME, X, dueAt(), bikes, now);
  assert.equal(c, null);
  assert.ok(chaseGain(0) >= 8 * MIN && chaseGain(30 * MIN) >= 15 * MIN);
});

test('a feed that stopped is never chased on', async () => {
  const now = t('08:20');
  const eta = stale => async () => {
    const m = new Map();
    for (let k = I + 1; k < way.stops.length; k++) m.set(etaKey(way.stops[k].uid, 'HSQ0748', 1), { status: 0, sec: (dueAt()(k)[0] - now) / 1000, more: [], stale });
    return m;
  };
  const near = async (lat, lon) => bikes.filter(s => meters(lat, lon, s.lat, s.lon) <= 1000);
  const opts = s => ({ eta: eta(s), way: async () => X, near });
  assert.equal((await chases([walkPlan(t('08:57'))], HOME, now, now, opts(false))).length, 1);
  assert.equal((await chases([walkPlan(t('08:57'))], HOME, now, now, opts(true))).length, 0);
});

test('ranked: a chase carries the risk of the race, so a near-tie goes to the near stop', () => {
  const now = t('08:20');
  const c = chasePlan(walkPlan(t('08:57')), HOME, X, dueAt(), bikes, now);
  const plain = { ...c, legs: c.legs.map(l => (l.chase ? { ...l, chase: undefined } : l)) };
  assert.ok(score(c, { now }) - score(plain, { now }) >= 4);
});

// The bus times at 公三公園 a minute or two later, as TDX gives them to adjustPlan.
const rowsAt = (now, dueMs) => async () => [{ RouteUID: 'HSQ0748', RouteName: { Zh_tw: '快捷8號支' }, Direction: 1, StopUID: way.stops[K].uid, StopStatus: 0, EstimateTime: Math.round((dueMs - now) / 1000), DataTime: new Date(now).toISOString() }];

test('kept while it can be made: the same bus, re-timed, never one you’d reach 30 seconds before', async () => {
  const t0 = t('08:20');
  const c = chasePlan(walkPlan(t('08:57')), HOME, X, dueAt(), bikes, t0);
  const b = busOf(c);
  const now = t0 + MIN;
  const go = chaseNow(c, now);
  assert.ok(go, 'a minute on, still on');
  assert.equal(go.dep, now, 'set out from now');
  assert.equal(busOf(go).dep, b.dep, 'the same bus');
  const fine = await adjustPlan(go, now, { near: rowsAt(now, b.dep + 30_000), start: now });
  assert.ok(!fine.lost);
  // The bus now due at 公三公園 a minute and a half after you'd get there: no chase, never "that bus" at 30 s.
  const there = go.legs[go.legs.indexOf(busOf(go)) - 1].arr;
  const tight = await adjustPlan(go, now, { near: rowsAt(now, there + 90_000), start: now });
  assert.equal(tight.lost, true);
  // Only a later bus there now (the one you'd walk to): no chase either.
  const later = await adjustPlan(go, now, { near: rowsAt(now, b.dep + 20 * MIN), start: now });
  assert.equal(later.lost, true);
  // Set out too late to keep room: gone.
  assert.equal(chaseNow(c, b.chase.by + 5 * MIN), null);
});

test('交通: a chase that can’t be made any more hands its card to the near stop, once', async () => {
  const { rollPlans } = await import('../public/lib/tab-go.mjs');
  const t0 = t('08:20');
  const walk = walkPlan(t('08:57'), t('08:50'));
  const c = chasePlan(walkPlan(t('08:57')), HOME, X, dueAt(), bikes, t0);
  assert.equal(pickSig(c), pickSig(walk), 'one card: the same bus line');
  const plans = [{ ...c, lead: true, top: true, score: 30, tags: ['推薦'], times: [0, 1] }, { ...walk, lead: false, score: 33, times: [0, 1] }];
  // Two minutes on, still made: the card keeps the chase, leaving now.
  const on = rollPlans(plans, t0 + 2 * MIN);
  assert.ok(on[0].lead && chaseOf(on[0]) && on[0].dep === t0 + 2 * MIN);
  // Too late to keep room: the near stop's way has the card, its tags with it.
  const late = rollPlans(plans, chaseOf(c).chase.by + 5 * MIN);
  assert.ok(late[0].lost && !late[0].lead);
  assert.ok(late[1].lead && late[1].top && late[1].tags.includes('推薦'));
  // Rolled again: it stays that way.
  const again = rollPlans(late, chaseOf(c).chase.by + 6 * MIN);
  assert.ok(again[1].lead && !again[0].lead);
});

test('steady: found again, the stop the card showed keeps it unless the other is 10 minutes sooner', () => {
  const t0 = t('08:20');
  const c = chasePlan(walkPlan(t('08:57')), HOME, X, dueAt(), bikes, t0);
  const walk = walkPlan(t('08:57'), t('08:50'));
  const near = walkPlan(t('08:31'), t('08:24'));
  // Shown: the near stop's 08:31. Found again: the chase a few minutes sooner leads by a point.
  const prev = [{ ...near, lead: true, top: true, score: 30, tags: ['推薦'] }];
  const close = { ...c, arr: near.arr - (CHASE_SWITCH - MIN) };
  const next = [{ ...close, lead: true, top: true, score: 29, tags: ['推薦'], times: [0, 1] }, { ...near, lead: false, score: 30, times: [0, 1] }];
  const kept = steadyLead(next, prev, t0);
  assert.ok(kept[1].lead && kept[1].top && kept[1].tags.includes('推薦') && !chaseOf(kept[1]), 'the near stop still');
  assert.ok(!kept[0].lead);
  assert.equal(kept.length, next.length, 'the list keeps its order');
  // Half an hour sooner: the chase.
  const far = [{ ...c, lead: true, top: true, score: 20, times: [0, 1] }, { ...walk, lead: false, score: 33, times: [0, 1] }];
  assert.ok(steadyLead(far, [{ ...walk, lead: true, top: true }], t0)[0].lead);
  // Shown: the chase. Found again with the near stop a point ahead: the chase still.
  const flip = [{ ...walk, lead: true, top: true, score: 30, times: [0, 1] }, { ...c, lead: false, score: 31, times: [0, 1] }];
  const held = steadyLead(flip, [{ ...c, lead: true, top: true }], t0);
  assert.ok(held[1].lead && chaseOf(held[1]) && !held[0].lead);
  // The chase gone from what's found: the near stop, as found.
  assert.equal(steadyLead([{ ...walk, lead: true, top: true }], [{ ...c, lead: true, top: true }], t0)[0].lead, true);
});
