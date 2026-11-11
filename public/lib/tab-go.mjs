// 交通: what's coming that you'd actually take, in one place, refreshed
// while it's open.
//
//   常用・釘選行程  your trips (家 → 學校 on weekday mornings, and the way
//                  back by itself): the next few ways to go, from the
//                  planner, with the buses' real times; one tap navigates
//   釘選的公車・火車  what you pinned: a stop's bus, a connection (六家 → 竹東),
//                  one train
//   地點          a row of your places; one tapped: its buses, its bikes,
//                  and how to get there from here
//
// What's recommended is never pinned by itself: ☆ pins it.

import * as kitUI from '#kit/ui.mjs';
import { errorText, liveMs, tdx } from './api.mjs';
import { traAlertsNow, alertsOn, slowSpec } from './slow.mjs';
import { stopsEta, etaRank, etaFor } from './bus.mjs';
import { nearBikes } from './near-ui.mjs';
import { nearStops, openRoute, chooseGroup, useBusCtx, strip, fitStrips, busWhen, plannedAt } from './bus-ui.mjs';
import { bikesAround } from './near.mjs';
import { railNetwork, railSpan, traDelays, traTrain } from './raildata.mjs';
import { journeys } from './rail.mjs';
import { planTrip } from './planner.mjs';
import { setTripPush } from './alerts.mjs';
import { pickSig, boardEarly } from './plan.mjs';
import { chaseOf, chaseNow, steadyLead } from './chase.mjs';
import { steadyPlans, settled } from './steady.mjs';
import { lateBy } from './nav.mjs';
import { loadNotices, bikesOff, onNotices } from './service.mjs';
import { mapsNear } from './metro.mjs';
import { cleanPin, slotOf, tripOver, MAX_PINS, PLACE_ICONS } from './store.mjs';
import { sheet, sheetHead, icon, trainKind, trainName, stationLabel, legLabel, legColor, trainColor, legChips, fitLegs, journeyLine } from './ui.mjs';
import { boardRow, whenHtml } from './board.mjs';
import { COLOR, PLACE_COLOR, tile, tripTile, tag, section, rowCard, tick, navTitle, noticesHtml } from './look.mjs';
import { e, hm, distText, meters, tw, twAt, addDays, dayLabel, holidayOn, weekdaysOnly, isRide, readJson, readSaved, UNREAD, writeJson, workday, shown as nameIn } from './util.mjs';

import { W } from '#kit/lang.mjs';
import { onDayOff } from '#kit/dayoff.mjs';
const $ = id => document.getElementById(id);
let ctx = null;
let timer = 0;
let ticker = 0;
let shown = false;
const S = {
  pinned: new Map(), // stopUID → eta
  pinnedAt: 0, // when those were read (a countdown runs on from it)
  planned: new Map(), // stopUID → { at, day }: the timetable's next bus there, for when none is on its way
  trains: new Map(), // pin id → { rows: [{ dep, arr, label, delay }] } once read, or { error }
  trips: new Map(), // key → { at, plans, error, loading }
  choice: new Map(), // `${trip}:${its card's plan}` → the departure picked from its times
  places: new Map(), // place id → { stops, bikes, at }
  open: new Set(), // places opened
  flip: new Set(), // rides turned round by hand (⇄)
  notices: [] // what isn't running today around you (service.mjs)
};

// A pinned ride the way you'd take it now: from whichever of its two ends
// you're nearer (at work: the way home), unless turned round by hand. A
// stop pinned alone, or a ride with no way back, is as pinned.
export function rideNow(it, here, flipped = false) {
  const fwd = { dir: it.dir, stopUID: it.stopUID, stop: it.stop, headsign: it.headsign, lat: it.lat, lon: it.lon, off: it.off || null, back: false };
  if (!it.back) return fwd;
  const rev = { dir: it.back.dir, stopUID: it.back.stopUID, stop: it.back.stop, headsign: it.back.headsign, lat: it.back.lat, lon: it.back.lon, off: it.back.off, back: true };
  let useBack = false;
  if (here && it.lat != null && it.back.lat != null) useBack = meters(here.lat, here.lon, it.back.lat, it.back.lon) + 150 < meters(here.lat, here.lon, it.lat, it.lon);
  return useBack !== flipped ? rev : fwd;
}
const sideOf = it => ({ ...it, ...rideNow(it, ctx.here, S.flip.has(it.id)) });

export function init(c) {
  ctx = c;
  useBusCtx(c);
  $('panel-go').addEventListener('click', onClick);
  (ctx.onRefresh ||= []).push(() => shown && render());
  // (A typhoon day off announced where a trip goes: its next time moves on.)
  onDayOff(() => render());
  // (An operator's new notice: what's stopped, again.)
  onNotices(() => shown && loadNotices_().then(render));
}
// The first look, filled in (where you are, the kept plans timed, the
// buses and trains): what the opening waits for, so the loading screen
// lifts onto it and nothing changes after (the app caps the wait).
let firstLook = null;
export const ready = () => firstLook || Promise.resolve();

export function show() {
  shown = true;
  render();
  const run = refresh(true);
  firstLook ||= run.catch(() => {});
  clearInterval(timer);
  timer = setInterval(() => refresh(false), liveMs());
  clearInterval(ticker);
  ticker = setInterval(() => tick($('panel-go')), 5000);
}
export function hide() {
  shown = false;
  clearInterval(timer);
  clearInterval(ticker);
}

// ---- Which trips matter now ------------------------------------------------------------------------

const NEAR_END_M = 800;
// A saved trip's way now: forward, or back when you're at its far end (or
// it's the time home). → { from (null: here), to, at, by, label } or null.
// At an end: within 800 m of it, or in its part of the trip (the last 30% of
// the way, nearer it than the other end: 竹東 on 成功九街 → 竹東高中 is the
// way back already; the owner, 2026-10-13).
export function tripNow(t, here, now = Date.now()) {
  const day = tw(now);
  // A one-time trip: only on its day, nothing once that's over or its time
  // is 20 minutes gone (store.mjs tripOver).
  if (tripOver(t, now)) return null;
  const today = slotOf(t, day.dow);
  const span = t.from && t.to ? meters(t.from.lat, t.from.lon, t.to.lat, t.to.lon) : 0;
  const d = p => meters(here.lat, here.lon, p.lat, p.lon);
  const near = p => {
    if (!here || !p) return false;
    const other = p === t.to ? t.from : t.to;
    return d(p) <= NEAR_END_M || (other && d(p) <= span * 0.3 && d(p) < d(other));
  };
  const back = { from: t.to, to: t.from, label: W(`${t.name || t.to.name} 回程`, `${t.name || t.to.name}: return`), key: 'back', rev: true };
  const fwd = { from: t.from, to: t.to, label: t.name || t.to.name, key: 'time', rev: false };
  let way = fwd;
  if (near(t.to) && t.from) way = back;
  else if (!near(t.from) && t.from && today.back && (t.days.includes(day.dow) || t.date === day.date) && !(weekdaysOnly(t.days) && holidayOn(day.date, t))) {
    // Neither end, on one of its days: by the clock (after the time out,
    // nearer the time back, and that not 30 minutes gone). Any other day,
    // or later that evening, it's the next time out.
    const mins = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    if (day.min > (today.time ? mins(today.time) + 60 : 12 * 60) && day.min <= mins(today.back) + 30 && Math.abs(day.min - mins(today.back)) < Math.abs(day.min - (today.time ? mins(today.time) : 0))) way = back;
  }
  // From the trip's own start; from where you are only when there (800 m), or
  // when its start is "wherever I am".
  const at800 = p => here && p && d(p) <= NEAR_END_M;
  const from = way.from && !at800(way.from) ? way.from : null;
  if (!way.to) return null;
  if (!from && at800(way.to)) return null;
  // The next time it's on: a recurring trip on its next day (a Sunday's is
  // Monday's), at that day's own time; else today's, or tomorrow's once past.
  // A weekdays-only trip (school, work) isn't on a national holiday: the next day it is.
  const offOn = date => weekdaysOnly(t.days) && holidayOn(date, t);
  let at = null;
  let late = null;
  let by = 'depart';
  // (A one-time trip's day may be weeks off: that day only.)
  const ahead = t.date ? Math.round((twAt(t.date, '12:00') - twAt(day.date, '12:00')) / 86_400_000) : 0;
  for (let n = ahead; n < ahead + 15; n++) {
    const dow = (day.dow + n) % 7;
    if (t.date && n !== ahead) break;
    if (t.days.length && (!t.days.includes(dow) || offOn(addDays(day.date, n)))) continue;
    const time = slotOf(t, dow)[way.key];
    if (!time) {
      if (t.days.length) continue;
      break;
    }
    const when = twAt(addDays(day.date, n), time);
    // Just gone (under 20 minutes): now (`late` says when it was, for the map's 建議).
    if (when < now - 20 * 60_000) continue;
    if (when > now) {
      at = when;
      by = way.rev ? 'depart' : t.by;
    } else late = when;
    break;
  }
  return { id: `${t.id}:${way.rev ? 'b' : 'f'}`, from, to: way.to, at, late, by, label: way.label, recurring: t.days.length > 0, today: (t.days.includes(day.dow) || t.date === day.date) && !offOn(day.date), date: t.date || '' };
}

