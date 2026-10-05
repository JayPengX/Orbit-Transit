// Trains across Taiwan: TRA (every line, the branch lines too) and HSR as
// one network, searched on the device.
//
// A day's whole timetable (one TDX answer per railway, shared through the
// proxy) becomes connections, one per train between two stops, sorted by
// departure; the Connection Scan Algorithm finds the earliest arrival from
// any start, changing trains wherever that is faster: a 內灣線 train to 竹中,
// the 六家線 to 六家, a walk to HSR 新竹, the HSR to 台北, without
// anyone having said where to change. Changes cost real minutes (TDX's
// transfer times where it gives them, else by distance), and the search runs
// again from just after each first departure so that every option is the
// latest way to leave for its arrival.

import { meters, twAt, zh } from './util.mjs';
import { cityFromAddress } from './city.mjs';

export const SYSTEMS = { tra: '台鐵', hsr: '高鐵', metro: '捷運' };
export const TRAIN_TYPES = { 1: '太魯閣', 2: '普悠瑪', 3: '自強', 4: '莒光', 5: '復興', 6: '區間', 7: '普快', 10: '區間快', 11: '自強' };
// Express classes (reserved seats), for the "fewer stops" sort and the fares.
export const EXPRESS = new Set(['1', '2', '3', '4', '11']); // 11: 自強(3000)

// ---- Stations ---------------------------------------------------------------------------

// TDX v3 TRA stations → [{ key, sys, id, name, lat, lon, cls, city }].
export function traStations(j) {
  return (j?.Stations || [])
    .map(s => ({
      key: `tra:${s.StationID}`,
      sys: 'tra',
      id: s.StationID,
      name: zh(s.StationName),
      lat: Number(s.StationPosition?.PositionLat),
      lon: Number(s.StationPosition?.PositionLon),
      cls: String(s.StationClass ?? ''),
      city: cityFromAddress(s.StationAddress)
    }))
    // Freight yards, depots and signal stations take no passengers.
    .filter(s => s.id && s.name && Number.isFinite(s.lat) && !['A', 'B', 'X', '6'].includes(s.cls));
}
// TDX v2 HSR stations.
export function hsrStations(list) {
  return (Array.isArray(list) ? list : []).map(s => ({
    key: `hsr:${s.StationID}`,
    sys: 'hsr',
    id: s.StationID,
    name: zh(s.StationName),
    lat: Number(s.StationPosition?.PositionLat),
    lon: Number(s.StationPosition?.PositionLon),
    cls: '0',
    city: cityFromAddress(`${s.LocationCity || ''}${s.StationAddress || ''}`)
  }));
}

// ---- Timetables → trips ---------------------------------------------------------------------

// Times through the night run on past 24:00 (a train leaving 23:50 arrives
// 00:20 the next day).
function stopTimes(date, list, keyOf) {
  const out = [];
  let last = -Infinity;
  let shift = 0;
  for (const s of list) {
    const arrS = s.ArrivalTime || s.DepartureTime;
    const depS = s.DepartureTime || s.ArrivalTime;
    if (!arrS || !depS) continue;
    let arr = twAt(date, arrS) + shift;
    if (arr < last - 3_600_000) {
      shift += 86_400_000;
      arr += 86_400_000;
    }
    let dep = twAt(date, depS) + shift;
    if (dep < arr) dep += 86_400_000;
    last = dep;
    out.push({ st: keyOf(s.StationID), arr, dep, off: s.SuspendedFlag === 1 });
  }
  return out;
}

