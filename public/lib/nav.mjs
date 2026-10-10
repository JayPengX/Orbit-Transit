// 導航: a plan followed step by step with the phone's position. Walking and
// riding steps say how far is left (and open Google Maps' own turn-by-turn
// navigation for that step with one tap: free, no billed call); a bus or
// train step counts down to it to the second and shows where it is now (how
// many stops away; TDX, every 20 s); on board, the stops still to go with
// when it's at each (TDX's estimates, and your own pace from where the phone
// has been for every stop they don't cover), and a buzz with the card turned
// round when yours is next; off it, what's next. Each step moves on by itself
// when you get there.

import * as kit from '#kit/quadra.mjs';
import { watchPosition, roadPath } from './api.mjs';
import { buzz, primeBuzz } from './buzz.mjs';
import { liveTimes, officialLeg, liveTrusted, wayOf } from './live.mjs';
import { routeStops, routeSchedule, routeCity, routeEta, stationsNear, stationEtaAsk } from './bus.mjs';
import { etaAround, bikesAround } from './near.mjs';
import { rideSec, DOCK_SEC } from './plan.mjs';
import { traLive, dayTrips, railStations } from './raildata.mjs';
import { busWhere, trainWhere, trainByTime, nextStop, busAhead, nearestStop, countText, trainFor, routeCum, alongRoute, ridePace, aheadByPace } from './navlive.mjs';
import { icon, MODE_NAME, legColor, legLabel } from './ui.mjs';
import { e, hm, minsText, distText, meters, walkSec, tw, decodeLine } from './util.mjs';

let nav = null;

// The ride being followed, kept on the phone: swiped away and opened again,
// it goes on where it was (savedNav, for tab-map), until it's over or ended.
const NAV_KEY = 'ot.nav.v1';
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => (v instanceof Promise ? undefined : v)));
function saveNav(state) {
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify({ plan: plain(state.plan), i: state.i, phase: state.phase, min: Boolean(state.min), at: Date.now() }));
  } catch {}
}
export function savedNav(now = Date.now()) {
  try {
    const x = JSON.parse(localStorage.getItem(NAV_KEY) || 'null');
    if (x?.plan?.legs?.length && x.plan.arr > now - 5 * 60_000) return x;
    localStorage.removeItem(NAV_KEY);
  } catch {}
  return null;
}
const dropNav = () => {
  try {
    localStorage.removeItem(NAV_KEY);
  } catch {}
};

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
      const t = trainFor(await dayTrips(tw(l.dep).date), await railStations(), l);
      if (t) l.train = { ...(l.train || {}), ...t };
    }
    if (!l.train?.no) return null;
    const trip = (await dayTrips(tw(l.dep).date)).find(t => t.sys === l.mode && String(t.no) === String(l.train.no));
    if (!trip) return null;
    const sts = new Map((await railStations()).map(s => [s.key, s]));
    const stops = trip.stops.map(x => ({ id: x.st, name: sts.get(x.st)?.name || '', lat: sts.get(x.st)?.lat, lon: sts.get(x.st)?.lon, at: x.arr, dep: x.dep })).filter(x => x.lat != null);
    const i = nearestStop(stops, l.from, 0, 800);
    const j = i >= 0 ? nearestStop(stops, l.to, i + 1, 800) : -1;
    return j > i ? { stops, i, j } : null;
  }
  return null;
}

// What the lock screen says while navigating (the Worker sends them with the
// app closed; push.js): when to set out, the bus to catch nearly there (its
// live times, checked every 2 minutes), when to get ready to get off, a train
// about to leave. `info`: busInfo by leg.
export function navNotices(plan, i, info = new Map(), now = Date.now()) {
  const out = [];
  if (i === 0 && plan.dep - 2 * 60_000 > now) out.push({ at: plan.dep - 2 * 60_000, title: '該出發了', body: `${hm(plan.dep)} 出發・${hm(plan.arr)} 抵達`, tag: 'nav:leave', kind: 'nav', hash: 'nav' });
  plan.legs.forEach((l, k) => {
    if (k < i) return;
    if (l.mode === 'bus') {
      const x = info.get(k);
      const st = x?.station;
      if (st && x.leg.route?.uid && l.dep > now - 5 * 60_000) out.push({ at: Math.max(now, l.dep - 25 * 60_000), until: l.dep + 30 * 60_000, title: `${rideName(x.leg)} 快到了`, body: `{result}（${st.name}）`, tag: `nav:bus:${k}`, kind: 'nav', hash: 'nav', check: { bus: { path: stationEtaAsk(st), route: x.leg.route.uid, dir: Number(x.leg.route.dir), min: 5 } } });
    }
    if ((l.mode === 'tra' || l.mode === 'hsr') && l.dep - 5 * 60_000 > now) out.push({ at: l.dep - 5 * 60_000, title: `${rideName(l)} ${hm(l.dep)} 開`, body: `在 ${l.from?.name || ''}${l.train?.platform ? ` ${l.train.platform} 月台` : ''}${wayText(l) ? `・${wayText(l)}` : ''}`, tag: `nav:train:${k}`, kind: 'nav', hash: 'nav' });
    if (RIDE(l) && l.arr - 3 * 60_000 > now) out.push({ at: l.arr - 3 * 60_000, title: `快到 ${l.to?.name || ''} 了`, body: `準備下車${plan.legs[k + 1] ? `，接著${stepText(plan, k + 1, 'before').title}` : ''}`, tag: `nav:off:${k}`, kind: 'nav', hash: 'nav' });
  });
  return out;
}