// What the phone has of a saved trip's ways, asked of nobody (the map's 建議
// uses it): the way to take first, rolled on to now, or null when the ways
// kept are none or too old to trust. This session's plans (交通 read them)
// come before the phone's copy.
export function keptLead(w, { prefs = {}, here = null, picks = [], now = Date.now() } = {}) {
  const st = S.trips.get(w.id);
  let plans = st?.sig === tripSig(w) && !st.guess && st.plans?.length ? st.plans : null;
  if (!plans) {
    const kept = readTrips()[JSON.stringify([w.id, tripSig(w), prefs || {}])];
    if (!kept || replanWhy(kept, { w, here, picks, now })) return null;
    plans = w.by === 'arrive' ? kept.plans : rollPlans(kept.plans, now);
  }
  return tripPlans(plans, picks, now).first[0] || null;
}
// The pinned trains' next ones for the map's 建議 (their times read again, the
// day's trains as 交通 reads them): [{ p, rows }]. None pinned: nothing asked.
export async function pinnedTrainsNext(c) {
  ctx ||= c;
  if (!c.data.pins.length) return [];
  await trainPins();
  return c.data.pins.map(p => ({ p, rows: trainNext(p) }));
}

// A recurring trip whose time today has gone (over 20 minutes) while you're
// still not there: its way now, beside the next time's (Jay 2026-11-06, 08:21
// at home, 上學 showing only tomorrow's 06:23: "show both, the on time one for
// tomorrow and a right now one"). For three hours after today's time; never
// at its far end (the way back is then the trip), never a one-time trip.
const LATE_MS = 3 * 3_600_000;
export function tripLate(t, here, now = Date.now()) {
  const w = tripNow(t, here, now);
  if (!w?.at || t.date || !w.today || w.id.endsWith(':b')) return null;
  const day = tw(now);
  if (tw(w.at).date === day.date) return null;
  const time = slotOf(t, day.dow).time;
  const when = time ? twAt(day.date, time) : null;
  if (!when || when > now || now - when > LATE_MS) return null;
  return { ...w, id: `${t.id}:n`, at: null, by: 'depart', late: when };
}

// Saved trips in the order they matter: recurring ones today first, then the rest
// (a trip late today: its way now first, then its next time).
function trips(now = Date.now()) {
  return ctx.data.saved
    .flatMap(t => {
      const w = tripNow(t, ctx.here, now);
      const late = tripLate(t, ctx.here, now);
      return late ? [{ t, w: late }, { t, w }] : [{ t, w }];
    })
    // (A one-time trip comes in as its day nears: from the day before; until then it waits in 我的.)
    .filter(x => x.w && !(x.t.date && x.t.date > addDays(tw(now).date, 1)))
    .sort((a, b) => (b.w.recurring && b.w.today) - (a.w.recurring && a.w.today));
}

// ---- Loading ------------------------------------------------------------------------------------------

// A pinned bus with none on its way to your stop (尚未發車, 末班已過…): the
// timetable's next at that stop, as the route's own sheet says it (its stops
// and times from the bus packs, no proxy read), not 「尚未發車」.
async function plannedTimes(items) {
  const todo = items.filter(r => {
    const v = etaFor(S.pinned, r);
    return !(v?.status === 0 && v.sec != null) && r.routeUID;
  });
  await Promise.all(
    todo.map(async r => {
      try {
        const p = await plannedAt(r, r.lat != null ? { lat: r.lat, lon: r.lon } : null);
        // (A timetable's time doesn't change: one already known stays until
        // it's gone by, whatever a later read that failed says.)
        if (p) S.planned.set(r.stopUID, p);
        else if (!(S.planned.get(r.stopUID)?.at > Date.now())) S.planned.delete(r.stopUID);
      } catch {}
    })
  );
  if (todo.length) render();
}

// A pull down on the page (the kit's pull-to-refresh): the same read as the tab's own.
export const pull = () => (shown ? refresh() : undefined);
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    if (!ctx.here) await ctx.locate();
    const jobs = [];
    const items = ctx.data.groups.flatMap(g => g.items).map(sideOf);
    if (items.length) jobs.push(stopsEta(items).then(m => ((S.pinned = m), (S.pinnedAt = Date.now()))).then(() => plannedTimes(items)).catch(() => {}));
    jobs.push(trainPins());
    // (No 附近 here any more, Jay 2026-11-03: "basically useless". Its live read of every bus
    // around you every 20 s while 交通 was open is gone with it; the map has what's near.)
    jobs.push(loadNotices_());
    // The two trips that matter most get their plans at once (planned once, their times kept up: `loadTrip`).
    // (One shown on its last ways while they're found again isn't waited for: the opening lifts onto them.)
    for (const { w } of trips().slice(0, 2)) {
      const job = loadTrip(w);
      if (tripOf(w)?.guess) job.catch(() => {});
      else jobs.push(job);
    }
    for (const id of S.open) jobs.push(loadPlace(id));
    render();
    await Promise.all(jobs);
  } finally {
    refreshing = false;
  }
  render();
}

// What isn't running today: 台鐵, 高鐵, the buses of your city and of your
// trips' ends, the metros around you, YouBike around you.
async function loadNotices_() {
  const h = ctx.here;
  const ends = ctx.data.trips.flatMap(t => [t.from, t.to]).filter(p => p && Number.isFinite(p.lat)).slice(0, 6);
  const cities = [...new Set([ctx.city, ...(await Promise.all(ends.map(p => ctx.cityOf(p.lat, p.lon).catch(() => null))))].filter(Boolean))];
  const systems = h ? [...new Set(mapsNear([h.lat - 0.05, h.lon - 0.05, h.lat + 0.05, h.lon + 0.05]).flatMap(m => m.systems))] : [];
  S.notices = await loadNotices({ cities, systems, bikes: '' }).catch(() => S.notices);
}

