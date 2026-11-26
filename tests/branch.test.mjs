// 換條分支 (Jay 11-26): under way, the trip's other ways that share the part
// behind you are offered and taken; one that parted behind you never is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { branchOf, branchesOf, keepBranches } from '../public/lib/branch.mjs';

const T = Date.parse('2026-11-26T17:00:00+08:00');
const m = k => T + k * 60_000;
const P = {
  here: { name: '新竹高中', lat: 24.7956, lon: 120.9789 },
  hc: { name: '新竹', lat: 24.8016, lon: 120.9717 },
  zz: { name: '竹中', lat: 24.7807, lon: 121.0310 },
  lj: { name: '六家', lat: 24.8075, lon: 121.0402 },
  stop: { name: '縣體育場', lat: 24.8180, lon: 121.0270 },
  end: { name: '縣體育場', lat: 24.8180, lon: 121.0270 }
};
const walk = (from, to, a, b) => ({ mode: 'walk', from, to, dep: m(a), arr: m(b) });
const train = (to, b) => ({ mode: 'tra', name: '區間', train: { no: '1231' }, from: P.hc, to, dep: m(10), arr: m(b) });
const viaZz = { dep: m(0), arr: m(40), legs: [walk(P.here, P.hc, 0, 8), train(P.zz, 22), { mode: 'bike', from: P.zz, to: P.end, dep: m(24), arr: m(40) }] };
const viaLj = { dep: m(0), arr: m(38), legs: [walk(P.here, P.hc, 0, 8), train(P.lj, 25), { mode: 'bus', name: '1', from: P.lj, to: P.stop, dep: m(30), arr: m(36) }, walk(P.stop, P.end, 36, 38)] };
const byBus = { dep: m(0), arr: m(45), legs: [walk(P.here, P.stop, 0, 45)] };

test('on the same train: the other station to get off at is a branch, till the train is past it', () => {
  const b = branchOf(viaZz, 1, viaLj, m(15));
  assert.equal(b.kind, 'off');
  assert.equal(b.n, 1);
  assert.equal(b.at, '六家');
  // (Its train already at 六家: too late.)
  assert.equal(branchOf(viaZz, 1, viaLj, m(25)), null);
});

test('a way that parted behind you (another start) is never a branch', () => {
  assert.equal(branchOf(viaZz, 1, byBus, m(15)), null);
  assert.deepEqual(keepBranches(viaZz, [viaZz, viaLj, byBus]).map(x => x.arr), [m(38)]);
});

test('kept with the plan, listed soonest first; the same way never', () => {
  const p = { ...viaZz, branches: keepBranches(viaZz, [viaZz, viaLj, byBus]) };
  const list = branchesOf(p, 0, m(5));
  assert.equal(list.length, 1);
  assert.equal(list[0].arr, m(38));
  assert.equal(branchesOf({ ...viaZz, branches: [{ legs: viaZz.legs, arr: viaZz.arr }] }, 0, m(5)).length, 0);
});