const ARRIVED = { walk: 35, bike: 60 };
const NEXT_STOP_M = 600;

export const navigating = () => Boolean(nav);
// Any plan not yet over: one leaving later starts too, saying when to set out.
export const NAV_LEAD = 20 * 60_000;
export const canNav = (p, now = Date.now()) => Boolean(p) && p.arr > now;

// Google Maps' own navigation for one step (walking, riding) or the rest by
// transit: from where you are then (no origin: Google's own 你的位置, never
// a point we pinned), to the place itself when it's one of Google's (its
// place id: the shop, not a spot in the road outside it), else the point.
export const GOOGLE_ID = /^[A-Za-z0-9_-]{20,300}$/;
export function gmapsLink(to, mode) {
  const p = new URLSearchParams({ api: '1' });
  if (to.gid && GOOGLE_ID.test(to.gid) && to.name) {
    p.set('destination', to.name);
    p.set('destination_place_id', to.gid);
  } else p.set('destination', `${to.lat},${to.lon}`);
  p.set('travelmode', mode);
  if (mode !== 'transit') p.set('dir_action', 'navigate');
  return `https://www.google.com/maps/dir/?${p}`;
}
// Where a leg ends, for Google: the trip's own place for its last one.
export const legEnd = (plan, k) => (k === plan.legs.length - 1 && plan.dest?.lat != null && meters(plan.dest.lat, plan.dest.lon, plan.legs[k].to.lat, plan.legs[k].to.lon) < 300 ? plan.dest : plan.legs[k].to);

