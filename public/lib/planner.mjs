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

import { routePlans, townships, walksTo, walkTo, walkKnown, bikeRides, rideKnown } from './api.mjs';
import { cityBikes } from './bike.mjs';
import { bikesAround, stopsAround, etaStops } from './near.mjs';
import { railNetwork, railSpan, stationPoint } from './raildata.mjs';
import { metroPlans, metroMapAt, metroWarm } from './metroroute.mjs';
import { markWet } from './rain.mjs';
import { rank, withBikes, dropOvershoots, bikePoints, railPlans, railStarts, finish, allowed, moreTrains, moreBuses, dayTimes, nameTrains, tidy, boardEarly, trainLeg, walkLeg, RAIL_BIKE_M, RAIL_FAR_WALK_M, useStreetWalks, useStreetRides, ARRIVE_WINDOW } from './plan.mjs';
import { adjustPlan, busLink, busTimes, officialPlan, stoppedOn, liveRide, rideTime } from './live.mjs';
import { motion, trainPace, trainAboard, trainsNear, busesAboard, trainLegTo, busLegTo, getOffAt, joinRide, rideThenWalk, aboardTrace } from './aboard.mjs';
import { recentFixes, busEta } from './api.mjs';
import { dayTrips, railStations, traTrain, planFare, faresIn } from './raildata.mjs';
import { stationsAround } from './near.mjs';
import { routeStops, routeSchedule, routeCity, busEtaMended } from './bus.mjs';
import { chases } from './chase.mjs';
import { coverage, fareOf, tpassOf, inPass, passOk, passTrainTrip, bikeSwap } from './tpass.mjs';
import { cityAt } from './city.mjs';
import { traNotices, traLegOff } from './service.mjs';
import { modeList } from './store.mjs';
import { meters, hm, isRide, tw } from './util.mjs';
import { crossings } from './rivers.mjs';
import { rec } from '#kit/orbit.mjs';
import { W } from '#kit/lang.mjs';
import { ridesIn, onTicketTrain } from './ticket.mjs';

// 台鐵 and 高鐵 (our own router's trains; not the metro).
const TRAINS = new Set(['tra', 'hsr']);

// A trip's end's walks are from its spot on the map's ~40 m grid (tab-map
// fromHere): planning again from home or school, or after the map's YouBike
// strip asked from the same spot, they're the phone's (the newest 400 kept)
// or the proxy's (kept a month), not five more of Google's for a step aside
// (2026-11-06: a plan from where you stood asked again the five walks the map
// had asked from 25 m away; each fix is a new point). Within ~28 m of the
// end, as the strip's and a card's are.
const GRID = 0.0004;
export const spotOf = p => ({ lat: Number((Math.round(p.lat / GRID) * GRID).toFixed(5)), lon: Number((Math.round(p.lon / GRID) * GRID).toFixed(5)) });
// The planner's YouBike stations by the streets: the walks it knows (either way round), an end's from its spot.
useStreetWalks((a, b) => (walkKnown(spotOf(a), b) || walkKnown(spotOf(b), a) || walkKnown(a, b) || walkKnown(b, a))?.dist ?? null);
// The walks from each end of the trip to its five nearest stations (within
// 700 m), Google's (one ask an end), before the stations are chosen; 1.5 s
// at most (the straight line for any not in).
// And the rides by the roads from the stations near the start to those near
// the end and to the end itself (one ask of OpenStreetMap's bike router), so
// the station a bike is left at is the one that's really quicker.
async function streetWalks(bikes, from, to) {
  const near = p => bikes.map(s => ({ s, d: meters(p.lat, p.lon, s.lat, s.lon) })).filter(x => x.d <= 700 && x.s.ok !== false).sort((a, b) => a.d - b.d).slice(0, 5).map(x => x.s);
  const asks = [from, to].map(p => (p?.lat != null && near(p).length ? walksTo(spotOf(p), near(p)).catch(() => null) : null));
  const [a, b] = [from, to].map(p => (p?.lat != null ? near(p) : []));
  if (a.length && b.length && meters(from.lat, from.lon, to.lat, to.lon) > 700) asks.push(bikeRides(a, [...b, to]).catch(() => null));
  await Promise.race([Promise.all(asks), new Promise(r => setTimeout(r, 1500))]);
}
useStreetRides(rideKnown);

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

