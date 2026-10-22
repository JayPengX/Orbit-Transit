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

import { routePlans, townships, walksTo, walkKnown } from './api.mjs';
import { cityBikes } from './bike.mjs';
import { bikesAround, stopsAround, etaStops } from './near.mjs';
import { railNetwork, railSpan, stationPoint } from './raildata.mjs';
import { metroPlans } from './metroroute.mjs';
import { withBikes, bikePoints, railPlans, railStarts, finish, allowed, moreTrains, moreBuses, dayTimes, nameTrains, tidy, RAIL_BIKE_M, useStreetWalks, ARRIVE_WINDOW } from './plan.mjs';
import { adjustPlan, busLink, busTimes, officialPlan } from './live.mjs';
import { coverage, fareOf, tpassOf, inPass, passOk, passTrainTrip, bikeSwap } from './tpass.mjs';
import { cityAt } from './city.mjs';
import { modeList } from './store.mjs';
import { meters, hm, isRide } from './util.mjs';
import { crossings } from './rivers.mjs';
import { rec } from '#kit/orbit.mjs';

// 台鐵 and 高鐵 (our own router's trains; not the metro).
const TRAINS = new Set(['tra', 'hsr']);

// The planner's YouBike stations by the streets: the walks it knows (either way round).
useStreetWalks((a, b) => (walkKnown(a, b) || walkKnown(b, a))?.dist ?? null);
// The walks from each end of the trip to its five nearest stations (within
// 700 m), Google's (one ask an end), before the stations are chosen; 1.5 s
// at most (the straight line for any not in).
async function streetWalks(bikes, from, to) {
  const near = p => bikes.map(s => ({ s, d: meters(p.lat, p.lon, s.lat, s.lon) })).filter(x => x.d <= 700 && x.s.ok !== false).sort((a, b) => a.d - b.d).slice(0, 5).map(x => x.s);
  const asks = [from, to].map(p => (p?.lat != null && near(p).length ? walksTo(p, near(p)).catch(() => null) : null));
  await Promise.race([Promise.all(asks), new Promise(r => setTimeout(r, 1500))]);
}

// A point's TDX city, from the townships list (loaded once, kept a month).
let towns = null;
async function cityFinder() {
  towns ||= await townships().catch(() => null);
  const memo = new Map();
  return pt => {
    if (!towns || pt?.lat == null) return null;
    const k = `${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`;
    if (!memo.has(k)) memo.set(k, cityAt(towns, pt.lat, pt.lon)?.city || null);
    return memo.get(k);
  };
}

// Our train plans that end far from the place, finished by a direct bus
// (each train's looked for side by side).
async function trainThenBus(plans, to, now) {
  const jobs = [];
  const tried = new Set();
  for (const p of plans) {
    const k = p.legs.findLastIndex(l => TRAINS.has(l.mode));
    if (k < 0) continue;
    const off = p.legs[k];
    if (!off.to?.lat || (meters(off.to.lat, off.to.lon, to.lat, to.lon) < 1200 && !p.legs[k + 1]?.bus)) continue;
    const key = `${off.to.name}|${Math.round(off.arr / 600_000)}`;
    if (tried.has(key) || tried.size >= 3) continue;
    tried.add(key);
    jobs.push(busLink(off.to, to, off.arr + 2 * 60_000, { now }).then(links => links.map(b => finish({ ...p, src: 'rail+bus', legs: [...p.legs.slice(0, k + 1), ...b.legs], live: b.live })), () => []));
  }
  return (await Promise.all(jobs)).flat();
}

