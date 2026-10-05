// Our own metro router, for the rides the planners leave out (板橋 → 內湖:
// 板南線 then 文湖線, when they offer 板南線 and a bus). Each system's
// stations and lines (metro.mjs, kept a week), the time between stations
// from TDX's S2STravelTime (else the distance at 35 km/h), the wait for a
// train half its headway at that hour (TDX's Frequency, else 6 minutes),
// a change of line 3 minutes' walk and a wait. Times are estimates: no
// timetable, the trains come every few minutes.

import { tdx, rows } from './api.mjs';
import { MAPS, OPERATORS, loadSystem, lineRuns } from './metro.mjs';
import { meters, walkSec, tw } from './util.mjs';
import { finish } from './plan.mjs';

const DAY = 86_400_000;
const WALK_M = 1500; // stations this far from either end are walked to
const CHANGE_SEC = 180;
const CHANGE_COST = 5 * 60; // what a change costs on top of its time, when choosing
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const nets = new Map();
// One map's network (台北・新北, 高雄…): { st: Map(key → station), lines: Map(id → line), next: Map(key → [{ to, sec, line }]), freq }.
export async function metroNet(map) {
  if (!nets.has(map.id))
    nets.set(
      map.id,
      (async () => {
        const systems = await Promise.all(map.systems.map(sys => loadSystem(sys).catch(() => null)));
        const extra = await Promise.all(
          map.systems.map(async sys => ({
            sys,
            s2s: rows(await tdx(`basic/v2/Rail/Metro/S2STravelTime/${sys}`, { fresh: 7 * DAY, persist: true }).catch(() => [])),
            freq: rows(await tdx(`basic/v2/Rail/Metro/Frequency/${sys}`, { fresh: 7 * DAY, persist: true }).catch(() => []))
          }))
        );
        return buildNet(systems.filter(Boolean), extra);
      })().catch(err => {
        nets.delete(map.id);
        throw err;
      })
    );
  return nets.get(map.id);
}

// The network from loadSystem's systems and each system's { sys, s2s, freq } rows.
export function buildNet(systems, extra = []) {
  const st = new Map();
  const lines = new Map();
  const next = new Map();
  const secs = new Map();
  const freq = new Map();
  for (const x of extra) {
    for (const r of x.s2s)
      for (const t of r.TravelTimes || []) {
        const sec = (Number(t.RunTime) || 0) + (Number(t.StopTime) || 0);
        // (Only real hops: 高雄輕軌 lists a 90-minute loop from a station to itself.)
        if (t.FromStationID === t.ToStationID || !sec || sec > 900) continue;
        const k = `metro:${x.sys}:${t.FromStationID}>metro:${x.sys}:${t.ToStationID}`;
        secs.set(k, Math.min(secs.get(k) ?? Infinity, sec));
      }
    for (const r of x.freq) {
      const k = `${x.sys}:${r.LineID || r.LineNo}`;
      if (!freq.has(k)) freq.set(k, []);
      freq.get(k).push(r);
    }
  }
  for (const s of systems) {
    for (const x of s.stations) st.set(x.key, x);
    for (const l of s.lines) {
      const id = `${s.sys}:${l.id}`;
      lines.set(id, { ...l, id, sys: s.sys, freq: freq.get(id) || [] });
      const byKey = new Map(s.stations.map(x => [x.key, x]));
      const runs = l.paths.length ? l.paths.map(p => p.map(k => byKey.get(k)).filter(Boolean)) : lineRuns(l, byKey);
      for (const run of runs)
        for (let i = 0; i + 1 < run.length; i++) {
          const [a, b] = [run[i], run[i + 1]];
          const guess = Math.round((meters(a.lat, a.lon, b.lat, b.lon) * 1.2) / (35 / 3.6)) + 30;
          const sec = secs.get(`${a.key}>${b.key}`) ?? secs.get(`${b.key}>${a.key}`) ?? guess;
          for (const [p, q] of [[a, b], [b, a]]) {
            if (!next.has(p.key)) next.set(p.key, []);
            if (!next.get(p.key).some(e => e.to === q.key && e.line === id)) next.get(p.key).push({ to: q.key, sec, line: id });
          }
        }
    }
  }
  // Where lines meet: the same station on each line (忠孝復興 BL15 and BR10), within 250 m by name or 80 m.
  const all = [...st.values()];
  const meet = new Map();
  for (const a of all)
    meet.set(
      a.key,
      all.filter(b => b !== a && ((b.name === a.name && meters(a.lat, a.lon, b.lat, b.lon) < 250) || meters(a.lat, a.lon, b.lat, b.lon) < 80)).map(b => b.key)
    );
  return { st, lines, next, meet };
}

