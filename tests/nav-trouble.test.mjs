// 出狀況 under way, one card (trouble.mjs; Jay 2026-11-06: "we never really
// design flow to deal with if you can't catch a bus or you go on the wrong
// bus … there's two approach, either go for the same bus or go for the
// fastest option"; "not limited to bus though"). Driven fix by fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clock, pos, off, T, start, busTrip, show, box, log } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');
const { troubleHtml, wrongRide } = await import('../public/lib/trouble.mjs');

const settle = async () => {
  for (let n = 0; n < 60; n++) await new Promise(r => setImmediate(r));
};
const topHtml = () => box.querySelector('.ot-nav-topw').innerHTML;
const topText = () => topHtml().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
// A tap on what carries data-nav="<a>".
const tap = (s, a) => box.onclick({ target: { closest: sel => (sel === '[data-nav]' ? { dataset: { nav: a } } : null) } });

// A line east (A, B, C, D, 3 km apart); trains 1001 at 08:10 and 1003 at 08:40.
const sts = ['A', 'B', 'C', 'D'].map((k, n) => ({ key: `tra:${k}`, sys: 'tra', name: k + '站', ...off({ lat: 24.8, lon: 120.97 }, 0, n * 3000) }));
const run = (no, t0) => ({ sys: 'tra', no, type: '區間', stops: sts.map((s, n) => ({ st: s.key, arr: t0 + n * 4 * 60e3, dep: t0 + n * 4 * 60e3 + 30e3 })) });
const S = n => ({ name: sts[n].name, lat: sts[n].lat, lon: sts[n].lon });
function trainTrip() {
  nav.useRail({ dayTrips: async () => [run('1001', T(8, 10) - 30e3), run('1003', T(8, 40) - 30e3)], railStations: async () => sts, traLive: async () => new Map() });
  const home = { name: 'Home', ...off(sts[0], 0, -300) };
  const dest = { name: 'Dest', ...off(sts[3], 300, 0) };
  const legs = [
    { mode: 'walk', from: home, to: S(0), dep: T(8), arr: T(8, 5), dur: 300 },
    { mode: 'tra', name: '區間', short: '區間 1001', train: { no: '1001', type: '區間' }, from: S(0), to: S(3), dep: T(8, 10), arr: T(8, 22), dur: 720, path: sts.map(s => [s.lat, s.lon]) },
    { mode: 'walk', from: S(3), to: dest, dep: T(8, 22), arr: T(8, 27), dur: 300 }
  ];
  return { plan: { legs, dep: T(8), arr: T(8, 27), dest }, home, dest };
}
// 最快 as the planner would hand it: a bus from where you are.
const quick = (arr, dest) => ({ lead: true, dep: clock.get(), arr, legs: [{ mode: 'bus', short: '2', name: '2', from: { name: 'X', lat: 24.81, lon: 120.98 }, to: dest, dep: clock.get() + 60e3, arr, dur: 600 }] });

test('a train missed at the station: the next one taken by itself, then one card: 下一班 (ticked) and 最快, each with when you are there; 最快 is a tap', async () => {
  const { plan, dest } = trainTrip();
  clock.set(T(8, 13));
  const { st: s, acts } = start(plan, { resume: { i: 1, phase: 'before', reached: 1 } });
  pos(off(sts[0], 20, 0));
  await settle();
  assert.equal(String(s.plan.legs[1].train.no), '1003', 'the next train taken');
  assert.ok(acts.some(([a]) => a === 'fastest'), '最快 asked for');
  // (Not whole yet: the card waits for 最快, the line says what changed.)
  s.render();
  assert.doesNotMatch(topHtml(), /ot-trouble/);
  assert.match(topText(), /沒趕上/);
  nav.navBest(quick(T(8, 50), dest));
  assert.match(topHtml(), /class="ot-trouble"/);
  assert.match(topText(), /趕不上 台鐵 區間 1001 次/);
  // (08:56: 1003 gets to D站 at 08:51:30 by its timetable, the walk 5 minutes after it.)
  assert.match(topText(), /下一班 08:40 開 08:56 到/);
  assert.match(topHtml(), /ot-trouble-row on/, 'the one taken ticked');
  assert.match(topText(), /最快・2 08:50 到/);
  assert.doesNotMatch(topText(), /沒趕上 台鐵/, 'said once, on the card');
  // Steps move only by GPS: the card changes nothing by itself.
  assert.deepEqual(show(s), { i: 1, phase: 'before', reached: 1 });
  tap(s, 'tr-best');
  const take = acts.find(([a]) => a === 'take');
  assert.equal(take?.[1].arr, T(8, 50));
  nav.useRail({});
});

test('late for the train on the way (hurrying can’t make it): 下一班 to tap and 最快; nothing quicker, 下一班 alone; a tap takes it', async () => {
  const { plan, home } = trainTrip();
  clock.set(T(8, 8));
  // (The phone's last fix is home's, not the last test's at the station.)
  nav.stopNav();
  pos(off(home, 0, 10));
  const { st: s, acts } = start(plan, { resume: { i: 0, phase: 'before', reached: 0 } });
  // Still at home at 08:08: 4 minutes on foot, the 08:10 gone by then.
  pos(off(home, 0, 10));
  s.render();
  await settle();
  assert.ok(acts.some(([a]) => a === 'fastest'));
  assert.equal(s.plan.legs[1].dep, T(8, 10), 'nothing taken by itself before it’s gone');
  nav.navBest(quick(T(9, 30), plan.dest));
  assert.match(topText(), /下一班 08:40 開/);
  assert.doesNotMatch(topText(), /最快/, 'later than 下一班: not offered');
  assert.doesNotMatch(topHtml(), /ot-trouble-row on/);
  tap(s, 'tr-next');
  assert.equal(String(s.plan.legs[1].train.no), '1003');
  assert.doesNotMatch(topHtml(), /ot-trouble/);
  nav.useRail({});
});