// A bus to the station where a bike won't do: without YouBike, to each
// station near you too far to walk to (or over the river); with it, to one
// too far to ride to (北埔 → 竹東's station, 7 km). On the way there, the direct
// buses (busLink), then our trains from it when that bus gets in. Several
// stations side by side; `trace` says what was found, for the 除錯紀錄.
async function busToRail(net, from, to, at, { use, now, trace, bike = false }) {
  const whole = meters(from.lat, from.lon, to.lat, to.lon);
  const far = x => (bike ? x.m > RAIL_BIKE_M : x.m > 1000 || crossings(from, x.s));
  const stations = [...net.st.values()]
    .map(s => ({ s, m: meters(from.lat, from.lon, s.lat, s.lon) }))
    .filter(x => far(x) && x.m <= 12_000 && x.m + meters(x.s.lat, x.s.lon, to.lat, to.lon) <= whole * 1.6)
    .sort((a, b) => a.m - b.m)
    .slice(0, 4);
  const out = [];
  // (Never for a train you could have boarded nearer: see railPlans' `chase`.)
  const chase = railStarts(net, from, at, { bike });
  await Promise.all(stations.map(async ({ s }) => {
    const st = stationPoint(s);
    const buses = await busLink(from, st, at, { fromM: 900, toM: 800, n: 2, routes: 8, now }).catch(() => []);
    if (!buses.length) return void trace.push(`${st.name}: no bus`);
    // Each bus there (the soonest two), with the trains after it gets in.
    for (const b of buses) {
      const trains = railPlans(net, st, to, b.arr + 60_000, { n: 2, bus: true, use, chase });
      trace.push(`${st.name}: ${b.legs.find(l => l.mode === 'bus').short} ${hm(b.arr)}${trains.length ? '' : ' (no train)'}`);
      for (const r of trains) out.push(finish({ src: 'bus+rail', legs: [...b.legs, ...r.legs.filter((l, i) => !(i === 0 && l.mode === 'walk' && l.dist < 150))], live: b.live }));
    }
  }));
  return out;
}

// → { plans (ranked), sources, error }.
// `modes`: this search's own ways of moving (the chips on the plans card),
// else the person's 交通偏好.
// A ride by its rides (not its walks): the same ride from two planners is one plan.
const planSig = p =>
  p.legs
    .filter(l => l.mode !== 'walk')
    .map(l => `${l.mode}:${l.short || l.name}:${l.from?.name}>${l.to?.name}`)
    .join('|');
