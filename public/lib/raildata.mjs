// The railways' data, loaded once and shared by the map and the 火車 tab:
// the stations (a week on the device), a day's timetables (6 hours), the
// live boards (under a minute), and the network the router searches.

import { tdx, rows, keptLocal, keepLocal } from './api.mjs';
import { traStations, hsrStations, traTrips, hsrTrips, network, links, traFare, hsrFare } from './rail.mjs';
import { loadSystem, mapsNear } from './metro.mjs';
import { tw, zh, twAt, addDays } from './util.mjs';

const DAY = 86_400_000;

let stationsP = null;
// TRA and HSR stations: [{ key, sys, id, name, lat, lon, cls, city }].
export function railStations() {
  stationsP ||= Promise.all([
    tdx('basic/v3/Rail/TRA/Station?$select=StationUID,StationID,StationName,StationPosition,StationAddress,StationClass', { fresh: 7 * DAY, persist: true }),
    tdx('basic/v2/Rail/THSR/Station', { fresh: 7 * DAY, persist: true })
  ])
    .then(([t, h]) => [...traStations(t), ...hsrStations(h)])
    .catch(err => {
      stationsP = null;
      throw err;
    });
  return stationsP;
}

// Metro systems' stations, loaded only where they're wanted (4 TDX answers a
// system, kept a week): those of the maps an area touches ([s, w, n, e], or a
// point), else the ones loaded already.
const systemsP = new Map();
const system = sys => {
  if (!systemsP.has(sys)) systemsP.set(sys, loadSystem(sys).catch(() => (systemsP.delete(sys), { sys, stations: [], lines: [] })));
  return systemsP.get(sys);
};
export function metroSystems(area) {
  const box = area && !Array.isArray(area) ? [area.lat - 0.02, area.lon - 0.02, area.lat + 0.02, area.lon + 0.02] : area;
  const want = box ? mapsNear(box).flatMap(m => m.systems) : [...systemsP.keys()];
  return Promise.all(want.map(system));
}

// A day's trains (台鐵 and 高鐵): trips for the router. TDX's 台鐵 day is
// 3.7 MB of JSON; what the router needs of it is kept on the device in a
// compact form (about a tenth), so a second look the same day reads that
// instead of parsing it all again.
const days = new Map();
const TRIPS_FRESH = 6 * 3_600_000;
const tripsKey = date => `rail-trips-v1/${date}`;
export function packTrips(date, trips) {
  const base = twAt(date, '00:00');
  return { date, base, trips: trips.map(({ stops, ...t }) => ({ ...t, s: stops.flatMap(x => [x.st, Math.round((x.arr - base) / 60_000), Math.round((x.dep - base) / 60_000)]) })) };
}
export function unpackTrips(p) {
  return (p?.trips || []).map(({ s, ...t }) => {
    const stops = [];
    for (let i = 0; i + 2 < s.length; i += 3) stops.push({ st: s[i], arr: p.base + s[i + 1] * 60_000, dep: p.base + s[i + 2] * 60_000 });
    return { ...t, stops };
  });
}
export function dayTrips(date) {
  if (!days.has(date)) {
    days.set(
      date,
      (async () => {
        const old = await keptLocal(tripsKey(date));
        if (old && Date.now() - old.at < TRIPS_FRESH) return unpackTrips(old.data);
        const [a, b] = await Promise.all([
          tdx(`basic/v3/Rail/TRA/DailyTrainTimetable/TrainDate/${date}`, { fresh: TRIPS_FRESH, store: false }).then(traTrips).catch(() => null),
          tdx(`basic/v2/Rail/THSR/DailyTimetable/TrainDate/${date}`, { fresh: TRIPS_FRESH, store: false }).then(hsrTrips).catch(() => null)
        ]);
        // Nothing came: the last copy kept, however old, else nothing (asked again next time).
        if (!a?.length && !b?.length) {
          if (old) return unpackTrips(old.data);
          days.delete(date);
          return [];
        }
        const trips = [...(a || []), ...(b || [])];
        if (a?.length && b?.length) keepLocal(tripsKey(date), packTrips(date, trips));
        return trips;
      })()
    );
  }
  return days.get(date);
}

// Ready before it's asked for: the day's network, built while the app is idle.
export function warmRail() {
  const t = tw();
  return railNetwork(t.date, { next: t.min >= 21 * 60 }).catch(() => null);
}

// The network for a day: its trains (those past midnight included), every
// station and the walks between railways; late in the evening the next
// day's trains too (`next`), for the first train tomorrow.
const nets = new Map();
export async function railNetwork(date, { next = false } = {}) {
  const key = `${date}${next ? '+' : ''}`;
  if (!nets.has(key)) {
    nets.set(
      key,
      (async () => {
        const stations = await railStations();
        const [a, b] = await Promise.all([dayTrips(date), next ? dayTrips(addDays(date, 1)) : []]);
        const trips = [...a, ...b];
        return network(stations, trips, links(stations));
      })().catch(err => {
        nets.delete(key);
        throw err;
      })
    );
  }
  return nets.get(key);
}

// A TRA station's board: the trains due in the next hour, with delays and
// platforms. [{ no, type, dest, dir, sched (ms), delay (min), platform, status }].
export async function traBoard(id) {
  const j = await tdx(`basic/v3/Rail/TRA/StationLiveBoard/Station/${id}`, { fresh: 50_000 });
  const today = tw().date;
  return rows(j)
    .map(r => ({
      no: r.TrainNo,
      type: zh(r.TrainTypeName).replace(/\(.*$/, ''),
      dest: zh(r.EndingStationName),
      dir: r.Direction,
      sched: r.ScheduleDepartureTime || r.ScheduleArrivalTime ? twAt(today, r.ScheduleDepartureTime || r.ScheduleArrivalTime) : null,
      delay: Number(r.DelayTime) || 0,
      platform: r.Platform && r.Platform !== '00' ? r.Platform : '',
      status: Number(r.RunningStatus) || 0
    }))
    .sort((a, b) => (a.sched || 0) - (b.sched || 0));
}

// Every train's delay now (TRA), by train number.
export async function traDelays() {
  const j = await tdx('basic/v3/Rail/TRA/TrainLiveBoard', { fresh: 60_000 });
  return new Map(rows(j).map(r => [r.TrainNo, Number(r.DelayTime) || 0]));
}

// The next trains at an HSR station today, from the day's timetable.
export async function hsrBoard(id, now = Date.now()) {
  const trips = (await dayTrips(tw(now).date)).filter(t => t.sys === 'hsr');
  const key = `hsr:${id}`;
  return trips
    .map(t => {
      const i = t.stops.findIndex(s => s.st === key);
      return i >= 0 && i < t.stops.length - 1 ? { no: t.no, dest: t.headsign, dep: t.stops[i].dep, dir: t.stops.at(-1).st } : null;
    })
    .filter(x => x && x.dep >= now - 60_000)
    .sort((a, b) => a.dep - b.dep)
    .slice(0, 8);
}

// Fares for a leg (adult, one way).
export async function legFare(leg) {
  const [sa, a] = leg.from.split(':');
  const [, b] = leg.to.split(':');
  if (sa === 'tra') return traFare(await tdx(`basic/v3/Rail/TRA/ODFare/${a}/to/${b}`, { fresh: 7 * DAY, persist: true }), leg.trip.code);
  if (sa === 'hsr') return hsrFare(await tdx(`basic/v2/Rail/THSR/ODFare/${a}/to/${b}`, { fresh: 7 * DAY, persist: true }))?.standard ?? null;
  return null;
}
