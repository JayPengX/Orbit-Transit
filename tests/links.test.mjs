// Another app's way into a trip (Jay 2026-11-10: Sports' 去球場, Class's
// 出門時間): #plan?to=<lat>,<lon>,<name>[&by=<ISO>] read back as made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planLink, planHash } from '../public/lib/links.mjs';

test('planHash → planLink: the place, its name (commas and all) and the time to be there', () => {
  const at = Date.parse('2026-11-11T18:35:00+08:00');
  const h = planHash({ lat: 24.8073, lon: 120.9689, name: '新竹市立棒球場, 主場' }, at);
  assert.deepEqual(planLink(h), { to: { name: '新竹市立棒球場, 主場', lat: 24.8073, lon: 120.9689 }, at });
  // Hand-made: the name unencoded, no time.
  assert.deepEqual(planLink('#plan?to=25.0478,121.517,臺北車站'), { to: { name: '臺北車站', lat: 25.0478, lon: 121.517 }, at: null });
  // A time with its offset (Taipei's), as Class writes a first class.
  assert.equal(planLink('#plan?to=24.80,120.97,學校&by=2026-11-11T07:50:00%2B08:00').at, Date.parse('2026-11-11T07:50:00+08:00'));
});

test('planLink: not a trip link, or a place outside Taiwan, is nothing; a nameless place is named by where it is', () => {
  assert.equal(planLink('#map'), null);
  assert.equal(planLink('#plan?to=abc'), null);
  assert.equal(planLink('#plan?to=35.68,139.76,東京'), null);
  assert.equal(planLink('#plan?to=24.8,120.97').to.name, '24.8000, 120.9700');
  assert.equal(planLink('#plan?to=24.8,120.97,x&by=soon').at, null);
});

test('the app opens a #plan link on the map, planned from where you are, and leaves the address as #map', () => {
  const app = readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /planLink\(location\.hash\)/);
  assert.match(app, /ctx\.openTrip\(null, l\.to, l\.at && l\.at > Date\.now\(\) \? \{ by: 'arrive', at: l\.at \} : \{\}\)/);
  assert.match(app, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}#map`\)/);
});
