// Whole trips navigated on a phone's rough GPS (tests/gps-run.mjs, the
// simulator public/lib/tripsim.mjs): noise, jumps that still say ±20 m, cell
// fixes, silences of minutes (an iPhone in a pocket) with the old fix handed
// over after, a fast train between sparse fixes. Each judged against where
// the person really was. The whole sweep: scripts/gps-sweep.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './gps-run.mjs';
import { TRIPS } from './gps-trips.mjs';
import { steadyFixes, motion, trainPace, busPace } from '../public/lib/aboard.mjs';
import { arrival } from '../public/lib/nav.mjs';
import { off } from './navsim.mjs';

const ok = (trip, scenario, profile, seed, opts) => {
  const r = run(trip, scenario, profile, seed, opts);
  assert.deepEqual(r.judge, [], `${trip} ${scenario} ${profile} #${seed}${opts?.reopenAt ? ` reopened at ${opts.reopenAt / 1000}s` : ''}`);
  return r;
};

test('every trip, every situation, on a phone in a hand: right all the way', () => {
  for (const trip of Object.keys(TRIPS)) for (const sc of ['plan', 'late', 'miss', 'over', 'early', 'wrong', 'stray']) ok(trip, sc, 'phone', 1);
});

test('as planned, in a city and on a train: never a trouble card, never ended early', () => {
  for (const trip of ['bus', 'train', 'change']) for (const pr of ['city', 'train']) for (const seed of [1, 2]) ok(trip, 'plan', pr, seed);
});

// Each a run that went wrong once (Jay 2026-11-12), kept right.
test('one fix 50 m off saying ±21 m never ends a walk a minute early', () => ok('bus', 'late', 'train', 1));
test('a city jump saying ±23 m never ends a walk 90 m from the door', () => ok('train', 'miss', 'city', 4));
test('one jump up the line after getting off is not "stayed on"', () => ok('train', 'plan', 'city', 6));
test('a train past your station, by the door 30 m off, is not there', () => ok('train', 'over', 'phone', 1));
test('off a train a station early, walking along the line: noticed', () => {
  for (const pr of ['phone', 'city', 'train']) ok('train', 'early', pr, 1);
});
test('a trip to the station itself ends there; staying on past it is noticed', () => {
  const r = ok('station', 'plan', 'phone', 1);
  assert.ok(r.ends.length, 'ended');
  const o = ok('station', 'over', 'train', 2);
  assert.ok(o.acts.some(a => a[0] === 'stayed'));
});
test('下車了 and 搭錯車 never flip back and forth on jumps at a walk', () => ok('train', 'early', 'city', 6));
test('on the wrong bus through a silence of minutes: noticed after', () => ok('bus', 'wrong', 'background', 3));
test('lost, then standing still far off: still lost', () => ok('change', 'wrong', 'background', 4));
test('opened again on the next bus after missing one: not jumped ahead to the train', () => ok('change', 'miss', 'clean', 1, { reopenAt: 1300_000 }));
test('opened again on the wrong bus: noticed', () => ok('train', 'wrong', 'background', 1, { reopenAt: 600_000 }));

test('steadyFixes: a jump between two near fixes is dropped, the newest kept', () => {
  const a = { lat: 24.8, lon: 120.97, acc: 15, t: 0 };
  const f = [a, { ...off(a, 0, 5), t: 3000 }, { ...off(a, 250, 0), acc: 20, t: 6000 }, { ...off(a, 0, 12), t: 9000 }, { ...off(a, 0, 16), t: 12_000 }];
  const s = steadyFixes(f);
  assert.equal(s.length, 4);
  assert.ok(!s.includes(f[2]));
  assert.equal(s.at(-1), f[4]);
});

test('motion: walking with a jump at the end is no ride pace', () => {
  const a = { lat: 24.8, lon: 120.97 };
  const f = [];
  for (let k = 0; k <= 40; k++) f.push({ ...off(a, 0, k * 4), acc: 20, t: k * 3000 });
  f.push({ ...off(a, 300, 160), acc: 25, t: 123_000 });
  const m = motion(f, 123_000);
  assert.ok(m, 'some motion');
  assert.ok(!trainPace(m) && !busPace(m), `walk: avg ${m.avg.toFixed(1)} top ${m.top.toFixed(1)}`);
  // (A bus at 8 m/s is.)
  const b = [];
  for (let k = 0; k <= 20; k++) b.push({ ...off(a, 0, k * 50), acc: 15, t: k * 5000 });
  assert.ok(busPace(motion(b, 100_000)));
});

test('arrival: never on one fix; a second 4 s on, or the same one a minute on', () => {
  const p = { lat: 24.8, lon: 120.97, acc: 10 };
  let a = arrival(null, p, 30, null, 0);
  assert.equal(a.done, false, 'one fix');
  assert.equal(arrival(a.near, p, 30, null, 10_000).done, false, 'the same fix again');
  assert.equal(arrival(a.near, p, 30, null, 61_000).done, true, 'the same fix a minute on');
  assert.equal(arrival(a.near, { ...p, lat: p.lat + 0.00005 }, 28, null, 5000).done, true, 'a second fix');
  a = arrival(null, p, 30, null, 0);
  a = arrival(a.near, { ...p, lat: p.lat + 0.002 }, 220, null, 2000);
  assert.equal(arrival(a.near, p, 30, null, 6000).done, false, 'a far fix between: started over');
});

test('a plan in a minute after the time asked says so (抵達 13:30, in 13:31); navigation keeps its minute', async () => {
  const { lateShown, lateBy } = await import('../public/lib/nav.mjs');
  const dl = Date.parse('2026-11-12T13:30:00+08:00');
  assert.equal(lateShown({ deadline: dl }, dl + 60_000), 1);
  assert.equal(lateShown({ deadline: dl }, dl + 59_000), 0);
  assert.equal(lateShown({ deadline: dl }, dl - 60_000), 0);
  assert.equal(lateBy({ deadline: dl }, dl + 60_000), 0);
  assert.equal(lateShown({}, dl), 0);
});

test('buses by when: a timetabled one in 5 minutes before a live one in 36', async () => {
  const { etaRank } = await import('../public/lib/bus.mjs');
  const now = Date.parse('2026-11-12T13:12:00+08:00');
  const live36 = { status: 0, sec: 36 * 60, more: [] };
  const sched5 = { status: 1, sec: null, next: now + 5 * 60_000, more: [] };
  const sched40 = { status: 1, sec: null, next: now + 40 * 60_000, more: [] };
  const list = [live36, sched40, sched5].sort((a, b) => etaRank(a, now) - etaRank(b, now));
  assert.deepEqual(list, [sched5, live36, sched40]);
  assert.ok(etaRank({ status: 0, sec: 300, more: [] }, now) < etaRank({ status: 1, next: now + 300_000, more: [] }, now), 'live first at the same time');
});
