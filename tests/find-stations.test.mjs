import test from 'node:test';
import assert from 'node:assert/strict';
import { findStations } from '../public/lib/rail.mjs';

const st = (name, en, cls, sys = 'tra') => ({ key: `${sys}:${name}`, sys, id: name, name, en, cls });
const list = [st('竹中', 'Zhuzhong', '3'), st('竹北', 'Zhubei', '1'), st('新竹', 'Hsinchu', '1'), st('北新竹', 'North Hsinchu', '3'), st('竹南', 'Zhunan', '1'), st('新竹', 'Hsinchu', '0', 'hsr'), st('臺北', 'Taipei', '0')];

test('a character or two finds the station: names starting with it first, the big stations first', () => {
  assert.deepEqual(findStations(list, '竹').map(s => s.name), ['竹北', '竹南', '竹中', '新竹', '新竹', '北新竹']);
  assert.deepEqual(findStations(list, '竹北站').map(s => s.name), ['竹北']);
  // 台 or 臺, either.
  assert.deepEqual(findStations(list, '台北').map(s => s.name), ['臺北']);
  // English too.
  assert.deepEqual(findStations(list, 'zhub').map(s => s.name), ['竹北']);
  assert.deepEqual(findStations(list, 'hsinchu').map(s => s.key), ['hsr:新竹', 'tra:新竹', 'tra:北新竹']);
  assert.deepEqual(findStations(list, '  '), []);
});