async function trainPins() {
  const pins = ctx.data.pins;
  if (!pins.length) return;
  try {
    const now = Date.now();
    const span = railSpan(now);
    const net = await railNetwork(span.date, span);
    // (The delays from the boards of the pins' 台鐵 stations they leave from.)
    const delays = await traDelays(pins.filter(p => p.from?.sys === 'tra').map(p => p.from.id)).catch(() => new Map());
    for (const p of pins) {
      const from = `${p.from.sys}:${p.from.id}`;
      const to = `${p.to.sys}:${p.to.id}`;
      if (p.kind === 'train') {
        const js = journeys(net, [{ key: from, at: now }], [{ key: to, extra: 0 }], now, { n: 3 });
        S.trains.set(p.id, { rows: js.map(j => {
          const rides = j.legs.filter(l => !l.walk);
          return { dep: j.dep, arr: j.arr, label: rides.map(l => trainName(l.trip).replace(/ /g, '\u00a0')).join(' › '), delay: rides[0]?.trip.sys === 'tra' ? delays.get(rides[0].trip.no) || 0 : 0, sys: rides[0]?.trip.sys || '', type: rides[0]?.trip.type || '', no: rides[0]?.trip.no || '', stops: (rides[0]?.trip.stops || []).map(s => s.st), first: rides[0] ? trainName(rides[0].trip) : '', arrAt: rides.length === 1 ? j.arr : null };
        }) });
      } else {
        // That train today (or tomorrow, after it's gone): its times at your two stations.
        const runs = net.trips.filter(t => t.sys === p.sys && t.no === p.no);
        const times = runs.map(t => ({ a: t.stops.find(x => x.st === from), b: t.stops.find(x => x.st === to) })).filter(x => x.a && x.b && x.a.dep > now - 60_000);
        const x = times[0];
        S.trains.set(p.id, { rows: [{ dep: x ? x.a.dep : null, arr: x ? x.b.arr : null, label: x ? W(`${p.type || ''} ${p.no} 次`, `${trainKind(p.type || '')} ${p.no}`).trim() : W(`${p.no} 次今天不開或已過`, `Train ${p.no}: none today or gone`), delay: p.sys === 'tra' ? delays.get(p.no) || 0 : 0, sys: p.sys, type: p.type || '', no: p.no, stops: (runs[0]?.stops || []).map(s => s.st), arrAt: x ? x.b.arr : null }] });
      }
    }
  } catch (err) {
    // A failed read says so (rows read before stay); never 載入中… for good.
    for (const p of pins) if (!S.trains.get(p.id)?.rows) S.trains.set(p.id, { error: errorText(err) });
  }
}

// A trip's plans are planned once and used again: which ways go there
// (the lines, the stations, the changes) hardly change from one hour to
// the next; their times do, and those come from the timetables and the
// buses now, not from the planners (Google's and TDX's, each a billed ask).
// So the ways are kept (on the phone too, for the next opening), each
// way's next departure taking its place as one leaves, the buses due soon
// timed again from what they're doing now. Planned again only when the
// ways could be different (`replanWhy`):
//   - the trip changed (its ends, its time, the settings);
//   - from where you are, and you're 250 m from where it was planned (other
//     stops in reach);
//   - two hours on (by a time ahead: until that time, twelve at most): the
//     buses and trains running change through the day (a rush hour's
//     expresses, the last trains);
//   - the ways run out: a way you pinned, or all but one of the ways
//     recommended, with no departure left in the times kept;
//   - by an arrival time, the way to leave first gone (the way left late).
const TRIP_CACHE = 'ot.trips.v2';
const KEEP_MS = 2 * 3_600_000;
const KEEP_AHEAD_MS = 12 * 3_600_000;
const MOVED_M = 250;
const RETIME_MS = 60_000;
// What a trip's plans were made for: its ends and its time. A trip changed
// in its sheet (another end, another time) is planned again at once, not
// shown with the plans of the trip it was.
const tripSig = w => JSON.stringify([w.from ? [w.from.lat, w.from.lon] : null, w.to.lat, w.to.lon, w.at || 0, w.by || '']);
const tripKey = w => JSON.stringify([w.id, tripSig(w), ctx.data.prefs || {}]);
const tripOf = w => {
  const st = S.trips.get(w.id);
  return st && st.sig === tripSig(w) ? st : null;
};
// A way with no ride to wait for (walking, a YouBike ride) leaves whenever you do.
const anytime = p => !p.legs.some(isRide);
const shiftPlan = (p, d) => ({ ...p, dep: p.dep + d, arr: p.arr + d, legs: p.legs.map(l => ({ ...l, dep: l.dep + d, arr: l.arr + d })) });

// The kept plans now: a way whose departure has gone hands its card (its
// place among the recommendations, its tags, its times) to its next
// departure; a way you can leave on whenever leaves now. The list keeps its
// order (a card's times point into it).
// A YouBike to catch the bus further on (chase.mjs) leaves now while it can
// still be made, and is gone once it can't (or the bus's times say so: `lost`).
export function rollPlans(plans, now = Date.now()) {
  const gone = p => p.lost || p.dep < now - 2 * 60_000;
  const out = plans.map(p => (anytime(p) && p.dep < now ? shiftPlan(p, now - p.dep) : chaseOf(p) && !p.lost ? chaseNow(p, now) || { ...p, lost: true } : p));
  out.forEach((p, i) => {
    if (!p.lead || !gone(p)) return;
    // (Its times: the departures its card offers.)
    const sig = pickSig(p);
    const mates = p.times?.length ? p.times : out.map((q, j) => (pickSig(q) === sig ? j : -1));
    let next = -1;
    for (const j of mates) if (j !== i && out[j] && !out[j].lead && !gone(out[j]) && (next < 0 || out[j].dep < out[next].dep)) next = j;
    if (next < 0) return;
    const q = out[next];
    out[next] = { ...q, lead: true, top: p.top, weak: p.weak, tags: p.tags, score: p.score, times: p.times };
    out[i] = { ...p, lead: false, top: false };
  });
  return out;
}

// Why a kept trip's ways have to be found again, or '' when they're good.
// `kept`: { at, from, plans } (the plans as planned); `here`: where you are.
export function replanWhy(kept, { w, here = null, picks = [], now = Date.now() }) {
  if (!kept?.plans?.length) return 'none';
  const ahead = w.at && w.by !== 'arrive' && w.at > now;
  if (now - kept.at > (ahead ? Math.min(KEEP_AHEAD_MS, Math.max(KEEP_MS, w.at - kept.at)) : KEEP_MS)) return 'old';
  if (!w.from && (!here || !kept.from || meters(here.lat, here.lon, kept.from.lat, kept.from.lon) > MOVED_M)) return 'moved';
  const live = p => p.dep >= now - 2 * 60_000;
  const good = kept.plans.filter(p => p.lead && !p.weak);
  if (w.by === 'arrive') return good.some(p => !live(p)) ? 'gone' : '';
  // Each way's departures still ahead, as rolling on would show them.
  const ways = new Set(kept.plans.filter(live).map(pickSig));
  if (picks.some(k => kept.plans.some(p => pickSig(p) === k) && !ways.has(k))) return 'pinned gone';
  // (The recommendations, the ways shown first.)
  const top = good.filter(p => p.top);
  const shown = new Set(top.map(pickSig));
  const left = [...shown].filter(k => ways.has(k) || top.some(p => pickSig(p) === k && anytime(p))).length;
  return left < Math.min(2, shown.size) ? 'run out' : '';
}

