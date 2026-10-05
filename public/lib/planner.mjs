// A trip planned the whole way, for the map's 路線 and the 交通 tab alike:
//
//   1. the planners (Google, TDX walking and TDX by YouBike) and our own
//      台鐵 / 高鐵 router (YouBike to a station 1.2–4.5 km away when bikes
//      are allowed: 竹北 → 六家, 千甲) side by side;
//   2. a train whose last station is far from the place goes on by a direct
//      bus (竹中 → 5608 → 竹東高中), when one comes soon;
//   3. the buses re-timed by what TDX says they're doing now;
//   4. YouBike near both ends and the stations, its ideas added;
//   5. ranked by what's practical, what TPASS covers counted free; a trip
//      inside your TPASS's area only by what the pass takes.
// Only the ways of moving the person allows (我的 → 交通偏好) are used.

import { routePlans, townships } from './api.mjs';
import { bikesNear, cityBikes } from './bike.mjs';
import { railNetwork } from './raildata.mjs';
import { metroPlans } from './metroroute.mjs';
import { withBikes, bikePoints, railPlans, finish, allowed, moreTrains, moreBuses, tidy } from './plan.mjs';
import { adjustPlan, busLink, busTimes } from './live.mjs';
import { coverage, fareOf, tpassOf, inPass, passOk, PREMIUM } from './tpass.mjs';
import { cityAt } from './city.mjs';
import { modeList } from './store.mjs';
import { meters, tw, hm } from './util.mjs';
import { crossings } from './rivers.mjs';
import { rec } from '#kit/quadra.mjs';

const RAIL = new Set(['tra', 'hsr']);

// A point's TDX city, from the townships list (loaded once, kept a month).
let towns = null;
export async function cityFinder() {
  towns ||= await townships().catch(() => null);
  const memo = new Map();
  return pt => {
    if (!towns || pt?.lat == null) return null;
    const k = `${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`;
    if (!memo.has(k)) memo.set(k, cityAt(towns, pt.lat, pt.lon)?.city || null);
    return memo.get(k);
  };
}

// Our train plans that end far from the place, finished by a direct bus.
async function trainThenBus(plans, to, now) {
  const out = [];
  const tried = new Set();
  for (const p of plans) {
    const k = p.legs.findLastIndex(l => RAIL.has(l.mode));
    if (k < 0) continue;
    const off = p.legs[k];
    if (!off.to?.lat || (meters(off.to.lat, off.to.lon, to.lat, to.lon) < 1200 && !p.legs[k + 1]?.bus)) continue;
    const key = `${off.to.name}|${Math.round(off.arr / 600_000)}`;
    if (tried.has(key) || tried.size >= 3) continue;
    tried.add(key);
    const links = await busLink(off.to, to, off.arr + 2 * 60_000, { now }).catch(() => []);
    for (const b of links) out.push(finish({ ...p, src: 'rail+bus', legs: [...p.legs.slice(0, k + 1), ...b.legs], live: b.live }));
  }
  return out;
}

// Without YouBike, a bus to the station instead: to each station near you
// too far to walk to (or over the river) and on the way there, the direct
// buses (busLink), then our trains from it when that bus gets in. Several
// stations side by side; `trace` says what was found, for the 除錯紀錄.
async function busToRail(net, from, to, at, { use, now, trace }) {
  const whole = meters(from.lat, from.lon, to.lat, to.lon);
  const pt = s => ({ name: s.sys === 'hsr' ? `高鐵${s.name.replace(/^高鐵/, '')}` : s.name, lat: s.lat, lon: s.lon });
  const stations = [...net.st.values()]
    .map(s => ({ s, m: meters(from.lat, from.lon, s.lat, s.lon) }))
    .filter(x => (x.m > 1000 || crossings(from, x.s)) && x.m <= 8000 && x.m + meters(x.s.lat, x.s.lon, to.lat, to.lon) <= whole * 1.6)
    .sort((a, b) => a.m - b.m)
    .slice(0, 4);
  const out = [];
  await Promise.all(stations.map(async ({ s }) => {
    const st = pt(s);
    const buses = await busLink(from, st, at, { fromM: 900, toM: 450, n: 1, routes: 8, now }).catch(() => []);
    if (!buses.length) return void trace.push(`${st.name}: no bus`);
    const b = buses[0];
    const trains = railPlans(net, st, to, b.arr + 60_000, { n: 2, bus: true, use });
    if (!trains.length) return void trace.push(`${st.name}: no train`);
    trace.push(`${st.name}: ${b.legs.find(l => l.mode === 'bus').short} ${hm(b.arr)}`);
    for (const r of trains) out.push(finish({ src: 'bus+rail', legs: [...b.legs, ...r.legs.filter((l, i) => !(i === 0 && l.mode === 'walk' && l.dist < 150))], live: b.live }));
  }));
  return out;
}

