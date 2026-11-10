// 高雄's buses read by the phone from the city's own site (khbus.mjs), which
// answers only Taiwan's own networks. Its answers here are shaped as the
// city's own pages read them and as 臺中's (the same maker's) answer:
// station ids as strings, goBack 1 and 2, etaTime in minutes, comeTime HH:MM.
// - TDX's ids from the site's: StopID = 1, the route's 5 digits, station, goBack.
// - A stop's estimate (stationEstimates), a route's whole (route), its buses.
// - A field it hasn't is dropped and asked again; no stationEstimates: routes whole.
// - It fails: the proxy's at once, and for 5 minutes; what it can't answer, the proxy's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { khStop, khUid, khEta, khGps, khDown, resetKh, KH_GQL } from '../public/lib/khbus.mjs';

const T0 = Date.parse('2026-11-10T09:00:00Z'); // 17:00 in Taiwan
const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const NAMES = { KHH100: '100百貨幹線', KHH15102: '紅50' };
const STOPS = { KHH1001001172: ['光華路口(光華夜市)'], KHH100100122871: ['大立百貨(文武二街口)'], KHH10010095351: ['x'] };
const names = async () => ({ get: uid => NAMES[uid], stops: STOPS });
// Route 100's estimates (the site's words).
const R100 = {
  id: '100',
  name: '100',
  estimateTimes: {
    edges: [
      { node: { id: '117', goBack: 2, comeTime: '17:12', etas: [{ busId: '116-V3', etaTime: 3 }, { busId: '037-V3', etaTime: 13 }] } },
      { node: { id: '12287', goBack: 1, comeTime: '17:08', etas: [] } },
      // (A station TDX doesn't list for 100: left out.)
      { node: { id: '99999', goBack: 1, comeTime: '17:09', etas: [{ busId: 'A', etaTime: 2 }] } }
    ]
  }
};

function site(handler) {
  const asked = [];
  const fetchFn = async (url, init) => {
    assert.equal(url, KH_GQL);
    const body = JSON.parse(init.body);
    asked.push(body);
    return handler(body, asked.length);
  };
  return { asked, deps: { fetchFn, now: () => T0, names } };
}

test("TDX's ids from the site's, and back", () => {
  assert.deepEqual(khStop('KHH1001001172'), { xno: 100, station: '117', goBack: 2 });
  assert.deepEqual(khStop('KHH10010095351'), { xno: 100, station: '9535', goBack: 1 });
  assert.deepEqual(khStop('KHH1151021234561'), { xno: 15102, station: '123456', goBack: 1 });
  assert.equal(khUid(100, '12287', 1), 'KHH100100122871');
  assert.equal(khStop('TXG1234'), null);
  assert.equal(khStop('KHH1001001173'), null);
});

test("stops: each one's own estimate, in TDX's words; one it doesn't answer is the proxy's", async () => {
  resetKh();
  const { asked, deps } = site(body => {
    assert.match(body.query, /stationEstimates/);
    assert.deepEqual(body.variables.t, [
      { xno: 100, stationId: 117, goBack: 2 },
      { xno: 100, stationId: 12287, goBack: 1 },
      { xno: 15102, stationId: 555, goBack: 1 }
    ]);
    return answer({ data: { stationEstimates: { edges: [{ node: { xno: '100', ...R100.estimateTimes.edges[0].node } }, { node: { xno: '100', ...R100.estimateTimes.edges[1].node } }] } } });
  });
  const got = await khEta({ stops: ['KHH1001001172', 'KHH100100122871', 'KHH1151025551'] }, deps);
  assert.equal(asked.length, 1);
  assert.deepEqual(got.missing, ['KHH1151025551']);
  assert.equal(got.at, T0);
  const [a, b] = got.rows;
  assert.deepEqual(
    { StopUID: a.StopUID, RouteUID: a.RouteUID, SubRouteUID: a.SubRouteUID, RouteName: a.RouteName, Direction: a.Direction, StopStatus: a.StopStatus, EstimateTime: a.EstimateTime, PlateNumb: a.PlateNumb, NextBusTime: a.NextBusTime, DataTime: a.DataTime },
    { StopUID: 'KHH1001001172', RouteUID: 'KHH100', SubRouteUID: 'KHH100', RouteName: { Zh_tw: '100百貨幹線' }, Direction: 1, StopStatus: 0, EstimateTime: 180, PlateNumb: '116-V3', NextBusTime: '2026-11-10T17:12:00+08:00', DataTime: '2026-11-10T17:00:00+08:00' }
  );
  assert.deepEqual(
    a.Estimates.map(e => [e.PlateNumb, e.EstimateTime]),
    [
      ['116-V3', 180],
      ['037-V3', 780]
    ]
  );
  assert.deepEqual([b.StopUID, b.Direction, b.StopStatus, b.EstimateTime, b.NextBusTime], ['KHH100100122871', 0, 1, undefined, '2026-11-10T17:08:00+08:00']);
  // Asked again within the beat: the same answer, no ask.
  await khEta({ stops: ['KHH1001001172'] }, deps);
  assert.equal(asked.length, 1);
});