function readTrips() {
  return readJson(TRIP_CACHE, {}) || {};
}
function keepTrip(key, kept) {
  try {
    const read = readSaved(TRIP_CACHE, {});
    if (read === UNREAD) return; // (never saved over)
    const all = read || {};
    const now = Date.now();
    for (const k of Object.keys(all)) if (now - all[k].at > KEEP_AHEAD_MS) delete all[k];
    // (Promises, the later buses on their way, aren't kept.)
    all[key] = JSON.parse(JSON.stringify({ at: kept.at, from: kept.from, plans: kept.plans }, (k, v) => (v instanceof Promise ? undefined : v)));
    writeJson(TRIP_CACHE, all);
  } catch {}
}
// A trip's last ways, a day or more on (Jay 2026-11-06: 上學 sat on 找班次… every
// morning, its ways two hours old by then, planned again from nothing: 4–7 s and
// about 100 reads). Each way of a saved trip keeps its last ways found, a slim
// copy (the ways shown and their departures in the next three hours), eight
// days. Opened again at about the same time (within 90 minutes) on the same
// kind of day (a working day or a day off), they're shown at once, moved on by
// whole days, said 更新中… and never navigated or notified on, while the ways
// are found again as before; nothing found or a failure: they go. No read of
// their own: the same planning as before, only not a blank card meanwhile.
const LAST_CACHE = 'ot.trips.last.v1';
const DAY_MS = 86_400_000;
const LAST_DAYS = 8;
const LAST_SLACK_MS = 90 * 60_000;
const LAST_AHEAD_MS = 3 * 3_600_000;
// The ways a card shows and their departures within three hours of `t`, their `times` pointing into the slim list.
export function slimPlans(plans, t) {
  const keep = new Set();
  plans.forEach((p, i) => {
    if (!p.lead) return;
    keep.add(i);
    for (const j of p.times || []) if (plans[j] && plans[j].dep < t + LAST_AHEAD_MS) keep.add(j);
  });
  const idx = [...keep].sort((a, b) => a - b);
  const at = new Map(idx.map((j, k) => [j, k]));
  return idx.map(j => {
    const p = plans[j];
    return p.times ? { ...p, times: p.times.filter(x => at.has(x)).map(x => at.get(x)) } : p;
  });
}
// The last ways moved on to today, or null when they don't fit now (another
// kind of day, another hour, another start, other settings, a week old, or no
// way shown still to come). `last`: { at, t, work, from, prefs, plans }.
export function lastGuess(last, { w, here = null, prefs = '{}', now = Date.now() }) {
  if (!last?.plans?.length || last.prefs !== prefs) return null;
  const from = w.from || here;
  if (!from || !last.from || meters(from.lat, from.lon, last.from.lat, last.from.lon) > MOVED_M) return null;
  const t = w.at || now;
  const days = Math.round((t - last.t) / DAY_MS);
  if (days < 0 || days > LAST_DAYS || Math.abs(t - last.t - days * DAY_MS) > LAST_SLACK_MS) return null;
  if (workday(tw(t).date) !== last.work) return null;
  const d = days * DAY_MS;
  const moved = last.plans.map(p => ({ ...shiftPlan(p, d), legs: p.legs.map(l => ({ ...l, dep: l.dep + d, arr: l.arr + d, live: false })), live: false }));
  const plans = w.by === 'arrive' ? moved : rollPlans(moved, now);
  return plans.some(p => p.lead && p.top && !p.weak && (anytime(p) || p.dep >= now - 2 * 60_000)) ? plans : null;
}
const readLast = () => readJson(LAST_CACHE, {}) || {};
function keepLast(w, { at, from, plans }) {
  try {
    const read = readSaved(LAST_CACHE, {});
    if (read === UNREAD) return;
    const all = read || {};
    const now = Date.now();
    for (const k of Object.keys(all)) if (now - all[k].at > LAST_DAYS * DAY_MS || !ctx.data.saved.some(t => k.startsWith(`${t.id}:`))) delete all[k];
    const t = w.at || at;
    all[w.id] = JSON.parse(JSON.stringify({ at, t, work: workday(tw(t).date), from, prefs: JSON.stringify(ctx.data.prefs || {}), plans: slimPlans(plans, t) }, (k, v) => (v instanceof Promise ? undefined : v)));
    writeJson(LAST_CACHE, all);
  } catch {}
}
// The kept plans as they are now: rolled on, the buses due soon timed by what they're doing.
async function retimed(base, w) {
  const now = Date.now();
  const { adjustPlan } = await import('./live.mjs');
  // (From when you can set out: now, or the trip's time; by an arrival time, as planned.)
  const start = w.by === 'arrive' ? null : Math.max(now, w.at || now);
  const plans = w.by === 'arrive' ? base : rollPlans(base, now);
  const out = await Promise.all(plans.map(p => (!p.lost && p.legs.some(l => l.mode === 'bus' && l.dep < now + 90 * 60_000 && l.dep >= now - 2 * 60_000) ? adjustPlan(p, now, { start }).catch(() => p) : p)));
  // (At the stop a few minutes early, by the bus's time now; a chase its bus's
  // times say can't be made any more hands its card on, as a gone one does.)
  const timed = out.map(p => boardEarly(p, start ?? now));
  return timed.some(p => p.lost) && w.by !== 'arrive' ? rollPlans(timed, now) : timed;
}

