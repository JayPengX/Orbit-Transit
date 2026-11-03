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
import { errorText, liveMs } from './api.mjs';
import { stopsEta, etaRank, etaFor, said, cityRoutes } from './bus.mjs';
import { nearBusRows, nearBikes, inTime } from './near-ui.mjs';
import { nearStops, keptNear, keepNear, nearMoved, openRoute, chooseGroup, useBusCtx, strip, fitStrips, busWhen, plannedAt } from './bus-ui.mjs';
import { bikesAround } from './near.mjs';
import { railNetwork, railSpan, traDelays } from './raildata.mjs';
import { journeys } from './rail.mjs';
import { planTrip } from './planner.mjs';
import { setTripPush } from './alerts.mjs';
import { pickSig, boardEarly } from './plan.mjs';
import { lateBy } from './nav.mjs';
import { loadNotices, bikesOff, onNotices } from './service.mjs';
import { mapsNear } from './metro.mjs';
import { cleanPin, slotOf, MAX_PINS, PLACE_ICONS } from './store.mjs';
import { sheet, sheetHead, icon, trainKind, trainName, stationLabel, legLabel, legColor, trainColor, legChips, fitLegs } from './ui.mjs';
import { boardRow, whenHtml } from './board.mjs';
import { COLOR, PLACE_COLOR, tile, tag, section, rowCard, tick, navTitle, noticesHtml } from './look.mjs';
import { e, hm, distText, meters, tw, twAt, addDays, dayLabel, holidayOn, weekdaysOnly, isRide, readJson, readSaved, UNREAD, writeJson, shown as nameIn } from './util.mjs';

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
  near: null, // { at, stops, bikes }: the stops and YouBike around you, for when nothing is pinned or beside what is
  planned: new Map(), // stopUID → { at, day }: the timetable's next bus there, for when none is on its way
  heads: new Map(), // route uid → [where it goes one way, the other]: the new look's 附近 says which way
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
  // The phone's fix somewhere else than 附近 was read for (the last place kept, at an opening): read again.
  (ctx.moved ||= []).push(h => shown && nearMoved(S.near, h) && loadNear({ force: true }));
}
// The first look, filled in (where you are, the kept plans timed, the
// buses and trains): what the opening waits for, so the loading screen
// lifts onto it and nothing changes after (the app caps the wait).
let firstLook = null;
export const ready = () => firstLook || Promise.resolve();

