// 臺中's and 桃園's buses read by the phone from the cities' own bus sites
// (Jay 2026-11-10: what a phone can read, it reads), with the kit's reader
// (kit/ebus-read.mjs, the proxy's too); the Worker's for what they can't
// answer, and alone for 5 minutes after a site fails.
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const T0 = Date.parse('2026-11-10T14:30:00+08:00');
const TY_GQL = 'https://ebus.tycg.gov.tw/ebus/graphql';
const TC_GQL = 'https://citybus.taichung.gov.tw/ebus/graphql';
// 桃園's pack, as bus/Taoyuan.json has it: route 3550 (611 on its way back), 712 (a loop, one way).
const TY_PACK = {
  routes: [
    { uid: 'TAO3550', name: '3550', ways: [['TAO355001', '3550', 0, ['TAO600', 'TAO605']], ['TAO355002', '3550', 1, ['TAO605', 'TAO611']]] },
    { uid: 'TAO712', name: '712', ways: [['TAO71201', '712', 0, ['TAO9566', 'TAO9570']]] }
  ],
  stops: { TAO611: ['中壢公車站'], TAO9566: ['桃園高鐵站'], TAO9570: ['青埔'] }
};
const eta = (min, x = {}) => ({ comeTime: '', isOperationDay: true, isSuspended: false, isConstruction: false, isEvent: false, etas: min == null ? [] : [{ etaTime: min, isLast: false, busId: 'AAA-1' }], ...x });
// The site: a stop's estimates by route, station and way; a route's places and estimates; its buses.
function tySite(log) {
  return async (url, init) => {
    assert.equal(url, TY_GQL);
    const body = JSON.parse(init.body);
    log.push(body.variables?.t ? 'stops' : /buses/.test(body.query) ? 'buses' : /estimateTimes \{ edges \{ node \{ id goBack \}/.test(body.query) ? 'places' : 'route');
    if (body.variables?.t) return answer({ data: { stationEstimates: { edges: body.variables.t.map(t => ({ node: { xno: t.xno, id: String(t.stationId), goBack: t.goBack, ...eta(t.stationId === 611 ? 4 : 9) } })) } } });
    const data = {};
    for (const [, alias, x] of body.query.matchAll(/(r\d+): route\(xno: (\d+)/g)) {
      if (x === '3550') data[alias] = { id: x, estimateTimes: { edges: [{ node: { id: 611, goBack: 2, ...eta(4) } }, { node: { id: 605, goBack: 1, ...eta(2) } }, { node: { id: 605, goBack: 2, ...eta(12) } }] }, buses: { edges: [{ goBack: 2, node: { id: 'KKA-123', lat: 24.95, lon: 121.22, azimuth: 90 } }] } };
      else if (x === '712') data[alias] = { id: x, estimateTimes: { edges: [{ node: { id: 9566, goBack: 1, ...eta(20) } }, { node: { id: 9566, goBack: 2, ...eta(3) } }] }, buses: { edges: [] } };
      else data[alias] = { id: '0', estimateTimes: { edges: [] }, buses: { edges: [] } };
    }
    return answer({ data });
  };
}

test("桃園's stops from its own site: each route the ways the pack has it at, a loop's halves the sooner; kept 20 s; a stop it doesn't know the Worker's", async () => {
  const { ebEta, resetEb, ebPhone } = await import('../public/lib/ebbus.mjs');
  resetEb();
  const log = [];
  const deps = { fetchFn: tySite(log), now: T0, pack: async () => (await import('../.kit/ebus-read.mjs')).packIndex(TY_PACK) };
  assert.ok(ebPhone('Taoyuan', T0) && ebPhone('Taichung', T0) && !ebPhone('Taipei', T0) && !ebPhone('Kaohsiung', T0));
  const got = await ebEta('Taoyuan', { stops: ['TAO611', 'TAO9566', 'TAO1'] }, deps);
  assert.deepEqual(
    got.rows.map(r => [r.StopUID, r.RouteUID, r.Direction, r.EstimateTime]).sort(),
    [
      ['TAO611', 'TAO3550', 1, 240],
      ['TAO9566', 'TAO712', 0, 540]
    ]
  );
  assert.equal(got.rows.find(r => r.StopUID === 'TAO611').StopName.Zh_tw, '中壢公車站');
  assert.deepEqual(got.missing, ['TAO1'], "a stop the pack doesn't have: the Worker's");
  assert.equal(got.at, T0);
  assert.deepEqual(log, ['places', 'stops']);
  await ebEta('Taoyuan', { stops: ['TAO611'] }, { ...deps, now: T0 + 10_000 });
  assert.deepEqual(log, ['places', 'stops'], 'kept 20 s');
  await ebEta('Taoyuan', { stops: ['TAO611'] }, { ...deps, now: T0 + 25_000 });
  assert.deepEqual(log, ['places', 'stops', 'stops'], "again after 20 s (the routes' stations kept a day)");
});

test("桃園's routes asked within a moment: one read of the site, each route its own rows; its buses; a route it doesn't know the Worker's", async () => {
  const { ebEta, ebGps, resetEb } = await import('../public/lib/ebbus.mjs');
  resetEb();
  const log = [];
  const deps = { fetchFn: tySite(log), now: T0, pack: async () => (await import('../.kit/ebus-read.mjs')).packIndex(TY_PACK) };
  const [a, b, c] = await Promise.all([ebEta('Taoyuan', { route: 'TAO3550' }, deps), ebEta('Taoyuan', { route: 'TAO712' }, deps), ebEta('Taoyuan', { route: 'TAO9999' }, deps)]);
  assert.deepEqual(log, ['route'], 'one read for the three');
  assert.deepEqual(a.rows.map(r => [r.StopUID, r.Direction, r.EstimateTime]).sort(), [['TAO605', 0, 120], ['TAO605', 1, 720], ['TAO611', 1, 240]]);
  assert.deepEqual(b.rows.map(r => [r.StopUID, r.Direction, r.EstimateTime]), [['TAO9566', 0, 180]], "a loop's two halves: TDX's one way, the sooner");
  assert.deepEqual([a.missing, b.missing, c.missing, c.rows], [[], [], ['TAO9999'], []]);
  const g = await ebGps('Taoyuan', ['TAO3550', 'TAO9999'], deps);
  assert.deepEqual(g.rows.map(x => [x.PlateNumb, x.Direction, x.BusPosition.PositionLat]), [['KKA-123', 1, 24.95]]);
  assert.deepEqual(g.missing, ['TAO9999']);
});

test("a site that fails: the Worker's, and the Worker's alone 5 minutes", async () => {
  const { ebEta, resetEb, ebPhone } = await import('../public/lib/ebbus.mjs');
  resetEb();
  const fetchFn = async () => {
    throw new TypeError('Failed to fetch');
  };
  const got = await ebEta('Taoyuan', { stops: ['TAO611'] }, { fetchFn, now: T0, pack: async () => (await import('../.kit/ebus-read.mjs')).packIndex(TY_PACK) });
  assert.deepEqual([got.rows, got.missing], [[], ['TAO611']]);
  assert.ok(!ebPhone('Taoyuan', T0 + 60_000), 'down: the Worker alone');
  await assert.rejects(ebEta('Taoyuan', { stops: ['TAO611'] }, { fetchFn, now: T0 + 60_000 }));
  assert.ok(ebPhone('Taoyuan', T0 + 6 * 60_000), 'back after 5 minutes');
  assert.ok(ebPhone('Taichung', T0 + 60_000), 'only that city');
});

// Through the app's own asks (api.mjs busEta / busGps).
test("busEta and busGps: 臺中's from the city's site, what it can't answer the Worker's; the site failing, the Worker's; 臺北's always the Worker's", async () => {
  const { resetEb } = await import('../public/lib/ebbus.mjs');
  resetEb();
  const api = await import('../public/lib/api.mjs');
  const was = globalThis.fetch;
  const worker = [];
  let siteUp = true;
  const TC_PACK = { routes: [{ uid: 'TXG300', name: '300', ways: [['TXG300', '300', 0, ['TXG7001', 'TXG7002']]] }], stops: { TXG7001: ['臺中車站'] } };
  globalThis.fetch = async (url, init) => {
    if (url === TC_GQL) {
      if (!siteUp) throw new TypeError('Failed to fetch');
      const body = JSON.parse(init.body);
      if (body.variables?.t) return answer({ data: { stationEstimates: { edges: body.variables.t.map(t => ({ node: { xno: t.xno, id: t.stationId, goBack: t.goBack, ...eta(5) } })) } } });
      if (/buses/.test(body.query)) return answer({ data: { r300: { id: '300', buses: { edges: [{ goBack: 1, node: { id: '123-U8', lat: 24.14, lon: 120.68, azimuth: 10, dataTime: String(Math.floor(Date.now() / 1000)) } }] } } } });
      return answer({ data: { r300: { id: '300', stations: { edges: [{ sid: 7001, goBack: 1, node: { id: '51' } }] } } } });
    }
    const u = new URL(url);
    if (u.pathname.endsWith('/bus/Taichung.json')) return answer(TC_PACK);
    worker.push(decodeURIComponent(u.pathname + u.search).replace(/&qt=.*$/, ''));
    if (u.pathname === '/transit/eta') return answer((u.searchParams.get('stops') || '').split(',').map(s => ({ StopUID: s, RouteUID: 'W', EstimateTime: 60 })));
    if (u.pathname === '/transit/gps') return answer([{ RouteUID: 'W', PlateNumb: 'W', Direction: 0 }]);
    return answer([]);
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const got = await api.busEta('Taichung', { stops: ['TXG7001', 'TXG8888'] });
    assert.deepEqual(
      got.rows.map(r => [r.StopUID, r.RouteUID, r.EstimateTime]).sort(),
      [
        ['TXG7001', 'TXG300', 300],
        ['TXG8888', 'W', 60]
      ]
    );
    assert.deepEqual(worker.filter(x => x.startsWith('/transit/eta')), ['/transit/eta?city=Taichung&stops=TXG8888'], 'the Worker for the stop the site has not');
    const gps = await api.busGps('Taichung', ['TXG300']);
    assert.deepEqual(gps.rows.map(r => r.PlateNumb), ['123-U8']);
    assert.equal(worker.filter(x => x.startsWith('/transit/gps')).length, 0);
    // The site gone: the Worker's, all of it.
    siteUp = false;
    resetEb();
    const again = await api.busEta('Taichung', { stops: ['TXG7002'] });
    assert.deepEqual(again.rows, [{ StopUID: 'TXG7002', RouteUID: 'W', EstimateTime: 60 }]);
    const gps2 = await api.busGps('Taichung', ['TXG300']);
    assert.deepEqual(gps2.rows, [{ RouteUID: 'W', PlateNumb: 'W', Direction: 0 }]);
    // 臺北's: the Worker's, never a site.
    await api.busEta('Taipei', { stops: ['TPE1'] });
    assert.ok(worker.includes('/transit/eta?city=Taipei&stops=TPE1'));
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
    resetEb();
  }
});