async function loadTrip(w, { force = false } = {}) {
  const old = tripOf(w);
  const sig = tripSig(w);
  if (!old && S.trips.has(w.id)) {
    S.trips.delete(w.id);
    for (const k of [...S.choice.keys()]) if (k.startsWith(`${w.id}:`)) S.choice.delete(k);
  }
  if (old?.loading) return;
  const here = ctx.here ? { lat: ctx.here.lat, lon: ctx.here.lon } : null;
  const picks = ctx.data.saved.find(t => w.id.startsWith(`${t.id}:`))?.picks || [];
  // The ways found before (this session's, else the phone's): their times now.
  const kept = force ? null : old?.base ? { at: old.at, from: old.from, plans: old.base } : readTrips()[tripKey(w)];
  if (kept && !replanWhy(kept, { w, here, picks })) {
    if (old?.base && Date.now() - old.timed < RETIME_MS) return;
    // (Shown at once as kept, rolled on to now; the buses' times follow.)
    if (!old?.plans) S.trips.set(w.id, { sig, at: kept.at, from: w.from || { name: W('目前位置', 'Here'), ...kept.from }, base: kept.plans, timed: 0, plans: w.by === 'arrive' ? kept.plans : rollPlans(kept.plans, Date.now()), error: '', kept: true });
    const plans = await retimed(kept.plans, w).catch(() => null);
    if (plans) {
      const cur = S.trips.get(w.id);
      // (A way's card moved on to its next departure: the time picked on it with it.)
      if (cur?.plans && cur.plans.some((p, i) => p.lead !== plans[i]?.lead)) for (const k of [...S.choice.keys()]) if (k.startsWith(`${w.id}:`)) S.choice.delete(k);
      S.trips.set(w.id, { sig, at: kept.at, from: w.from || { name: W('目前位置', 'Here'), ...kept.from }, base: kept.plans, timed: Date.now(), plans, error: '', kept: true });
      return render();
    }
  }
  // (Nothing of this session's to show meanwhile: the last ways, a day or more on, said 更新中….)
  const guess = old?.plans?.length ? null : lastGuess(readLast()[w.id], { w, here, prefs: JSON.stringify(ctx.data.prefs || {}) });
  S.trips.set(w.id, { ...(old || {}), sig, loading: true, ...(guess ? { plans: guess, guess: true } : {}) });
  render();
  try {
    const from = w.from || (here ? { name: W('目前位置', 'Here'), ...here } : null);
    if (!from) throw Object.assign(new Error('nohere'), { code: 'NO_HERE' });
    const at = Date.now();
    // The whole plan before it's shown (its second round too, steady.mjs
    // `settled`): what's on the card meanwhile (its last ways, said 更新中…) stays till then.
    const out = await settled(await planTrip(ctx.data, from, w.to, { at: w.at, by: w.by }));
    for (const k of [...S.choice.keys()]) if (k.startsWith(`${w.id}:`)) S.choice.delete(k);
    // (The near stop or the further one by bike, whichever the card showed, kept: chase.mjs steadyLead.)
    const shownBefore = old?.plans;
    const done = found => {
      // What's on screen keeps its place: each way its rank and labels, only its
      // times new (steady.mjs; Jay 2026-11-06: "it update the trip in front of me").
      // The phone keeps the ways as ranked (the next opening's guess ranks afresh).
      const prev = S.trips.get(w.id)?.plans || shownBefore;
      const plans = shown && prev?.length ? steadyPlans(prev, steadyLead(found, prev, Date.now())) : steadyLead(found, prev, Date.now());
      S.trips.set(w.id, { sig, at, from, base: plans, timed: Date.now(), plans, error: '' });
      keepTrip(tripKey(w), { at, from: { lat: from.lat, lon: from.lon }, plans: found });
      keepLast(w, { at, from: { lat: from.lat, lon: from.lon }, plans: found });
      return plans;
    };
    const firstShown = out.plans.length ? done(out.plans) : null;
    if (!firstShown) S.trips.set(w.id, { sig, at, from, plans: [], error: out.error ? errorText(out.error) : W('找不到大眾運輸方案。', 'No transit route found.') });
    // The direct buses and every bus's times, when they took longer than the wait: merged in place (unless a time was picked meanwhile).
    out.pending?.then(o => {
      const cur = S.trips.get(w.id);
      if (!o?.plans?.length || !firstShown || cur?.plans !== firstShown || [...S.choice.keys()].some(k => k.startsWith(`${w.id}:`))) return;
      done(o.plans);
      render();
    });
  } catch (err) {
    S.trips.set(w.id, { sig, at: Date.now(), plans: old?.plans || [], base: old?.base, timed: old?.timed, error: err.code === 'NO_HERE' ? W('需要你的位置。', 'Needs your location.') : errorText(err) });
  }
  render();
}

// The stops and YouBike stations around you: the first thing to catch when
// nothing is pinned, and what's near beside what is.
async function loadPlace(id) {
  const p = ctx.data.places.find(x => x.id === id);
  if (!p) return;
  const old = S.places.get(id);
  if (old && Date.now() - old.at < 25_000) return;
  try {
    const [stops, bikes] = await Promise.all([nearStops(p, { n: 2, r: 400 }), bikesAround(p.lat, p.lon).catch(() => [])]);
    S.places.set(id, { at: Date.now(), stops, bikes: bikes.map(s => ({ ...s, d: meters(p.lat, p.lon, s.lat, s.lon) })).filter(s => s.d <= 500).sort((a, b) => a.d - b.d).slice(0, 2) });
    // The buses shown with none on their way: the timetable's next there.
    const quiet = placeBuses(stops).filter(x => !(x.v?.status === 0 && x.v.sec != null) && !S.planned.has(x.stopUID));
    if (quiet.length) Promise.all(quiet.map(x => plannedAt({ routeUID: x.uid, route: x.route, city: x.city, dir: x.dir, stopUID: x.stopUID }, x).then(q => q && S.planned.set(x.stopUID, q), () => {}))).then(render);
  } catch (err) {
    S.places.set(id, { at: Date.now(), error: errorText(err), stops: old?.stops || [], bikes: old?.bikes || [] });
  }
}

// ---- Drawing ------------------------------------------------------------------------------------------
// One page: the next ride you'd take as its card (that ride said there and
// nowhere else on the page), your places as a row to scroll, then your
// trips, what you pinned and what's near, each a card of rows.

const routeAttr = x => `data-route="${e(JSON.stringify({ uid: x.uid, name: x.name, city: x.city, stopUID: x.stopUID, dir: x.dir }))}"`;
// The buses shown near a pinned place: the three soonest at each of its stops, the five soonest of those.
const placeBuses = stops =>
  stops
    .flatMap(st => st.rows.slice(0, 3).map(r => ({ ...r, lat: st.lat, lon: st.lon })))
    .sort((a, b) => etaRank(a.v) - etaRank(b.v))
    .slice(0, 5);
const busRow = x => {
  const pinned = ctx.data.groups.some(g => g.items.some(i => i.stopUID === x.stopUID));
  return `<div class="ot-strip">${strip({ no: x.route, note: x.dir ? W('返程', 'Return') : W('去程', 'Outbound'), main: e(nameIn(x.stop || '')), eta: busWhen(x.v, S.planned.get(x.stopUID)), attrs: routeAttr({ uid: x.uid, name: x.route, city: x.city, stopUID: x.stopUID, dir: x.dir }) })}<button class="q-icon-btn ot-strip-act${pinned ? ' on' : ''}" type="button" data-pinbus="${e(JSON.stringify({ city: x.city, routeUID: x.uid, route: x.route, dir: x.dir, stopUID: x.stopUID, stop: x.stop, lat: x.lat, lon: x.lon }))}" aria-label="${W('釘選', 'Pin')}" ${pinned ? 'disabled' : ''}>${icon('star')}</button></div>`;
};

// A trip's plans to show: the ways you pinned first (their next
// departure), then the recommendations, up to four; the rest behind 更多:
// one per route (its best departure), none set aside as no way to go.
export function tripPlans(plans, picks = [], now = Date.now()) {
  const live = plans.filter(p => p.dep >= now - 2 * 60_000);
  // A pinned way: its next departure (the others are its times to pick).
  const pinned = [];
  for (const k of picks) pinned.push(...live.filter(p => pickSig(p) === k).sort((a, b) => a.dep - b.dep).slice(0, 1));
  // (The recommendations best first, as the map lists them: a way rolled on to
  // its next departure keeps its place in the list, not its rank.)
  const tops = live.filter(p => p.top && !pinned.includes(p)).sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.arr - b.arr);
  const first = [...pinned, ...tops].slice(0, Math.max(4, pinned.length));
  return { first, rest: live.filter(p => !first.includes(p) && p.lead !== false && !p.weak && !picks.includes(pickSig(p))) };
}

// Under a ride's countdown: its clock time, or its day when not today.
// (Never the clock the big number already shows: past an hour it is the clock.)
const whenSmall = at => {
  const far = (at - Date.now()) / 60_000 >= 59.5;
  const other = tw(at).date !== tw().date;
  return other ? `${dayLabel(tw(at).date)}${far ? '' : ` ${hm(at)}`}` : far ? '' : hm(at);
};

