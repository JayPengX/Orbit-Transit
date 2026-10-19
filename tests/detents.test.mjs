// The map's sheet: its three stops, where a drag lands, who gets the finger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detentHeights, follow, settle, axis, bodyGesture, stepped, PEEK } from '../public/lib/detents.mjs';

test('detents: peek < medium < large on any screen, large leaves the top', () => {
  for (const room of [320, 480, 600, 700, 740, 780, 900, 1200]) {
    const h = detentHeights(room);
    assert.ok(h.peek < h.medium && h.medium < h.large, `${room}: ${JSON.stringify(h)}`);
    assert.ok(h.large <= Math.max(room - 64, 260), `${room}: large leaves the top`);
    assert.ok(h.peek >= 120, `${room}: the search and a shelf's top still fit`);
  }
  const h = detentHeights(740);
  assert.equal(h.peek, PEEK);
  assert.equal(h.large, 740 - 64);
  assert.ok(Math.abs(h.medium - 370) <= 2, 'medium is about half');
  assert.equal(detentHeights(740, { top: 90 }).large, 650, 'the top inset is the caller’s (the safe area)');
});

test('detents: dragging follows the finger with a little slack past the ends', () => {
  const hs = detentHeights(740);
  assert.equal(follow(400, hs), 400);
  assert.ok(follow(hs.large + 100, hs) < hs.large + 20, 'past large: barely');
  assert.ok(follow(hs.large + 100, hs) > hs.large);
  assert.ok(follow(20, hs) >= hs.peek - 28, 'under peek: a little, never lost');
});

test('detents: let go, it lands on the nearest stop, a flick carries it on', () => {
  const hs = detentHeights(740);
  assert.equal(settle(hs.peek + 10, 0, hs), 'peek');
  assert.equal(settle(hs.medium - 20, 0, hs), 'medium');
  assert.equal(settle(hs.large - 30, 0, hs), 'large');
  assert.equal(settle(hs.peek + 60, 0.9, hs), 'medium', 'a flick up from peek goes up a stop');
  assert.equal(settle(hs.medium + 10, -1.2, hs), 'peek', 'a flick down from medium');
  assert.equal(settle(hs.medium + 10, 0.9, hs), 'large');
  assert.equal(settle(hs.large, -0.1, hs), 'large', 'a slow lift of the finger is not a flick');
  assert.equal(settle(hs.peek + 150, 0.3, hs), 'medium', 'projected by its speed');
});

test('detents: the direction a finger goes is read after the slop', () => {
  assert.equal(axis(2, 3), null);
  assert.equal(axis(1, 12), 'v');
  assert.equal(axis(-14, 4), 'h', 'a shelf scrolling sideways keeps its finger');
  assert.equal(axis(8, 8), 'v');
});

test('detents: only the large sheet scrolls, until its top', () => {
  assert.equal(bodyGesture({ detent: 'peek', scrollTop: 0, dy: -20 }), 'sheet');
  assert.equal(bodyGesture({ detent: 'medium', scrollTop: 0, dy: -20 }), 'sheet', 'pulled up: it grows first');
  assert.equal(bodyGesture({ detent: 'medium', scrollTop: 0, dy: 20 }), 'sheet');
  assert.equal(bodyGesture({ detent: 'large', scrollTop: 300, dy: 20 }), 'scroll', 'scrolled: the finger scrolls');
  assert.equal(bodyGesture({ detent: 'large', scrollTop: 0, dy: -20 }), 'scroll');
  assert.equal(bodyGesture({ detent: 'large', scrollTop: 0, dy: 20 }), 'sheet', 'at its top, pulled down: the sheet');
});

test('detents: a tap on the grabber steps up, large goes back down', () => {
  assert.equal(stepped('peek'), 'medium');
  assert.equal(stepped('medium'), 'large');
  assert.equal(stepped('large'), 'medium');
});
