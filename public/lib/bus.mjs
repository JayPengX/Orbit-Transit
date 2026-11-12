// Buses: a city's routes, a route's stops each way, and when the next bus
// comes to a stop (TDX's N1 estimates, refreshed by the proxy every 25 s).

import { packRoute, stationRows } from './packs.mjs';
import { tdx, rows, busEta, busGps, liveMs } from './api.mjs';
import { etaStops } from './near.mjs';
import { gpsFix } from './busgps.mjs';
import { routeLines } from './shapes.mjs';
import { zh, hm, etaAge, etaOld, ETA_STALE, ETA_GHOST, meters, TDX_DAYS } from './util.mjs';
import { CITY_CODES } from './city.mjs';
import { routeStatus } from './service.mjs';

import { W, en } from '#kit/lang.mjs';
// 'InterCity' is 公路客運 and 國道客運 (they belong to no city).
export const INTERCITY = 'InterCity';
const scope = city => (city === INTERCITY ? 'InterCity' : `City/${city}`);
const q = s => `'${String(s).replace(/'/g, "''")}'`;
export const norm = s => String(s || '').replace(/台/g, '臺').replace(/\s+/g, '').toUpperCase();

// ---- Routes -----------------------------------------------------------------------------------

export async function cityRoutes(city) {
  const j = await tdx(`basic/v2/Bus/Route/${scope(city)}?$select=RouteUID,RouteID,RouteName,DepartureStopNameZh,DestinationStopNameZh,BusRouteType`, { fresh: 86_400_000, persist: true });
  return rows(j).map(r => ({ uid: r.RouteUID, city, name: zh(r.RouteName), from: r.DepartureStopNameZh || '', to: r.DestinationStopNameZh || '', type: r.BusRouteType }));
}

// Routes matching what's typed: the exact name first, then names that start
// with it (the shortest first: 「2」 → 2, 20, 21…), then any that contain it,
// then by the places at either end. `rank` (a route → a number): among
// matches as good, the lower first (全部: your city's 1 before 臺北's).
export function findRoutes(list, text, n = 60, rank = null) {
  const t = norm(text);
  if (!t) return [];
  const score = r => {
    const name = norm(r.name);
    if (name === t) return 0;
    if (name.startsWith(t)) return 1 + name.length / 100;
    if (name.includes(t)) return 3 + name.length / 100;
    if (norm(r.from).includes(t) || norm(r.to).includes(t)) return 5;
    return null;
  };
  return list
    .map(r => [score(r), r])
    .filter(([s]) => s != null)
    .sort((a, b) => a[0] - b[0] || (rank ? rank(a[1]) - rank(b[1]) : 0) || a[1].name.localeCompare(b[1].name, 'zh-Hant', { numeric: true }))
    .slice(0, n)
    .map(([, r]) => r);
}

// A route's stops each way: [{ dir, sub, subName, headsign, stops: [{ uid, id,
// name, seq, lat, lon, station }] }], the main pattern of each direction first.
// `near`: a point on the route (a 公路客運's pack is the square it's in).
export async function routeStops(route, near = null) {
  const own = await packRoute(route, near).catch(() => null);
  if (own?.stops.length) return parseStops(own.stops);
  const j = await tdx(`basic/v2/Bus/StopOfRoute/${scope(route.city)}/${encodeURIComponent(route.name)}?$filter=RouteUID eq ${q(route.uid)}`, { fresh: 86_400_000, persist: true });
  return parseStops(j);
}
export function parseStops(j) {
  const ways = rows(j)
    .map(r => {
      const stops = (r.Stops || [])
        .map(s => ({ uid: s.StopUID, id: s.StopID, name: zh(s.StopName), seq: Number(s.StopSequence) || 0, lat: Number(s.StopPosition?.PositionLat), lon: Number(s.StopPosition?.PositionLon), station: s.StationID || '' }))
        .sort((a, b) => a.seq - b.seq);
      return { dir: Number(r.Direction) || 0, sub: r.SubRouteUID || '', subName: zh(r.SubRouteName), headsign: stops.at(-1)?.name || '', stops };
    })
    .filter(w => w.stops.length);
  // Per direction, the pattern with the most stops leads.
  return ways.sort((a, b) => a.dir - b.dir || b.stops.length - a.stops.length);
}