const RIDE = l => l && l.mode !== 'walk' && l.mode !== 'bike';
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
// The ride itself, said the way its sign says it: 公車 5608 往 竹東, 區間 1234 次 往 新竹.
export function rideName(l) {
  let s = String(l.short || l.name || '').trim();
  // A planner's line (新竹-六家) isn't what the sign says: the train's kind, from the timetable, is.
  if (l.mode === 'tra' && l.train?.type && /-/.test(s)) s = l.train.type;
  if (l.mode === 'tra') {
    const t = `${s}${l.train?.no && !s.includes(l.train.no) ? ` ${l.train.no}` : ''}`;
    return `台鐵 ${t}${/\d$/.test(t) ? ' 次' : ''}`;
  }
  if (l.mode === 'hsr') return s.startsWith('高鐵') ? s : `高鐵 ${s}`;
  return `${MODE_NAME[l.mode] || ''} ${s}`.trim();
}
// A sign's way, without the 往 a source may have put on it already.
const toward = h => String(h || '').replace(/^往\s*/, '');
// Which way, as said on the card: the sign's way, unless it names where you
// board (a loop, 藍線1區 「往 火車站」 at 火車站): then where you're going.
export const wayText = l => {
  const h = toward(l.headsign);
  if (!h) return '';
  return `往 ${h === String(l.from?.name || '').trim() && l.to?.name ? l.to.name : h}`;
};
// What to do on a leg, before (or while) doing it: one short line, and what's said under it.
function stepText(plan, i, phase) {
  const l = plan.legs[i];
  const next = plan.legs[i + 1];
  const where = l.to?.name || (next?.from?.name ?? '') || '目的地';
  if (l.mode === 'walk') {
    const last = i === plan.legs.length - 1;
    return { title: `走到 ${last && !l.to?.name ? '目的地' : where}`, sub: next?.mode === 'bike' ? `在這裡借 ${next.ebike ? '電輔車' : 'YouBike'}` : RIDE(next) ? `搭 ${rideName(next)}` : '' };
  }
  if (l.mode === 'bike') return { title: `騎到 ${l.to.name}`, sub: l.swap ? '還車再借一台（每 30 分鐘換一次車）' : `${l.ebike ? '電輔車' : 'YouBike'}・在 ${l.from.name} 借車` };
  if (phase === 'on') return { title: `坐到 ${l.to.name} 下車`, sub: `${rideName(l)}${wayText(l) ? ` ${wayText(l)}` : ''}` };
  return { title: `搭 ${rideName(l)}`, sub: `${l.from.name}${wayText(l) ? `・${wayText(l)}` : ''}${l.train?.platform ? `・${l.train.platform} 月台` : ''}` };
}
// The ride this step leads to (the bus or train you're on your way to catch), or this step's own.
const rideOf = (plan, i) => plan.legs.slice(i).findIndex(RIDE) + i;

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
    if (RIDE(l)) {
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

// The line under the step: how you're doing for the bus or train to catch
// (there with minutes to spare, only just, or late), when to set out, or
// when you'll be there. → { text, tone: 'good' | 'warn' | 'bad' | '' }.
export function paceOf(plan, i, phase, times, liveAt = new Map(), now = Date.now(), live = '') {
  // (A plan starting with the ride itself: its own line below, with what's live.)
  if (i === 0 && phase !== 'on' && !RIDE(plan.legs[0]) && plan.dep - now > 60_000) {
    // When to set out, unless from where you are now leaving then misses the
    // ride (times: from your position): then leave now, or it's gone already.
    const k = rideOf(plan, 0);
    const ready = k > 0 ? times.ready.get(k) : null;
    const dep = k > 0 ? (liveAt.get(k) ?? plan.legs[k].dep) : null;
    if (ready == null || dep == null || ready <= dep) return { text: `${hm(plan.dep)} 出發・還有 ${minsText(Math.round((plan.dep - now) / 1000))}`, tone: '' };
    const slack = Math.round((dep - (ready - (Math.max(now, plan.dep - 60_000) - now))) / 60_000);
    return slack >= 0 ? { text: `現在就出發・${hm(dep)} 的車還趕得上`, tone: 'warn' } : { text: `從這裡趕不上 ${hm(dep)} 的車了`, tone: 'bad' };
  }
  const ri = rideOf(plan, i);
  const r = ri >= i ? plan.legs[ri] : null;
  // On board: when you're at your stop (the bottom says when you're there); nothing to catch: nothing to say.
  if (ri === i && phase === 'on') return { text: live || `${hm(times.end[i])} 到 ${r.to?.name || ''}`, tone: live ? 'warn' : '' };
  if (!r) return { text: '', tone: '' };
  const dep = liveAt.get(ri) ?? r.dep;
  // (Not when the step you're on is the walk to it: its title says where already.)
  const at = r.from?.name && !(ri > i && plan.legs[i].to?.name === r.from.name) ? `${r.from.name} ` : '';
  const when = `${r.mode === 'bus' ? `${liveAt.has(ri) ? '' : '約 '}${hm(dep)} 到站` : `${hm(dep)} 開`}`;
  if (ri === i) {
    const m = Math.round((dep - now) / 60_000);
    return { text: `${at}${when}${m > 0 ? `・${m} 分後` : '・就要到了'}${live && !/到站/.test(live) ? `・${live}` : ''}`, tone: m > 0 ? '' : 'warn' };
  }
  const slack = Math.round((dep - times.ready.get(ri)) / 60_000);
  const you = `你 ${hm(times.ready.get(ri))} 到`;
  if (slack >= 2) return { text: `${at}${when}・${you}・早 ${slack} 分`, tone: 'good' };
  if (slack >= 0) return { text: `${at}${when}・${you}・剛好趕上`, tone: 'warn' };
  return { text: `${at}${when}・${you}・晚了 ${-slack} 分，要快一點`, tone: 'bad' };
}

// A step's chip at the bottom: its kind, and what tells it apart (a walk's
// minutes, a ride's line and time).
const chipText = l => (l.mode === 'walk' ? `${Math.max(1, Math.round((l.dur || 0) / 60))}′` : l.mode === 'bike' ? `${l.ebike ? '電輔車' : 'YouBike'} ${Math.max(1, Math.round((l.dur || 0) / 60))}′` : `${legLabel(l)} ${hm(l.dep)}`);

// The YouBike ride coming up, now: bikes where you take one (until you've
// left with it; none there, the nearest station that has some) and docks
// where you leave it.
function bikesText(bk, plan, i, pos) {
  if (!bk || bk.k < i) return '';
  const from = plan.legs[bk.k].from;
  const out = [];
  const taking = bk.k > i || !pos || meters(pos.lat, pos.lon, from.lat, from.lon) < 150;
  if (bk.rent && taking) {
    if (bk.has) out.push(`<span>${icon('bike')}可借 ${bk.rent.bikes}${bk.rent.ebike ? `・⚡${bk.rent.ebike}` : ''}</span>`);
    else out.push(`<span class="bad">${icon('bike')}沒車了${bk.alt ? `，${e(bk.alt.name)} 有 ${bk.alt.n} 台（${e(distText(bk.alt.d))}）` : ''}</span>`);
  }
  if (bk.ret) out.push(`<span class="${bk.ret.ret ? '' : 'bad'}">還車空位 ${bk.ret.ret}</span>`);
  return out.join('');
}

// How long till you're there, short enough to sit beside the time and its drift: 45 分, 1時29分.
export const leftText = m => (m < 60 ? `${m} 分` : `${Math.floor(m / 60)}時${String(m % 60).padStart(2, '0')}分`);
// What's left of a walk or ride, big: metres under a kilometre.
const distBig = m => (m < 1000 ? `<b>${Math.round(m / 10) * 10}</b><small>公尺</small>` : `<b>${(m / 1000).toFixed(1)}</b><small>公里</small>`);
// The countdown to a bus or train, big: to the second under ten minutes.
const countBig = (ms, what) => (ms >= 600_000 ? `<b>${Math.round(ms / 60_000)}</b><small>分</small>` : `<b>${countText(ms)}</b><small>${e(what)}</small>`);

// Coming to your stop: its last few stops on a line, yours at the end, the
// bus or train where it is now (on a stop, or between two), what it's at.
export function trackHtml(rs, w, l) {
  const i = rs.i;
  const far = w.far || w.k - 1 < i - 5;
  const s0 = Math.max(0, Math.min(far ? i - 5 : w.k - 1, i - 1));
  const n = Math.max(1, i - s0);
  const x = m => ((m - s0) / n) * 100;
  const bus = l.mode === 'bus';
  const there = bus ? w.in <= 60 : w.at;
  const vx = far ? 0 : there ? x(w.k) : Math.max(0, x(w.k) - 50 / n);
  const kind = bus ? '公車' : '列車';
  const name = rs.stops[w.k]?.name || '';
  const where = far ? `${kind}還在 ${w.away} 站外` : w.away === 0 ? (there ? (bus ? '公車進站中' : '列車在月台上') : `${kind}下一站就到這裡`) : `${kind}${there ? (bus ? '快到' : '停在') : '開往'} ${name}`;
  const dots = [];
  for (let m = s0; m <= i; m++) dots.push(`<i class="${m < w.k ? 'past' : ''}${m === i ? ' you' : ''}" style="left:${x(m).toFixed(1)}%"></i>`);
  return `<div class="ot-track">
      <div class="ot-track-say"><span>${e(where)}${w.planned ? '（依時刻表）' : ''}</span>${w.away ? `<b>還有 ${w.away} 站</b>` : ''}</div>
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
  const show = ks.length > 4 ? [ks[0], ks[1], null, ks.at(-1)] : ks;
  return `<ol class="ot-board">${show
    .map(k =>
      k == null
        ? `<li class="more"><i></i><span>再 ${ks.length - 3} 站</span></li>`
        : `<li class="${k === next ? 'next' : ''}${k === rs.j ? ' you' : ''}"><i></i><span>${e(rs.stops[k].name)}</span>${k === rs.j ? '<em>下車</em>' : k === next ? '<em>下一站</em>' : ''}${at(k) ? `<time>${e(hm(at(k)))}</time>` : ''}</li>`
    )
    .join('')}</ol>`;
}

// plan: a ranked plan; `draw(plan, i)` shows it on the map with leg i lit;
// `follow(pos)` keeps the map on you; `onEnd()` when it's closed; `dest`:
// the place the trip is to (Google's, for its own navigation to it).
export function startNav(plan, { box, mini = null, draw, follow, onEnd, onAction = null, here = null, resume = null, push = null, dest = null }) {
  // Started by a tap (mostly): the iPhone's chime may sound from now on.
  primeBuzz();
  stopNav();
  if (dest?.lat != null && !plan.dest) plan = { ...plan, dest: { name: dest.name || '', lat: dest.lat, lon: dest.lon, ...(dest.gid ? { gid: dest.gid } : {}) } };
  const state = { plan, i: 0, phase: 'before', pos: here, live: '', liveAt: new Map(), alerted: -1, wake: null, info: new Map(), push, bikes: null, done: false, ride: new Map(), where: null, next: null, ahead: null, arrAt: null, delay: 0, fresh: 0, offAt: 0, drawn: 0, track: [], paced: null, delayLive: false, away: 0, min: Boolean(resume?.min) };
  // The buses' official routes, ways and stations, then the lock screen's notices.
  const infos = plan.legs.map((l, k) => (l.mode === 'bus' && l.from?.lat ? busInfo(l).then(x => state.info.set(k, x)).catch(() => {}) : null)).filter(Boolean);
  const notices = () => nav === state && push?.(navNotices(plan, state.i, state.info));
  Promise.all(infos).then(notices);
  nav = state;
  box.hidden = false;
  box.className = 'ot-nav';
  const render = () => {
    if (nav !== state) return;
    const now = Date.now();
    state.drawn = now;
    const last = plan.legs.length - 1;
    const l = plan.legs[state.i];
    const ride = RIDE(l);
    const on = ride && state.phase === 'on';
    const rs = ride ? state.ride.get(state.i) : null;
    const t = stepText(plan, state.i, state.phase);
    const times = navTimes(plan, state.i, state.phase, state.pos, state.liveAt, now, on ? (state.arrAt ?? (rs ? state.paced?.get(rs.j) : null) ?? null) : null);
    const pace = state.done ? { text: `${hm(now)} 抵達`, tone: 'good' } : paceOf(plan, state.i, state.phase, times, state.liveAt, now, state.live);
    // What's left: along its road when it has one (where you are on it), else as the crow flies.
    const left = state.pos && l.to?.lat ? (state.leftAlong ?? meters(state.pos.lat, state.pos.lon, l.to.lat, l.to.lon)) : null;
    let title = state.done ? `已抵達 ${plan.legs.at(-1).to?.name || '目的地'}` : t.title;
    let sub = state.done ? '' : t.sub;
    // Yours the next stop (no stops known: under 600 m): the card turned round to say so.
    const offNext = on && !state.done && (rs && state.next != null ? state.next >= rs.j : left != null && left < NEXT_STOP_M);
    if (offNext) {
      title = `下一站 ${l.to.name} 下車`;
      sub = l.mode === 'bus' ? '按下車鈴，準備下車' : '準備下車';
    }
    // The bus or train at your stop now.
    const w = ride && !on && !state.done ? state.where : null;
    const coming = Boolean(w && w.away === 0 && (l.mode === 'bus' ? w.in <= 60 : w.at));
    if (coming) {
      title = l.mode === 'bus' ? `${rideName(l)} 進站了` : `${rideName(l)} 在月台上`;
      sub = l.mode === 'bus' ? `招手上車${wayText(l) ? `・${wayText(l)}` : ''}` : t.sub;
    }
    // The big number on the right: what's left of a walk or ride; on board, the stops to go; else the countdown to the bus or train.
    let big = '';
    let cd = '';
    if (state.done) big = '';
    else if (!ride && left != null) big = distBig(left);
    else if (on && rs && state.next != null) big = `<b>${rs.j - state.next + 1}</b><small>站</small>`;
    else if (on && left != null) big = distBig(left);
    else if (ride) {
      const at = state.liveAt.get(state.i) ?? l.dep;
      const what = l.mode === 'bus' ? '後到站' : '後開車';
      cd = ` data-cd="${at}" data-k="${what}"`;
      big = countBig(at - now, what);
    }
    // Where the bus or train is (coming to you), or the stops to go (on it).
    // Your stop the first of its way (藍線1區 at 火車站): no bus on its way to show; it sets out from here.
    const origin = ride && !on && !state.done && !coming && !w && rs && rs.i === 0 ? `<div class="ot-track"><div class="ot-track-say"><span>${l.mode === 'bus' ? '起點站：公車從這裡發車' : '起點站：列車從這裡發車'}</span></div></div>` : '';
    const track = w && rs && !coming ? trackHtml(rs, w, l) : origin;
    const board = on && rs && state.next != null && !state.done ? boardHtml(rs, state.next, state.ahead, state.delay, times.end[state.i], state.paced, state.delayLive, navStopAt) : '';
    // YouBike where you take it and leave it, now: bikes (or none, and the nearest that has some), docks.
    const bikeLine = state.done ? '' : bikesText(state.bikes, plan, state.i, state.pos);
    // A walk or a ride of your own: Google Maps' turn-by-turn for it, from where you are.
    const own = !state.done && (l.mode === 'walk' || l.mode === 'bike') && l.to?.lat != null;
    const gm = own ? gmapsLink(legEnd(plan, state.i), l.mode === 'bike' ? 'bicycling' : 'walking') : '';
    const paceText = pace.text || (own ? `約 ${hm(times.end[state.i])} 到${l.to?.name ? ` ${l.to.name}` : ''}` : '');
    // Late for the bus or train: a new plan from here, one tap.
    const late = !state.done && pace.tone === 'bad';
    // On board but well off its way twice running: got off somewhere else?
    const strayed = on && !state.done && state.away >= 2 ? `<div class="ot-nav-ask"><span>好像已經下車了？</span><button type="button" data-nav="replan">從這裡重新規劃</button></div>` : '';
    const ri = rideOf(plan, state.i);
    const liveNow = !state.done && ri >= state.i && state.fresh && now - state.fresh < 75_000;
    // Off a bus or train a moment ago: said, with what's next.
    const prev = plan.legs[state.i - 1];
    const off = !state.done && state.offAt && now - state.offAt < 120_000 && RIDE(prev) ? `<div class="ot-nav-off">${icon('pin')}<span>已在 ${e(prev.to?.name || '')} 下車</span></div>` : '';
    // On board: what comes after you get off.
    const nx = on && !state.done && state.i < last ? plan.legs[state.i + 1] : null;
    const then = nx ? `<div class="ot-nav-then"><small>下車後</small>${icon(nx.mode)}<span>${e(stepText(plan, state.i + 1, 'before').title)}${RIDE(nx) ? `・${e(hm(state.liveAt.get(state.i + 1) ?? nx.dep))} ${nx.mode === 'bus' ? '到站' : '開'}` : `・${e(minsText(nx.dur))}`}</span></div>` : '';
    const chips = plan.legs
      .map((x, k) => `<button class="ot-nav-chip${k < state.i ? ' done' : k === state.i ? ' on' : ''}" type="button" data-nav-go="${k}" style="--c:${e(legColor(x))}">${icon(x.mode)}<span>${e(chipText(x))}</span></button>`)
      .join('');
    const minsLeft = Math.max(0, Math.round((times.eta - now) / 60_000));
    // Later or sooner than the plan said, by what's live now.
    // (Only while a bus or train is still ahead: the rest by bike or on foot is at your own pace, nothing to be early or late for.)
    const drift = state.done || !plan.legs.slice(state.i).some(RIDE) ? 0 : Math.round((times.eta - plan.arr) / 60_000);
    const driftText = Math.abs(drift) >= 2 ? `<em class="${drift > 0 ? 'bad' : 'good'}">${drift > 0 ? `晚 ${drift} 分` : `早 ${-drift} 分`}</em>` : '';
    const topHtml = `<div class="ot-nav-top${offNext ? ' alert' : ''}${coming ? ' coming' : ''}${on ? ' aboard' : ''}" style="--c:${e(legColor(l))}">
        ${off}${strayed}
        <div class="ot-nav-main">
          <span class="ot-nav-i">${icon(state.done ? 'pin' : offNext ? 'bell' : l.mode)}</span>
          <div class="ot-nav-text"><b>${e(title)}</b>${sub ? `<small>${e(sub)}</small>` : ''}</div>
          ${big ? `<span class="ot-nav-big"${cd}>${big}</span>` : ''}
        </div>
        ${track}${board}
        ${paceText || gm ? `<div class="ot-nav-pace ${pace.text ? pace.tone : ''}${liveNow ? ' live' : ''}">${liveNow ? '<i class="ot-nav-dot"></i>' : icon(pace.tone ? 'live' : 'clock')}<span>${e(paceText)}</span>${late ? `<button class="ot-nav-gm" type="button" data-nav="replan">${icon('route')}重新規劃</button>` : gm ? `<a class="ot-nav-gm" href="${e(gm)}" target="_blank" rel="noopener">${icon('route')}Google 地圖</a>` : ''}</div>` : ''}
        ${bikeLine ? `<div class="ot-nav-bikes">${bikeLine}</div>` : ''}
        ${then}
      </div>`;
    const etaHtml = `<div class="ot-nav-eta">
          <span><b>${e(hm(state.done ? now : times.eta))}</b>${driftText}<small>${state.done ? '已抵達' : `${driftText ? '剩 ' : '抵達・還要 '}${leftText(minsLeft)}`}</small></span>
          <button class="q-icon-btn" type="button" data-nav="more" aria-label="更多：縮小、改下車站、重新規劃、改目的地">${icon('more')}</button>
          <button class="q-btn ot-nav-end" type="button" data-nav="end">結束</button>
        </div>`;
    // Drawn in place: the card's parts each time, the row of steps only when
    // it changes (it's scrolled by hand; redrawn, it jumped back every few
    // seconds), centred on the step you're on only when that changes.
    if (!box.querySelector(':scope > .ot-nav-bottom')) box.innerHTML = '<div class="ot-nav-topw"></div><div class="ot-nav-bottom"><div class="ot-nav-etaw"></div><div class="ot-nav-chips" role="group" aria-label="步驟"></div></div>';
    box.querySelector('.ot-nav-topw').innerHTML = topHtml;
    box.querySelector('.ot-nav-etaw').innerHTML = etaHtml;
    const row = box.querySelector('.ot-nav-chips');
    if (row._html !== chips) {
      row.innerHTML = chips;
      row._html = chips;
    }
    if (state.chipsFor !== state.i) {
      state.chipsFor = state.i;
      row.querySelector('.ot-nav-chip.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
    }
    // The bar on every other tab (and the map, shrunk): the step, its number, live; a tap goes back.
    if (mini)
      mini.innerHTML = `<button class="ot-nav-mini-b${offNext ? ' alert' : ''}${coming ? ' coming' : ''}" type="button" data-nav="open" style="--c:${e(legColor(l))}" aria-label="回到導航">
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
    state.track = [];
    state.paced = null;
    state.away = 0;
    state.leftAlong = null;
    state.offWay = 0;
    state.delayLive = false;
    state.done = false;
    saveNav(state);
    draw(plan, state.i);
    render();
    refreshLive();
    notices();
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
        const rs = await rideStops(l, state.info.get(ri)).catch(() => null);
        state.ride.set(ri, rs);
        // A ride the planner gave no shape: drawn through its stops (not a straight line across town).
        const noShape = rs && !l.poly && !l.path;
        if (noShape) l.path = rs.stops.slice(rs.i, rs.j + 1).filter(x => x.lat != null).map(x => [x.lat, x.lon]);
        if ((!had && l.train?.no) || noShape) saveNav(state);
        if (noShape && nav === state) draw(plan, state.i);
      }
      const rs = l ? state.ride.get(ri) : null;
      // On it already (opened again on board): the next stop from where you were last seen, not only on the next move.
      if (on && rs && state.next == null && state.pos && state.i === at) state.next = nextStop(rs.stops, rs.i, rs.j, state.pos);
      if (l?.mode === 'bus' && l.from?.lat) {
        const x = state.info.get(ri);
        const eta = x?.route ? await routeEta(x.route).catch(() => null) : null;
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
          live = next
            ? `${next.planned ? '預計' : '即時'}${next.last ? '・末班' : ''}`
            : soon
              ? `下一班 ${Math.max(0, Math.round((soon.at - Date.now()) / 60_000))} 分後到站，可能趕不上`
              : off === 3 ? '末班已過' : off === 4 ? '今日未營運' : '';
          // Where that bus is now: only when the route's estimates are of the same bus.
          const bw = rs && eta && next && !next.planned ? busWhere(rs.stops, rs.i, eta) : null;
          if (bw && Math.abs(Date.now() + bw.sec * 1000 - next.at) < 120_000) where = bw;
          state.fresh = next && !next.planned ? Date.now() : 0;
        }
      } else if (l?.mode === 'tra' && l.train?.no) {
        const lv = (await traLive()).get(String(l.train.no)) || null;
        const d = lv?.delay || 0;
        if (lv) {
          state.liveAt.set(ri, l.dep + d * 60_000);
          state.delay = d;
          state.delayLive = true;
          state.fresh = Date.now();
          if (on) state.arrAt = l.arr + d * 60_000;
        }
        live = lv ? (d ? `晚 ${d} 分` : '準點') : '';
        if (!on && rs) where = trainWhere(rs.stops, rs.i, lv);
      } else if (l?.mode === 'hsr' && rs && !on) where = trainByTime(rs.stops, rs.i);
    } catch {}
    // The YouBike ride coming up (this step's, or after the walk to it).
    const bi = plan.legs.findIndex((x, k) => k >= state.i && x.mode === 'bike');
    const bl = bi >= 0 && plan.legs.slice(state.i, bi).every(x => x.mode === 'walk') ? plan.legs[bi] : null;
    if (bl) {
      try {
        const [a, b] = await Promise.all([bikesAround(bl.from.lat, bl.from.lon), bikesAround(bl.to.lat, bl.to.lon)]);
        const near = (list, pt) => list.map(s => ({ s, d: meters(pt.lat, pt.lon, s.lat, s.lon) })).sort((x, y) => x.d - y.d);
        const rent = near(a, bl.from)[0];
        const ret = near(b, bl.to)[0];
        const n = s => (bl.ebike ? s.ebike : s.bikes + s.ebike);
        const has = rent && rent.d < 60 && n(rent.s) > 0;
        const other = has ? null : near(a, bl.from).find(x => x.d < 500 && n(x.s) > 0);
        state.bikes = { k: bi, rent: rent && rent.d < 60 ? rent.s : null, ret: ret && ret.d < 60 ? ret.s : null, has, alt: other ? { name: other.s.name, n: n(other.s), d: other.d } : null };
      } catch {}
    } else state.bikes = null;
    if (state.i === at) {
      const was = state.where;
      state.where = ri === state.i ? where : null;
      state.live = live;
      // The bus pulling in, the train at the platform: a buzz, once.
      if (state.where && state.where.away === 0 && !(was && was.away === 0) && (l.mode === 'bus' ? state.where.in <= 60 : state.where.at)) buzz();
      render();
    }
  };
  // There: the last step's end (or the place itself) within 60 m, or within
  // 150 m and no nearer for 45 s (stopped at the door of a place whose point
  // is mid-block; checked with every position and every 10 s, as a phone
  // standing still sends few); then the card says so and, 20 s on, ends.
  const arrive = () => {
    const l = plan.legs[state.i];
    const p = state.pos;
    if (state.done || !p || state.i !== plan.legs.length - 1 || RIDE(l) || l.to?.lat == null) return;
    const to = Math.min(meters(p.lat, p.lon, l.to.lat, l.to.lon), plan.dest?.lat != null ? meters(p.lat, p.lon, plan.dest.lat, plan.dest.lon) : Infinity);
    const t = Date.now();
    if (to >= 150) state.near = null;
    else if (!state.near || to < state.near.d - 15) state.near = { d: to, t };
    if (!(to < ARRIVED.walk + 25 || (state.near && t - state.near.t > 45_000))) return;
    state.done = true;
    buzz();
    push?.([]);
    dropNav();
    state.endTimer = setTimeout(() => {
      if (nav !== state) return;
      stopNav();
      onEnd?.({ arrived: plan.dest?.name || l.to?.name || '目的地', plan });
    }, 20_000);
  };
  const moved = p => {
    state.pos = p;
    follow?.(p);
    const l = plan.legs[state.i];
    if (l.to?.lat) {
      const left = meters(p.lat, p.lon, l.to.lat, l.to.lon);
      if (l.mode === 'walk' || l.mode === 'bike') {
        if (left < ARRIVED[l.mode] && state.i < plan.legs.length - 1) return go(state.i + 1);
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
        // On board once you've left the stop behind.
        if (state.phase === 'before' && l.from?.lat && meters(p.lat, p.lon, l.from.lat, l.from.lon) > 200 && left < meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon)) {
          state.phase = 'on';
          state.where = null;
          saveNav(state);
          refreshLive();
        }
        // On it: the stop you're coming to (its stops, from where you are).
        const rs = state.phase === 'on' ? state.ride.get(state.i) : null;
        const knew = state.next != null;
        if (rs) state.next = nextStop(rs.stops, rs.i, rs.j, p);
        // Where you are along it, kept for 10 minutes: your own pace says when you're at each stop ahead.
        if (rs) {
          rs.cum ||= routeCum(rs.stops);
          const a = alongRoute(rs.stops, p, rs.cum, Math.max(0, rs.i - 1));
          const t = Date.now();
          state.away = a && a.off > 250 ? state.away + 1 : 0;
          if (a && a.off < 150) {
            state.track = [...state.track.filter(x => x.t > t - 10 * 60_000), { d: a.d, t }];
            const pace = ridePace(state.track, t);
            state.paced = pace ? aheadByPace(rs.cum, state.next, rs.j, a.d, pace, t) : null;
            if (state.paced) state.fresh = t;
          }
        }
        // The stop you're coming to known for the first time: the times at the stops ahead now, not at the next 20 s.
        if (rs && !knew) refreshLive();
        // Yours next: a buzz, once.
        if (state.phase === 'on' && state.alerted !== state.i && (rs ? state.next >= rs.j : left < NEXT_STOP_M)) {
          state.alerted = state.i;
          buzz();
        }
        if (state.phase === 'on' && left < 120 && state.i < plan.legs.length - 1) return go(state.i + 1, 'before', true);
      }
      arrive();
    }
    render();
  };
  state.go = go;
  state.render = render;
  state.stopWatch = watchPosition(moved);
  state.timer = setInterval(refreshLive, 20_000);
  // The countdown to the second; everything else said (to set out, till you're there) every 10 s.
  state.tick = setInterval(() => {
    if (Date.now() - state.drawn >= 10_000) {
      arrive();
      return render();
    }
    for (const el of [...box.querySelectorAll('[data-cd]'), ...(mini?.querySelectorAll('[data-cd]') || [])]) el.innerHTML = countBig(Number(el.dataset.cd) - Date.now(), el.dataset.k);
  }, 1000);
  box.onclick = ev => {
    primeBuzz();
    const k = ev.target.closest('[data-nav-go]')?.dataset.navGo;
    if (k != null) return go(Number(k), Number(k) === state.i ? state.phase : 'before');
    const a = ev.target.closest('[data-nav]')?.dataset.nav;
    if (a === 'end') {
      // Asked first: 結束 sits where a thumb lands, and an ended ride can't be had back.
      const ask = kit.ask || (o => Promise.resolve(globalThis.confirm(`${o.title}\n${o.body}`)));
      ask({ title: '結束導航？', body: `到 ${plan.dest?.name || plan.legs.at(-1)?.to?.name || '目的地'} 的導航會停止。`, ok: '結束導航', cancel: '繼續導航', danger: true }).then(ok => {
        if (!ok || nav !== state) return;
        stopNav();
        onEnd?.();
      });
    } else if (a) onAction?.(a);
  };
  if (mini) mini.onclick = ev => ev.target.closest('[data-nav="open"]') && onAction?.('open');
  // Back from the background (an iPhone pauses the page): where you are now, the buses again.
  state.onShow = () => {
    if (document.visibilityState !== 'visible' || nav !== state) return;
    if (plan.arr < Date.now() - 5 * 60_000) {
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
  // Start where it was left (opened again), else at the first step not yet
  // behind you (a plan opened on the way).
  const now = Date.now();
  const first = plan.legs.findIndex(l => l.arr > now - 60_000);
  if (resume && resume.i >= (first > 0 ? first : 0) - 1) go(resume.i, resume.phase === 'on' ? 'on' : 'before');
  else go(first > 0 ? first : 0);
  return state;
}

// The ride being navigated, for the screens around it: the plan, the step,
// its stops (a bus or train's, once known), shrunk or not.
export function navNow() {
  if (!nav) return null;
  return { plan: nav.plan, i: nav.i, phase: nav.phase, pos: nav.pos, ride: nav.ride.get(nav.i) || null, min: nav.min };
}
// Shrunk to the bar (doing something else) or back; kept for when the app's opened again.
export function setNavMin(on) {
  if (!nav) return;
  nav.min = Boolean(on);
  saveNav(nav);
  nav.render?.();
}
// When the ride you're on is at stop k of its way: TDX's, a train's live
// timetable, your own pace, the timetable, else in proportion along the
// ride's planned time (a stop past where it was to end, too).
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
export function navChangeOff(k, rest = []) {
  if (!nav) return;
  const s = nav;
  const rs = s.ride.get(s.i);
  const l = s.plan.legs[s.i];
  if (!rs || !RIDE(l) || k <= rs.i || k >= rs.stops.length) return;
  const at = navStopAt(k) ?? l.arr;
  const stop = rs.stops[k];
  l.to = { name: stop.name, lat: stop.lat, lon: stop.lon };
  l.arr = at;
  l.dur = Math.max(60, Math.round((at - l.dep) / 1000));
  if (l.stops) l.stops = k - rs.i;
  rs.j = k;
  // Its line on the map: through its stops to the new one (the planner's shape was to the old).
  delete l.poly;
  l.path = rs.stops.slice(rs.i, k + 1).filter(x => x.lat != null).map(x => [x.lat, x.lon]);
  s.plan.legs = [...s.plan.legs.slice(0, s.i + 1), ...rest];
  const end = s.plan.legs.at(-1);
  s.plan.arr = end.arr ?? at;
  s.plan.dur = Math.round((s.plan.arr - s.plan.dep) / 1000);
  // What was known of the legs after it is of the old ones.
  for (const m of [s.ride, s.info, s.liveAt]) for (const key of [...m.keys()]) if (key > s.i) m.delete(key);
  s.alerted = -1;
  s.go(s.i, s.phase);
}

export function stopNav() {
  if (!nav) return;
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


export const navSummary = p => `${minsText(p.dur)} · ${hm(p.dep)} 出發`;