// A trip short enough to walk (2 km as the crow flies): the walk is a way
// of its own, whatever the planners say. Google's planner gave it; past
// Google's 100 trips a day (its limit, used up by mid-morning) it says
// nothing, TDX's gives no walk, and a 600 m trip found no way at all (Jay
// 2026-11-10). By the streets: Google's walk kept a month, else
// OpenStreetMap's walking router, its line too; neither in 2 s, the
// streets' guess (walkLeg). To be there by a time: in 5 minutes before it.
export const WALK_TRIP_M = 2000;
const WALK_WAIT = 2000;
export const allWalk = p => p.legs.length > 0 && p.legs.every(l => l.mode === 'walk');
export function walkPlan(from, to, w, { t0, by = 'depart' } = {}) {
  const leg = w ? { mode: 'walk', from: { name: from.name || '', lat: from.lat, lon: from.lon }, to: { name: to.name || '', lat: to.lat, lon: to.lon }, dist: w.dist, dur: w.sec, ...(w.poly ? { poly: w.poly, fmt: '', road: true } : { straight: true }) } : walkLeg(from, to, 0);
  const dep = by === 'arrive' ? t0 - 5 * 60_000 - leg.dur * 1000 : t0;
  return finish({ src: 'walk', legs: [{ ...leg, dep, arr: dep + leg.dur * 1000 }] });
}
const walkOf = (from, to) => Promise.race([walkTo(spotOf(from), to, { line: true }).catch(() => null), new Promise(r => setTimeout(r, WALK_WAIT, null))]);

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

