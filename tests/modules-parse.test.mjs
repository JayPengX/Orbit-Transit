// Every module of the app parses: a name declared twice in one function
// (2026-11-10: `bk` in the trip card's click handler) is a SyntaxError that
// stops the whole page, and a module no test imports never says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('every module in public/lib and public/*.mjs parses', () => {
  const dirs = ['public/lib', 'public'];
  const files = dirs.flatMap(d => readdirSync(new URL(`../${d}/`, import.meta.url)).filter(f => /\.mjs$/.test(f)).map(f => `${d}/${f}`));
  assert.ok(files.length > 20);
  const bad = [];
  for (const f of files) {
    try {
      execFileSync(process.execPath, ['--check', new URL(`../${f}`, import.meta.url).pathname], { stdio: 'pipe' });
    } catch (err) {
      bad.push(`${f}: ${String(err.stderr || err.message).split('\n').find(l => /Error/.test(l)) || 'does not parse'}`);
    }
  }
  assert.deepEqual(bad, []);
});