test('on the wrong bus: at the stop, then off at a bus’s pace the other way: 好像搭錯車了？ with 從這裡重新規劃 (planned from that ride), buzzed once', async () => {
  const { plan, st } = busTrip();
  clock.set(plan.legs[1].dep - 60e3);
  const { st: s, acts } = start(plan, { resume: { i: 1, phase: 'before', reached: 1 } });
  pos(off(st[1], 5, 0));
  clock.add(20e3);
  pos(off(st[1], 5, 0));
  const buzzes = log.length;
  for (let n = 1; n <= 12; n++) {
    clock.add(5e3);
    pos(off(st[1], n * 50, 0));
  }
  assert.equal(s.phase, 'before', 'not on the planned bus');
  assert.match(topText(), /好像搭錯車了/);
  assert.equal(log.length - buzzes, 1);
  tap(s, 'replan');
  assert.deepEqual(acts.find(([a]) => a === 'replan')?.[1], { aboard: true });
});

test('on the right bus (along its way at its pace): on board, never asked about the wrong one', () => {
  const { plan, st } = busTrip();
  clock.set(plan.legs[1].dep - 60e3);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'before', reached: 1 } });
  pos(off(st[1], 5, 0));
  for (let n = 1; n <= 12; n++) {
    clock.add(5e3);
    pos(off(st[1], 0, n * 50));
  }
  assert.equal(s.phase, 'on');
  assert.doesNotMatch(topText(), /搭錯車/);
});

test('on board and off its way at speed: the wrong bus (a branch, the other way), not 好像已經下車了', () => {
  const { plan, st, rs } = busTrip();
  clock.set(plan.legs[1].dep + 2 * 60e3);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  for (const x of [100, 200, 300, 400]) {
    clock.add(10e3);
    pos(off(st[1], 0, x));
  }
  for (let n = 1; n <= 14; n++) {
    clock.add(5e3);
    pos(off(st[1], n * 45, 400));
  }
  s.render();
  assert.match(topText(), /好像搭錯車了/);
});

test('the card: rows fit one line each (short words, the time apart), a late time said as late', () => {
  const t = { kind: 'miss', ride: '公車 快捷8號支', mode: 'bus', next: { dep: T(8, 57), arr: T(9, 48), taken: true }, best: { dep: T(8, 40), arr: T(9, 31), legs: [{ mode: 'bike', from: {}, to: {} }] } };
  const h = troubleHtml(t, T(8, 40), T(9, 40));
  assert.match(h, /下一班 08:57 到站/);
  assert.match(h, /晚 8 分/);
  assert.match(h, /最快・YouBike/);
  assert.match(h, /09:31 到/);
  for (const row of h.match(/<span>[^<]*<\/span>/g)) assert.ok(row.replace(/<[^>]+>/g, '').length <= 14, row);
  // Nothing to choose: the next run taken, nothing quicker: no card (the line above says it).
  assert.equal(troubleHtml({ ...t, best: null }), '');
  // Not whole yet: not shown.
  assert.equal(troubleHtml({ ...t, best: undefined }), '');
  // No next run (the last one gone, the metro), nothing found: 重新規劃.
  assert.match(troubleHtml({ ...t, next: null, best: null }), /data-nav="replan"/);
});

test('wrongRide: only after being at its stop, at a ride’s pace, away from it and off its way', () => {
  const S0 = { lat: 24.8, lon: 120.97 };
  const l = { mode: 'bus', from: S0, to: off(S0, 0, 3000) };
  const now = T(8);
  const fixes = Array.from({ length: 12 }, (_, n) => ({ ...off(S0, (n + 1) * 50, 0), t: now - (11 - n) * 5e3 }));
  assert.equal(wrongRide(l, fixes, now - 70e3, false, now), true);
  assert.equal(wrongRide(l, fixes, 0, false, now), false, 'never at its stop: another trip');
  assert.equal(wrongRide(l, fixes, now - 70e3, true, now), false, 'on its way: that is boarding it');
  const walk = fixes.map((f, n) => ({ ...off(S0, (n + 1) * 7, 0), t: f.t }));
  assert.equal(wrongRide(l, walk, now - 70e3, false, now), false, 'at a walk');
});

test('never pushed further on: navigation offers no YouBike to a stop further on, and a replan under way never plans one (Jay 2026-11-06)', () => {
  const src = f => readFileSync(new URL(`../public/lib/${f}`, import.meta.url), 'utf8');
  assert.doesNotMatch(src('nav.mjs'), /chase\.mjs|騎車追上/);
  const map = src('tab-map.mjs');
  assert.match(map, /noChase: true/);
  assert.match(map.slice(map.indexOf('async function navFastest')), /chase: false/);
  assert.match(src('planner.mjs'), /if \(chase && modes\.bike/);
});
