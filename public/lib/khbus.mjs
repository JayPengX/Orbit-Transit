// 高雄's buses read by the phone itself, from the city's own bus site
// (ibus.tbkc.gov.tw/ibus/graphql, an open GraphQL service, no key: the maker
// of 臺中's and 桃園's, which the proxy reads, Orbit-Core transit-free.js).
// It answers only Taiwan's own networks: the proxy (Cloudflare, even placed
// in Taiwan) is refused, a phone in Taiwan isn't, and the city's own pages
// read it from the phone (CORS open). So 高雄's buses cost the proxy and TDX
// nothing; whatever the site can't answer (a phone abroad, a failed read, a
// route or stop it doesn't know) is the proxy's (TDX's) as before, and once
// it fails, the proxy's alone for 5 minutes.
//
// Its ids are TDX's: a route's xno is TDX's RouteID, and TDX's StopID is 1,
// the route's 5 digits, the site's station and its goBack (1 going, 2 back:
// TDX's Direction + 1): every one of 高雄's 19,281 (2026-11-10; no branch
// routes, every loop one way). An estimate is worded as the proxy words
// 臺中's and 桃園's (kit/ebus.mjs); the route's name is TDX's (the city's
// pack, packs.mjs). Fields the city's own pages don't read (each estimate's
// state, a bus's last-trip mark and heading) are asked, and dropped the first
// time the site says it hasn't one; a stop's own estimate (stationEstimates,
// 臺中's and 桃園's) likewise, its routes read whole if it hasn't.

import { ebusState, twNow } from '#kit/ebus.mjs';
import { pack } from './packs.mjs';

export const KH_GQL = 'https://ibus.tbkc.gov.tw/ibus/graphql';
const FRESH = 5000; // (a route's or a stop's answer, for every card asking within a beat)
const WAIT = 4000;
const DOWN_MS = 5 * 60_000;
const ROUTES_AT_ONCE = 10;
const STOPS_AT_ONCE = 60;
const MAX_ROUTES = 40;
const MAX_STOPS = 300;

// 'KHH1001001172' → { xno: 100, station: '117', goBack: 2 }; null if not 高雄's.
export function khStop(uid) {
  const m = /^KHH1(\d{5})(\d+)([12])$/.exec(String(uid || ''));
  return m ? { xno: Number(m[1]), station: m[2], goBack: Number(m[3]) } : null;
}
export const khUid = (xno, station, goBack) => `KHH1${String(xno).padStart(5, '0')}${station}${goBack}`;
const xnoOf = uid => (/^KHH\d{1,5}$/.test(String(uid || '')) ? Number(String(uid).slice(3)) : 0);

// ---- Asking ------------------------------------------------------------------------------

const EXTRA = ['isOperationDay', 'isSuspended', 'clogType', 'isConstruction', 'isEvent', 'isLast', 'azimuth', 'name'];
const lacks = new Set(); // (the fields it said it hasn't)
let perRoute = false; // (it hasn't stationEstimates: a stop's routes read whole)
let downAt = 0;
const held = new Map(); // `r:${xno}` | `g:${xno}` | `s:${uid}` → { at, val } | { going }
export const resetKh = () => (lacks.clear(), held.clear(), (perRoute = false), (downAt = 0));
export const khDown = (now = Date.now()) => now - downAt < DOWN_MS;

const has = (...f) => f.filter(x => !lacks.has(x)).join(' ');
const ETA = () => `comeTime ${has('isOperationDay', 'isSuspended', 'clogType', 'isConstruction', 'isEvent')} etas { busId etaTime ${has('isLast')} }`;
const ROUTE = { r: () => `${has('name')} estimateTimes { edges { node { id goBack ${ETA()} } } }`, g: () => `buses { edges { goBack node { id lat lon ${has('azimuth')} } } }` };

// One ask (`build` gives the query, again once a field it named is left out) → its data.
async function gql(build, fetchFn) {
  for (let i = 0; ; i++) {
    const { query, variables } = build();
    const res = await fetchFn(KH_GQL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(variables ? { query, variables } : { query }), signal: AbortSignal.timeout?.(WAIT) });
    if (!res.ok) throw new Error(`ibus ${res.status}`);
    const j = await res.json();
    if (j?.data) return j.data;
    const said = (j?.errors || []).map(e => String(e?.message || ''));
    const no = EXTRA.filter(f => !lacks.has(f) && said.some(m => m.includes(`"${f}"`)));
    if (i || !no.length) throw Object.assign(new Error(`ibus: ${String(said[0] || 'no data').slice(0, 80)}`), { said });
    for (const f of no) lacks.add(f);
  }
}

