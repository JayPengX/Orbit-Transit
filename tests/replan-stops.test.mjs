// A trip with a stop added (加一站), then 公車 turned off on its card (or
// another time, a train picked, 電輔車): planned again without the stop, the
// trip quietly to the first place alone (seen live 11-17: 1 stop, then 0).
// tab-map.mjs needs a browser: read from its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');

test("the trip's card planned again: its added stops and a kept YouBike go with it", () => {
  const body = src.slice(src.indexOf('async function cardClick'), src.indexOf('function alertSheet'));
  const when = src.slice(src.indexOf('function setWhen'), src.indexOf('function plansHtml'));
  // (Every replan of the card as it is goes through the one door that carries them.)
  assert.doesNotMatch(body + when, /plan\(card\.fromHere \? null : card\.from, card\.to\)/);
  assert.match(src, /const replanCard = \(\) => plan\([^\n]*then: card\.then[^\n]*keep: card\.keep/);
  assert.match(src, /card = \{ kind: 'plans'[^\n]*keep: Boolean\(opts\.keep\)/);
});