test('a field it says it hasn\'t is left out and the ask made again, and not asked for after', async () => {
  resetKh();
  const { asked, deps } = site((body, n) => {
    if (/isOperationDay|isLast/.test(body.query)) return answer({ errors: [{ message: 'Cannot query field "isOperationDay" on type "EstimateTime".' }, { message: 'Cannot query field "isLast" on type "ETA".' }] });
    return answer({ data: { stationEstimates: { edges: [{ node: { xno: 100, id: '117', goBack: 2, comeTime: '', etas: [{ busId: '116-V3', etaTime: '4' }] } }] } } });
  });
  const got = await khEta({ stops: ['KHH1001001172'] }, deps);
  assert.equal(asked.length, 2);
  assert.ok(!/isOperationDay|isLast/.test(asked[1].query));
  // (Its numbers as numbers, whatever it sends.)
  assert.equal(got.rows[0].EstimateTime, 240);
  // (A minute on, its answer stale: asked again, still without them.)
  await khEta({ stops: ['KHH1001001172'] }, { ...deps, now: () => T0 + 60_000 });
  assert.equal(asked.length, 3);
  assert.ok(!/isOperationDay|isLast/.test(asked[2].query));
});

test('no stationEstimates: a stop\'s route read whole', async () => {
  resetKh();
  const { asked, deps } = site(body => {
    if (/stationEstimates/.test(body.query)) return answer({ errors: [{ message: 'Cannot query field "stationEstimates" on type "Query".' }] });
    assert.match(body.query, /r100: route\(xno: 100, lang: "zh"\)/);
    return answer({ data: { r100: R100 } });
  });
  const got = await khEta({ stops: ['KHH1001001172', 'KHH100100122871'] }, deps);
  assert.deepEqual(
    got.rows.map(r => [r.StopUID, r.EstimateTime ?? null]),
    [
      ['KHH1001001172', 180],
      ['KHH100100122871', null]
    ]
  );
  assert.deepEqual(got.missing, []);
  assert.equal(khDown(T0), false);
  // (Then by route at once.)
  await khEta({ stops: ['KHH10010095351'] }, { ...deps, now: () => T0 + 60_000 });
  assert.ok(!/stationEstimates/.test(asked.at(-1).query));
});

test("a route: its every stop TDX has; one it doesn't know (id 0) is the proxy's", async () => {
  resetKh();
  const { deps } = site(body => answer({ data: /xno: 100,/.test(body.query) ? { r100: R100 } : { r15102: { id: '0', estimateTimes: { edges: [{ node: { id: '1', goBack: 1, comeTime: '', etas: [] } }] } } } }));
  const got = await khEta({ route: 'KHH100' }, deps);
  assert.deepEqual(
    got.rows.map(r => [r.StopUID, r.RouteName.Zh_tw, r.Direction]),
    [
      ['KHH1001001172', '100百貨幹線', 1],
      ['KHH100100122871', '100百貨幹線', 0]
    ]
  );
  assert.deepEqual(got.missing, []);
  const other = await khEta({ route: 'KHH15102' }, deps);
  assert.deepEqual([other.rows, other.missing], [[], ['KHH15102']]);
});