// ---- The timetable ----------------------------------------------------------------------------------

// A route's timetable (TDX Schedule): per sub-route and direction, its trips'
// times at every stop, or its headways. Kept 6 hours.
export async function routeSchedule(route, near = null) {
  const own = await packRoute(route, near).catch(() => null);
  if (own) return own.sched;
  const j = await tdx(`basic/v2/Bus/Schedule/${scope(route.city)}/${encodeURIComponent(route.name)}?$filter=RouteUID eq ${q(route.uid)}`, { fresh: 6 * 3_600_000, persist: true });
  return rows(j);
}
// Does a trip run on a Taiwan date ('YYYY-MM-DD', dow 0 = Sunday)? Its special days decide first.
export function runsOn(trip, date, dow) {
  for (const sp of trip.SpecialDays || []) {
    const inDates = (sp.Dates || []).includes(date);
    const p = sp.DatePeriod;
    const inPeriod = p && date >= p.StartDate && date <= p.EndDate;
    if (inDates || inPeriod) return Number(sp.ServiceStatus) === 1;
  }
  return trip.ServiceDay ? Number(trip.ServiceDay[TDX_DAYS[dow]]) === 1 : true;
}
// The day's times at one stop (by StopUID, else by its name), one direction:
// { times: ['06:00', …] } from the trips, or { every: [{ from, to, min, max }] }.
export function stopTimes(sched, { stopUID, name, dir }, date, dow) {
  const times = new Set();
  const every = [];
  for (const r of sched) {
    if (dir != null && Number(r.Direction) !== dir) continue;
    for (const t of r.Timetables || []) {
      if (!runsOn(t, date, dow)) continue;
      const st = (t.StopTimes || []).find(x => x.StopUID === stopUID) || (name ? (t.StopTimes || []).find(x => zh(x.StopName) === name) : null);
      if (st?.DepartureTime || st?.ArrivalTime) times.add(st.DepartureTime || st.ArrivalTime);
    }
    for (const f of r.Frequencys || []) {
      if (f.ServiceDay && Number(f.ServiceDay[TDX_DAYS[dow]]) !== 1) continue;
      every.push({ from: f.StartTime, to: f.EndTime, min: Number(f.MinHeadwayMins) || null, max: Number(f.MaxHeadwayMins) || null });
    }
  }
  return { times: [...times].sort(), every: every.sort((a, b) => (a.from < b.from ? -1 : 1)) };
}

// ---- When the bus comes -------------------------------------------------------------------------

const ETA_FIELDS = '$select=StopUID,RouteUID,RouteName,SubRouteUID,Direction,EstimateTime,StopStatus,NextBusTime,PlateNumb,IsLastBus,Estimates,StopCountDown,DataTime';

