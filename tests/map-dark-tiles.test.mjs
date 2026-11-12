// Dark mode turns Taiwan's light NLSC map dark with a filter on each tile, not
// on the tile layer: Safari on a laptop-sized map drew the layer's filter not at
// all (a light map in dark mode, 2026-11-12, WebKit at 1280×800).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/transit.css', import.meta.url), 'utf8');

test('the NLSC map is turned dark tile by tile, never on the layer', () => {
  assert.match(css, /\.ot-tiles \.leaflet-tile \{\s*filter: invert/);
  assert.doesNotMatch(css, /\.ot-tiles \{\s*filter/);
});
