// A walk Google didn't answer is OpenStreetMap's for now, never for good.
// Google's walk matrix refused on 2026-11-07; the phone kept OpenStreetMap's
// 460 m round the school to 成功國中 and, keeping walks for good, still had it
// on 11-09 when Google's 267 m by the lane was back: 綠41公園 was taken (Jay
// 2026-11-09, "it previously worked"). Asked again after WALK_RETRY_MS.
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('a walk Google didn’t answer: OpenStreetMap’s for now, Google asked again later and its shorter walk kept', async () => {
  const api = await import('../public/lib/api.mjs');
  const home = { name: '成功九街', lat: 24.8176, lon: 121.0165 };
  const school = { name: '成功國中', lat: 24.81872, lon: 121.01597 };
  const was = globalThis.fetch;
  const now = Date.now;
  let google = false;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/transit/walk')) {
      asked.push('google');
      return google ? answer({ walks: [{ dist: 267, dur: 200 }], src: 'google-routes' }) : new Response('{}', { status: 502 });
    }
    if (u.pathname.includes('/table/')) {
      asked.push('osm');
      return answer({ distances: [[0, 460]], sources: [{ distance: 0 }], destinations: [{ distance: 0 }, { distance: 0 }] });
    }
    return new Response('', { status: 503 });
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    assert.equal((await api.walkTo(home, school)).dist, 460, 'Google not answering: OpenStreetMap’s');
    google = true;
    asked.length = 0;
    await api.walkTo(home, school);
    assert.deepEqual(asked, [], 'not asked again at once');
    const t = now();
    Date.now = () => t + api.WALK_RETRY_MS + 60_000;
    assert.equal((await api.walkTo(home, school)).dist, 267, 'later: Google asked again, its walk by the lane kept');
    assert.ok(asked.includes('google'));
    asked.length = 0;
    Date.now = () => t + 3 * api.WALK_RETRY_MS;
    await api.walkTo(home, school);
    assert.deepEqual(asked, [], 'Google’s answer settles it');
    assert.equal(api.walkKnown(home, school).dist, 267);
  } finally {
    globalThis.fetch = was;
    Date.now = now;
    api.useSession(null);
  }
});
