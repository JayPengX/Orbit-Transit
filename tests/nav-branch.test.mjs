// 換條分支 under way (Jay 11-26): on the bus, the branch that gets off at an
// earlier stop is taken: the ride now ends there, the rest is the branch's,
// and the way left is offered back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, off, start, busTrip } from './navsim.mjs';
const { navBranches, navBranch, stopNav } = await import('../public/lib/nav.mjs');

const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(r => setImmediate(r));
};

test('on the bus, off at another stop instead: taken, and the old way kept as a branch', async () => {
  const { plan, st } = busTrip();
  const bus = plan.legs[1];
  const L = s => ({ name: s.name, lat: s.lat, lon: s.lon });
  const other = {
    dep: plan.dep,
    arr: bus.dep + 9 * 60e3,
    legs: [plan.legs[0], { ...bus, to: L(st[3]), arr: bus.dep + 4 * 60e3, path: st.slice(1, 4).map(s => [s.lat, s.lon]) }, { mode: 'walk', from: L(st[3]), to: plan.dest, dep: bus.dep + 4 * 60e3, arr: bus.dep + 9 * 60e3 }]
  };
  plan.branches = [{ legs: other.legs, dep: other.dep, arr: other.arr }];
  const now = bus.dep + 60e3;
  clock.set(now);
  const { st: s } = start(plan, { here: { ...off(st[1], 0, 300), at: now } });
  await settle();
  const list = navBranches(now);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'off');
  assert.ok(navBranch(list[0]));
  await settle();
  assert.equal(s.plan.legs[1].to.name, '站3');
  assert.equal(s.plan.legs.length, 3);
  assert.equal(s.plan.arr, other.arr);
  // (Back the other way: the bus to 站5 offered.)
  assert.equal(navBranches(now)[0]?.at, '站5');
  stopNav();
});
