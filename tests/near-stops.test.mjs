// 附近 (the map's sheet, 交通's stops): the stops around you with every bus
// due, read without TDX's search of the buses around a point. That search is
// an advanced ask (7.5 times a basic one's points), made again for each
// ~100 m and every 20 s, never shared: on 2026-11-06 it was most of what a
// phone on the map spent (0.9 points an hour of TDX's 200 a month). Now:
// the stations around you (TDX's, kept a day, one answer for everyone within
// ~200 m), then one ask a city for the nearest stops' buses (the proxy's
// /transit/eta, the city's one copy when many ask).
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const h = { lat: 24.8016, lon: 120.9716 };
const station = (uid, name, dLat, stops) => ({ StationUID: uid, StationID: uid.slice(3), StationName: { Zh_tw: name }, StationPosition: { PositionLat: h.lat + dLat, PositionLon: h.lon }, Stops: stops.map(([s, r, n]) => ({ StopUID: s, RouteUID: r, RouteName: { Zh_tw: n } })), LocationCityCode: 'HSZ' });
// 新竹車站 on two signs (44 m and 89 m), 中正路口 200 m, 無車站 278 m (no bus said there), 遠站 667 m (past 350 m).
const STATIONS = [
  station('HSZ9001', '新竹車站', 0.0004, [['HSZ101', 'HSZ0010', '10'], ['THB201', 'THB5608', '5608']]),
  station('HSZ9002', '新竹車站', -0.0008, [['HSZ102', 'HSZ0010', '10']]),
  station('HSZ9003', '中正路口', 0.0018, [['HSZ301', 'HSZ0020', '20']]),
  station('HSZ9004', '無車站', 0.0025, [['HSZ401', 'HSZ0030', '30']]),
  station('HSZ9005', '遠站', 0.006, [['HSZ501', 'HSZ0040', '40']])
];
const row = (stop, route, name, dir, extra) => ({ StopUID: stop, RouteUID: route, RouteName: { Zh_tw: name }, Direction: dir, StopStatus: 0, ...extra });
const ETA = {
  HSZ101: [row('HSZ101', 'HSZ0010', '10', 0, { EstimateTime: 300 })],
  // (The same route and way at the other sign, sooner: that one is the stop's.)
  HSZ102: [row('HSZ102', 'HSZ0010', '10', 0, { EstimateTime: 120 })],
  THB201: [row('THB201', 'THB5608', '5608', 1, { EstimateTime: 600 })],
  HSZ301: [row('HSZ301', 'HSZ0020', '20', 0, { EstimateTime: 60 })]
};

test('stops near you: the nearest by name, one ask a city for their buses, never TDX’s advanced search of buses', async () => {
  const api = await import('../public/lib/api.mjs');
  const { nearStops } = await import('../public/lib/bus-ui.mjs');
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    asked.push(decodeURIComponent(u.pathname + u.search).replace(/&qt=.*$/, ''));
    if (u.pathname === '/transit/eta') return answer((u.searchParams.get('stops') || '').split(',').flatMap(s => ETA[s] || []));
    if (u.pathname === '/transit/tdx' && /Bus\/Station\/NearBy/.test(u.searchParams.get('p') || '')) return answer(STATIONS);
    return answer([]);
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const got = await nearStops(h, { n: 2, r: 350 });
    assert.deepEqual(
      got.map(s => [s.name, Math.round(s.dist), s.rows.map(r => `${r.route}:${r.v.sec}`)]),
      [
        ['新竹車站', 44, ['10:120', '5608:600']],
        ['中正路口', 200, ['20:60']]
      ]
    );
    assert.equal(got[0].rows[1].city, 'InterCity');
    assert.equal(got[0].rows[0].stopUID, 'HSZ102');
    // No advanced ask of the buses around a point; the stations' (kept a day) and one ask a city.
    assert.equal(asked.filter(x => /EstimatedTimeOfArrival\/NearBy/.test(x)).length, 0);
    const eta = asked.filter(x => x.startsWith('/transit/eta')).sort();
    // (The nearest names and one more, for a stop with no bus said: 無車站's asked, 遠站's never.)
    assert.deepEqual(eta, ['/transit/eta?city=Hsinchu&stops=HSZ101,HSZ102,HSZ301,HSZ401', '/transit/eta?city=InterCity&stops=THB201']);
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});

// A trip's walks to the YouBike stations near its ends are asked from the
// end's spot on the map's ~40 m grid (planner.mjs spotOf, tab-map fromHere):
// planning from where you stand asked Google again for the five walks the
// map's strip had asked from 25 m away (2026-11-06), and each fix is a new
// point. A walk asked from the spot is the planner's walk from the end, either way round.
test("a trip's walks from its end's spot on the map's grid: asked once a spot, found from the end", async () => {
  const api = await import('../public/lib/api.mjs');
  const { spotOf } = await import('../public/lib/planner.mjs');
  const { walkLeg } = await import('../public/lib/plan.mjs');
  // Two fixes 15 m apart, one spot; the spot within ~28 m of each.
  const a = { lat: 24.80275, lon: 120.97035 };
  const b = { lat: 24.80285, lon: 120.97045 };
  assert.deepEqual(spotOf(a), spotOf(b));
  assert.deepEqual(spotOf(a), { lat: 24.8028, lon: 120.9704 });
  const station = { name: '新竹火車站(前站一)', lat: 24.80189, lon: 120.97099 };
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/transit/walk')) {
      asked.push(u.searchParams.get('from'));
      return answer({ walks: [{ dist: 240, dur: 200 }], src: 'google' });
    }
    return new Response('', { status: 503 });
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    await api.walksTo(spotOf(a), [station]);
    await api.walksTo(spotOf(b), [station]);
    assert.deepEqual(asked, ['24.80280,120.97040'], 'one ask for the spot, none for the second fix');
    assert.equal(walkLeg({ ...a, name: '' }, station, 0).dist, 240);
    assert.equal(walkLeg(station, { ...b, name: '' }, 0).dist, 240);
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});