// Every stop of one route (the route sheet), keyed by StopUID; `dir`: one way's.
// (From the Worker's copy of the city's estimates; asked again at the live speed.)
const routeLive = new Map(); // RouteUID → { got, ask: Promise<{ rows, at }> }
const routeRows = route => {
  const k = routeLive.get(route.uid);
  if (k && Date.now() - k.got < liveMs() - 1000) return k.ask;
  const ask = busEta(route.city, { route: route.uid });
  routeLive.set(route.uid, { got: Date.now(), ask });
  ask.catch(() => routeLive.get(route.uid)?.ask === ask && routeLive.delete(route.uid));
  return ask;
};
// When that route's live times are from (ms), or 0.
export const routeEtaAt = route => routeLive.get(route.uid)?.at || 0;
// Where a route's buses are now (TDX RealTimeByFrequency: GPS, under a
// minute old), for the ones whose estimates lag (busgps.mjs). The routes
// asked within a moment of each other go as one ask a city (a plan mended its
// buses' times with six asks of TDX, one a route; 2026-11-06); one alone is
// its route's own ask, as before.
// A bus sends its place each 20 s (TDX A1's GPSTime, 2026-11-06), so a
// route's is asked once in each 20 s of the clock, every route of a city
// in the same ask (a stop card asked at each beat, a new ask whenever its
// late routes changed: two TDX reads for one fix), with how old the copy
// here is (`had`): the Worker reads TDX then, not answering with its copy a
// step old. Through /transit/gps (api.mjs busGps): the Worker reads a city's
// whole list once for every route and every phone (a crowd at different
// stops was a TDX read a stop each 20 s), 公路客運's by its routes.
const GPS_STEP = 20_000;
const gpsAsks = new Map(); // city|RouteUID → { got, ask, at (its data's time) }
let gpsBatch = null; // city → Map(RouteUID → { route, waits, had: its copy's time, mine: its gpsAsks entries })
export function routeGps(route) {
  const key = `${route.city}|${route.uid}`;
  const now = Date.now();
  const k = gpsAsks.get(key);
  if (k && (now - k.got < liveMs() - 1000 || Math.floor(k.got / GPS_STEP) === Math.floor(now / GPS_STEP))) return k.ask;
  const mine = { got: now, ask: null, at: 0 };
  const ask = new Promise((resolve, reject) => {
    if (!gpsBatch) {
      const b = (gpsBatch = new Map());
      setTimeout(() => {
        if (gpsBatch === b) gpsBatch = null;
        for (const [city, per] of b) sendGps(city, [...per.values()]);
      }, 20);
    }
    if (!gpsBatch.has(route.city)) gpsBatch.set(route.city, new Map());
    const per = gpsBatch.get(route.city);
    if (!per.has(route.uid)) per.set(route.uid, { route, waits: [], had: k?.at || 0, mine: [] });
    per.get(route.uid).waits.push({ resolve, reject });
    per.get(route.uid).mine.push(mine);
  });
  mine.ask = ask;
  gpsAsks.set(key, mine);
  ask.catch(() => gpsAsks.get(key)?.ask === ask && gpsAsks.delete(key));
  if (gpsAsks.size > 100) for (const [p, x] of gpsAsks) if (now - x.got > 60_000) gpsAsks.delete(p);
  return ask;
}
function sendGps(city, all) {
  for (let i = 0; i < all.length; i += 20) {
    const part = all.slice(i, i + 20);
    // (Asked with the youngest copy any of them has: an older one of the Worker's is no use to it.)
    const ages = part.filter(x => x.had).map(x => Math.max(1, Math.floor((Date.now() - x.had) / 1000)));
    busGps(
      city,
      part.map(x => x.route.uid),
      ages.length ? Math.min(...ages) : 0
    ).then(
      ({ rows: list, at }) => {
        for (const x of part) {
          for (const m of x.mine) m.at = at;
          for (const w of x.waits) w.resolve(list.filter(r => r.RouteUID === x.route.uid));
        }
      },
      err => {
        for (const x of part) for (const w of x.waits) w.reject(err);
      }
    );
  }
}
// TDX's estimates as busEta gives them (a stop card, a trip's bus, a ride
// aboard), each bus whose estimates lag over 2 minutes counted again from
// its GPS along its route's line (busgps.mjs), for up to 8 routes at once;
// what isn't ready in 2.5 s is left as it was (the card never waits on it).
const MEND_OLD = 120;
const MEND_ROUTES = 8;
const MEND_WAIT = 2500;
export async function busEtaMended(city, opts = {}, { ask = busEta, now = Date.now, stopsOf = routeStops, gpsOf = routeGps, linesOf = routeLines } = {}) {
  const got = await ask(city, opts);
  try {
    const t = now();
    const lag = new Map();
    for (const r of got.rows || []) {
      const old = etaOld(r, t);
      if (r.EstimateTime != null && r.PlateNumb && r.PlateNumb !== '-1' && !Number(r.StopStatus) && old > MEND_OLD && old <= ETA_GHOST) lag.set(r.RouteUID, zh(r.RouteName));
    }
    if (!lag.size) return got;
    const parts = [...lag].slice(0, MEND_ROUTES).map(async ([uid, name]) => {
      const route = { uid, name, city: routeCity(uid) };
      const [ways, gps] = await Promise.all([stopsOf(route), gpsOf(route)]);
      if (!gps.length) return null;
      return { gps, ways: await Promise.all(ways.map(async w => ({ w, lines: await linesOf(route, w).catch(() => null) }))) };
    });
    const timeout = new Promise(r => setTimeout(() => r(null), MEND_WAIT));
    const done = await Promise.all(parts.map(x => Promise.race([x.catch(() => null), timeout])));
    let list = got.rows;
    for (const x of done) for (const { w, lines } of x?.ways || []) list = gpsFix(list, x.gps, w, lines, t);
    return list === got.rows ? got : { ...got, rows: list };
  } catch {
    return got;
  }
}
// A route's times with each lagging bus counted again from its GPS, along
// each way's line (`lineOf(way)` → its shape's pieces, or null).
export async function routeEtaMended(route, ways, lineOf) {
  const [got, gps] = await Promise.all([routeRows(route), routeGps(route).catch(() => [])]);
  const k = routeLive.get(route.uid);
  if (k) k.at = got.at;
  let list = got.rows;
  if (gps.length) for (const w of ways || []) list = gpsFix(list, gps, w, await Promise.resolve(lineOf?.(w)).catch(() => null));
  return etaMap(list);
}
export async function routeEta(route, dir = null) {
  const got = await routeRows(route);
  const k = routeLive.get(route.uid);
  if (k) k.at = got.at;
  return etaMap(got.rows, dir);
}
// A bus's place in a list: due soonest first, not out yet after, not running last.
// (By when, live or timetabled alike: a timetabled bus in 5 minutes before a
// live one in 36 (a place's 5 soonest had listed 36 分 above 13:17; Jay
// 2026-11-12); a timetabled one a minute after a live one at the same time.)
export function etaRank(v, now = Date.now()) {
  v = v && said(v);
  return !v ? 3e6 : v.sec != null ? v.sec : v.status === 1 && v.next ? Math.max(0, (v.next - now) / 1000) + 60 : v.status === 1 ? 1e6 : 2e6;
}
// The stops of a group, one ask per city (near.mjs etaStops: shared with every other look at them).
export async function stopsEta(items) {
  const list = await etaStops([...new Map(items.map(it => [`${it.city}|${it.stopUID}`, { uid: it.stopUID, scope: it.city }])).values()], { fresh: liveMs() - 1000 });
  return etaMap(list);
}
// A bus stop's arrivals as the Worker asks for them for a 到站提醒 (push.js;
// the app's own card reads the stop's signs: near.mjs stationEta). Whose
// station it is comes from its UID (HSZ…: 新竹市's; THB…: 公路局's 公路客運,
// which TDX still files under the city it stands in): only its own operator knows it.
const stationCity = station => {
  const owner = /^[A-Z]{3}/.exec(station.uid || '')?.[0];
  return owner ? CITY_CODES[owner] : CITY_CODES[station.cityCode];
};
export function stationEtaAsk(station) {
  const city = stationCity(station);
  return `advanced/v2/Bus/EstimatedTimeOfArrival/${city ? `City/${city}` : 'InterCity'}/PassThrough/Station/${encodeURIComponent(station.id)}?${ETA_FIELDS}`;
}

