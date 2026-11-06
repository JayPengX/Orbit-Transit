import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { steadyPlans, samePlanAt } from '../public/lib/steady.mjs';

// Trip results never reshuffle under the person (Jay 2026-11-06: "the trip
// flicker … it update the trip in front of me which is bad"; "the first show
// is the final result"): the plans card and 交通's trip cards wait for the
// whole plan (a cap past which the first round shows), and any ways found
// after that are merged in place (steady.mjs).

const T = Date.parse('2026-11-06T08:00:00+08:00');
const bus = (name, dep, min, extra = {}) => ({
  dep,
  arr: dep + min * 60_000,
  legs: [{ mode: 'bus', short: name, name, dep, arr: dep + min * 60_000, from: { name: 'A' }, to: { name: 'B' } }],
  lead: true,
  top: false,
  weak: false,
  tags: [],
  score: min,
  times: [],
  ...extra
});

test('a way shown keeps its place, rank and 推薦; only its times change', () => {
  const shown = [bus('5608', T + 5 * 60_000, 30, { top: true, score: 30, tags: ['推薦'] }), bus('182', T + 8 * 60_000, 35, { top: true, score: 35, tags: ['最快抵達'] })];
  // The second round ranks 182 first now, and its 5608 leaves 2 minutes later, live.
  const fresh = [bus('182', T + 8 * 60_000, 33, { top: true, score: 20, tags: ['推薦', '最快抵達'] }), bus('5608', T + 7 * 60_000, 30, { top: true, score: 31, tags: ['即時'] })];
  const out = steadyPlans(shown, fresh);
  const by = n => out.find(p => p.legs[0].short === n);
  assert.deepEqual(by('5608').tags, ['推薦', '即時']);
  assert.equal(by('5608').score, 30);
  assert.equal(by('5608').dep, T + 7 * 60_000, 'its new time');
  assert.deepEqual(by('182').tags, ['最快抵達']);
  assert.equal(by('182').score, 35);
  // As a card sorts them (score), the order is what was shown.
  assert.deepEqual([...out].filter(p => p.top).sort((a, b) => a.score - b.score).map(p => p.legs[0].short), ['5608', '182']);
});

test('a new way comes in quietly at the end: never 推薦, never on top', () => {
  const shown = [bus('5608', T, 30, { top: true, score: 30, tags: ['推薦'] })];
  const fresh = [bus('快捷9號', T, 15, { top: true, score: 15, tags: ['推薦', '最快抵達'] }), bus('5608', T, 30, { top: true, score: 30 })];
  const out = steadyPlans(shown, fresh);
  const n = out.find(p => p.legs[0].short === '快捷9號');
  assert.equal(n.top, false);
  assert.ok(n.score > 30);
  assert.ok(!n.tags.includes('推薦'));
  assert.equal(out.filter(p => p.tags.includes('推薦')).length, 1);
});

test('a way shown that the new round set aside stays shown', () => {
  const shown = [bus('5608', T, 30, { top: true, score: 30, tags: ['推薦'] })];
  const fresh = [bus('5608', T, 30, { top: false, weak: true, score: 80 })];
  const out = steadyPlans(shown, fresh);
  assert.equal(out[0].weak, false);
  assert.equal(out[0].top, true);
});

test('nothing found again keeps what is shown; the list\'s indexes stay', () => {
  const shown = [bus('5608', T, 30, { top: true })];
  assert.equal(steadyPlans(shown, []), shown);
  assert.equal(steadyPlans(shown, null), shown);
  const fresh = [bus('5608', T, 30, { times: [0, 1] }), bus('5608', T + 20 * 60_000, 30, { lead: false, times: null })];
  const out = steadyPlans(shown, fresh);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].times, [0, 1]);
  assert.equal(out[1], fresh[1], 'a departure (not a way) is passed as is');
});

test('the open way is found again by its lines, its time moved', () => {
  const open = bus('5608', T + 5 * 60_000, 30);
  const list = [bus('182', T, 20), bus('5608', T + 8 * 60_000, 30), bus('5608', T + 40 * 60_000, 30, { lead: false })];
  assert.equal(samePlanAt(list, open), 1);
  assert.equal(samePlanAt([bus('182', T, 20)], open), -1);
});

// The two places that show trips go through it.
const map = readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');
const go = readFileSync(new URL('../public/lib/tab-go.mjs', import.meta.url), 'utf8');

test('the plans card shows the whole plan first, a later round merged in place', () => {
  const plan = map.slice(map.indexOf('async function plan('), map.indexOf('async function goBest('));
  assert.match(plan, /settled\(await planTrip\(/, 'waits for the second round before its first show');
  assert.match(plan, /steadyPlans\(/, 'a later round is merged, not swapped in');
  assert.doesNotMatch(plan, /c\.plans = walkHereNow\(o\.plans\)/, 'never the new list straight over the shown one');
});

test('交通 keeps what it shows: ways found later merged in place', () => {
  const load = go.slice(go.indexOf('async function loadTrip('), go.indexOf('async function loadPlace('));
  assert.match(load, /settled\(await planTrip\(/);
  assert.match(load, /steadyPlans\(/);
});
