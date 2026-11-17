// An iPhone back from the background can hand over the last fix it had,
// minutes old, as if new (Jay 2026-11-07, on 普悠瑪 107 past 香山, his fix at
// 新竹). Navigation already took no notice of one; "where am I now" did: the
// map, "from here" and a trip started then were put where he'd been.
import test from 'node:test';
import assert from 'node:assert/strict';

test('where am I now: a fix handed over minutes old is no answer; the fresh one after it is', async () => {
  const { getPosition, watchPosition } = await import('../public/lib/api.mjs');
  let send = null;
  const nav = { geolocation: { watchPosition: ok => ((send = ok), 1), clearWatch() {} } };
  const fix = (lon, ago) => send({ coords: { latitude: 24.8, longitude: lon, accuracy: 10 }, timestamp: Date.now() - ago });
  const seen = [];
  const stop = watchPosition(p => seen.push(p.lon), nav);
  try {
    const asked = getPosition({ timeout: 2000 }, nav);
    // 新竹, five minutes ago; then 香山, now.
    fix(120.97, 5 * 60_000);
    fix(120.92, 0);
    const got = await asked;
    assert.equal(got.lon, 120.92);
    assert.ok(Date.now() - got.at < 5000, 'its own time');
    // (The watch's followers are still told of both: navigation sorts them by `at` itself.)
    assert.deepEqual(seen, [120.97, 120.92]);
  } finally {
    stop();
  }
});
