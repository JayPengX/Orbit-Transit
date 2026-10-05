// 導航: a plan followed step by step with the phone's position. Walking and
// riding steps say how far is left (and open Google Maps' own turn-by-turn
// navigation for that step with one tap: free, no billed call); a bus step
// says when the bus really comes (TDX, every 20 s) and, once on it, how far
// to your stop, with a buzz when it's next; a train step its time and delay.
// Each step moves on by itself when you get there; ‹ › move by hand.

import { watchPosition } from './api.mjs';
import { buzz, primeBuzz } from './buzz.mjs';
import { etaNear, liveTimes, officialLeg, liveTrusted, wayOf } from './live.mjs';
import { routeStops, routeSchedule, routeCity, stationsNear, stationEtaAsk } from './bus.mjs';
import { traDelays } from './raildata.mjs';
import { icon, MODE_NAME, legColor } from './ui.mjs';
import { e, hm, minsText, distText, meters } from './util.mjs';

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
    if ((l.mode === 'tra' || l.mode === 'hsr') && l.dep - 5 * 60_000 > now) out.push({ at: l.dep - 5 * 60_000, title: `${rideName(l)} ${hm(l.dep)} 開`, body: `在 ${l.from?.name || ''}${l.train?.platform ? ` ${l.train.platform} 月台` : ''}${l.headsign ? `・往 ${l.headsign}` : ''}`, tag: `nav:train:${k}`, kind: 'nav', hash: 'nav' });
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
// What to do on a leg, before (or while) doing it.
function stepText(plan, i, phase) {
  const l = plan.legs[i];
  const next = plan.legs[i + 1];
  const where = l.to?.name || (next?.from?.name ?? '') || '目的地';
  if (l.mode === 'walk') return { title: `步行到 ${i === plan.legs.length - 1 && !l.to?.name ? '目的地' : where}`, sub: '' };
  if (l.mode === 'bike') return { title: `${l.swap ? '還車再借一台，' : `在 ${l.from.name} 借 YouBike，`}騎到 ${l.to.name} 還車`, sub: l.swap ? '每 30 分鐘換一次車' : '' };
  if (phase === 'on') return { title: `坐到 ${l.to.name} 下車`, sub: `${rideName(l)}${l.stops ? ` · ${l.stops} 站` : ''} · ${hm(l.arr)} 到` };
  return { title: `在 ${l.from.name} 搭 ${rideName(l)}`, sub: `${l.headsign ? `往 ${l.headsign} · ` : ''}${hm(l.dep)} 開` };
}
// The ride this step leads to (the bus or train you're on your way to catch), or this step's own.
const rideOf = (plan, i) => plan.legs.slice(i).findIndex(RIDE) + i;

