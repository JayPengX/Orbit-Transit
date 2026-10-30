import test from 'node:test';
import assert from 'node:assert/strict';
import { wayAlong, railGroups, railWayIn } from '../public/lib/shapes.mjs';

const km = w => w.reduce((s, p, k) => (k ? s + Math.hypot((p[0] - w[k - 1][0]) * 111, (p[1] - w[k - 1][1]) * 101) : 0), 0);
// A straight line north from 25.00 to 25.10 at 121.50 (11 km), as points every ~1 km.
const north = (lon, from = 25.0, to = 25.1) => Array.from({ length: 11 }, (_, i) => [from + ((to - from) * i) / 10, lon]);

test('a ride along its line, not straight: on, along, off', () => {
  const bend = [[25.0, 121.5], [25.05, 121.55], [25.1, 121.5]];
  const w = wayAlong([bend], [25.0, 121.5], [25.1, 121.5]);
  assert.ok(km(w) > 11.5, 'follows the bend');
  // Off every line: nothing (the map draws through the stops).
  assert.equal(wayAlong([bend], [24.0, 120.0], [25.1, 121.5]), null);
});

test('two tracks side by side, joined only at their far ends: each end on the nearer track, the way not round by the far end', () => {
  const up = north(121.5);
  const down = north(121.5004).reverse();
  const w = wayAlong([up, down], [25.02, 121.5004], [25.03, 121.5]);
  assert.ok(km(w) < 2, `${km(w)} km`);
});

test('lines crossing mid-line: a ride on one stays on it; a ring at a station is left out', () => {
  const pack = {
    lines: [
      { sys: 'metro', op: 'X', id: 'R', line: '' },
      { sys: 'metro', op: 'X', id: 'BL', line: '' }
    ]
  };
  // (Encoded lines aren't needed: railGroups is given decoded ones through a stand-in pack.)
  const groups = { lines: [[north(121.5)], [[[25.05, 121.45], [25.05, 121.55]]]], all: [north(121.5), [[25.05, 121.45], [25.05, 121.55]]] };
  const w = railWayIn(groups, [25.05, 121.5], [25.09, 121.5]);
  assert.ok(Math.abs(km(w) - 4.4) < 0.3, `${km(w)} km`);
  assert.ok(pack.lines.length === 2);
  // A ring at a station (a small piece closing on itself) isn't a line to ride.
  const ring = { lines: [{ sys: 'tra', op: 'TRA', id: 'WL', line: encode([[25, 121.5], [25.002, 121.5], [25.002, 121.502], [25, 121.5]]) }] };
  assert.equal(railGroups(ring, 'tra').all.length, 0);
});

test('a line drawn there and back as one piece (TDX\'s 六家線): its tracks, the ride along them, not straight', () => {
  // 六家線 as the weekly pack has it: 竹中 → 六家 on one track and back on the other, closing on itself.
  const lj = [[24.78189, 121.02959], [24.78156, 121.0327], [24.78198, 121.0336], [24.78276, 121.03415], [24.79582, 121.03641], [24.79947, 121.03767], [24.80583, 121.0393], [24.80763, 121.03936], [24.80605, 121.03939], [24.79947, 121.03771], [24.79581, 121.03645], [24.78275, 121.03419], [24.78196, 121.03362], [24.78152, 121.0327], [24.78185, 121.02958]];
  const groups = railGroups({ lines: [{ sys: 'tra', op: 'TRA', id: 'LJ', line: encode(lj) }] }, 'tra');
  assert.equal(groups.all.length, 2);
  // 竹中 to 六家: east out of 竹中 first, then north (3.0 km straight, 3.3 km on the track).
  const w = railWayIn(groups, [24.7819, 121.0297], [24.8076, 121.0394]);
  assert.ok(w && w.length > 4, 'along the track');
  assert.ok(km(w) > 3.2 && km(w) < 3.5, `${km(w)} km`);
  assert.ok(w.some(([, lon]) => lon > 121.033 && lon < 121.035), 'by the bend east of 竹中');
});

// Google's encoding, for the stand-in pack.
function encode(pts) {
  let out = '';
  let [pa, pb] = [0, 0];
  const one = v => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [a, b] of pts) {
    const [x, y] = [Math.round(a * 1e5), Math.round(b * 1e5)];
    one(x - pa);
    one(y - pb);
    [pa, pb] = [x, y];
  }
  return out;
}
