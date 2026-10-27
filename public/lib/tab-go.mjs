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
import { stopsEta, etaRank } from './bus.mjs';
import { nearBusRows, nearBikes, inTime } from './near-ui.mjs';
import { nearStops, keptNear, keepNear, nearMoved, openRoute, chooseGroup, useBusCtx, strip, fitStrips, busWhen, plannedAt } from './bus-ui.mjs';
import { bikesAround } from './near.mjs';
import { railNetwork, railSpan, traDelays } from './raildata.mjs';
import { journeys } from './rail.mjs';
import { planTrip } from './planner.mjs';
import { setTripPush } from './alerts.mjs';
import { pickSig } from './plan.mjs';
import { canNav, lateBy } from './nav.mjs';
import { loadNotices, bikesOff, onNotices } from './service.mjs';
import { mapsNear } from './metro.mjs';
import { cleanPin, slotOf, MAX_PINS, PLACE_ICONS } from './store.mjs';
import { sheet, sheetHead, icon, legChips, fitLegs, depChips, tagText, trainKind, trainName, stationLabel } from './ui.mjs';
import { COLOR, PLACE_COLOR, tile, tag, section, rowCard, countHtml, tick, focus, navTitle, noticesHtml } from './look.mjs';
import { e, hm, minsText, distText, meters, tw, twAt, addDays, dayLabel, holidayOn, weekdaysOnly, isRide, readJson, readSaved, UNREAD, writeJson, shown as nameIn } from './util.mjs';

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
  trains: new Map(), // pin id → { rows: [{ dep, arr, label, delay }] } once read, or { error }
  trips: new Map(), // key → { at, plans, error, loading }
  choice: new Map(), // `${trip}:${its card's plan}` → the departure picked from its times
  places: new Map(), // place id → { stops, bikes, at }
  open: new Set(), // places opened
  more: new Set(), // trips showing every plan
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
    const v = S.pinned.get(r.stopUID);
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
    jobs.push(loadNear().then(loadNotices_));
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
          return { dep: j.dep, arr: j.arr, label: rides.map(l => trainName(l.trip).replace(/ /g, '\u00a0')).join(' › '), delay: rides[0]?.trip.sys === 'tra' ? delays.get(rides[0].trip.no) || 0 : 0 };
        }) });
      } else {
        // That train today (or tomorrow, after it's gone): its times at your two stations.
        const runs = net.trips.filter(t => t.sys === p.sys && t.no === p.no);
        const times = runs.map(t => ({ a: t.stops.find(x => x.st === from), b: t.stops.find(x => x.st === to) })).filter(x => x.a && x.b && x.a.dep > now - 60_000);
        const x = times[0];
        S.trains.set(p.id, { rows: [{ dep: x ? x.a.dep : null, arr: x ? x.b.arr : null, label: x ? W(`${p.type || ''} ${p.no} 次`, `${trainKind(p.type || '')} ${p.no}`).trim() : W(`${p.no} 次今天不開或已過`, `Train ${p.no}: none today or gone`), delay: p.sys === 'tra' ? delays.get(p.no) || 0 : 0 }] });
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
  return Promise.all(plans.map(p => (p.legs.some(l => l.mode === 'bus' && l.dep < now + 90 * 60_000 && l.dep >= now - 2 * 60_000) ? adjustPlan(p, now, { start }).catch(() => p) : p)));
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

// A plan's facts as tags: when it's there, how long, its changes, live.
// (Its changes are its chips; on a narrow row the minutes go short, then go: fitLegs.)
const planTags = p => [
  `<span class="ot-fact">${e(W(`${hm(p.arr)} 到`, `arr ${hm(p.arr)}`))}</span>`,
  `<span class="ot-fact dur"><span class="long">${e(minsText(p.dur))}</span><span class="short">${e(W(`${Math.round(p.dur / 60)} 分`, `${Math.round(p.dur / 60)} min`))}</span></span>`,
  p.live ? `<span class="ot-fact ot-now">${W('即時', 'Live')}</span>` : ''
].join('');
const planWarn = p => (p.miss || p.off || p.late || lateBy(p, p.arr) || p.note || p.rivers?.length ? `<small class="ot-warn">${e(p.off || p.miss || p.late || (lateBy(p, p.arr) ? W(`晚 ${lateBy(p, p.arr)} 分到`, `${lateBy(p, p.arr)} min late`) : '') || p.note || W(`${p.riverBy || '騎車'}過${p.rivers.join('、')}`, `${tagText(p.riverBy || '騎車')} across ${p.rivers.join(', ')}`))}</small>` : '');
// Under a ride's countdown: its clock time, or its day when not today.
// (Never the clock the big number already shows: past an hour it is the clock.)
const whenSmall = at => {
  const far = (at - Date.now()) / 60_000 >= 59.5;
  const other = tw(at).date !== tw().date;
  return other ? `${dayLabel(tw(at).date)}${far ? '' : ` ${hm(at)}`}` : far ? '' : hm(at);
};

function tripCard({ t, w }) {
  const st = tripOf(w);
  const when = w.at ? `${tw(w.at).date !== tw().date ? `${dayLabel(tw(w.at).date)} ` : ''}${hm(w.at)}` : '';
  const head = `<header class="ot-trip-head">${tile(w.recurring ? 'clock' : 'route', COLOR.route, 'sm')}<span class="ot-trip-hd"><b>${e(w.label)}</b><small>${e(w.from ? w.from.name : W('目前位置', 'Here'))} → ${e(nameIn(w.to.name))}${when ? ` · ${e(when)}` : ''}</small></span><button class="q-icon-btn" type="button" data-edit-trip="${e(t.id)}" aria-label="${W('編輯', 'Edit')}">${icon('edit')}</button></header>`;
  if (!st) return `<article class="ot-trip">${head}<button class="ot-trip-foot" type="button" data-load-trip="${e(t.id)}">${W('看班次', 'See rides')}${icon('chevron')}</button></article>`;
  const all = st.plans || [];
  const { first, rest } = tripPlans(all, t.picks);
  const row = lead => {
    const at = all.indexOf(lead);
    const i = S.choice.get(`${w.id}:${at}`) ?? at;
    const p = all[i];
    const pin = t.picks.includes(pickSig(p));
    const times = (lead.times || []).filter(j => all[j] && all[j].dep >= Date.now() - 2 * 60_000);
    const deps = depChips(all, times, i, j => `data-go-dep="${e(w.id)}" data-lead="${at}" data-i="${j}"`);
    return `<div class="ot-ride"><button class="ot-ride-main" type="button" data-nav-trip="${e(w.id)}" data-i="${i}"><span class="ot-ride-top"><span class="ot-ride-when">${countHtml(p.dep, { cls: 'ot-ride-n' })}${whenSmall(p.dep) ? `<small>${e(whenSmall(p.dep))}</small>` : ''}</span><span class="ot-facts ot-fit-row">${planTags(p)}</span></span><span class="ot-legs">${legChips(p.legs)}</span>${planWarn(p)}</button><button class="q-icon-btn ot-star${pin ? ' on' : ''}" type="button" data-pick-trip="${e(w.id)}" data-i="${i}" aria-label="${pin ? W('取消釘選這個方案', 'Unpin this route') : W('釘選這個方案', 'Pin this route')}">${icon('star')}</button>${deps}</div>`;
  };
  const behind = w.by === 'arrive' && w.at && first.length && first.every(p => lateBy(p, p.arr)) ? `<p class="ot-trip-note ot-warn">${W(`${e(hm(w.at))} 前到不了`, `Can’t make ${e(hm(w.at))}`)}</p>` : '';
  const more = S.more.has(w.id);
  const rows = first.map(row).join('') + (more ? rest.map(row).join('') : '');
  const note = st.loading && !all.length ? `<p class="ot-trip-note">${W('找班次…', 'Finding rides…')}</p>` : st.error && !all.length ? `<p class="ot-trip-note">${e(st.error)}</p>` : '';
  const foot = `<div class="ot-trip-foot">${rest.length ? `<button type="button" data-more-trip="${e(w.id)}">${more ? W('收起', 'Less') : W(`更多 ${rest.length}`, `${rest.length} more`)}</button>` : ''}<button type="button" data-all-trip="${e(w.id)}">${W('在地圖上看', 'On the map')}${icon('chevron')}</button></div>`;
  return `<article class="ot-trip">${head}${behind}${rows}${note}${foot}</article>`;
}

// What's pinned, soonest first: [{ it, r, v, planned, at }] (at: when its next bus is there).
function pinnedBuses() {
  return ctx.data.groups
    .flatMap(g => g.items)
    .map(it => {
      const r = sideOf(it);
      const v = S.pinned.get(r.stopUID);
      const live = v?.status === 0 && v.sec != null;
      const planned = live ? null : S.planned.get(r.stopUID);
      const at = live ? (v.t ?? S.pinnedAt) + v.sec * 1000 : planned?.at || null;
      return { it, r, v, planned, at };
    })
    .sort((a, b) => etaRank(a.v) - etaRank(b.v));
}
const trainNext = p => (S.trains.get(p.id)?.rows || []).filter(x => x.dep == null || x.dep > Date.now() - 60_000 || p.kind === 'trainNo');

function pinnedHtml(skip) {
  const buses = pinnedBuses()
    .filter(b => skip !== `bus:${b.r.stopUID}`)
    .map(({ it, r, v, planned }) => {
      // One row, as every bus here: the line, where you get on and where you
      // get off; a ride with a way back has its 去程/回程 first, a tap turning it round.
      const dir = it.back ? `<span class="ot-strip-dir" role="button" data-flip="${e(it.id)}" aria-label="${r.back ? W('回程，改看去程', 'Return; show outbound') : W('去程，改看回程', 'Outbound; show return')}">${icon('swap')}${r.back ? W('回程', 'Return') : W('去程', 'Out')}</span>` : '';
      const note = r.off ? `${dir}${W('到', 'to')} ${e(nameIn(r.off.stop))}${it.n ? `<span class="ot-drop"> · ${W(`${it.n} 站`, `${it.n} stops`)}</span>` : ''}` : `${W('往', 'to')} ${e(r.headsign || '—')}`;
      return `<div class="ot-strip">${strip({ no: it.route, note, main: e(nameIn(r.stop)), eta: busWhen(v, planned), attrs: routeAttr({ uid: it.routeUID, name: it.route, city: it.city, stopUID: r.stopUID, dir: r.dir }) })}</div>`;
    })
    .join('');
  const trains = ctx.data.pins
    .filter(p => skip !== `train:${p.id}`)
    .map(p => {
      const got = S.trains.get(p.id);
      const rows = trainNext(p);
      const first = rows[0];
      const hsr = p.from.sys === 'hsr';
      const tags = rows.slice(0, 2).map(x => `${e(`${x.dep != null ? `${hm(x.dep)} ` : ''}${x.label}`)}${x.delay ? ` <span class="ot-late">${e(W(`晚 ${x.delay} 分`, `${x.delay} min late`))}</span>` : ''}`).join(' · ');
      const none = !got ? W('載入中…', 'Loading…') : got.error || W('今天沒有車了', 'No more trains today');
      const end = first?.dep != null ? `<span class="ot-eta">${countHtml(first.dep, { cls: 'ot-eta-n' })}<small>${e(hm(first.dep))}</small></span>` : '';
      return `<button class="q-ritem ot-train-row" type="button" data-times="${e(p.id)}">${tile(hsr ? 'hsr' : 'tra', hsr ? COLOR.hsr : COLOR.tra)}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(p.from))} → ${e(stationLabel(p.to))}</span><small>${tags || e(none)}</small></span>${end}</button>`;
    })
    .join('');
  if (!buses && !trains) return '';
  return section(W('釘選', 'Pinned'), rowCard(buses + trains));
}

// Your places, a row of cards to scroll (as Law's starters): a tap opens what's around it. Each card
// its tile beside its name (the owner, 2026-10-27: one place alone, stacked, was a big empty card).
function placesRail() {
  const here = ctx.here;
  const list = ctx.data.places.filter(p => !here || meters(here.lat, here.lon, p.lat, p.lon) > 300);
  if (!list.length) return '';
  return `<div class="q-rail small ot-places">${list.map(p => `<button class="q-rail-card q-press ot-place" type="button" data-place="${e(p.id)}">${tile(PLACE_ICONS[p.icon] || 'pin', PLACE_COLOR[p.icon] || COLOR.place)}<span class="ot-place-text"><strong>${e(nameIn(p.name))}</strong>${here ? `<small>${e(distText(meters(here.lat, here.lon, p.lat, p.lon)))}</small>` : ''}</span></button>`).join('')}</div>`;
}

// YouBike stations as a small rail: the bikes there now, big.
// What's around you now: the buses at the nearest stops (not the one the card leads with), the YouBike stations (near-ui.mjs, as 地圖's sheet).
function nearHtml(skip) {
  const n = S.near;
  if (!ctx.here) return '';
  const buses = nearBusRows(n ? n.stops : null, { skip, planned: S.planned });
  const bikes = nearBikes(n?.bikes);
  if (!buses && !bikes) return '';
  return section(W('附近', 'Nearby'), `${buses ? rowCard(buses) : ''}${bikes}`);
}

// The next thing you'd take, soonest of: a trip's best way, a pinned bus, a
// pinned train, the bus at the nearest stop. → { html, key } (key: what
// the page leaves out below, said here already).
function heroOf(ts) {
  const now = Date.now();
  const cands = [];
  for (const { t, w } of ts.slice(0, 2)) {
    const st = tripOf(w);
    const all = st?.plans || [];
    const lead = tripPlans(all, t.picks).first[0];
    if (!lead) continue;
    const at = all.indexOf(lead);
    const i = S.choice.get(`${w.id}:${at}`) ?? at;
    const p = all[i];
    cands.push({
      at: p.dep,
      key: `trip:${w.id}`,
      html: focus({
        eyebrow: w.label,
        big: countHtml(p.dep, { cls: 'q-focus-value' }),
        title: `${w.from ? w.from.name : W('目前位置', 'Here')} → ${w.to.name}`,
        facts: [W(`${hm(p.dep)} 出發`, `Leave ${hm(p.dep)}`), W(`${hm(p.arr)} 到`, `Arrive ${hm(p.arr)}`)],
        live: p.live,
        body: `<span class="ot-legs ot-hc-legs">${legChips(p.legs)}</span>`,
        actions: [{ label: `${icon('route')} ${canNav(p) ? W('導航', 'Go') : W('看路線', 'Route')}`, attrs: `data-nav-trip="${e(w.id)}" data-i="${i}"`, primary: true }, { label: W('所有方案', 'All routes'), attrs: `data-all-trip="${e(w.id)}"` }, { label: icon('edit'), attrs: `data-edit-trip="${e(t.id)}" aria-label="${W('編輯行程', 'Edit trip')}"` }]
      })
    });
  }
  for (const b of pinnedBuses()) {
    if (b.at == null) continue;
    const live = b.v?.status === 0 && b.v.sec != null;
    cands.push({
      at: b.at,
      key: `bus:${b.r.stopUID}`,
      html: focus({
        eyebrow: W('釘選公車', 'Pinned bus'),
        big: countHtml(b.at, { floor: true, cls: 'q-focus-value' }),
        title: `${b.it.route} ${W('往', 'to')} ${b.r.off ? b.r.off.stop : b.r.headsign || '—'}`,
        sub: W(`${b.r.stop} 上車`, `Board at ${b.r.stop}`),
        facts: live ? [] : [W('時刻表', 'Timetable')],
        live,
        warn: b.v?.last ? W('末班車', 'Last bus') : '',
        attrs: routeAttr({ uid: b.it.routeUID, name: b.it.route, city: b.it.city, stopUID: b.r.stopUID, dir: b.r.dir })
      })
    });
  }
  for (const p of ctx.data.pins) {
    const x = trainNext(p).find(r => r.dep != null && r.dep > now - 60_000);
    if (!x) continue;
    const hsr = p.from.sys === 'hsr';
    cands.push({
      at: x.dep,
      key: `train:${p.id}`,
      html: focus({
        eyebrow: hsr ? W('高鐵', 'HSR') : W('台鐵', 'TRA'),
        big: countHtml(x.dep, { cls: 'q-focus-value' }),
        title: `${stationLabel(p.from)} → ${stationLabel(p.to)}`,
        facts: [`${hm(x.dep)}${x.arr ? ` → ${hm(x.arr)}` : ''}`, x.label],
        warn: x.delay ? W(`晚 ${x.delay} 分`, `${x.delay} min late`) : '',
        attrs: `data-times="${e(p.id)}"`
      })
    });
  }
  const stop = S.near?.stops?.flatMap(st => st.rows.slice(0, 2).map(r => ({ ...r, dist: st.dist }))).filter(r => r.v?.status === 0 && r.v.sec != null).sort((a, b) => a.v.sec - b.v.sec)[0];
  if (stop) {
    cands.push({
      at: (stop.v.t ?? S.near.at) + stop.v.sec * 1000,
      key: `near:${stop.stopUID}:${stop.uid}`,
      html: focus({
        eyebrow: W('附近的下一班', 'Next near you'),
        big: countHtml((stop.v.t ?? S.near.at) + stop.v.sec * 1000, { floor: true, cls: 'q-focus-value' }),
        title: `${nameIn(stop.route)}${stop.stop ? `・${nameIn(stop.stop)}` : ''}`,
        live: true,
        facts: [Number.isFinite(stop.dist) ? distText(stop.dist) : ''],
        warn: stop.v.last ? W('末班車', 'Last bus') : '',
        attrs: routeAttr({ uid: stop.uid, name: stop.route, city: stop.city, stopUID: stop.stopUID, dir: stop.dir })
      })
    });
  }
  const best = cands.filter(c => c.at > now - 60_000).sort((a, b) => a.at - b.at)[0];
  if (best) return best;
  return {
    key: '',
    html: focus({
      title: W('釘選你常搭的車', 'Pin what you ride'),
      actions: [{ label: `${icon('plus')} ${W('新增行程', 'Add a trip')}`, attrs: 'data-new-trip="1"', primary: true }, { label: W('查時刻', 'Times'), attrs: 'data-go-times="1"' }]
    })
  };
}

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
  const lead = heroOf(ts);
  const rest = ts.filter(x => lead.key !== `trip:${x.w.id}`);
  const box = $('panel-go');
  const keep = box.scrollTop;
  const railX = box.querySelector('.ot-places')?.scrollLeft || 0;
  box.innerHTML = `<div class="ot-page">
    ${navTitle(W('交通', 'Transit'))}
    ${noticesHtml(S.notices)}
    ${lead.html}
    ${placesRail()}
    ${rest.length ? section(W('行程', 'Trips'), rest.map(tripCard).join('')) : ''}
    ${pinnedHtml(lead.key)}
    ${nearHtml(lead.key)}
  </div>`;
  kitUI.wireNavTitles(box);
  fitStrips(box);
  fitLegs(box);
  box.scrollTop = keep;
  const rail = box.querySelector('.ot-places');
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
  const dep = ev.target.closest('[data-go-dep]');
  if (dep) {
    S.choice.set(`${dep.dataset.goDep}:${dep.dataset.lead}`, Number(dep.dataset.i));
    return render();
  }
  const nav = ev.target.closest('[data-nav-trip]');
  if (nav) {
    const st = S.trips.get(nav.dataset.navTrip);
    const p = st?.plans?.[Number(nav.dataset.i)];
    // (The trip's own end, Google's place for its navigation, when it's where the plan ends.)
    if (p) return ctx.navPlan(p, st.from, ctx.data.saved.find(x => x.id === nav.dataset.navTrip)?.to || p.legs.at(-1).to);
  }
  const pk = ev.target.closest('[data-pick-trip]');
  if (pk) {
    const x = trips().find(y => y.w.id === pk.dataset.pickTrip);
    const p = S.trips.get(pk.dataset.pickTrip)?.plans?.[Number(pk.dataset.i)];
    if (x && p) {
      const k = pickSig(p);
      const on = x.t.picks.includes(k);
      ctx.data.saved = ctx.data.saved.map(y => (y.id === x.t.id ? { ...y, picks: on ? y.picks.filter(z => z !== k) : [k, ...y.picks].slice(0, 6) } : y));
      ctx.save();
      ctx.status(on ? W('已取消釘選這個方案', 'Unpinned this route') : W('已釘選：這個方案的下一班會排在最前面', 'Pinned: its next ride goes first'));
      return render();
    }
  }
  const mo = ev.target.closest('[data-more-trip]');
  if (mo) {
    const id = mo.dataset.moreTrip;
    S.more.has(id) ? S.more.delete(id) : S.more.add(id);
    return render();
  }
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
  const ed = ev.target.closest('[data-edit-trip]');
  if (ed) return ctx.editTrip?.(ed.dataset.editTrip);
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
  if (ev.target.closest('[data-new-trip]')) return ctx.newTrip?.();
  if (ev.target.closest('[data-go-times]')) return ctx.goTab('times');
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
