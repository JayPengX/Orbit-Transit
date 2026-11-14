// A plan's buses in as few Worker asks as its answers allow (2026-11-06: a
// trip's plan asked /transit/eta five to ten times, one a route, the same
// route up to five times, and each lagging route's GPS on its own).
// - busEta: the same ask within a beat (the live speed) is the one before;
//   the routes asked within a moment go as one ask a city (routes=), each
//   given only its own rows.
// - routeGps: the routes asked within a moment, one ask a city
//   (/transit/gps: the Worker reads the city's whole list for them all).
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
    // (Buses' places: each route asked, a bus on it.)
    if (u.pathname === '/transit/gps') return answer((u.searchParams.get('routes') || '').split(',').map(id => ({ RouteUID: id, PlateNumb: `${id}-1`, Direction: 0 })));
    return answer([]);
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
    // Buses' places: two routes of a city at once, one ask (the Worker reads the city's whole list); one alone, its own.
    const [g1, g2] = await Promise.all([routeGps({ uid: 'HSQ0747', name: '快捷8號', city: 'HsinchuCounty' }), routeGps({ uid: 'HSQ0748', name: '快捷8號支', city: 'HsinchuCounty' })]);
    assert.deepEqual([g1.map(x => x.RouteUID), g2.map(x => x.RouteUID)], [['HSQ0747'], ['HSQ0748']]);
    const lone = await routeGps({ uid: 'THB5700', name: '5700', city: 'InterCity' });
    assert.equal(lone.length, 1);
    assert.deepEqual(asked.filter(x => x.startsWith('/transit/gps')), ['/transit/gps?city=HsinchuCounty&routes=HSQ0747,HSQ0748', '/transit/gps?city=InterCity&routes=THB5700']);
    // Never TDX's own filtered read of them.
    assert.equal(asked.filter(x => x.includes('RealTimeByFrequency')).length, 0);
    // And within the beat, not again.
    await routeGps({ uid: 'HSQ0747', name: '快捷8號', city: 'HsinchuCounty' });
    assert.equal(asked.filter(x => x.startsWith('/transit/gps')).length, 2);
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});

// A city whose estimates come every 30 s (Hsinchu's, 2026-11-06): once an ask
// brings a new one, the next ask waits until the next can be there, and says
// how old the phone's copy is (had=, the Worker reading TDX if its own is no
// newer); Taipei's rows (no DataTime) are asked every beat as before.
test('bus times: not asked again before the next estimate can be there; asked every beat where estimates come faster', async () => {
  const api = await import('../public/lib/api.mjs');
  const was = { fetch: globalThis.fetch, now: Date.now };
  let clock = Date.parse('2026-11-06T03:00:00Z');
  Date.now = () => clock;
  // The feed: a new estimate every 30 s, reaching the Worker 18 s after it's made.
  const made = t => Math.floor((t - 18_000) / 30_000) * 30_000;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    asked.push({ at: clock, city: u.searchParams.get('city'), had: Number(u.searchParams.get('had')) || 0 });
    const city = u.searchParams.get('city');
    const row = city === 'Taipei' ? { StopUID: 'TPE1', RouteUID: 'TPE10132', EstimateTime: 120 } : { StopUID: 'HSZ1', RouteUID: 'HSZ0010', EstimateTime: 120, DataTime: new Date(made(clock)).toISOString() };
    return answer([row]);
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    // A stop card's beat (transitLive, the kit's default) for 3 minutes, in each city.
    const beat = api.liveMs() / 1000;
    for (let s = 0; s < 180; s += beat) {
      clock = Date.parse('2026-11-06T03:00:00Z') + s * 1000;
      await api.busEta('Hsinchu', { stops: ['HSZ1'] });
      await api.busEta('Taipei', { stops: ['TPE1'] });
    }
    const of = city => asked.filter(x => x.city === city).map(x => (x.at - Date.parse('2026-11-06T03:00:00Z')) / 1000);
    // Taipei: every beat.
    assert.equal(of('Taipei').length, Math.ceil(180 / beat));
    // Hsinchu: once the 30 s rhythm is seen, one ask an estimate, and never a new estimate missed.
    const h = of('Hsinchu');
    assert.ok(h.length <= 8, `Hsinchu asked ${h.length} times: ${h}`);
    // The first ask takes the Worker's copy as it is; each after it says how old the phone's is.
    const hs = asked.filter(x => x.city === 'Hsinchu');
    assert.equal(hs[0].had, 0);
    assert.deepEqual(hs.slice(1).map(x => x.had), hs.slice(1).map((x, i) => Math.floor((x.at - hs[i].at) / 1000)));
    const seen = new Set();
    for (const at of h) seen.add(made(Date.parse('2026-11-06T03:00:00Z') + at * 1000));
    const all = new Set();
    for (let s = 0; s < 180; s += beat) all.add(made(Date.parse('2026-11-06T03:00:00Z') + s * 1000));
    assert.equal(seen.size, all.size, 'every estimate the beat would have caught was caught');
  } finally {
    globalThis.fetch = was.fetch;
    Date.now = was.now;
    api.useSession(null);
  }
});

