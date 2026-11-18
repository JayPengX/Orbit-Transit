// A first opening waits for every module app.mjs imports before the map asks
// for anything (on a slow link, 13 s for 450 KB of code, 11-18). 查時刻 (its
// trains, metros and line maps) is read when first opened: never imported by
// the opening's code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const imports = src => [...src.matchAll(/^\s*import\s[^'"]*?from\s+['"](\.[^'"]+)['"]|^\s*import\s+['"](\.[^'"]+)['"]/gm)].map(m => m[1] || m[2]);

test('the opening never imports 查時刻: it is read when first opened', () => {
  const seen = new Set();
  const walk = f => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const g of imports(read(f))) walk(new URL(g, new URL(`file:///x/${f}`)).pathname.slice(3));
  };
  walk('app.mjs');
  for (const f of ['lib/tab-times.mjs', 'lib/tab-train.mjs', 'lib/tab-metro.mjs']) assert.ok(!seen.has(f), f);
  assert.match(read('app.mjs'), /import\('\.\/lib\/tab-times\.mjs'\)/);
});
