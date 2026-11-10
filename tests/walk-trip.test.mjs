// A trip short enough to walk is a walk, whatever the planners say. Google's
// planner gave the walk; past its 100 trips a day (Google's limit, used up by
// mid-morning, 2026-11-10) it answers 429 and TDX's gives no walk: a 600 m
// trip found no way at all (Jay 2026-11-10). The walk is ours then, by
// OpenStreetMap's walking router, its line too.
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
// 新竹車站 → 東門城, about 380 m as the crow flies.
const from = { name: '新竹車站', lat: 24.8016, lon: 120.9716 };
const to = { name: '東門城', lat: 24.804, lon: 120.969 };
const line = '_seo|@{ojhViAhCuAjC'; // (any encoded line)

function stub({ google = [], tdx = [] } = {}) {
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(typeof url === 'string' ? url : url.url);
    asked.push(u.pathname);
    if (u.pathname.endsWith('/transit/route')) {
      const src = u.searchParams.get('src');
      return answer(src === 'google' ? { plans: google, sources: { google: google.length ? 'ok' : 'http 429' } } : { plans: tdx, sources: { tdx: 'ok' } });
    }
    if (u.pathname.endsWith('/transit/walk')) return answer({ walks: [null], src: 'http 429' });
    if (u.hostname === 'routing.openstreetmap.de' && u.pathname.includes('/table/')) return answer({ distances: [[0, 452]], sources: [{ distance: 0 }], destinations: [{ distance: 0 }, { distance: 0 }] });
    if (u.hostname === 'routing.openstreetmap.de' && u.pathname.includes('/route/')) return answer({ routes: [{ geometry: line, distance: 452, duration: 330 }] });
    return new Response('', { status: 503 });
  };
  return asked;
}

test('a short trip with Google out and TDX giving no walk: the walk by OpenStreetMap’s streets, its line drawn', async () => {
  const was = globalThis.fetch;
  const asked = stub();
  const api = await import('../public/lib/api.mjs');
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const { planTrip } = await import('../public/lib/planner.mjs');
    const data = { prefs: { modes: { bus: false, tra: false, hsr: false, metro: false, bike: false } } };
    const r = await planTrip(data, from, to, {});
    assert.ok(!r.error, 'no error: the walk is the way');
    const walk = r.plans.find(p => p.legs.length === 1 && p.legs[0].mode === 'walk');
    assert.ok(walk, 'a walk-only way');
    assert.equal(walk.legs[0].dist, 452, 'by the streets (OpenStreetMap’s), not the straight line');
    assert.equal(walk.legs[0].poly, line, 'its line, to draw and to navigate by');
    assert.ok(walk.legs[0].road && !walk.legs[0].straight);
    assert.ok(asked.some(x => x.includes('/route/')), 'OpenStreetMap’s route asked for the line');
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});

test('Google’s own walk there: no second walk asked; a long trip: no walk at all', async () => {
  const { walkPlan, allWalk, WALK_TRIP_M } = await import('../public/lib/planner.mjs');
  const now = Date.now();
  const g = walkPlan(from, to, { dist: 430, sec: 320 }, { t0: now });
  assert.ok(allWalk(g));
  assert.equal(g.dep, now);
  assert.equal(g.arr, now + 320_000);
  // To be there by a time: in 5 minutes before it.
  const by = walkPlan(from, to, { dist: 430, sec: 320 }, { t0: now + 3_600_000, by: 'arrive' });
  assert.equal(by.arr, now + 3_600_000 - 5 * 60_000);
  // Neither router answering: the streets' guess, said straight.
  const guess = walkPlan(from, to, null, { t0: now });
  assert.ok(guess.legs[0].straight && guess.legs[0].dist > 380);
  assert.equal(WALK_TRIP_M, 2000);

  const was = globalThis.fetch;
  const asked = stub({ google: [{ src: 'google', legs: [{ mode: 'walk', dist: 430, dur: 320, dep: now, arr: now + 320_000, from, to }], dep: now, arr: now + 320_000 }] });
  const api = await import('../public/lib/api.mjs');
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const { planTrip } = await import('../public/lib/planner.mjs');
    const data = { prefs: { modes: { bus: false, tra: false, hsr: false, metro: false, bike: false } } };
    const r = await planTrip(data, from, { name: '巨城', lat: 24.8094, lon: 120.9748 }, {});
    assert.equal(r.plans.filter(allWalk).length, 1, 'Google’s walk, not a second one');
    assert.ok(!asked.some(x => x.endsWith('/transit/walk')), 'no walk asked: Google’s plan had it');
    asked.length = 0;
    await planTrip(data, from, { name: '竹北', lat: 24.839, lon: 121.008 }, {});
    assert.ok(!asked.some(x => x.endsWith('/transit/walk') || x.includes('/route/v1')), '5 km: no walk asked');
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});
