// The owner's verdicts on real trips: each saved trip (tests/verdicts/*.json,
// its plans and bikes before ranking, made by scripts/verdict.mjs on the day's
// real data) ranked again by today's code, and what the owner said about it
// checked. A ranking change that breaks one of these is wrong, not the case.
// Add one for every trip the owner judges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSaved, sayPlan } from './verdict-rank.mjs';
import { crossings } from '../public/lib/rivers.mjs';
import { inOrder } from '../public/lib/plan.mjs';

const shown = r => r.filter(p => p.lead && !p.weak);
const rides = p => p.legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
const busChain = p => rides(p).some((l, i, a) => i > 0 && l.mode === 'bus' && a[i - 1].mode === 'bus');
const bikeOverRiver = p => rides(p).length && p.legs.some(l => l.mode === 'bike' && crossings(l.from, l.to));
const firstTrain = r => shown(r).find(p => p.top && rides(p).some(l => l.mode === 'tra'));
// A ride over 頭前溪 after a bus or train: never recommended, one by train and one by bus listed at most (the owner, 2026-10-15).
const riverOnce = r => {
  assert.deepEqual(r.filter(p => p.top && bikeOverRiver(p)).map(sayPlan), [], 'a ride over 頭前溪 after a train never recommended');
  for (const k of [true, false]) assert.ok(shown(r).filter(p => bikeOverRiver(p) && rides(p).some(l => l.mode === 'bus') === k).length <= 1, say(shown(r).filter(bikeOverRiver)));
};
const say = list => list.map(sayPlan).join('\n');

// What holds for every trip the owner judged.
function always(name, r) {
  const s = shown(r);
  assert.ok(s.length, `${name}: something shown`);
  assert.ok(s.every(inOrder), `${name}: every way shown can be done as written`);
  if (s.some(p => !busChain(p))) assert.deepEqual(s.filter(busChain).map(sayPlan), [], `${name}: no bus then another bus while there's another way`);
  assert.ok(!r.some(p => busChain(p) && p.tags.includes('最快抵達')), `${name}: 最快抵達 never on a bus chain`);
}

const CASES = {};
CASES['竹東高中 → 成功九街 at 16:35: the train is 1831 to 竹中 and the 六家線, never on to 新莊 and back; a ride over 頭前溪 after a train listed once at most (and once after a bus), never recommended; not on to 北新竹 and back up to 竹北'] = opts => {
  const r = rankSaved('zhudonghs-chenggong-1635', opts);
  always('1635', r);
  assert.match(sayPlan(firstTrain(r)), /1831:竹東>竹中 tra:區間1758:竹中>六家/, say(shown(r)));
  assert.ok(firstTrain(r).top, 'and it’s recommended');
  riverOnce(r);
  assert.deepEqual(shown(r).filter(p => /新莊>六家|北新竹>竹北|新竹>竹北/.test(sayPlan(p))).map(sayPlan), []);
};

CASES['竹東高中 → 成功九街 at 16:45, YouBike on and off: no 5673 then 5614 (a bus chain), the 六家線 still the train'] = opts => {
  for (const name of ['zhudonghs-chenggong-1645', 'zhudonghs-chenggong-1645-nobike']) {
    const r = rankSaved(name, opts);
    always(name, r);
    assert.ok(!shown(r).some(p => /5673.*5614|5673.*5615/.test(sayPlan(p))), say(shown(r)));
  }
  assert.match(sayPlan(firstTrain(rankSaved('zhudonghs-chenggong-1645', opts))), /竹東>竹中 tra:區間1758:竹中>六家/);
};

CASES['新竹站 → 成功九街: the train to 竹北 (or a bus, or riding it all) first, the train to 千甲 and a ride over 頭前溪 only listed, never first'] = opts => {
  const r = rankSaved('hsinchu-chenggong-1830', opts);
  always('hsinchu', r);
  const top = r.filter(p => p.top);
  assert.ok(!bikeOverRiver(top[0]), sayPlan(top[0]));
  assert.ok(rides(top[0]).every(l => l.mode === 'bus' || /竹北/.test(l.to?.name || '')), `first: ${sayPlan(top[0])}`);
  riverOnce(r);
};

CASES['竹東站 → 縣體育場: the change to the 六家線 first, never on to 新竹 and back up to 竹北'] = opts => {
  const r = rankSaved('zhudong-stadium-1910', opts);
  always('stadium', r);
  assert.match(sayPlan(r.find(p => p.top)), /竹東>竹中 tra:區間1768:竹中>六家/);
  assert.deepEqual(shown(r).filter(p => /竹中>新竹.*新竹>竹北|北新竹/.test(sayPlan(p))).map(sayPlan), []);
};