// A line's wait for a train at a moment: half its headway then (6 minutes
// unknown), or null when it isn't running (after its last train).
export function waitSec(line, at) {
  const t = tw(at);
  const day = DAYS[t.dow];
  const hmv = t.hm;
  const list = line.freq.filter(r => !r.ServiceDay || r.ServiceDay[day] === true || r.ServiceDay[day] === 1);
  if (!list.length) return hmv >= '06:00' ? 180 : null;
  for (const r of list) {
    const on = r.OperationTime;
    if (on?.StartTime && on?.EndTime) {
      const end = on.EndTime >= '24:00' || on.EndTime < on.StartTime ? '23:59' : on.EndTime;
      if (hmv < on.StartTime && !(on.EndTime < on.StartTime && hmv <= on.EndTime)) continue;
      if (hmv > end && !(on.EndTime < on.StartTime)) continue;
    }
    const h = (r.Headways || []).find(x => x.StartTime <= hmv && hmv < (x.EndTime === '24:00' ? '24:00' : x.EndTime));
    if (h) return Math.round((((Number(h.MinHeadwayMins) || 6) + (Number(h.MaxHeadwayMins) || Number(h.MinHeadwayMins) || 6)) / 2) * 30);
    return 240;
  }
  return null;
}

// Rides by metro from o to d leaving at `at`: plans (the planners' shape),
// the quickest and, when it changes lines, the quickest with fewer changes.
export function metroRoutes(net, o, d, at, { n = 2 } = {}) {
  const near = pt => [...net.st.values()].map(s => ({ s, m: meters(pt.lat, pt.lon, s.lat, s.lon) })).filter(x => x.m <= WALK_M).sort((a, b) => a.m - b.m).slice(0, 4);
  const A = near(o);
  const B = near(d);
  if (!A.length || !B.length || meters(o.lat, o.lon, d.lat, d.lon) < 1200) return [];
  const ends = new Map(B.map(x => [x.s.key, x.m]));
  // Dijkstra over (station, line): `t` the clock, `c` the cost (the clock plus what changes cost).
  const best = new Map();
  const heap = [];
  const push = x => {
    const k = `${x.key}|${x.line}|${x.ch}`;
    if (best.has(k) && best.get(k).c <= x.c) return;
    best.set(k, x);
    heap.push(x);
  };
  for (const x of A)
    for (const id of new Set((net.next.get(x.s.key) || []).map(e => e.line))) {
      const line = net.lines.get(id);
      const walk = walkSec(x.m) * 1000;
      const w = waitSec(line, at + walk);
      if (w == null) continue;
      push({ key: x.s.key, line: id, t: at + walk + w * 1000, c: at + walk + w * 1000, ch: 0, prev: null, board: x.s.key, boardAt: at + walk + w * 1000, walk0: x });
    }
  const done = [];
  const seen = new Set();
  while (heap.length) {
    heap.sort((a, b) => a.c - b.c);
    const x = heap.shift();
    const k = `${x.key}|${x.line}|${x.ch}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (ends.has(x.key) && x.key !== x.board) done.push(x);
    if (done.length >= 12 || x.ch > 3) continue;
    for (const e of net.next.get(x.key) || []) if (e.line === x.line) push({ ...x, key: e.to, t: x.t + e.sec * 1000, c: x.c + e.sec * 1000, prev: x });
    // Changing line here (or at the same station on another line).
    for (const sk of [x.key, ...(net.meet.get(x.key) || [])])
      for (const id of new Set((net.next.get(sk) || []).map(e => e.line))) {
        if (id === x.line) continue;
        const walkT = (sk === x.key ? 60 : CHANGE_SEC) * 1000;
        const w = waitSec(net.lines.get(id), x.t + walkT);
        if (w == null) continue;
        const t = x.t + walkT + w * 1000;
        push({ key: sk, line: id, t, c: x.c + walkT + w * 1000 + CHANGE_COST * 1000, ch: x.ch + 1, prev: { ...x, alight: true }, board: sk, boardAt: t, walk0: x.walk0 });
      }
  }
  const total = x => x.c + walkSec(ends.get(x.key)) * 1000;
  const picks = [];
  for (const x of done.sort((a, b) => total(a) - total(b))) {
    if (picks.length >= n) break;
    if (picks.some(p => p.ch <= x.ch)) continue;
    picks.push(x);
  }
  return picks.map(x => toPlan(net, x, o, d, at, ends.get(x.key)));
}

// A path back into legs: walk, a ride per line, walk.
function toPlan(net, x, o, d, at, endM) {
  const hops = [];
  for (let y = x; y; y = y.prev) hops.unshift(y);
  const legs = [];
  const pt = k => {
    const s = net.st.get(k);
    return { name: s.name, lat: s.lat, lon: s.lon };
  };
  const w0 = hops[0].walk0;
  const walk = (from, to, dep, m) => {
    const dur = walkSec(m);
    return { mode: 'walk', from, to, dep, arr: dep + dur * 1000, dur, dist: Math.round(m * 1.3), straight: true };
  };
  // Each ride: from where it was boarded to the last stop on that line.
  let ride = null;
  const close = (y, arr) => {
    const line = net.lines.get(ride.line);
    legs.push({ mode: 'metro', name: line.name, short: line.name, color: line.color, agency: OPERATORS[line.sys] || '', from: pt(ride.board), to: pt(y.key), dep: ride.boardAt, arr, dur: Math.round((arr - ride.boardAt) / 1000), stops: ride.stops, dist: Math.round(meters(net.st.get(ride.board).lat, net.st.get(ride.board).lon, net.st.get(y.key).lat, net.st.get(y.key).lon) * 1.2), est: true });
  };
  for (let i = 0; i < hops.length; i++) {
    const y = hops[i];
    if (!ride || y.line !== ride.line) {
      if (ride) close(hops[i - 1], hops[i - 1].t);
      ride = { line: y.line, board: y.board, boardAt: y.boardAt, stops: 0 };
    } else ride.stops++;
  }
  close(hops.at(-1), hops.at(-1).t);
  const first = legs[0];
  if (w0.m > 20) legs.unshift({ ...walk({ name: o.name || '', lat: o.lat, lon: o.lon }, first.from, 0, w0.m), dep: first.dep - 60_000 - walkSec(w0.m) * 1000, arr: first.dep - 60_000 });
  const last = legs.at(-1);
  if (endM > 20) legs.push(walk(last.to, { name: d.name || '', lat: d.lat, lon: d.lon }, last.arr, endM));
  return finish({ src: 'metro', legs });
}

// The metro rides for a trip, when both ends are in one map's area.
export async function metroPlans(o, d, at) {
  const map = MAPS.find(m => [o, d].every(p => p.lat >= m.box[0] && p.lat <= m.box[2] && p.lon >= m.box[1] && p.lon <= m.box[3]));
  if (!map) return [];
  return metroRoutes(await metroNet(map), o, d, at);
}

