import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenHeading, eventHeading, fixHeading, unwrap } from '../public/lib/compass.mjs';

test('an iPhone reads webkitCompassHeading; an uncalibrated compass reads nothing', () => {
  assert.equal(eventHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: 10 }), 90);
  assert.equal(eventHeading({ webkitCompassHeading: 90, webkitCompassAccuracy: -1 }), null);
});
test('Android reads an absolute alpha (counter-clockwise) as clockwise from north', () => {
  assert.equal(eventHeading({ absolute: true, alpha: 90 }), 270);
  assert.equal(eventHeading({ absolute: true, alpha: 0 }), 0);
  assert.equal(eventHeading({ absolute: false, alpha: 90 }), null);
});
test('a phone on its side turns the heading by the screen angle', () => {
  assert.equal(screenHeading(350, 90), 80);
  assert.equal(screenHeading(10, -90), 280);
  assert.equal(screenHeading(null, 90), null);
});
test("the GPS's heading only when moving", () => {
  assert.equal(fixHeading({ heading: 45, speed: 3 }), 45);
  assert.equal(fixHeading({ heading: 45, speed: 0.3 }), null);
  assert.equal(fixHeading({ heading: null, speed: 3 }), null);
});
test('the beam turns the short way round (no spin past north)', () => {
  assert.equal(unwrap(350, 10), 370);
  assert.equal(unwrap(10, 350), -10);
  assert.equal(unwrap(null, 30), 30);
});