// One N1 row → { sec (to arrival from now, or null), status, next (ms), last, plate, more: [sec…] }.
// What's said about the route today (service.mjs routeStatus) rides along as
// `flag` (改道, 減班…); not running (今日停駛, or 可能停駛: no bus on the road in
// a city whose buses are all off it) with no bus coming: that, never the timetable's next.
// `old`: how old TDX's estimate is (s); `stale`: past ETA_STALE, its feed
// stopped (said so, never 進站中 or a bus drawn); past ETA_GHOST: no live time.
export function etaOf(r, now = Date.now()) {
  const age = etaAge(r, now);
  const old = etaOld(r, now);
  const ghost = old != null && old > ETA_GHOST;
  const sec = r.EstimateTime == null || ghost ? null : Math.max(0, Math.round(Number(r.EstimateTime) - age));
  const more = ghost ? [] : (r.Estimates || []).map(x => Math.round(Number(x.EstimateTime) - age)).filter(x => Number.isFinite(x) && x !== sec).sort((a, b) => a - b);
  const raw = { t: now, sec: Number.isFinite(sec) ? sec : null, status: Number(r.StopStatus) || 0, next: r.NextBusTime ? Date.parse(r.NextBusTime) : null, last: r.IsLastBus === true, plate: r.PlateNumb && r.PlateNumb !== '-1' ? r.PlateNumb : '', more, countdown: r.StopCountDown ?? null, old, stale: old != null && old > ETA_STALE && !ghost && Number.isFinite(sec), rt: { uid: r.RouteUID, name: zh(r.RouteName), stop: r.StopUID } };
  const test = globalThis.ORBIT_TEST?.flags?.busNow;
  if (test) testEta(raw, test);
  return said(raw, now);
}
// (The 測試工具's 公車到站 switch, testing.mjs: every bus as picked; shown only, never kept.)
function testEta(raw, kind) {
  if (kind === 'off') return Object.assign(raw, { status: 1, sec: null, more: [] });
  const at = { now: 45, due: 150, soon: 300, stale: 600 }[kind];
  if (at == null) return;
  Object.assign(raw, { status: 0, sec: at, more: [at + 900], ...(kind === 'stale' ? { old: 420, stale: true } : { old: 10, stale: false }) });
}
// A time with what's known about its route now (asked again at each drawing:
// the notices and the buses on the road come in after the times do).
export function said(v, now = Date.now()) {
  const raw = v?.raw || v;
  if (!raw?.rt) return v;
  const st = globalThis.ORBIT_TEST?.flags?.busNow === 'off' ? { effect: 'off', label: W('今日停駛', 'Not running today') } : routeStatus(raw.rt.uid, raw.rt.name, now, raw.rt.stop);
  const flag = st ? { effect: st.effect, label: st.label } : null;
  const onRoad = (raw.status === 0 && raw.sec != null) || raw.more.length > 0;
  if (flag && (flag.effect === 'off' || flag.effect === 'likely') && !onRoad) return { ...raw, raw, sec: null, status: 4, next: null, more: [], flag };
  return { ...raw, raw, flag };
}
// Keyed by StopUID (the sooner of what's there), and by stop, route and way
// (etaKey): a stop is often on both ways of a route (高鐵新竹站 on 快捷8號
// each way; a line's ends) and on several routes (快捷8號 and 快捷8號支), and
// the bus going the other way, or the other route's, is not yours.
// `dir`: that way's rows only (a route sheet's way, a ride's).
export const etaKey = (stopUID, routeUID = '', dir = null) => `${stopUID}@${routeUID}${dir == null ? '' : `/${Number(dir)}`}`;
// A pinned stop's own time: its route and way's, never another's at the stop.
export const etaFor = (map, { stopUID, routeUID = '', dir = null }) => map?.get(routeUID ? etaKey(stopUID, routeUID, dir) : stopUID);
export function etaMap(j, dir = null) {
  const out = new Map();
  const put = (k, v) => {
    const old = out.get(k);
    if (!old || (v.sec != null && (old.sec == null || v.sec < old.sec))) out.set(k, v);
  };
  for (const r of rows(j)) {
    if (dir != null && Number(r.Direction) !== Number(dir)) continue;
    const v = etaOf(r);
    put(r.StopUID, v);
    put(etaKey(r.StopUID, r.RouteUID), v);
    put(etaKey(r.StopUID, r.RouteUID, Number(r.Direction) || 0), v);
  }
  return out;
}

