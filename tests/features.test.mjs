// Every feature in FEATURES.md must still be in the code: each line names
// the files and the marks (a function, a class, a string) that make it.
// A refactor that drops one fails here instead of vanishing silently.
// To remove a feature on purpose, delete its line in FEATURES.md in the same commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const list = readFileSync(join(root, 'FEATURES.md'), 'utf8');
// - Feature name — `path/a.mjs`, `path/b.css`: `mark one`, `mark two`
const rows = list.split('\n').filter(l => /^- .+ — `[^`]+`.*: `/.test(l));

test('FEATURES.md lists features', () => assert.ok(rows.length > 0));

for (const row of rows) {
  const [name, rest] = row.slice(2).split(' — ');
  const [filesPart, marksPart] = rest.split(/`:\s/);
  const files = [...(filesPart + '`').matchAll(/`([^`]+)`/g)].map(m => m[1]);
  const marks = [...marksPart.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  test(`feature kept: ${name}`, () => {
    const text = files.map(f => {
      assert.ok(existsSync(join(root, f)), `${name}: ${f} is gone`);
      return readFileSync(join(root, f), 'utf8');
    }).join('\n');
    for (const m of marks) assert.ok(text.includes(m), `${name}: "${m}" is gone from ${files.join(', ')}`);
  });
}