// A route's beat says how old its copy is too (a trip's buses, a route sheet), its city's routes still in one ask.
test("a route's next beat says how old the phone's copy is, its city's routes together", async () => {
  const api = await import('../public/lib/api.mjs');
  const was = { fetch: globalThis.fetch, now: Date.now };
  let clock = Date.parse('2026-11-06T05:00:00Z');
  Date.now = () => clock;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    asked.push(decodeURIComponent(u.pathname + u.search).replace(/&qt=.*$/, ''));
    return answer([]);
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    await Promise.all([api.busEta('HsinchuCounty', { route: 'HSQ0090' }), api.busEta('HsinchuCounty', { route: 'HSQ0091' })]);
    clock += api.liveMs();
    await Promise.all([api.busEta('HsinchuCounty', { route: 'HSQ0090' }), api.busEta('HsinchuCounty', { route: 'HSQ0091' })]);
    assert.deepEqual(asked, ['/transit/eta?city=HsinchuCounty&routes=HSQ0090,HSQ0091', `/transit/eta?city=HsinchuCounty&routes=HSQ0090,HSQ0091&had=${api.liveMs() / 1000}`]);
  } finally {
    globalThis.fetch = was.fetch;
    Date.now = was.now;
    api.useSession(null);
  }
});

// A bus sends its place each 20 s (TDX A1's GPSTime, 2026-11-06): a route's
// is asked once in each 20 s of the clock, not at each 10 s beat (a stop card
// read TDX twice for each fix), saying how old the copy here is (`had`: the
// Worker reads TDX then, not answering with its own copy a step old).
test("buses' places: once in each 20 s of the clock, saying how old the copy is", async () => {
  const api = await import('../public/lib/api.mjs');
  const { routeGps } = await import('../public/lib/bus.mjs');
  const was = { fetch: globalThis.fetch, now: Date.now };
  const t0 = Date.parse('2026-11-06T06:00:00Z');
  let clock = t0;
  Date.now = () => clock;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    asked.push({ at: (clock - t0) / 1000, had: Number(u.searchParams.get('had')) || 0 });
    return answer([{ RouteUID: 'HSQ0090', PlateNumb: 'KKA-0090', Direction: 0 }]);
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    // A stop card's beat (10 s) for a minute.
    for (let s = 0; s < 60; s += 10) {
      clock = t0 + s * 1000;
      const got = await routeGps({ uid: 'HSQ0090', name: '90', city: 'HsinchuCounty' });
      assert.equal(got.length, 1);
    }
    assert.deepEqual(asked.map(x => x.at), [0, 20, 40]);
    assert.deepEqual(asked.map(x => x.had), [0, 20, 20]);
  } finally {
    globalThis.fetch = was.fetch;
    Date.now = was.now;
    api.useSession(null);
  }
});