test('its buses: where each is, in TDX\'s words; a place off the map left out', async () => {
  resetKh();
  const { deps } = site(() => answer({ data: { r100: { id: '100', buses: { edges: [{ goBack: 1, node: { id: '116-V3', lat: 22.61, lon: '120.33', azimuth: 90 } }, { goBack: 2, node: { id: '037-V3', lat: 0, lon: 0 } }] } } } }));
  const got = await khGps(['KHH100'], deps);
  assert.deepEqual(got.rows, [{ RouteUID: 'KHH100', SubRouteUID: 'KHH100', PlateNumb: '116-V3', Direction: 0, BusPosition: { PositionLat: 22.61, PositionLon: 120.33 }, GPSTime: '2026-11-10T17:00:00+08:00', Speed: null, Azimuth: 90 }]);
  assert.deepEqual(got.missing, []);
});

test('the site failing (a phone abroad): refused at once, and for 5 minutes', async () => {
  resetKh();
  let n = 0;
  const deps = { fetchFn: async () => (n++, Promise.reject(new TypeError('Failed to fetch'))), now: () => T0, names };
  await assert.rejects(khEta({ stops: ['KHH1001001172'] }, deps));
  assert.equal(khDown(T0 + 1000), true);
  await assert.rejects(khEta({ route: 'KHH100' }, { ...deps, now: () => T0 + 60_000 }));
  assert.equal(n, 1);
  assert.equal(khDown(T0 + 6 * 60_000), false);
});

// Through the app's own asks (api.mjs busEta / busGps): 高雄's from the site,
// what it couldn't answer from the Worker; the site failing, the Worker's.
test("busEta and busGps: 高雄's from the city's site, the rest (or all, when it fails) the Worker's", async () => {
  resetKh();
  const api = await import('../public/lib/api.mjs');
  const was = globalThis.fetch;
  const worker = [];
  let siteUp = true;
  globalThis.fetch = async (url, init) => {
    if (url === KH_GQL) {
      if (!siteUp) throw new TypeError('Failed to fetch');
      const body = JSON.parse(init.body);
      if (/buses/.test(body.query)) return answer({ data: { r100: { id: '100', buses: { edges: [{ goBack: 2, node: { id: '116-V3', lat: 22.6, lon: 120.3 } }] } } } });
      return answer({ data: { stationEstimates: { edges: [{ node: { xno: 100, ...R100.estimateTimes.edges[0].node } }] } } });
    }
    const u = new URL(url);
    worker.push(decodeURIComponent(u.pathname + u.search).replace(/&qt=.*$/, ''));
    if (u.pathname === '/transit/eta') return answer((u.searchParams.get('stops') || '').split(',').map(s => ({ StopUID: s, RouteUID: 'KHH15102', EstimateTime: 60 })));
    if (u.pathname === '/transit/gps') return answer([{ RouteUID: 'KHH15102', PlateNumb: 'W', Direction: 0 }]);
    return answer([]);
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const got = await api.busEta('Kaohsiung', { stops: ['KHH1001001172', 'KHH1151025551'] });
    assert.deepEqual(
      got.rows.map(r => [r.StopUID, r.EstimateTime]),
      [
        ['KHH1001001172', 180],
        ['KHH1151025551', 60]
      ]
    );
    assert.deepEqual(worker.filter(x => x.startsWith('/transit/eta')), ['/transit/eta?city=Kaohsiung&stops=KHH1151025551']);
    const gps = await api.busGps('Kaohsiung', ['KHH100']);
    assert.deepEqual(
      gps.rows.map(r => [r.PlateNumb, r.Direction]),
      [['116-V3', 1]]
    );
    assert.equal(worker.filter(x => x.startsWith('/transit/gps')).length, 0);
    // The site gone: the Worker's, all of it.
    siteUp = false;
    resetKh();
    const again = await api.busEta('Kaohsiung', { stops: ['KHH100100122871'] });
    assert.deepEqual(again.rows, [{ StopUID: 'KHH100100122871', RouteUID: 'KHH15102', EstimateTime: 60 }]);
    const gps2 = await api.busGps('Kaohsiung', ['KHH15102']);
    assert.deepEqual(gps2.rows, [{ RouteUID: 'KHH15102', PlateNumb: 'W', Direction: 0 }]);
    // A city no phone reads: the Worker's, never the site.
    await api.busEta('Taipei', { stops: ['TPE1'] });
    assert.ok(worker.includes('/transit/eta?city=Taipei&stops=TPE1'));
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
    resetKh();
  }
});
