// Moved 5 km (新竹車站 → 竹北) with the network slow: past NEAR_WAIT_MS the
// shelves drew with 新竹車站's buses still under 附近, "130 公尺" away.
// home.mjs's reads live in createHome (a page): read from its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/lib/home.mjs', import.meta.url), 'utf8');

test('附近 never shows the stops of a place left behind while the new ones are slow', () => {
  const i = src.indexOf('async function readStops(');
  const body = src.slice(i, src.indexOf('\n  }\n', i));
  const late = body.slice(body.indexOf('await inTime(read)'));
  assert.match(late, /if \(!done && nearMoved\(S\.near, h\)\) S\.stops = \[\];/);
  assert.ok(late.indexOf('nearMoved') < late.indexOf('S.stops ||= []'), 'cleared before the shelf is let draw');
});