// → { plans (ranked), sources, error }.
// `modes`: this search's own ways of moving (the chips on the plans card),
// else the person's 交通偏好.
export async function planTrip(data, from, to, { at = null, by = 'depart', modes: only = null } = {}) {
  const prefs = only ? { ...data.prefs, modes: { ...data.prefs.modes, ...only } } : data.prefs;
  const modes = prefs.modes;
  const now = Date.now();
  const t0 = at || now;
  // How long each step took, for the 除錯紀錄 (a slow search, explained).
  const ms = {};
  const lap = (k, since) => (ms[k] = Math.round(performance.now() - since));
  const T0 = performance.now();
  const useRail = modes.tra || modes.hsr;
  const findCity = await cityFinder();
  // Each point's city as it was looked up, for the 除錯紀錄 (a replay needs no township list).
  const cities = {};
  const cityOf = pt => (pt?.lat != null ? (cities[`${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`] = findCity(pt)) : findCity(pt));
  const pass = tpassOf(prefs.tpass);
  const passTrip = inPass(from, to, pass, cityOf);
  // Inside your TPASS's area, our router looks only at the trains the pass takes.
  const useTrain = x => modes[x.sys] !== false && (!passTrip || (x.sys === 'tra' && !PREMIUM.has(String(x.code))));
  let net = null;
  let t = performance.now();
  const [res, trains, metros] = await Promise.all([
    routePlans(from, to, { at, by, modes: modeList(prefs) }).catch(err => ({ plans: [], sources: {}, err })).finally(() => lap('planners', t)),
    by === 'arrive' || !useRail
      ? []
      : railNetwork(tw(t0).date, { next: tw(t0).min >= 21 * 60 })
          .then(n => railPlans((net = n), from, to, t0, { bike: modes.bike, bus: modes.bus, use: useTrain }))
          .catch(() => [])
          .finally(() => lap('trains', t)),
    // Our metro rides (板南線 then 文湖線, which the planners may leave out).
    by === 'arrive' || modes.metro === false ? [] : metroPlans(from, to, t0).catch(() => []).finally(() => lap('metro', t))
  ]);
  if (res.err && !trains.length && !metros.length) return { plans: [], sources: res.sources || {}, error: res.err };
  let plans = [...res.plans.map(tidy), ...trains, ...metros].filter(p => allowed(p, { ...modes, bike: true }));
  // YouBike near both ends and the stations, asked now, while the buses are
  // looked at (it doesn't wait for them; a train-then-bus's stop is asked after).
  const bikeCities = modes.bike && prefs.bike30 ? [...new Set([cityOf(from), cityOf(to)].filter(Boolean))] : [];
  const asked = [];
  const bikesAt = pts => {
    const fresh = pts.filter(p => !asked.some(q => meters(p.lat, p.lon, q.lat, q.lon) < 400));
    asked.push(...fresh);
    return Promise.all(fresh.map(p => bikesNear(p.lat, p.lon).catch(() => [])));
  };
  t = performance.now();
  const bikesFirst = modes.bike
    ? Promise.all([bikesAt(bikePoints(plans, from, to)), ...bikeCities.map(c => cityBikes(c).catch(() => []))]).then(x => x.flat(2)).finally(() => lap('bikes', t))
    : Promise.resolve([]);
  // A train whose last station is far, on by bus; what the buses are doing
  // now (trips leaving now or soon), side by side.
  const t1 = performance.now();
  let busTrace = null;
  const soon = by !== 'arrive' && t0 - now < 60 * 60_000 ? plans.filter(p => p.legs.some(l => l.mode === 'bus' && !l.live)).slice(0, 10) : [];
  // Two goes, so the plans show at once and their bus times follow:
  //   1. the planners' and our trains' plans, the buses now (TDX's
  //      estimates), YouBike: ranked and shown;
  //   2. every direct bus from around here to around there by our own look
  //      at the stops (the planners leave some out: 5615, 5614, 快捷9號 from
  //      竹北's 縣體育場 to 新竹車站), and each bus's later times (the card's
  //      times) from the stops' timetables: ranked again, shown when ready
  //      (`later`). Asking TDX for every line's stops and timetable is the
  //      slow part (the proxy lets 4 asks a second through).
  const [linked, done] = await Promise.all([
    modes.bus && by !== 'arrive' ? trainThenBus(trains, to, now) : [],
    Promise.all(soon.map(p => adjustPlan(p, now).catch(() => p)))
  ]);
  plans = plans.map(p => done[soon.indexOf(p)] || p);
  plans.push(...linked.filter(p => allowed(p, { ...modes, bike: true })));
  // A train whose bus on from the station wasn't found: no plan.
  const bused = p => !p.legs.some(l => l.bus);
  plans = plans.filter(bused);
  lap('buses', t1);
  let bikesNow = modes.bike ? bikesFirst.then(async first => [...new Map([...first, ...(await bikesAt(bikePoints(linked, from, to))).flat()].map(s => [s.uid, s])).values()]) : Promise.resolve([]);
  const cost = p => fareOf(p, coverage(p, pass, cityOf)).cost;
  // Both ends inside your TPASS's area: only what the pass takes (no 高鐵, no 普悠瑪), unless there's nothing else.
  const keep = passTrip ? p => passOk(p, pass, cityOf) : null;
  const finishOff = async (list, stage) => {
    // Each route's next departures (the times its card offers): the trains
    // after it from our timetable, the buses after it.
    if (by !== 'arrive') {
      const more = [];
      for (const p of list) more.push(...moreTrains(p, net, t0, { use: useTrain }), ...moreBuses(p, t0));
      list = [...list, ...more];
    }
    const bikes = await bikesNow;
    const t2 = performance.now();
    const ranked = withBikes(list, from, to, bikes, t0, { modes, swap: prefs.bike30, cost, by, deadline: by === 'arrive' ? at : null, keep, clock: now });
    // Each plan's fare line (TPASS counted).
    for (const p of ranked) p.fareText = fareOf(p, coverage(p, pass, cityOf)).text;
    lap(`rank${stage}`, t2);
    lap(`all${stage}`, T0);
    // 除錯紀錄: everything the ranking was worked out from (scripts/replay.mjs runs it again), and what it said.
    rec('trip', {
      now, t0, at, by, from, to, ms: { ...ms }, stage, buses: busTrace,
      prefs: { modes, bike30: prefs.bike30, tpass: prefs.tpass },
      sources: res.sources || {},
      plans: list, bikes, cities,
      shown: ranked.filter(p => p.lead && !p.weak).map(p => `${p.score} ${hm(p.dep)}→${hm(p.arr)} ${p.legs.map(l => (l.mode === 'walk' ? 'walk' : `${l.mode}${l.ebike ? '⚡' : ''}:${l.short || l.name || ''}`)).join(' ')}`)
    });
    return ranked;
  };
  // 1. Now (the later buses TDX's estimates gave are waited for in 2).
  const strip = list => list.map(p => (p.legs.some(l => l.nextP) ? { ...p, legs: p.legs.map(({ nextP, ...l }) => l) } : p));
  const first = await finishOff(strip(plans), 1);
  // 2. The direct buses and every bus's later times.
  const later =
    by === 'arrive' || !modes.bus
      ? null
      : (async () => {
          const t3 = performance.now();
          const direct = await busLink(from, to, t0, { fromM: 900, toM: 1100, n: 8, routes: 14, now, trace: (busTrace = {}) }).catch(err => ((busTrace.error = String(err?.message || err)), []));
          let list = [...plans, ...direct.filter(p => allowed(p, { ...modes, bike: true }))];
          // No YouBike: buses to the stations too far to walk to, and on from the last one.
          if (!modes.bike && useRail && net) {
            const toRail = await busToRail(net, from, to, t0, { use: useTrain, now, trace: (busTrace.rail = []) }).catch(() => []);
            const on = await trainThenBus(toRail, to, now).catch(() => []);
            list.push(...[...toRail, ...on].filter(bused).filter(p => allowed(p, { ...modes, bike: true })));
          }
          // (Once a line and stop: many plans board the same bus at the same stop.)
          const once = new Map();
          const key = p => {
            const l = p.legs.find(x => x.mode !== 'walk' && x.mode !== 'bike');
            return l?.mode === 'bus' && !l.next && !l.nextP && l.from?.lat ? `${l.short || l.name}|${l.from.lat.toFixed(3)},${l.from.lon.toFixed(3)}|${Math.round(l.dep / 600_000)}` : null;
          };
          list = list.map(p => {
            const k = key(p);
            if (!k) return p;
            if (!once.has(k)) once.set(k, busTimes(p, { now }).catch(() => []));
            const l0 = p.legs.find(x => x.mode !== 'walk' && x.mode !== 'bike');
            return { ...p, legs: p.legs.map(l => (l === l0 ? { ...l, nextP: once.get(k) } : l)) };
          });
          list = await Promise.all(list.map(async p => (p.legs.some(l => l.nextP) ? { ...p, legs: await Promise.all(p.legs.map(async ({ nextP, ...l }) => (nextP ? { ...l, next: await nextP.catch(() => []) } : l))) } : p)));
          if (direct.length) {
            const more = (await bikesAt(bikePoints(direct, from, to))).flat();
            const all = await bikesNow;
            bikesNow = Promise.resolve([...new Map([...all, ...more].map(s => [s.uid, s])).values()]);
          }
          lap('later', t3);
          return { plans: await finishOff(list, 2), sources: res.sources || {}, error: null };
        })().catch(() => null);
  return { plans: first, sources: res.sources || {}, error: first.length ? null : res.err || null, later };
}
