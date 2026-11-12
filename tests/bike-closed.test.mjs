// A closed YouBike station (ServiceStatus not 1): its counts greyed and no
// 借車計時 on its card (there's no bike to take there); 附近 says 暫停租借.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bikeStats } from '../public/lib/look.mjs';

test('a closed station: counts greyed, no timer to start on its card', () => {
  assert.match(bikeStats({ bikes: 33, ebike: 0, ret: 11, ok: false }), /class="ot-bstats off"/);
  assert.doesNotMatch(bikeStats({ bikes: 33, ebike: 0, ret: 11, ok: true }), /ot-bstats off/);
  const src = readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');
  const i = src.indexOf('function rentButtons(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(body, /closed \? '' : `<button[^`]*rent-start/, '借車計時 only where it is open');
});