// What's still fresh, or on its way; the rest asked by `ask(keys)` → Map(key → val), its parts at once.
async function heldMany(keys, ask, now) {
  const out = new Map();
  const need = [];
  for (const k of new Set(keys)) {
    const h = held.get(k);
    if (h?.going) out.set(k, h.going);
    else if (h && now() - h.at < FRESH) out.set(k, h);
    else need.push(k);
  }
  if (need.length) {
    const job = ask(need).then(got => {
      const at = now();
      for (const k of need) held.set(k, { at, val: got.get(k) ?? null });
      return at;
    });
    job.catch(() => need.forEach(k => held.delete(k)));
    for (const k of need) {
      const going = job.then(() => held.get(k));
      held.set(k, { going });
      out.set(k, going);
    }
  }
  const got = await Promise.allSettled([...out].map(async ([k, v]) => [k, await v]));
  if (got.length && got.every(g => g.status === 'rejected')) throw got[0].reason;
  if (held.size > 2000) for (const [k, h] of held) if (!h.going && now() - h.at > 60_000) held.delete(k);
  return new Map(got.filter(g => g.status === 'fulfilled' && g.value[1]).map(g => g.value));
}

// Routes' (`kind` r: estimates, g: buses) → Map(`${kind}:${xno}` → { at, val }); a route it doesn't know (id not its own): val null.
function routesOf(kind, xnos, { fetchFn, now }) {
  return heldMany(
    xnos.map(x => `${kind}:${x}`),
    async keys => {
      const xs = keys.map(k => Number(k.slice(2)));
      const parts = Array.from({ length: Math.ceil(xs.length / ROUTES_AT_ONCE) }, (_, i) => xs.slice(i * ROUTES_AT_ONCE, (i + 1) * ROUTES_AT_ONCE));
      const got = await Promise.allSettled(parts.map(p => gql(() => ({ query: `query { ${p.map(x => `r${x}: route(xno: ${x}, lang: "zh") { id ${ROUTE[kind]()} }`).join(' ')} }` }), fetchFn)));
      if (got.every(g => g.status === 'rejected')) throw got[0].reason;
      const d = Object.assign({}, ...got.map(g => (g.status === 'fulfilled' ? g.value : {})));
      return new Map(xs.filter(x => d[`r${x}`] && String(d[`r${x}`].id) === String(x)).map(x => [`${kind}:${x}`, d[`r${x}`]]));
    },
    now
  );
}

// Stops (TDX's StopUIDs) → Map(`s:${uid}` → { at, val: its estimate }), by stationEstimates.
function stopsOf(uids, { fetchFn, now }) {
  return heldMany(
    uids.map(u => `s:${u}`),
    async keys => {
      const targets = keys.map(k => khStop(k.slice(2))).map(s => ({ xno: s.xno, stationId: Number(s.station), goBack: s.goBack }));
      const parts = Array.from({ length: Math.ceil(targets.length / STOPS_AT_ONCE) }, (_, i) => targets.slice(i * STOPS_AT_ONCE, (i + 1) * STOPS_AT_ONCE));
      const got = await Promise.allSettled(parts.map(t => gql(() => ({ query: `query($t: [EstimateStationInput!]!) { stationEstimates(targets: $t) { edges { node { xno id goBack ${ETA()} } } } }`, variables: { t } }), fetchFn)));
      if (got.every(g => g.status === 'rejected')) throw got[0].reason;
      const out = new Map();
      for (const g of got) for (const e of (g.status === 'fulfilled' && g.value?.stationEstimates?.edges) || []) out.set(`s:${khUid(Number(e?.node?.xno), String(e?.node?.id), Number(e?.node?.goBack))}`, e.node);
      return out;
    },
    now
  );
}

// ---- In TDX's words ------------------------------------------------------------------------

// (The site's numbers as numbers, whatever it sends them as.)
const num = v => (v == null || v === '' ? null : Number(v));
const tidy = n => ({ ...n, goBack: num(n?.goBack), clogType: num(n?.clogType), etas: (n?.etas || []).map(e => ({ ...e, etaTime: num(e?.etaTime), busId: e?.busId ? String(e.busId) : '' })) });

// A stop's estimate → TDX's row (EstimatedTimeOfArrival).
export function khRow(n, uid, routeUID, name, at) {
  const t = tidy(n);
  return { StopUID: uid, StopID: uid.slice(3), RouteUID: routeUID, RouteID: routeUID.slice(3), SubRouteUID: routeUID, RouteName: { Zh_tw: name || routeUID.slice(3) }, Direction: khStop(uid).goBack - 1, ...ebusState(t, at), DataTime: twNow(at) };
}

// Routes' names as TDX has them (the city's pack), RouteUID → name; {} when there's none.
async function packNames() {
  const p = await pack('Kaohsiung').catch(() => null);
  return p?.byUid ? { get: uid => p.byUid.get(uid)?.name, stops: p.raw?.stops } : null;
}

// ---- What the app asks -----------------------------------------------------------------------

