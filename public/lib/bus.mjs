// Buses: a city's routes, a route's stops each way, and when the next bus
// comes to a stop (TDX's N1 estimates, refreshed by the proxy every 25 s).

import { packRoute } from './packs.mjs';
import { tdx, rows } from './api.mjs';
import { zh, hm, etaAge, meters, TDX_DAYS } from './util.mjs';
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
// then by the places at either end.
export function findRoutes(list, text, n = 60) {
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
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, 'zh-Hant', { numeric: true }))
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

// Every stop of one route (the route sheet), keyed by StopUID.
export const routeEtaPath = route => `basic/v2/Bus/EstimatedTimeOfArrival/${scope(route.city)}/${encodeURIComponent(route.name)}?$filter=RouteUID eq ${q(route.uid)}&${ETA_FIELDS}`;
export async function routeEta(route) {
  const j = await tdx(routeEtaPath(route), { fresh: 'live' });
  return etaMap(j);
}
// A bus's place in a list: due soonest first, not out yet after, not running last.
export function etaRank(v) {
  v = v && said(v);
  return !v ? 3e6 : v.sec != null ? v.sec : v.status === 1 ? 1e6 + ((v.next || 0) - Date.now()) / 1000 : 2e6;
}
// The stops of a group, one ask per city.
export async function stopsEta(items) {
  const byCity = new Map();
  for (const it of items) {
    if (!byCity.has(it.city)) byCity.set(it.city, new Set());
    byCity.get(it.city).add(it.stopUID);
  }
  const out = new Map();
  await Promise.all(
    [...byCity].map(async ([city, uids]) => {
      const filter = [...uids].sort().map(u => `StopUID eq ${q(u)}`).join(' or ');
      const j = await tdx(`basic/v2/Bus/EstimatedTimeOfArrival/${scope(city)}?$filter=${filter}&${ETA_FIELDS}`, { fresh: 'live' });
      for (const [k, v] of etaMap(j)) out.set(k, v);
    })
  );
  return out;
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
export function etaOf(r, now = Date.now()) {
  const age = etaAge(r, now);
  const sec = r.EstimateTime == null ? null : Math.max(0, Math.round(Number(r.EstimateTime) - age));
  const more = (r.Estimates || []).map(x => Math.round(Number(x.EstimateTime) - age)).filter(x => Number.isFinite(x) && x !== sec).sort((a, b) => a - b);
  const raw = { t: now, sec: Number.isFinite(sec) ? sec : null, status: Number(r.StopStatus) || 0, next: r.NextBusTime ? Date.parse(r.NextBusTime) : null, last: r.IsLastBus === true, plate: r.PlateNumb && r.PlateNumb !== '-1' ? r.PlateNumb : '', more, countdown: r.StopCountDown ?? null, rt: { uid: r.RouteUID, name: zh(r.RouteName), stop: r.StopUID } };
  return said(raw, now);
}
// A time with what's known about its route now (asked again at each drawing:
// the notices and the buses on the road come in after the times do).
export function said(v, now = Date.now()) {
  const raw = v?.raw || v;
  if (!raw?.rt) return v;
  const st = routeStatus(raw.rt.uid, raw.rt.name, now, raw.rt.stop);
  const flag = st ? { effect: st.effect, label: st.label } : null;
  const onRoad = (raw.status === 0 && raw.sec != null) || raw.more.length > 0;
  if (flag && (flag.effect === 'off' || flag.effect === 'likely') && !onRoad) return { ...raw, raw, sec: null, status: 4, next: null, more: [], flag };
  return { ...raw, raw, flag };
}
export function etaMap(j) {
  const out = new Map();
  for (const r of rows(j)) {
    const v = etaOf(r);
    const old = out.get(r.StopUID);
    // A stop listed twice (a bus each way through it): the sooner one.
    if (!old || (v.sec != null && (old.sec == null || v.sec < old.sec))) out.set(r.StopUID, v);
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

// Bus stops near a point (the map), on a ~1 km grid so the proxy shares them.
// (Asked around the point rounded to 0.002°, shared by everyone near: TDX
// searches 1000 m at most, so that's still about 900 m around the point.)
export async function stationsNear(lat, lon) {
  const g = v => (Math.round(v * 500) / 500).toFixed(3);
  const j = await tdx(`advanced/v2/Bus/Station/NearBy?$spatialFilter=nearby(${g(lat)},${g(lon)},1000)&$top=500&$select=StationUID,StationID,StationName,StationPosition,Stops,LocationCityCode,Bearing`, { fresh: 86_400_000, persist: true });
  return rows(j)
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
