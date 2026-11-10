// 導航: a plan followed step by step with the phone's position. Walking and
// riding steps say how far is left (and open Google Maps' own turn-by-turn
// navigation for that step with one tap: free, no billed call); a bus or
// train step counts down to it to the second and shows where it is now (how
// many stops away; TDX, every 20 s); on board, the stops still to go with
// when it's at each (TDX's estimates, and your own pace from where the phone
// has been for every stop they don't cover), and a buzz with the card turned
// round when yours is next; off it, what's next. Each step moves on by itself
// when you get there.

import { emptyNote } from './look.mjs';
import * as kit from '#kit/orbit.mjs';
import { watchPosition, getPosition, roadPath, liveMs } from './api.mjs';
import { buzz, primeBuzz } from './buzz.mjs';
import { liveTimes, officialLeg, liveTrusted, wayOf, departuresAt, seenAt, nextCatchable } from './live.mjs';
import { troubleHtml, fastest, wrongRide, offKind } from './trouble.mjs';
import { routeStops, routeSchedule, routeCity, routeEta, stationsNear, stationEtaAsk } from './bus.mjs';
import { etaAround, bikesAround } from './near.mjs';
import { canRent, canReturn } from './bike.mjs';
import { rideSec, DOCK_SEC, walkLeg, rideLeg, rentNear, returnNear } from './plan.mjs';
import { rental, startRental, endRental, rentalStep, swapDocks, FREE_MS, WARN_MS } from './rental.mjs';
import { traLive, dayTrips, railStations } from './raildata.mjs';
import { metroStops } from './metro.mjs';
import { busWhere, trainWhere, trainByTime, nextStop, busAhead, nearestStop, countText, trainFor, routeCum, alongRoute, offRide, ridePace, aheadByPace } from './navlive.mjs';
import { icon, MODE_NAME, legColor, legLabel, sheet, sheetHead, trainKind } from './ui.mjs';
import { e, hm, minsText, meters, walkSec, tw, decodeLine, isRide, rides, readSaved, UNREAD, writeJson, shown, distText } from './util.mjs';

import { W, en } from '#kit/lang.mjs';
let nav = null;
// Where today's trains come from (the timetable, the live board): a test's own day instead.
let rail = { dayTrips, railStations, traLive };
export const useRail = x => (rail = { dayTrips, railStations, traLive, ...x });

// The ride being followed, kept on the phone: swiped away and opened again,
// it goes on where it was (savedNav, for tab-map), until it's over or ended.
const NAV_KEY = 'ot.nav.v1';
// How long past the plan's arrival a ride is still kept (it ends by itself
// when you get there): a late bus is still being ridden (the owner,
// 2026-10-13: opened again on the last stretch, ended at 5 minutes past).
const NAV_KEEP = 90 * 60_000;
// (Promises, the later buses on their way, aren't kept.)
const noPromises = (k, v) => (v instanceof Promise ? undefined : v);
// (Kept at the step you're at, not one looked at ahead: opened again after
// Google or Apple 地圖, a look at the YouBike step was taken as begun, its
// ride redrawn from you; the owner, 2026-10-28.)
const saveNav = state => writeJson(NAV_KEY, { plan: state.plan, i: state.reached, reached: state.reached, phase: state.i === state.reached ? state.phase : state.reachedPhase || 'before', min: Boolean(state.min), at: Date.now() }, noPromises);
export function savedNav(now = Date.now()) {
  const x = readSaved(NAV_KEY);
  if (x === UNREAD) return null; // (kept, not dropped)
  if (x?.plan?.legs?.length && x.plan.arr > now - NAV_KEEP) return x;
  writeJson(NAV_KEY, null);
  return null;
}
const dropNav = () => writeJson(NAV_KEY, null);

// A bus leg as its official route and way, with its timetable (for which
// live buses are in service), looked up once per leg.
async function busInfo(l) {
  const o = l.route?.uid ? l : await officialLeg(l).catch(() => l);
  if (!o.route?.uid) return { leg: o };
  const route = { uid: o.route.uid, name: o.short || o.name, city: o.route.city || routeCity(o.route.uid) };
  const [ways, sched] = await Promise.all([routeStops(route, o.from).catch(() => []), routeSchedule(route, o.from).catch(() => [])]);
  const w = ways.find(x => x.dir === o.route.dir && x.stops.some(y => y.uid === o.route.stopUID));
  const way = w ? { w, i: w.stops.findIndex(y => y.uid === o.route.stopUID) } : wayOf(ways, o.from, o.to);
  // The stop's station (the Worker's bus check asks by it).
  const st = (await stationsNear(o.from.lat, o.from.lon).catch(() => [])).find(s => s.stops.some(x => x.stopUID === o.route.stopUID || (x.routeUID === o.route.uid && meters(s.lat, s.lon, o.from.lat, o.from.lon) < 80)));
  return { leg: o, route, way, sched, station: st || null };
}

// A bus leg the planner gave no shape: the line through its stops, from its
// route's way (the bus packs first: no proxy read), for the map. → [[lat, lon]…] or null.
export async function busPath(l) {
  if (l.mode !== 'bus' || l.poly || l.path) return null;
  const o = await officialLeg(l).catch(() => l);
  if (!o.route?.uid) return null;
  const ways = await routeStops({ uid: o.route.uid, name: o.short || o.name, city: o.route.city || routeCity(o.route.uid) }, o.from).catch(() => []);
  const w = ways.find(x => x.dir === o.route.dir && x.stops.some(y => y.uid === o.route.stopUID));
  const way = w ? { w, i: w.stops.findIndex(y => y.uid === o.route.stopUID) } : wayOf(ways, o.from, o.to);
  if (!way?.w) return null;
  const j = nearestStop(way.w.stops, l.to, way.i + 1);
  return j > way.i ? way.w.stops.slice(way.i, j + 1).filter(x => x.lat != null).map(x => [x.lat, x.lon]) : null;
}

// A train's stops from where you get on to where you get off ([[lat, lon]…]), or null.
export async function trainStops(l) {
  const r = await rideStops(l).catch(() => null);
  return r ? r.stops.slice(r.i, r.j + 1).map(x => [x.lat, x.lon]) : null;
}
// A ride's stops, from where you get on (i) to where you get off (j), with
// their times where they're known: a bus's way; a train's run today.
async function rideStops(l, info) {
  if (l.mode === 'bus') {
    const w = info?.way;
    if (!w?.w?.stops?.length) return null;
    const stops = w.w.stops;
    const j = nearestStop(stops, l.to, w.i + 1);
    return j > w.i ? { stops, i: w.i, j } : null;
  }
  if (l.mode === 'tra' || l.mode === 'hsr') {
    // Its number from the day's timetable when the planner gave only the line (the live board and its stops go by it).
    if (!l.train?.no && l.dep && l.from?.lat != null && l.to?.lat != null) {
      const t = trainFor(await rail.dayTrips(tw(l.dep).date), await rail.railStations(), l);
      if (t) l.train = { ...(l.train || {}), ...t };
    }
    if (!l.train?.no) return null;
    const trip = (await rail.dayTrips(tw(l.dep).date)).find(t => t.sys === l.mode && String(t.no) === String(l.train.no));
    if (!trip) return null;
    const sts = new Map((await rail.railStations()).map(s => [s.key, s]));
    const stops = trip.stops.map(x => ({ id: x.st, name: sts.get(x.st)?.name || '', lat: sts.get(x.st)?.lat, lon: sts.get(x.st)?.lon, at: x.arr, dep: x.dep })).filter(x => x.lat != null);
    const i = nearestStop(stops, l.from, 0, 800);
    const j = i >= 0 ? nearestStop(stops, l.to, i + 1, 800) : -1;
    return j > i ? { stops, i, j } : null;
  }
  if (l.mode === 'metro' || l.mode === 'lightrail') return metroStops(l);
  return null;
}

// Getting off: one alert, when the ride reaches the stop before yours,
// that's when you ring (Jay, 2026-10-22; it was a "get ready" a few minutes
// early, then a second at the stop before, two rounds piled up). By stops:
// `next` (nextStop) is yours once you're at the stop before it or past it.
// No stops known: under 600 m from yours.
export const ringNow = (rs, next) => next != null && next >= rs.j;
// A ride's stop times as far as they're known: the timetable's, else in
// proportion along its planned time.
const plannedAt = (l, rs) => {
  rs.cum ||= routeCum(rs.stops);
  const span = rs.cum[rs.j] - rs.cum[rs.i];
  return k => rs.stops[k]?.at ?? (span > 0 ? l.dep + ((rs.cum[k] - rs.cum[rs.i]) / span) * (l.arr - l.dep) : null);
};

// Every navigation alert, in one place (Jay, 2026-10-22: keep it simple).
// On the lock screen (the Worker sends them, the app closed too; push.js):
//   nav:leave    2 min before the trip leaves: 該出發了
//   nav:bus:k    the bus nearly at your stop, by its live times (checked every 2 min)
//   nav:train:k  5 min before a train leaves, with its platform
//   nav:off:k    the ride at the stop before yours: 下一站 X 下車 (a bus: 按下車鈴)
// In the app (a buzz, each once, nav.mjs below): the bus pulling in / the train
// at the platform, the stop before yours (ringNow), off the ride's road 30 s
// (got off?), missed it (the next one taken), stayed on past yours, there.
// `offAt`: by ride, when it's at the stop before yours (its stops' times now).
export function navNotices(plan, i, info = new Map(), now = Date.now(), offAt = new Map()) {
  const out = [];
  if (i === 0 && plan.dep - 2 * 60_000 > now) out.push({ at: plan.dep - 2 * 60_000, title: W('該出發了', 'Time to go'), body: W(`${hm(plan.dep)} 出發・${hm(plan.arr)} 抵達`, `Leave ${hm(plan.dep)}・arrive ${hm(plan.arr)}`), tag: 'nav:leave', kind: 'nav', hash: 'nav' });
  plan.legs.forEach((l, k) => {
    if (k < i) return;
    if (l.mode === 'bus') {
      const x = info.get(k);
      const st = x?.station;
      if (st && x.leg.route?.uid && l.dep > now - 5 * 60_000) out.push({ at: Math.max(now, l.dep - 25 * 60_000), until: l.dep + 30 * 60_000, title: W(`${rideName(x.leg)} 快到了`, `${rideName(x.leg)} is almost here`), body: W(`{result}（${st.name}）`, `{result} (${st.name})`), tag: `nav:bus:${k}`, kind: 'nav', hash: 'nav', check: { bus: { path: stationEtaAsk(st), route: x.leg.route.uid, dir: Number(x.leg.route.dir), min: 5 } } });
    }
    if ((l.mode === 'tra' || l.mode === 'hsr') && l.dep - 5 * 60_000 > now) out.push({ at: l.dep - 5 * 60_000, title: W(`${rideName(l)} ${hm(l.dep)} 開`, `${rideName(l)} leaves ${hm(l.dep)}`), body: `${W('在', 'At')} ${l.from?.name || ''}${l.train?.platform ? W(` ${l.train.platform} 月台`, `, platform ${l.train.platform}`) : ''}${wayText(l) ? `・${wayText(l)}` : ''}`, tag: `nav:train:${k}`, kind: 'nav', hash: 'nav' });
    const ring = offAt.get(k) ?? l.arr - 2 * 60_000;
    if (isRide(l) && ring > now) out.push({ at: ring, title: W(`下一站 ${l.to?.name || ''} 下車`, `Get off next: ${l.to?.name || ''}`), body: l.mode === 'bus' ? W('按下車鈴', 'Press the bell') : W(`準備下車${plan.legs[k + 1] ? `，接著${stepText(plan, k + 1, 'before').title}` : ''}`, `Get ready${plan.legs[k + 1] ? `, then ${stepText(plan, k + 1, 'before').title}` : ''}`), tag: `nav:off:${k}`, kind: 'nav', hash: 'nav' });
  });
  return out;
}

const ARRIVED = { walk: 35, bike: 60 };
const NEXT_STOP_M = 600;

export const navigating = () => Boolean(nav);
// Any plan not yet over: one leaving later starts too, saying when to set out.
export const NAV_LEAD = 20 * 60_000;
export const canNav = (p, now = Date.now()) => Boolean(p) && p.arr > now;

// Google Maps' (or Apple's, below) own directions for a walk or a ride of
// your own, never a bus or train (the app's own): opened to look over and
// start yourself, walking as cycling (the owner, 2026-10-13: walking had
// started at once). From `from`, the step's own start, when it isn't the
// step you're at (one looked ahead to, or a plan's); else none: the app's
// own 你的位置, never a point we pinned. To the place itself when it's one
// of Google's (its place id: the shop, not a spot in the road outside it),
// else the point.
export const GOOGLE_ID = /^[A-Za-z0-9_-]{20,300}$/;
export function gmapsLink(to, mode, from = null) {
  const p = new URLSearchParams({ api: '1' });
  if (from?.lat != null) p.set('origin', `${from.lat},${from.lon}`);
  if (to.gid && GOOGLE_ID.test(to.gid) && to.name) {
    p.set('destination', to.name);
    p.set('destination_place_id', to.gid);
  } else p.set('destination', `${to.lat},${to.lon}`);
  p.set('travelmode', mode);
  return `https://www.google.com/maps/dir/?${p}`;
}
// Apple Maps' own directions, the same: walking or cycling, to the point
// (Apple has no Google place id; the name labels it). Apple's Maps URLs
// (maps.apple.com/directions).
const APPLE_MODE = { walking: 'walking', bicycling: 'cycling' };
export function appleMapsLink(to, mode, from = null) {
  const p = new URLSearchParams({ destination: `${to.lat},${to.lon}`, mode: APPLE_MODE[mode] || 'walking' });
  if (to.name) p.set('destination-name', to.name);
  if (from?.lat != null) p.set('source', `${from.lat},${from.lon}`);
  return `https://maps.apple.com/directions?${p}`;
}
// The app the person navigates with (我的 → 交通偏好 → 導航 App): its link and its name.
let mapsApp = () => 'google';
export const useMapsApp = get => (mapsApp = get);
export const mapsLink = (to, mode, from = null) => (mapsApp() === 'apple' ? appleMapsLink(to, mode, from) : gmapsLink(to, mode, from));
export const mapsName = () => (mapsApp() === 'apple' ? W('Apple 地圖', 'Apple Maps') : W('Google 地圖', 'Google Maps'));
// Where a leg ends, for Google: the trip's own place for its last one.
export const legEnd = (plan, k) => (k === plan.legs.length - 1 && plan.dest?.lat != null && meters(plan.dest.lat, plan.dest.lon, plan.legs[k].to.lat, plan.legs[k].to.lon) < 300 ? plan.dest : plan.legs[k].to);

// The two cards folded small, for more map (the owner, 2026-10-13: the map
// between them was too small): the top to its step and the line under it,
// the bottom to when you're there; a tap on the grip (or a swipe) folds or
// opens one, kept on the device. → { top, bottom }
const FOLD_KEY = 'ot.nav.fold';
let foldUnread = false;
function readFold() {
  const f = readSaved(FOLD_KEY, {});
  foldUnread = f === UNREAD;
  return { top: f?.top === true, bottom: f?.bottom === true };
}
const saveFold = f => foldUnread || writeJson(FOLD_KEY, f);
const grip = (which, folded) => `<button class="ot-nav-grip" type="button" data-nav="fold-${which}" aria-label="${folded ? W('展開', 'Expand') : W('收合', 'Collapse')}" aria-expanded="${!folded}"></button>`;
// A step looked ahead to goes back to the one you're at after this long untouched.
const LOOK_MS = 20_000;
// No position for this long while seen: the device's watch started over;
// each start that brings none waits twice as long (a train's weak sky can
// take a while for a first fix, never cut off again and again), up to a minute.
const SILENT_MS = 10_000;
// A fix older than this by its own stamp is the past, not where you are.
const STALE_FIX_MS = 30_000;
const SILENT_MAX = 60_000;
// Off a ride this long before it asks if you got off (a fix or two off it is the phone, not you).
const AWAY_MS = 30_000;
// …this far from its line and its road (a train's station is wide).
const AWAY_M = { bus: 150, lightrail: 150 };
// A walk's or a ride's own way on the map (its road from the router), as
// points along it; none when it's only the straight line.
const shapes = new WeakMap();
function wayPts(l) {
  if (!l.poly) return null;
  const key = Array.isArray(l.poly) ? l.poly : [l.poly];
  if (!shapes.has(l) || shapes.get(l).key !== key.join('|')) shapes.set(l, { key: key.join('|'), pts: key.flatMap(x => decodeLine(x, l.fmt)).map(([lat, lon]) => ({ lat, lon })) });
  const pts = shapes.get(l).pts;
  return pts.length > 1 ? pts : null;
}
// A step's way as points: its road or its line (the planner's, or through its
// stops once known), else the straight line from where it starts to where it ends.
function legPts(l) {
  const w = wayPts(l) || (Array.isArray(l.path) && l.path.length > 1 ? l.path.map(([lat, lon]) => ({ lat, lon })) : null);
  return w || (l.from?.lat != null && l.to?.lat != null ? [l.from, l.to] : null);
}
// How near its way you are to be on a step: a walk's or a ride's road, a bus's, a train's line (a station is wide, its line drawn loosely).
// On a bus that's due or has come, this far along its way past the stop (two fixes going its way).
const BUS_ON_M = 60;
const ON_WAY = { walk: 50, bike: 60, bus: 90, tra: 250, hsr: 300, metro: 200, lightrail: 120 };
// Where you are on the trip, from where it was (`i`) on: the furthest step
// whose way you're on and well into — a bus or train once its first stop is
// behind you (on board; not before it can have come), a walk or a ride of
// your own a little way along it (not while the step you're on still has a
// way to go on the same road) — or null when nothing says you've moved on.
// Opened half way, it finds the step you're at; on the way, a step's end
// missed (a fix that skipped it) is caught by the next one's start.
// `anyTime`: by where you are alone (a plan whose clock is off: started
// half way on a trip timed for another day, or a later train than planned).
// → { i, phase: 'before' | 'on' } or null.
export function tripAt(plan, pos, i = 0, now = Date.now(), { anyTime = false } = {}) {
  if (!pos || pos.lat == null) return null;
  const at = k => {
    const pts = legPts(plan.legs[k]);
    if (!pts) return null;
    const cum = routeCum(pts);
    const a = alongRoute(pts, pos, cum);
    return a ? { on: a.off < (ON_WAY[plan.legs[k].mode] || 80), d: a.d, left: cum.at(-1) - a.d } : null;
  };
  const cur = at(i);
  const busy = !isRide(plan.legs[i]) && cur?.on && cur.left > 100;
  for (let k = plan.legs.length - 1; k >= i; k--) {
    const l = plan.legs[k];
    const a = at(k);
    if (!a?.on) continue;
    if (isRide(l)) {
      // (A bus that's due: a block on its way is on it, BUS_ON_M.)
      const due = now >= (l.dep ?? 0) - 60_000 && !anyTime;
      if (a.d > (l.mode === 'bus' && due ? BUS_ON_M : 200) && a.left > 150 && (anyTime || now >= (l.dep ?? 0) - 3 * 60_000)) return { i: k, phase: 'on', d: a.d };
    } else if (k > i && a.d > 60 && !busy) return { i: k, phase: 'before' };
  }
  return null;
}
// Off a bus or train (where its last stop is, more or less): a train's station is wide.
const OFF_M = { tra: 250, hsr: 300, metro: 200 };

