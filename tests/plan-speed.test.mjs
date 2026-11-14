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

test("a slow ask for 台鐵's notices never holds the trains: the notices last read answer within the wait, the fresh ones after (Jay 2026-11-14: 1.3–2.7 s on every plan)", async () => {
  const { traNotices, traNoticesSoon } = await import('../public/lib/service.mjs');
  useSession({ ensureToken: async () => 'T' });
  const was = globalThis.fetch;
  const wasNow = Date.now;
  let slow = 0;
  globalThis.fetch = async url => {
    const u = decodeURIComponent(String(url?.url || url));
    const j = b => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
    if (u.includes('TRA/Alert')) {
      if (slow) await new Promise(r => setTimeout(r, slow));
      return j({ Alerts: [] });
    }
    if (u.includes('StationOfLine')) return j({ StationOfLines: [] });
    if (u.includes('TRA/Line')) return j({ Lines: [] });
    return j([]);
  };
  try {
    await traNotices();
    // Four minutes on (past the 3 minutes they're fresh), TDX answering in 3 s.
    const t = wasNow() + 4 * 60_000;
    Date.now = () => t;
    slow = 3000;
    const t0 = performance.now();
    const got = await traNoticesSoon(100);
    assert.ok(performance.now() - t0 < 1500, `${Math.round(performance.now() - t0)} ms`);
    assert.deepEqual(got.rules, []);
  } finally {
    globalThis.fetch = was;
    Date.now = wasNow;
  }
});

test("the day's trains kept on the phone are used at once, read again behind; tomorrow's read in the afternoon", () => {
  const src = readFileSync(new URL('../public/lib/raildata.mjs', import.meta.url), 'utf8');
  const raw = src.slice(src.indexOf('function rawTrips'), src.indexOf('async function readTrips'));
  assert.match(raw, /if \(old && old\.at <= Date\.now\(\)\) \{\s*readTrips\(date, old\)\.catch\(\(\) => \{\}\);\s*return unpackTrips\(old\.data\);/);
  assert.match(src, /dayTrips[\s\S]*traNoticesSoon\(\)/);
  assert.match(src.slice(src.indexOf('export function warmRail')), /readTrips\(addDays\(date, 1\)\)/);
});