// TDX v3 TRA DailyTrainTimetable/TrainDate/{date} → trips.
export function traTrips(j) {
  const date = j?.TrainDate;
  return (j?.TrainTimetables || [])
    .filter(t => t.TrainInfo && t.TrainInfo.SuspendedFlag !== 1)
    .map(t => {
      const i = t.TrainInfo;
      return {
        id: `tra:${date || i.TrainDate}:${i.TrainNo}`,
        sys: 'tra',
        no: i.TrainNo,
        code: String(i.TrainTypeCode ?? ''),
        type: TRAIN_TYPES[i.TrainTypeCode] || zh(i.TrainTypeName).replace(/\(.*$/, ''),
        typeFull: zh(i.TrainTypeName),
        headsign: i.TripHeadSign || zh(i.EndingStationName),
        line: i.TripLine || 0,
        note: i.Note || '',
        bike: i.BikeFlag === 1,
        stops: stopTimes(date || i.TrainDate, t.StopTimes || [], id => `tra:${id}`).filter(s => !s.off)
      };
    })
    .filter(t => t.stops.length > 1);
}
// TDX v2 THSR DailyTimetable/TrainDate/{date} → trips.
export function hsrTrips(list) {
  return (Array.isArray(list) ? list : [])
    .map(t => {
      const i = t.DailyTrainInfo || {};
      const date = String(t.TrainDate || '').replace(/:/g, '-');
      return {
        id: `hsr:${date}:${i.TrainNo}`,
        sys: 'hsr',
        no: i.TrainNo,
        code: 'hsr',
        type: '高鐵',
        typeFull: '高鐵',
        headsign: zh(i.EndingStationName),
        note: zh(i.Note),
        stops: stopTimes(date, t.StopTimes || [], id => `hsr:${id}`)
      };
    })
    .filter(t => t.stops.length > 1);
}

// ---- Changing trains ------------------------------------------------------------------------

// The minutes to change at one station: TRA's big stations take longer
// (more platforms, an underpass), HSR's are one hall.
export function changeMin(st) {
  if (st.sys === 'hsr') return 4;
  if (st.sys === 'metro') return 3;
  return st.cls === '0' ? 5 : st.cls === '1' ? 4 : 3;
}

// Walks between systems: any two stations of different railways within
// 900 m (a 高鐵 station and the 台鐵 station beside it: 六家 and 新竹, 新烏日
// and 台中, 沙崙 and 台南, 新左營 and 左營, 豐富 and 苗栗, the shared
// halls of 南港, 台北 and 板橋), timed at walking pace plus a margin for
// gates and stairs; `known` (TDX's own transfer minutes) wins where given.
export function links(stations, known = []) {
  const out = [];
  const byKey = new Map(stations.map(s => [s.key, s]));
  const given = new Map(known.map(k => [`${k.from}>${k.to}`, k.min]));
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i];
      const b = stations[j];
      if (a.sys === b.sys && a.sys !== 'metro') continue;
      if (a.sys === 'metro' && b.sys === 'metro' && a.op === b.op) continue;
      const d = meters(a.lat, a.lon, b.lat, b.lon);
      if (d > 900) continue;
      const walk = Math.max(4, Math.round((d * 1.3) / 75) + 4);
      out.push({ from: a.key, to: b.key, min: given.get(`${a.key}>${b.key}`) ?? walk, d: Math.round(d) });
      out.push({ from: b.key, to: a.key, min: given.get(`${b.key}>${a.key}`) ?? walk, d: Math.round(d) });
    }
  }
  for (const k of known) if (byKey.has(k.from) && byKey.has(k.to) && !out.some(o => o.from === k.from && o.to === k.to)) out.push({ from: k.from, to: k.to, min: k.min, d: 0 });
  return out;
}

// ---- The network and the search -----------------------------------------------------------

export function network(stations, trips, walks = links(stations)) {
  const st = new Map(stations.map(s => [s.key, s]));
  const conns = [];
  trips.forEach((trip, ti) => {
    for (let k = 0; k + 1 < trip.stops.length; k++) {
      const a = trip.stops[k];
      const b = trip.stops[k + 1];
      if (!st.has(a.st) || !st.has(b.st)) continue;
      conns.push({ from: a.st, to: b.st, dep: a.dep, arr: b.arr, trip: ti, k });
    }
  });
  conns.sort((x, y) => x.dep - y.dep || x.arr - y.arr);
  const foot = new Map();
  for (const w of walks) {
    if (!foot.has(w.from)) foot.set(w.from, []);
    foot.get(w.from).push(w);
  }
  return { st, trips, conns, foot };
}