// Gone your own way on foot or on a bike (the owner, 2026-10-28: an e-bike
// taken at another station, ridden another way; or the bike given up and
// walked straight to the train station, the trip still back at the first
// walk): the step you're really on, from the last two and a half minutes
// of fixes, while off the way of the step you're at.
//   - Going at a bike's pace (12 to 32 km/h) on a walk with a YouBike ride
//     ahead before the next bus or train: on the bike.
//   - Going away from where this step ends and toward where a later walk
//     ends (or the next bus's or train's stop): on that walk, the steps
//     between skipped.
//   - Going away from this step's end and toward none: `lost` (asked to
//     plan again from there).
// → { i, phase: 'before', why: 'bike' | 'walk' } | { lost: true } | null
const BIKE_MS = [3.3, 9];
export function offPlan(plan, i, fixes, now = Date.now()) {
  const l = plan.legs[i];
  if (!l || isRide(l) || l.to?.lat == null) return null;
  const f = (fixes || []).filter(x => x.t >= now - 150_000);
  if (f.length < 3) return null;
  const a = f[0], b = f.at(-1);
  const secs = (b.t - a.t) / 1000;
  const moved = meters(a.lat, a.lon, b.lat, b.lon);
  if (secs < 40 || moved < 120) return null;
  // (On this step's own way and along it, it's this step: a road that turns
  // away first. At its start only, it's the way just redrawn from you.)
  const pts = legPts(l);
  const on = pts && alongRoute(pts, b, routeCum(pts));
  if (on && on.off < (ON_WAY[l.mode] || 80) && on.d > 60) return null;
  const gain = pt => meters(a.lat, a.lon, pt.lat, pt.lon) - meters(b.lat, b.lon, pt.lat, pt.lon);
  const r = plan.legs.findIndex((x, k) => k > i && isRide(x));
  const end = r < 0 ? plan.legs.length : r;
  const speed = moved / secs;
  if (l.mode === 'walk' && speed >= BIKE_MS[0] && speed <= BIKE_MS[1]) {
    const k = plan.legs.findIndex((x, n) => n > i && n < end && x.mode === 'bike');
    if (k > 0) return { i: k, phase: 'before', why: 'bike' };
  }
  if (gain(l.to) > -0.3 * moved) return null;
  // (Where a later walk ends, or the next ride's stop: the furthest you're headed for.)
  for (let k = end - 1; k > i; k--) {
    const x = plan.legs[k];
    const to = k === end - 1 && r >= 0 ? plan.legs[r].from : x.to;
    if (x.mode === 'walk' && to?.lat != null && gain(to) >= 0.6 * moved) return { i: k, phase: 'before', why: 'walk' };
  }
  if (r >= 0 && plan.legs[end - 1] !== l && plan.legs[r].from?.lat != null && gain(plan.legs[r].from) >= 0.6 * moved && plan.legs[end - 1].mode !== 'walk') return { i: r, phase: 'before', why: 'walk' };
  return { lost: true };
}

