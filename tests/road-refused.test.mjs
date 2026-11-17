// A walk's or ride's road from OpenStreetMap's open router, refused once (a
// 429, a 5xx: light use only), was kept as "no road" for the session: the
// walk a straight line across blocks till the app was closed (11-17). A
// refusal is asked again next time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roadPath } from '../public/lib/api.mjs';

test('a road the router refused once is asked again, not held as none', async () => {
  const was = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => (++n === 1 ? new Response('busy', { status: 429 }) : new Response(JSON.stringify({ routes: [{ geometry: 'abc', distance: 420, duration: 300 }] }), { headers: { 'Content-Type': 'application/json' } }));
  try {
    const a = { lat: 24.80161, lon: 120.97161 };
    const b = { lat: 24.80431, lon: 120.97581 };
    assert.equal(await roadPath('walk', a, b), null, 'refused: no road now');
    assert.deepEqual(await roadPath('walk', a, b), { poly: 'abc', dist: 420, dur: 300 }, 'asked again');
    assert.equal(n, 2);
    assert.deepEqual(await roadPath('walk', a, b), { poly: 'abc', dist: 420, dur: 300 });
    assert.equal(n, 2, 'one found is kept');
  } finally {
    globalThis.fetch = was;
  }
});