// The first connection leaving at or after t (binary search).
function firstAt(conns, t) {
  let lo = 0;
  let hi = conns.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (conns[mid].dep < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Earliest arrival from `starts` ([{ key, at (ms, ready to board) }]) at any of
// `targets` ([{ key, extra (s, e.g. the walk from the station) }]).
// `use(trip)` limits which trains count. → a journey or null.
export function earliest(net, starts, targets, { use = () => true, maxHours = 30 } = {}) {
  const arr = new Map();
  const ready = new Map();
  const how = new Map(); // key → { conn: i, enter: i } | { walk: from, min } | { start: true }
  const enter = new Map(); // trip → the connection boarded
  for (const s of starts) {
    if (!net.st.has(s.key)) continue;
    if (!(arr.get(s.key) <= s.at)) {
      arr.set(s.key, s.at);
      ready.set(s.key, s.at);
      how.set(s.key, { start: true });
    }
  }
  if (!arr.size) return null;
  const t0 = Math.min(...arr.values());
  const extra = new Map(targets.map(t => [t.key, (t.extra || 0) * 1000]));
  let best = Infinity;
  let bestKey = null;
  const settle = () => {
    for (const [k, x] of extra) {
      const a = arr.get(k);
      if (a != null && a + x < best) {
        best = a + x;
        bestKey = k;
      }
    }
  };
  // Starting at a target already (or walking to one).
  for (const s of starts) for (const w of net.foot.get(s.key) || []) relaxWalk(s.key, w, s.at);
  settle();
  function relaxWalk(from, w, at) {
    const t = at + w.min * 60_000;
    if (!(arr.get(w.to) <= t)) {
      arr.set(w.to, t);
      ready.set(w.to, t);
      how.set(w.to, { walk: from, min: w.min });
    }
  }
  const limit = t0 + maxHours * 3_600_000;
  for (let i = firstAt(net.conns, t0); i < net.conns.length; i++) {
    const c = net.conns[i];
    if (c.dep >= best || c.dep > limit) break;
    if (!use(net.trips[c.trip])) continue;
    const onTrip = enter.has(c.trip);
    if (!onTrip) {
      const r = ready.get(c.from);
      if (r == null || r > c.dep) continue;
      enter.set(c.trip, i);
    }
    if (!(arr.get(c.to) <= c.arr)) {
      arr.set(c.to, c.arr);
      const stTo = net.st.get(c.to);
      const r = c.arr + changeMin(stTo) * 60_000;
      // A change at the same station takes its minutes; staying on board doesn't.
      if (!(ready.get(c.to) <= r)) ready.set(c.to, r);
      how.set(c.to, { conn: i, enter: enter.get(c.trip) });
      for (const w of net.foot.get(c.to) || []) relaxWalk(c.to, w, c.arr);
      if (extra.has(c.to) || (net.foot.get(c.to) || []).some(w => extra.has(w.to))) settle();
    }
  }
  if (bestKey == null) return null;
  // Back from the target to the start.
  const legs = [];
  let k = bestKey;
  for (let guard = 0; guard < 40; guard++) {
    const h = how.get(k);
    if (!h || h.start) break;
    if (h.walk) {
      legs.unshift({ walk: true, from: h.walk, to: k, min: h.min, dep: arr.get(h.walk), arr: arr.get(k) });
      k = h.walk;
      continue;
    }
    const c = net.conns[h.conn];
    const e = net.conns[h.enter];
    const trip = net.trips[c.trip];
    legs.unshift({ trip, from: e.from, to: c.to, dep: e.dep, arr: c.arr, stops: c.k - e.k + 1, fromK: e.k, toK: c.k + 1 });
    k = e.from;
  }
  // Walks before the first train and after the last aren't legs of a train journey.
  while (legs[0]?.walk && starts.length > 1) legs.shift();
  const rides = legs.filter(l => !l.walk);
  if (!rides.length) return null;
  return { legs, dep: rides[0].dep, arr: rides.at(-1).arr, end: bestKey, transfers: rides.length - 1, extra: (extra.get(bestKey) || 0) / 1000 };
}

// Every direct train from a to b after t (no change at all).
export function directs(net, a, b, t, { use = () => true, n = 8 } = {}) {
  const out = [];
  for (const trip of net.trips) {
    if (!use(trip)) continue;
    const i = trip.stops.findIndex(s => s.st === a);
    if (i < 0 || trip.stops[i].dep < t) continue;
    const j = trip.stops.findIndex((s, x) => x > i && s.st === b);
    if (j < 0) continue;
    out.push({ legs: [{ trip, from: a, to: b, dep: trip.stops[i].dep, arr: trip.stops[j].arr, stops: j - i, fromK: i, toK: j }], dep: trip.stops[i].dep, arr: trip.stops[j].arr, end: b, transfers: 0, extra: 0 });
  }
  return out.sort((x, y) => x.dep - y.dep).slice(0, n);
}

// The options from a to b leaving after t: the fastest ways in order of
// departure, each the latest way to leave for its arrival, plus the direct
// trains; none another option beats on departure, arrival and changes.
export function journeys(net, from, to, t, { n = 6, use = () => true } = {}) {
  const starts = (Array.isArray(from) ? from : [{ key: from, at: t }]).map(s => ({ ...s, at: s.at ?? t }));
  const targets = Array.isArray(to) ? to : [{ key: to, extra: 0 }];
  const found = [];
  let at = Math.min(...starts.map(s => s.at));
  for (let guard = 0; guard < n * 3 && found.length < n * 2; guard++) {
    const j = earliest(net, starts.map(s => ({ ...s, at: Math.max(s.at, at) })), targets, { use });
    if (!j || !j.legs?.some(l => !l.walk)) break;
    found.push(j);
    at = j.dep + 60_000;
  }
  if (starts.length === 1 && targets.length === 1) found.push(...directs(net, starts[0].key, targets[0].key, starts[0].at, { use }));
  // Each station set out from is a choice of its own (六家 for the 六家線,
  // over riding across 頭前溪 to 千甲 for a train an hour sooner): its own
  // soonest journey too, however much later it gets in (the ranking weighs it).
  // The same for each station arrived at (the 六家線 on to 六家, or off at
  // 竹中, over a train sooner to 千甲 across 頭前溪 from home).
  const own = new Set();
  const best = () => Math.min(...found.map(f => f.arr));
  const soonest = (ss, ts) => {
    let j = earliest(net, ss, ts, { use });
    // Leaving as late as still gets in then (the 11:29 from 六家, not a
    // 10:29 that waits an hour at 竹中 for the same train on).
    for (let k = 0; j && k < 4; k++) {
      const later = earliest(net, ss.map(s => ({ ...s, at: Math.max(s.at, j.dep + 60_000) })), ts, { use });
      if (!later?.legs?.some(l => !l.walk) || later.arr > j.arr) break;
      j = later;
    }
    return j?.legs?.some(l => !l.walk) && !j.legs[0].walk && j.arr - best() < 90 * 60_000 ? j : null;
  };
  if (starts.length > 1)
    for (const s of starts) {
      const j = soonest([s], targets);
      if (j && j.legs[0].from === s.key) (found.push(j), own.add(j));
    }
  if (targets.length > 1)
    for (const tg of targets) {
      const j = soonest(starts, [tg]);
      if (j && j.end === tg.key) (found.push(j), own.add(j));
    }
  const sig = j => j.legs.map(l => (l.walk ? `w:${l.to}` : `${l.trip.id}:${l.from}`)).join('|');
  const seen = new Set();
  const uniq = found.filter(j => !seen.has(sig(j)) && seen.add(sig(j)));
  // (A station's own journey also found by the search above: kept as its own.)
  const ownSig = new Set([...own].map(sig));
  for (const j of uniq) if (ownSig.has(sig(j))) own.add(j);
  const fin = j => j.arr + j.extra * 1000;
  // When you set out for it: its first train less the way to that station
  // (`pre`, seconds), so boarding the same train a station further up isn't
  // 'leaving later' (a 28-minute walk to 榮華 for the train that stopped at 竹東).
  const pre = new Map(starts.map(s => [s.key, (s.pre || 0) * 1000]));
  const go = j => j.dep - (pre.get(j.legs[0]?.from) || 0);
  const kept = uniq.filter(a => own.has(a) || !uniq.some(b => b !== a && go(b) >= go(a) && fin(b) <= fin(a) && b.transfers <= a.transfers && (go(b) > go(a) || fin(b) < fin(a) || b.transfers < a.transfers)));
  const top = kept.filter(j => !own.has(j)).sort((a, b) => fin(a) - fin(b) || go(b) - go(a)).slice(0, n * 2);
  return [...top, ...kept.filter(j => own.has(j))].sort((a, b) => a.dep - b.dep);
}

// Labels for a list of options: the fastest, the earliest there, the fewest changes.
export function tags(list) {
  if (!list.length) return new Map();
  const out = new Map(list.map(j => [j, []]));
  const fin = j => j.arr + (j.extra || 0) * 1000;
  const fastest = list.reduce((a, b) => (fin(b) - b.dep < fin(a) - a.dep ? b : a));
  const first = list.reduce((a, b) => (fin(b) < fin(a) ? b : a));
  out.get(first).push('最早抵達');
  if (fastest !== first) out.get(fastest).push('車程最短');
  const minT = Math.min(...list.map(j => j.transfers));
  if (list.some(j => j.transfers > minT)) for (const j of list) if (j.transfers === minT && j.transfers === 0) out.get(j).push('直達');
  return out;
}

// ---- Fares ----------------------------------------------------------------------------------

// TDX v3 TRA ODFare → the adult one-way price for a train type code.
export function traFare(j, code) {
  // Each fare comes twice: the short way, and the long way round the island
  // (竹北 → 香山 by 862 km). Only the short one is the trip.
  const all = j?.ODFares || [];
  const km = Math.min(...all.map(f => Number(f.TravelDistance)).filter(Number.isFinite));
  const fares = Number.isFinite(km) ? all.filter(f => !(Number(f.TravelDistance) > km)) : all;
  const pick = fares.find(f => String(f.TrainType) === String(code)) || fares.find(f => String(f.TrainType) === (EXPRESS.has(String(code)) ? '3' : '6')) || fares[0];
  const p = pick?.Fares?.find(f => f.TicketType === 1 && f.FareClass === 1) || pick?.Fares?.[0];
  return p ? Number(p.Price) : null;
}
// TDX v2 THSR ODFare → { standard, free } adult prices.
export function hsrFare(list) {
  const f = (Array.isArray(list) ? list[0] : null)?.Fares || [];
  const at = cabin => f.find(x => x.TicketType === 1 && x.FareClass === 1 && x.CabinClass === cabin)?.Price ?? null;
  return { standard: at(1), business: at(2), free: at(3) };
}
