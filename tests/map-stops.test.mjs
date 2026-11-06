// The map's bus stops (and the stops near you): the stations within 1 km of
// a point, from the weekly station tiles the proxy's bus builder writes
// (station/<City>/<lat>_<lon>.json, 0.05° each, every city's listed in
// station/index.json), read once and kept here. TDX's own search around a
// point was an advanced ask (7.5 basic ones' points) at each new ~200 m the
// map was moved to (2026-11-06: two at 竹東 in one look); it's asked now only
// when a tile can't be had.
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const LIST = { v: 1, built: '2026-11-06T10:24:00.000Z', tile: 0.05, cities: { Hsinchu: ['24.75_120.95', '24.80_120.95'], HsinchuCounty: ['24.70_121.05', '24.80_120.95'], InterCity: ['24.80_120.95', '25.00_121.55'], Taipei: ['25.00_121.55'] } };
const R = { HSZ0010: ['10', '10'], HSZ0020: ['20', '20'] };
const TILES = {
  // 新竹站's two signs (~52 m and ~45 m from the point), one 1.5 km off (past 1000 m).
  'Hsinchu/24.80_120.95': { routes: R, stations: [['HSZ1', '1', '新竹站', 'Hsinchu Station', 24.80168, 120.97162, 'HSZ', 'W', [['HSZ11', 'HSZ0010'], ['HSZ12', 'HSZ0020']]], ['HSZ2', '2', '新竹站', 'Hsinchu Station', 24.8020, 120.97245, 'HSZ', 'E', [['HSZ21', 'HSZ0010']]], ['HSZ3', '3', '遠站', '', 24.8155, 120.972, 'HSZ', 'N', [['HSZ31', 'HSZ0020']]]] },
  // Across the tile's edge, 400 m south: read too.
  'Hsinchu/24.75_120.95': { routes: R, stations: [['HSZ4', '4', '南站', 'South', 24.7984, 120.972, 'HSZ', 'S', [['HSZ41', 'HSZ0020']]]] },
  'HsinchuCounty/24.80_120.95': { routes: { HSQ5608: ['5608', ''] }, stations: [['HSQ7', '7', '東門', '', 24.8030, 120.9725, 'HSZ', '', [['HSQ71', 'HSQ5608']]]] },
  'InterCity/24.80_120.95': { routes: { THB1728: ['1728', '1728'] }, stations: [['THB103245', '103245', '公園站', '', 24.80227, 120.97838, 'HSZ', 'W', [['THB273805', 'THB1728']]]] }
};

function fake(asked) {
  return async url => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname + u.search).replace(/&qt=.*$/, '');
    asked.push(path);
    if (u.pathname === '/data/station/index.json') return answer(LIST);
    const t = /^\/data\/station\/(.+)\.json$/.exec(u.pathname);
    if (t) return TILES[t[1]] ? answer({ v: 1, city: t[1].split('/')[0], tile: t[1].split('/')[1], built: LIST.built, ...TILES[t[1]] }) : new Response('{"error":{"message":"Not found"}}', { status: 404 });
    if (u.pathname === '/transit/tdx' && /Bus\/Station\/NearBy/.test(u.searchParams.get('p') || ''))
      return answer([{ StationUID: 'TPE9', StationID: '9', StationName: { Zh_tw: '市政府' }, StationPosition: { PositionLat: 25.0405, PositionLon: 121.5655 }, Stops: [{ StopUID: 'TPE91', RouteUID: 'TPE10', RouteName: { Zh_tw: '藍5' } }], LocationCityCode: 'TPE', Bearing: 'E' }]);
    return answer([]);
  };
}

test("the map's bus stops from the station tiles kept here: TDX's search around the point never asked", async () => {
  const api = await import('../public/lib/api.mjs');
  const { stationsNear } = await import('../public/lib/bus.mjs');
  const { meters } = await import('../public/lib/util.mjs');
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = fake(asked);
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const got = await stationsNear(24.8016, 120.9716);
    // Within 1000 m of the point rounded to 0.002° (24.802, 120.972), nearest first, as TDX's search gave them.
    assert.deepEqual(
      got.map(s => [s.uid, Math.round(meters(24.802, 120.972, s.lat, s.lon))]),
      [['HSZ2', 45], ['HSZ1', 52], ['HSQ7', 122], ['HSZ4', 400], ['THB103245', 645]]
    );
    assert.deepEqual(got[1], { uid: 'HSZ1', id: '1', name: '新竹站', lat: 24.80168, lon: 120.97162, cityCode: 'HSZ', bearing: 'W', routes: ['10', '20'], stops: [{ stopUID: 'HSZ11', routeUID: 'HSZ0010', route: '10' }, { stopUID: 'HSZ12', routeUID: 'HSZ0020', route: '20' }] });
    assert.equal(got[2].bearing, '');
    assert.deepEqual(got[2].routes, ['5608']);
    // Only the tiles near the point (both sides of a tile's edge), each read once; no TDX ask.
    assert.deepEqual(asked.filter(x => x.startsWith('/data/station/')).sort(), ['/data/station/Hsinchu/24.75_120.95.json', '/data/station/Hsinchu/24.80_120.95.json', '/data/station/HsinchuCounty/24.80_120.95.json', '/data/station/InterCity/24.80_120.95.json', '/data/station/index.json']);
    assert.equal(asked.filter(x => x.startsWith('/transit/')).length, 0);
    // The map moved 300 m: the same tiles, nothing asked at all.
    const n = asked.length;
    const moved = await stationsNear(24.8043, 120.9716);
    assert.ok(moved.some(s => s.uid === 'HSZ3') === false && moved.length >= 4);
    // No city's tile near (the mountains): no stops, and nothing asked.
    assert.deepEqual(await stationsNear(23.5, 121.0), []);
    assert.equal(asked.length, n);
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});

test("a station tile that can't be had: TDX's search around the point, as before", async () => {
  const api = await import('../public/lib/api.mjs');
  const { stationsNear } = await import('../public/lib/bus.mjs');
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = fake(asked);
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    // (Taipei's tile is there, 公路客運's isn't.)
    const got = await stationsNear(25.0405, 121.5655);
    assert.deepEqual(got.map(s => [s.uid, s.name, s.routes]), [['TPE9', '市政府', ['藍5']]]);
    assert.equal(asked.filter(x => /Bus\/Station\/NearBy\?\$spatialFilter=nearby\(25\.040,121\.566,1000\)/.test(x)).length, 1);
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});