CASES['成功九街 → 竹東高中 by 08:00 (TPASS): the buses, and under them the 六家線 to 竹中 and on to 竹東 then a ride, and riding it all on two bikes (每 30 分鐘); not 竹北 and a change at 北新竹 for the same train'] = opts => {
  const r = rankSaved('chenggong-zhudonghs-arrive0800', opts);
  always('arrive0800', r);
  const s = shown(r);
  assert.ok(s.every(p => p.arr <= Date.parse('2026-10-13T08:00:00+08:00')), say(s));
  assert.ok(s.some(p => /六家>竹中 tra:\S+:竹中>竹東 bike/.test(sayPlan(p))), say(s));
  const ride = s.find(p => p.bike && !rides(p).length);
  assert.ok(ride, `riding it all shown: ${say(s)}`);
  assert.equal(ride.legs.filter(l => l.mode === 'bike').length, 2, sayPlan(ride));
  assert.ok(ride.legs.filter(l => l.mode === 'bike').every(l => l.dur <= 33 * 60), sayPlan(ride));
  assert.deepEqual(s.filter(p => /北新竹>竹東/.test(sayPlan(p))).map(sayPlan), []);
  // Never leaving later to ride longer: the first is the shortest door to door of those that ride a bus.
  const bus = s.filter(p => rides(p).some(l => l.mode === 'bus'));
  assert.ok(bus[0].arr - bus[0].dep <= Math.min(...bus.map(p => p.arr - p.dep)) + 5 * 60_000, say(s));
};

CASES['成功九街 → 竹東高中 by 08:00 without YouBike: the buses, never walking 5 km to 千甲 at 04:48 (a walk over 2 km folds while there is a way without one); nothing late'] = opts => {
  const r = rankSaved('chenggong-zhudonghs-arrive0800-nobike', opts);
  always('arrive0800-nobike', r);
  const s = shown(r);
  assert.ok(s.every(p => p.arr <= Date.parse('2026-10-13T08:00:00+08:00')), say(s));
  assert.ok(s.every(p => p.legs.every(l => l.mode !== 'walk' || (l.dist || 0) <= 2000)), say(s));
  assert.ok(s.every(p => p.legs.every(l => l.mode !== 'bike')), say(s));
  assert.ok(s.some(p => /快捷8號/.test(sayPlan(p))), say(s));
  assert.ok(s.every(p => p.deadline == null || p.deadline === Date.parse('2026-10-13T08:00:00+08:00')));
};

CASES['成功九街 → 竹東高中 at 06:45 (the north half of the street, 成功國中 a little nearer): by bike from 綠41公園 on the way, never 成功國中 behind and back past the door, to 文興嘉興路口 and to 六家; to 文興嘉興路口 by bike, never a 16-minute walk'] = opts => {
  const r = rankSaved('chenggong-zhudonghs-0645', opts);
  always('0645', r);
  const s = shown(r);
  const firstBike = p => p.legs.find(l => l.mode === 'bike');
  assert.deepEqual(r.filter(p => firstBike(p)?.from.name === '成功國中' && rides(p)[0] && /文興嘉興|六家/.test(rides(p)[0].from?.name || '')).map(sayPlan), [], 'from 成功國中 to the south-east');
  assert.ok(s.some(p => firstBike(p)?.from.name === '綠41公園' && /文興嘉興/.test(rides(p)[0]?.from?.name || '')), say(s));
  assert.deepEqual(s.filter(p => p.legs.some(l => l.mode === 'walk' && l.dur > 10 * 60 && /文興嘉興/.test(l.to?.name || ''))).map(sayPlan), []);
};

for (const [name, check] of Object.entries(CASES)) test(name, () => check());

// Reliable, not lucky: every verdict again with each plan that has a bus a
// few minutes earlier or later, as the live times move between readings
// (a different shift for each plan, seven patterns). One fix breaking
// another shows up here as a flip.
const JITTERS = [
  i => [1, -1, 2, -2, 0, 3, -3][i % 7],
  i => [-2, 2, -1, 1, 3, 0, -3][i % 7],
  i => (i % 2 ? 3 : -3),
  i => (i % 3) - 1,
  i => ((i * 7) % 5) - 2,
  () => 4,
  () => -4
];
for (const [name, check] of Object.entries(CASES)) test(`${name} (buses a few minutes off)`, () => {
  for (const [n, jitter] of JITTERS.entries()) {
    try {
      check({ jitter });
    } catch (err) {
      err.message = `pattern ${n}: ${err.message}`;
      throw err;
    }
  }
});
