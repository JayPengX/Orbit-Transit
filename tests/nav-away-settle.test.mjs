import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nav = readFileSync(new URL('../public/lib/nav.mjs', import.meta.url), 'utf8');

// Jay 11-26: the trip found which train he was on, but moved its times onto his only after the app was closed
// and opened again. Back from the background a minute and more, the next fix finds it again as an open does.
test('back from the background a while, the trip is found again as when opened', async () => {
  const { AWAY_SETTLE_MS } = await import('../public/lib/nav.mjs');
  assert.equal(AWAY_SETTLE_MS, 60_000);
  assert.match(nav, /if \(document\.visibilityState === 'hidden'\) return void \(state\.hiddenAt = Date\.now\(\)\);/);
  assert.match(nav, /if \(state\.hiddenAt && Date\.now\(\) - state\.hiddenAt >= AWAY_SETTLE_MS\) state\.settled = false;/);
  // (And an unsettled trip settles on its next fix.)
  assert.match(nav, /if \(!state\.settled\) settle\(p\);/);
});