// A one-time trip (a day picked, not every week): told 10 minutes before it's time to leave, the app
// closed or not (the Worker sends it). When to leave: the way found for it once there is one, else its
// time out (by an arrival time, an hour before it until a way is found).
const LEAVE_SOON_MS = 10 * 60_000;
function tripPush(now = Date.now()) {
  const items = [];
  for (const t of ctx.data.saved) {
    if (!t.date) continue;
    const w = tripNow(t, null, now);
    if (!w?.at || w.id.endsWith(':b')) continue;
    const st = S.trips.get(w.id);
    const lead = (st?.guess ? null : st?.plans?.find(p => p.top && p.lead !== false)) || keptLead(w, { prefs: ctx.data.prefs, picks: t.picks, now });
    const dep = lead?.dep ?? (w.by === 'arrive' ? w.at - 60 * 60_000 : w.at);
    if (dep - LEAVE_SOON_MS < now - 60_000) continue;
    items.push({ at: dep - LEAVE_SOON_MS, title: W(`${t.name || t.to.name}：10 分鐘後出發`, `${t.name || t.to.name}: leave in 10 min`), body: W(`${hm(dep)} 出發${lead ? `，${hm(lead.arr)} 到` : ''}`, `Leave ${hm(dep)}${lead ? `, there ${hm(lead.arr)}` : ''}`), tag: `trip:${t.id}:${t.date}`, kind: 'trip', hash: 'go' });
  }
  setTripPush(items);
}
function render() {
  tripPush();
  if (!shown) return;
  const ts = trips();
  // (A trip just changed in its sheet: its new plans, now.)
  for (const { w } of ts.slice(0, 2)) if (!tripOf(w) && S.trips.has(w.id)) queueMicrotask(() => loadTrip(w));
  renderBoard(ts);
}

// ---- 交通 as one board (board.mjs; Jay 2026-11-03, the green card's "kind of useless") ----------------------
// Your trips and pins first, a row each in the order you keep them (none
// taken up into a card, none moved as their times change), then what's near.

