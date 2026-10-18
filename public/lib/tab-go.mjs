// 交通: what's coming that you'd actually take, in one place, refreshed
// while it's open.
//
//   常用・釘選行程  your trips (家 → 學校 on weekday mornings, and the way
//                  back by itself): the next few ways to go, from the
//                  planner, with the buses' real times; one tap navigates
//   釘選的公車・火車  what you pinned: a stop's bus, a connection (六家 → 竹東),
//                  one train
//   釘選地點        around each place: its buses, its bikes, its station,
//                  and how to get there from here
//
// What's recommended is never pinned by itself: ☆ pins it.

import { errorText, liveMs } from './api.mjs';
import { stopsEta, etaRank } from './bus.mjs';
import { nearStops, openRoute, chooseGroup, useBusCtx, strip, fitStrips, busWhen, plannedAt } from './bus-ui.mjs';
import { bikesAround } from './near.mjs';
import { railNetwork, traDelays } from './raildata.mjs';
import { journeys } from './rail.mjs';
import { planTrip } from './planner.mjs';
import { pickSig } from './plan.mjs';
import { canNav, lateBy } from './nav.mjs';
import { cleanPin, slotOf, MAX_PINS, PLACE_ICONS } from './store.mjs';
import { icon, legChips, depChips, tagText, trainKind } from './ui.mjs';
import { e, hm, minsText, distText, meters, tw, twAt, addDays, dayLabel, holidayOn, weekdaysOnly } from './util.mjs';

