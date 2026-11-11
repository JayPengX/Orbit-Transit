// 用說的查路線 (lib/said.mjs): plain trips read by code, a said time as the moment, your places by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSaid, whenOf, placeNamed, saidFacts } from '../public/lib/said.mjs';

test('a plain trip in code; one with a time left to the AI', () => {
  assert.deepEqual(readSaid('去台北車站'), { from: '', to: '台北車站' });
  assert.deepEqual(readSaid('從家到學校'), { from: '家', to: '學校' });
  assert.deepEqual(readSaid('我要回家'), { from: '', to: '家' });
  assert.deepEqual(readSaid('從這裡去101'), null, 'a number: the AI');
  assert.equal(readSaid('明天早上到台大醫院'), null);
  assert.equal(readSaid('台大醫院'), null);
});

test("a said day and time as Taiwan's moment; one past today is tomorrow's", () => {
  const now = Date.parse('2026-11-11T02:00:00Z'); // 10:00 in Taiwan
  assert.deepEqual(whenOf({ by: 'arrive', day: 1, time: '08:00' }, now), { by: 'arrive', at: Date.parse('2026-11-12T00:00:00Z') });
  assert.deepEqual(whenOf({ by: 'depart', day: 0, time: '09:00' }, now), { by: 'depart', at: Date.parse('2026-11-12T01:00:00Z') });
  assert.deepEqual(whenOf({ by: 'depart', day: 0, time: '15:30' }, now), { by: 'depart', at: Date.parse('2026-11-11T07:30:00Z') });
  assert.deepEqual(whenOf({ by: 'arrive', time: '' }, now), { by: 'now', at: null });
});

test('a later day with no time is that day, not now (明天去台中)', () => {
  const now = Date.parse('2026-11-11T02:00:00Z'); // 10:00 in Taiwan
  assert.deepEqual(whenOf({ by: 'now', day: 1, time: '' }, now), { by: 'depart', at: Date.parse('2026-11-12T02:00:00Z') });
  assert.deepEqual(whenOf({ by: 'depart', day: 2 }, now), { by: 'depart', at: Date.parse('2026-11-13T02:00:00Z') });
  const night = Date.parse('2026-11-11T15:30:00Z'); // 23:30 in Taiwan
  assert.deepEqual(whenOf({ day: 1 }, night), { by: 'depart', at: Date.parse('2026-11-12T00:00:00Z') });
  const early = Date.parse('2026-11-11T18:30:00Z'); // 02:30 on the 12th in Taiwan, still up: 明天 is this morning
  assert.deepEqual(whenOf({ day: 1 }, early), { by: 'depart', at: Date.parse('2026-11-12T00:00:00Z') });
});

test('your places by name; the facts the AI is told', () => {
  const places = [{ name: 'home' }, { name: '臺大醫院' }];
  const zh = n => ({ home: '家' })[n] || n;
  assert.equal(placeNamed(places, '家', zh), places[0]);
  assert.equal(placeNamed(places, '台大醫院', zh), places[1]);
  assert.equal(placeNamed(places, '學校', zh), null);
  assert.deepEqual(saidFacts(Date.parse('2026-11-11T02:00:00Z'), places, zh), { now: '2026-11-11 10:00 週三', places: ['家', '臺大醫院'] });
});
