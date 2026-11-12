// Jay 2026-11-12, on a YouBike trip with stops: back in the app, the map's
// sheet was empty (only its handle) at every opening. The ride kept on the
// phone is opened again as a card of its one plan, with no stops of its own
// (showPlan); its kept bike's line read the card's stops (`c.then.length`)
// and threw, the card left open with nothing in it and the ride never taken
// up again. tab-map.mjs needs a browser: read from its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');
const body = name => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, name);
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j);
};

test('a reopened ride’s card has no stops: the card and its way on the map never read them unguarded', () => {
  const resumed = body('showPlan');
  assert.match(resumed, /card = \{ kind: 'plans'/);
  assert.doesNotMatch(resumed.match(/card = \{[^\n]*/)[0], /\bthen:/, 'the reopened card carries no stops');
  for (const f of ['plansHtml', 'drawPlan']) {
    // Each read of the card's stops guarded: `c.then?.`, `(card.then || [])`.
    const unguarded = [...body(f).matchAll(/\b(c|card)\.then(\.|\[)/g)].map(m => body(f).slice(Math.max(0, m.index - 40), m.index + 20));
    assert.deepEqual(unguarded, [], `${f}: a card's stops read without a guard`);
  }
});

test('a card that fails to draw is never left open and empty; a ride that cannot be taken up again ends', () => {
  const r = body('renderCard');
  assert.match(r, /try \{\s*drawCard\(\);/);
  assert.match(r, /closeCard\(\)/);
  const t = body('takePending');
  assert.match(t, /\.catch\(failed\)/);
  assert.match(t, /forgetNav\(\)/);
});