// The ride itself, said the way its sign says it: 公車 5608 往 竹東, 區間 1234 次 往 新竹.
export function rideName(l) {
  let s = String(l.short || l.name || '').trim();
  // A planner's line (新竹-六家) isn't what the sign says: the train's kind, from the timetable, is.
  if (l.mode === 'tra' && l.train?.type && /-/.test(s)) s = l.train.type;
  if (l.mode === 'tra') s = trainKind(s);
  if (l.mode === 'tra') {
    const t = `${s}${l.train?.no && !s.includes(l.train.no) ? ` ${l.train.no}` : ''}`;
    return W(`台鐵 ${t}${/\d$/.test(t) ? ' 次' : ''}`, `TRA ${t}`);
  }
  if (l.mode === 'hsr') return en ? `HSR ${s.replace(/^高鐵\s*/, '').replace(/\s*次$/, '')}`.trim() : s.startsWith('高鐵') ? s : `高鐵 ${s}`;
  return `${MODE_NAME[l.mode] || ''} ${s}`.trim();
}
// A sign's way, without the 往 a source may have put on it already.
const toward = h => String(h || '').replace(/^往\s*/, '');
// Which way, as said on the card: the sign's way, unless it names where you
// board (a loop, 藍線1區 「往 火車站」 at 火車站): then where you're going.
export const wayText = l => {
  const h = toward(l.headsign);
  if (!h) return '';
  return `${W('往', 'to')} ${h === String(l.from?.name || '').trim() && l.to?.name ? l.to.name : h}`;
};
// A step's title as HTML: each place or route name in it kept in one piece (it wraps between the words, never inside a name; a name too long for the line ends in an ellipsis).
const titleHtml = (title, plan) => {
  const names = [...new Set((plan.legs || []).flatMap(l => [l.from?.name, l.to?.name, l.route ? rideName(l) : '']).map(n => e(String(n || '').trim())).filter(Boolean))].sort((a, b) => b.length - a.length);
  const html = e(title);
  if (!names.length) return html;
  return html.replace(new RegExp(names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'), n => `<span class="ot-nw">${n}</span>`);
};
// What to do on a leg, before (or while) doing it: one short line, and what's said under it.
// A place's name without its bracket (陽明交通大學(六家校區) → 陽明交通大學): the
// card's lines stay one line each at any width (Jay, 2026-10-22).
// A stop's name, short enough for the bottom bar at 320: its first word (墨竹亭 燃麵本家 竹北博愛店 → 墨竹亭), 8 characters at most.
export const stopShort = n => {
  const w = shortPlace(n).split(/\s+/)[0] || '';
  return [...w].length > 8 ? `${[...w].slice(0, 7).join('')}…` : w;
};
export const shortPlace = n => String(n || '').replace(/\s*[（(][^）)]*[）)]\s*/g, '').trim() || String(n || '');
function stepText(plan, i, phase) {
  const l = plan.legs[i];
  const next = plan.legs[i + 1];
  const where = shortPlace(l.to?.name || (next?.from?.name ?? '')) || W('目的地', 'destination');
  if (l.mode === 'walk') {
    const last = i === plan.legs.length - 1;
    return { title: `${W('走到', 'Walk to')} ${last && !l.to?.name ? W('目的地', 'destination') : where}`, sub: next?.mode === 'bike' ? `${W('在這裡借', 'Rent a')} ${next.ebike ? W('電輔車', 'e-bike') : 'YouBike'}${W('', ' here')}` : isRide(next) ? `${W('搭', 'Take')} ${rideName(next)}` : '' };
  }
  // (One bike kept the whole trip with stops: ridden on from each, parked, not returned, at each.)
  if (l.mode === 'bike') return { title: `${W('騎到', 'Ride to')} ${shown(l.to.name)}`, sub: l.swap ? W('還車再借一台（每 30 分鐘換一次車）', 'Return and re-rent (a new bike every 30 min)') : `${l.kept ? W('騎同一台', 'Same bike') : `${l.ebike ? W('電輔車', 'E-bike') : 'YouBike'}・${W(`在 ${shown(l.from.name)} 借⁠車`, `rent at ${shown(l.from.name)}`)}`}${l.park ? W('・到了先停好，不還⁠車', '・park it, don’t return') : ''}` };
  if (phase === 'on') return { title: W(`坐到 ${shown(l.to.name)} 下車`, `Ride to ${shown(l.to.name)}`), sub: `${rideName(l)}${wayText(l) ? ` ${wayText(l)}` : ''}` };
  return { title: `${W('搭', 'Take')} ${rideName(l)}`, sub: `${shown(l.from.name)}${wayText(l) ? `・${wayText(l)}` : ''}${l.train?.platform ? W(`・${l.train.platform} 月台`, `・platform ${l.train.platform}`) : ''}` };
}
// The ride this step leads to (the bus or train you're on your way to catch), or this step's own.
const rideOf = (plan, i) => plan.legs.slice(i).findIndex(isRide) + i;

// The trip from here, as it's going now: when each leg from the one you're on
// will be over (what's left of a walk or ride from where you are, at its own
// pace; a bus by when it really comes, `liveAt`; a train by its time), when
// you'll be at each bus or train's stop (`ready`), and when you'll be there.
// Before setting out, from when you're to leave.
export function navTimes(plan, i, phase, pos = null, liveAt = new Map(), now = Date.now(), arrAt = null) {
  let t = i === 0 && phase !== 'on' ? Math.max(now, plan.dep - 60_000) : now;
  const end = [];
  const ready = new Map();
  for (let k = i; k < plan.legs.length; k++) {
    const l = plan.legs[k];
    if (isRide(l)) {
      const dep = liveAt.get(k) ?? l.dep;
      const ride = (l.arr ?? dep) - (l.dep ?? dep);
      if (k === i && phase === 'on') t = Math.max(t, arrAt ?? dep + ride);
      else {
        ready.set(k, t);
        t = Math.max(t, dep) + ride;
      }
    } else if (k === i && pos && l.to?.lat != null) {
      const m = meters(pos.lat, pos.lon, l.to.lat, l.to.lon);
      t += (l.mode === 'bike' ? rideSec(m, l.ebike) + DOCK_SEC : walkSec(m)) * 1000;
    } else t += (l.dur || 0) * 1000;
    end[k] = t;
  }
  return { end, ready, eta: t };
}

// Late by `late` ms for a ride, with `left` ms still to go to its stop at a
// walk: past what hurrying makes up (a third quicker, a minute at least).
export const pastHurry = (late, left) => late > Math.max(60_000, 0.3 * Math.max(0, left));

// The line under the step: how you're doing for the bus or train to catch
// (there with minutes to spare, only just, or late), when to set out, or
// when you'll be there. → { text, tone: 'good' | 'warn' | 'bad' | '' }.
export function paceOf(plan, i, phase, times, liveAt = new Map(), now = Date.now(), live = '') {
  // (A plan starting with the ride itself: its own line below, with what's live.)
  if (i === 0 && phase !== 'on' && !isRide(plan.legs[0]) && plan.dep - now > 60_000) {
    // When to set out, unless from where you are now leaving then misses the
    // ride (times: from your position): then leave now, or it's gone already.
    const k = rideOf(plan, 0);
    const ready = k > 0 ? times.ready.get(k) : null;
    const dep = k > 0 ? (liveAt.get(k) ?? plan.legs[k].dep) : null;
    if (ready == null || dep == null || ready <= dep) return { text: W(`${hm(plan.dep)} 出發・還有 ${minsText(Math.round((plan.dep - now) / 1000))}`, `Leave ${hm(plan.dep)}・in ${minsText(Math.round((plan.dep - now) / 1000))}`), tone: '' };
    const slack = Math.round((dep - (ready - (Math.max(now, plan.dep - 60_000) - now))) / 60_000);
    return slack >= 0 ? { text: W(`現在就出發・${hm(dep)} 的車還趕得上`, `Go now・you can make the ${hm(dep)}`), tone: 'warn' } : { text: W(`從這裡趕不上 ${hm(dep)} 的車了`, `Can’t make the ${hm(dep)} from here`), tone: 'bad' };
  }
  const ri = rideOf(plan, i);
  const r = ri >= i ? plan.legs[ri] : null;
  // On board: when you're at your stop (the bottom says when you're there); nothing to catch: nothing to say.
  if (ri === i && phase === 'on') return { text: live || W(`${hm(times.end[i])} 到 ${r.to?.name || ''}`, `${r.to?.name || ''} at ${hm(times.end[i])}`), tone: live ? 'warn' : '' };
  if (!r) return { text: '', tone: '' };
  const dep = liveAt.get(ri) ?? r.dep;
  // (Not when the step you're on is the walk to it: its title says where already.)
  const at = r.from?.name && !(ri > i && plan.legs[i].to?.name === r.from.name) ? `${r.from.name} ` : '';
  const when = r.mode === 'bus' ? W(`${liveAt.has(ri) ? '' : '約 '}${hm(dep)} 到站`, `due ${liveAt.has(ri) ? '' : '~'}${hm(dep)}`) : W(`${hm(dep)} 開`, `leaves ${hm(dep)}`);
  if (ri === i) {
    const m = Math.round((dep - now) / 60_000);
    return { text: `${at}${when}${m > 0 ? W(`・${m} 分後`, `・in ${m} min`) : W('・就要到了', '・any moment')}${live && !/到站|due/.test(live) ? `・${live}` : ''}`, tone: m > 0 ? '' : 'warn' };
  }
  // (How early or late you'll be there says when: beside Google (or Apple) 地圖, on to a
  // second line between its parts when the stop's name is long, never cut.)
  const slack = Math.round((dep - times.ready.get(ri)) / 60_000);
  if (slack >= 2) return { text: `${at}${when}・${W(`早到 ${slack} 分`, `${slack} min to spare`)}`, tone: 'good' };
  if (slack >= 0) return { text: `${at}${when}・${W('剛好趕上', 'just in time')}`, tone: 'warn' };
  // (Never "hurry" when hurrying can't make it: the owner, 2026-11-03.)
  if (pastHurry(times.ready.get(ri) - dep, times.ready.get(ri) - now)) return { text: `${at}${when}・${W('趕不上了', 'can’t make it')}`, tone: 'bad' };
  return { text: `${at}${when}・${W(`晚 ${-slack} 分，快一點`, `${-slack} min behind, hurry`)}`, tone: 'bad' };
}

// A step's chip at the bottom: its kind, and what tells it apart (a walk's
// minutes, a ride's line and time).
const chipText = l => (l.mode === 'walk' ? `${Math.max(1, Math.round((l.dur || 0) / 60))}′` : l.mode === 'bike' ? `${l.ebike ? W('電輔車', 'E-bike') : 'YouBike'} ${Math.max(1, Math.round((l.dur || 0) / 60))}′` : `${legLabel(l)} ${hm(l.dep)}`);

// The YouBike ride coming up, now: bikes where you take one (until you've
// left with it) and docks where you leave it, as they are there now; and
// a tap to move the ride to the nearest station that has some (never by
// itself: the counts are too live to act on before you're there). Asked
// out loud only when it's running low (LOW or fewer: the bikes the ride
// needs, a 電輔車's its own); else the count itself is the tap (the owner,
// 2026-10-29: 這站沒車 beside 可借 12 read as a joke).
const LOW = 2;
function bikesText(bk, plan, i, pos) {
  if (!bk || bk.k < i) return '';
  const leg = plan.legs[bk.k];
  const from = leg.from;
  const kept = leg.kept, park = leg.park;
  if (kept && park) return '';
  const out = [];
  if (bk.moved) out.push(`<span class="note warn">${icon('bike')}${e(bk.moved)}</span>`);
  if (bk.none) out.push(`<span class="note bad">${icon('bike')}${e(bk.none)}</span>`);
  const taking = !kept && (park || bk.k > i || !pos || meters(pos.lat, pos.lon, from.lat, from.lon) < 150);
  const end = taking ? 'rent' : 'return';
  // (What's left for this ride where it ends now: null without counts.)
  const left = taking ? (bk.rent ? (leg.ebike ? bk.rent.ebike || 0 : (bk.rent.bikes || 0) + (bk.rent.ebike || 0)) : null) : bk.ret ? bk.ret.ret : null;
  // (A station out of service with bikes in it: no bikes for you either.)
  const off = !!bk.rent && taking && !canRent(bk.rent, leg.ebike) && left > 0;
  const low = left != null && (left <= LOW || off);
  const quiet = (html, label) => (!low && left != null ? `<button class="ot-nav-bk" type="button" data-nav-bike="${end}" aria-label="${e(label)}">${html}</button>` : `<span>${html}</span>`);
  const swapLabel = W('換附近的站', 'Nearby dock');
  // (A 電輔車's ride: its 電輔車 the count, never 可借 0 beside them.)
  if (bk.rent && taking) out.push(quiet(leg.ebike ? `${icon('bolt')}${W('可借電輔', 'E-bikes')} ${bk.rent.ebike || 0}` : `${icon('bike')}${W('可借', 'Bikes')} ${bk.rent.bikes}${bk.rent.ebike ? `・${icon('bolt')}${bk.rent.ebike}` : ''}`, swapLabel));
  if (bk.ret) out.push(taking ? `<span>${W('還車空位', 'Docks')} ${bk.ret.ret}</span>` : quiet(`${W('還車空位', 'Docks')} ${bk.ret.ret}`, swapLabel));
  const btn = text => `<button class="ot-nav-gm" type="button" data-nav-bike="${end}">${icon('route')}${text}</button>`;
  if (left == null) out.push(btn(swapLabel));
  else if (low) out.push(btn(taking ? (left && !off ? W(`只剩 ${left} 台${leg.ebike ? '電輔車' : ''}，換附近的站？`, `${left} ${leg.ebike ? 'e-bike' : 'bike'}${left > 1 ? 's' : ''} left: nearby dock?`) : leg.ebike ? W('沒有電輔車了，換附近的站？', 'No e-bikes: nearby dock?') : W('沒車了，換附近的站？', 'No bikes: nearby dock?')) : left ? W(`只剩 ${left} 位，換附近的站？`, `${left} left: nearby dock?`) : W('沒空位了，換附近的站？', 'Full: nearby dock?')));
  return out.join('');
}

// A YouBike ride moved to another station (`end`: 'rent' where you take
// it, 'return' where you leave it): the walk to it or from it with it (one
// added where there was none), the times by the new distances. → true when moved.
export function moveRide(plan, k, end, station) {
  const l = plan.legs[k];
  if (l?.mode !== 'bike' || station?.lat == null) return false;
  const st = { name: station.name, lat: station.lat, lon: station.lon };
  const walk = (from, to) => (({ dist, dur }) => ({ mode: 'walk', from, to, dist, dur }))(walkLeg(from, to, 0));
  const before = plan.legs.reduce((t, x) => t + (x.dur || 0), 0);
  if (end === 'rent') {
    const prev = plan.legs[k - 1];
    if (prev?.mode === 'walk') Object.assign(prev, walk(prev.from, st), { poly: undefined, road: false, path: undefined });
    else plan.legs.splice(k, 0, walk(l.from, st)), (k += 1);
    l.from = st;
    // (The station itself: its marker on the map where you take it now, its counts.)
    l.rent = { ...station };
  } else {
    const next = plan.legs[k + 1];
    if (next?.mode === 'walk') Object.assign(next, walk(st, next.to), { poly: undefined, road: false, path: undefined });
    else plan.legs.splice(k + 1, 0, walk(st, l.to));
    l.to = st;
    l.ret = { ...station };
  }
  // (Timed as the planner times a ride: by the roads, a river by its bridge, a dock at each end.)
  const { dist, dur } = rideLeg(l.from, l.to, 0, l.ebike);
  Object.assign(l, { dist, dur, poly: undefined, road: false, path: undefined });
  const after = plan.legs.reduce((t, x) => t + (x.dur || 0), 0);
  plan.dur = (plan.dur || before) + (after - before);
  if (plan.arr) plan.arr += (after - before) * 1000;
  return true;
}

// 換附近的站: where the ride goes instead (`end` 'rent' or 'return'), from
// the stations around the old one (`list`, bikesAround's): within 500 m of
// it, not tried yet, with a bike (a dock) now, more than LOW where any has;
// of those the planner's pick (rentNear, returnNear): your walk to it from
// where you are (`pos`, else where the walk to it starts) and the ride on by
// the roads, or the ride to it and the walk on. The nearest to the old one
// had been taken: 文興路莊敬南路口 a 550 m walk, the ride shorter (Jay 2026-11-09).
// → the station, or null.
export function swapPick(plan, k, end, list, { tried = new Set(), pos = null } = {}) {
  const l = plan.legs[k];
  if (l?.mode !== 'bike') return null;
  const rent = end === 'rent';
  const pt = rent ? l.from : l.to;
  const left = s => (rent ? (l.ebike ? s.ebike || 0 : (s.bikes || 0) + (s.ebike || 0)) : s.ret || 0);
  const ok = (list || []).filter(s => s.lat != null && !tried.has(s.uid) && meters(pt.lat, pt.lon, s.lat, s.lon) < 500 && (rent ? canRent(s, l.ebike) : canReturn(s)));
  const plenty = ok.filter(s => left(s) > LOW);
  const pool = plenty.length ? plenty : ok;
  if (!pool.length) return null;
  if (rent) {
    const prev = plan.legs[k - 1];
    const from = pos || (prev?.mode === 'walk' ? prev.from : l.from);
    return rentNear(from, pool, { ebike: l.ebike, max: 3000, to: l.to });
  }
  const next = plan.legs[k + 1];
  return returnNear(next?.mode === 'walk' ? next.to : l.to, pool, { max: 3000, from: pos || l.from, ebike: l.ebike });
}

// A YouBike ride cut at a station on its way (returned there and another
// taken: TPASS's next free half hour), from where you are (`pos`) now: two
// rides, the second a swap, what follows moved with it up to a train. → true when cut.
export function splitRide(plan, k, st, pos = null, now = Date.now()) {
  const l = plan.legs[k];
  if (l?.mode !== 'bike' || st?.lat == null || l.to?.lat == null) return false;
  const s = { name: st.name, lat: st.lat, lon: st.lon };
  // (From where you are: no dock to take it from.)
  const a = rideLeg(pos || l.from, s, now, l.ebike);
  const there = a.arr - (pos ? DOCK_SEC * 1000 : 0);
  const b = rideLeg(s, l.to, there, l.ebike);
  const clear = { poly: undefined, road: false, path: undefined };
  const first = { ...l, ...clear, to: s, ret: { ...st }, arr: there, dur: Math.max(60, Math.round((there - l.dep) / 1000)), dist: rideLeg(l.from, s, 0, l.ebike).dist, park: false };
  const second = { ...l, ...clear, from: s, rent: { ...st }, dep: b.dep, arr: b.arr, dur: b.dur, dist: b.dist, swap: true, kept: false };
  const d = second.arr - l.arr;
  plan.legs.splice(k, 1, first, second);
  for (let m = k + 2; m < plan.legs.length && !(isRide(plan.legs[m]) && plan.legs[m].mode !== 'bus'); m++) Object.assign(plan.legs[m], { dep: plan.legs[m].dep + d, arr: plan.legs[m].arr + d });
  plan.arr = plan.legs.at(-1).arr;
  plan.dur = Math.round((plan.arr - plan.dep) / 1000);
  return true;
}

// A trip with stops, navigated whole (the owner, 2026-11-03: the first
// stretch had been a trip of its own): the stretches after this one
// (`plan.later`, as planned, one for each place in `plan.then`), and when
// you're at the end, by how late or early this stretch is running now.
export function laterEnd(plan, eta) {
  const last = plan.later?.at(-1);
  return last?.arr != null ? last.arr + Math.max(0, eta - plan.arr) : eta;
}
// On a YouBike to a stop with places after it: keep it (parked while
// there, ridden on) or return it (and the next stretch as planned:
// another bike, a bus…), and which gets you on sooner, by how much.
// → { keep, back, text } (minutes, null when not planned yet; the line
// said), or null when it isn't asked.
export function parkAsk(plan, i) {
  const l = plan.legs[i];
  const next = plan.then?.[0];
  if (l?.mode !== 'bike' || !next || l.asked || l.park || plan.legs.slice(i + 1).some(x => x.mode === 'bike' || isRide(x))) return null;
  const stop = plan.dest || plan.legs.at(-1).to;
  const m = meters(stop.lat, stop.lon, next.lat, next.lon);
  const keep = Math.round((rideSec(m, l.ebike) + DOCK_SEC) / 60);
  // (Later stretches on this same bike: no way without it planned to tell.)
  const q = plan.later?.[0]?.legs?.some(x => x.kept) ? null : plan.later?.[0];
  if (!q) return { keep, back: null, text: W(`停著騎過去 ${keep} 分`, `Keep it: ${keep} min on`) };
  const on = rides(q)[0];
  const how = on ? W(`搭 ${on.short || on.name} `, '') : q.legs.some(x => x.mode === 'bike') ? W('再借一台', '') : W('走路', '');
  const back = Math.round((q.arr - q.dep) / 60_000);
  const d = Math.abs(back - keep);
  const text = d <= 2 ? W(`差不多，都約 ${Math.max(back, keep)} 分`, `About ${Math.max(back, keep)} min either way`) : back < keep ? W(`還車${how}快 ${d} 分`, `Return: ${d} min sooner`) : W(`停著騎過去快 ${d} 分`, `Keep: ${d} min sooner`);
  return { keep, back, text };
}

// How long till you're there, short enough to sit beside the time and its drift: 45 分, 1時29分.
export const leftText = m => (m < 60 ? W(`${m} 分`, `${m} min`) : W(`${Math.floor(m / 60)}時${String(m % 60).padStart(2, '0')}分`, `${Math.floor(m / 60)} h ${m % 60} min`));
// What's left of a walk or ride, big: metres under a kilometre.
const distBig = m => (m < 1000 ? `<b>${Math.round(m / 10) * 10}</b><small>${W('公尺', 'm')}</small>` : `<b>${(m / 1000).toFixed(1)}</b><small>${W('公里', 'km')}</small>`);
// The countdown to a bus or train, big: to the second under ten minutes.
const countBig = (ms, what) => (ms >= 600_000 ? `<b>${Math.round(ms / 60_000)}</b><small>${W('分', 'min')}</small>` : `<b>${countText(ms)}</b><small>${e(what)}</small>`);

// Coming to your stop: its last few stops on a line, yours at the end, the
// bus or train where it is now (on a stop, or between two), what it's at.
function trackHtml(rs, w, l) {
  const i = rs.i;
  const far = w.far || w.k - 1 < i - 5;
  const s0 = Math.max(0, Math.min(far ? i - 5 : w.k - 1, i - 1));
  const n = Math.max(1, i - s0);
  const x = m => ((m - s0) / n) * 100;
  const bus = l.mode === 'bus';
  const there = bus ? w.in <= 60 : w.at;
  const vx = far ? 0 : there ? x(w.k) : Math.max(0, x(w.k) - 50 / n);
  const kind = bus ? W('公車', 'Bus') : W('列車', 'Train');
  const name = rs.stops[w.k]?.name || '';
  const where = en
    ? far ? `${kind} ${w.away} stops away` : w.away === 0 ? (there ? (bus ? 'Bus arriving' : 'Train at the platform') : `${kind} here next stop`) : `${kind} ${there ? (bus ? 'nearing' : 'at') : 'heading to'} ${name}`
    : far ? `${kind}還在 ${w.away} 站外` : w.away === 0 ? (there ? (bus ? '公車進站中' : '列車在月台上') : `${kind}下一站就到這裡`) : `${kind}${there ? (bus ? '快到' : '停在') : '開往'} ${name}`;
  const dots = [];
  for (let m = s0; m <= i; m++) dots.push(`<i class="${m < w.k ? 'past' : ''}${m === i ? ' you' : ''}" style="left:${x(m).toFixed(1)}%"></i>`);
  return `<div class="ot-track">
      <div class="ot-track-say"><span>${e(where)}${w.planned ? W('（依時刻表）', ' (timetable)') : ''}</span>${w.away ? `<b>${W(`還有 ${w.away} 站`, `${w.away} stops`)}</b>` : ''}</div>
      <div class="ot-track-line"><span class="ot-track-lit" style="left:${vx.toFixed(1)}%"></span>${dots.join('')}<span class="ot-track-car${there ? ' there' : ''}" style="left:${vx.toFixed(1)}%">${icon(l.mode)}</span></div>
    </div>`;
}

// On board: the stops still to go, the next one first and yours last (the
// middle of a long ride as how many), each with when it's there.
// Each stop's time, in order of trust: TDX's estimate (a bus); a train's
// timetable with its live delay; your own pace on it (`paced`, from where the
// phone has been); the timetable as it stands; and for yours, `end` (when
// you'll be there by the plan).
// `guess`: the last resort for a stop, in proportion along the ride's planned time (navStopAt).
export function boardHtml(rs, next, ahead, delay, end = null, paced = null, delayLive = false, guess = null) {
  const tt = k => (rs.stops[k].at != null ? rs.stops[k].at + delay * 60_000 : null);
  const at = k => ahead?.get(k) ?? (delayLive ? tt(k) : null) ?? paced?.get(k) ?? tt(k) ?? (k === rs.j ? end : null) ?? guess?.(k) ?? null;
  const ks = [];
  for (let k = next; k <= rs.j; k++) ks.push(k);
  const show = ks.length > 3 ? [ks[0], null, ks.at(-1)] : ks;
  return `<ol class="ot-stops">${show
    .map(k =>
      k == null
        ? `<li class="more"><i></i><span>${W(`再 ${ks.length - 2} 站`, `${ks.length - 2} more stops`)}</span></li>`
        : `<li class="${k === next ? 'next' : ''}${k === rs.j ? ' you' : ''}"><i></i><span>${e(rs.stops[k].name)}</span>${k === rs.j ? `<em>${W('下車', 'Get off')}</em>` : k === next ? `<em>${W('下一站', 'Next')}</em>` : ''}${at(k) ? `<time>${e(hm(at(k)))}</time>` : ''}</li>`
    )
    .join('')}</ol>`;
}

// A bus's or train's departures from the stop or station you board at, now
// on: a bus's live ones (its way, in service) and its timetable's; a train's
// of the same railway calling at both stations, by today's timetable with
// its live delay. → [{ dep, arr, live, train? }] (arr by the ride's own time
// for a bus), six at most.
async function rideOptions(l, info, now = Date.now()) {
  const ride = (l.arr ?? l.dep) - l.dep;
  if (l.mode === 'bus') {
    const x = info || (await busInfo(l).catch(() => null));
    const name = x?.leg?.short || x?.leg?.name || l.short || l.name;
    const all = liveTimes(await etaAround(l.from.lat, l.from.lon, 150).catch(() => []), name, now, x?.leg?.route?.uid ? { routeUID: x.leg.route.uid, dir: x.leg.route.dir } : {});
    const live = (x?.way && x.sched?.length ? all.times.filter(t => t.planned || liveTrusted(x.sched, x.way.w, x.way.i, t.at)) : all.times).filter(t => !t.planned && t.at > now - 60_000);
    const out = live.map(t => ({ dep: t.at, arr: t.at + ride, live: true }));
    if (x?.way && x.sched?.length) for (const t of departuresAt(x.sched, x.way.w, x.way.i, now - 60_000, 8)) if (!out.some(o => Math.abs(o.dep - t) < 3 * 60_000)) out.push({ dep: t, arr: t + ride, live: false });
    return out.sort((a, b) => a.dep - b.dep).slice(0, 6);
  }
  if (l.mode !== 'tra' && l.mode !== 'hsr') return [];
  const sts = await rail.railStations();
  const near = (pt, max = 800) => new Set(sts.filter(s => s.sys === l.mode && meters(pt.lat, pt.lon, s.lat, s.lon) < max).map(s => s.key));
  const [a, b] = [near(l.from), near(l.to)];
  const lv = l.mode === 'tra' ? await rail.traLive().catch(() => new Map()) : new Map();
  const out = [];
  for (const t of await rail.dayTrips(tw(now).date)) {
    if (t.sys !== l.mode) continue;
    const i = t.stops.findIndex(s => a.has(s.st));
    const j = i >= 0 ? t.stops.findIndex((s, k) => k > i && b.has(s.st)) : -1;
    if (j < 0) continue;
    const delay = (lv.get(String(t.no))?.delay || 0) * 60_000;
    if (t.stops[i].dep + delay < now - 60_000) continue;
    out.push({ dep: t.stops[i].dep, arr: t.stops[j].arr, live: lv.has(String(t.no)), delay: delay / 60_000, train: { sys: t.sys, no: t.no, type: t.type, code: t.code } });
  }
  return out.sort((x, y) => x.dep - y.dep).slice(0, 6);
}
// A train you chose over an earlier one from the same station (a later
// departure picked on the plans card or 交通's 其他班次; 指定車次 marks its
// own): `picked`, kept as chosen. Navigation never moves it to a sooner one
// by itself (the owner, 2026-11-04: a later train picked on purpose, and at
// 竹東 the trip said 「區間 1833 次 18:12 開 比較早到，改搭這班」).
// `others`: the plans it was picked from. → the plan (a copy when marked).
const isRail = l => l?.mode === 'tra' || l?.mode === 'hsr';
// A departure (a rideOptions row) that is the very run a step is timed for:
// the same train by its number, else the same time.
export const sameRun = (o, l) => Boolean(o && l) && Math.abs(o.dep - l.dep) < 60_000 && (!o.train?.no || !l.train?.no || String(o.train.no) === String(l.train.no));
// A train still to come by its own live delay, read from its departures
// (`opts`), whatever the step had heard so far: 區間 1198 16 minutes late at
// 新竹 was taken as missed at 12:56 and "replaced" by itself, 1198 12:54 (Jay
// 2026-11-09). → its delay in minutes, or null (not among them).
export const runDelay = (opts, l) => {
  const o = isRail(l) ? (opts || []).find(x => x.live && sameRun(x, l)) : null;
  return o ? o.delay || 0 : null;
};
export function pickedPlan(p, others = []) {
  let hit = false;
  const legs = (p?.legs || []).map(l => {
    if (!isRail(l) || l.picked || !l.from || l.from.lat == null) return l;
    const earlier = others.some(q => q !== p && q?.legs?.some(x => x !== l && x.mode === l.mode && x.dep < l.dep - 60_000 && x.from?.lat != null && meters(x.from.lat, x.from.lon, l.from.lat, l.from.lon) < 300));
    if (!earlier) return l;
    hit = true;
    return { ...l, picked: true };
  });
  return hit ? { ...p, legs } : p;
}
// A bus or train step moved to another departure (picked, or the one after
// the one missed): its times (a train's number), and what follows it moved
// with it up to the next train (which keeps its time). → the train after it
// it would now miss, or ''.
export function retimeRide(plan, k, opt) {
  const l = plan.legs[k];
  // (What follows moves with when it gets in, not when it leaves: 自強 105 for
  // 普悠瑪 107 leaves 15 minutes later and gets in 33 later; the walk after it
  // had said 09:33 and the trip 晚 19 分. Jay 2026-11-07.)
  const delta = (opt.arr ?? opt.dep) - (l.arr ?? l.dep);
  Object.assign(l, { dep: opt.dep, arr: opt.arr, dur: Math.round((opt.arr - opt.dep) / 1000) });
  if (opt.train) {
    l.train = { ...(l.train || {}), ...opt.train };
    l.short = `${opt.train.type || ''} ${opt.train.no}`.trim();
    delete l.poly;
    delete l.path;
    // (Its line found again for the train it is now: tab-map navDraw.)
    delete l.track;
  }
  let m = k + 1;
  for (; m < plan.legs.length && !(isRide(plan.legs[m]) && plan.legs[m].mode !== 'bus'); m++) Object.assign(plan.legs[m], { dep: plan.legs[m].dep + delta, arr: plan.legs[m].arr + delta });
  plan.arr = plan.legs.at(-1).arr;
  plan.dur = Math.round((plan.arr - plan.dep) / 1000);
  return m < plan.legs.length && plan.legs[m - 1].arr + 60_000 > plan.legs[m].dep ? rideName(plan.legs[m]) : '';
}

// ---- Started (or opened again) half way: the plan put back on today's clock ----
// A trip found where you are on it (tripAt anyTime) but timed for another
// day (a time picked already past rolls to tomorrow; a pinned trip's next
// run): the whole plan moved by whole days to the day you're on it (the
// owner, 2026-10-22: 區間 16:12 on board at 17:18 said "1374 分後").
// → the days moved (0: none).
const DAY_MS = 86_400_000;
export function shiftDays(plan, k, now = Date.now()) {
  const l = plan.legs[k];
  const n = Math.round(((l?.dep ?? plan.dep) - now) / DAY_MS);
  if (!n) return 0;
  const d = -n * DAY_MS;
  for (const x of plan.legs) {
    if (x.dep != null) x.dep += d;
    if (x.arr != null) x.arr += d;
  }
  plan.dep += d;
  plan.arr += d;
  if (plan.deadline) plan.deadline += d;
  return -n;
}
// The train you're on now, between where the leg boards and where it gets
// off: of today's trains of its railway calling at both (that way round),
// the one whose place now (by its timetable with its live delay, TDX's
// station for it when it has one) is nearest you, within 2.5 km (stations on
// a branch line are kilometres apart). → { dep, arr, delay, train } (a
// rideOptions row), or null.
export function trainNow(trips, stations, l, pos, live = new Map(), now = Date.now(), within = 2500) {
  const byKey = new Map(stations.map(s => [s.key, s]));
  const near = pt => new Set(stations.filter(s => s.sys === l.mode && s.lat != null && meters(pt.lat, pt.lon, s.lat, s.lon) < 800).map(s => s.key));
  const [from, to] = [near(l.from), near(l.to)];
  let best = null;
  for (const t of trips) {
    if (t.sys !== l.mode) continue;
    const a = t.stops.findIndex(s => from.has(s.st));
    const b = a >= 0 ? t.stops.findIndex((s, x) => x > a && to.has(s.st)) : -1;
    if (b < 0) continue;
    const lv = live.get(String(t.no));
    const delay = (lv?.delay || 0) * 60_000;
    const st = t.stops.map(s => ({ ...s, p: byKey.get(s.st) }));
    if (st[a].dep + delay > now + 2 * 60_000 || st[b].arr + delay < now - 2 * 60_000) continue;
    // Where it is by the clock: at a station, or part way between two.
    let at = null;
    for (let x = a; x < b && !at; x++) {
      const [s0, s1] = [st[x], st[x + 1]];
      const d0 = (s0.dep ?? s0.arr) + delay, a1 = (s1.arr ?? s1.dep) + delay;
      if (now < d0 && x === a) at = s0.p;
      else if (now >= d0 && now <= a1 && s0.p && s1.p) {
        const f = a1 > d0 ? (now - d0) / (a1 - d0) : 1;
        at = { lat: s0.p.lat + (s1.p.lat - s0.p.lat) * f, lon: s0.p.lon + (s1.p.lon - s0.p.lon) * f };
      } else if (now > a1 && x + 1 < b && now < (s1.dep ?? a1) + delay) at = s1.p;
    }
    at ||= st[b].p;
    if (!at) continue;
    let d = meters(pos.lat, pos.lon, at.lat, at.lon);
    // TDX's own word on where it is: at (or just left) a station near you counts too.
    const ls = lv?.st && byKey.get(lv.st);
    if (ls && t.stops.slice(a, b + 1).some(s => s.st === lv.st)) d = Math.min(d, meters(pos.lat, pos.lon, ls.lat, ls.lon) + 300);
    if (d < within && (!best || d < best.d)) best = { d, opt: { dep: st[a].dep, arr: st[b].arr, live: Boolean(lv), delay: delay / 60_000, train: { sys: t.sys, no: t.no, type: t.type, code: t.code } } };
  }
  return best?.opt || null;
}
// A bus or metro you're on, its times moved so you're where you are now
// (`frac`: how far along the ride, 0–1). → retimeRide's word.
export function retimeAlong(plan, k, frac, now = Date.now()) {
  const l = plan.legs[k];
  const delta = now - (l.dep + Math.max(0, Math.min(1, frac)) * (l.arr - l.dep));
  return retimeRide(plan, k, { dep: l.dep + delta, arr: l.arr + delta });
}

// To be there by a time (a trip planned 抵達 by it: `plan.deadline`): how
// late, in minutes, getting in at `eta`; 0 on time.
export const lateBy = (plan, eta) => (plan.deadline && eta > plan.deadline + 60_000 ? Math.ceil((eta - plan.deadline) / 60_000) : 0);
// plan: a ranked plan; `draw(plan, i)` shows it on the map with leg i lit;
// `follow(pos)` keeps the map on you; `onEnd()` when it's closed; `dest`:
// the place the trip is to (Google's, for its own navigation to it).
const END_MS = 6000;
// A plan started (not opened again) whose own way to its first bus or train
// (a walk, a YouBike) was timed to begin a while ago: begun now, the ride
// keeping its time. Only where you are (GPS) ever puts those steps behind
// you, never the clock (Jay 2026-11-06, 08:48: a plan made minutes before
// started on 搭 快捷8號支 at 公三公園 with him still at home: "I haven't arrived
// and it just broke it all"). A ride missed that way shows as late and the
// usual 趕不上 follows.
export function ownWayNow(plan, now = Date.now()) {
  const r = plan.legs.findIndex(isRide);
  const n = r < 0 ? plan.legs.length : r;
  if (n === 0 || plan.legs[0].dep == null || plan.legs[0].dep >= now - 30_000) return plan;
  const d = now - plan.legs[0].dep;
  const legs = plan.legs.map((l, k) => (k < n ? { ...l, dep: l.dep + d, arr: l.arr + d } : l));
  return { ...plan, legs, dep: legs[0].dep, ...(r < 0 ? { arr: legs.at(-1).arr } : {}) };
}

export function startNav(plan, { box, mini = null, draw, follow, onEnd, onAction = null, here = null, resume = null, push = null, dest = null, swap30 = false }) {
  // Started by a tap (mostly): the iPhone's chime may sound from now on.
  primeBuzz();
  stopNav();
  if (!resume) plan = ownWayNow(plan);
  if (dest?.lat != null && !plan.dest) plan = { ...plan, dest: { name: dest.name || '', lat: dest.lat, lon: dest.lon, ...(dest.gid ? { gid: dest.gid } : {}) } };
  // (`i`: the step shown; `reached`: the furthest step the trip has got to by itself, where you are, the arrivals, getting off: the steps before it are done, never a tap's.)
  const state = { plan, i: 0, reached: 0, phase: 'before', pos: here, live: '', liveAt: new Map(), alerted: -1, wake: null, info: new Map(), push, bikes: null, done: false, ride: new Map(), where: null, next: null, ahead: null, arrAt: null, delay: 0, fresh: 0, offAt: 0, drawn: 0, track: [], paced: null, delayLive: false, away: 0, awayAt: 0, fold: readFold(), min: Boolean(resume?.min), swap30, gen: 0, settled: false, reachedPhase: 'before', lookAt: 0 };
  // The trip as it went, for 除錯紀錄 and replaying it in a test (navTrace).
  // (Seconds from the start with each entry; kept to the last 2000 fixes.)
  const traceAdd = (what, x) => {
    const list = state.trace[what];
    list.push([Math.round((Date.now() - state.trace.t0) / 1000), ...x]);
    if (list.length > 2000) list.splice(0, list.length - 2000);
  };
  const traceSave = () => kit.rec?.('navtrip', state.trace);
  state.traceSave = traceSave;
  state.trace = { v: 1, t0: Date.now(), here: here?.lat != null ? { lat: here.lat, lon: here.lon } : null, resume: resume ? { i: resume.i, phase: resume.phase, reached: resume.reached ?? null } : null, plan: JSON.parse(JSON.stringify(plan)), fixes: [], steps: [], trouble: [] };
  // The buses' official routes, ways and stations, then the lock screen's notices.
  const infos = plan.legs.map((l, k) => (l.mode === 'bus' && l.from?.lat ? busInfo(l).then(x => state.info.set(k, x)).catch(() => {}) : null)).filter(Boolean);
  // (Getting off: when each ride is at the stop before yours, by its stops' times now.)
  const offTimes = () => {
    const out = new Map();
    for (const [k, rs] of state.ride) {
      if (k < state.i || !rs?.stops || !isRide(plan.legs[k])) continue;
      const timeOf = k === state.i && state.phase === 'on' ? navStopAt : plannedAt(plan.legs[k], rs);
      const at = timeOf(Math.max(rs.i, rs.j - 1));
      if (at != null) out.set(k, at);
    }
    return out;
  };
  const notices = () => {
    if (nav !== state || !push) return;
    const off = offTimes();
    state.offSent = off.get(state.i) ?? null;
    push(navNotices(plan, state.i, state.info, Date.now(), off));
  };
  // (On board, the times moved a minute or more since: the notice again.)
  const noticesIfMoved = () => {
    if (state.phase !== 'on') return;
    const at = offTimes().get(state.i);
    if (at != null && (state.offSent == null || Math.abs(at - state.offSent) >= 60_000)) notices();
  };
  Promise.all(infos).then(notices);
  nav = state;
  state.box = box;
  box.hidden = false;
  box.className = 'ot-nav';
  const render = () => {
    if (nav !== state) return;
    const now = Date.now();
    state.drawn = now;
    const last = plan.legs.length - 1;
    const l = plan.legs[state.i];
    const ride = isRide(l);
    const on = ride && state.phase === 'on';
    const rs = ride ? state.ride.get(state.i) : null;
    const t = stepText(plan, state.i, state.phase);
    // (A step looked ahead to: the trip's times still from the step you're at,
    // where you are; never that step as if you set out on it from here: Jay
    // 2026-11-07, on 自強 116 the walk to 墨竹亭 said 34.8 公里 and 21:29.)
    const ahead = state.i > state.reached;
    const at = ahead ? state.reached : state.i;
    const atPhase = ahead ? state.reachedPhase || 'before' : state.phase;
    const atOn = isRide(plan.legs[at]) && atPhase === 'on';
    const atRs = atOn ? state.ride.get(at) : null;
    const times = navTimes(plan, at, atPhase, state.pos, state.liveAt, now, atOn ? (state.arrAt ?? (atRs ? state.paced?.get(atRs.j) : null) ?? null) : null);
    const pace = state.done ? { text: W(`${hm(now)} 抵達`, `Arrived ${hm(now)}`), tone: 'good' } : paceOf(plan, state.i, state.phase, times, state.liveAt, now, state.live);
    // What's left: along its road when it has one (where you are on it), else as the crow flies.
    // (A step looked ahead to: its own length, from its own start.)
    const left = ahead ? (l.to?.lat != null && l.from?.lat != null ? (l.dist ?? Math.round(meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon) * 1.3)) : null) : state.pos && l.to?.lat ? (state.leftAlong ?? meters(state.pos.lat, state.pos.lon, l.to.lat, l.to.lon)) : null;
    let title = state.done ? W(`已抵達 ${plan.legs.at(-1).to?.name || '目的地'}`, `Arrived at ${plan.legs.at(-1).to?.name || 'your destination'}`) : t.title;
    let sub = state.done ? (plan.then?.length ? W(`接著去 ${plan.then[0].name || '下一站'}`, `Next: ${plan.then[0].name || 'the next stop'}`) : '') : t.sub;
    // On a bike with the timer running: how long you've had it (and with TPASS, the free minutes left).
    // (A line of its own under the step, amber the last 5 free minutes, red past them.)
    const rent = l.mode === 'bike' && !state.done && state.i <= state.reached ? rental() : null;
    const rms = rent ? now - rent.at : 0;
    // From 25 minutes on, with more than a few minutes still to ride: the
    // stations near you to return it at and take another, a tap away
    // (buzzed once; the owner, 2026-11-03).
    const rideLeft = rent && state.pos && l.to?.lat != null ? rideSec(meters(state.pos.lat, state.pos.lon, l.to.lat, l.to.lon), l.ebike) : 0;
    const swapNow = Boolean(rent && state.swap30 && rms >= WARN_MS && rms < FREE_MS + 30 * 60_000 && rideLeft > 3 * 60);
    if (swapNow && state.swapBuzz !== rent.at) {
      state.swapBuzz = rent.at;
      buzz();
    }
    const rentLine = rent ? `<div class="ot-nav-rent${state.swap30 ? (rms >= FREE_MS ? ' over' : rms >= FREE_MS - 5 * 60_000 ? ' warn' : '') : ''}">${icon('bike')}<span>${W(`已騎 ${Math.floor(rms / 60_000)} 分`, `Ridden ${Math.floor(rms / 60_000)} min`)}${state.swap30 ? (rms < FREE_MS ? W(`・免費剩 ${Math.ceil((FREE_MS - rms) / 60_000)} 分`, `・${Math.ceil((FREE_MS - rms) / 60_000)} min free left`) : W('・已超過免費 30 分', '・past the free 30 min')) : ''}</span>${swapNow ? `<button class="ot-nav-gm" type="button" data-nav="swapdock">${icon('dock')}${W('附近換車', 'Swap nearby')}</button>` : ''}</div>` : '';
    // Yours the next stop (ringNow): the card turned round to say so.
    const offNext = on && !state.done && (rs && state.next != null ? ringNow(rs, state.next) : left != null && left < NEXT_STOP_M);
    if (offNext) {
      title = W(`下一站 ${shown(l.to.name)} 下車`, `Get off next: ${shown(l.to.name)}`);
      sub = l.mode === 'bus' ? W('按下車鈴，準備下車', 'Press the bell') : W('準備下車', 'Get ready');
    }
    // The bus or train at your stop now.
    const w = ride && !on && !state.done ? state.where : null;
    const coming = Boolean(w && w.away === 0 && (l.mode === 'bus' ? w.in <= 60 : w.at));
    if (coming) {
      title = l.mode === 'bus' ? W(`${rideName(l)} 進站了`, `${rideName(l)} is here`) : W(`${rideName(l)} 在月台上`, `${rideName(l)} at the platform`);
      sub = l.mode === 'bus' ? `${W('招手上車', 'Wave it down')}${wayText(l) ? `・${wayText(l)}` : ''}` : t.sub;
    }
    // The big number on the right: what's left of a walk or ride; on board, the stops to go; else the countdown to the bus or train.
    let big = '';
    let cd = '';
    if (state.done) big = '';
    else if (!ride && left != null) big = distBig(left);
    else if (on && rs && state.next != null) big = `<b>${rs.j - state.next + 1}</b><small>${W('站', 'stops')}</small>`;
    else if (on && left != null) big = distBig(left);
    else if (ride) {
      const at = state.liveAt.get(state.i) ?? l.dep;
      const what = l.mode === 'bus' ? W('後到站', 'to arrival') : W('後開車', 'to departure');
      cd = ` data-cd="${at}" data-k="${what}" data-nav="times" role="button" aria-label="${W('改搭別班', 'Another departure')}"`;
      big = countBig(at - now, what);
    }
    // Where the bus or train is (coming to you), or the stops to go (on it).
    // Your stop the first of its way (藍線1區 at 火車站): no bus on its way to show; it sets out from here.
    const origin = ride && !on && !state.done && !coming && !w && rs && rs.i === 0 ? `<div class="ot-track"><div class="ot-track-say"><span>${l.mode === 'bus' ? W('起點站：公車從這裡發車', 'First stop: the bus starts here') : W('起點站：列車從這裡發車', 'First station: the train starts here')}</span></div></div>` : '';
    const track = w && rs && !coming ? trackHtml(rs, w, l) : origin;
    const board = on && rs && state.next != null && !state.done ? boardHtml(rs, state.next, state.ahead, state.delay, times.end[state.i], state.paced, state.delayLive, navStopAt) : '';
    // YouBike where you take it and leave it, now: bikes (or none, and the nearest that has some), docks.
    const bikeLine = state.done ? '' : bikesText(state.bikes, plan, state.i, state.pos);
    // A walk or a ride of your own: Google's or Apple's turn-by-turn for it (walking, cycling), from where you are.
    const own = !state.done && !isRide(l) && l.to?.lat != null;
    // (From where you are on the step you're at; one looked ahead to, from its own start.)
    const gm = own ? mapsLink(legEnd(plan, state.i), l.mode === 'bike' ? 'bicycling' : 'walking', state.i > state.reached ? l.from : null) : '';
    // (The title already names where: here only when, one line beside the maps button.)
    const paceText = pace.text || (own ? W(`約 ${hm(times.end[state.i])} 抵達`, `there ~${hm(times.end[state.i])}`) : '');
    // Late for the bus or train ahead (hurrying can't make it): the one card
    // of what to do instead (trouble.mjs), asked once for that run.
    const late = !state.done && pace.tone === 'bad';
    const ra = rideOf(plan, state.i);
    if (late && ra >= state.i) queueMicrotask(() => askMiss(ra, false));
    // (Made it after all, not taken yet: the question goes.)
    else if (state.trouble?.kind === 'miss' && !state.trouble.taken && state.trouble.k === ra) state.trouble = null;
    // On a YouBike to a stop with more after it: keep it or return it there (parkAsk).
    // (Asked in the last 5 minutes of the ride, not all the way.)
    const pa = !state.done && state.i === state.reached && left != null && rideSec(left, l.ebike) <= 5 * 60 ? parkAsk(plan, state.i) : null;
    const park = pa ? `<div class="ot-nav-ask ot-nav-late"><span><b>${W('到了要還車嗎？', 'Return it there?')}</b><small>${e(pa.text)}</small></span><button type="button" data-nav="park">${W('停著', 'Keep')}</button><button type="button" data-nav="return">${W('還車', 'Return')}</button></div>` : '';
    // Whatever went wrong, one card (trouble.mjs): on board and off its way
    // (another bus at speed, got off at a walk), heading away from it all, or
    // what was set (missed, late, no bikes, the wrong ride).
    const strayed = on && !state.done && state.away >= 2 && now - state.awayAt >= AWAY_MS;
    const tr = state.done ? null : strayed ? { kind: offKind(state.fixes, state.posAt) } : troubleNow(now) || (!on && state.lost && state.i === state.reached ? { kind: 'lost' } : null);
    const trouble = troubleHtml(tr, now, plan.deadline || 0);
    const shownNow = trouble ? tr.kind : null;
    if (shownNow && shownNow !== state.shownTrouble) {
      traceAdd('trouble', [shownNow]);
      traceSave();
    }
    state.shownTrouble = shownNow;
    const ri = rideOf(plan, state.i);
    const liveNow = !state.done && ri >= state.i && state.fresh && now - state.fresh < 75_000;
    // Off a bus or train a moment ago: said, with what's next.
    const prev = plan.legs[state.i - 1];
    const off = !state.done && state.swap && now - state.swap.at < 180_000 && !(trouble && state.swap.miss) ? `<div class="ot-nav-off">${icon('clock')}<span>${e(state.swap.text)}</span></div>` : !state.done && state.offAt && now - state.offAt < 120_000 && isRide(prev) ? `<div class="ot-nav-off">${icon('pin')}<span>${W(`已在 ${e(prev.to?.name || '')} 下車`, `Got off at ${e(prev.to?.name || '')}`)}</span></div>` : '';
    // On board: what comes after you get off.
    const nx = on && !state.done && state.i < last ? plan.legs[state.i + 1] : null;
    const then = nx ? `<div class="ot-nav-then"><small>${W('下車後', 'Then')}</small>${icon(nx.mode)}<span>${e(stepText(plan, state.i + 1, 'before').title)}${isRide(nx) ? `・${e(hm(state.liveAt.get(state.i + 1) ?? nx.dep))} ${nx.mode === 'bus' ? W('到站', 'due') : W('開', 'leaves')}` : `・${e(minsText(nx.dur))}`}</span></div>` : '';
    const chips = plan.legs
      // (A step the trip has got past by itself is done: shown, never tapped back to; one you only
      // looked ahead past stays a tap away; the owner, 2026-10-13.)
      .map((x, k) => `<button class="ot-nav-chip${k < state.reached ? ' done' : k === state.i ? ' on' : ''}" type="button"${k < state.reached ? ' disabled' : ` data-nav-go="${k}"`} style="--c:${e(legColor(x))}">${icon(x.mode)}<span>${e(chipText(x))}</span></button>`)
      .join('') +
      // (The stretches after each stop, as they're planned: the whole trip in one row.)
      (plan.later || []).map((q, n) => `<span class="ot-nav-chip stop">${icon('pin')}<span>${e(shortPlace([plan.dest, ...(plan.then || [])][n]?.name || ''))}</span></span>${q.legs.map((x, j) => `<button class="ot-nav-chip later" type="button" data-nav-peek="${n}:${j}" style="--c:${e(legColor(x))}">${icon(x.mode)}<span>${e(chipText(x))}</span></button>`).join('')}`).join('');
    // (A trip with stops: there at the next stop, how long till then.)
    // (A trip with stops: the time is when you're at the next stop, the one you're
    // heading for now; after it, how long you stay is yours (Jay 2026-11-07:
    // "full trip length should be about when I arrive my first stop so it's more real").
    const whole = times.eta;
    const minsLeft = Math.max(0, Math.round((whole - now) / 60_000));
    const stopName = plan.later?.length ? stopShort(plan.dest?.name || l.to?.name || '') : '';
    // Later or sooner than the plan said, by what's live now.
    // (Only while a bus or train is still ahead: the rest by bike or on foot is at your own pace, nothing to be early or late for.)
    const drift = state.done || !plan.legs.slice(state.i).some(isRide) ? 0 : Math.round((times.eta - plan.arr) / 60_000);
    const driftText = Math.abs(drift) >= 2 ? `<em class="${drift > 0 ? 'bad' : 'good'}">${drift > 0 ? W(`晚 ${drift} 分`, `${drift} min late`) : W(`早 ${-drift} 分`, `${-drift} min early`)}</em>` : '';
    const fold = state.fold;
    const topHtml = `<div class="ot-nav-top${offNext ? ' alert' : ''}${coming ? ' coming' : ''}${on ? ' aboard' : ''}${fold.top ? ' folded' : ''}" style="--c:${e(legColor(l))}">
        ${off}${trouble}${park}
        <div class="ot-nav-main">
          <span class="ot-nav-i">${icon(state.done ? 'pin' : offNext ? 'bell' : l.mode)}</span>
          <div class="ot-nav-text"><b>${titleHtml(title, plan)}</b>${sub ? `<small>${e(sub)}</small>` : ''}</div>
          ${big ? `<span class="ot-nav-big"${cd}>${big}</span>` : ''}
        </div>
        ${rentLine}
        ${fold.top ? '' : `${track}${board}`}
        ${(paceText || gm) && !(board && !fold.top && !state.live && !late) ? `<div class="ot-nav-pace ${pace.text ? pace.tone : ''}${liveNow ? ' live' : ''}">${liveNow ? '<i class="ot-nav-dot"></i>' : icon(pace.tone ? 'live' : 'clock')}<span class="ot-nav-pt">${paceText.split('・').map(x => `<span>${e(x)}</span>`).join('')}</span>${late && !trouble ? `<button class="ot-nav-gm" type="button" data-nav="replan">${icon('route')}${W('重新規劃', 'Replan')}</button>` : gm ? `<a class="ot-nav-gm" href="${e(gm)}" target="_blank" rel="noopener">${icon('route')}${mapsName()}</a>` : ''}</div>` : ''}
        ${bikeLine && !fold.top ? `<div class="ot-nav-bikes">${bikeLine}</div>` : ''}
        ${fold.top ? '' : then}
        ${grip('top', fold.top)}
      </div>`;
    const etaHtml = `<div class="ot-nav-eta">
          <span><b>${e(hm(state.done && !plan.later?.length ? now : whole))}</b><small>${state.done && !plan.later?.length ? W('已抵達', 'Arrived') : plan.later?.length ? `${driftText ? `${driftText}・` : ''}${W(`到 ${e(stopName)} 還要 `, `${e(stopName)} in `)}${leftText(minsLeft)}` : driftText ? `${driftText}・${W('剩 ', '')}${leftText(minsLeft)}` : `${W('抵達・還要 ', 'arrive・')}${leftText(minsLeft)}`}</small></span>
          <button class="q-icon-btn" type="button" data-nav="more" aria-label="${W('更多：縮小、改下車站、重新規劃、改目的地', 'More: shrink, change stop, replan, change destination')}">${icon('more')}</button>
          <button class="q-btn ot-nav-end" type="button" data-nav="end">${W('結束', 'End')}</button>
        </div>`;
    // Drawn in place: the card's parts each time, the steps only when they change.
    if (!box.querySelector(':scope > .ot-nav-bottom')) box.innerHTML = `<div class="ot-nav-topw"></div><div class="ot-nav-bottom"><div class="ot-nav-gripw"></div><div class="ot-nav-etaw"></div><div class="ot-nav-chips" role="group" aria-label="${W('步驟', 'Steps')}"></div></div>`;
    const bottom = box.querySelector(':scope > .ot-nav-bottom');
    bottom.classList.remove('folded');
    bottom.querySelector('.ot-nav-gripw').innerHTML = '';
    box.querySelector('.ot-nav-topw').innerHTML = topHtml;
    box.querySelector('.ot-nav-etaw').innerHTML = etaHtml;
    const row = box.querySelector('.ot-nav-chips');
    if (row._html !== chips) {
      row.innerHTML = chips;
      row._html = chips;
    }
    // One row of steps, scrolled to keep the one you're at in view, a step before it showing (the owner, 2026-10-22: two rows weren't good).
    if (row._on !== state.i) {
      row._on = state.i;
      const on = row.querySelector?.('.ot-nav-chip.on');
      if (on && row.scrollTo) row.scrollTo({ left: Math.max(0, on.offsetLeft - row.offsetLeft - 44), behavior: row._seen ? 'smooth' : 'auto' });
      row._seen = true;
    }
    // The cards' heights changed (stops came in, a fold): the map fits the room left.
    const hs = `${box.querySelector('.ot-nav-top')?.offsetHeight}|${bottom.offsetHeight}`;
    if (hs !== state.cardHs) {
      state.cardHs = hs;
      onAction?.('cards');
    }
    // The bar on every other tab (and the map, shrunk): the step, its number, live; a tap goes back.
    if (mini)
      mini.innerHTML = `<button class="ot-nav-mini-b${offNext ? ' alert' : ''}${coming ? ' coming' : ''}" type="button" data-nav="open" style="--c:${e(legColor(l))}" aria-label="${W('回到導航', 'Back to navigation')}">
          <span class="ot-nav-i">${icon(state.done ? 'pin' : offNext ? 'bell' : l.mode)}</span>
          <span class="ot-nav-mini-t"><b>${e(title)}</b><small>${liveNow ? '<i class="ot-nav-dot"></i>' : ''}${e(paceText || sub || '')}</small></span>
          ${big ? `<span class="ot-nav-mini-big"${cd}>${big}</span>` : ''}
        </button>`;
  };
  const go = (i, phase = 'before', off = false) => {
    state.i = Math.max(0, Math.min(plan.legs.length - 1, i));
    state.phase = phase;
    state.live = '';
    state.where = null;
    state.next = null;
    state.ahead = null;
    state.arrAt = null;
    state.delay = 0;
    state.fresh = 0;
    state.offAt = off ? Date.now() : 0;
    // (Off a bus or train by the map: watched a while for still being on it.)
    // (`j`: the stop taken as off at, when it isn't the plan's: stayed on past it.)
    state.passed = off && isRide(plan.legs[state.i - 1]) ? { k: state.i - 1, at: Date.now(), j: state.offJ ?? null } : null;
    state.track = [];
    state.paced = null;
    state.away = 0;
    state.awayAt = 0;
    state.leftAlong = null;
    state.offWay = 0;
    state.delayLive = false;
    state.done = false;
    state.boarding = null;
    state.offJ = null;
    saveNav(state);
    draw(plan, state.i);
    render();
    refreshLive();
    notices();
    boarded();
  };
  // The trip moving you on (or back on a ride you stayed on) by itself:
  // that step is where you've got to. (A tap only shows a step: go.)
  const reach = (i, phase = 'before', off = false) => {
    traceAdd('steps', [i, phase]);
    const was = state.reached;
    state.reached = Math.max(0, Math.min(plan.legs.length - 1, i));
    state.reachedPhase = phase;
    state.look = null;
    state.lookAt = 0;
    // (Steps passed on the way, the phone locked between them: a bike given back there is ended too.)
    for (let k = was + 1; k < state.reached; k++) if (rentalStep(plan, k) === 'end' && rental()) endRental();
    bikeTimer(state.reached);
    go(i, phase, off);
  };
  // On board, said by two fixes: the second further along its way than the
  // first (one fix on the bus's road while walking to the stop, or a jump, isn't a ride).
  const aboard = (k, d) => {
    const b = state.boarding;
    if (b?.k === k && d > b.d + 30) return true;
    state.boarding = { k, d: b?.k === k ? Math.min(b.d, d) : d };
    return false;
  };
  // Off the ride only near where you get off along its own way (a one-way
  // pair or a loop passes close to the stop long before), as far as you've
  // got on it (a fix at the stop missed still counts); `away`: or once
  // you've left its way. Its stops not known: `guess`.
  const offEnd = (p, k, guess, away = false) => {
    const rs = state.ride.get(k);
    if (!rs?.stops?.length) return guess;
    rs.cum ||= routeCum(rs.stops);
    const from = Math.max(0, rs.i - 1);
    if (away && offRide(rs.stops, p, rs.cum, from, legPts(plan.legs[k])) > 250) return true;
    const a = alongRoute(rs.stops, p, rs.cum, from);
    const got = Math.max(a?.d ?? 0, ...state.track.map(x => x.d));
    return got >= rs.cum[state.offJ ?? rs.j] - (OFF_M[plan.legs[k].mode] || 120);
  };
  // YouBike's timer kept by the trip itself: at the station, the bike's ride
  // starts it (換一台 starts it over); walking on from a bike returned ends
  // it. Once a step (a step seen again, a relaunch: not started over).
  const bikeTimer = i => {
    const what = rentalStep(plan, i);
    const key = `${plan.dep}:${i}`;
    if (what === 'start' && rental()?.key !== key) {
      const l = plan.legs[i];
      startRental(l.rent || l.from, Date.now(), key);
    } else if (what === 'end' && rental()) endRental();
  };
  // What's live: the ride to catch (this step's, or the next one's) — a bus,
  // when it really comes to the stop at the time you'll be there and where it
  // is now; a train, its delay and where it is — or, on board, when it's at
  // each stop to go; and the YouBike stations of the ride coming up.
  const refreshLive = async () => {
    const at = state.i;
    const ri = rideOf(plan, state.i);
    const l = ri >= state.i ? plan.legs[ri] : null;
    const on = ri === state.i && state.phase === 'on';
    let live = '';
    let where = null;
    try {
      // Its stops, once: a bus's way (its official route first), a train's run today.
      if (l?.mode === 'bus' && l.from?.lat && !state.info.has(ri)) state.info.set(ri, await busInfo(l).catch(() => ({ leg: l })));
      if (l && !state.ride.has(ri)) {
        const had = l.train?.no;
        const g = state.gen;
        const rs = await rideStops(l, state.info.get(ri)).catch(() => null);
        if (state.gen !== g || nav !== state) return;
        state.ride.set(ri, rs);
        // A ride the planner gave no shape: drawn through its stops (not a straight line across town).
        const noShape = rs && !l.poly && !l.path;
        if (noShape) l.path = rs.stops.slice(rs.i, rs.j + 1).filter(x => x.lat != null).map(x => [x.lat, x.lon]);
        if ((!had && l.train?.no) || noShape) saveNav(state);
        // (Its stops on the map now: not left to the next step.)
        if (nav === state) draw(plan, state.i);
      }
      const rs = l ? state.ride.get(ri) : null;
      // On it already (opened again on board): the next stop from where you were last seen, not only on the next move.
      if (on && rs && state.next == null && state.pos && state.i === at) state.next = nextStop(rs.stops, rs.i, rs.j, state.pos);
      if (l?.mode === 'bus' && l.from?.lat) {
        const x = state.info.get(ri);
        const eta = x?.route ? await routeEta(x.route, x.way?.w.dir ?? x.leg?.route?.dir ?? null).catch(() => null) : null;
        if (on) {
          // On it: when it's at each stop to go, yours too.
          const ahead = rs && eta && state.next != null ? busAhead(rs.stops, state.next, rs.j, eta) : null;
          if (state.i === at) {
            state.ahead = ahead;
            state.arrAt = ahead?.get(rs.j) ?? null;
            // (Your own pace on it counts as live too.)
            state.fresh = ahead?.size ? Date.now() : state.paced ? state.fresh : 0;
          }
        } else {
          // Its official route and way (a planner's name, both ways and every
          // branch of a line were mixed in), and only buses in service (one
          // resting at the terminal with its tracker on isn't coming).
          const all = liveTimes(await etaAround(l.from.lat, l.from.lon, 150), x.leg.short || x.leg.name, Date.now(), x.leg.route?.uid ? { routeUID: x.leg.route.uid, dir: x.leg.route.dir } : {});
          const times = x.way && x.sched?.length ? all.times.filter(t => t.planned || liveTrusted(x.sched, x.way.w, x.way.i, t.at)) : all.times;
          const off = all.off;
          // When you'll be at the stop.
          const ready = ri === state.i ? Date.now() : navTimes(plan, state.i, state.phase, state.pos, new Map(), Date.now()).ready.get(ri);
          const next = times.find(x => x.at >= ready - 60_000) || null;
          const soon = times.find(x => x.at > Date.now() - 30_000);
          if (next) state.liveAt.set(ri, next.at);
          else state.liveAt.delete(ri);
          // None you'll be there for, and the very bus this ride was timed for
          // is coming sooner than you can be at its stop (its timetable's
          // 17:30 due at 17:22, you there at 17:26): it's gone for you, said
          // so, the next one taken, a YouBike ahead of it offered (the
          // owner, 2026-11-03: the stop said 2 分, the trip still "hurry").
          const seen = times.filter(t => !t.planned).map(t => t.at);
          const was = !next && ri > state.i && seen.length && state.gone !== `${ri}|${l.dep}` ? seenAt(x.sched, x.way?.w, x.way?.i, seen, l.dep, Date.now()) : null;
          if (was != null && pastHurry(ready - was, ready - Date.now())) {
            state.gone = `${ri}|${l.dep}`;
            state.liveAt.set(ri, was);
            queueMicrotask(() => goneBus(ri, x, was, ready, seen));
          }
          live = next
            ? `${next.planned ? W('預計', 'planned') : W('即時', 'live')}${next.last ? W('・末班', '・last') : ''}`
            : soon
              ? W(`下一班 ${Math.max(0, Math.round((soon.at - Date.now()) / 60_000))} 分後到站，可能趕不上`, `Next due in ${Math.max(0, Math.round((soon.at - Date.now()) / 60_000))} min, may be missed`)
              : off === 3 ? W('末班已過', 'Last one gone') : off === 4 ? W('今日未營運', 'Not running today') : '';
          // Where that bus is now: only when the route's estimates are of the same bus.
          const bw = rs && eta && next && !next.planned ? busWhere(rs.stops, rs.i, eta) : null;
          if (bw && Math.abs(Date.now() + bw.sec * 1000 - next.at) < 120_000) where = bw;
          state.fresh = next && !next.planned ? Date.now() : 0;
        }
      } else if (l?.mode === 'tra' && l.train?.no) {
        const lv = (await rail.traLive()).get(String(l.train.no)) || null;
        const d = lv?.delay || 0;
        if (lv) {
          state.liveAt.set(ri, l.dep + d * 60_000);
          state.delay = d;
          state.delayLive = true;
          state.fresh = Date.now();
          if (on) state.arrAt = l.arr + d * 60_000;
        }
        live = lv ? (d ? W(`晚 ${d} 分`, `${d} min late`) : W('準點', 'on time')) : '';
        if (!on && rs) where = trainWhere(rs.stops, rs.i, lv);
      } else if (l?.mode === 'hsr' && rs && !on) where = trainByTime(rs.stops, rs.i);
    } catch {}
    // The YouBike ride coming up (this step's, or after the walk to it): its two stations as they are now.
    const bi = bikeAhead();
    if (bi >= 0) {
      try {
        const bl = plan.legs[bi];
        const [a, b] = await Promise.all([bikesAround(bl.from.lat, bl.from.lon), bikesAround(bl.to.lat, bl.to.lon)]);
        const at = (list, pt) => list.find(s => meters(pt.lat, pt.lon, s.lat, s.lon) < 60) || null;
        state.bikes = { ...(state.bikes?.k === bi ? state.bikes : {}), k: bi, rent: at(a, bl.from), ret: at(b, bl.to) };
      } catch {}
    } else state.bikes = null;
    if (state.i === at) {
      const was = state.where;
      state.where = ri === state.i ? where : null;
      state.live = live;
      // The bus pulling in, the train at the platform: a buzz, once.
      if (state.where && state.where.away === 0 && !(was && was.away === 0) && (l.mode === 'bus' ? state.where.in <= 60 : state.where.at)) buzz();
      render();
      missed();
      noticesIfMoved();
    }
  };
  // There (arrival: checked with every position and every 10 s, as a phone
  // standing still sends few); then the card says so and, 6 s on, ends (finish).
  const arrive = () => {
    const l = plan.legs[state.i];
    const p = state.pos;
    if (state.done || !p || state.i !== plan.legs.length - 1 || isRide(l) || l.to?.lat == null) return;
    const to = Math.min(meters(p.lat, p.lon, l.to.lat, l.to.lon), plan.dest?.lat != null ? meters(p.lat, p.lon, plan.dest.lat, plan.dest.lon) : Infinity);
    const a = arrival(state.near, p, to, state.leftAlong);
    state.near = a.near;
    if (!a.done) return;
    state.done = true;
    // (There on the bike: returned at the last station.)
    if (l.mode === 'bike' && !l.park && rental()) endRental();
    buzz();
    push?.([]);
    dropNav();
    state.doneAt = Date.now();
    state.endTimer = setTimeout(finish, END_MS);
  };
  // Ended a few seconds after 已抵達 (it waited 20 s, and with the phone
  // locked or the app away its timer waited too: the owner, 2026-10-16, there
  // and still navigating); checked again each second and on coming back.
  const finish = () => {
    if (nav !== state || !state.done) return;
    stopNav();
    const l = plan.legs.at(-1);
    onEnd?.({ arrived: plan.dest?.name || l.to?.name || W('目的地', 'destination'), plan });
  };
  const moved = p => {
    traceAdd('fixes', [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6, Math.round(p.acc ?? 0)]);
    // An old fix handed over as new (an iPhone back from the background, the
    // last one it had: api.mjs `at`) moves nothing: you're not where you were
    // (Jay 2026-11-07: on 普悠瑪 107 past 香山, his fix at 新竹 from before
    // took him for still there, missed it, waiting for 自強 105).
    if (p.at != null && Date.now() - p.at > STALE_FIX_MS) return;
    // A rough fix (a cell tower's, 100 m and more out) moves the dot, never
    // the trip; but for a bus or train you were waiting for, one further from
    // its stop than its own error could put you counts: pulled out (the
    // owner, 2026-10-29: on a train that left a little late, the trip said
    // missed and stayed there; in a train a phone's fixes are often rough).
    const w = plan.legs[state.i];
    const pulled = isRide(w) && state.phase === 'before' && state.i === state.reached && p.acc <= 500 && w.from?.lat != null && meters(p.lat, p.lon, w.from.lat, w.from.lon) > p.acc + 200;
    // (Rough fixes still say the watch is alive: never started over for them.)
    if (p.acc > 100) state.roughAt = Date.now();
    state.silentMs = SILENT_MS;
    if (p.acc > 100 && !pulled) return follow?.(p);
    state.pos = p;
    state.posAt = Date.now();
    follow?.(p);
    if (p.acc <= 100) state.fixes = [...(state.fixes || []).filter(x => x.t > state.posAt - 150_000), { lat: p.lat, lon: p.lon, t: state.posAt }];
    // (No fix when it started: where you are on the trip found with the first.)
    if (!state.settled) settle(p);
    // Looked ahead while on a ride: it's still followed; your stop next, back
    // on it (and buzzed); nothing else moves the trip meanwhile.
    if (state.look && state.i > state.reached) {
      const k = state.reached;
      const l0 = plan.legs[k];
      const rs = state.ride.get(k);
      if (rs ? ringNow(rs, nextStop(rs.stops, rs.i, rs.j, p)) : l0.to?.lat != null && meters(p.lat, p.lon, l0.to.lat, l0.to.lon) < NEXT_STOP_M) {
        state.look = null;
        go(k, 'on');
      } else return render();
    }
    // Taken as off at your stop, but still going along the bus's (or train's)
    // way, 300 m and more past it: you stayed on. Back on it, off at the next
    // stop, the rest planned from there (the owner, 2026-10-13).
    const sp = state.passed;
    if (sp && state.i === sp.k + 1 && Date.now() - sp.at < 6 * 60_000) {
      const rs = state.ride.get(sp.k);
      const j = sp.j ?? rs?.j;
      if (rs?.stops?.length && j < rs.stops.length - 1) {
        rs.cum ||= routeCum(rs.stops);
        const a = alongRoute(rs.stops, p, rs.cum, j);
        // (At a ride's speed, 8 km/h and more since: walking on along its road isn't staying on.)
        const fast = a && (a.d - rs.cum[j]) / Math.max(1, (Date.now() - sp.at) / 1000) > 2.2;
        const k = a && a.off < 120 && a.d > rs.cum[j] + 300 && fast ? rs.cum.findIndex((c, x) => x > j && c > a.d + 50) : -1;
        if (k > 0) {
          const was = rs.stops[j].name;
          state.passed = null;
          reach(sp.k, 'on');
          // (Off at that stop now, not the one passed, till the rest is planned from it: never back and forth.)
          state.offJ = k;
          return onAction?.('stayed', { k, was, stop: rs.stops[k] });
        }
      }
    } else if (sp) state.passed = null;
    // Moved on to a later step already (its start reached, or this one's end
    // missed): there at once, off the bus or train if that's where you were.
    const on = tripAt(plan, p, state.i);
    const riding = state.phase === 'on' && isRide(plan.legs[state.i]);
    if (on && (on.i > state.i || (on.phase === 'on' && state.phase !== 'on')) && (on.phase !== 'on' || (on.i === state.i && riding) || aboard(on.i, on.d)) && (!riding || on.i === state.i || offEnd(p, state.i, true, true))) {
      if (on.i === state.i) {
        state.phase = 'on';
        if (state.i === state.reached) state.reachedPhase = 'on';
        traceAdd('steps', [state.i, 'on']);
        state.where = null;
        saveNav(state);
        draw(plan, state.i);
        refreshLive();
        boarded();
      } else return reach(on.i, on.phase, isRide(plan.legs[on.i - 1]) && state.i === on.i - 1);
    }
    // Gone your own way (another station's bike, straight on to the
    // station): on the step you're really on, said; going away from all of
    // it, asked to plan again from here.
    if (state.i === state.reached && !state.done) {
      const op = offPlan(plan, state.i, state.fixes, state.posAt);
      state.lost = Boolean(op?.lost);
      if (op?.i != null) {
        state.fixes = [];
        const to = op.why === 'bike' ? plan.legs[op.i].to : plan.legs[op.i + 1] && isRide(plan.legs[op.i + 1]) ? plan.legs[op.i + 1].from : plan.legs[op.i].to;
        const name = shortPlace(to?.name || '') || W('下一站', 'the next stop');
        state.swap = { at: Date.now(), text: op.why === 'bike' ? W(`已騎上 YouBike，往 ${name}`, `On a YouBike, to ${name}`) : W(`改走去 ${name}`, `Walking to ${name} instead`) };
        return reach(op.i, op.phase);
      }
      // On a bus or train that isn't the one planned: at its stop a while
      // ago, now moving at a ride's pace away from it and off its way.
      const rk = rideOf(plan, state.i);
      const rl = rk >= state.i && !(rk === state.i && state.phase === 'on') ? plan.legs[rk] : null;
      if (rl?.from?.lat != null) {
        if (meters(p.lat, p.lon, rl.from.lat, rl.from.lon) < 150) state.nearAt = { k: rk, t: state.posAt };
        const pts = legPts(rl);
        const a = pts && alongRoute(pts, p, routeCum(pts));
        const onWay = Boolean(a && a.off < (ON_WAY[rl.mode] || 80));
        const key = `wrong|${rk}`;
        if (state.troubleNo !== key && state.trouble?.kind !== 'wrong' && wrongRide(rl, state.fixes, state.nearAt?.k === rk ? state.nearAt.t : 0, onWay, state.posAt)) {
          state.trouble = { kind: 'wrong', k: rk, key, at: state.posAt };
          kit.rec?.('wrong', { ride: rideName(rl), fixes: (state.fixes || []).slice(-12) });
          buzz();
        }
      }
    }
    // Checked again now and then by where you are alone, as when the app is
    // opened half way (a train boarded that left late, already at a later
    // stop): never stuck where the trip thought you were till it's opened again.
    if (state.settled && !state.syncing && state.i === state.reached && !(isRide(w) && state.phase === 'on') && state.posAt - (state.syncAt || 0) >= 20_000) {
      state.syncAt = state.posAt;
      state.syncing = true;
      locate(p, true).finally(() => (state.syncing = false));
    }
    // Looked ahead from a walk, a bike ride or a stop: that step is only
    // shown, never redrawn from where you are nor taken as begun; there at
    // the end of the one you're at, on to the next (the owner, 2026-10-28:
    // the YouBike step looked at while walking to it, its ride was redrawn
    // from him and its station said 這站沒車).
    if (state.i > state.reached) {
      const l0 = plan.legs[state.reached];
      if (!isRide(l0) && l0.to?.lat != null && meters(p.lat, p.lon, l0.to.lat, l0.to.lon) < ARRIVED[l0.mode]) return reach(state.reached + 1);
      return render();
    }
    const l = plan.legs[state.i];
    if (l.to?.lat) {
      const left = meters(p.lat, p.lon, l.to.lat, l.to.lon);
      if (!isRide(l)) {
        if (left < ARRIVED[l.mode] && state.i < plan.legs.length - 1) return reach(state.i + 1);
        // On its road: what's left along it. Off it (45 m, twice running):
        // a new road from where you are, at most every 30 s.
        const pts = wayPts(l);
        if (pts) {
          const cum = routeCum(pts);
          const a = alongRoute(pts, p, cum);
          state.leftAlong = a && a.off < 45 ? Math.max(0, cum.at(-1) - a.d) : null;
          state.offWay = a && a.off > 45 ? (state.offWay || 0) + 1 : 0;
          if (state.offWay >= 2 && !state.rerouting && Date.now() - (state.reroutedAt || 0) > 30_000) {
            state.rerouting = true;
            const at = state.i;
            roadPath(l.mode, { lat: p.lat, lon: p.lon }, l.to)
              .then(r => {
                if (!r || nav !== state || state.i !== at) return;
                l.poly = r.poly;
                l.fmt = '';
                l.road = true;
                l.from = { name: '', lat: p.lat, lon: p.lon };
                if (l.mode === 'bike') l.dist = r.dist;
                state.leftAlong = r.dist;
                saveNav(state);
                draw(plan, state.i);
                render();
              })
              .catch(() => {})
              .finally(() => {
                state.rerouting = false;
                state.reroutedAt = Date.now();
                state.offWay = 0;
              });
          }
        } else state.leftAlong = null;
      } else {
        // On board once you've left the stop behind: along its own way (a
        // route that turns away first, too), 200 m on; a bus that's due or
        // has come, 60 m on (the owner, 2026-10-22: on 快捷8號 a block past
        // the stop, the card still said 進站了・招手上車); two fixes going its way.
        const pts = state.phase === 'before' && l.from?.lat ? legPts(l) : null;
        const cum = pts && routeCum(pts);
        const a = pts && alongRoute(pts, p, cum);
        const onWay = a && a.off < (ON_WAY[l.mode] || 80) && cum.at(-1) - a.d > 100;
        const need = l.mode === 'bus' && Date.now() >= (state.liveAt.get(state.i) ?? l.dep) - 60_000 ? BUS_ON_M : 200;
        const fromStop = l.from?.lat ? meters(p.lat, p.lon, l.from.lat, l.from.lon) : 0;
        const leftStop = onWay ? a.d > need : fromStop > 200 && left < meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon);
        if (state.phase === 'before' && l.from?.lat && leftStop && aboard(state.i, onWay ? a.d : fromStop)) {
          state.phase = 'on';
          if (state.i === state.reached) state.reachedPhase = 'on';
          traceAdd('steps', [state.i, 'on']);
          state.where = null;
          saveNav(state);
          draw(plan, state.i);
          refreshLive();
          boarded();
        }
        // On it: the stop you're coming to (its stops, from where you are).
        const rs = state.phase === 'on' ? state.ride.get(state.i) : null;
        const knew = state.next != null;
        const nextWas = state.next;
        if (rs) state.next = nextStop(rs.stops, rs.i, rs.j, p);
        // Past a stop: the map's stops from the next one; your stop near, the YouBike after it shown, its bikes now.
        if (rs && state.next !== nextWas) {
          const soon = offSoon(state);
          if (soon !== Boolean(state.soon)) {
            state.soon = soon;
            refreshLive();
          }
          draw(plan, state.i);
        }
        // Where you are along it, kept for 10 minutes: your own pace says when you're at each stop ahead.
        if (rs) {
          rs.cum ||= routeCum(rs.stops);
          const a = alongRoute(rs.stops, p, rs.cum, Math.max(0, rs.i - 1));
          const t = Date.now();
          // Off it (its stops' line and its road both far), for 45 s or more: asked if you got off.
          const away = a && offRide(rs.stops, p, rs.cum, Math.max(0, rs.i - 1), legPts(l)) > (AWAY_M[l.mode] || 250);
          state.away = away ? state.away + 1 : 0;
          state.awayAt = away ? state.awayAt || t : 0;
          // (Asked with a buzz, once a ride: the phone is in a pocket by then.)
          if (state.away >= 2 && t - state.awayAt >= AWAY_MS && state.strayBuzz !== state.i) {
            state.strayBuzz = state.i;
            buzz();
          }
          if (a && a.off < 150) {
            state.track = [...state.track.filter(x => x.t > t - 10 * 60_000), { d: a.d, t }];
            const pace = ridePace(state.track, t);
            state.paced = pace ? aheadByPace(rs.cum, state.next, rs.j, a.d, pace, t) : null;
            if (state.paced) state.fresh = t;
          }
        }
        // The stop you're coming to known for the first time: the times at the stops ahead now, not at the next 20 s.
        if (rs && !knew) refreshLive();
        // Yours next (at the stop before it): a buzz, once.
        if (state.phase === 'on' && state.alerted !== state.i && (rs ? ringNow(rs, state.next) : left < NEXT_STOP_M)) {
          state.alerted = state.i;
          buzz();
        }
        if (state.phase === 'on' && state.i < plan.legs.length - 1 && (rs ? offEnd(p, state.i, false) : left < (OFF_M[l.mode] || 120))) return reach(state.i + 1, 'before', true);
        // Still at the stop with its time gone: the next one now, not at the next 20 s read.
        if (state.phase === 'before') missed();
      }
      arrive();
    }
    render();
  };
  // The bike ride coming up: this step's, or after the walks to it.
  // (On board: once your stop is two or fewer on, the bike after it.)
  const bikeAhead = () => {
    const on = isRide(plan.legs[state.i]) && state.phase === 'on';
    if (on && !offSoon(state)) return -1;
    const from = on ? state.i + 1 : state.i;
    const k = plan.legs.findIndex((x, n) => n >= from && x.mode === 'bike');
    return k >= 0 && plan.legs.slice(from, k).every(x => x.mode === 'walk') ? k : -1;
  };
  // Found empty where you take it (or full where you leave it), said with a
  // tap: the ride moved to a station within 500 m that has a bike (a dock)
  // now, the walk to it or from it redrawn; none: 換一條路. Which one as the
  // planner picks (swapPick): never the nearest to the old one regardless.
  const swapStation = async end => {
    const k = bikeAhead();
    if (k < 0) return;
    const l = plan.legs[k];
    const pt = end === 'rent' ? l.from : l.to;
    const tried = (state.tried ||= new Set());
    const list = await bikesAround(pt.lat, pt.lon).catch(() => []);
    for (const s of list) if (meters(pt.lat, pt.lon, s.lat, s.lon) < 60) tried.add(s.uid);
    const alt = swapPick(plan, k, end, list, { tried, pos: state.i <= k ? state.pos : null });
    if (nav !== state) return;
    if (!alt || !moveRide(plan, k, end, alt)) {
      state.bikes = { ...(state.bikes || {}), k, moved: '', none: end === 'rent' ? W('附近 500 公尺都沒車', 'No bikes within 500 m') : W('附近 500 公尺都沒空位', 'No docks within 500 m') };
      // (最快 from here on the trouble card, as for a bus missed.)
      const key = `bike|${k}|${end}`;
      if (state.troubleNo !== key && state.trouble?.key !== key) {
        state.trouble = { kind: 'bike', end: end === 'rent' ? 'rent' : 'ret', k: end === 'rent' ? k : null, key, best: undefined };
        onAction?.('fastest', { k, next: null });
      }
      return render();
    }
    tried.add(alt.uid);
    for (const m of [state.ride, state.info, state.liveAt]) for (const key of [...m.keys()]) if (key >= state.i) m.delete(key);
    buzz();
    go(state.i, state.phase);
    state.bikes = { k: bikeAhead(), moved: end === 'rent' ? W(`改到 ${alt.name} 借車`, `Rent at ${alt.name} instead`) : W(`改到 ${alt.name} 還車`, `Return at ${alt.name} instead`) };
    render();
  };
  // The bus or train you're on your way to (or waiting for) moved to another
  // departure: picked from its times, or the next once you've missed it.
  // (`pick`: chosen by you, kept as chosen; the next after one missed is not.)
  const takeOther = (k, opt, text, pick = false, miss = false) => {
    const late = retimeRide(plan, k, opt);
    if (pick) plan.legs[k].picked = true;
    else delete plan.legs[k].picked;
    state.gen++;
    state.delay = 0;
    for (const m of [state.ride, state.info, state.liveAt]) for (const key of [...m.keys()]) if (key >= k) m.delete(key);
    state.swap = { at: Date.now(), text, miss };
    go(state.i, state.phase);
    // (A change after it now missed: moved on as any ride ahead is, by the usual rules.)
    if (late) cascade();
    // (To be there by a time and in late now: 最快 offered, the way the card offers it.)
    else if (lateBy(plan, plan.arr) && !miss) askLate(k);
  };
  // ---- 出狀況 (trouble.mjs): one card ----
  // `state.trouble`: { kind, k, ride, mode, next, best, taken, key }. Found
  // whole before it shows (下一班 and 最快 both), then only its times move.
  // `state.troubleNo`: the one dismissed (×), never asked again.
  const troubleNow = now => {
    const t = state.trouble;
    if (!t) return null;
    // (Past it, on it, or another trip: gone.)
    if (t.k != null && (state.i > t.k || (state.i === t.k && state.phase === 'on'))) return (state.trouble = null);
    // (最快 set out a while ago: no longer a way; the card goes with its last row.)
    if (t.best && t.best.dep < now - 2 * 60_000) t.best = null;
    if (t.kind === 'wrong' && now - t.at > 10 * 60_000) return (state.trouble = null);
    return t;
  };
  // A ride ahead missed (`taken`: its next run already taken, the plan moved
  // to it), or about to be (late past hurrying): its next run from the same
  // stop, and the quickest way from here asked for (tab-map plans it, navBest
  // answers). Once a run.
  const askMiss = async (k, taken = false, was = '') => {
    const l = plan.legs[k];
    if (nav !== state || !l || !isRide(l) || state.done) return;
    const key = `${k}|${l.dep}|${taken ? 1 : 0}`;
    if (state.troubleNo === key || state.trouble?.key === key || state.asking === key) return;
    state.asking = key;
    let next = null;
    if (taken) next = { dep: state.liveAt.get(k) ?? l.dep, arr: plan.arr, taken: true };
    else {
      const ready = navTimes(plan, state.i, state.phase, state.pos, new Map(), Date.now()).ready.get(k) ?? Date.now();
      const o = (await rideOptions(l, state.info.get(k), ready).catch(() => [])).find(o => o.dep + (o.delay || 0) * 60_000 >= ready - 30_000 && o.dep > l.dep + 60_000);
      if (o) {
        const p = { ...plan, legs: plan.legs.map(x => ({ ...x })) };
        retimeRide(p, k, o);
        next = { dep: o.dep + (o.delay || 0) * 60_000, arr: p.arr + (o.delay || 0) * 60_000, opt: o, taken: false };
      }
    }
    if (nav !== state || state.asking !== key) return;
    state.asking = null;
    state.trouble = { kind: 'miss', k, key, ride: was || rideName(l), mode: l.mode, next, taken, best: undefined };
    onAction?.('fastest', { k, next: next ? { leg: l, dep: next.dep } : null });
    kit.rec?.('miss', { taken, ride: rideName(l), dep: l.dep, next: next?.dep ?? null });
  };
  // To be there by a time and late this way: 最快 asked for.
  const askLate = k => {
    const key = `late|${plan.arr}`;
    if (state.troubleNo === key || state.trouble?.key === key) return;
    state.trouble = { kind: 'late', k, key, mins: lateBy(plan, plan.arr), best: undefined };
    onAction?.('fastest', { k, next: null });
  };
  state.ask = { miss: askMiss };
  // 最快 found (or not): the card whole now, shown (and buzzed once).
  state.setBest = best => {
    const t = state.trouble;
    if (!t || t.best !== undefined) return;
    // (No quicker than 下一班 by a minute: 下一班 is the quickest.)
    t.best = best && !(t.next && best.arr >= t.next.arr - 60_000) ? best : null;
    if (t.best || (t.next && !t.next.taken) || !t.next) buzz();
    render();
  };
  // The bus you were walking to, gone before you can be there: the next you
  // can make (the timetable's, never that one again) taken, and 最快 asked.
  // (Never a YouBike to a stop further on to chase it: Jay 2026-11-06, "not
  // force me to go further but go back to regular logic". 最快 is planned
  // without one.)
  const goneBus = async (k, x, was, ready, seen) => {
    const l = plan.legs[k];
    if (nav !== state || state.i >= k || !l) return;
    const name = rideName(l);
    const nx = nextCatchable(x.sched, x.way?.w, x.way?.i, seen, ready, Date.now());
    if (nx) takeOther(k, { dep: nx.at, arr: nx.at + (l.arr - l.dep) }, W(`趕不上 ${hm(was)} 這班，改搭 ${hm(nx.at)}`, `Can’t make the ${hm(was)}; next ${hm(nx.at)}`), false, true);
    askMiss(k, Boolean(nx), name);
  };
  const optText = (o, l) => (en ? `${o.train ? `${trainKind(o.train.type || '')} ${o.train.no} ` : ''}${l.mode === 'bus' ? 'due' : 'leaves'} ${hm(o.dep)}` : `${o.train ? `${o.train.type || ''} ${o.train.no} 次 ` : ''}${hm(o.dep)}${l.mode === 'bus' ? ' 到站' : ' 開'}`);
  // 改搭別班: the ride ahead's departures, one tap to take another.
  // 附近換車 (a YouBike ridden 25 minutes): the stations near you with a
  // dock and a bike, the way you're going first; one tapped, the ride is cut there.
  state.swapDock = async () => {
    const k = state.i;
    const l = plan.legs[k];
    if (l?.mode !== 'bike' || !state.pos) return;
    const pos = state.pos;
    const list = await bikesAround(pos.lat, pos.lon).catch(() => []);
    if (nav !== state || state.i !== k) return;
    const docks = swapDocks(pos, list, { toward: l.to, max: 800, n: 3 });
    const rows = docks.map(({ s, d }, n) => `<button class="ot-row-btn" type="button" data-n="${n}">${icon('dock')}<span><b>${e(shown(s.name))}</b><small>${e(distText(d))}・${W('空位', 'docks')} ${s.ret}・${W('可借', 'bikes')} ${s.bikes + (s.ebike || 0)}</small></span></button>`);
    const d = sheet(`${sheetHead(W('還車再借一台', 'Return and re-rent'), W('又有 30 分鐘免費', '30 more free minutes'))}<div class="ot-nav-menu">${rows.join('') || emptyNote(W('附近 800 公尺內沒有可還又可借的站', 'No dock with bikes and space within 800 m'))}</div>`);
    d.addEventListener('click', ev => {
      const n = ev.target.closest('[data-n]')?.dataset.n;
      if (n == null) return;
      d.shut();
      const s = docks[Number(n)].s;
      if (nav !== state || state.i !== k || !splitRide(plan, k, s, state.pos || pos, Date.now())) return;
      state.gen++;
      // (The legs after it are one further on now.)
      for (const m of [state.ride, state.info, state.liveAt]) for (const key of [...m.keys()]) if (key > k) m.delete(key);
      state.swap = { at: Date.now(), text: W(`到 ${shown(s.name)} 還車再借一台`, `Swap bikes at ${shown(s.name)}`) };
      buzz();
      go(k, state.phase);
    });
  };
  state.pickTimes = async () => {
    const k = rideOf(plan, state.i);
    const l = plan.legs[k];
    if (k < state.i || !l || (k === state.i && state.phase === 'on')) return;
    const opts = await rideOptions(l, state.info.get(k)).catch(() => []);
    if (nav !== state) return;
    const cur = state.liveAt.get(k) ?? l.dep;
    const rows = opts.map((o, n) => `<button class="ot-row-btn ot-pick-dep${Math.abs(o.dep - cur) < 90_000 ? ' on' : ''}" type="button" data-n="${n}"><span><b>${e(optText(o, l))}</b><small>${o.live ? (o.delay ? W(`即時・晚 ${o.delay} 分`, `live・${o.delay} min late`) : W('即時', 'live')) : W('時刻表', 'timetable')}${Math.abs(o.dep - cur) < 90_000 ? W('・現在這班', '・this one') : ''}</small></span><time>${W('', 'in ')}${e(minsText(Math.max(0, Math.round((o.dep + (o.delay || 0) * 60_000 - Date.now()) / 1000))))}${W('後', '')}</time></button>`);
    const d = sheet(`${sheetHead(W('改搭別班', 'Another departure'), e(`${rideName(l)}・${l.from?.name || ''}`))}<div class="ot-nav-menu">${rows.join('') || emptyNote(W('接下來沒有班次', 'Nothing later'))}</div>`);
    d.addEventListener('click', ev => {
      const n = ev.target.closest('[data-n]')?.dataset.n;
      if (n == null) return;
      d.shut();
      const o = opts[Number(n)];
      if (nav === state && Math.abs(o.dep - cur) >= 90_000) takeOther(k, o, W(`改搭 ${optText(o, l)}`, `Switched: ${optText(o, l)}`), true);
    });
  };
  // Missed it, for sure: past its time (a train's with its live delay, a
  // timetable bus's), and you're still at the stop or station (a fresh
  // position within 300 m, not on board): the next one, said and buzzed.
  // (A bus with live times already counts down to the next that comes.)
  const missed = async () => {
    const k = state.i;
    const l = plan.legs[k];
    if (!isRide(l) || state.phase === 'on' || state.done || !state.pos || Date.now() - (state.posAt || 0) > 2 * 60_000) return;
    if (meters(state.pos.lat, state.pos.lon, l.from.lat, l.from.lon) > 300) return;
    const gone = l.mode === 'bus' ? !state.liveAt.has(k) && Date.now() > l.dep + 2 * 60_000 : Date.now() > l.dep + state.delay * 60_000 + 150_000;
    if (state.missing === k) return;
    if (!gone) return sooner(k);
    // (Seen there after it left, not only before: a phone quiet since on board
    // has its last fix at the stop. Jay 2026-11-07, 普悠瑪 107 taken as missed.)
    if (state.posAt < l.dep + (l.mode === 'bus' ? 0 : state.delay * 60_000) + 60_000) return;
    state.missing = k;
    const opts = await rideOptions(l, state.info.get(k)).catch(() => []);
    state.missing = null;
    if (nav !== state || state.i !== k || state.phase === 'on') return;
    // (The train itself running late, its delay not heard yet: still to come, never missed.)
    const own = runDelay(opts, l);
    if (own != null && Date.now() <= l.dep + own * 60_000 + 150_000) {
      state.delay = own;
      state.delayLive = true;
      state.liveAt.set(k, l.dep + own * 60_000);
      return render();
    }
    // (Never "the next" that is the same run: a bus's timetable time, a train by its number.)
    const next = opts.find(o => !sameRun(o, l) && o.dep + (o.delay || 0) * 60_000 > Date.now() + 30_000);
    const name = rideName(l);
    if (next) {
      buzz();
      takeOther(k, next, W(`沒趕上 ${rideName(l)}，改搭 ${optText(next, l)}`, `Missed ${rideName(l)}; next: ${optText(next, l)}`), false, true);
    }
    // (And 最快 from here, beside it: or alone when there's no next run, the metro's, the last one gone.)
    askMiss(k, Boolean(next), name);
  };
  // Waiting at the station for a train with one there sooner still to come
  // (there early, or an earlier one running late): that one, said and
  // buzzed, and the changes after it moved sooner too (the owner,
  // 2026-10-28: at 竹中 at 16:30, 1754 at 16:43 still to come, the trip
  // waiting for 1758 at 17:41). Looked at once a minute. Never off a train
  // you picked (pickedPlan): you chose that one.
  const sooner = async k => {
    const l = plan.legs[k];
    if (!isRail(l) || l.picked || Date.now() - (state.soonerAt || 0) < 60_000) return;
    state.soonerAt = Date.now();
    state.missing = k;
    const opts = await rideOptions(l, null).catch(() => []);
    state.missing = null;
    if (nav !== state || state.i !== k || state.phase === 'on') return;
    const late = o => (o.delay || 0) * 60_000;
    // (This train's own delay as its departures say it, where the step hadn't heard it.)
    const own = runDelay(opts, l) ?? state.delay ?? 0;
    const best = opts.filter(o => !sameRun(o, l) && o.dep + late(o) > Date.now() + 60_000).sort((a, b) => a.arr + late(a) - (b.arr + late(b)))[0];
    if (!best || best.arr + late(best) >= l.arr + own * 60_000 - 60_000) return;
    buzz();
    takeOther(k, best, W(`${optText(best, l)} 比較早到，改搭這班`, `${optText(best, l)} gets there sooner: switched`));
    cascade(k);
  };
  // ---- Started (or opened again) half way ----
  // Where you are on the trip, by where you are alone, with the first good
  // fix: the plan moved onto today's clock when it was timed for another day;
  // the train you're on found (today's run nearest you, by its timetable and
  // live delay), a bus or metro by where you are along it; every ride after
  // it moved to the first it can still catch (none: the rest planned again
  // from where it can't). Then it goes on exactly as a trip started at its
  // start: the steps behind you done, the countdowns, the live train, the
  // buzzes and getting off all the same (the owner, 2026-10-22).
  const settle = async p => {
    if (state.settled || !p || p.lat == null) return;
    state.settled = true;
    return locate(p);
  };
  // `again`: on the way (not opened), a ride found on its way needs two fixes going along it.
  const locate = async (p, again = false) => {
    const now = Date.now();
    // (Or standing at a later ride's stop: the steps to it are behind you.)
    const near = (pt, m) => pt?.lat != null && meters(p.lat, p.lon, pt.lat, pt.lon) < m;
    // (Or where a later walk starts, off its line and away from where this step starts; or at the
    // trip's end already, away from where it starts: its last step, where
    // being there ends it. The owner, 2026-10-28: opened again at the end
    // at 17:15, the trip was back on its first walk, 2.0 km away.)
    const last = plan.legs.length - 1;
    const there = last > state.reached && near(plan.legs[last].to || plan.dest, 250) && !near(plan.legs[state.reached].from, 500) ? last : -1;
    const stopAt = Math.max(
      plan.legs.findIndex((l, m) => m > state.reached && isRide(l) && near(l.from, 150)),
      plan.legs.findLastIndex((l, m) => m > state.reached && l.mode === 'walk' && near(l.from, 150) && !near(plan.legs[state.reached].from, 300)),
      there
    );
    const by = tripAt(plan, p, state.reached, now, { anyTime: true });
    const at = stopAt > (by?.i ?? 0) ? { i: stopAt, phase: 'before' } : by;
    const k = at?.i ?? state.i;
    // Timed for another day (12 hours and more off): onto today's.
    const off = Math.abs((plan.legs[k].dep ?? plan.dep) - now) > 12 * 3_600_000 && (at || k > 0 || plan.dep < now);
    const days = off ? shiftDays(plan, k, now) : 0;
    if (days) {
      state.gen++;
      state.ride.clear();
      state.liveAt.clear();
    }
    if (again && (!at || (at.phase === 'on' && !aboard(at.i, at.d ?? 0)))) return;
    let phase = at?.phase ?? state.phase;
    if (at?.phase === 'on' && !(await boardFix(k, p))) phase = at.i === state.i ? state.phase : null;
    if (nav !== state) return;
    if (phase && (k > state.reached || (k === state.reached && phase !== state.reachedPhase))) {
      // (On a bike the trip takes, found half way: its timer too.)
      reach(k, phase);
    } else if (days) go(state.i, state.phase);
    if (days || at) await cascade();
  };
  // On a ride by its way: really on one? A train: the one of today's nearest
  // you, its times taken (another train than planned, a later one); none near,
  // not on a train. A bus or metro off its time: its times moved to where
  // you are along it. → true when on board.
  const boardFix = async (k, p) => {
    const l = plan.legs[k];
    const now = Date.now();
    if (l.mode === 'tra' || l.mode === 'hsr') {
      let t;
      try {
        const [trips, sts, lv] = await Promise.all([rail.dayTrips(tw(now).date), rail.railStations(), l.mode === 'tra' ? rail.traLive().catch(() => new Map()) : new Map()]);
        t = trainNow(trips, sts, l, p, lv, now);
        // The train planned can't be it (not yet left where it boards, you
        // kilometres on): of those running now, the nearest by its clock,
        // further off (an express is put on a straight line between its
        // stops: 普悠瑪 107 新竹 → 臺中 is 6 km off it past 香山; Jay 2026-11-07).
        const late = (lv.get(String(l.train?.no ?? ''))?.delay ?? state.delay ?? 0) * 60_000;
        if (!t && now < l.dep + late - 60_000 && l.from?.lat != null && meters(p.lat, p.lon, l.from.lat, l.from.lon) > 2000) t = trainNow(trips, sts, l, p, lv, now, 15_000);
      } catch {
        // (No timetable to go by: where you are says it.)
        return true;
      }
      if (!t) return false;
      if (String(t.train.no) !== String(l.train?.no ?? '') || Math.abs(t.dep - l.dep) > 60_000) {
        retimeRide(plan, k, t);
        // (Taken as missed, the next one said, and on it after all: that's no longer so.)
        if (/沒趕上|Missed/.test(state.swap?.text || '')) state.swap = null;
        state.gen++;
        for (const m of [state.ride, state.liveAt]) for (const key of [...m.keys()]) if (key >= k) m.delete(key);
      }
      if (t.live) state.delay = t.delay;
      return true;
    }
    if (now < l.dep - 5 * 60_000 || now > l.arr + 5 * 60_000) {
      const pts = legPts(l);
      const cum = pts && routeCum(pts);
      const a = pts && alongRoute(pts, p, cum);
      if (a && cum.at(-1) > 0) {
        retimeAlong(plan, k, a.d / cum.at(-1), now);
        state.gen++;
        for (const m of [state.ride, state.liveAt]) for (const key of [...m.keys()]) if (key >= k) m.delete(key);
      }
    }
    return true;
  };
  // Got on (by the map, or found on it): a train boarded well off its time
  // (a later one than planned, an earlier one) or a bus off its time: which
  // it is, then what follows it moved to fit (once a step).
  const boarded = () => {
    const k = state.i;
    const l = plan.legs[k];
    if (state.phase !== 'on' || !isRide(l) || state.boardAt === k || !state.pos || !state.settled) return;
    state.boardAt = k;
    const now = Date.now();
    const rail = l.mode === 'tra' || l.mode === 'hsr';
    const dep = l.dep + (state.delay || 0) * 60_000;
    if (rail ? now >= dep - 3 * 60_000 && now <= dep + 4 * 60_000 : now >= l.dep - 5 * 60_000 && now <= l.arr + 5 * 60_000) return;
    const was = `${l.dep}|${l.train?.no ?? ''}`;
    boardFix(k, state.pos).then(on => {
      if (nav !== state || state.i !== k || !on || `${l.dep}|${l.train?.no ?? ''}` === was) return;
      saveNav(state);
      draw(plan, state.i);
      refreshLive();
      cascade();
    });
  };
  // Each ride ahead that can't be caught as timed now (you'll be at its stop
  // after it's gone; or it's another day's): the first one after you're there,
  // today; none, the rest of the trip planned again from there. On board
  // (or `from`, a ride just moved sooner), each one after it that a sooner one now beats (on an
  // earlier train than planned, the change it makes: the owner, 2026-10-28,
  // on 1825 at 16:15, the trip still changed to 17:41 and said 18:02): the
  // one there first, two minutes and more after you're at its stop.
  const cascade = async (from = state.phase === 'on' ? state.i : Infinity) => {
    let changed = false;
    for (let m = state.i; m < plan.legs.length; m++) {
      const l = plan.legs[m];
      if (!isRide(l) || (m === state.i && state.phase === 'on')) continue;
      const now = Date.now();
      // (The step you're at, waiting at its stop: missed() takes the next once it's gone.)
      if (m === state.i && l.dep < now + 3 * 3_600_000) continue;
      const ready = m === state.i ? now : navTimes(plan, state.i, state.phase, state.pos, new Map(), now, state.phase === 'on' ? (state.arrAt ?? null) : null).ready.get(m);
      if (ready == null) continue;
      const fits = l.dep >= ready - 60_000 && l.dep - ready < 3 * 3_600_000;
      // (A train you picked that you'll still make: kept, never moved sooner.)
      if (fits && (m <= from || l.picked)) continue;
      const opts = await rideOptions(l, state.info.get(m), ready).catch(() => []);
      if (nav !== state) return;
      const late = o => (o.delay || 0) * 60_000;
      const opt = fits
        ? opts.filter(o => o.dep + late(o) >= ready + 2 * 60_000).sort((a, b) => a.arr + late(a) - (b.arr + late(b)))[0]
        : opts.find(o => o.dep + late(o) >= ready - 30_000);
      if (fits && !(opt && opt.arr + late(opt) < l.arr - 60_000)) continue;
      if (!opt) {
        if (changed) saveNav(state);
        return onAction?.('rest', { k: m - 1, at: ready });
      }
      retimeRide(plan, m, opt);
      state.gen++;
      for (const x of [state.ride, state.liveAt]) for (const key of [...x.keys()]) if (key >= m) x.delete(key);
      changed = true;
    }
    if (!changed || nav !== state) return;
    saveNav(state);
    draw(plan, state.i);
    render();
    refreshLive();
    notices();
  };
  state.go = go;
  state.render = render;
  // Followed where you are; started again on coming back to the app, and
  // after SILENT_MS with no position while it's seen: iOS's watch can stay
  // silent after the app was away (the owner, 2026-10-16: back in the app,
  // the dot where it was left). Each start asks for a fix at once too.
  // (`kick`: the device's own watch started over, the only thing that wakes
  // a silent one: a new listener on it alone had waited on it still.)
  const watch = (kick = false) => {
    state.stopWatch?.();
    state.stopWatch = watchPosition(moved);
    state.watchAt = Date.now();
    getPosition({ high: false, timeout: 4000, maximumAge: 5000, kick }).then(p => !p.error && nav === state && moved(p));
  };
  watch();
  state.timer = setInterval(refreshLive, liveMs());
  // The countdown to the second; everything else said (to set out, till you're there) every 10 s.
  state.tick = setInterval(() => {
    if (state.done && Date.now() - state.doneAt >= END_MS) return finish();
    // (Over 90 minutes past the planned arrival, the screen kept on: ended, as on coming back.)
    if (!state.done && plan.arr < Date.now() - NAV_KEEP) {
      stopNav();
      return onEnd?.();
    }
    // (Silent: the device's watch started over, the only thing that wakes it; 30 s
    // and a kick once a minute had left the dot standing still on a moving train.)
    const heard = Math.max(state.posAt || 0, state.roughAt || 0);
    if (document.visibilityState === 'visible' && Date.now() - Math.max(heard, state.watchAt || 0) > (state.silentMs || SILENT_MS)) {
      if (state.watchAt > heard) state.silentMs = Math.min(SILENT_MAX, 2 * (state.silentMs || SILENT_MS));
      watch(true);
    }
    // (Back in the app: 5 s with no fix, started over then, not 30 s on.)
    else if (state.shownAt && Date.now() - state.shownAt > 5000 && (state.posAt || 0) < state.shownAt && (state.roughAt || 0) < state.shownAt) {
      state.shownAt = 0;
      watch(true);
    }
    // Looked ahead and left there: after 20 s the card, the chips and the map are on the step you're at again (the owner, 2026-10-22).
    if (state.lookAt && Date.now() - state.lookAt > LOOK_MS && state.i !== state.reached) {
      state.lookAt = 0;
      state.look = null;
      return go(state.reached, state.reachedPhase || 'before');
    }
    if (Date.now() - state.drawn >= 10_000) {
      arrive();
      return render();
    }
    for (const el of [...box.querySelectorAll('[data-cd]'), ...(mini?.querySelectorAll('[data-cd]') || [])]) el.innerHTML = countBig(Number(el.dataset.cd) - Date.now(), el.dataset.k);
  }, 1000);
  box.onclick = ev => {
    primeBuzz();
    if (ev.target.closest('[data-nav="times"]')) return state.pickTimes();
    const end = ev.target.closest('[data-nav-bike]')?.dataset.navBike;
    if (end) return swapStation(end);
    // A step after a stop: looked at on the map (tab-map 'peek'), the step you're at kept.
    const peek = ev.target.closest('[data-nav-peek]')?.dataset.navPeek;
    if (peek) {
      const [n, j] = peek.split(':').map(Number);
      const leg = plan.later?.[n]?.legs?.[j];
      return leg && onAction?.('peek', leg);
    }
    const k = ev.target.closest('[data-nav-go]')?.dataset.navGo;
    // The step you're on tapped: it stays as it is (go() started it over: the card lost the
    // stop you're coming to and showed the distance until the next fix; Jay 2026-11-03),
    // opened if folded, and the map framed on it again.
    if (k != null && Number(k) === state.i && !state.look) {
      if (state.fold.top) foldCard('top', false);
      return onAction?.('view');
    }
    if (k != null && Number(k) >= state.reached) {
      // (Looking ahead from a ride you're on: it's still followed, and a tap back is on it again.)
      if (Number(k) !== state.i && state.i === state.reached && state.phase === 'on' && isRide(plan.legs[state.i])) state.look = { k: state.i };
      const back = Number(k) === state.look?.k;
      if (back) state.look = null;
      // (A step ahead looked at: back on the one you're at by itself in a while.)
      state.lookAt = Number(k) === state.reached ? 0 : Date.now();
      return go(Number(k), Number(k) === state.i ? state.phase : back ? 'on' : 'before');
    }
    const a = ev.target.closest('[data-nav]')?.dataset.nav;
    if (a === 'swapdock') return state.swapDock();
    if (a === 'park' || a === 'return') {
      // Kept (parked at the stop, ridden on: its timer runs on) or returned there.
      const l = plan.legs[state.i];
      if (l?.mode !== 'bike') return;
      Object.assign(l, { park: a === 'park', asked: true });
      saveNav(state);
      return render();
    }
    if (a === 'end') {
      // Asked first: 結束 sits where a thumb lands, and an ended ride can't be had back.
      kit.ask({ title: W('結束導航？', 'End navigation?'), body: W(`到 ${plan.dest?.name || plan.legs.at(-1)?.to?.name || '目的地'} 的導航會停止。`, `Directions to ${plan.dest?.name || plan.legs.at(-1)?.to?.name || 'your destination'} stop.`), ok: W('結束導航', 'End'), cancel: W('繼續導航', 'Keep going'), danger: true }).then(ok => {
        if (!ok || nav !== state) return;
        stopNav();
        onEnd?.();
      });
    } else if (a === 'fold-top' || a === 'fold-bottom') {
      foldCard(a === 'fold-top' ? 'top' : 'bottom');
    } else if (a === 'tr-x') {
      // (Dismissed: never asked again for that run; a 'wrong' or 'off' one until it's so again.)
      state.troubleNo = state.trouble?.key ?? null;
      state.trouble = null;
      if (!state.troubleNo) state.away = 0;
      render();
    } else if (a === 'tr-next') {
      // 下一班: kept (taken already) or taken now.
      const t = state.trouble;
      state.troubleNo = t?.key ?? null;
      state.trouble = null;
      const l = t && plan.legs[t.k];
      if (t?.next?.opt && !t.next.taken && l) takeOther(t.k, t.next.opt, W(`改搭 ${optText(t.next.opt, l)}`, `Switched: ${optText(t.next.opt, l)}`));
      else render();
    } else if (a === 'tr-best') {
      const b = state.trouble?.best;
      state.trouble = null;
      if (b) onAction?.('take', b);
    } else if (a === 'replan') {
      // (On a bus or train that isn't the plan's: planned from that ride.)
      onAction?.('replan', { aboard: state.shownTrouble === 'wrong' });
    } else if (a) onAction?.(a);
  };
  // Folded or opened: kept and drawn (the map fits the room left: tab-map watchCards).
  const foldCard = (which, to = !state.fold[which]) => {
    if (state.fold[which] === to) return;
    state.fold = { ...state.fold, [which]: to };
    saveFold(state.fold);
    render();
  };
  // A swipe on a card: the top up to fold, down to open; the bottom the other way.
  let swipe = null;
  box.ontouchstart = ev => {
    // (The top card only: the bottom one stays as it is, its swipe down had only hidden the steps: the owner, 2026-10-22.)
    const card = ev.target.closest('.ot-nav-top');
    swipe = card && ev.touches.length === 1 ? { y: ev.touches[0].clientY, top: card.classList.contains('ot-nav-top') } : null;
  };
  box.ontouchend = ev => {
    if (!swipe) return;
    const dy = (ev.changedTouches[0]?.clientY ?? swipe.y) - swipe.y;
    const s = swipe;
    swipe = null;
    if (Math.abs(dy) < 36) return;
    foldCard(s.top ? 'top' : 'bottom', s.top ? dy < 0 : dy > 0);
  };
  if (mini) mini.onclick = ev => ev.target.closest('[data-nav="open"]') && onAction?.('open');
  // Back from the background (an iPhone pauses the page): where you are now, the buses again.
  state.onShow = () => {
    if (document.visibilityState !== 'visible' || nav !== state) return;
    if (state.done && Date.now() - state.doneAt >= END_MS) return finish();
    watch();
    state.shownAt = Date.now();
    if (plan.arr < Date.now() - NAV_KEEP) {
      stopNav();
      return onEnd?.();
    }
    render();
    refreshLive();
    // (The screen's wake lock goes with the page hidden: asked for again.)
    navigator.wakeLock
      ?.request('screen')
      .then(x => (state.wake = x))
      .catch(() => {});
  };
  // The screen stays on while navigating, where the browser allows it.
  navigator.wakeLock
    ?.request('screen')
    .then(w => (state.wake = w))
    .catch(() => {});
  document.addEventListener('visibilitychange', state.onShow);
  // Start where you are on it (started or opened again half way: the step
  // you're at, on board if you're riding), else where it was left, else at
  // the first step not yet behind you by the clock.
  const now = Date.now();
  const first = plan.legs.findIndex(l => l.arr > now - 60_000);
  const from = resume && resume.i >= (first > 0 ? first : 0) - 1 ? { i: resume.i, phase: resume.phase === 'on' ? 'on' : 'before' } : { i: first > 0 ? first : 0, phase: 'before' };
  // (Where the device was a few minutes ago at most: an old fix is no "here".)
  const fresh = here && here.lat != null && !(here.at && now - here.at > 3 * 60_000) ? here : null;
  const here0 = fresh ? tripAt(plan, fresh, 0, now) : null;
  // (Started a few minutes late, still on a walk or ride of your own the clock has put behind: that step, not the next.)
  const onOwn = k => {
    const pts = !isRide(plan.legs[k]) && legPts(plan.legs[k]);
    const a = pts && alongRoute(pts, fresh, routeCum(pts));
    return Boolean(a && a.off < (ON_WAY[plan.legs[k].mode] || 80));
  };
  const behind = !resume && fresh && !here0 && from.i > 0 ? [...Array(from.i).keys()].reverse().find(onOwn) : undefined;
  // (A trip planned from the bus or train you're on, aboard.mjs: on it from the start.)
  const onBoard = !resume && plan.legs[0]?.aboard && isRide(plan.legs[0]) ? { i: 0, phase: 'on' } : null;
  const start = onBoard || (here0 && (here0.i > from.i || (here0.i === from.i && here0.phase === 'on')) ? here0 : behind != null ? { i: behind, phase: 'before' } : from);
  // (Opened again: as far as it had got, the step shown as it was.)
  state.reached = start === from && resume?.reached != null ? Math.min(Number(resume.reached) || 0, start.i) : start.i;
  // (Started where you are already riding a bike the trip takes: its timer too.)
  // (Or at the station of a trip that starts with the bike.)
  const atBike = start.i === 0 && plan.legs[0].mode === 'bike' && fresh && plan.legs[0].from?.lat != null && meters(fresh.lat, fresh.lon, plan.legs[0].from.lat, plan.legs[0].from.lon) < 60;
  if ((start === here0 && start.i > 0) || atBike) bikeTimer(state.reached);
  state.reachedPhase = start.i === state.reached ? start.phase : 'before';
  go(start.i, start.phase);
  if (fresh) settle(fresh);
  // Every ride's stops, for the map (each stop a dot on its line), ahead of
  // reaching it; refreshLive finds them kept.
  (async () => {
    for (const [k, l] of plan.legs.entries()) {
      if (!isRide(l) || state.ride.has(k) || k < state.i) continue;
      if (l.mode === 'bus' && l.from?.lat && !state.info.has(k)) state.info.set(k, await busInfo(l).catch(() => ({ leg: l })));
      // (Its times moved meanwhile, another train: its stops are that one's, found again.)
      const g = state.gen;
      const rs = await rideStops(l, state.info.get(k)).catch(() => null);
      if (nav !== state) return;
      if (!state.ride.has(k) && state.gen === g) state.ride.set(k, rs);
    }
    if (nav === state) draw(plan, state.i);
  })();
  return state;
}
// Each ride's stops from where it boards to where it gets off, for the map: [{ k, stops }].
// On board, only the ride you're on (the rides after it aren't drawn: the
// owner, 2026-10-22, a mess of dots); `cur`: that one, `next` the stop
// you're coming to among its stops.
export function navStops() {
  if (!nav) return [];
  const on = isRide(nav.plan.legs[nav.i]) && nav.phase === 'on';
  return [...nav.ride]
    .filter(([k, rs]) => rs?.stops && k >= nav.i && (!on || k === nav.i))
    .map(([k, rs]) => {
      const cur = on && k === nav.i && nav.next != null;
      // (`next`: where the stop you're coming to is among them; those before it are behind you.)
      const stops = rs.stops.slice(rs.i, rs.j + 1).filter(s => s.lat != null);
      return { k, cur, stops, next: cur ? Math.max(0, nav.next - rs.i) : -1 };
    });
}
// On board with your stop two or fewer stops on: the YouBike you take after it is shown (its bikes now).
const offSoon = n => {
  const rs = n.ride.get(n.i);
  return Boolean(rs && n.next != null && rs.j - n.next <= 2);
};

