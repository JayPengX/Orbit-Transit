// One account, many places (Jay 2026-11-13: a trip started in Orbit wasn't in
// the Transit app): the trip being navigated, the rental's timer and the bus
// alerts go to the Pass from the place that runs Transit, and the place that
// takes it over picks up the newer of each.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const U = await import('../public/lib/underway.mjs');

function session({ live = true } = {}) {
  const puts = [];
  const on = {};
  return { puts, on: (ev, f) => (on[ev] = f), emit: (ev, x) => on[ev]?.(x), canSave: live, putNow: (key, v, at, opts) => puts.push({ key, v, at, until: opts?.until }) };
}

test('a change here goes up with its time, once the Pass is heard; a paused copy’s never does', () => {
  const q = session();
  U.useUnderWay(q);
  U.changed('nav', { i: 0 });
  assert.equal(q.puts.length, 0, 'not before the Pass is heard');
  q.emit('claim', { ok: true });
  assert.deepEqual(q.puts.map(p => p.v), [{ i: 0 }], 'heard (a claim without a shelf): sent');
  q.puts.length = 0;
  U.changed('nav', { plan: { legs: [1], arr: 9 }, i: 1, later: Promise.resolve() });
  assert.equal(q.puts.length, 1);
  assert.deepEqual(q.puts[0].v, { plan: { legs: [1], arr: 9 }, i: 1 }, 'JSON only: a promise left out');
  U.changed('nav', null);
  assert.equal(q.puts[1].v, null, 'an end is a change too');
  const paused = session({ live: false });
  U.useUnderWay(paused);
  U.changed('nav', { i: 2 });
  assert.equal(paused.puts.length, 0, 'another place runs it: its own is newer');
});

test('the Pass’s newer one is taken up here (and never sent back); one newer here is sent up again', () => {
  const q = session();
  U.useUnderWay(q);
  q.emit('now', {});
  const taken = [];
  let mine = { i: 0 };
  U.underWay('trip-test', { now: () => mine, take: v => (taken.push(v), U.changed('trip-test', v)) });
  U.changed('trip-test', mine);
  const at = JSON.parse(store.get('ot.now.v1'))['trip-test'];
  q.puts.length = 0;
  U.fromPass({ 'trip-test': { v: { i: 3 }, at: at + 5000 } });
  assert.deepEqual(taken, [{ i: 3 }]);
  assert.equal(q.puts.length, 0, 'taken, not sent back');
  // Older on the Pass than here (this place's last write never got through): sent up again.
  mine = { i: 4 };
  U.changed('trip-test', mine);
  q.puts.length = 0;
  U.fromPass({ 'trip-test': { v: { i: 3 }, at: 1 } });
  assert.equal(taken.length, 1);
  assert.deepEqual(q.puts.map(p => p.v), [{ i: 4 }]);
  // Ended there after here: ended here.
  U.fromPass({ 'trip-test': { v: null, at: Date.now() + 60_000 } });
  assert.equal(taken.at(-1), null);
});

test('an opening reads the Pass before it writes: an old ride taken up again gives way to an end made elsewhere', () => {
  const taken = [];
  let mine = { i: 1 };
  U.underWay('ride-test', { now: () => mine, take: v => (taken.push(v), (mine = v)) });
  const a = session();
  U.useUnderWay(a);
  a.emit('now', {});
  U.changed('ride-test', mine);
  const sent = JSON.parse(store.get('ot.now.v1'))['ride-test'];
  // Ended in the other app since; this one opens again and takes up the ride it kept.
  const b = session();
  U.useUnderWay(b);
  U.changed('ride-test', { i: 1 });
  assert.equal(b.puts.length, 0);
  b.emit('now', { 'ride-test': { v: null, at: sent + 60_000 } });
  assert.deepEqual(taken, [null], 'ended here too');
  assert.equal(b.puts.filter(p => p.key === 'ride-test').length, 0, 'the old one never sent over the end');
  // Nothing newer there: what was taken up here goes up.
  const c = session();
  U.useUnderWay(c);
  U.changed('ride-test', { i: 2 });
  c.emit('now', { 'ride-test': { v: null, at: sent + 60_000 } });
  assert.deepEqual(c.puts.filter(p => p.key === 'ride-test').map(p => p.v), [{ i: 2 }]);
});

test('each goes up with when it ends by itself (Orbit opens on the app with something under way); an end with none', () => {
  U.underWay('timer-test', { now: () => null, take: () => {}, until: v => v.at + 1000 });
  const q = session();
  U.useUnderWay(q);
  q.emit('now', {});
  U.changed('timer-test', { at: 5 });
  U.changed('timer-test', null);
  assert.deepEqual(q.puts.filter(p => p.key === 'timer-test').map(p => p.until), [1005, undefined]);
});

test('a very long plan goes up without its drawn roads (found again on the way)', () => {
  const legs = Array.from({ length: 4 }, (_, i) => ({ mode: 'walk', i, road: true, path: Array.from({ length: 6000 }, () => [24.8, 121.0]) }));
  const out = U.passCopy({ plan: { legs }, i: 0 });
  assert.equal(out.plan.legs.length, 4);
  assert.equal(out.plan.legs[0].path, undefined);
  assert.equal(out.plan.legs[0].road, undefined);
  assert.equal(out.plan.legs[2].i, 2);
  const small = U.passCopy({ plan: { legs: [{ path: [[1, 2]], road: true }] } });
  assert.deepEqual(small.plan.legs[0].path, [[1, 2]], 'a usual plan goes whole');
});
