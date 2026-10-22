// Navigation shrunk to its bar (or the app away) and back: the trip went on
// meanwhile, and it's exactly where you are now (the owner, 2026-10-22: back
// from the bar, a bunch of weird things).
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, tick, off, start, busTrip, show, log, box } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

test('shrunk on the bus, through your stop and off it: back, you are on the walk, the steps behind done, the buzzes not again', () => {
  const { plan, st, rs } = busTrip();
  clock.set(plan.legs[1].dep + 2 * 60e3);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  nav.setNavMin(true);
  for (let x = 300; x <= 1600; x += 100) {
    clock.add(15e3);
    pos(off(st[1], 0, x));
  }
  const buzzes = log.filter(x => x[0] === 'buzz').length;
  nav.setNavMin(false);
  assert.deepEqual(show(s), { i: 2, phase: 'before', reached: 2 });
  assert.equal(nav.navNow().min, false);
  tick(5000);
  assert.equal(log.filter(x => x[0] === 'buzz').length, buzzes, 'no buzz again for coming back');
  // (The steps' row scrolled to the step you're at again.)
  assert.equal(box.querySelector('.ot-nav-chips')._on, 2);
});

test('shrunk and the app reopened from its saved ride: on where it had got to, shrunk as it was', () => {
  const { plan, st, rs } = busTrip();
  clock.set(plan.legs[1].dep + 2 * 60e3);
  const { st: s } = start(plan, { resume: { i: 1, phase: 'on', reached: 1 } });
  s.ride.set(1, rs);
  pos(off(st[1], 0, 400));
  nav.setNavMin(true);
  const saved = nav.savedNav();
  assert.equal(saved.i, 1);
  assert.equal(saved.phase, 'on');
  assert.equal(saved.min, true);
  const { st: again } = start(saved.plan, { resume: { i: saved.i, phase: saved.phase, reached: saved.reached, min: saved.min }, here: { ...off(st[1], 0, 500), at: clock.get() } });
  assert.deepEqual(show(again), { i: 1, phase: 'on', reached: 1 });
  assert.equal(nav.navNow().min, true);
});

test('looked ahead to a later step, shrunk, back after a while: on the step you are at, not the one looked at', () => {
  const { plan, O } = busTrip();
  clock.set(plan.dep);
  const { st: s } = start(plan, { here: { ...O, at: plan.dep } });
  s.go(2);
  s.lookAt = clock.get();
  nav.setNavMin(true);
  tick(25_000);
  nav.setNavMin(false);
  assert.equal(s.i, 0);
});