import { W } from './lang.mjs';
const $ = id => document.getElementById(id);
let ctx = null;
let timer = 0;
let shown = false;
const S = {
  pinned: new Map(), // stopUID → eta
  planned: new Map(), // stopUID → { at, day }: the timetable's next bus there, for when none is on its way
  trains: new Map(), // pin id → [{ dep, arr, label, delay }]
  trips: new Map(), // key → { at, plans, error, loading }
  choice: new Map(), // `${trip}:${its card's plan}` → the departure picked from its times
  places: new Map(), // place id → { stops, bikes, at }
  open: new Set(), // places opened
  more: new Set(), // trips showing every plan
  flip: new Set() // rides turned round by hand (⇄)
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
}
export function show() {
  shown = true;
  render();
  refresh(true);
  clearInterval(timer);
  timer = setInterval(() => refresh(false), liveMs());
}
export function hide() {
  shown = false;
  clearInterval(timer);
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
  else if (!near(t.from) && t.from && today.back && t.days.length) {
    // Neither end: by the clock (after the time out and nearer the time back).
    const mins = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    if (day.min > (today.time ? mins(today.time) + 60 : 12 * 60) && Math.abs(day.min - mins(today.back)) < Math.abs(day.min - (today.time ? mins(today.time) : 0))) way = back;
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
  const offOn = date => weekdaysOnly(t.days) && holidayOn(date);
  let at = null;
  let by = 'depart';
  for (let n = 0; n < 15; n++) {
    const dow = (day.dow + n) % 7;
    if (t.days.length && (!t.days.includes(dow) || offOn(addDays(day.date, n)))) continue;
    const time = slotOf(t, dow)[way.key];
    if (!time) {
      if (t.days.length) continue;
      break;
    }
    const when = twAt(addDays(day.date, n), time);
    // Just gone (under 20 minutes): now.
    if (when < now - 20 * 60_000) continue;
    if (when > now) {
      at = when;
      by = way.rev ? 'depart' : t.by;
    }
    break;
  }
  return { id: `${t.id}:${way.rev ? 'b' : 'f'}`, from, to: way.to, at, by, label: way.label, recurring: t.days.length > 0, today: t.days.includes(day.dow) && !offOn(day.date) };
}

// Saved trips in the order they matter: recurring ones today first, then the rest.
function trips(now = Date.now()) {
  return ctx.data.saved
    .map(t => ({ t, w: tripNow(t, ctx.here, now) }))
    .filter(x => x.w)
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

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    if (!ctx.here) await ctx.locate();
    const jobs = [];
    const items = ctx.data.groups.flatMap(g => g.items).map(sideOf);
    if (items.length) jobs.push(stopsEta(items).then(m => (S.pinned = m)).then(() => plannedTimes(items)).catch(() => {}));
    jobs.push(trainPins());
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

async function trainPins() {
  const pins = ctx.data.pins;
  if (!pins.length) return;
  try {
    const now = Date.now();
    const net = await railNetwork(tw(now).date, { next: tw(now).min >= 21 * 60 });
    const delays = await traDelays().catch(() => new Map());
    for (const p of pins) {
      const from = `${p.from.sys}:${p.from.id}`;
      const to = `${p.to.sys}:${p.to.id}`;
      if (p.kind === 'train') {
        const js = journeys(net, [{ key: from, at: now }], [{ key: to, extra: 0 }], now, { n: 3 });
        S.trains.set(p.id, js.map(j => {
          const rides = j.legs.filter(l => !l.walk);
          return { dep: j.dep, arr: j.arr, label: rides.map(l => `${l.trip.type} ${l.trip.no}`).join(' › '), delay: rides[0]?.trip.sys === 'tra' ? delays.get(rides[0].trip.no) || 0 : 0 };
        }));
      } else {
        // That train today (or tomorrow, after it's gone): its times at your two stations.
        const runs = net.trips.filter(t => t.sys === p.sys && t.no === p.no);
        const times = runs.map(t => ({ a: t.stops.find(x => x.st === from), b: t.stops.find(x => x.st === to) })).filter(x => x.a && x.b && x.a.dep > now - 60_000);
        const x = times[0];
        S.trains.set(p.id, [{ dep: x ? x.a.dep : null, arr: x ? x.b.arr : null, label: x ? W(`${p.type || ''} ${p.no} 次`, `${trainKind(p.type || '')} ${p.no}`).trim() : W(`${p.no} 次今天不開或已過`, `Train ${p.no}: none today or gone`), delay: p.sys === 'tra' ? delays.get(p.no) || 0 : 0 }]);
      }
    }
  } catch {}
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
const anytime = p => p.legs.every(l => l.mode === 'walk' || l.mode === 'bike');
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
  try {
    return JSON.parse(localStorage.getItem(TRIP_CACHE) || '{}') || {};
  } catch {
    return {};
  }
}
function keepTrip(key, kept) {
  try {
    localStorage.removeItem('ot.trips.v1');
    const all = readTrips();
    const now = Date.now();
    for (const k of Object.keys(all)) if (now - all[k].at > KEEP_AHEAD_MS) delete all[k];
    // (Promises, the later buses on their way, aren't kept.)
    all[key] = JSON.parse(JSON.stringify({ at: kept.at, from: kept.from, plans: kept.plans }, (k, v) => (v instanceof Promise ? undefined : v)));
    localStorage.setItem(TRIP_CACHE, JSON.stringify(all));
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

const leave = t => {
  const m = Math.round((t - Date.now()) / 60_000);
  return m <= 0 ? W('現在', 'Now') : m < 60 ? W(`${m} 分後`, `in ${m} min`) : hm(t);
};
// The buses shown near a pinned place: the three soonest at each of its
// stops, the five soonest of those.
const placeBuses = stops =>
  stops
    .flatMap(st => st.rows.slice(0, 3).map(r => ({ ...r, lat: st.lat, lon: st.lon })))
    .sort((a, b) => etaRank(a.v) - etaRank(b.v))
    .slice(0, 5);
const busRow = x => {
  const pinned = ctx.data.groups.some(g => g.items.some(i => i.stopUID === x.stopUID));
  return `<div class="ot-strip">${strip({ no: x.route, note: x.dir ? W('返程', 'Return') : W('去程', 'Outbound'), main: e(x.stop || ''), eta: busWhen(x.v, S.planned.get(x.stopUID)), attrs: `data-route="${e(JSON.stringify({ uid: x.uid, name: x.route, city: x.city, stopUID: x.stopUID, dir: x.dir }))}"` })}<button class="q-icon-btn ot-strip-act${pinned ? ' on' : ''}" type="button" data-pinbus="${e(JSON.stringify({ city: x.city, routeUID: x.uid, route: x.route, dir: x.dir, stopUID: x.stopUID, stop: x.stop, lat: x.lat, lon: x.lon }))}" aria-label="${W('釘選', 'Pin')}" ${pinned ? 'disabled' : ''}>${icon('star')}</button></div>`;
};

// A trip's plans to show: the ways you pinned first (their next
// departure), then the recommendations, up to four; the rest behind 更多:
// one per route (its best departure), none set aside as no way to go.
export function tripPlans(plans, picks = [], now = Date.now()) {
  const live = plans.filter(p => p.dep >= now - 2 * 60_000);
  // A pinned way: its next departure (the others are its times to pick).
  const pinned = [];
  for (const k of picks) pinned.push(...live.filter(p => pickSig(p) === k).sort((a, b) => a.dep - b.dep).slice(0, 1));
  const first = [...pinned, ...live.filter(p => p.top && !pinned.includes(p))].slice(0, Math.max(4, pinned.length));
  return { first, rest: live.filter(p => !first.includes(p) && p.lead !== false && !p.weak && !picks.includes(pickSig(p))) };
}

function tripCard({ t, w }) {
  const st = tripOf(w);
  const head = `<header class="ot-go-head"><span class="ot-go-title">${icon(w.recurring ? 'clock' : 'route')}<b>${e(w.label)}</b></span><small>${e(w.from ? w.from.name : W('目前位置', 'Here'))} → ${e(w.to.name)}${w.at ? ` · ${tw(w.at).date !== tw().date ? e(dayLabel(tw(w.at).date)) + ' ' : ''}${w.by === 'arrive' ? W('抵達', 'arrive') : W('出發', 'leave')} ${hm(w.at)}` : ''}</small><button class="q-icon-btn" type="button" data-edit-trip="${e(t.id)}" aria-label="${W('編輯', 'Edit')}">${icon('edit')}</button></header>`;
  if (!st) return `<section class="ot-go-card">${head}<button class="q-btn ot-wide" type="button" data-load-trip="${e(t.id)}">${W('看接下來的班次', 'See the next rides')}</button></section>`;
  const all = st.plans || [];
  const { first, rest } = tripPlans(all, t.picks);
  // One row per way: the departure picked from its times (the first shown at first), the leave and arrival times its own.
  const row = lead => {
    const at = all.indexOf(lead);
    const i = S.choice.get(`${w.id}:${at}`) ?? at;
    const p = all[i];
    const pin = t.picks.includes(pickSig(p));
    const times = (lead.times || []).filter(j => all[j] && all[j].dep >= Date.now() - 2 * 60_000);
    const deps = depChips(all, times, i, j => `data-go-dep="${e(w.id)}" data-lead="${at}" data-i="${j}"`).replace('ot-plan-deps', 'ot-plan-deps ot-go-deps');
    return `<div class="ot-go-plan-row"><button class="ot-go-plan" type="button" data-nav-trip="${e(w.id)}" data-i="${i}">
      <span class="ot-go-leave"><b>${e(leave(p.dep))}</b><small>${p.dep - Date.now() < 60 * 60_000 ? W(`${e(hm(p.dep))} 出發`, `Leave ${e(hm(p.dep))}`) : tw(p.dep).date !== tw().date ? W(`${e(dayLabel(tw(p.dep).date))}出發`, `Leave ${e(dayLabel(tw(p.dep).date))}`) : W('建議出發', 'Leave then')}</small></span>
      <span class="ot-go-legs"><span class="ot-legs">${legChips(p.legs)}</span><small>${p.live ? W('預計 ', '') : ''}${W(`${e(hm(p.arr))} 抵達`, `Arrive ${e(hm(p.arr))}`)} · ${e(minsText(p.dur))}${p.transfers ? ` · ${W('轉乘', 'changes')} ${p.transfers}` : ''}${p.fareText ? ` · ${e(p.fareText)}` : ''}${p.live ? ` · <i class="ot-livedot"></i>${W('即時', 'Live')}` : ''}</small>${p.miss || p.off || p.late || lateBy(p, p.arr) || p.rivers?.length ? `<small class="warn">${e(p.off || p.miss || p.late || (lateBy(p, p.arr) ? W(`比 ${hm(p.deadline)} 晚 ${lateBy(p, p.arr)} 分到`, `${lateBy(p, p.arr)} min after ${hm(p.deadline)}`) : '') || W(`${p.riverBy || '騎車'}過${p.rivers.join('、')}`, `${tagText(p.riverBy || '騎車')} across ${p.rivers.join(', ')}`))}</small>` : ''}</span>
      ${icon(canNav(p) ? 'route' : 'chevron')}</button><button class="q-icon-btn${pin ? ' on' : ''}" type="button" data-pick-trip="${e(w.id)}" data-i="${i}" aria-label="${pin ? W('取消釘選這個方案', 'Unpin this route') : W('釘選這個方案', 'Pin this route')}">${icon('star')}</button>${deps}</div>`;
  };
  // (By a time nothing reaches any more: said once, the ways below leaving now.)
  const behind = w.by === 'arrive' && w.at && first.length && first.every(p => lateBy(p, p.arr)) ? `<p class="ot-note warn">${W(`${e(hm(w.at))} 前到不了了，現在出發最快的方式：`, `Can’t make ${e(hm(w.at))}. Fastest from now:`)}</p>` : '';
  const more = S.more.has(w.id);
  const plans = first.map(row).join('') + (rest.length ? (more ? rest.map(row).join('') : '') + `<button class="ot-go-link" type="button" data-more-trip="${e(w.id)}">${more ? W('收起', 'Less') : W(`更多方案（${rest.length}）`, `More routes (${rest.length})`)}</button>` : '');
  const hint = all.length && !t.picks.length ? `<p class="ot-note ot-go-tip">${W('按 ☆ 釘選你常搭的方案，它的下一班會排在最前面。', 'Tap ☆ on a route you take: its next ride goes first.')}</p>` : '';
  return `<section class="ot-go-card">${head}${behind}${plans}${hint}${st.loading && !all.length ? `<p class="ot-note">${W('找班次…', 'Finding rides…')}</p>` : ''}${st.error && !all.length ? `<p class="ot-note">${e(st.error)}</p>` : ''}<button class="ot-go-link" type="button" data-all-trip="${e(w.id)}">${W('在地圖上看所有方案', 'All routes on the map')} ${icon('chevron')}</button></section>`;
}

function pinnedHtml() {
  const items = ctx.data.groups.flatMap(g => g.items.map(it => ({ it, g })));
  const trains = ctx.data.pins;
  if (!items.length && !trains.length) return '';
  // A ride: on → off, the way you'd go now (⇄ turns it round); a stop pinned alone: the stop.
  const buses = items
    .map(({ it }) => ({ it, r: sideOf(it), v: S.pinned.get(sideOf(it).stopUID) }))
    .sort((a, b) => etaRank(a.v) - etaRank(b.v))
    .map(({ it, r, v }) => {
      // No bus on its way: the timetable's next there (with its day, not today's); else what TDX says.
      const p = !(v?.status === 0 && v.sec != null) ? S.planned.get(r.stopUID) : null;
      const t = busWhen(v, p);
      // One row, as every bus here, the times in one column: the line, where
      // you get on and (under it) where you get off; a ride with a way back
      // has its 去程/回程 tag first on that line, a tap turning it round.
      // ☆ to unpin is in the route's sheet (a tap away) and 我的.
      // (A stop pinned alone: which way its buses go.)
      const route = e(JSON.stringify({ uid: it.routeUID, name: it.route, city: it.city, stopUID: r.stopUID, dir: r.dir }));
      const dir = it.back ? `<span class="ot-strip-dir" role="button" data-flip="${e(it.id)}" aria-label="${r.back ? W('回程，改看去程', 'Return; show outbound') : W('去程，改看回程', 'Outbound; show return')}">${icon('swap')}${r.back ? W('回程', 'Return') : W('去程', 'Out')}</span>` : '';
      const note = r.off ? `${dir}${W('到', 'to')} ${e(r.off.stop)}${it.n ? ` · ${W(`${it.n} 站`, `${it.n} stops`)}` : ''}` : `${W('往', 'to')} ${e(r.headsign || '—')}`;
      return `<div class="ot-strip">${strip({ no: it.route, note, main: e(r.stop), eta: t, attrs: `data-route="${route}"` })}</div>`;
    })
    .join('');
  const name = s => (s.sys === 'hsr' ? W(`高鐵${s.name}`, `HSR ${s.name}`) : s.name);
  const tr = trains
    .map(p => {
      const list = S.trains.get(p.id) || [];
      const rowsHtml = list
        .filter(x => x.dep == null || x.dep > Date.now() - 60_000 || p.kind === 'trainNo')
        .map(x => `<span class="ot-go-tr"><b>${e(hm(x.dep))}</b>${x.arr ? `→${e(hm(x.arr))}` : ''} <small>${e(x.label)}</small>${x.delay ? `<i class="warn">${W(`晚 ${x.delay} 分`, `${x.delay} min late`)}</i>` : ''}</span>`)
        .join('');
      return `<div class="ot-go-row train"><span class="ot-go-what"><b>${e(name(p.from))} → ${e(name(p.to))}</b><small>${p.kind === 'trainNo' ? W('釘選的車次', 'Pinned train') : W('接下來的車', 'Next trains')}</small><span class="ot-go-trs">${rowsHtml || `<small>${W('載入中…', 'Loading…')}</small>`}</span></span><button class="q-icon-btn on" type="button" data-unpin-train="${e(p.id)}" aria-label="${W('取消釘選', 'Unpin')}">${icon('star')}</button><button class="q-icon-btn" type="button" data-times="${e(p.id)}" aria-label="${W('查時刻', 'Times')}">${icon('chevron')}</button></div>`;
    })
    .join('');
  return `<h3 class="ot-go-h">${W('釘選的公車・火車', 'Pinned buses and trains')}</h3><section class="ot-go-card">${buses}${tr}</section>`;
}

function placesHtml() {
  const here = ctx.here;
  const list = ctx.data.places.filter(p => !here || meters(here.lat, here.lon, p.lat, p.lon) > 300);
  if (!list.length) return '';
  return `<h3 class="ot-go-h">${W('釘選地點', 'Pinned places')}</h3>${list
    .map(p => {
      const open = S.open.has(p.id);
      const d = S.places.get(p.id);
      const body = !open
        ? ''
        : !d
          ? `<p class="ot-note">${W('載入…', 'Loading…')}</p>`
          : `${d.error ? `<p class="ot-note">${e(d.error)}</p>` : ''}${placeBuses(d.stops)
              .map(x => busRow(x))
              .join('')}${d.bikes.length ? `<div class="ot-go-bikes">${d.bikes.map(b => `<span class="ot-go-bike">${icon('bike')}<b>${e(b.name)}</b><small>${W('一般', 'Bikes')} ${b.bikes}・⚡${b.ebike}・${W('空位', 'Docks')} ${b.ret}</small></span>`).join('')}</div>` : ''}`;
      return `<section class="ot-go-card"><header class="ot-go-head"><button class="ot-go-title" type="button" data-place="${e(p.id)}">${PLACE_ICONS[p.icon] || '📍'} <b>${e(p.name)}</b>${here ? `<small>${e(distText(meters(here.lat, here.lon, p.lat, p.lon)))}</small>` : ''}</button><button class="q-btn" type="button" data-go-place="${e(p.id)}">${icon('route')} ${W('怎麼去', 'Directions')}</button></header>${body}</section>`;
    })
    .join('')}`;
}

function render() {
  if (!shown) return;
  const ts = trips();
  // (A trip just changed in its sheet: its new plans, now.)
  for (const { w } of ts.slice(0, 2)) if (!tripOf(w) && S.trips.has(w.id)) queueMicrotask(() => loadTrip(w));
  const box = $('panel-go');
  const keep = box.scrollTop;
  box.innerHTML = `<div class="ot-wrap ot-go">
    ${ts.length ? `<h3 class="ot-go-h">${ts.some(x => x.w.recurring && x.w.today) ? W('常用行程', 'Usual trips') : W('釘選行程', 'Pinned trips')}</h3>${ts.map(tripCard).join('')}` : `<section class="ot-go-card ot-go-hint"><b>${W('釘選常去的行程', 'Pin the trips you take')}</b><p>${W('在地圖上查路線，按 ☆ 釘選（例如 家 → 學校，平日早上）。這裡會列出接下來最好的幾班，回程也會自動出現。', 'Find a route on the map and tap ☆ (say Home → School, weekday mornings). The best next rides show here, and the way back too.')}</p><button class="q-btn" type="button" data-go-me="trip">${icon('plus')} ${W('新增行程', 'Add a trip')}</button></section>`}
    ${pinnedHtml()}
    ${placesHtml()}
  </div>`;
  fitStrips(box);
  box.scrollTop = keep;
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
    if (w) return ctx.openTrip(w.from, w.to, { at: w.at, by: w.by });
  }
  const lt = ev.target.closest('[data-load-trip]');
  if (lt) {
    const w = trips().find(x => x.t.id === lt.dataset.loadTrip)?.w;
    if (w) return loadTrip(w, { force: true });
  }
  const ed = ev.target.closest('[data-edit-trip]');
  if (ed) return ctx.editTrip?.(ed.dataset.editTrip);
  const pl = ev.target.closest('[data-place]');
  if (pl) {
    const id = pl.dataset.place;
    S.open.has(id) ? S.open.delete(id) : S.open.add(id);
    render();
    return loadPlace(id).then(render);
  }
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
  if (ev.target.closest('[data-go-me]')) return ctx.goTab('me');
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
