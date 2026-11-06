// A plan's buses in as few Worker asks as its answers allow (2026-11-06: a
// trip's plan asked /transit/eta five to ten times, one a route, the same
// route up to five times, and each lagging route's GPS on its own).
// - busEta: the same ask within a beat (the live speed) is the one before;
//   the routes asked within a moment go as one ask a city (routes=), each
//   given only its own rows.
// - routeGps: the routes asked within a moment, one ask a city (the city's
//   RealTimeByFrequency filtered by them); one alone, its own route's ask.
import test from 'node:test';
import assert from 'node:assert/strict';

const rowsOf = {
  HSQ0747: [{ RouteUID: 'HSQ0747', StopUID: 'HSQ1', EstimateTime: 60 }],
  HSQ0748: [{ RouteUID: 'HSQ0748', StopUID: 'HSQ2', EstimateTime: 120 }],
  THB5700: [{ RouteUID: 'THB5700', StopUID: 'THB1', EstimateTime: 300 }]
};
const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test("a plan's buses: one ask a city for its routes, each route its own rows, nothing asked twice in a beat", async () => {
  const api = await import('../public/lib/api.mjs');
  const { routeGps } = await import('../public/lib/bus.mjs');
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    asked.push(decodeURIComponent(u.pathname + u.search).replace(/&qt=.*$/, ''));
    if (u.pathname === '/transit/eta') {
      const ids = (u.searchParams.get('routes') || u.searchParams.get('route') || '').split(',');
      return answer(ids.flatMap(id => rowsOf[id] || []));
    }
    // (TDX's GPS: each route named in the filter, a bus on it.)
    const p = u.searchParams.get('p') || '';
    return answer([...p.matchAll(/RouteUID eq '([^']+)'/g)].map(([, id]) => ({ RouteUID: id, PlateNumb: `${id}-1`, Direction: 0 })));
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const [a, b, c] = await Promise.all([api.busEta('HsinchuCounty', { route: 'HSQ0747' }), api.busEta('HsinchuCounty', { route: 'HSQ0748' }), api.busEta('InterCity', { route: 'THB5700' })]);
    assert.deepEqual(a.rows, rowsOf.HSQ0747);
    assert.deepEqual(b.rows, rowsOf.HSQ0748);
    assert.deepEqual(c.rows, rowsOf.THB5700);
    const eta = asked.filter(x => x.startsWith('/transit/eta'));
    assert.deepEqual(eta.sort(), ['/transit/eta?city=HsinchuCounty&routes=HSQ0747,HSQ0748', '/transit/eta?city=InterCity&route=THB5700']);
    // Asked again within the beat: the same answer, no ask.
    assert.equal(await api.busEta('HsinchuCounty', { route: 'HSQ0748' }), b);
    assert.equal(asked.filter(x => x.startsWith('/transit/eta')).length, 2);
    // GPS: two routes of a city at once, one filtered ask; one alone, its route's own.
    const [g1, g2] = await Promise.all([routeGps({ uid: 'HSQ0747', name: '快捷8號', city: 'HsinchuCounty' }), routeGps({ uid: 'HSQ0748', name: '快捷8號支', city: 'HsinchuCounty' })]);
    assert.deepEqual([g1.map(x => x.RouteUID), g2.map(x => x.RouteUID)], [['HSQ0747'], ['HSQ0748']]);
    const lone = await routeGps({ uid: 'THB5700', name: '5700', city: 'InterCity' });
    assert.equal(lone.length, 1);
    const gps = asked.filter(x => x.includes('RealTimeByFrequency'));
    assert.equal(gps.length, 2);
    assert.match(gps[0], /RealTimeByFrequency\/City\/HsinchuCounty\?\$filter=RouteUID eq 'HSQ0747' or RouteUID eq 'HSQ0748'&\$select=RouteUID,/);
    assert.match(gps[1], /RealTimeByFrequency\/InterCity\/5700\?\$filter=RouteUID eq 'THB5700'&\$select=PlateNumb,/);
    // And within the beat, not again.
    await routeGps({ uid: 'HSQ0747', name: '快捷8號', city: 'HsinchuCounty' });
    assert.equal(asked.filter(x => x.includes('RealTimeByFrequency')).length, 2);
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});