// The ride being navigated, for the screens around it: the plan, the step,
// its stops (a bus or train's, once known), shrunk or not.
// What the map shows at each stage of the trip (the owner, 2026-10-13: the
// whole trip in view was too far out on a walk or a short ride): walking or
// riding a bike, you and the rest of that step to where the next one starts;
// waiting for a bus or train, you and the stop close up (to find it; not yet
// where it goes, the owner, 2026-10-13); on board, you and the rest of the
// ride to where you get off. `path(l)`: a
// leg's line as [[lat, lon]…]. Never closer than a street or two (~400 m
// across); waiting, the street itself (~100 m: which side of the road the
// stop is on, exactly where; the owner, 2026-10-13), wider only to have you
// in it too. → [{ lat, lon }…]
// There, on the last walk: within 60 m of the end (and no more than 90 m
// left along the walk's way, when it's known: a lane passing the door's
// back is not the door); or stopped near it, at the door of a place whose
// point is mid-block: within 100 m (90 m along), and not 20 m from where you
// stood for a minute. Walking on, the stop starts again. (It had ended a walk
// home still 120 m off, its lane first going round: "no nearer for 45 s"
// counted the straight line, not whether you were walking; the owner,
// 2026-10-14.) `near`: where you stood still since, carried between calls.
export function arrival(near, p, to, along = null, now = Date.now()) {
  const alongOk = m => along == null || along < m;
  if (to < ARRIVED.walk + 25 && alongOk(90)) return { near, done: true };
  if (to >= 100 || !alongOk(90)) return { near: null, done: false };
  if (!near || meters(near.lat, near.lon, p.lat, p.lon) > 20) near = { lat: p.lat, lon: p.lon, t: now };
  return { near, done: now - near.t > 60_000 };
}