// A trip's row with no ride to show says why, never nothing: the read failed,
// it's being read, none now, or not read yet (a tap reads it).
export const tripWhy = st => (st?.error && !st.plans?.length ? st.error : st ? (st.loading ? W('找班次…', 'Finding rides…') : W('現在沒有班次', 'No rides now')) : W('點一下找班次', 'Tap for rides'));
// A way as one line through it (ui.mjs journeyLine): each ride its line's colour, a walk dotted.
const wayLine = p => journeyLine(p.legs.filter(l => !(l.mode === 'walk' && l.dur < 120)).map(l => (l.mode === 'walk' ? { walk: true, min: l.dur / 60 } : { min: (l.dur || (l.arr - l.dep) / 1000) / 60, color: legColor(l) })));
const warnOf = p => {
  const late = lateBy(p, p.arr);
  return p.off || p.miss || p.late || (late ? W(`晚 ${late} 分到`, `${late} min late`) : '');
};
// A trip as its own card (Jay 2026-11-03: 交通 "boring"): on top its main ride's badge, its name,
// where it goes, and when to leave counting down; under it the way it takes as one line, leave
// and arrive at its ends and its rides as chips; then the next ways to pick from at once.
// A tap on the top opens its ways on the map, on a way that way (導航 a tap away there).
const WAYS_MS = 3 * 3600_000;
// The card's 其他班次: the next ways as the map's plans card lists them (pinned,
// then the recommendations best first, then the rest), those leaving within
// three hours of the way shown, not of now: a trip at 16:45 opened at 14:05
// lost 快捷8號支 at 17:07, past 17:05, while the map listed it (Jay 2026-11-10).
// Every recommendation the map shows (up to 3 under the one on top), the rest
// only to make two (a card with a 4th 推薦 way left it off: "different result").
export function otherWays(first, rest, p, n = 2) {
  const near = q => q !== p && q.dep < p.dep + WAYS_MS;
  const tops = first.filter(near);
  return [...tops, ...rest.filter(near)].slice(0, Math.max(n, tops.length));
}
function tripCard({ t, w }) {
  const st = tripOf(w);
  const all = st?.plans || [];
  const { first, rest } = tripPlans(all, t.picks);
  const lead = first[0];
  const where = `${w.from ? nameIn(w.from.name) : W('這裡', 'Here')} → ${nameIn(w.to?.name || W('這裡', 'Here'))}`;
  const mark = tripTile(w.rev ? '' : t.name || '', ctx.data.places.find(q => w.to && meters(q.lat, q.lon, w.to.lat, w.to.lon) < 80), !!t.date);
  if (!lead) return `<div class="q-rowcard ob-trip">${boardRow({ lead: mark, main: e(w.label), note: e(tripWhy(st)), attrs: st ? `data-all-trip="${e(w.id)}"` : `data-load-trip="${e(t.id)}"` })}</div>`;
  const at = all.indexOf(lead);
  const i = S.choice.get(`${w.id}:${at}`) ?? at;
  const p = all[i];
  const warn = warnOf(p);
  const head = boardRow({
    lead: mark,
    main: e(w.label),
    // (The last ways moved on to today, while they're found again: said so, not where it goes.)
    note: st.guess ? e(W('更新中…', 'Updating…')) : warn ? `<span class="ot-warn">${e(warn)}</span>` : e(where),
    // (Another day's: its day said, 明天 出發, beside its way now.)
    when: whenHtml(p.dep, tw(p.dep).date === tw().date ? W('出發', 'Leave') : `${dayLabel(tw(p.dep).date)}${W(' 出發', '')}`, p.live),
    attrs: `data-all-trip="${e(w.id)}"`
  });
  const way = `<button class="ob-trip-way q-press" type="button" data-nav-trip="${e(w.id)}" data-i="${i}"><span class="ob-trip-line">${wayLine(p)}<b>${e(hm(p.arr))}<small>${W('到', ' in')}</small></b></span><span class="ot-legs">${legChips(p.legs)}</span></button>`;
  const more = otherWays(first, rest, p);
  const others = more.length
    ? `<div class="ob-ways"><span class="ob-ways-h">${W('其他班次', 'Other ways')}</span>${more
        .map(q => {
          const wq = warnOf(q);
          return `<button class="ob-way q-press" type="button" data-nav-trip="${e(w.id)}" data-i="${all.indexOf(q)}"><span class="ob-way-when${q.live ? ' live' : ''}">${e(hm(q.dep))}</span><span class="ob-way-mid"><span class="ot-legs">${legChips(q.legs)}</span>${wq ? `<small class="ot-warn">${e(wq)}</small>` : ''}</span><span class="ob-way-arr"><b>${e(hm(q.arr))}</b><small>${e(W(`${Math.round(q.dur / 60)} 分`, `${Math.round(q.dur / 60)} min`))}</small></span></button>`;
        })
        .join('')}</div>`
    : '';
  return `<div class="q-rowcard ob-trip">${head}${way}${others}</div>`;
}
// A pinned bus's row, as 釘選's (its way round a tap on its tag), in the order pinned.
function boardBuses() {
  return ctx.data.groups
    .flatMap(g => g.items)
    .map(it => {
      const r = sideOf(it);
      const v = etaFor(S.pinned, r);
      const dir = it.back ? `<span class="ot-strip-dir" role="button" data-flip="${e(it.id)}" aria-label="${r.back ? W('回程，改看去程', 'Return; show outbound') : W('去程，改看回程', 'Outbound; show return')}">${icon('swap')}${r.back ? W('回程', 'Return') : W('去程', 'Out')}</span>` : '';
      const note = r.off ? `${dir}${W('到', 'to')} ${e(nameIn(r.off.stop))}${it.n ? `<span class="ot-drop"> · ${W(`${it.n} 站`, `${it.n} stops`)}</span>` : ''}` : `${W('往', 'to')} ${e(nameIn(r.headsign || '—'))}`;
      return `<div class="ot-strip">${strip({ no: it.route, note, main: e(nameIn(r.stop)), eta: busWhen(v, S.planned.get(r.stopUID)), attrs: routeAttr({ uid: it.routeUID, name: it.route, city: it.city, stopUID: r.stopUID, dir: r.dir }) })}</div>`;
    });
}
// A pinned train's next ones (a train number's whole day; else from a minute ago).
const trainNext = p => (S.trains.get(p.id)?.rows || []).filter(x => x.dep == null || x.dep > Date.now() - 60_000 || p.kind === 'trainNo');
// A pinned train's row: the next one's kind on the badge in its colour, its number and the one after.
const kindOf = x => (x.sys === 'hsr' ? W('高鐵', 'HSR') : trainKind(String(x.type || '').replace(/[（(].*$/, '').replace(/號.*$/, '').replace(/車$/, '')) || W('台鐵', 'TRA'));
function boardTrains() {
  return ctx.data.pins.map(p => {
    const got = S.trains.get(p.id);
    const rows = trainNext(p).filter(x => x.dep != null);
    const [x, y] = rows;
    const main = `${e(stationLabel(p.from))} → ${e(stationLabel(p.to))}`;
    if (!x) return boardRow({ glyph: p.from.sys === 'hsr' ? 'hsr' : 'tra', color: p.from.sys === 'hsr' ? COLOR.hsr : COLOR.tra, main, note: e(!got ? W('載入中…', 'Loading…') : got.error || W('今天沒有車了', 'No more trains today')), attrs: `data-times="${e(p.id)}"` });
    const sys = x.sys || p.from.sys;
    const note = [e(x.label), x.delay ? `<span class="ot-late${x.sys === 'tra' && x.no ? ' ot-slow" role="button" tabindex="0" data-slow="' + e(p.id) + '" aria-label="' + e(W('這班為什麼慢', 'Why it’s late')) + '">' + (kitUI.icons?.ai || '') : '">'}${e(W(`晚 ${x.delay} 分`, `${x.delay} min late`))}</span>` : '', ''].filter(Boolean).join(' · ') + (y ? `<span class="ot-drop"> · ${e(W(`下一班 ${hm(y.dep)}`, `then ${hm(y.dep)}`))}</span>` : '');
    return boardRow({ no: kindOf({ ...x, sys }), color: trainColor({ sys, type: x.type }), main, note, when: whenHtml(x.dep, whenSmall(x.dep)), attrs: `data-times="${e(p.id)}"` });
  });
}
function renderBoard(ts) {
  const box = $('panel-go');
  const keep = box.scrollTop;
  const railX = box.querySelector('.ob-places')?.scrollLeft || 0;
  const here = ctx.here;
  const places = ctx.data.places.filter(p => !here || meters(here.lat, here.lon, p.lat, p.lon) > 300);
  // (✦ beside it: 用說的查路線, lib/say-trip.mjs.)
  const plan = `<div class="ob-plan-row"><button class="ob-plan q-press" type="button" data-plan-to="1">${icon('search')}<span>${W('要去哪裡？', 'Where to?')}</span></button>${kitUI.icons?.ai ? `<button class="ob-say q-press" type="button" data-say-trip="1" aria-label="${W('用說的查路線', 'Say your trip')}">${kitUI.icons.ai}</button>` : ''}</div>${places.length ? `<div class="ob-places">${places.map(p => `<button class="ob-place q-press" type="button" data-place="${e(p.id)}">${tile(PLACE_ICONS[p.icon] || 'pin', PLACE_COLOR[p.icon] || COLOR.place, 'sm')}<span>${e(nameIn(p.name))}</span></button>`).join('')}</div>` : ''}`;
  // Your trips, each its own card; then what you've pinned, a row each in the order you keep
  // them (on a wide screen beside the trips, where 附近 was: Jay 2026-11-03, "basically useless";
  // 要去哪裡 and your places across the top, so the trips and the pins start level: Jay's iPad
  // 2026-11-11, one pinned row beside the search and a trip, a half screen empty under it).
  const tripsHtml = ts.length ? section(W('行程', 'Trips'), `<div class="ob-trips">${ts.map(tripCard).join('')}</div>`) : '';
  const pins = [...boardBuses(), ...boardTrains()].join('');
  const pinsHtml = pins ? section(W('釘選', 'Pinned'), rowCard(pins)) : '';
  const empty = !tripsHtml && !pinsHtml ? section(W('我的路線', 'My rides'), `<div class="q-rowcard ob-empty"><p>${W('釘選常搭的車，時間都在這裡', 'Pin what you ride: its times show here')}</p><button class="q-btn" type="button" data-new-trip="1">${icon('plus')} ${W('新增行程', 'Add a trip')}</button></div>`) : '';
  box.innerHTML = `<div class="ot-page ob-page">
    ${navTitle(W('交通', 'Transit'))}
    <div class="q-cols ot-cols ob-cols${pinsHtml ? '' : ' ob-solo'}">
      <div class="q-span">${noticesHtml(S.notices)}${plan}</div>
      <div>${tripsHtml}${empty}</div>
      ${pinsHtml ? `<div>${pinsHtml}</div>` : ''}
    </div>
  </div>`;
  kitUI.wireNavTitles(box);
  fitStrips(box);
  fitLegs(box);
  box.scrollTop = keep;
  const rail = box.querySelector('.ob-places');
  if (rail) rail.scrollLeft = railX;
  if (placeOpen) placeOpen.draw();
}

// ---- A place: its buses, its bikes, and how to get there ------------------------------------------------

let placeOpen = null;
function openPlace(id) {
  const p = ctx.data.places.find(x => x.id === id);
  if (!p) return;
  const d = sheet('', 'ot-place-sheet');
  const draw = () => {
    if (!d.open) return;
    const x = S.places.get(id);
    const here = ctx.here;
    const buses = x ? placeBuses(x.stops) : [];
    d.innerHTML = `${sheetHead(e(p.name), here ? e(distText(meters(here.lat, here.lon, p.lat, p.lon))) : '', tile(PLACE_ICONS[p.icon] || 'pin', PLACE_COLOR[p.icon] || COLOR.place))}
      ${!x ? `<p class="ot-note">${W('載入中…', 'Loading…')}</p>` : x.error ? `<p class="ot-note bad">${e(x.error)}</p>` : ''}
      ${buses.length ? `<h3 class="q-sheet-h">${W('公車', 'Buses')}</h3>${rowCard(buses.map(busRow).join(''))}` : ''}
      ${x?.bikes.length ? `<h3 class="q-sheet-h">YouBike</h3>${nearBikes(x.bikes)}` : ''}
      <button class="q-btn primary block ot-sheet-go" type="button" data-go-place="${e(id)}">${icon('route')} ${W('怎麼去', 'Directions')}</button>`;
    fitStrips(d);
  };
  placeOpen = { id, draw };
  S.open.add(id);
  draw();
  loadPlace(id).then(draw);
  const t = setInterval(() => loadPlace(id).then(draw), liveMs());
  d.onclosed = () => {
    clearInterval(t);
    S.open.delete(id);
    if (placeOpen?.id === id) placeOpen = null;
  };
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-go-place]')) {
      d.shut();
      return ctx.openTrip(null, { name: p.name, lat: p.lat, lon: p.lon, ...(p.gid ? { gid: p.gid } : {}) });
    }
    onClick(ev);
  });
}

