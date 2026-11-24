// The bus you're waiting for on the map (Jay 2026-11-24: "bus live location during a trip …
// where the bus is at right now", "the bus may be far"): navlive.mjs pickBus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBus } from '../public/lib/navlive.mjs';

const now = Date.parse('2026-11-24T18:00:00+08:00');
// A way north: a stop every ~550 m; you wait at stop 6.
const stops = Array.from({ length: 10 }, (_, k) => ({ uid: `s${k}`, name: `站${k}`, lat: 24.8 + k * 0.005, lon: 120.97 }));
const fix = (plate, lat, dir = 0, ago = 20_000) => ({ PlateNumb: plate, Direction: dir, BusPosition: { PositionLat: lat, PositionLon: 120.9702 }, GPSTime: new Date(now - ago).toISOString() });

test('the bus coming to your stop: this way, fresh, on its stops, behind you; the one the estimates name first', () => {
  const rows = [fix('A-1', 24.8 + 2 * 0.005), fix('B-2', 24.8 + 5 * 0.005), fix('C-3', 24.8 + 8 * 0.005), fix('D-4', 24.8 + 5.1 * 0.005, 1)];
  // Nearest behind you (stop 5), not the one past you (8), nor the other way's.
  const b = pickBus(rows, 0, stops, 6, null, now);
  assert.deepEqual([b.plate, b.idx, b.away], ['B-2', 5, 1]);
  // The estimates say the coming one is the bus before stop 3: that one, far as it is.
  assert.equal(pickBus(rows, 0, stops, 6, 3, now).plate, 'A-1');
  assert.equal(pickBus(rows, 0, stops, 6, 3, now).away, 4);
});

test('no bus to show: an old fix, one off the route, or none', () => {
  assert.equal(pickBus([fix('A-1', 24.81, 0, 5 * 60_000)], 0, stops, 6, null, now), null, 'five minutes old');
  assert.equal(pickBus([{ ...fix('A-1', 24.81), BusPosition: { PositionLat: 24.81, PositionLon: 121.1 } }], 0, stops, 6, null, now), null, 'kilometres off its stops');
  assert.equal(pickBus([], 0, stops, 6, null, now), null);
});
