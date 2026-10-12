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
const firstTrain = r => shown(r).find(p => rides(p).some(l => l.mode === 'tra'));
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
CASES['竹東高中 → 成功九街 at 16:35: the train is 1831 to 竹中 and the 六家線, never on to 新莊 and back; no ride over 頭前溪 after a train; not on to 北新竹 and back up to 竹北'] = opts => {
  const r = rankSaved('zhudonghs-chenggong-1635', opts);
  always('1635', r);
  assert.match(sayPlan(firstTrain(r)), /1831:竹東>竹中 tra:區間1758:竹中>六家/, say(shown(r)));
  assert.ok(firstTrain(r).top, 'and it’s recommended');
  assert.deepEqual(shown(r).filter(bikeOverRiver).map(sayPlan), []);
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

CASES['新竹站 → 成功九街: the train to 竹北 (or a bus, or riding it all) first, never the train to 千甲 and a ride over 頭前溪'] = opts => {
  const r = rankSaved('hsinchu-chenggong-1830', opts);
  always('hsinchu', r);
  const top = r.filter(p => p.top);
  assert.ok(!bikeOverRiver(top[0]), sayPlan(top[0]));
  assert.ok(rides(top[0]).every(l => l.mode === 'bus' || /竹北/.test(l.to?.name || '')), `first: ${sayPlan(top[0])}`);
  assert.deepEqual(shown(r).filter(bikeOverRiver).map(sayPlan), []);
};

CASES['竹東站 → 縣體育場: the change to the 六家線 first, never on to 新竹 and back up to 竹北'] = opts => {
  const r = rankSaved('zhudong-stadium-1910', opts);
  always('stadium', r);
  assert.match(sayPlan(r.find(p => p.top)), /竹東>竹中 tra:區間1768:竹中>六家/);
  assert.deepEqual(shown(r).filter(p => /竹中>新竹.*新竹>竹北|北新竹/.test(sayPlan(p))).map(sayPlan), []);
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
