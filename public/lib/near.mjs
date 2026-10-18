// What's near a point, worked out on the phone instead of asked of TDX
// around every point (the proxy lets TDX take 4 asks a second: a trip's 50
// asks were 10 seconds):
//
//   stationsAround  the bus stops within a kilometre, from the bus packs
//                   kept here (Shared-Data's where.json says which packs
//                   have stops near: a city's, the 公路客運's square)
//   etaAround       the buses due at the stops near a point: their stops
//                   from the packs, then one ask a city for every stop
//                   wanted at that moment (a trip's ten buses, one ask)
//   bikesAround     the YouBike stations within a kilometre: the city's
//                   (one ask a city, the same the map makes)
//
// Each falls back to TDX's own search around the point when the packs
// can't be had.

import * as kit from '#kit/quadra.mjs';
import { tdx, rows, dataAt, liveMs } from './api.mjs';
import { pack } from './packs.mjs';
import { stationsNear, etaOf, routeCity } from './bus.mjs';
import { cityBikes, bikesNear } from './bike.mjs';
import { meters, zh } from './util.mjs';

// where.json (kept a day, the kit's packJson): { cell, packs: [name…], cells: { "<i>_<j>": [k…] } }; null when it can't be had.
let given = null;
export const where = () => given || kit.packJson('where.json', { ttl: 20 * 3_600_000 }).catch(() => null);
// (The tests' own.)
export const useWhere = w => (given = Promise.resolve(w));

// The packs (and bike cities: 'bike:Hsinchu') with something within r metres of a point.
export function namesAround(w, lat, lon, r) {
  const dLat = r / 111_000;
  const dLon = r / (111_000 * Math.cos((lat * Math.PI) / 180));
  const c = w.cell;
  const out = new Set();
  for (let i = Math.floor((lat - dLat) / c); i <= Math.floor((lat + dLat) / c); i++)
    for (let j = Math.floor((lon - dLon) / c); j <= Math.floor((lon + dLon) / c); j++) for (const k of w.cells[`${i}_${j}`] || []) out.add(w.packs[k]);
  return [...out];
}

// A pack's stops with the routes through each: [{ uid, name, lat, lon, routes: [{ uid, name }] }].
const indexed = new WeakMap();
export function packStops(p) {
  if (indexed.has(p)) return indexed.get(p);
  const by = new Map();
  for (const r of p.raw.routes || [])
    for (const list of [...(r.ways || []).map(w => w[3]), ...(r.sched || []).map(s => s[2])])
      for (const u of list) {
        const s = p.raw.stops[u];
        if (!s || s[1] == null) continue;
        if (!by.has(u)) by.set(u, { uid: u, name: s[0], lat: s[1], lon: s[2], routes: new Map() });
        by.get(u).routes.set(r.uid, r.name);
      }
  const out = [...by.values()].map(s => ({ ...s, routes: [...s.routes].map(([uid, name]) => ({ uid, name })) }));
  indexed.set(p, out);
  return out;
}

// The bus stops within r metres, each with its TDX scope ('HsinchuCounty',
// 'InterCity'); null when a pack it needs can't be had (then TDX is asked).
export async function stopsAround(lat, lon, r = 1000, { packFn = pack } = {}) {
  const w = await where();
  if (!w) return null;
  const names = namesAround(w, lat, lon, r).filter(n => !n.startsWith('bike:'));
  const packs = await Promise.all(names.map(n => packFn(n).catch(() => null)));
  if (packs.some(p => !p)) return null;
  const dLat = r / 111_000;
  const out = new Map();
  names.forEach((n, i) => {
    const scope = n.startsWith('InterCity') ? 'InterCity' : n;
    for (const s of packStops(packs[i])) {
      if (Math.abs(s.lat - lat) > dLat || out.has(s.uid)) continue;
      const d = meters(lat, lon, s.lat, s.lon);
      if (d <= r) out.set(s.uid, { ...s, scope, d });
    }
  });
  return [...out.values()].sort((a, b) => a.d - b.d);
}

// Stations as TDX's NearBy gives them (bus.mjs stationsNear), one a stop:
// [{ uid, name, lat, lon, stops: [{ stopUID, routeUID, route, scope }] }].
export async function stationsAround(lat, lon, opts) {
  const list = await stopsAround(lat, lon, 1000, opts).catch(() => null);
  if (!list) return stationsNear(lat, lon);
  return list.map(s => ({ uid: s.uid, id: '', name: s.name, lat: s.lat, lon: s.lon, cityCode: '', bearing: '', routes: s.routes.map(r => r.name), stops: s.routes.map(r => ({ stopUID: s.uid, routeUID: r.uid, route: r.name, scope: s.scope })) }));
}

// ---- When the buses come, a city's stops in one ask -----------------------------------------------

const FIELDS = '$select=StopUID,StopName,RouteUID,RouteName,Direction,EstimateTime,StopStatus,NextBusTime,IsLastBus,Estimates,PlateNumb,DataTime';
const ETA_FRESH = 20_000;
const CHUNK = 40; // stops an ask (the address stays short)
const etaKept = new Map(); // `${scope}|${uid}` → { at, rows }
const pending = new Map(); // `${scope}|${uid}` → the batch asking for it
let batch = null;

