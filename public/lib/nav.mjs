// 導航: a plan followed step by step with the phone's position. Walking and
// riding steps say how far is left (and open Google Maps' own turn-by-turn
// navigation for that step with one tap: free, no billed call); a bus step
// says when the bus really comes (TDX, every 20 s) and, once on it, how far
// to your stop, with a buzz when it's next; a train step its time and delay.
// Each step moves on by itself when you get there; ‹ › move by hand.

import { watchPosition } from './api.mjs';
import { etaNear, liveTimes } from './live.mjs';
import { traDelays } from './raildata.mjs';
import { icon, MODE_NAME, legColor } from './ui.mjs';
import { e, hm, minsText, distText, meters } from './util.mjs';

let nav = null;

const ARRIVED = { walk: 35, bike: 60 };
const NEXT_STOP_M = 600;

export const navigating = () => Boolean(nav);

// Google Maps' own navigation for one step (walking, riding) or the rest by transit.
export function gmapsLink(from, to, mode) {
  const p = new URLSearchParams({ api: '1', destination: `${to.lat},${to.lon}`, travelmode: mode });
  if (from) p.set('origin', `${from.lat},${from.lon}`);
  if (mode !== 'transit') p.set('dir_action', 'navigate');
  return `https://www.google.com/maps/dir/?${p}`;
}

// What to do on a leg, before (or while) doing it.
function stepText(plan, i, phase) {
  const l = plan.legs[i];
  const next = plan.legs[i + 1];
  const where = l.to?.name || (next?.from?.name ?? '') || '目的地';
  if (l.mode === 'walk') return { title: `步行到 ${i === plan.legs.length - 1 ? '目的地' : where}`, sub: '' };
  if (l.mode === 'bike') return { title: `${l.swap ? '還車再借一台，' : `在 ${l.from.name} 借 YouBike，`}騎到 ${l.to.name} 還車`, sub: l.swap ? '每 30 分鐘換一次車' : '' };
  const line = `${MODE_NAME[l.mode] || ''} ${l.short || l.name || ''}`.trim();
  if (phase === 'on') return { title: `坐到 ${l.to.name} 下車`, sub: `${line}${l.stops ? ` · ${l.stops} 站` : ''}` };
  return { title: `在 ${l.from.name} 搭 ${line}`, sub: `${l.headsign ? `往 ${l.headsign} · ` : ''}${hm(l.dep)} 開` };
}

// plan: a ranked plan; `draw(plan, i)` shows it on the map with leg i lit;
// `follow(pos)` keeps the map on you; `onEnd()` when it's closed.
export function startNav(plan, { box, draw, follow, onEnd, here = null }) {
  stopNav();
  const state = { plan, i: 0, phase: 'before', pos: here, live: '', alerted: -1, wake: null };
  nav = state;
  box.hidden = false;
  box.className = 'ot-nav';
  const render = () => {
    if (nav !== state) return;
    const l = plan.legs[state.i];
    const t = stepText(plan, state.i, state.phase);
    const left = state.pos && l.to?.lat ? meters(state.pos.lat, state.pos.lon, l.to.lat, l.to.lon) : null;
    const extra = [t.sub, left != null && (l.mode === 'walk' || l.mode === 'bike' || state.phase === 'on') ? `還有 ${distText(left)}` : '', state.live].filter(Boolean).join(' · ');
    const gm = l.mode === 'walk' || l.mode === 'bike' ? gmapsLink(state.pos, l.to, l.mode === 'bike' ? 'bicycling' : 'walking') : gmapsLink(state.pos, plan.legs.at(-1).to, 'transit');
    const nextLeg = plan.legs[state.i + 1];
    box.innerHTML = `<div class="ot-nav-main" style="--c:${e(legColor(l))}">
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
  const go = i => {
    state.i = Math.max(0, Math.min(plan.legs.length - 1, i));
    state.phase = 'before';
    state.live = '';
    draw(plan, state.i);
    render();
    refreshLive();
  };
  // A bus: when it really comes; a train: its delay.
  const refreshLive = async () => {
    const l = plan.legs[state.i];
    const at = state.i;
    try {
      if (l.mode === 'bus' && state.phase === 'before' && l.from?.lat) {
        const { times, off } = liveTimes(await etaNear(l.from.lat, l.from.lon, 150), l.short || l.name);
        const next = times.find(x => x.at > Date.now() - 30_000);
        state.live = next ? `${next.planned ? '預計 ' : ''}${Math.max(0, Math.round((next.at - Date.now()) / 60_000))} 分後到站${next.last ? '（末班）' : ''}` : off === 3 ? '末班已過' : off === 4 ? '今日未營運' : '';
      } else if (l.mode === 'tra' && l.train?.no) {
        const d = (await traDelays()).get(l.train.no);
        state.live = d ? `晚 ${d} 分` : '準點';
      }
    } catch {}
    if (state.i === at) render();
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
        if (state.phase === 'before' && l.from?.lat && meters(p.lat, p.lon, l.from.lat, l.from.lon) > 200 && left < meters(l.from.lat, l.from.lon, l.to.lat, l.to.lon)) state.phase = 'on';
        if (state.phase === 'on' && left < NEXT_STOP_M && state.alerted !== state.i) {
          state.alerted = state.i;
          navigator.vibrate?.([200, 100, 200]);
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
    const a = ev.target.closest('[data-nav]')?.dataset.nav;
    if (a === 'prev') go(state.i - 1);
    if (a === 'next') go(state.i + 1);
    if (a === 'end') {
      stopNav();
      onEnd?.();
    }
  };
  // The screen stays on while navigating, where the browser allows it.
  navigator.wakeLock
    ?.request('screen')
    .then(w => (state.wake = w))
    .catch(() => {});
  // Start at the first step not yet behind you (a plan opened on the way).
  const now = Date.now();
  const first = plan.legs.findIndex(l => l.arr > now - 60_000);
  go(first > 0 ? first : 0);
  return state;
}

export function stopNav() {
  if (!nav) return;
  nav.stopWatch?.();
  clearInterval(nav.timer);
  nav.wake?.release?.().catch(() => {});
  nav = null;
}

export const navSummary = p => `${minsText(p.dur)} · ${hm(p.dep)} 出發`;
