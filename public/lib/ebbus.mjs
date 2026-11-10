// 臺中's and 桃園's buses read by the phone itself, from the cities' own bus
// sites (one maker's GraphQL, open to any page, no key), with the kit's
// reader (kit/ebus-read.mjs), the one the proxy reads them with: Jay
// 2026-11-10, "Everything in our apps that could be read from our phone
// should be read from our phone to minimize pressure for the cloudflare".
// Rows are TDX's, as the proxy answers them. Whatever the site can't answer
// (a stop or route it doesn't know, too many asked, an older kit) is the
// proxy's; once an ask of the site fails, the proxy's alone for 5 minutes.

import * as eb from '#kit/ebus-read.mjs';
import { pack } from './packs.mjs';

export const EB_CITIES = new Set(['Taichung', 'Taoyuan']);
const DOWN_MS = 5 * 60_000;
const WAIT = 6000; // (an ask of the site; the proxy's after)
const keep = typeof eb.keeper === 'function' ? eb.keeper(800) : null;
const downAt = new Map(); // city → when an ask of its site last failed
const indexes = new WeakMap(); // a city's pack → its index
export const resetEb = () => (keep?.clear(), downAt.clear());
export const ebDown = (city, now = Date.now()) => now - (downAt.get(city) ?? -Infinity) < DOWN_MS;
// Whether the phone reads this city's buses itself (now).
export const ebPhone = (city, now = Date.now()) => EB_CITIES.has(city) && Boolean(keep && eb.ebEta && eb.ebGps) && !ebDown(city, now);

async function packOf(city) {
  const p = await pack(city);
  if (!p?.raw) throw new Error(`no pack ${city}`);
  if (!indexes.has(p.raw)) indexes.set(p.raw, eb.packIndex(p.raw));
  return indexes.get(p.raw);
}
const DEPS = { fetchFn: (...a) => fetch(...a), pack: packOf };
// (Each ask of the site watched: a failure, or an HTTP error, puts the city down.)
function depsOf(city, deps) {
  const d = { ...DEPS, now: Date.now(), ...deps };
  const fetchFn = (...a) =>
    Promise.resolve(d.fetchFn(...a)).then(
      res => (res.ok || downAt.set(city, d.now), res),
      err => {
        downAt.set(city, d.now);
        throw err;
      }
    );
  return { ...d, fetchFn, heldMany: keep.heldMany, ms: WAIT };
}

// A city's stops' or a route's estimates → { rows, at, missing: [the stops or the route the proxy's to answer] }
// (khbus.mjs khEta's shape). The routes asked within a moment go as one read.
export async function ebEta(city, { stops = [], route = '' } = {}, deps = {}) {
  if (!ebPhone(city, deps.now)) throw new Error(`${city}: the proxy's`);
  if (!stops.length) return route ? routeBatch(city, route, deps) : { rows: [], at: Date.now(), missing: [] };
  const d = depsOf(city, deps);
  const got = await eb.ebEta(city, { stops }, d);
  return { rows: got.rows, at: d.now - got.age, missing: got.missing.stops };
}
let batch = null; // city → { deps, per: Map(route → [{ resolve, reject }]) }
function routeBatch(city, route, deps) {
  return new Promise((resolve, reject) => {
    if (!batch) {
      const b = (batch = new Map());
      setTimeout(() => {
        if (batch === b) batch = null;
        for (const [c, one] of b) readRoutes(c, one);
      }, 20);
    }
    if (!batch.has(city)) batch.set(city, { deps, per: new Map() });
    const per = batch.get(city).per;
    (per.get(route) || per.set(route, []).get(route)).push({ resolve, reject });
  });
}
async function readRoutes(city, { deps, per }) {
  const routes = [...per.keys()];
  try {
    const d = depsOf(city, deps);
    const got = await eb.ebEta(city, { routes }, d);
    const at = d.now - got.age;
    for (const u of routes) for (const w of per.get(u)) w.resolve({ rows: got.rows.filter(r => r.RouteUID === u), at, missing: got.missing.routes.includes(u) ? [u] : [] });
  } catch (err) {
    for (const u of routes) for (const w of per.get(u)) w.reject(err);
  }
}
// Where routes' buses are → { rows (TDX's), at, missing (the proxy's to answer) } (khGps's shape).
export async function ebGps(city, routes = [], deps = {}) {
  if (!ebPhone(city, deps.now)) throw new Error(`${city}: the proxy's`);
  const d = depsOf(city, deps);
  const got = await eb.ebGps(city, routes, d);
  return { rows: got.rows, at: d.now - got.age, missing: got.missing };
}