// What a stop's row says: { main, sub, tone: 'now' | 'soon' | 'wait' | 'off' }.
export function etaText(v, now = Date.now()) {
  if (!v) return { main: '—', sub: '', tone: 'off' };
  v = said(v, now);
  if (v.status === 4 && v.flag) return { main: v.flag.label, sub: '', tone: 'off stopped' };
  const t = etaTextOf(v, now);
  // (Anything else said about it: its word under the time.)
  return v.flag && !t.sub ? { ...t, sub: v.flag.label, flag: true } : v.flag ? { ...t, sub: `${v.flag.label}・${t.sub}`, flag: true } : t;
}
function etaTextOf(v, now) {
  // A stopped feed: its time as it was, how old, and never 進站中 (the bus may be gone by).
  if (v.status === 0 && v.sec != null && v.stale) {
    const ago = W(`${Math.round(v.old / 60)} 分鐘前資料`, `${Math.round(v.old / 60)} min old`);
    if (v.sec <= 180) return { main: W('可能已過', 'May be gone'), sub: ago, tone: 'wait stale' };
    return { main: W(`${Math.floor(v.sec / 60)} 分`, `${Math.floor(v.sec / 60)} min`), sub: ago, tone: 'wait stale' };
  }
  if (v.status === 0 && v.sec != null) {
    if (v.sec <= 60) return { main: W('進站中', 'Arriving'), sub: v.last ? W('末班車', 'Last bus') : '', tone: 'now' };
    if (v.sec <= 180) return { main: W('即將進站', 'Due'), sub: v.last ? W('末班車', 'Last bus') : W(`${Math.ceil(v.sec / 60)} 分`, `${Math.ceil(v.sec / 60)} min`), tone: 'now' };
    const m = Math.floor(v.sec / 60);
    const then = v.more.find(x => x > v.sec + 60);
    return { main: W(`${m} 分`, `${m} min`), sub: v.last ? W('末班車', 'Last bus') : then != null ? W(`下一班 ${Math.floor(then / 60)} 分`, `then ${Math.floor(then / 60)} min`) : '', tone: m <= 6 ? 'soon' : 'wait' };
  }
  if (v.status === 1) return { main: v.next ? W(`${hm(v.next)} 發車`, `Leaves ${hm(v.next)}`) : W('尚未發車', 'Not yet out'), sub: v.next && v.next - now > 0 ? W(`${Math.round((v.next - now) / 60_000)} 分後`, `in ${Math.round((v.next - now) / 60_000)} min`) : '', tone: 'wait' };
  if (v.status === 2) return { main: W('交管不停靠', 'Not stopping'), sub: '', tone: 'off' };
  if (v.status === 3) return { main: W('末班已過', 'Last one gone'), sub: '', tone: 'off' };
  if (v.status === 4) return { main: W('今日未營運', 'Not today'), sub: '', tone: 'off' };
  if (v.next) return { main: `${hm(v.next)}`, sub: W('預計', 'planned'), tone: 'wait' };
  return { main: '—', sub: '', tone: 'off' };
}

