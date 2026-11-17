// lib/api.mjs tdx(): an answer that isn't TDX's shape (an empty object, an
// error's JSON) is a failed ask: the last copy answers and is never saved
// over; with none, it fails ("交通資料暫時沒有回應"), never "今天沒有車了".
import { test } from 'node:test';
import assert from 'node:assert/strict';

test("TDX's shape: a list, or an object with a list in it", async () => {
  const { tdxShaped } = await import('../public/lib/api.mjs');
  for (const good of [[], [{ a: 1 }], { TrainDate: '2026-11-17', TrainTimetables: [] }, { Lines: [{}] }]) assert.equal(tdxShaped(good), true, JSON.stringify(good));
  for (const bad of [null, {}, '', 0, { error: 'upstream' }, { TrainDate: '2026-11-17' }]) assert.equal(tdxShaped(bad), false, JSON.stringify(bad));
});

test('an answer not shaped like TDX is a failed ask: the last copy answers, else a failure', async () => {
  const { useSession, tdx } = await import('../public/lib/api.mjs');
  const was = globalThis.fetch;
  useSession({ ensureToken: async () => 'tok' });
  try {
    const path = 'basic/v3/Rail/TRA/DailyTrainTimetable/TrainDate/2026-11-17';
    globalThis.fetch = async () => new Response(JSON.stringify({ TrainDate: '2026-11-17', TrainTimetables: [{ TrainInfo: { TrainNo: '1' } }] }));
    assert.equal((await tdx(path, { fresh: 0, store: false })).TrainTimetables.length, 1);
    globalThis.fetch = async () => new Response('{}');
    assert.equal((await tdx(path, { fresh: 0, store: false })).TrainTimetables.length, 1, 'the last copy, not an empty day');
    await assert.rejects(tdx('basic/v2/Rail/THSR/DailyTimetable/TrainDate/2026-11-17', { fresh: 0, store: false }), e => e.code === 'SHAPE');
  } finally {
    globalThis.fetch = was;
  }
});
