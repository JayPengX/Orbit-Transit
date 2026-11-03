// A trip's icon is about the trip, never its bus's badge (Jay 2026-11-03).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tripIconKey } from '../public/lib/look.mjs';

test('a trip ends at a saved place: that place', () => {
  assert.equal(tripIconKey('上學', { icon: 'school' }), 'school');
  assert.equal(tripIconKey('隨便', { icon: 'home' }), 'home');
});
test('else its name says', () => {
  assert.equal(tripIconKey('上學', null), 'school');
  assert.equal(tripIconKey('回家', null), 'home');
  assert.equal(tripIconKey('放學', null), 'home');
  assert.equal(tripIconKey('上班', null), 'work');
});
test('else a day trip a calendar, else a route', () => {
  assert.equal(tripIconKey('看展', null, true), 'calendar');
  assert.equal(tripIconKey('看展', null), 'route');
  assert.equal(tripIconKey('看展', { icon: 'star' }), 'star');
});