// Our train plans into a metro's area that end far from the place (高鐵 to
// 板橋, 台鐵 on to 松山, then a 14-minute YouBike to 台北101; Jay 2026-11-06:
// "we can just go HSR to Taipei then Metro"): each train got off at any of
// its stops in the area instead, and on by our metro from there (its
// estimates; 3 minutes from the train to the metro's gates). The ranking
// weighs them against the train's own end.
const METRO_TRIPS = 4;
const METRO_WAIT = 1500;
export async function trainThenMetro(plans, net, to, { metro = metroPlans } = {}) {
  const map = metroMapAt(to);
  if (!net || !map) return [];
  const jobs = [];
  const tried = new Set();
  for (const p of plans) {
    const k = p.legs.findLastIndex(l => TRAINS.has(l.mode));
    if (k < 0) continue;
    const off = p.legs[k];
    if (off.to?.lat == null || meters(off.to.lat, off.to.lon, to.lat, to.lon) < 1200) continue;
    for (let i = 0; i <= k; i++) {
      const l = p.legs[i];
      if (!TRAINS.has(l.mode) || !l.train) continue;
      const trip = net.trips.find(t => t.sys === l.train.sys && t.no === l.train.no && t.stops.some(s => s.dep === l.dep));
      const a = trip?.stops.findIndex(s => s.dep === l.dep) ?? -1;
      if (a < 0) continue;
      const tk = `${trip.id}|${a}`;
      if (tried.has(tk)) continue;
      if (tried.size >= METRO_TRIPS) break;
      tried.add(tk);
      for (let b = a + 1; b < trip.stops.length; b++) {
        const s = trip.stops[b];
        const st = net.st.get(s.st);
        if (!st || metroMapAt(st) !== map || meters(st.lat, st.lon, to.lat, to.lon) < 1200) continue;
        const leg = trainLeg(net, { trip, from: trip.stops[a].st, to: s.st, dep: trip.stops[a].dep, arr: s.arr, stops: b - a, fromK: a });
        const head = p.legs.slice(0, i);
        jobs.push(
          metro(stationPoint(st), to, s.arr + 3 * 60_000).then(
            list => list.map(m => finish({ ...p, src: 'rail+metro', legs: [...head, leg, ...m.legs.map(x => (x.mode === 'walk' && x === m.legs[0] ? { ...x, from: leg.to } : x))], live: p.live })),
            () => []
          )
        );
      }
    }
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
// The longest the first plans wait on the buses' live times (ms).
const FIRST_WAIT = 1500;
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
// `ebike`: 偏好電輔車, this trip's own (withBikes); not said, the person's own in 我的.
// `chase: false`: no YouBike to a bus further on (a trip replanned under way).
// `wet`: the stretches it rains on the trip (rain.mjs rainFor): rides and long walks in them cost more, and are marked.
export async function planTrip(data, from, to, { at = null, by = 'depart', modes: only = null, wide = false, ebike = null, chase = true, wet = null, late = false } = {}) {
  ebike ??= data.prefs?.ebike === true;
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
  // (Walkable: the walk asked once Google's plans are in without one.)
  const walkAsk = meters(from.lat, from.lon, to.lat, to.lon) <= WALK_TRIP_M ? googleAsk.then(g => (g.plans?.some(allWalk) ? null : walkOf(from, to).then(w => walkPlan(from, to, w, { t0, by })))).catch(() => null) : null;
  const span = railSpan(tS, by === 'arrive' ? t0 : null);
  const netAsk = useRail ? railNetwork(span.date, span) : null;
  if (useRail && modes.metro !== false && !metroMapAt(from)) metroWarm(to);
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
          // (Their fares read now, while the buses are looked at: the plans' price line.)
          .then(list => (faresIn(list, net, 0), list))
          // (Into a metro's area: on by the metro from the trains' stops there too.)
          // (Its network asked at the start, kept a week: never waited on past METRO_WAIT.)
          .then(async list => [...list, ...((await Promise.race([trainThenMetro(list, net, to).catch(() => []), new Promise(r => setTimeout(r, METRO_WAIT, []))])) || [])])
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
  const walked = walkAsk && !res.plans.some(allWalk) ? await walkAsk : null;
  if (res.err && !trains.length && !metros.length && !walked) return { plans: [], sources: res.sources || {}, error: res.err };
  let plans = [...res.plans.map(tidy), ...trains, ...metros, ...(walked ? [walked] : [])].filter(p => allowed(p, { ...modes, bike: true }));
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
  const adjusting = Promise.all(soon.map(p => adjustPlan(p, now, { start: by === 'arrive' ? null : t0 }).catch(() => p)));
  const busesAsk = Promise.all([linkedAsk, adjusting]);
  // (Where a second round follows, the first shows after FIRST_WAIT at most:
  // a slow TDX answer for one stop held every plan 2–3 s. What isn't in by
  // then is put in at the second round's start.)
  const twoRounds = modes.bus && by !== 'arrive';
  const busesIn = await (twoRounds ? Promise.race([busesAsk, new Promise(r => setTimeout(r, FIRST_WAIT, null))]) : busesAsk);
  const linkedOk = p => allowed(p, { ...modes, bike: true });
  // A train whose bus on from the station wasn't found: no plan.
  const bused = p => !p.legs.some(l => l.bus);
  const putBuses = ([linked, done]) => {
    plans = plans.map(p => done[soon.indexOf(p)] || p);
    plans.push(...linked.filter(linkedOk));
    plans = plans.filter(bused);
  };
  if (busesIn) putBuses(busesIn);
  else plans = plans.filter(bused);
  lap('buses', t1);
  let bikesNow = modes.bike ? bikesFirst.then(async first => [...new Map([...first, ...(await bikesAt(bikePoints(busesIn?.[0] || [], from, to))).flat()].map(s => [s.uid, s])).values()]) : Promise.resolve([]);
  const cost = p => fareOf(p, coverage(p, pass, cityOf)).cost;
  // Both ends inside your TPASS's area: only what the pass takes (no 高鐵, no 普悠瑪), unless there's nothing else.
  const keep = passTrip ? p => passOk(p, pass, cityOf) : null;
  const stopped = new Set();
  const stopErr = () => (stopped.size ? Object.assign(new Error('stopped'), { code: 'STOPPED', said: [...stopped].slice(0, 4).join('、') }) : null);
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
    // A 高鐵 ridden past the place and back by another train: not when a way that doesn't gets in about as soon.
    list = dropOvershoots(list, net, to);
    // A bus its operator says isn't running today (or none on the road in a
    // city where they all are off): no plan, never its timetable instead.
    // (Nothing left: which buses, said, not 找不到.)
    // (A 台鐵 ride the alerts stop that only a planner still has: the same.)
    const tra = (await traNotices().catch(() => null))?.rules || [];
    const stationAt = pt => net && [...net.st.entries()].filter(([, s]) => s.sys === 'tra').map(([key, s]) => ({ key, m: meters(pt.lat, pt.lon, s.lat, s.lon) })).sort((a, b) => a.m - b.m).find(x => x.m < 400)?.key;
    const offs = await Promise.all(
      list.map(async p => {
        const t = p.legs.find(l => traLegOff(l, tra, stationAt));
        if (t) return t.short || t.name;
        // (Which bus: its name, before the label.)
        const off = p.stopped ? p.off : p.off ? '' : await stoppedOn(p.legs, now).catch(() => '');
        return off.replace(/ \S+$/, '');
      })
    );
    for (const o of offs) if (o) stopped.add(o);
    list = list.filter((p, i) => !offs[i]);
    const bikes = await bikesNow;
    await streetWalks(bikes, from, to);
    const t2 = performance.now();
    const bikeOpts = { modes, swap: bikeSwap(prefs), ebike, cost, by, deadline: by === 'arrive' ? at : null, keep, clock: now, wet, late };
    let ranked = withBikes(list, from, to, bikes, t0, bikeOpts);
    // Nothing gets there within three hours (a place in the country past its
    // station, no bus on from it now and no YouBike there): the trains with
    // the long walk at the end, beside tomorrow's ways, never nothing found.
    const soonRide = p => p.legs.some(isRide) && (by === 'arrive' || p.dep - t0 < 3 * 3_600_000);
    const farWalks = useRail && net && !ranked.some(soonRide) ? railPlans(net, from, to, tS, { n: 2, use: useTrain, walkM: RAIL_FAR_WALK_M }) : [];
    if (farWalks.length) ranked = withBikes([...list, ...farWalks], from, to, bikes, t0, bikeOpts);
    // Each route's card offers the rest of the day's departures (its bus's every later bus, its trains' every later train).
    if (by !== 'arrive') {
      const t4 = performance.now();
      ranked = dayTimes(ranked, net, t0, { use: useTrain });
      lap(`days${stage}`, t4);
    }
    // At a bus's stop a few minutes early (its timetable is a guess), set out for it so.
    ranked = ranked.map(p => boardEarly(p, by === 'arrive' ? now : Math.max(now, t0)));
    // (下雨改搭車: the legs it rains on, marked for the card.)
    markWet(ranked, wet);
    // Each plan's fare line (TPASS counted; our own trains at their real
    // fares, what's in by then: the first plans wait a moment, the second
    // round longer); to be there by a time, the time (navigation keeps to
    // it: late, the way that still makes it).
    if (net) await faresIn(ranked.filter(p => p.lead !== false), net, stage === 1 && twoRounds ? 300 : 1500);
    for (const p of ranked) {
      p.fareText = fareOf(p, coverage(p, pass, cityOf), planFare(p, net)).text;
      if (by === 'arrive') p.deadline = at;
    }
    lap(`rank${stage}`, t2);
    lap(`all${stage}`, T0);
    // 除錯紀錄: everything the ranking was worked out from (scripts/replay.mjs runs it again), and what it said.
    rec('trip', {
      now, t0, at, by, from, to, ms: { ...ms }, stage, buses: busTrace,
      prefs: { modes, bike30: prefs.bike30, swap30: prefs.swap30, tpass: prefs.tpass },
      sources: res.sources || {},
      plans: list, bikes, cities, wet,
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
          if (!busesIn) {
            const got = await busesAsk;
            putBuses(got);
            // (The YouBike at those trains' far stations too.)
            const more = (await bikesAt(bikePoints(got[0], from, to))).flat();
            const all = await bikesNow;
            bikesNow = Promise.resolve([...new Map([...all, ...more].map(s => [s.uid, s])).values()]);
          }
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
          // 追公車: a bus you'd miss walking to it, caught further along its way by YouBike.
          if (chase && modes.bike && by !== 'arrive' && t0 - now < 60 * 60_000) list.push(...(await chases(list, from, now, Math.max(now, t0), { prefer: ebike }).catch(() => [])).filter(p => allowed(p, modes)));
          lap('later', t3);
          const two = await finishOff(list, 2);
          return { plans: two, sources: res.sources || {}, error: two.length ? null : stopErr() };
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
  if (retry === 'wide') return planTrip(data, from, to, { at, by, modes: only, wide: true, ebike, chase, wet });
  if (retry === 'now') {
    const r = await planTrip(data, from, to, { modes: only, ebike, chase, wet, late: true });
    const mark = list => list.map(p => ({ ...p, deadline: at }));
    const nowLater = r.later?.then(o => (o ? { ...o, plans: mark(o.plans) } : o)) || Promise.resolve(null);
    const after = (later || Promise.resolve(null)).then(o => (o?.plans?.some(inTime) ? o : nowLater));
    return { ...r, plans: mark(r.plans), later: after };
  }
  return { plans: first, sources: res.sources || {}, error: first.length ? null : stopErr() || res.err || null, later, ms };
}

// ---- Already on board (aboard.mjs) ----
// The bus or train you're on, from the last few minutes of fixes: a train
// first (its pace and today's timetable say it), else the buses that fit.
// → { kind: 'train', ride } | { kind: 'bus', buses } | null; never throws.
export async function findAboard(now = Date.now()) {
  try {
    const m = motion(recentFixes(now), now);
    if (!m) return null;
    if (trainPace(m)) {
      const [trips, sts] = await Promise.all([dayTrips(tw(now).date), railStations()]);
      // (The delays of the trains that could be it, each its own read: those in by a second and a half.)
      const nos = trainsNear(trips, sts, m, now);
      const got = await Promise.race([Promise.all(nos.map(no => traTrain(no).then(x => [no, x], () => [no, null]))), new Promise(r => setTimeout(r, 1500, []))]);
      const lv = new Map(got.filter(([, x]) => x));
      const ride = trainAboard(trips, sts, m, lv, now);
      rec('aboard', aboardTrace(m, ride ? [ride] : []));
      if (ride) return { kind: 'train', ride, m };
    }
    const buses = await busesAboard(m, { stationsAround, routeStops, busEta: busEtaMended, routeCity });
    if (!trainPace(m) || buses.length) rec('aboard', aboardTrace(m, buses));
    return buses.length ? { kind: 'bus', buses, m } : null;
  } catch {
    return null;
  }
}
// The trip from the ride you're on (`a`: findAboard's, a bus picked when
// there were two): stay on to where it gets off nearest the place (or one
// more stop a kilometre away), then on from there as any trip from that stop
// is planned; ranked together. → planTrip's { plans, sources, later } or null.
export async function planAboard(data, a, to, { modes = null, ebike = null } = {}) {
  const now = Date.now();
  const here = a.m ? { lat: a.m.lat, lon: a.m.lon } : null;
  let legTo;
  let stops;
  let from;
  if (a.kind === 'train') {
    stops = a.ride.stops;
    from = a.ride.at + 1;
    legTo = k => trainLegTo(a.ride, k, now);
  } else {
    const bus = a.bus || a.buses[0];
    const [rows, sched] = await Promise.all([busEtaMended(bus.route.city, { route: bus.route.uid }).then(x => x.rows, () => []), routeSchedule(bus.route, here).catch(() => [])]);
    const sec = (j, k) => liveRide(rows, bus.w, j, k) ?? rideTime(bus.w, j, k, sched, now);
    stops = bus.w.stops;
    from = bus.j;
    legTo = k => busLegTo(bus, k, sec, now);
  }
  const offs = getOffAt(stops, from, to, here);
  if (!offs.length) return null;
  const parts = await Promise.all(offs.map(async k => {
    const ride = legTo(k);
    if (meters(ride.to.lat, ride.to.lon, to.lat, to.lon) <= 700) return { first: [rideThenWalk(ride, to, now)], later: null };
    const out = await planTrip(data, ride.to, to, { at: ride.arr + (a.kind === 'train' ? 60_000 : 30_000), by: 'depart', modes, ebike }).catch(() => null);
    const join = list => (list || []).filter(q => q.lead !== false && !q.weak).map(q => joinRide(ride, q, now));
    return { first: join(out?.plans), later: out?.later?.then(o => (o?.plans ? join(o.plans) : null)) || null, sources: out?.sources };
  }));
  const done = list => {
    const all = list.filter(p => p?.legs?.length);
    if (!all.length) return [];
    const ranked = rank(all, { now: all[0].legs[0].dep, o: here, d: to });
    // (One plan a row: there are no other departures of a ride you're on.)
    return ranked.map((p, i) => ({ ...p, dep: now, dur: Math.round((p.arr - now) / 1000), times: [i] }));
  };
  const first = done(parts.flatMap(x => x.first));
  if (!first.length) return null;
  const later = parts.some(x => x.later) ? Promise.all(parts.map(x => (x.later ? x.later.catch(() => null) : null))).then(ls => ({ plans: done(parts.flatMap((x, i) => ls[i] || x.first)), sources: {} })) : null;
  return { plans: first, sources: Object.assign({}, ...parts.map(x => x.sources || {})), error: null, later };
}

// ---- 指定車次 (ticket.mjs) ----
// A trip around the train you hold a ticket for: to its station in time
// (3 minutes before a 台鐵 train, 5 before 高鐵's gates; a walk when it's
// near, else the planners' ways there by then), the train or trains, then on
// from where it gets in as any trip from that station is planned. Ways there
// and ways on ranked together; the train is never swapped for another.
// → planTrip's { plans, sources, error, later } (error: the train gone, or no way there in time).
export async function planTicket(data, from, to, ticket, { modes = null, ebike = null } = {}) {
  const now = Date.now();
  const r0 = ticket?.rides?.[0];
  if (!r0) return { plans: [], sources: {}, error: new Error('no ticket') };
  // (The days its rides are filed under: a late train's change after midnight is the next day's.)
  const net = await railNetwork(tw(r0.dep).date, railSpan(r0.dep, ticket.rides.at(-1).arr));
  const rides = ridesIn(net, ticket, { from, to });
  if (!rides) return { plans: [], sources: {}, error: Object.assign(new Error('no train'), { text: W('這天的時刻表裡找不到這班車', 'This train isn’t in that day’s timetable') }) };
  // (The train you hold a ticket for: picked, never switched off by navigation.)
  const trainLegs = rides.map(r => ({ ...trainLeg(net, r), picked: true }));
  const first = trainLegs[0];
  const last = trainLegs.at(-1);
  const ready = first.dep - (first.mode === 'hsr' ? 5 : 3) * 60_000;
  if (first.dep < now - 60_000) return { plans: [], sources: {}, error: Object.assign(new Error('gone'), { text: W(`${first.short} 已經開走了（${hm(first.dep)}）`, `${first.short} has left (${hm(first.dep)})`) }) };
  const pass = tpassOf(data.prefs?.tpass);
  const findCity = await cityFinder();
  const ask = (a, b, opts) => planTrip(data, a, b, { ...opts, modes, ebike }).catch(() => null);
  // There: a walk within 800 m, else the planners' ways in by `ready`.
  const near = (a, b, m) => from.lat != null && meters(a.lat, a.lon, b.lat, b.lon) <= m;
  const [walkTo, walkFrom] = [near(from, first.from, 800), near(to, last.to, 700)];
  const thereAsk = walkTo ? Promise.resolve(null) : ask(from, first.from, { at: ready, by: 'arrive' });
  const onAsk = walkFrom ? Promise.resolve(null) : ask(last.to, to, { at: last.arr + (last.mode === 'hsr' ? 3 : 1) * 60_000, by: 'depart' });
  const [there, on] = await Promise.all([thereAsk, onAsk]);
  const walkThere = () => {
    const w = walkLeg(from, first.from, 0);
    return w.dist > 20 ? [{ ...w, dep: ready - w.dur * 1000, arr: ready }] : [];
  };
  const walkOn = () => {
    const w = walkLeg(last.to, to, last.arr);
    return w.dist > 20 ? [w] : [];
  };
  // (The ticket's trains priced, as any plan's: its fare line.)
  await faresIn([{ legs: trainLegs }], net, 1200);
  const fine = q => q.lead !== false && !q.weak && !onTicketTrain(q, ticket);
  const ways = !walkTo
    ? (there?.plans || []).filter(q => fine(q) && q.arr <= ready + 60_000 && q.dep >= now - 60_000).slice(0, 3).map(q => q.legs)
    : [walkThere()];
  if (!ways.length) return { plans: [], sources: there?.sources || {}, error: Object.assign(new Error('late'), { text: W(`來不及趕上 ${first.short}（${hm(first.dep)} 開）`, `No way to make ${first.short} (${hm(first.dep)})`) }) };
  // (Nothing found on from the station: the walk, as the card says how far.)
  const onWays = list => {
    const l = walkFrom ? [] : (list || []).filter(fine).slice(0, 3).map(q => q.legs);
    return l.length ? l : [walkOn()];
  };
  const join = (a, b) => {
    // (The few steps from the station to itself: none.)
    let rest = [...b];
    while (rest[0]?.mode === 'walk' && (rest[0].dist || 0) < 60 && isRide(rest[1])) rest = rest.slice(1);
    rest = rest.map(l => (l.dep != null && l.dep < last.arr && !isRide(l) ? { ...l, dep: last.arr, arr: last.arr + (l.dur || 0) * 1000 } : l));
    const p = finish({ src: 'ticket', legs: [...a, ...trainLegs, ...rest], ticket: true });
    p.fareText = fareOf(p, coverage(p, pass, findCity), planFare(p, net)).text;
    return p;
  };
  const done = list => {
    const after = onWays(list);
    if (!after.length) return [];
    // Each way there with the best way on, and the best way there with each way on.
    const all = [...ways.map(a => join(a, after[0])), ...after.slice(1).map(b => join(ways[0], b))];
    const ranked = rank(all, { now, o: from, d: to });
    return ranked.map((p, i) => ({ ...p, times: [i] }));
  };
  const plans = done(on?.plans);
  const sources = Object.assign({}, there?.sources || {}, on?.sources || {});
  const later = on?.later ? on.later.then(o => (o?.plans?.length ? { plans: done(o.plans), sources } : null)).catch(() => null) : null;
  return { plans, sources, error: plans.length ? null : new Error('none'), later };
}
