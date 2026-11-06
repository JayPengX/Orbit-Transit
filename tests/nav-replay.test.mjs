// Trips replayed fix by fix through today's navigation (navreplay.mjs), each
// checked against what it should have done (`expect`): the steps it moved on
// to by GPS alone, the trouble cards it showed, there or not. Made by
// scripts/trip-fixture.mjs from 快捷8號's real route; a real trip from
// 除錯紀錄 (navtrip) is replayed the same way with scripts/replay-nav.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { replay } from './navreplay.mjs';

const dir = new URL('./fixtures/trips/', import.meta.url);
for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const trace = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  test(`replayed: ${f}`, async () => {
    const r = await replay(trace);
    assert.deepEqual(r.steps, trace.expect.steps, 'the steps, by GPS alone');
    assert.deepEqual(r.trouble, trace.expect.trouble, 'the trouble cards shown');
    assert.equal(Boolean(r.st.done), trace.expect.done, 'there');
  });
}
