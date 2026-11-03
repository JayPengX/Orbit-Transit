// 目前位置 is never a recent (Jay 2026-11-03): not saved, and wiped from copies that kept it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberTrip, cleanData, emptyData, isHereEnd } from '../public/lib/store.mjs';

test('where you are is never saved to 最近', () => {
  const list = [{ name: '新竹車站', lat: 24.8016, lon: 120.9716, t: 1 }];
  assert.deepEqual(rememberTrip(list, { name: '目前位置', lat: 24.8, lon: 120.97 }), list);
  assert.deepEqual(rememberTrip(list, { here: true, name: 'x', lat: 24.8, lon: 120.97 }), list);
  assert.deepEqual(rememberTrip(list, { name: 'Here', lat: 24.8, lon: 120.97 }), list);
  assert.equal(rememberTrip(list, { name: '竹北', lat: 24.83, lon: 121.0 }).length, 2);
});

test('a 目前位置 kept before is dropped when the data is read', () => {
  const d = { ...emptyData(), trips: [{ name: '目前位置', lat: 24.8, lon: 120.97, t: 2 }, { name: '學校', lat: 24.81, lon: 120.98, t: 1 }] };
  const out = cleanData(d);
  assert.deepEqual(out.trips.map(x => x.name), ['學校']);
  assert.equal(isHereEnd({ name: '學校' }), false);
});