// Bus stops near a point (the map, the stops near you): the stations within
// 1000 m of it rounded to 0.002° (about 900 m around it, the same for
// everyone near), from the station tiles kept here (packs.mjs stationRows:
// read once for ~5 km around); TDX's own search around the point only when
// they can't be had (an advanced ask, shared through the proxy for a day).
export async function stationsNear(lat, lon) {
  const g = v => (Math.round(v * 500) / 500).toFixed(3);
  const kept = await stationRows(Number(g(lat)), Number(g(lon)), 1000).catch(() => null);
  const list = kept || rows(await tdx(`advanced/v2/Bus/Station/NearBy?$spatialFilter=nearby(${g(lat)},${g(lon)},1000)&$top=500&$select=StationUID,StationID,StationName,StationPosition,Stops,LocationCityCode,Bearing`, { fresh: 86_400_000, persist: true }));
  return list
    .map(s => ({
      uid: s.StationUID,
      id: s.StationID,
      name: zh(s.StationName),
      lat: Number(s.StationPosition?.PositionLat),
      lon: Number(s.StationPosition?.PositionLon),
      cityCode: s.LocationCityCode || '',
      bearing: s.Bearing || '',
      routes: [...new Set((s.Stops || []).map(x => zh(x.RouteName)).filter(Boolean))],
      stops: (s.Stops || []).map(x => ({ stopUID: x.StopUID, routeUID: x.RouteUID, route: zh(x.RouteName) })).filter(x => x.stopUID && x.routeUID)
    }))
    .filter(s => Number.isFinite(s.lat));
}
// A route's city from its UID (HSQ0747 → 新竹縣's; THB… is 公路客運).
export const routeCity = uid => CITY_CODES[/^[A-Z]{3}/.exec(uid || '')?.[0]] || INTERCITY;

