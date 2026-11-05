// lib/api.mjs ask(): an answer's body may take as long as it keeps coming,
// and fails once it has gone quiet. A limit on the whole body cut a day's
// trains off on a slow, busy link while it was still coming, and it was
// downloaded again (3G, 2026-11-05); a body that stops never holds an ask
// (a city's YouBike list, 2026-10-22).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// A body in `pieces`, each `gap` ms after the last; the ask's signal ends it.
const trickle = (pieces, gap) => (url, init) =>
  new Response(
    new ReadableStream({
      async start(c) {
        init?.signal?.addEventListener('abort', () => c.error(init.signal.reason || new Error('aborted')));
        for (const p of pieces) {
          await new Promise(r => setTimeout(r, gap));
          if (init?.signal?.aborted) return;
          c.enqueue(new TextEncoder().encode(p));
        }
        c.close();
      }
    }),
    { status: 200 }
  );
// The clock run on by `ms`, a second at a time, what each second set going let finish.
const run = async ms => {
  for (let t = 0; t < ms; t += 500) {
    mock.timers.tick(500);
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  }
};

test('a body still coming is read to its end, however long; one gone quiet is a failed ask, in its time', async () => {
  const { useSession, whereIs } = await import('../public/lib/api.mjs');
  const was = globalThis.fetch;
  useSession({ ensureToken: async () => 'tok' });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // 30 s in all, a piece every 2 s: past the 8 + 10 s the whole answer had, never quiet for 10 s.
    const text = JSON.stringify({ town: '竹北市', pad: 'x'.repeat(60) });
    const pieces = text.match(/.{1,6}/g);
    assert.ok(pieces.length * 2000 > 18_000);
    globalThis.fetch = trickle(pieces, 2000);
    let got = null;
    whereIs({ lat: 24.83, lon: 121.01 }).then(g => (got = g), e => (got = e));
    await run(pieces.length * 2000 + 1000);
    assert.equal(got?.town, '竹北市', String(got?.code || got));
    // Quiet past 10 s after its answer began: failed (asked once more, quiet again), never left waiting.
    let asks = 0;
    globalThis.fetch = (url, init) => (asks++, trickle(['{"town":', '"x"}'], 60_000)(url, init));
    let failed = null;
    whereIs({ lat: 24.8, lon: 121.0 }).then(() => (failed = 'answered'), e => (failed = e));
    await run(10_500);
    assert.equal(failed, null, 'not before its 10 s');
    await run(12_000);
    assert.equal(failed?.code, 'TIMEOUT');
    assert.equal(asks, 2);
  } finally {
    mock.timers.reset();
    globalThis.fetch = was;
    useSession(null);
  }
});
