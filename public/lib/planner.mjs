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
import { withBikes, bikePoints, railPlans, finish, allowed, moreTrains, moreBuses } from './plan.mjs';
import { adjustPlan, busLink } from './live.mjs';
import { coverage, fareOf, tpassOf, inPass, passOk, PREMIUM } from './tpass.mjs';
import { cityAt } from './city.mjs';
import { modeList } from './store.mjs';
import { meters, tw, hm } from './util.mjs';
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
    if (!off.to?.lat || meters(off.to.lat, off.to.lon, to.lat, to.lon) < 1200) continue;
    const key = `${off.to.name}|${Math.round(off.arr / 600_000)}`;
    if (tried.has(key) || tried.size >= 3) continue;
    tried.add(key);
    const links = await busLink(off.to, to, off.arr + 2 * 60_000, { now }).catch(() => []);
    for (const b of links) out.push(finish({ ...p, src: 'rail+bus', legs: [...p.legs.slice(0, k + 1), ...b.legs], live: b.live }));
  }
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
  const [res, trains] = await Promise.all([
    routePlans(from, to, { at, by, modes: modeList(prefs) }).catch(err => ({ plans: [], sources: {}, err })).finally(() => lap('planners', t)),
    by === 'arrive' || !useRail
      ? []
      : railNetwork(tw(t0).date, { next: tw(t0).min >= 21 * 60 })
          .then(n => railPlans((net = n), from, to, t0, { bike: modes.bike, use: useTrain }))
          .catch(() => [])
          .finally(() => lap('trains', t))
  ]);
  if (res.err && !trains.length) return { plans: [], sources: res.sources || {}, error: res.err };
  let plans = [...res.plans, ...trains].filter(p => allowed(p, { ...modes, bike: true }));
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
  const soon = by !== 'arrive' && t0 - now < 60 * 60_000 ? plans.filter(p => p.legs.some(l => l.mode === 'bus' && !l.live)).slice(0, 10) : [];
  // And every direct bus from around here to around there, by our own look
  // at the stops (the planners leave some out: 5615, 5614, 快捷9號 from
  // 竹北's 縣體育場 to 新竹車站); a stop a little farther is ridden to.
  const [linked, direct, done] = await Promise.all([
    modes.bus && by !== 'arrive' ? trainThenBus(trains, to, now) : [],
    modes.bus && by !== 'arrive' && t0 - now < 60 * 60_000 ? busLink(from, to, t0, { fromM: 700, toM: 700, n: 6, routes: 10, now }).catch(() => []) : [],
    Promise.all(soon.map(p => adjustPlan(p, now).catch(() => p)))
  ]);
  plans = plans.map(p => done[soon.indexOf(p)] || p);
  plans.push(...[...linked, ...direct].filter(p => allowed(p, { ...modes, bike: true })));
  // The buses after each first bus (TDX's times, else the timetable).
  await Promise.all(plans.flatMap(p => p.legs.filter(l => l.nextP).map(async l => {
    l.next = await l.nextP.catch(() => []);
    delete l.nextP;
  })));
  lap('buses', t1);
  // Each route's next departures (the times its card offers): the trains
  // after it from our timetable, the buses after it.
  if (by !== 'arrive') {
    const more = [];
    for (const p of plans) more.push(...moreTrains(p, net, t0, { use: useTrain }), ...moreBuses(p, t0));
    plans.push(...more);
  }
  let bikes = [];
  if (modes.bike) {
    const near = [...(await bikesFirst), ...(await bikesAt(bikePoints([...linked, ...direct], from, to))).flat()];
    bikes = [...new Map(near.map(s => [s.uid, s])).values()];
  }
  t = performance.now();
  const cost = p => fareOf(p, coverage(p, pass, cityOf)).cost;
  // Both ends inside your TPASS's area: only what the pass takes (no 高鐵, no 普悠瑪), unless there's nothing else.
  const keep = passTrip ? p => passOk(p, pass, cityOf) : null;
  const ranked = withBikes(plans, from, to, bikes, t0, { modes, swap: prefs.bike30, cost, by, deadline: by === 'arrive' ? at : null, keep, clock: now });
  // Each plan's fare line (TPASS counted).
  for (const p of ranked) p.fareText = fareOf(p, coverage(p, pass, cityOf)).text;
  lap('rank', t);
  lap('all', T0);
  // 除錯紀錄: everything the ranking was worked out from (scripts/replay.mjs runs it again), and what it said.
  rec('trip', {
    now, t0, at, by, from, to, ms,
    prefs: { modes, bike30: prefs.bike30, tpass: prefs.tpass },
    sources: res.sources || {},
    plans, bikes, cities,
    shown: ranked.filter(p => p.lead && !p.weak).map(p => `${p.score} ${hm(p.dep)}→${hm(p.arr)} ${p.legs.map(l => (l.mode === 'walk' ? 'walk' : `${l.mode}${l.ebike ? '⚡' : ''}:${l.short || l.name || ''}`)).join(' ')}`)
  });
  return { plans: ranked, sources: res.sources || {}, error: ranked.length ? null : res.err || null };
}
