// 指定車次 (Jay 2026-11-03: "some train you buy ticket, HSR as well"): the
// train you hold a ticket for, 台鐵 or 高鐵, found by its number in the day's
// timetable (no read of its own: the network the planner already has), and
// a trip planned around it: there in time to board, on from where it gets
// in (planner.mjs planTicket). Any train, inside a TPASS's area or not.

import { meters } from './util.mjs';

// The day's trains with this number (both railways: 台鐵 and 高鐵 share
// some), the exact ones first, then those whose number starts so. → trips.
export function trainsNumbered(net, q, { n = 8 } = {}) {
  const no = String(q || '').trim().replace(/[^0-9A-Za-z]/g, '');
  if (!no || !net) return [];
  const exact = [];
  const starts = [];
  const seen = new Set();
  for (const t of net.trips) {
    const id = `${t.sys}:${t.no}:${t.stops[0]?.dep}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (String(t.no) === no) exact.push(t);
    else if (no.length >= 2 && String(t.no).startsWith(no)) starts.push(t);
  }
  const byDep = (a, b) => a.stops[0].dep - b.stops[0].dep;
  return [...exact.sort(byDep), ...starts.sort((a, b) => String(a.no).length - String(b.no).length || byDep(a, b))].slice(0, n);
}

// Where to get on and off a train: the stop nearest the start, then the stop
// after it nearest the end (`from`, `to`: points, or a station's key to take
// as is). → { k, j } (indexes into trip.stops) or null.
export function boardAlight(net, trip, from, to) {
  const s = trip.stops;
  if (s.length < 2) return null;
  const at = (x, i) => {
    const st = net.st.get(s[i].st);
    return st && x?.lat != null ? meters(x.lat, x.lon, st.lat, st.lon) : Infinity;
  };
  const pick = (x, lo, hi) => {
    if (typeof x === 'string') {
      const i = s.findIndex((y, k) => k >= lo && k <= hi && y.st === x);
      return i >= 0 ? i : null;
    }
    let best = null;
    for (let i = lo; i <= hi; i++) if (best == null || at(x, i) < at(x, best)) best = i;
    return best;
  };
  // (No start known: where the train sets out; no end: where it ends.)
  const k = from == null || (typeof from !== 'string' && from.lat == null) ? 0 : pick(from, 0, s.length - 2);
  if (k == null) return null;
  const j = to == null || (typeof to !== 'string' && to.lat == null) ? s.length - 1 : pick(to, k + 1, s.length - 1);
  return j == null ? null : { k, j };
}

// A ride on a trip from stop k to stop j, as the router's leg (rail.mjs journeys).
export const rideOf = (trip, k, j) => ({ trip, from: trip.stops[k].st, to: trip.stops[j].st, dep: trip.stops[k].dep, arr: trip.stops[j].arr, stops: j - k, fromK: k });

// The ticket kept with the trip's time (`when` in tab-map.mjs): each ride by
// its railway, number, stations and times; `auto`: the stations were the
// nearest ones, picked again when the trip's ends change.
export const ticketOf = (rides, auto = false) => ({
  auto,
  rides: rides.map(r => ({ sys: r.trip.sys, no: String(r.trip.no), type: r.trip.type, from: r.from, to: r.to, dep: r.dep, arr: r.arr }))
});

// The ticket's rides found again in a network: the same train (railway,
// number) calling at the same stations at the same times. → rides or null.
export function ridesIn(net, ticket, ends = null) {
  const out = [];
  for (const r of ticket?.rides || []) {
    const trip = net.trips.find(t => t.sys === r.sys && String(t.no) === r.no && t.stops.some(s => s.st === r.from && Math.abs(s.dep - r.dep) < 60_000));
    if (!trip) return null;
    // (One train picked by its number, the trip's ends moved: its stations picked again.)
    const ka = ticket.auto && ends && ticket.rides.length === 1 ? boardAlight(net, trip, ends.from, ends.to) : null;
    const k = ka ? ka.k : trip.stops.findIndex(s => s.st === r.from && Math.abs(s.dep - r.dep) < 60_000);
    const j = ka ? ka.j : trip.stops.findIndex((s, i) => i > k && s.st === r.to);
    if (k < 0 || j < 0) return null;
    out.push(rideOf(trip, k, j));
  }
  return out.length ? out : null;
}

// A plan uses a ride on this train (a way to the station that rides it there isn't one).
export const onTicketTrain = (p, ticket) => p.legs.some(l => l.train && ticket.rides.some(r => r.sys === l.train.sys && r.no === String(l.train.no)));
