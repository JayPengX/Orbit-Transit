// A bus come early (its live time 進站中 minutes before the plan's): on it
// as soon as you go its way, never only after the app's reopened (Jay 11-17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, off, start, busTrip, show } from './navsim.mjs';

test('on a bus come early: its live time, not the plan’s, says it can be you on it', () => {
  // (The plan's bus at 08:15; it came at 08:05, the walk to the stop not ended.)
  const { plan, st } = busTrip({ depMin: 15 });
  const t0 = plan.dep;
  clock.set(t0 + 60e3);
  const { st: s } = start(plan);
  // Walking south to the stop (300 m), its last few metres not reached yet.
  for (const x of [280, 220, 160, 100]) {
    clock.add(40e3);
    pos(off(st[1], -x, 0));
  }
  assert.equal(s.i, 0);
  // The bus is here (live), 10 minutes before the plan's time: on it, going its way.
  s.liveAt.set(1, clock.get());
  for (let e = 80; e <= 640; e += 80) {
    clock.add(10e3);
    pos(off(st[1], 0, e));
  }
  assert.deepEqual(show(s), { i: 1, phase: 'on', reached: 1 });
});