// On board: you and the rest of the ride to your stop, the whole of it (you
// sit on it the whole way; close up is for walking and riding a bike: the
// owner, 2026-10-22, after a try at the next three stops); by its stops
// once known (`ride`: { stops, j, next }), never the part behind you nor
// what's after your stop. Your stop next: close up on it and where you go
// from it (the YouBike to find, the walk's end), to find your way off.
// Points with a box round their middle at least `d` degrees each way (never closer than a street or two).
function pad(pts, d) {
  if (!pts.length) return pts;
  const lat = pts.map(p => p.lat);
  const lon = pts.map(p => p.lon);
  const c = { lat: (Math.min(...lat) + Math.max(...lat)) / 2, lon: (Math.min(...lon) + Math.max(...lon)) / 2 };
  const dLon = d / Math.cos((c.lat * Math.PI) / 180);
  return [...pts, { lat: c.lat - d, lon: c.lon - dLon }, { lat: c.lat + d, lon: c.lon + dLon }];
}
export function stageView(plan, i, phase, me, path, ride = null) {
  const l = plan.legs[i];
  if (!l) return [];
  if (phase === 'on' && isRide(l) && ride?.stops && ride.next != null && me?.lat != null) {
    const off = ride.stops[ride.j];
    const last = ride.next >= ride.j;
    const after = plan.legs[i + 1];
    const pts = last
      ? [me, off, ...(after && !isRide(after) && after.to?.lat != null && meters(off.lat, off.lon, after.to.lat, after.to.lon) < 800 ? [after.to] : [])]
      : [me, ...ride.stops.slice(ride.next, ride.j + 1)];
    return pad(pts.filter(x => x?.lat != null).map(x => ({ lat: x.lat, lon: x.lon })), last ? 0.0009 : 0.0018);
  }
  // (Waiting: only the stop.)
  const waiting = isRide(l) && phase !== 'on';
  let pts = waiting ? (l.from?.lat != null ? [{ lat: l.from.lat, lon: l.from.lon }] : []) : path(l).map(([lat, lon]) => ({ lat, lon }));
  // From you on (you're past the rest), once you're on the step.
  const own = !isRide(l);
  if (me?.lat != null && pts.length > 1 && (own || phase === 'on')) {
    let k = 0;
    pts.forEach((p, j) => meters(me.lat, me.lon, p.lat, p.lon) < meters(me.lat, me.lon, pts[k].lat, pts[k].lon) && (k = j));
    pts = pts.slice(Math.min(k, pts.length - 2));
  }
  // A walk: on to where the next step starts.
  const next = plan.legs[i + 1];
  if (l.mode === 'walk' && next?.from?.lat != null) pts.push({ lat: next.from.lat, lon: next.from.lon });
  if (me?.lat != null) pts.push({ lat: me.lat, lon: me.lon });
  if (!pts.length) return pts;
  // (At least ~100 m across on foot or waiting, street level: Jay, 2026-10-22,
  // a 130 m walk was framed too far out; on a bike or a ride ~400 m.)
  const lat = pts.map(p => p.lat);
  const lon = pts.map(p => p.lon);
  const c = { lat: (Math.min(...lat) + Math.max(...lat)) / 2, lon: (Math.min(...lon) + Math.max(...lon)) / 2 };
  const dLat = waiting || l.mode === 'walk' ? 0.00045 : 0.0018;
  const dLon = dLat / Math.cos((c.lat * Math.PI) / 180);
  pts.push({ lat: c.lat - dLat, lon: c.lon - dLon }, { lat: c.lat + dLat, lon: c.lon + dLon });
  return pts;
}