// The asks made in the same moment (a trip's plans, side by side) go together.
function queue(scope, uids, ask, fresh) {
  if (!batch) {
    const b = (batch = { asks: new Map(), fresh });
    b.done = new Promise(r => setTimeout(r, 25)).then(() => {
      batch = null;
      return flush(b.asks, ask, b.fresh);
    });
  }
  batch.fresh = Math.min(batch.fresh, fresh);
  if (!batch.asks.has(scope)) batch.asks.set(scope, new Set());
  for (const u of uids) batch.asks.get(scope).add(u);
  return batch.done;
}
async function flush(asks, ask, fresh) {
  const jobs = [];
  for (const [scope, set] of asks) {
    const uids = [...set].sort();
    for (let i = 0; i < uids.length; i += CHUNK) {
      const part = uids.slice(i, i + CHUNK);
      const path = `basic/v2/Bus/EstimatedTimeOfArrival/${scope === 'InterCity' ? 'InterCity' : `City/${scope}`}?$filter=${part.map(u => `StopUID eq '${u.replace(/'/g, "''")}'`).join(' or ')}&${FIELDS}`;
      jobs.push(
        ask(path, { fresh }).then(j => {
          // (When the data is from: the proxy's copy when TDX was slow.)
          const at = Math.min(Date.now(), dataAt(path) || Date.now());
          const by = new Map(part.map(u => [u, []]));
          for (const r of rows(j)) by.get(r.StopUID)?.push(r);
          for (const [u, list] of by) etaKept.set(`${scope}|${u}`, { at, rows: list });
        })
      );
    }
  }
  await Promise.allSettled(jobs);
}

// N1 rows for these stops ([{ uid, scope }]); throws when any couldn't be read.
// `fresh`: how old a copy may be (ms; a stop's card asks at the live speed).
export async function etaStops(stops, { ask = tdx, fresh = ETA_FRESH } = {}) {
  const key = s => `${s.scope}|${s.uid}`;
  const young = s => Date.now() - (etaKept.get(key(s))?.at ?? -Infinity) < fresh;
  const waits = new Set();
  const by = new Map();
  for (const s of stops) {
    if (young(s)) continue;
    if (pending.has(key(s))) waits.add(pending.get(key(s)));
    else by.set(s.scope, [...(by.get(s.scope) || []), s.uid]);
  }
  for (const [scope, uids] of by) {
    const done = queue(scope, uids, ask, fresh);
    waits.add(done);
    for (const u of uids) pending.set(`${scope}|${u}`, done);
    done.finally(() => uids.forEach(u => pending.get(`${scope}|${u}`) === done && pending.delete(`${scope}|${u}`)));
  }
  await Promise.all(waits);
  if (stops.some(s => !etaKept.has(key(s)))) throw new Error('eta');
  return stops.flatMap(s => etaKept.get(key(s)).rows);
}

// A bus stop's card (the map's stations, `stops` each): every bus due at its
// signs, one ask a city for all of them, as a trip's (TDX's advanced read a
// station was an ask a sign), at the live speed. Each row with its sign (`st`).
export async function stationEta(stations, { ask = tdx } = {}) {
  const of = new Map();
  for (const st of stations) for (const x of st.stops || []) if (x.stopUID && !of.has(x.stopUID)) of.set(x.stopUID, { uid: x.stopUID, scope: x.scope || routeCity(x.stopUID), st });
  if (!of.size) return [];
  const got = await etaStops([...of.values()], { ask, fresh: liveMs() - 1000 });
  return got.map(r => {
    const s = of.get(r.StopUID);
    return { ...etaOf(r), route: zh(r.RouteName), routeUID: r.RouteUID, stopUID: r.StopUID, dir: r.Direction, city: s.scope, st: s.st };
  });
}

// Every bus due at the stops within r metres (as live.mjs etaNear).
export async function etaAround(lat, lon, r = 150, { ask = tdx, near = null } = {}) {
  const list = await stopsAround(lat, lon, r).catch(() => null);
  if (!list) return near ? near(lat, lon, r) : (await import('./live.mjs')).etaNear(lat, lon, r);
  return list.length ? etaStops(list, { ask }) : [];
}

// ---- YouBike -----------------------------------------------------------------------------------------

// The stations within a kilometre, bikes and docks now: each city's whole
// list (one ask a city, shared with the map), the near ones kept.
export async function bikesAround(lat, lon, { bikes = cityBikes } = {}) {
  const w = await where();
  if (!w) return bikesNear(lat, lon);
  const cities = namesAround(w, lat, lon, 1000)
    .filter(n => n.startsWith('bike:'))
    .map(n => n.slice(5));
  const lists = await Promise.all(cities.map(c => bikes(c)));
  return lists.flat().filter(s => Math.abs(s.lat - lat) < 0.01 && meters(lat, lon, s.lat, s.lon) <= 1000);
}
