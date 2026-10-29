import test from 'node:test';
import assert from 'node:assert/strict';
import { bikeTrip, bikeOnly } from '../public/lib/plan.mjs';

// 偏好電輔車 (the plans card's ⚡): of two stations about as near, the one with 電輔車 there now.
const at = { name: '家', lat: 24.8, lon: 120.97 };
const to = { name: '清大', lat: 24.794, lon: 120.993 };
const st = (uid, lat, lon, bikes, ebike) => ({ uid, name: uid, lat, lon, bikes, ebike, ret: 10, ok: true });
const bikes = [st('near', 24.8003, 120.9702, 12, 0), st('ebike', 24.8009, 120.9706, 3, 4), st('far-e', 24.8045, 120.966, 0, 9), st('end', 24.7942, 120.9928, 5, 5)];
const ride = legs => legs.find(l => l.mode === 'bike');

test('without the preference: the nearest station, a plain YouBike', () => {
  const r = ride(bikeTrip(at, to, bikes, 0, { first: true }));
  assert.equal(r.rent.uid, 'near');
  assert.equal(r.ebike, false);
});

test('preferring 電輔車: the one about as near with some, ridden faster; never one far off for it', () => {
  const plain = ride(bikeTrip(at, to, bikes, 0, { first: true }));
  const r = ride(bikeTrip(at, to, bikes, 0, { first: true, prefer: true }));
  assert.equal(r.rent.uid, 'ebike');
  assert.equal(r.ebike, true);
  assert.ok(r.dur < plain.dur);
  // (Only the far station has 電輔車: the near one's YouBike stays.)
  const r2 = ride(bikeTrip(at, to, bikes.filter(s => s.uid !== 'ebike'), 0, { first: true, prefer: true }));
  assert.equal(r2.rent.uid, 'near');
  assert.equal(r2.ebike, false);
});

test('all the way by bike, preferring 電輔車: one way, by 電輔車', () => {
  const ways = bikeOnly(at, to, bikes, 0, { prefer: true });
  assert.equal(ways.length, 1);
  assert.ok(ways[0].legs.some(l => l.ebike));
});
