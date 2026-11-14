// Trip planning's waits (2026-11-14, Jay: "Speed up orbit transit trip
// planning it's so slow right now"): 新竹站 → 新竹高中 took 10 s, 竹北 →
// 臺北車站 7 to 11 s, before any way showed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { etaStops, chunkOf, SITE_CHUNK } from '../public/lib/near.mjs';
import { cityBikesNear, YB_LIVE, ybDrop } from '../public/lib/bike.mjs';
import { useSession } from '../public/lib/api.mjs';
import { SETTLE_MS } from '../public/lib/steady.mjs';

test("新竹's and 公路客運's stops asked 30 an ask (the Worker reads 30 from 新竹's site at once, the rest after); 臺北's 300", async () => {
  const asks = [];
  const ask = async (scope, { stops }) => (asks.push([scope, stops.length]), { rows: stops.map(u => ({ StopUID: u, RouteUID: 'R' })), at: Date.now() });
  const hsz = Array.from({ length: 157 }, (_, i) => ({ uid: `HSZ9${String(i).padStart(5, '0')}`, scope: 'Hsinchu' }));
  const tpe = Array.from({ length: 157 }, (_, i) => ({ uid: `TPE9${String(i).padStart(5, '0')}`, scope: 'Taipei' }));
  const got = await etaStops([...hsz, ...tpe], { ask });
  assert.equal(got.length, 314, 'every stop answered');
  const h = asks.filter(([s]) => s === 'Hsinchu').map(([, n]) => n);
  assert.equal(h.length, 6);
  assert.ok(h.every(n => n <= SITE_CHUNK), String(h));
  assert.deepEqual(asks.filter(([s]) => s === 'Taipei').map(([, n]) => n), [157], 'a whole-city feed: one ask');
  assert.equal(chunkOf('InterCity'), SITE_CHUNK);
  assert.equal(chunkOf('HsinchuCounty'), SITE_CHUNK);
});

test("YouBike near a point: only the circles that can hold a station near it, never the whole city's", async () => {
  useSession({ ensureToken: async () => 'T' });
  ybDrop();
  const was = globalThis.fetch;
  const posts = [];
  // 臺北: two stations 30 km apart, each its own circle.
  const st = (no, lat, lon) => ({ StationUID: `TPE${no}`, StationName: { Zh_tw: `YouBike2.0_站${no}`, En: `S${no}` }, StationPosition: { PositionLat: lat, PositionLon: lon }, BikesCapacity: 20, ServiceType: 2 });
  const list = [st('500101001', 25.0478, 121.517), st('500101002', 25.3, 121.6)];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url?.url || url));
    const j = b => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
    if (u === YB_LIVE) {
      const b = JSON.parse(init.body);
      posts.push(b);
      return j({ retCode: 1, retVal: list.filter(s => Math.abs(s.StationPosition.PositionLat - b.lat) < 0.05).map(s => ({ station_no: s.StationUID.slice(3), available_spaces: 5, available_spaces_detail: { yb2: 5, eyb: 0 }, empty_spaces: 15, status: 1 })) });
    }
    if (u.includes('Bike/Station')) return j(list);
    return j([]);
  };
  try {
    const got = await cityBikesNear('Taipei', 25.048, 121.517);
    assert.deepEqual(got.map(s => [s.uid, s.bikes]), [['TPE500101001', 5]]);
    assert.equal(posts.length, 1, 'one circle asked, not both');
    assert.ok(Math.abs(posts[0].lat - 25.0478) < 0.001);
  } finally {
    globalThis.fetch = was;
    ybDrop();
  }
});

test("the second round's looks (direct buses, buses to the trains) start with the first, not after it; the whole plan waits 3 s at most", () => {
  const src = readFileSync(new URL('../public/lib/planner.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function planTrip'));
  const at = s => body.indexOf(s);
  assert.ok(at('const directAsk = ') > 0 && at('const directAsk = ') < at('const first = await finishOff'), 'busLink asked before the first round');
  assert.ok(at('const toRailAsk =') > 0 && at('const toRailAsk =') < at('const first = await finishOff'), 'busToRail asked before the first round');
  assert.ok(!/busLink\(from, to, tS[^\n]*trace: busTrace/.test(body), 'not asked again in the second round');
  assert.ok(at('list.slice(0, WARM_STOPS)') > 0, "the start's warm-up keeps to the nearest stops");
  assert.ok(SETTLE_MS <= 3000);
});
