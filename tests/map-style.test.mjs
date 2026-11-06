// Google's map, light and dark: Google's own bus stops stay off (ours are the
// ones with live times; before 2026-11-06 the light map had no style at all
// and showed Google's grey stops beside ours).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStyles } from '../public/lib/map.mjs';

for (const dark of [false, true])
  test(`${dark ? 'dark' : 'light'}: Google's bus stops are off`, () => {
    assert.ok(mapStyles(dark).some(s => s.featureType === 'transit.station.bus' && !s.elementType && s.stylers.some(x => x.visibility === 'off')));
  });
