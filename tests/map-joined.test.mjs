import test from 'node:test';
import assert from 'node:assert/strict';
import { joinedPath } from '../public/lib/util.mjs';

// Jay 11-26, at 六家: the YouBike ride's line began on the road, apart from the dock and the walk to it.
test("a stretch's line starts where the one before it ended and reaches its own stop", () => {
  const dock = { lat: 24.8086, lon: 121.0400 };
  const road = [[24.8087, 121.0403], [24.8090, 121.0410]];
  const out = joinedPath(road, { from: dock, to: { lat: 24.8091, lon: 121.0411 } }, [24.8086, 121.0400]);
  assert.deepEqual(out[0], [24.8086, 121.0400]);
  assert.deepEqual(out.at(-1), [24.8091, 121.0411]);
  // (A real gap, a kilometre: left as it is.)
  assert.deepEqual(joinedPath(road, { from: { lat: 24.82, lon: 121.04 } }, [24.82, 121.04])[0], road[0]);
});
