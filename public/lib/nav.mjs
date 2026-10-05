// 導航: a plan followed step by step with the phone's position. Walking and
// riding steps say how far is left (and open Google Maps' own turn-by-turn
// navigation for that step with one tap: free, no billed call); a bus step
// says when the bus really comes (TDX, every 20 s) and, once on it, how far
// to your stop, with a buzz when it's next; a train step its time and delay.
// Each step moves on by itself when you get there; ‹ › move by hand.

import { watchPosition } from './api.mjs';
import { buzz, primeBuzz } from './buzz.mjs';
import { liveTimes, officialLeg, liveTrusted, wayOf } from './live.mjs';
import { routeStops, routeSchedule, routeCity, stationsNear, stationEtaAsk } from './bus.mjs';
import { etaAround, bikesAround } from './near.mjs';
import { rideSec, DOCK_SEC } from './plan.mjs';
import { traDelays } from './raildata.mjs';
import { icon, MODE_NAME, legColor, legLabel } from './ui.mjs';
import { e, hm, minsText, distText, meters, walkSec } from './util.mjs';

let nav = null;

// The ride being followed, kept on the phone: swiped away and opened again,
// it goes on where it was (savedNav, for tab-map), until it's over or ended.
const NAV_KEY = 'ot.nav.v1';
const plain = x => JSON.parse(JSON.stringify(x, (k, v) => (v instanceof Promise ? undefined : v)));
function saveNav(state) {
  try {
    localStorage.setItem(NAV_KEY, JSON.stringify({ plan: plain(state.plan), i: state.i, phase: state.phase, at: Date.now() }));
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
  return { leg: o, way, sched, station: st || null };
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
    if ((l.mode === 'tra' || l.mode === 'hsr') && l.dep - 5 * 60_000 > now) out.push({ at: l.dep - 5 * 60_000, title: `${rideName(l)} ${hm(l.dep)} 開`, body: `在 ${l.from?.name || ''}${l.train?.platform ? ` ${l.train.platform} 月台` : ''}${l.headsign ? `・往 ${toward(l.headsign)}` : ''}`, tag: `nav:train:${k}`, kind: 'nav', hash: 'nav' });
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

// Google Maps' own navigation for one step (walking, riding) or the rest by transit.
export function gmapsLink(from, to, mode) {
  const p = new URLSearchParams({ api: '1', destination: `${to.lat},${to.lon}`, travelmode: mode });
  if (from) p.set('origin', `${from.lat},${from.lon}`);
  if (mode !== 'transit') p.set('dir_action', 'navigate');
  return `https://www.google.com/maps/dir/?${p}`;
}

const RIDE = l => l && l.mode !== 'walk' && l.mode !== 'bike';
// The ride itself, said the way its sign says it: 公車 5608 往 竹東, 區間 1234 次 往 新竹.
export function rideName(l) {
  const s = String(l.short || l.name || '').trim();
  if (l.mode === 'tra') {
    const t = `${s}${l.train?.no && !s.includes(l.train.no) ? ` ${l.train.no}` : ''}`;
    return `台鐵 ${t}${/\d$/.test(t) ? ' 次' : ''}`;
  }
  if (l.mode === 'hsr') return s.startsWith('高鐵') ? s : `高鐵 ${s}`;
  return `${MODE_NAME[l.mode] || ''} ${s}`.trim();
}
// A sign's way, without the 往 a source may have put on it already.
const toward = h => String(h || '').replace(/^往\s*/, '');
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
  if (phase === 'on') return { title: `坐到 ${l.to.name} 下車`, sub: `${rideName(l)}${l.headsign ? ` 往 ${toward(l.headsign)}` : ''}` };
  return { title: `搭 ${rideName(l)}`, sub: `${l.from.name}${l.headsign ? `・往 ${toward(l.headsign)}` : ''}${l.train?.platform ? `・${l.train.platform} 月台` : ''}` };
}
// The ride this step leads to (the bus or train you're on your way to catch), or this step's own.
const rideOf = (plan, i) => plan.legs.slice(i).findIndex(RIDE) + i;

// The trip from here, as it's going now: when each leg from the one you're on
// will be over (what's left of a walk or ride from where you are, at its own
// pace; a bus by when it really comes, `liveAt`; a train by its time), when
// you'll be at each bus or train's stop (`ready`), and when you'll be there.
// Before setting out, from when you're to leave.
export function navTimes(plan, i, phase, pos = null, liveAt = new Map(), now = Date.now()) {
  let t = i === 0 && phase !== 'on' ? Math.max(now, plan.dep - 60_000) : now;
  const end = [];
  const ready = new Map();
  for (let k = i; k < plan.legs.length; k++) {
    const l = plan.legs[k];
    if (RIDE(l)) {
      const dep = liveAt.get(k) ?? l.dep;
      const ride = (l.arr ?? dep) - (l.dep ?? dep);
      if (k === i && phase === 'on') t = Math.max(t, dep + ride);
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
  if (i === 0 && phase !== 'on' && plan.dep - now > 60_000) return { text: `${hm(plan.dep)} 出發・還有 ${minsText(Math.round((plan.dep - now) / 1000))}`, tone: '' };
  const ri = rideOf(plan, i);
  const r = ri >= i ? plan.legs[ri] : null;
  // On board: when you're at your stop (the bottom says when you're there); nothing to catch: nothing to say.
  if (ri === i && phase === 'on') return { text: live || `${hm(times.end[i])} 到 ${r.to?.name || ''}`, tone: live ? 'warn' : '' };
  if (!r) return { text: '', tone: '' };
  const dep = liveAt.get(ri) ?? r.dep;
  const at = r.from?.name ? `${r.from.name} ` : '';
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

// plan: a ranked plan; `draw(plan, i)` shows it on the map with leg i lit;
// `follow(pos)` keeps the map on you; `onEnd()` when it's closed.
export function startNav(plan, { box, draw, follow, onEnd, here = null, resume = null, push = null }) {
  // Started by a tap (mostly): the iPhone's chime may sound from now on.
  primeBuzz();
  stopNav();
  const state = { plan, i: 0, phase: 'before', pos: here, live: '', liveAt: new Map(), alerted: -1, wake: null, info: new Map(), push, bikes: null, stopsLeft: null, done: false };
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
    const l = plan.legs[state.i];
    const t = stepText(plan, state.i, state.phase);
    const times = navTimes(plan, state.i, state.phase, state.pos, state.liveAt, now);
    const pace = state.done ? { text: `${hm(now)} 抵達`, tone: 'good' } : paceOf(plan, state.i, state.phase, times, state.liveAt, now, state.live);
    // The big number on the right: what's left of this walk or ride; the stops left on a bus; minutes to the bus or train.
    const left = state.pos && l.to?.lat ? meters(state.pos.lat, state.pos.lon, l.to.lat, l.to.lon) : null;
    let big = '';
    if (state.done) big = '';
    else if ((l.mode === 'walk' || l.mode === 'bike') && left != null) big = left < 1000 ? `<b>${Math.round(left / 10) * 10}</b><small>公尺</small>` : `<b>${(left / 1000).toFixed(1)}</b><small>公里</small>`;
    else if (state.phase === 'on' && state.stopsLeft != null) big = `<b>${state.stopsLeft}</b><small>站</small>`;
    else if (state.phase === 'on' && left != null) big = `<b>${left < 1000 ? Math.round(left / 10) * 10 : (left / 1000).toFixed(1)}</b><small>${left < 1000 ? '公尺' : '公里'}</small>`;
    else if (RIDE(l)) {
      const m = Math.max(0, Math.round(((state.liveAt.get(state.i) ?? l.dep) - now) / 60_000));
      big = `<b>${m}</b><small>分</small>`;
    }
    // YouBike where you take it and leave it, now: bikes (or none, and the nearest that has some), docks.
    const bikeLine = state.done ? '' : bikesText(state.bikes, plan, state.i, state.pos);
    const gm = l.mode === 'walk' || l.mode === 'bike' ? gmapsLink(state.pos, l.to, l.mode === 'bike' ? 'bicycling' : 'walking') : gmapsLink(state.pos, plan.legs.at(-1).to, 'transit');
    const chips = plan.legs
      .map((x, k) => `<button class="ot-nav-chip${k < state.i ? ' done' : k === state.i ? ' on' : ''}" type="button" data-nav-go="${k}" style="--c:${e(legColor(x))}">${icon(x.mode)}<span>${e(chipText(x))}</span></button>`)
      .join('');
    const minsLeft = Math.max(0, Math.round((times.eta - now) / 60_000));
    box.innerHTML = `<div class="ot-nav-top" style="--c:${e(legColor(l))}">
        <div class="ot-nav-main">
          <span class="ot-nav-i">${icon(state.done ? 'pin' : l.mode)}</span>
          <div class="ot-nav-text"><b>${e(state.done ? `已抵達 ${plan.legs.at(-1).to?.name || '目的地'}` : t.title)}</b>${!state.done && t.sub ? `<small>${e(t.sub)}</small>` : ''}</div>
          ${big ? `<span class="ot-nav-big">${big}</span>` : ''}
        </div>
        ${pace.text ? `<div class="ot-nav-pace ${pace.tone}">${icon(pace.tone ? 'live' : 'clock')}<span>${e(pace.text)}</span></div>` : ''}
        ${bikeLine ? `<div class="ot-nav-bikes">${bikeLine}</div>` : ''}
      </div>
      <div class="ot-nav-bottom">
        <div class="ot-nav-eta">
          <span><b>${e(hm(state.done ? now : times.eta))}</b><small>${state.done ? '已抵達' : `抵達・還要 ${minsLeft < 60 ? `${minsLeft} 分` : minsText(minsLeft * 60)}`}</small></span>
          <a class="q-icon-btn" href="${e(gm)}" target="_blank" rel="noopener" aria-label="用 Google 地圖導航${l.mode === 'walk' || l.mode === 'bike' ? '這一段' : ''}">${icon('route')}</a>
          <button class="q-btn ot-nav-end" type="button" data-nav="end">結束</button>
        </div>
        <div class="ot-nav-chips" role="group" aria-label="步驟">${chips}</div>
      </div>`;
    box.querySelector('.ot-nav-chip.on')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  };
  const go = (i, phase = 'before') => {
    state.i = Math.max(0, Math.min(plan.legs.length - 1, i));
    state.phase = phase;
    state.live = '';
    state.stopsLeft = null;
    state.done = false;
    saveNav(state);
    draw(plan, state.i);
    render();
    refreshLive();
    notices();
  };
  // What's live: the ride to catch (this step's, or the next one's) — a bus,
  // when it really comes to the stop at the time you'll be there; a train, its
  // delay — and the YouBike stations of the ride coming up.
  const refreshLive = async () => {
    const at = state.i;
    const ri = rideOf(plan, state.i);
    const l = plan.legs[ri];
    let live = '';
    try {
      if (l?.mode === 'bus' && !(ri === state.i && state.phase === 'on') && l.from?.lat) {
        // Its official route and way (a planner's name, both ways and every
        // branch of a line were mixed in), and only buses in service (one
        // resting at the terminal with its tracker on isn't coming).
        if (!state.info.has(ri)) state.info.set(ri, await busInfo(l).catch(() => ({ leg: l })));
        const x = state.info.get(ri);
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
      } else if (l?.mode === 'tra' && l.train?.no) {
        const d = (await traDelays()).get(l.train.no);
        if (d) state.liveAt.set(ri, l.dep + d * 60_000);
        live = d ? `晚 ${d} 分` : '準點';
      }
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
      state.live = state.phase === 'on' && state.live === '快到了，準備下車' ? state.live : live;
      render();
    }
  };
  const moved = p => {
    state.pos = p;
    follow?.(p);
    const l = plan.legs[state.i];
    if (l.to?.lat) {
      const left = meters(p.lat, p.lon, l.to.lat, l.to.lon);
      if (l.mode === 'walk' || l.mode === 'bike') {
        if (left < ARRIVED[l.mode] && state.i < plan.legs.length - 1) return go(state.i + 1);
      } else {
        // On board once you've left the stop behind.
        if (state.phase === 'before' && l.from?.lat && meters(p.lat, p.lon, l.from.lat, l.from.lon) > 200 && left < meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon)) {
          state.phase = 'on';
          saveNav(state);
        }
        if (state.phase === 'on' && left < NEXT_STOP_M && state.alerted !== state.i) {
          state.alerted = state.i;
          buzz();
          state.live = '快到了，準備下車';
        }
        if (state.phase === 'on' && left < 120 && state.i < plan.legs.length - 1) return go(state.i + 1);
        // On a bus: the stops still to go (its stops, from the one you're nearest).
        const w = state.phase === 'on' ? state.info.get(state.i)?.way : null;
        if (w?.w?.stops?.length) {
          const stops = w.w.stops;
          const last = stops.reduce((a, st, k) => (k > w.i && meters(st.lat, st.lon, l.to.lat, l.to.lon) < meters(stops[a].lat, stops[a].lon, l.to.lat, l.to.lon) ? k : a), w.i + 1 < stops.length ? w.i + 1 : w.i);
          const here = stops.slice(w.i, last + 1).reduce((a, st, k) => (meters(p.lat, p.lon, st.lat, st.lon) < meters(p.lat, p.lon, stops[a + w.i].lat, stops[a + w.i].lon) ? k : a), 0) + w.i;
          state.stopsLeft = Math.max(0, last - here);
        }
      }
      // There: the last step's end reached.
      if (state.i === plan.legs.length - 1 && !RIDE(l) && left < ARRIVED.walk + 15 && !state.done) {
        state.done = true;
        buzz();
        push?.([]);
        dropNav();
      }
    }
    render();
  };
  state.stopWatch = watchPosition(moved);
  state.timer = setInterval(refreshLive, 20_000);
  // The minutes said (to set out, to the bus, till you're there) kept current.
  state.tick = setInterval(render, 10_000);
  box.onclick = ev => {
    primeBuzz();
    const k = ev.target.closest('[data-nav-go]')?.dataset.navGo;
    if (k != null) return go(Number(k), Number(k) === state.i ? state.phase : 'before');
    const a = ev.target.closest('[data-nav]')?.dataset.nav;
    if (a === 'end') {
      stopNav();
      onEnd?.();
    }
  };
  // Back from the background (an iPhone pauses the page): where you are now, the buses again.
  state.onShow = () => {
    if (document.visibilityState !== 'visible' || nav !== state) return;
    if (plan.arr < Date.now() - 5 * 60_000) {
      stopNav();
      return onEnd?.();
    }
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

export function stopNav() {
  if (!nav) return;
  dropNav();
  nav.push?.([]);
  document.removeEventListener('visibilitychange', nav.onShow);
  nav.stopWatch?.();
  clearInterval(nav.timer);
  clearInterval(nav.tick);
  nav.wake?.release?.().catch(() => {});
  nav = null;
}


export const navSummary = p => `${minsText(p.dur)} · ${hm(p.dep)} 出發`;