// ---- Taps ---------------------------------------------------------------------------------------------

function onClick(ev) {
  // (The 去程/回程 tag is inside its row: turned round, not the route opened.)
  const fl = ev.target.closest('[data-flip]');
  if (fl) {
    const id = fl.dataset.flip;
    S.flip.has(id) ? S.flip.delete(id) : S.flip.add(id);
    render();
    return refresh();
  }
  // A YouBike station: on the map, its card open.
  const bk = ev.target.closest('[data-bk]');
  if (bk) {
    const b = [...[...S.places.values()].flatMap(x => x.bikes || [])].find(x => x.uid === bk.dataset.bk);
    if (!b) return;
    ctx.mapFocus = { ...b, sys: 'bike' };
    return ctx.goTab('map');
  }
  const r = ev.target.closest('[data-route]');
  if (r) {
    const x = JSON.parse(r.dataset.route);
    return openRoute(ctx, { uid: x.uid, name: x.name, city: x.city }, { stopUID: x.stopUID, dir: x.dir });
  }
  const ub = ev.target.closest('[data-unpin-bus]');
  if (ub) {
    const id = ub.dataset.unpinBus;
    ctx.data.groups = ctx.data.groups.map(g => ({ ...g, items: g.items.filter(i => i.id !== id) }));
    ctx.save();
    ctx.status(W('已取消釘選', 'Unpinned'));
    return render();
  }
  const ut = ev.target.closest('[data-unpin-train]');
  if (ut) {
    ctx.data.pins = ctx.data.pins.filter(p => p.id !== ut.dataset.unpinTrain);
    ctx.save();
    ctx.status(W('已取消釘選', 'Unpinned'));
    return render();
  }
  const pb = ev.target.closest('[data-pinbus]');
  if (pb) return chooseGroup(JSON.parse(pb.dataset.pinbus), render);
  const all = ev.target.closest('[data-all-trip]');
  if (all) {
    const w = trips().find(x => x.w.id === all.dataset.allTrip)?.w;
    // (The ways this card ranked, so the map's first is the card's.)
    // (Not the last ways shown while they're found again: the map finds them.)
    if (w) return ctx.openTrip(w.from, w.to, { at: w.at, by: w.by, plans: tripOf(w)?.plans?.length && !tripOf(w).guess ? tripOf(w).plans : null });
  }
  const lt = ev.target.closest('[data-load-trip]');
  if (lt) {
    const w = trips().find(x => x.t.id === lt.dataset.loadTrip)?.w;
    if (w) return loadTrip(w, { force: true });
  }
  // One of a trip's ways: that one on the map, ready to go.
  const nt = ev.target.closest('[data-nav-trip]');
  if (nt) {
    const x = trips().find(y => y.w.id === nt.dataset.navTrip);
    // (A way of the last ways, shown while they're found again, is never navigated: the map finds them.)
    if (x && tripOf(x.w)?.guess) return ctx.openTrip(x.w.from, x.w.to, { at: x.w.at, by: x.w.by, plans: null });
    const all = (x && tripOf(x.w)?.plans) || [];
    const p = all[Number(nt.dataset.i)];
    // (Not the way shown first: picked, its train kept as chosen.)
    const lead = p && tripPlans(all, x.t.picks).first[0];
    if (p) return ctx.navPlan(p, x.w.from, x.w.to || p.legs.at(-1).to, p !== lead ? { among: all } : {});
  }
  const pl = ev.target.closest('[data-place]');
  if (pl) return openPlace(pl.dataset.place);
  const gp = ev.target.closest('[data-go-place]');
  if (gp) {
    const p = ctx.data.places.find(x => x.id === gp.dataset.goPlace);
    if (p) return ctx.openTrip(null, { name: p.name, lat: p.lat, lon: p.lon, ...(p.gid ? { gid: p.gid } : {}) });
  }
  const sl = ev.target.closest('[data-slow]');
  if (sl) return void openSlow(sl.dataset.slow);
  const tm = ev.target.closest('[data-times]');
  if (tm) {
    const p = ctx.data.pins.find(x => x.id === tm.dataset.times);
    if (p) {
      ctx.trainQuery = { from: p.from, to: p.to };
      return ctx.goTab('times');
    }
  }
  if (ev.target.closest('[data-plan-to]')) return ctx.planTo?.();
  if (ev.target.closest('[data-say-trip]')) return void import('./say-trip.mjs').then(m => m.openSayTrip(ctx)).catch(() => {});
  if (ev.target.closest('[data-new-trip]')) return ctx.newTrip?.();
}

// 這班為什麼慢 (lib/slow.mjs): a late 台鐵 train's delay with where it is, when it
// reaches your station and 台鐵's notices on its way; code, under the Orbit AI mark.
async function openSlow(id) {
  const p = ctx.data.pins.find(x => x.id === id);
  const x = p && trainNext(p)[0];
  if (!x?.no) return;
  const ai = await import('#kit/ai.mjs').catch(() => null);
  const body = kitUI.h('div', { class: 'ot-slow-body', 'aria-live': 'polite' }, [ai?.aiAnswerWait?.({ rows: 3 }) || kitUI.h('p', { class: 'ot-note', text: W('讀一下…', 'Reading…') })]);
  const s = kitUI.sheet({ title: W('這班為什麼慢', 'Why it’s late'), cls: 'ot-slow-sheet', body: [body] });
  const [pos, alerts] = await Promise.all([traTrain(x.no).catch(() => null), tdx('basic/v3/Rail/TRA/Alert', { fresh: 3 * 60_000 }).catch(() => null)]);
  if (!s.el?.isConnected) return;
  const ic = kitUI.icons || {};
  const spec = slowSpec({ label: (x.first || x.label).replace(/\u00a0/g, ' '), delay: pos ? pos.delay : x.delay, arr: x.arrAt, toName: stationLabel(p.to), pos, alerts: alertsOn(traAlertsNow(alerts), x.stops || []) }, { train: ic.train, clock: ic.clock, flag: ic.flag, bell: ic.bell });
  body.replaceChildren(ai?.aiAnswer?.(spec) || kitUI.h('p', { class: 'ot-note', text: spec.line }));
}

// Pinning a train (查時刻 calls it): a connection, or one train.
export function pinTrain(c, pin) {
  const clean = cleanPin(pin);
  if (!clean) return false;
  const same = x => x.kind === clean.kind && x.from.id === clean.from.id && x.to.id === clean.to.id && (x.kind !== 'trainNo' || x.no === clean.no);
  if (c.data.pins.some(same)) return true;
  if (c.data.pins.length >= MAX_PINS) {
    c.status(W(`最多 ${MAX_PINS} 個釘選`, `Up to ${MAX_PINS} pins`));
    return false;
  }
  c.data.pins = [...c.data.pins, clean];
  c.save();
  return true;
}