export function show() {
  shown = true;
  S.near ||= keptNearAll(ctx.here);
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
  // A one-time trip: only on its day, nothing once that's over.
  if (t.date && t.date < day.date) return null;
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
  let plans = st?.sig === tripSig(w) && st.plans?.length ? st.plans : null;
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

// Saved trips in the order they matter: recurring ones today first, then the rest.
function trips(now = Date.now()) {
  return ctx.data.saved
    .map(t => ({ t, w: tripNow(t, ctx.here, now) }))
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
    jobs.push(loadNear().then(() => Promise.all([loadNotices_(), nearPlanned(), nearHeads()])));
    // The two trips that matter most get their plans at once (planned once, their times kept up: `loadTrip`).
    for (const { w } of trips().slice(0, 2)) jobs.push(loadTrip(w));
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
  S.notices = await loadNotices({ cities, systems, bikes: bikesOff(S.near?.bikes) }).catch(() => S.notices);
}

async function trainPins() {
  const pins = ctx.data.pins;
  if (!pins.length) return;
  try {
    const now = Date.now();
    const span = railSpan(now);
    const net = await railNetwork(span.date, span);
    const delays = await traDelays().catch(() => new Map());
    for (const p of pins) {
      const from = `${p.from.sys}:${p.from.id}`;
      const to = `${p.to.sys}:${p.to.id}`;
      if (p.kind === 'train') {
        const js = journeys(net, [{ key: from, at: now }], [{ key: to, extra: 0 }], now, { n: 3 });
        S.trains.set(p.id, { rows: js.map(j => {
          const rides = j.legs.filter(l => !l.walk);
          return { dep: j.dep, arr: j.arr, label: rides.map(l => trainName(l.trip).replace(/ /g, '\u00a0')).join(' › '), delay: rides[0]?.trip.sys === 'tra' ? delays.get(rides[0].trip.no) || 0 : 0, sys: rides[0]?.trip.sys || '', type: rides[0]?.trip.type || '', no: rides[0]?.trip.no || '' };
        }) });
      } else {
        // That train today (or tomorrow, after it's gone): its times at your two stations.
        const runs = net.trips.filter(t => t.sys === p.sys && t.no === p.no);
        const times = runs.map(t => ({ a: t.stops.find(x => x.st === from), b: t.stops.find(x => x.st === to) })).filter(x => x.a && x.b && x.a.dep > now - 60_000);
        const x = times[0];
        S.trains.set(p.id, { rows: [{ dep: x ? x.a.dep : null, arr: x ? x.b.arr : null, label: x ? W(`${p.type || ''} ${p.no} 次`, `${trainKind(p.type || '')} ${p.no}`).trim() : W(`${p.no} 次今天不開或已過`, `Train ${p.no}: none today or gone`), delay: p.sys === 'tra' ? delays.get(p.no) || 0 : 0, sys: p.sys, type: p.type || '', no: p.no }] });
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
export function rollPlans(plans, now = Date.now()) {
  const gone = p => p.dep < now - 2 * 60_000;
  const out = plans.map(p => (anytime(p) && p.dep < now ? shiftPlan(p, now - p.dep) : p));
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
// The kept plans as they are now: rolled on, the buses due soon timed by what they're doing.
async function retimed(base, w) {
  const now = Date.now();
  const { adjustPlan } = await import('./live.mjs');
  // (From when you can set out: now, or the trip's time; by an arrival time, as planned.)
  const start = w.by === 'arrive' ? null : Math.max(now, w.at || now);
  const plans = w.by === 'arrive' ? base : rollPlans(base, now);
  const out = await Promise.all(plans.map(p => (p.legs.some(l => l.mode === 'bus' && l.dep < now + 90 * 60_000 && l.dep >= now - 2 * 60_000) ? adjustPlan(p, now, { start }).catch(() => p) : p)));
  // (At the stop a few minutes early, by the bus's time now.)
  return out.map(p => boardEarly(p, start ?? now));
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
  S.trips.set(w.id, { ...(old || {}), sig, loading: true });
  render();
  try {
    const from = w.from || (here ? { name: W('目前位置', 'Here'), ...here } : null);
    if (!from) throw Object.assign(new Error('nohere'), { code: 'NO_HERE' });
    const at = Date.now();
    const out = await planTrip(ctx.data, from, w.to, { at: w.at, by: w.by });
    for (const k of [...S.choice.keys()]) if (k.startsWith(`${w.id}:`)) S.choice.delete(k);
    const done = plans => {
      S.trips.set(w.id, { sig, at, from, base: plans, timed: Date.now(), plans, error: '' });
      keepTrip(tripKey(w), { at, from: { lat: from.lat, lon: from.lon }, plans });
    };
    if (out.plans.length) done(out.plans);
    else S.trips.set(w.id, { sig, at, from, plans: [], error: out.error ? errorText(out.error) : W('找不到大眾運輸方案。', 'No transit route found.') });
    // The direct buses and every bus's times, a moment later (unless a time was picked meanwhile).
    out.later?.then(o => {
      const cur = S.trips.get(w.id);
      if (!o?.plans?.length || cur?.plans !== out.plans || [...S.choice.keys()].some(k => k.startsWith(`${w.id}:`))) return;
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
async function loadNear({ force = false } = {}) {
  const h = ctx.here;
  if (!h) return;
  S.near ||= keptNearAll(h);
  const old = S.near;
  if (!force && old && !old.kept && Date.now() - old.at < 20_000 && !nearMoved(old, h)) return;
  const read = Promise.all([nearStops(h, { n: 3, r: 350 }), bikesAround(h.lat, h.lon).catch(() => [])]).then(
    ([stops, bikes]) => {
      // (A newer read, for where you are now, already in: it stays.)
      if (S.near !== old && ctx.here !== h) return;
      S.near = { at: Date.now(), lat: h.lat, lon: h.lon, stops: keepNear(h, stops), bikes: bikes.map(s => ({ ...s, d: meters(h.lat, h.lon, s.lat, s.lon) })).filter(s => s.d <= 700).sort((a, b) => a.d - b.d).slice(0, 3) };
    },
    () => {
      if (!S.near || nearMoved(S.near, h)) S.near = { at: Date.now(), lat: h.lat, lon: h.lon, stops: [], bikes: [] };
    }
  );
  // (Never bars for ever (near-ui.mjs): nothing yet, nothing shown; the read drawn when it lands.)
  if (!(await inTime(read))) {
    S.near ||= { at: 0, lat: h.lat, lon: h.lon, stops: [], bikes: [] };
    read.then(render);
  }
  render();
}
// The stops kept from the last read (bus-ui keptNear), shown at once; the bikes come with the read.
const keptNearAll = h => {
  const k = keptNear(h);
  return k ? { ...k, kept: true, bikes: [] } : null;
};

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
    const lead = S.trips.get(w.id)?.plans?.find(p => p.top && p.lead !== false) || keptLead(w, { prefs: ctx.data.prefs, picks: t.picks, now });
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
// A trip's row: the first thing you board (its line's badge), when to leave, when you're there.
function boardTrip({ t, w }) {
  const st = tripOf(w);
  const all = st?.plans || [];
  const lead = tripPlans(all, t.picks).first[0];
  if (!lead) return boardRow({ glyph: 'route', color: COLOR.route, main: e(w.label), note: e(tripWhy(st)), attrs: st ? `data-all-trip="${e(w.id)}"` : `data-load-trip="${e(t.id)}"` });
  const at = all.indexOf(lead);
  const i = S.choice.get(`${w.id}:${at}`) ?? at;
  const p = all[i];
  const goes = p.legs.filter(l => l.mode !== 'walk');
  const first = goes[0];
  const late = lateBy(p, p.arr);
  const warn = p.off || p.miss || p.late || (late ? W(`晚 ${late} 分到`, `${late} min late`) : '');
  const then = goes.slice(1).map(legLabel);
  const note = warn ? `<span class="ot-warn">${e(warn)}</span>` : e([then.length ? W(`轉 ${then.join(' › ')}`, `then ${then.join(' › ')}`) : '', W(`${hm(p.arr)} 到`, `Arrive ${hm(p.arr)}`)].filter(Boolean).join(' · '));
  return boardRow({
    ...(!first ? { glyph: 'walk', color: COLOR.walk } : first.mode === 'bike' ? { glyph: 'bike', color: legColor(first) } : { no: legLabel(first), color: legColor(first) }),
    main: e(w.label),
    note,
    when: whenHtml(p.dep, W('出發', 'Leave'), p.live),
    // (A tap opens its ways on the map, this one first: 導航 there, the other
    // ways and times, a way pinned to go first; the old card's all in one place.)
    attrs: `data-all-trip="${e(w.id)}"`
  });
}
// Under a trip's row, its next ways to pick from at once (Jay 2026-11-03: 交通 was "so empty",
// it "used to show detail or even trip for me to choose from directly"): up to three, each
// when to leave, its rides as chips and when you're there; a tap shows that one on the map,
// its 導航 a tap away. Only a trip with rides in the next three hours (later, the row says when).
const WAYS_MS = 3 * 3600_000;
function tripWays({ t, w }) {
  const all = tripOf(w)?.plans || [];
  const { first, rest } = tripPlans(all, t.picks);
  const now = Date.now();
  const ways = [...first, ...rest].filter(p => p.dep < now + WAYS_MS).slice(0, 3);
  if (!ways.length) return '';
  return `<div class="ob-ways">${ways
    .map(p => {
      const late = lateBy(p, p.arr);
      const warn = p.off || p.miss || p.late || (late ? W(`晚 ${late} 分到`, `${late} min late`) : '');
      return `<button class="ob-way q-press" type="button" data-nav-trip="${e(w.id)}" data-i="${all.indexOf(p)}"><span class="ob-way-when${p.live ? ' live' : ''}">${e(hm(p.dep))}</span><span class="ob-way-mid"><span class="ot-legs">${legChips(p.legs)}</span>${warn ? `<small class="ot-warn">${e(warn)}</small>` : ''}</span><span class="ob-way-arr"><b>${e(hm(p.arr))}</b><small>${e(W(`${Math.round(p.dur / 60)} 分`, `${Math.round(p.dur / 60)} min`))}</small></span></button>`;
    })
    .join('')}</div>`;
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
    const note = [e(x.label), x.delay ? `<span class="ot-late">${e(W(`晚 ${x.delay} 分`, `${x.delay} min late`))}</span>` : '', ''].filter(Boolean).join(' · ') + (y ? `<span class="ot-drop"> · ${e(W(`下一班 ${hm(y.dep)}`, `then ${hm(y.dep)}`))}</span>` : '');
    return boardRow({ no: kindOf({ ...x, sys }), color: trainColor({ sys, type: x.type }), main, note, when: whenHtml(x.dep, whenSmall(x.dep)), attrs: `data-times="${e(p.id)}"` });
  });
}
// What's near: the buses on their way first (soonest first), then those the
// timetable has next; the routes with neither are one quiet line, not a
// list of 尚未發車. A typhoon day's every bus off is near-ui's one calm row.
const offNow = v => {
  const x = v && said(v);
  return x?.status === 4 && x.flag;
};
function boardNear() {
  if (!ctx.here) return '';
  const n = S.near;
  const seen = new Set();
  const mine = new Set(ctx.data.groups.flatMap(g => g.items).map(it => `${it.routeUID}:${sideOf(it).stopUID}`));
  const all = n ? n.stops.flatMap(st => st.rows.slice(0, 4).map(r => ({ ...r, dist: st.dist }))).filter(x => !mine.has(`${x.uid}:${x.stopUID}`) && !seen.has(x.uid) && seen.add(x.uid)) : null;
  let buses = '';
  if (!all || (all.length && all.every(x => offNow(x.v)))) buses = nearBusRows(all && n.stops, { planned: S.planned });
  else if (all.length) {
    const now = Date.now();
    const live = all.filter(x => x.v?.status === 0 && x.v.sec != null).sort((a, b) => a.v.sec - b.v.sec);
    const due = all.filter(x => !live.includes(x) && S.planned.get(x.stopUID)?.at > now).sort((a, b) => S.planned.get(a.stopUID).at - S.planned.get(b.stopUID).at);
    const shownRows = [...live, ...due].slice(0, 6);
    const quiet = all.filter(x => !shownRows.includes(x) && !live.includes(x) && !due.includes(x));
    buses = shownRows.map(x => {
      const head = S.heads.get(x.uid)?.[x.dir];
      // (Which way first; how far, where it fits: on a narrow phone it goes, never the way cut.)
      const dist = Number.isFinite(x.dist) ? distText(x.dist) : '';
      const note = head ? `${e(`${W('往', 'To')} ${nameIn(head)}`)}${dist ? `<span class="ot-drop"> · ${e(dist)}</span>` : ''}` : e(dist);
      return `<div class="ot-strip">${strip({ no: x.route, note, main: e(nameIn(x.stop || '')), eta: busWhen(x.v, S.planned.get(x.stopUID) || null), attrs: routeAttr({ uid: x.uid, name: x.route, city: x.city, stopUID: x.stopUID, dir: x.dir }) })}</div>`;
    }).join('');
    if (quiet.length) {
      const names = quiet.map(x => nameIn(x.route));
      buses += `<p class="ob-quiet">${e(W(`還沒有車：${names.slice(0, 4).join('、')}${names.length > 4 ? ` 等 ${names.length} 條` : ''}`, `None on the way: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}`))}</p>`;
    }
  }
  const bikes = nearBikes(n?.bikes);
  if (!buses && !bikes) return '';
  return section(W('附近', 'Nearby'), `${buses ? rowCard(buses) : ''}${bikes}`);
}
// Which way each bus near you goes (its route's far end, from the city's route list, kept a
// day on the phone), so one line's two ways read apart: 往 香山轉運站 and 往 新竹站.
async function nearHeads() {
  const rows = (S.near?.stops || []).flatMap(st => st.rows);
  const cities = [...new Set(rows.filter(r => r.uid && !S.heads.has(r.uid)).map(r => r.city).filter(Boolean))].slice(0, 3);
  if (!cities.length) return;
  const lists = await Promise.all(cities.map(c => cityRoutes(c).catch(() => [])));
  for (const r of lists.flat()) if (r.to || r.from) S.heads.set(r.uid, [r.to, r.from]);
  render();
}
// The timetable's next bus for the routes near you with none on the way (as a pinned bus's).
async function nearPlanned() {
  const now = Date.now();
  const todo = (S.near?.stops || [])
    .flatMap(st => st.rows.slice(0, 4).map(r => ({ ...r, lat: st.lat, lon: st.lon })))
    .filter(x => x.uid && !(x.v?.status === 0 && x.v.sec != null) && !(S.planned.get(x.stopUID)?.at > now))
    .slice(0, 8);
  if (!todo.length) return;
  await Promise.all(todo.map(x => plannedAt({ routeUID: x.uid, route: x.route, city: x.city, dir: x.dir, stopUID: x.stopUID }, Number.isFinite(x.lat) ? x : null).then(q => q && S.planned.set(x.stopUID, q), () => {})));
  render();
}
function renderBoard(ts) {
  const box = $('panel-go');
  const keep = box.scrollTop;
  const railX = box.querySelector('.ob-places')?.scrollLeft || 0;
  const here = ctx.here;
  const places = ctx.data.places.filter(p => !here || meters(here.lat, here.lon, p.lat, p.lon) > 300);
  const plan = `<button class="ob-plan q-press" type="button" data-plan-to="1">${icon('search')}<span>${W('要去哪裡？', 'Where to?')}</span></button>${places.length ? `<div class="ob-places">${places.map(p => `<button class="ob-place q-press" type="button" data-place="${e(p.id)}">${tile(PLACE_ICONS[p.icon] || 'pin', PLACE_COLOR[p.icon] || COLOR.place, 'sm')}<span>${e(nameIn(p.name))}</span></button>`).join('')}</div>` : ''}`;
  const rows = [...ts.map(x => boardTrip(x) + tripWays(x)), ...boardBuses(), ...boardTrains()].join('');
  const mine = section(W('我的路線', 'My rides'), rows ? rowCard(rows) : `<div class="q-rowcard ob-empty"><p>${W('釘選常搭的車，時間都在這裡', 'Pin what you ride: its times show here')}</p><button class="q-btn" type="button" data-new-trip="1">${icon('plus')} ${W('新增行程', 'Add a trip')}</button></div>`);
  box.innerHTML = `<div class="ot-page ob-page">
    ${navTitle(W('交通', 'Transit'))}
    <div class="q-cols ot-cols">
      <div>${noticesHtml(S.notices)}${plan}${mine}</div>
      <div>${boardNear()}</div>
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
    const b = [...(S.near?.bikes || []), ...[...S.places.values()].flatMap(x => x.bikes || [])].find(x => x.uid === bk.dataset.bk);
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
    if (w) return ctx.openTrip(w.from, w.to, { at: w.at, by: w.by, plans: tripOf(w)?.plans?.length ? tripOf(w).plans : null });
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
    const p = x && tripOf(x.w)?.plans?.[Number(nt.dataset.i)];
    if (p) return ctx.navPlan(p, x.w.from, x.w.to || p.legs.at(-1).to);
  }
  const pl = ev.target.closest('[data-place]');
  if (pl) return openPlace(pl.dataset.place);
  const gp = ev.target.closest('[data-go-place]');
  if (gp) {
    const p = ctx.data.places.find(x => x.id === gp.dataset.goPlace);
    if (p) return ctx.openTrip(null, { name: p.name, lat: p.lat, lon: p.lon, ...(p.gid ? { gid: p.gid } : {}) });
  }
  const tm = ev.target.closest('[data-times]');
  if (tm) {
    const p = ctx.data.pins.find(x => x.id === tm.dataset.times);
    if (p) {
      ctx.trainQuery = { from: p.from, to: p.to };
      return ctx.goTab('times');
    }
  }
  if (ev.target.closest('[data-plan-to]')) return ctx.planTo?.();
  if (ev.target.closest('[data-new-trip]')) return ctx.newTrip?.();
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
