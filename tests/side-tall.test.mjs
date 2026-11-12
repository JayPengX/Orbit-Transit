// A phone on its side (the owner, 2026-11-12): the sheet sits beside the map on a short screen, and at half
// it hid even the first plan. Cards and trips open tall there; upright and on a tablet, at half as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');

test('side: a card or a trip opens tall on a phone on its side, at half otherwise', () => {
  const m = src.match(/const half = \(\) => \(([^)]*\)) && !([^)]*\)) \? 'large' : 'medium'\);/);
  assert.ok(m, 'half() picks large beside the map on a short screen');
  assert.match(m[1], /sideMode\(/);
  assert.match(m[2], /pinMode\(/);
  // Every place a card, the plans or a picked plan lifts the sheet goes through it.
  assert.doesNotMatch(src, /msheet\.set\('medium'\)/, 'no card is set to half by name');
  for (const where of [/card\.sel = 0;\s*if \(msheet && msheet\.detent !== half\(\)\) msheet\.set\(half\(\)\)/, /if \(listDetent == null\) listDetent = msheet\.detent;\s*if \(msheet\.detent !== half\(\)\) msheet\.set\(half\(\)\)/, /liftedFor = msheet\.detent !== half\(\)/])
    assert.match(src, where);
});

test('side: beside the map the sheet reaches the top, never down to the rail’s account buttons', () => {
  const top = src.match(/const sheetTop = \(\) => \{([\s\S]*?)\n\};/)[1];
  assert.match(top, /if \(sideMode\(\)\) return 10;/, 'the account buttons sit at the rail’s foot there: the tallest stop was 260 px');
  const css = readFileSync(new URL('../public/transit.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-height: 520px\) \{\s*\.ot-ms-grab \{\s*height: 14px;[\s\S]*?#card \.ot-opts \+ \.ot-plans \{\s*margin-top: 4px;/, 'a short screen: the first plan whole under the options');
});
