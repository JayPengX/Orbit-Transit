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
import { withBikes, bikePoints, railPlans, finish, allowed } from './plan.mjs';
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
export async function planTrip(data, from, to, { at = null, by = 'depart' } = {}) {
  const prefs = data.prefs;
  const modes = prefs.modes;
  const now = Date.now();
  const t0 = at || now;
  const useRail = modes.tra || modes.hsr;
  const findCity = await cityFinder();
  // Each point's city as it was looked up, for the 除錯紀錄 (a replay needs no township list).
  const cities = {};
  const cityOf = pt => (pt?.lat != null ? (cities[`${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`] = findCity(pt)) : findCity(pt));
  const pass = tpassOf(prefs.tpass);
  const passTrip = inPass(from, to, pass, cityOf);
  // Inside your TPASS's area, our router looks only at the trains the pass takes.
  const useTrain = x => modes[x.sys] !== false && (!passTrip || (x.sys === 'tra' && !PREMIUM.has(String(x.code))));
  const [res, trains] = await Promise.all([
    routePlans(from, to, { at, by, modes: modeList(prefs) }).catch(err => ({ plans: [], sources: {}, err })),
    by === 'arrive' || !useRail
      ? []
      : railNetwork(tw(t0).date, { next: tw(t0).min >= 21 * 60 })
          .then(net => railPlans(net, from, to, t0, { bike: modes.bike, use: useTrain }))
          .catch(() => [])
  ]);
  if (res.err && !trains.length) return { plans: [], sources: res.sources || {}, error: res.err };
  let plans = [...res.plans, ...trains];
  if (modes.bus && by !== 'arrive') plans.push(...(await trainThenBus(trains, to, now)));
  plans = plans.filter(p => allowed(p, { ...modes, bike: true }));
  // What the buses are doing now (only for trips leaving now or soon).
  if (by !== 'arrive' && t0 - now < 60 * 60_000) {
    const soon = plans.filter(p => p.legs.some(l => l.mode === 'bus' && !l.live)).slice(0, 10);
    const done = await Promise.all(soon.map(p => adjustPlan(p, now).catch(() => p)));
    plans = plans.map(p => done[soon.indexOf(p)] || p);
  }
  // YouBike near both ends and the stations the plans use.
  let bikes = [];
  if (modes.bike) {
    const pts = bikePoints(plans, from, to);
    // 每 30 分鐘換車: every station of the cities at both ends (the map's
    // list, kept), so a long ride can be cut wherever it passes one.
    const cities = prefs.bike30 ? [...new Set([cityOf(from), cityOf(to)].filter(Boolean))] : [];
    const near = (await Promise.all([...pts.map(p => bikesNear(p.lat, p.lon).catch(() => [])), ...cities.map(c => cityBikes(c).catch(() => []))])).flat();
    bikes = [...new Map(near.map(s => [s.uid, s])).values()];
  }
  const cost = p => fareOf(p, coverage(p, pass, cityOf)).cost;
  // Both ends inside your TPASS's area: only what the pass takes (no 高鐵, no 普悠瑪), unless there's nothing else.
  const keep = passTrip ? p => passOk(p, pass, cityOf) : null;
  const ranked = withBikes(plans, from, to, bikes, t0, { modes, swap: prefs.bike30, cost, by, deadline: by === 'arrive' ? at : null, keep, clock: now });
  // Each plan's fare line (TPASS counted).
  for (const p of ranked) p.fareText = fareOf(p, coverage(p, pass, cityOf)).text;
  // 除錯紀錄: everything the ranking was worked out from (scripts/replay.mjs runs it again), and what it said.
  rec('trip', {
    now, t0, at, by, from, to,
    prefs: { modes, bike30: prefs.bike30, tpass: prefs.tpass },
    sources: res.sources || {},
    plans, bikes, cities,
    shown: ranked.filter(p => p.lead && !p.weak).map(p => `${p.score} ${hm(p.dep)}→${hm(p.arr)} ${p.legs.map(l => (l.mode === 'walk' ? 'walk' : `${l.mode}${l.ebike ? '⚡' : ''}:${l.short || l.name || ''}`)).join(' ')}`)
  });
  return { plans: ranked, sources: res.sources || {}, error: ranked.length ? null : res.err || null };
}