const DEPS = { fetchFn: (...a) => fetch(...a), now: () => Date.now(), names: packNames };
function guard(job, now) {
  if (khDown(now())) return Promise.reject(new Error('ibus down'));
  return job().catch(err => {
    downAt = now();
    throw err;
  });
}

// Estimates of stops (TDX's StopUIDs) or of a route (TDX's RouteUID) → { rows, at, missing: [the stops or the route it couldn't answer] }.
export function khEta({ stops = [], route = '' } = {}, deps = {}) {
  const d = { ...DEPS, ...deps };
  return guard(async () => {
    const namesAsk = d.names().catch(() => null);
    const rows = [];
    const missing = [];
    let at = d.now();
    if (stops.length) {
      const mine = stops.filter(u => khStop(u));
      missing.push(...stops.filter(u => !khStop(u)), ...mine.slice(MAX_STOPS));
      const ask = mine.slice(0, MAX_STOPS);
      let got = new Map();
      if (ask.length && !perRoute) {
        got = await stopsOf(ask, d).catch(err => {
          if (!err?.said?.some(m => /stationEstimates|EstimateStationInput/.test(m))) throw err;
          perRoute = true;
          return new Map();
        });
      }
      // (No stationEstimates: each stop's route read whole.)
      if (ask.length && perRoute) {
        const whole = await routesOf('r', [...new Set(ask.map(u => khStop(u).xno))].slice(0, MAX_ROUTES), d);
        for (const u of ask) {
          const s = khStop(u);
          const r = whole.get(`r:${s.xno}`);
          if (!r?.val) continue;
          const n = (r.val.estimateTimes?.edges || []).map(e => e?.node).find(n => String(n?.id) === s.station && Number(n?.goBack) === s.goBack);
          if (n) got.set(`s:${u}`, { at: r.at, val: n });
        }
      }
      const names = await namesAsk;
      for (const u of ask) {
        const g = got.get(`s:${u}`);
        if (!g?.val) {
          missing.push(u);
          continue;
        }
        const routeUID = `KHH${khStop(u).xno}`;
        rows.push(khRow(g.val, u, routeUID, names?.get(routeUID), g.at));
        at = Math.min(at, g.at);
      }
    } else if (xnoOf(route)) {
      const [whole, names] = await Promise.all([routesOf('r', [xnoOf(route)], d), namesAsk]);
      const r = whole.get(`r:${xnoOf(route)}`);
      if (!r?.val) missing.push(route);
      else {
        const name = names?.get(route) || (typeof r.val.name === 'string' ? r.val.name : '');
        for (const e of r.val.estimateTimes?.edges || []) {
          const n = e?.node;
          const g = Number(n?.goBack);
          if (n?.id == null || !/^\d+$/.test(String(n.id)) || (g !== 1 && g !== 2)) continue;
          const uid = khUid(xnoOf(route), String(n.id), g);
          // (Only a stop TDX has, when its list is here.)
          if (names?.stops && !names.stops[uid]) continue;
          rows.push(khRow(n, uid, route, name, r.at));
        }
        at = r.at;
        // (Nothing of TDX's stops in it: not the route it seems. The proxy's.)
        if (!rows.length) missing.push(route);
      }
    } else if (route) missing.push(route);
    return { rows, at, missing };
  }, d.now);
}

// Where routes' buses are (TDX's RouteUIDs) → { rows (TDX's RealTimeByFrequency), at, missing }.
export function khGps(routes = [], deps = {}) {
  const d = { ...DEPS, ...deps };
  return guard(async () => {
    const mine = routes.filter(xnoOf);
    const missing = [...routes.filter(u => !xnoOf(u)), ...mine.slice(MAX_ROUTES)];
    const got = await routesOf('g', mine.slice(0, MAX_ROUTES).map(xnoOf), d);
    const rows = [];
    let at = d.now();
    for (const u of mine.slice(0, MAX_ROUTES)) {
      const g = got.get(`g:${xnoOf(u)}`);
      if (!g?.val) {
        missing.push(u);
        continue;
      }
      for (const e of g.val.buses?.edges || []) {
        const b = e?.node;
        const lat = num(b?.lat);
        const lon = num(b?.lon);
        const way = num(e?.goBack);
        const az = num(b?.azimuth);
        // (A place in 高雄's reach, on a way it runs.)
        if (!b?.id || !(lat > 21.8 && lat < 23.6) || !(lon > 119.9 && lon < 121.2) || (way !== 1 && way !== 2)) continue;
        rows.push({ RouteUID: u, SubRouteUID: u, PlateNumb: String(b.id), Direction: way - 1, BusPosition: { PositionLat: lat, PositionLon: lon }, GPSTime: twNow(g.at), Speed: null, Azimuth: az >= 0 && az < 360 ? az : null });
      }
      at = Math.min(at, g.at);
    }
    return { rows, at, missing };
  }, d.now);
}