// plan: a ranked plan; `draw(plan, i)` shows it on the map with leg i lit;
// `follow(pos)` keeps the map on you; `onEnd()` when it's closed.
export function startNav(plan, { box, draw, follow, onEnd, here = null, resume = null, push = null }) {
  // Started by a tap (mostly): the iPhone's chime may sound from now on.
  primeBuzz();
  stopNav();
  const state = { plan, i: 0, phase: 'before', pos: here, live: '', liveAt: new Map(), alerted: -1, wake: null, info: new Map(), push };
  // The buses' official routes, ways and stations, then the lock screen's notices.
  const infos = plan.legs.map((l, k) => (l.mode === 'bus' && l.from?.lat ? busInfo(l).then(x => state.info.set(k, x)).catch(() => {}) : null)).filter(Boolean);
  const notices = () => nav === state && push?.(navNotices(plan, state.i, state.info));
  Promise.all(infos).then(notices);
  nav = state;
  box.hidden = false;
  box.className = 'ot-nav';
  const render = () => {
    if (nav !== state) return;
    const l = plan.legs[state.i];
    const t = stepText(plan, state.i, state.phase);
    const left = state.pos && l.to?.lat ? meters(state.pos.lat, state.pos.lon, l.to.lat, l.to.lon) : null;
    const extra = [t.sub, left != null && (l.mode === 'walk' || l.mode === 'bike' || state.phase === 'on') ? `還有 ${distText(left)}` : '', state.phase === 'on' ? state.live : ''].filter(Boolean).join(' · ');
    const gm = l.mode === 'walk' || l.mode === 'bike' ? gmapsLink(state.pos, l.to, l.mode === 'bike' ? 'bicycling' : 'walking') : gmapsLink(state.pos, plan.legs.at(-1).to, 'transit');
    const nextLeg = plan.legs[state.i + 1];
    // Always the bus or train to catch next: its line, which way, when, live.
    const ri = rideOf(plan, state.i);
    const r = ri >= state.i ? plan.legs[ri] : null;
    const catchHtml = r && !(ri === state.i && state.phase === 'on')
      ? `<div class="ot-nav-catch" style="--c:${e(legColor(r))}">${icon(r.mode)}<span><b>${ri === state.i ? '要搭' : '接著搭'} ${e(rideName(r))}</b><small>${e([r.headsign ? `往 ${r.headsign}` : '', `${r.from?.name || ''} ${hm(state.liveAt.get(ri) || r.dep)} ${state.liveAt.has(ri) ? '到站' : '開'}`, r.train?.platform ? `${r.train.platform} 月台` : ''].filter(Boolean).join(' · '))}</small></span><em>${e(state.live || leaveIn(r.dep))}</em></div>`
      : '';
    // Before setting out: when to leave, so you can plan the time till then.
    const wait = plan.dep - Date.now();
    const leaveHtml = state.i === 0 && wait > 60_000 ? `<div class="ot-nav-leave">${icon('clock')}<span><b>${hm(plan.dep)} 出發</b><small>還有 ${e(minsText(Math.round(wait / 1000)))}・${hm(plan.arr)} 抵達</small></span></div>` : '';
    box.innerHTML = `${leaveHtml}${catchHtml}<div class="ot-nav-main" style="--c:${e(legColor(l))}">
        <span class="ot-nav-i">${icon(l.mode)}</span>
        <div class="ot-nav-text"><b>${e(t.title)}</b><small>${e(extra)}</small></div>
      </div>
      <div class="ot-nav-row">
        <button class="q-icon-btn" type="button" data-nav="prev" aria-label="上一步" ${state.i ? '' : 'disabled'}>${icon('back')}</button>
        <span class="ot-nav-step">${state.i + 1} / ${plan.legs.length}${nextLeg ? ` · 下一步：${e(stepText(plan, state.i + 1, 'before').title)}` : ` · ${hm(plan.arr)} 抵達`}</span>
        <button class="q-icon-btn" type="button" data-nav="next" aria-label="下一步" ${state.i < plan.legs.length - 1 ? '' : 'disabled'}>${icon('chevron')}</button>
      </div>
      <div class="ot-nav-acts"><a class="q-btn" href="${e(gm)}" target="_blank" rel="noopener">${icon('route')} Google 地圖導航${l.mode === 'walk' || l.mode === 'bike' ? '這一段' : ''}</a><button class="q-btn" type="button" data-nav="end">結束導航</button></div>`;
  };
  const go = (i, phase = 'before') => {
    state.i = Math.max(0, Math.min(plan.legs.length - 1, i));
    state.phase = phase;
    state.live = '';
    saveNav(state);
    draw(plan, state.i);
    render();
    refreshLive();
    notices();
  };
  // The ride to catch (this step's, or the next one's): a bus, when it
  // really comes to the stop at the time you'll be there; a train, its delay.
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
        const all = liveTimes(await etaNear(l.from.lat, l.from.lon, 150), x.leg.short || x.leg.name, Date.now(), x.leg.route?.uid ? { routeUID: x.leg.route.uid, dir: x.leg.route.dir } : {});
        const times = x.way && x.sched?.length ? all.times.filter(t => t.planned || liveTrusted(x.sched, x.way.w, x.way.i, t.at)) : all.times;
        const off = all.off;
        // When you'll be at the stop: now plus what's left of the way there.
        const ready = Date.now() + plan.legs.slice(state.i, ri).reduce((a, x, k) => a + (k === 0 && x.arr > Date.now() ? x.arr - Math.max(Date.now(), x.dep) : (x.dur || 0) * 1000), 0);
        const next = times.find(x => x.at >= ready - 60_000) || null;
        const soon = times.find(x => x.at > Date.now() - 30_000);
        if (next) state.liveAt.set(ri, next.at);
        else state.liveAt.delete(ri);
        live = next
          ? `${next.planned ? '預計 ' : ''}${hm(next.at)} 到站（${Math.max(0, Math.round((next.at - Date.now()) / 60_000))} 分後）${next.last ? '・末班' : ''}`
          : soon
            ? `下一班 ${Math.max(0, Math.round((soon.at - Date.now()) / 60_000))} 分後到站，可能趕不上`
            : off === 3 ? '末班已過' : off === 4 ? '今日未營運' : '';
      } else if (l?.mode === 'tra' && l.train?.no) {
        const d = (await traDelays()).get(l.train.no);
        live = d ? `晚 ${d} 分` : '準點';
      }
    } catch {}
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
      }
    }
    render();
  };
  state.stopWatch = watchPosition(moved);
  state.timer = setInterval(refreshLive, 20_000);
  box.onclick = ev => {
    primeBuzz();
    const a = ev.target.closest('[data-nav]')?.dataset.nav;
    if (a === 'prev') go(state.i - 1);
    if (a === 'next') go(state.i + 1);
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
  nav.wake?.release?.().catch(() => {});
  nav = null;
}

const leaveIn = t => {
  const m = Math.round((t - Date.now()) / 60_000);
  return m <= 0 ? '現在' : `${m} 分後開`;
};

export const navSummary = p => `${minsText(p.dur)} · ${hm(p.dep)} 出發`;