export function navNow() {
  if (!nav) return null;
  const on = isRide(nav.plan.legs[nav.i]) && nav.phase === 'on';
  return { plan: nav.plan, i: nav.i, phase: nav.phase, pos: nav.pos, ahead: nav.i > nav.reached, ride: nav.ride.get(nav.i) || null, next: nav.next, aboard: on, offSoon: on && offSoon(nav), min: nav.min, trouble: nav.trouble || null };
}
// Said on the card (to be there by a time, late): { title, sub, plan } or null.
// 最快 found for the trouble card (trouble.mjs fastest), or null: none quicker.
export function navBest(best) {
  nav?.setBest?.(best);
}
// Shrunk to the bar (doing something else) or back; kept for when the app's opened again.
export function setNavMin(on) {
  if (!nav) return;
  nav.min = Boolean(on);
  // (Back: the steps' row scrolled to the step you're at again; hidden, it couldn't be.)
  const row = nav.box?.querySelector?.('.ot-nav-chips');
  if (row) row._on = null;
  saveNav(nav);
  nav.render?.();
}
// When the ride you're on is at stop k of its way: TDX's, a train's live
// timetable, your own pace, the timetable, else in proportion along the
// ride's planned time (a stop past where it was to end, too).
// 改搭別班 from the ⋯ menu: the ride ahead's departures (none on board).
export const navPickTimes = () => nav?.pickTimes?.();
export const navCanPick = () => Boolean(nav) && !(isRide(nav.plan.legs[nav.i]) && nav.phase === 'on') && rideOf(nav.plan, nav.i) >= nav.i;
export function navStopAt(k) {
  if (!nav) return null;
  const l = nav.plan.legs[nav.i];
  const rs = nav.ride.get(nav.i);
  if (!rs) return null;
  const s = rs.stops[k];
  const tt = s?.at != null ? s.at + nav.delay * 60_000 : null;
  const known = nav.ahead?.get(k) ?? (nav.delayLive ? tt : null) ?? nav.paced?.get(k) ?? tt;
  if (known != null) return known;
  rs.cum ||= routeCum(rs.stops);
  const span = rs.cum[rs.j] - rs.cum[rs.i];
  return span > 0 ? l.dep + ((rs.cum[k] - rs.cum[rs.i]) / span) * (l.arr - l.dep) : null;
}
// Off the ride you're on at another of its stops (earlier, or further on),
// and from there `rest` (the legs a new plan from that stop gives) instead of
// what the plan had after it.
// Where the trip being navigated now ends, and the places after it (a stop
// first, or another place, changed on board: the ride goes on).
export function navRetarget(dest, then = []) {
  if (!nav) return;
  nav.plan.dest = { name: dest.name || '', lat: dest.lat, lon: dest.lon, ...(dest.gid ? { gid: dest.gid } : {}) };
  nav.plan.then = then.map(x => ({ name: x.name || '', lat: x.lat, lon: x.lon, ...(x.gid ? { gid: x.gid } : {}) }));
  // (The stretches after it were for the old places: planned again, navLater.)
  nav.plan.later = null;
  saveNav(nav);
  nav.render?.();
}
// The stretches after each stop, once they're planned (a trip with stops started before they were).
// (`replace`: those planned by an older app, planned again after an update: the trip under way gets the new planning.)
export function navLater(later, { replace = false } = {}) {
  if (!nav || !later?.length || (nav.plan.later?.length && !replace)) return;
  nav.plan.later = later;
  saveNav(nav);
  nav.render?.();
}
export function navChangeOff(k, rest = []) {
  if (!nav) return;
  const s = nav;
  const rs = s.ride.get(s.i);
  const l = s.plan.legs[s.i];
  if (!rs || !isRide(l) || k <= rs.i || k >= rs.stops.length) return;
  const at = navStopAt(k) ?? l.arr;
  const stop = rs.stops[k];
  l.to = { name: stop.name, lat: stop.lat, lon: stop.lon };
  l.arr = at;
  l.dur = Math.max(60, Math.round((at - l.dep) / 1000));
  if (l.stops) l.stops = k - rs.i;
  // Its line on the map: through its stops to the new one (the planner's shape was to the old; the same stop keeps it).
  if (k !== rs.j) {
    delete l.poly;
    l.path = rs.stops.slice(rs.i, k + 1).filter(x => x.lat != null).map(x => [x.lat, x.lon]);
  }
  rs.j = k;
  s.alerted = -1;
  navRest(rest);
}
// The trip after the ride you're on (or after step `after`, ahead of it),
// planned again (`rest`: its new legs).
export function navRest(rest = [], after = null) {
  if (!nav) return;
  const s = nav;
  const k = Math.max(s.i, Math.min(after ?? s.i, s.plan.legs.length - 1));
  s.plan.legs = [...s.plan.legs.slice(0, k + 1), ...rest];
  const end = s.plan.legs.at(-1);
  s.plan.arr = end.arr ?? s.plan.legs[k].arr;
  s.plan.dur = Math.round((s.plan.arr - s.plan.dep) / 1000);
  s.gen++;
  // What was known of the legs after it is of the old ones.
  for (const m of [s.ride, s.info, s.liveAt]) for (const key of [...m.keys()]) if (key > k) m.delete(key);
  s.go(s.i, s.phase);
}

export function stopNav() {
  if (!nav) return;
  nav.traceSave?.();
  dropNav();
  nav.push?.([]);
  document.removeEventListener('visibilitychange', nav.onShow);
  nav.stopWatch?.();
  clearInterval(nav.timer);
  clearInterval(nav.tick);
  clearTimeout(nav.endTimer);
  nav.wake?.release?.().catch(() => {});
  nav = null;
}