export const BEARING = en ? { E: 'Eastbound', W: 'Westbound', S: 'Southbound', N: 'Northbound', SE: 'To SE', NE: 'To NE', SW: 'To SW', NW: 'To NW' } : { E: '往東', W: '往西', S: '往南', N: '往北', SE: '往東南', NE: '往東北', SW: '往西南', NW: '往西北' };
// A stop's stations (one name, a street's both sides, sometimes two signs a
// side) as its sides: by the way their buses leave (each station's
// bearing; 45° or less apart is one side), not by how far apart they stand
// (上泉州厝 has two signs on one side, which stood as two sides). A station
// with no bearing joins the nearest side. Each side: its stations (`group`),
// in the middle of them, with their routes and its bearing.
const ANGLE = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
export function stopSides(stations) {
  const sides = [];
  const turn = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  for (const s of stations.filter(x => x.bearing in ANGLE)) {
    const side = sides.find(x => turn(ANGLE[x[0].bearing], ANGLE[s.bearing]) <= 45);
    if (side) side.push(s);
    else sides.push([s]);
  }
  const d2 = (a, b) => (a.lat - b.lat) ** 2 + ((a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180)) ** 2;
  for (const s of stations.filter(x => !(x.bearing in ANGLE))) {
    const near = sides.map(side => [Math.min(...side.map(x => d2(x, s))), side]).sort((a, b) => a[0] - b[0])[0];
    if (near) near[1].push(s);
    else sides.push([s]);
  }
  return sides.map(pool);
}
// Stations as one: in the middle of them, every route through any, named as
// most of their routes call it (新竹站, not 火車站 for one city bus).
const pool = g => {
  const uses = new Map();
  for (const x of g) uses.set(x.name, (uses.get(x.name) || 0) + (x.routes?.length || 0));
  const name = [...uses].sort((a, b) => b[1] - a[1])[0][0];
  return { ...g[0], name, lat: g.reduce((a, x) => a + x.lat, 0) / g.length, lon: g.reduce((a, x) => a + x.lon, 0) / g.length, routes: [...new Set(g.flatMap(x => x.routes))], group: g };
};
// The stations that are one stop (one marker, every bus on its card): one
// name a street's width apart (its two sides), or one sign whatever each
// operator calls it (新竹站's front: 火車站 for the city's buses, 新竹火車站
// for the county's and 新竹站 for 公路客運, a few metres apart). Never
// spread past a street's width: a hub stays its several stops.
const ONE_STOP_M = 90;
const ONE_SIGN_M = 25;
export function stopGroups(list) {
  // The nearest first, whatever order they came in: two signs a few metres
  // apart are one before either joins a stop down the road.
  const d = (a, b) => meters(a.lat, a.lon, b.lat, b.lon);
  const pairs = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const m = d(list[i], list[j]);
      if (m < ONE_STOP_M && (m < ONE_SIGN_M || list[i].name === list[j].name)) pairs.push([m, i, j]);
    }
  const of = list.map((s, i) => [i]);
  for (const [, i, j] of pairs.sort((a, b) => a[0] - b[0])) {
    const [a, b] = [of[i], of[j]];
    if (a === b || !a.every(x => b.every(y => d(list[x], list[y]) < ONE_STOP_M))) continue;
    a.push(...b);
    for (const k of b) of[k] = a;
  }
  const groups = [...new Set(of)].map(g => g.sort((x, y) => x - y).map(k => list[k]));
  return groups.map(pool);
}