// Google's and TDX's answers as one (the earliest of a ride kept, as the proxy did).
function joinPlanners(a, b) {
  const seen = new Set();
  const plans = [...(a.plans || []), ...(b.plans || [])]
    .filter(p => p.legs?.length && p.arr != null)
    .sort((x, y) => x.arr - y.arr)
    .filter(p => !seen.has(planSig(p)) && seen.add(planSig(p)));
  return { plans, sources: { ...(a.sources || {}), ...(b.sources || {}), ms: { ...(a.sources?.ms || {}), ...(b.sources?.ms || {}) } }, err: a.err && b.err ? a.err : (!plans.length && (a.err || b.err)) || null };
}
const ARRIVE_EARLY = 2 * 3_600_000;
// A deadline further off than this (08:00 tomorrow, asked at 22:00): when
// nothing in the usual window gets there, the search goes back further from
// the deadline, not "leave now" (tonight's trains).
const FAR_AHEAD = 6 * 3_600_000;
// Where our own search starts: a departure's time, or for an arrive-by two
// hours before it (four for a long trip, six searched again wide), not
// before now.
export function searchFrom(t0, now, { by = 'depart', far = false, wide = false } = {}) {
  if (by !== 'arrive') return t0;
  return Math.max(now, t0 - (wide ? 3 : far ? 2 : 1) * ARRIVE_EARLY);
}
// Nothing arrives in time: search again 'wide' for a deadline far ahead,
// else the ways leaving 'now' (the deadline is too close); a wide search
// already done stands (null).
export const missedRetry = (at, now, wide = false) => (wide ? null : at - now > FAR_AHEAD ? 'wide' : 'now');
export async function planTrip(data, from, to, { at = null, by = 'depart', modes: only = null, wide = false } = {}) {
  const prefs = only ? { ...data.prefs, modes: { ...data.prefs.modes, ...only } } : data.prefs;
  const modes = prefs.modes;
  const now = Date.now();
  const t0 = at || now;
  // How long each step took, for the 除錯紀錄 (a slow search, explained).
  const ms = {};
  const lap = (k, since) => (ms[k] = Math.round(performance.now() - since));
  const T0 = performance.now();
  const useRail = modes.tra || modes.hsr;
  // To be there by a time: our own trains and buses looked for from two
  // hours before it (four for a long trip); the ranking keeps what gets in.
  const tS = searchFrom(t0, now, { by, far: by === 'arrive' && meters(from.lat, from.lon, to.lat, to.lon) > 60_000, wide });
  // The planners (Google's in a tenth of a second, TDX's in seconds for a
  // long trip, by YouBike most) and the day's trains asked first: nothing
  // they need waits on the township list (a first trip's fifth of a second).
  let t = performance.now();
  const ask = src =>
    routePlans(from, to, { at, by, modes: modeList(prefs), src })
      .catch(err => ({ plans: [], sources: {}, err }))
      .finally(() => lap(`planners:${src}`, t));
  let tdxIn = null;
  const tdxAsk = ask('tdx').then(r => (tdxIn = r));
  const googleAsk = ask('google');
  const span = railSpan(tS, by === 'arrive' ? t0 : null);
  const netAsk = useRail ? railNetwork(span.date, span) : null;
  netAsk?.catch(() => {});
  const findCity = await cityFinder();
  // Each point's city as it was looked up, for the 除錯紀錄 (a replay needs no township list).
  const cities = {};
  const cityOf = pt => (pt?.lat != null ? (cities[`${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`] = findCity(pt)) : findCity(pt));
  const pass = tpassOf(prefs.tpass);
  const passTrip = inPass(from, to, pass, cityOf);
  // Inside your TPASS's area, our router looks only at the trains the pass takes.
  const useTrain = x => modes[x.sys] !== false && (!passTrip || passTrainTrip(x));
  // While the planners think (a second or two): the packs and bikes near
  // both ends, and the buses due at the stops near you, so what comes after
  // finds them here; and the walks to the YouBike stations near each end
  // (the ranking waits for those, 1.5 s at most: asked now, they're in).
  const soonish = by !== 'arrive' && t0 - now < 90 * 60_000;
  if (modes.bike) Promise.all([from, to].map(p => bikesAround(p.lat, p.lon).catch(() => []))).then(x => streetWalks(x.flat(), from, to)).catch(() => {});
  if (modes.bus) {
    stopsAround(to.lat, to.lon, 1100).catch(() => {});
    if (soonish) stopsAround(from.lat, from.lon, 900).then(list => list?.length && etaStops(list.map(s => ({ uid: s.uid, scope: s.scope })))).catch(() => {});
  }
  let net = null;
  // Google's plans with our trains for the first plans; TDX's with them when
  // they're in by then, else with the second round's.
  const [gRes, trains, metros] = await Promise.all([
    googleAsk,
    // (To be there by a time: the trains from the window's start; the
    // ranking takes the latest that gets in. The planners leave out the
    // 六家線 then 內灣線 to 竹東, 2026-10-12.)
    !useRail
      ? []
      : netAsk
          .then(n => railPlans((net = n), from, to, tS, { n: by === 'arrive' ? 8 : 4, bike: modes.bike, bus: modes.bus, use: useTrain }))
          .catch(() => [])
          .finally(() => lap('trains', t)),
    // Our metro rides (板南線 then 文湖線, which the planners may leave out).
    by === 'arrive' || modes.metro === false ? [] : metroPlans(from, to, t0).catch(() => []).finally(() => lap('metro', t))
  ]);
  // TDX's waited for where there's no second round, or nothing else came.
  const noLater = by === 'arrive' || !modes.bus;
  if (!tdxIn && (noLater || (!gRes.plans.length && !trains.length && !metros.length))) await tdxAsk;
  const res = tdxIn ? joinPlanners(gRes, tdxIn) : gRes;
  const tdxLate = tdxIn ? null : tdxAsk;
  if (res.err && !trains.length && !metros.length) return { plans: [], sources: res.sources || {}, error: res.err };
  let plans = [...res.plans.map(tidy), ...trains, ...metros].filter(p => allowed(p, { ...modes, bike: true }));
  // YouBike near both ends and the stations, asked now, while the buses are
  // looked at (it doesn't wait for them; a train-then-bus's stop is asked after).
  const bikeCities = modes.bike && bikeSwap(prefs) ? [...new Set([cityOf(from), cityOf(to)].filter(Boolean))] : [];
  const asked = [];
  const bikesAt = pts => {
    const fresh = pts.filter(p => !asked.some(q => meters(p.lat, p.lon, q.lat, q.lon) < 400));
    asked.push(...fresh);
    return Promise.all(fresh.map(p => bikesAround(p.lat, p.lon).catch(() => [])));
  };
  t = performance.now();
  const bikesFirst = modes.bike
    ? Promise.all([bikesAt(bikePoints(plans, from, to)), ...bikeCities.map(c => cityBikes(c).catch(() => []))]).then(x => x.flat(2)).finally(() => lap('bikes', t))
    : Promise.resolve([]);
  // A train whose last station is far, on by bus; what the buses are doing
  // now (trips leaving now or soon), side by side.
  const t1 = performance.now();
  let busTrace = null;
  // (Its buses looked for now, beside the official names below.)
  const linkedAsk = modes.bus ? trainThenBus(trains, to, now) : [];
  // The planners' buses as the official routes (their names, ids, timetables).
  plans = await Promise.all(plans.map(p => (/^(google|tdx)/.test(p.src || '') ? officialPlan(p, now).catch(() => p) : p)));
  lap('official', t1);
  // (By a time soon, as when late in navigation: the buses live too.)
  const soon = (by === 'arrive' ? t0 - now < 3 * 3_600_000 : t0 - now < 60 * 60_000) ? plans.filter(p => p.legs.some(l => l.mode === 'bus' && !l.live)).slice(0, 10) : [];
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
    linkedAsk,
    Promise.all(soon.map(p => adjustPlan(p, now, { start: by === 'arrive' ? null : t0 }).catch(() => p)))
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
    // (Every train by its number: a planner's named by its line only gets ours.)
    list = list.map(p => nameTrains(p, net));
    if (by !== 'arrive') {
      const more = [];
      for (const p of list) more.push(...moreTrains(p, net, t0, { use: useTrain }), ...moreBuses(p, t0));
      list = [...list, ...more];
    }
    const bikes = await bikesNow;
    await streetWalks(bikes, from, to);
    const t2 = performance.now();
    let ranked = withBikes(list, from, to, bikes, t0, { modes, swap: bikeSwap(prefs), cost, by, deadline: by === 'arrive' ? at : null, keep, clock: now });
    // Each route's card offers the rest of the day's departures (its bus's every later bus, its trains' every later train).
    if (by !== 'arrive') {
      const t4 = performance.now();
      ranked = dayTimes(ranked, net, t0, { use: useTrain });
      lap(`days${stage}`, t4);
    }
    // Each plan's fare line (TPASS counted); to be there by a time, the time
    // (navigation keeps to it: late, the way that still makes it).
    for (const p of ranked) {
      p.fareText = fareOf(p, coverage(p, pass, cityOf)).text;
      if (by === 'arrive') p.deadline = at;
    }
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
  // (To be there by a time too: without YouBike, a bus to the station is
  // the way to the train, not a 5 km walk to 千甲; the owner, 2026-10-12.)
  const later =
    !modes.bus
      ? null
      : (async () => {
          const t3 = performance.now();
          busTrace = {};
          // Side by side: TDX's plans come since the first round (as the
          // planners' were: their buses the official routes, the soon ones
          // live), the direct buses, and the buses to the stations too far to
          // walk (or, with YouBike, ride) to, and on from the last one.
          const [lateLive, direct, toTrains] = await Promise.all([
            tdxLate
              ? tdxLate.then(async late => {
                  const known = new Set(plans.map(planSig));
                  const extra = late.plans.map(tidy).filter(p => allowed(p, { ...modes, bike: true }) && !known.has(planSig(p)));
                  const official = await Promise.all(extra.map(p => officialPlan(p, now).catch(() => p)));
                  res.sources = joinPlanners(res, late).sources;
                  return Promise.all(official.map(p => (by !== 'arrive' && t0 - now < 60 * 60_000 && p.legs.some(l => l.mode === 'bus' && !l.live) ? adjustPlan(p, now, { start: t0 }).catch(() => p) : p)));
                })
              : [],
            busLink(from, to, tS, { fromM: 900, toM: 1100, n: 8, routes: 14, now, trace: busTrace }).catch(err => ((busTrace.error = String(err?.message || err)), [])),
            useRail && net
              ? (async () => {
                  // (By a time: the buses from the start of the window and from half way through it.)
                  const starts = by === 'arrive' ? [tS, (tS + t0) / 2] : [t0];
                  const toRail = (await Promise.all(starts.map(s => busToRail(net, from, to, s, { use: useTrain, now, bike: modes.bike, trace: (busTrace.rail ||= []) }).catch(() => [])))).flat();
                  const on = await trainThenBus(toRail, to, now).catch(() => []);
                  return [...toRail, ...on].filter(bused).filter(p => allowed(p, { ...modes, bike: true }));
                })()
              : []
          ]);
          plans.push(...lateLive.filter(bused));
          let list = [...plans, ...direct.filter(p => allowed(p, { ...modes, bike: true })), ...toTrains];
          // (Once a line and stop: many plans board the same bus at the same stop.)
          const once = new Map();
          const key = p => {
            const l = p.legs.find(isRide);
            return l?.mode === 'bus' && !l.next && !l.nextP && l.from?.lat ? `${l.short || l.name}|${l.from.lat.toFixed(3)},${l.from.lon.toFixed(3)}|${Math.round(l.dep / 600_000)}` : null;
          };
          list = list.map(p => {
            const k = key(p);
            if (!k) return p;
            if (!once.has(k)) once.set(k, busTimes(p, { now }).catch(() => []));
            const l0 = p.legs.find(isRide);
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
  // By a time nothing gets you there for any more (07:21 for 08:00, the
  // owner's 上學): the ways leaving now (the buses, the rides, each one's
  // next times), each saying how late, not the trains of the day after it.
  // The direct buses come in the second round: one of them in time, the
  // arrival-time plans after all (竹東站 → 縣體育場 by 09:00 at 07:40).
  const inTime = p => p.lead !== false && !p.weak && p.arr <= at + 2 * 60_000 && p.arr >= at - ARRIVE_WINDOW && p.dep >= now - 2 * 60_000;
  // A deadline hours off (08:00 tomorrow) is searched again from six hours
  // before it instead: leaving now would be tonight's trains.
  const retry = by === 'arrive' && at && !first.some(inTime) ? missedRetry(at, now, wide) : null;
  if (retry === 'wide') return planTrip(data, from, to, { at, by, modes: only, wide: true });
  if (retry === 'now') {
    const r = await planTrip(data, from, to, { modes: only });
    const mark = list => list.map(p => ({ ...p, deadline: at }));
    const nowLater = r.later?.then(o => (o ? { ...o, plans: mark(o.plans) } : o)) || Promise.resolve(null);
    const after = (later || Promise.resolve(null)).then(o => (o?.plans?.some(inTime) ? o : nowLater));
    return { ...r, plans: mark(r.plans), later: after };
  }
  return { plans: first, sources: res.sources || {}, error: first.length ? null : res.err || null, later, ms };
}
