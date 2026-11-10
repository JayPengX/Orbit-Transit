// 全部 in 查時刻's bus search (Jay 2026-11-10: "a 全部 pill so I can … search
// any bus in any county/city in one go"): every place's routes in one list,
// the same name in many places, yours first among matches as good.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoutes } from '../public/lib/bus.mjs';

const r = (city, name, from = '', to = '') => ({ uid: `${city}:${name}`, city, name, from, to });
const list = [r('Taipei', '1'), r('Hsinchu', '1'), r('HsinchuCounty', '1'), r('Hsinchu', '10'), r('Kaohsiung', '紅1'), r('Taipei', '藍1', '捷運市政府站', '中研院')];

test('findRoutes: among matches as good, the rank given first (your city before the rest); a better match still leads', () => {
  const order = ['Hsinchu', 'HsinchuCounty', 'InterCity', 'Taipei', 'Kaohsiung'];
  const found = findRoutes(list, '1', 60, x => order.indexOf(x.city));
  assert.deepEqual(found.map(x => x.uid), ['Hsinchu:1', 'HsinchuCounty:1', 'Taipei:1', 'Hsinchu:10', 'Taipei:藍1', 'Kaohsiung:紅1']);
});

test('findRoutes with no rank: as before, by name', () => {
  assert.deepEqual(findRoutes(list, '1').slice(0, 3).map(x => x.name), ['1', '1', '1']);
  assert.deepEqual(findRoutes(list, '中研院').map(x => x.uid), ['Taipei:藍1']);
});
