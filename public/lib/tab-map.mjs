// 地圖: the home tab. The map (Google's, or Taiwan's NLSC map past the
// month's cap) with what's around: YouBike stations with their bikes now
// (regular and 電輔車), every bus stop, 台鐵, 高鐵 and metro stations. Search
// for a place, tap anything for its card (a bike station's bikes and docks,
// a stop's buses, a station's next trains), and plan a trip there: from
// where you are (or any place: a pinned one, a search, a spot on the map),
// the recommendations first, then the rest; each one opens its steps and
// starts navigation.

import { createMap } from './map.mjs';
import { searchPlaces, placeDetails, errorText, watchPosition, roadPath, PROXY } from './api.mjs';
import { cityBikes, bikeLevel } from './bike.mjs';
import { stationsNear, stationEta, etaText, BEARING } from './bus.mjs';
import { railStations, metroSystems, traBoard, hsrBoard } from './raildata.mjs';
import { liveBoard, nextTrains, OPERATORS, stationTitle } from './metro.mjs';
import { planTrip } from './planner.mjs';
import { etaNear, liveTimes } from './live.mjs';
import { startNav, stopNav, navigating, canNav, NAV_LEAD } from './nav.mjs';
import { pickSig } from './plan.mjs';
import { cleanPlace, cleanSaved, remember, tripKey, PLACE_ICONS, LAYERS, MAX_PLACES, MAX_SAVED } from './store.mjs';
import { sheet, sheetHead, icon, legChips, legColor, MODE_NAME, ago, timeRange } from './ui.mjs';
import { e, hm, minsText, distText, meters, decodeLine, uid, tw, twAt, addDays } from './util.mjs';
import { openRoute } from './bus-ui.mjs';

const $ = id => document.getElementById(id);
const FALLBACK = { lat: 25.0478, lon: 121.517 }; // 台北車站
const VIEW_KEY = 'orbit-transit.view';
let ctx = null;
let map = null;
let card = null; // what the card shows: { kind, ... }
let me = null; // the device's dot
let stopWatch = () => {};
let following = false;

// What other tabs use before the map was ever opened: saving and editing trips.
export function register(c) {
  ctx = c;
  ctx.saveTrip = (card, opts) => saveTripSheet(card, opts);
  ctx.newTrip = async () => {
    const from = await pickPoint('從哪裡出發', { here: true, onMap: false });
    if (!from) return;
    const to = await pickPoint('要去哪裡', { onMap: false });
    if (!to || to.here) return;
    saveTripSheet({ fromHere: Boolean(from.here), from, to });
  };
}

export async function init(c) {
  ctx = c;
  $('fab-locate').innerHTML = icon('locate');
  $('fab-layers').innerHTML = icon('layers');
  const view = (() => {
    try {
      return JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    } catch {
      return null;
    }
  })();
  const center = ctx.here || view || FALLBACK;
  const cfg = ctx.cfg?.map || { provider: 'nlsc' };
  try {
    map = await createMap($('map'), { provider: cfg.provider, key: cfg.key, center, zoom: view?.z || 16, onPick: pick, onTap: tap, onIdle: idle, onPlace: googlePlace });
  } catch (err) {
    $('map').innerHTML = `<p class="ot-empty">地圖載入失敗：${e(err.message)}</p>`;
    return;
  }
  // The first time the device's position is known (before the map was ready
  // or after), the map goes there, unless it opened where it was left.
  let centered = Boolean(view);
  const arrived = here => {
    drawMe(here);
    if (!centered) {
      centered = true;
      map.setView(here.lat, here.lon, 16);
    } else if (following) map.setView(here.lat, here.lon);
  };
  ctx.moved.push(arrived);
  if (ctx.here) arrived(ctx.here);
  else ctx.locate();
  wireSearch();
  drawChips();
  $('fab-locate').addEventListener('click', locateMe);
  $('fab-layers').addEventListener('click', layersSheet);
  $('card').addEventListener('click', cardClick);
  // Other tabs open a trip here (交通's plans, 我的's saved trips).
  ctx.openTrip = (from, to, opts = {}) => {
    ctx.goTab('map');
    if (opts.at || opts.by) when = { by: opts.by === 'arrive' ? 'arrive' : opts.at ? 'depart' : 'now', at: opts.at || null };
    else when = { by: 'now', at: null };
    return plan(from, to, opts);
  };
  // 交通's one tap: that plan, navigated at once.
  // (A plan leaving later only opens: navigation starts 20 minutes before it.)
  ctx.navPlan = (p, from, to) => {
    ctx.goTab('map');
    if (!map) return (pendingTrip = { nav: p, from, to });
    showPlan(p, from, to);
  };
  ctx.togglePick = togglePick;
  (ctx.onRefresh ||= []).push(() => {
    drawChips();
    if (card) renderCard();
  });
  idle();
  if (pendingTrip) show();
}
let pendingTrip = null;
function showPlan(p, from, to) {
  card = { kind: 'plans', from: { name: from?.name || '目前位置', lat: from?.lat, lon: from?.lon }, fromHere: !from || from.name === '目前位置', to, lat: to.lat, lon: to.lon, plans: [{ ...p, top: true }], sel: 0, more: false, sources: {} };
  document.body.classList.add('ot-planning');
  if (canNav(p)) {
    renderCard();
    drawPlan(p, { fit: false });
    return navigate(card.plans[0]);
  }
  card.sel = 0;
  renderCard();
  drawPlan(p, { fit: true });
}

export function show() {
  map?.resize();
  if (pendingTrip && map) {
    const t = pendingTrip;
    pendingTrip = null;
    return t.nav ? showPlan(t.nav, t.from, t.to) : plan(t.from, t.to, t.opts);
  }
  // A station sent from another tab (捷運's 在地圖上看).
  if (map && ctx.mapFocus) {
    const st = ctx.mapFocus;
    ctx.mapFocus = null;
    return arrive({ kind: st.sys, item: st, lat: st.lat, lon: st.lon });
  }
  if (card) refreshCard();
}
export function hide() {
  stopWatch();
  following = false;
}
export const navOn = () => navigating();

// ---- The device -------------------------------------------------------------------------------

function drawMe(h) {
  me = h;
  map?.layer('me').set([{ id: 'me', lat: h.lat, lon: h.lon, cls: 'me', z: 50, html: '<i class="ot-me"></i>' }]);
}
async function locateMe() {
  const h = await ctx.locate({ force: true });
  if (!h) return ctx.status('無法取得位置：請在設定允許定位');
  map.setView(h.lat, h.lon, Math.max(map.zoom(), 16));
  following = true;
  stopWatch();
  stopWatch = watchPosition(p => {
    ctx.here = { ...p, at: Date.now() };
    drawMe(ctx.here);
    if (following) map.setView(p.lat, p.lon);
  });
}

// ---- What's on the map ---------------------------------------------------------------------------

let idleTimer = 0;
function idle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(drawLayers, 250);
  const c = map.center();
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lon: c.lon, z: map.zoom() }));
  } catch {}
}
const inView = (b, p, pad = 0.002) => p.lat >= b.s - pad && p.lat <= b.n + pad && p.lon >= b.w - pad && p.lon <= b.e + pad;
const closest = (list, c, n) => list.map(x => [meters(c.lat, c.lon, x.lat, x.lon), x]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);

let drawing = 0;
async function drawLayers() {
  const run = ++drawing;
  const b = map.bounds();
  if (!b) return;
  const z = map.zoom();
  const c = map.center();
  const L = ctx.data.layers;
  const city = await ctx.cityOf(c.lat, c.lon);
  if (run !== drawing) return;
  // YouBike: the city's stations, the 200 nearest the middle.
  if (L.bike && z >= 15 && city) {
    cityBikes(city)
      .then(list => run === drawing && map.layer('bike').set(closest(list.filter(s => inView(b, s)), c, 200).map(bikeMarker)))
      .catch(() => {});
  } else map.layer('bike').set([]);
  // Bus stops: around the middle, from a closer zoom.
  if (L.bus && z >= 16) {
    stationsNear(c.lat, c.lon)
      .then(list => run === drawing && map.layer('bus').set(closest(list.filter(s => inView(b, s)), c, 160).map(busMarker)))
      .catch(() => {});
  } else map.layer('bus').set([]);
  if (L.rail && z >= 10) {
    railStations()
      .then(list => run === drawing && map.layer('rail').set(list.filter(s => inView(b, s, 0.01) && (s.sys === 'hsr' || z >= 12 || s.cls <= '1')).map(railMarker)))
      .catch(() => {});
  } else map.layer('rail').set([]);
  if (L.metro && z >= 12) {
    metroSystems([b.s, b.w, b.n, b.e])
      .then(systems => run === drawing && map.layer('metro').set(systems.flatMap(s => s.stations.map(st => ({ st, color: s.lines.find(l => st.lines.includes(l.id))?.color }))).filter(x => inView(b, x.st, 0.005)).map(metroMarker)))
      .catch(() => {});
  } else map.layer('metro').set([]);
}

const bikeMarker = s => {
  const lv = bikeLevel(s);
  return { id: `bike:${s.uid}`, lat: s.lat, lon: s.lon, cls: `bike ${lv}`, z: 3, kind: 'bike', data: s, html: `<b>${s.ok === false ? '停' : s.bikes}</b>${s.ebike ? `<i>⚡${s.ebike}</i>` : ''}` };
};
const busMarker = s => ({ id: `bus:${s.uid}`, lat: s.lat, lon: s.lon, cls: 'bus', z: 2, kind: 'bus', data: s, html: icon('bus') });
const railMarker = s => ({ id: s.key, lat: s.lat, lon: s.lon, cls: `rail ${s.sys}`, z: 4, kind: s.sys, data: s, html: `${icon(s.sys === 'hsr' ? 'hsr' : 'tra')}<span>${e(s.name)}</span>` });
const metroMarker = ({ st, color }) => ({ id: st.key, lat: st.lat, lon: st.lon, cls: 'metro', z: 4, kind: 'metro', data: st, html: `<i style="--c:${e(color || '#3b82f6')}"></i><span>${e(st.name)}</span>` });

// ---- Taps ----------------------------------------------------------------------------------------

function pick(it) {
  following = false;
  openCard({ kind: it.kind, item: it.data, lat: it.lat, lon: it.lon });
}
// An empty spot: closes the card, or marks the spot (to plan a trip there).
async function tap(pt) {
  following = false;
  if (!$('results').hidden) return closeResults();
  if (card) return closeCard();
  openCard({ kind: 'point', item: { name: '地圖上的位置', lat: pt.lat, lon: pt.lon }, lat: pt.lat, lon: pt.lon });
  try {
    const res = await fetch(`${PROXY}/weather/where?lat=${pt.lat.toFixed(5)}&lon=${pt.lon.toFixed(5)}&qt=${encodeURIComponent(await ctx.q.ensureToken())}`);
    const w = res.ok ? await res.json() : null;
    if (card?.kind === 'point' && card.lat === pt.lat && w?.town) {
      card.item.name = [w.town, w.village].filter(Boolean).join(' ') + '附近';
      card.item.sub = w.county || '';
      renderCard();
    }
  } catch {}
}
// One of Google's places: a station opens ours (with its live board).
async function googlePlace(p) {
  following = false;
  const rail = await railStations().catch(() => []);
  const metro = (await metroSystems(p).catch(() => [])).flatMap(s => s.stations);
  const st = [...rail, ...metro].map(s => [meters(p.lat, p.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0])[0];
  if (st && st[0] < 120) return openCard({ kind: st[1].sys, item: st[1], lat: st[1].lat, lon: st[1].lon });
  openCard({ kind: 'place', item: { id: p.id, name: '', lat: p.lat, lon: p.lon }, lat: p.lat, lon: p.lon });
  try {
    const d = await placeDetails(p.id, { name: true });
    if (card?.item?.id === p.id) {
      Object.assign(card.item, { name: d.name || '這個地點', sub: d.address, lat: d.lat, lon: d.lon });
      renderCard();
    }
  } catch {
    if (card?.item?.id === p.id) {
      card.item.name = '這個地點';
      renderCard();
    }
  }
}

// ---- The card ----------------------------------------------------------------------------------------

let cardTimer = 0;
function openCard(c) {
  document.body.classList.remove('ot-planning');
  card = { ...c, at: Date.now() };
  map.layer('sel').set([{ id: 'sel', lat: c.lat, lon: c.lon, cls: 'sel', z: 40, html: icon('pin') }]);
  renderCard();
  refreshCard();
}
function closeCard() {
  card = null;
  document.body.classList.remove('ot-planning');
  clearInterval(cardTimer);
  $('card').hidden = true;
  $('card').className = 'ot-card';
  map.layer('sel').set([]);
  map.lines('plan', []);
  map.layer('plan').set([]);
}
// The card's live part, again every 20 s while it's open.
function refreshCard() {
  clearInterval(cardTimer);
  const load = async () => {
    if (!card) return clearInterval(cardTimer);
    const c = card;
    try {
      if (c.kind === 'bike') {
        const city = await ctx.cityOf(c.lat, c.lon);
        const list = await cityBikes(city);
        c.live = list.find(s => s.uid === c.item.uid) || c.item;
      } else if (c.kind === 'bus') c.live = await stationEta(c.item);
      else if (c.kind === 'tra') c.live = await traBoard(c.item.id);
      else if (c.kind === 'hsr') c.live = await hsrBoard(c.item.id);
      else if (c.kind === 'metro') c.live = { board: await liveBoard(c.item).catch(() => null), next: await nextTrains(c.item).catch(() => null), op: c.item.op };
      else return;
      c.error = '';
    } catch (err) {
      c.error = errorText(err);
    }
    if (card === c) renderCard();
  };
  load();
  if (card && card.kind !== 'plans' && card.kind !== 'place' && card.kind !== 'point') cardTimer = setInterval(load, 20_000);
}

const placeOf = c => ({ name: c.item.name || '', lat: c.item.lat ?? c.lat, lon: c.item.lon ?? c.lon });
function actions(c, { pin = true } = {}) {
  const pinned = ctx.data.places.find(p => meters(p.lat, p.lon, c.lat, c.lon) < 30);
  return `<div class="ot-card-acts">
    <button class="q-btn primary" type="button" data-card="go">${icon('route')} 路線</button>
    ${pin ? (pinned ? `<button class="q-btn on" type="button" data-card="edit-pin" data-id="${e(pinned.id)}">${icon('star')} ${e(pinned.name)} · 編輯</button>` : `<button class="q-btn" type="button" data-card="pin">${icon('star')} 釘選</button>`) : ''}
  </div>`;
}
function head(title, sub, badge = '') {
  const d = ctx.here && card ? distText(meters(ctx.here.lat, ctx.here.lon, card.lat, card.lon)) : '';
  return `<div class="ot-card-grip" data-card="grow"></div><div class="ot-card-head">${badge}<div class="ot-card-title"><h2>${e(title)}</h2><p>${[sub, d && `距離 ${d}`].filter(Boolean).map(e).join(' · ')}</p></div><button class="q-close" type="button" data-card="close" aria-label="關閉">×</button></div>`;
}

function renderCard() {
  const box = $('card');
  if (!card) return;
  box.hidden = false;
  const c = card;
  const err = c.error ? `<p class="ot-note bad">${e(c.error)}</p>` : '';
  let html = '';
  if (c.kind === 'bike') {
    const s = c.live || c.item;
    html = `${head(s.name, s.kind, `<span class="ot-badge bike">${icon('bike')}</span>`)}
      <div class="ot-bike-now">
        <div><b>${s.bikes}</b><span>一般車</span></div>
        <div class="e"><b>${s.ebike}</b><span>⚡ 電輔車</span></div>
        <div class="d"><b>${s.ret}</b><span>可還空位</span></div>
      </div>
      <p class="ot-note">${s.ok === false ? '暫停營運 · ' : ''}${s.cap ? `共 ${s.cap} 柱 · ` : ''}${e(ago(s.at))}</p>${err}${actions(c)}`;
  } else if (c.kind === 'bus') {
    const s = c.item;
    const live = Array.isArray(c.live) ? c.live : null;
    const rowsHtml = live
      ? live
          .map(r => ({ r, t: etaText(r) }))
          .sort((a, b) => (a.r.sec ?? 1e9) - (b.r.sec ?? 1e9))
          .map(({ r, t }) => `<button class="ot-eta-row" type="button" data-route="${e(r.route)}" data-city="${e(r.city)}" data-route-uid="${e(r.routeUID)}" data-stop="${e(r.stopUID)}" data-dir="${r.dir}"><span class="ot-route-no">${e(r.route)}</span><span class="ot-eta ${t.tone}"><b>${e(t.main)}</b><small>${e(t.sub)}</small></span></button>`)
          .join('') || '<p class="ot-note">這個站牌現在沒有公車資料。</p>'
      : '<p class="ot-note">載入中…</p>';
    html = `${head(s.name, [BEARING[s.bearing], s.routes.length ? `${s.routes.length} 條路線` : ''].filter(Boolean).join(' · '), `<span class="ot-badge bus">${icon('bus')}</span>`)}${err}<div class="ot-eta-list">${rowsHtml}</div>${actions(c)}`;
  } else if (c.kind === 'tra') {
    const s = c.item;
    const list = Array.isArray(c.live) ? c.live.filter(r => r.sched == null || r.sched + r.delay * 60_000 > Date.now() - 60_000).slice(0, 10) : null;
    html = `${head(`${s.name}車站`, '台鐵', `<span class="ot-badge tra">${icon('tra')}</span>`)}${err}
      <div class="ot-board">${
        list
          ? list.map(r => `<div class="ot-board-row"><span class="ot-time">${e(hm(r.sched))}</span><span class="ot-train"><b>${e(r.type)} ${e(r.no)}</b><small>往 ${e(r.dest)}${r.platform ? ` · 第 ${e(r.platform)} 月台` : ''}</small></span><span class="ot-delay ${r.status === 2 ? 'bad' : r.delay ? 'warn' : 'ok'}">${r.status === 2 ? '取消' : r.delay ? `晚 ${r.delay} 分` : '準點'}</span></div>`).join('') || '<p class="ot-note">接下來一小時沒有列車。</p>'
          : '<p class="ot-note">載入中…</p>'
      }</div>
      <button class="q-btn ot-wide" type="button" data-card="train">${icon('tra')} 從這站查火車時刻</button>${actions(c)}`;
  } else if (c.kind === 'hsr') {
    const s = c.item;
    const list = Array.isArray(c.live) ? c.live : null;
    html = `${head(`高鐵${s.name}站`, '台灣高鐵', `<span class="ot-badge hsr">${icon('hsr')}</span>`)}${err}
      <div class="ot-board">${list ? list.map(r => `<div class="ot-board-row"><span class="ot-time">${e(hm(r.dep))}</span><span class="ot-train"><b>${e(r.no)} 次</b><small>往 ${e(r.dest)}</small></span><span class="ot-delay">${minsText((r.dep - Date.now()) / 1000)}後</span></div>`).join('') || '<p class="ot-note">今天已經沒有車了。</p>' : '<p class="ot-note">載入中…</p>'}</div>
      <button class="q-btn ot-wide" type="button" data-card="train">${icon('hsr')} 從這站查高鐵時刻</button>${actions(c)}`;
  } else if (c.kind === 'metro') {
    const s = c.item;
    html = `${head(stationTitle(s.name), OPERATORS[s.op] || '捷運', `<span class="ot-badge metro">${icon('metro')}</span>`)}${err}${metroBoardHtml(c.live)}
      <button class="q-btn ot-wide" type="button" data-card="metro">${icon('metro')} 在捷運路網圖上看</button>${actions(c)}`;
  } else if (c.kind === 'place' || c.kind === 'point') {
    const s = c.item;
    html = `${head(s.name || '載入中…', s.sub || '', `<span class="ot-badge place">${icon('pin')}</span>`)}${err}${actions(c)}`;
  } else if (c.kind === 'plans') html = plansHtml(c);
  box.innerHTML = html;
  // The plans keep most of the map in view; the grip grows the card.
  box.classList.toggle('plans', c.kind === 'plans');
  box.classList.toggle('tall', box.classList.contains('grown'));
}

// A metro station's board: live trains (臺北捷運 sends only those about to
// arrive, so most of the time there are none) and the timetable's next ones
// beside them, each way.
export function metroBoardHtml(live) {
  if (!live) return '<p class="ot-note">載入中…</p>';
  const board = (live.board || []).filter(r => r.dest);
  const next = live.next || [];
  const liveHtml = board
    .map(r => `<div class="ot-board-row"><span class="ot-train"><b>往 ${e(r.dest)}</b><small>${r.status === 3 ? '末班車已過' : r.status === 4 ? '今日未營運' : '即時'}</small></span><span class="ot-delay ${r.min != null && r.min <= 1 ? 'ok' : ''}">${r.min == null ? '—' : r.min <= 0 ? '進站中' : `${r.min} 分`}</span></div>`)
    .join('');
  const tableHtml = next
    .filter(r => !board.some(b => b.dest === r.dest))
    .map(r => `<div class="ot-board-row"><span class="ot-train"><b>往 ${e(r.dest)}</b><small>時刻表</small></span><span class="ot-times">${r.times.map(t => `<b>${e(hm(t))}</b>`).join('')}</span></div>`)
    .join('');
  if (liveHtml || tableHtml) return `<div class="ot-board">${liveHtml}${tableHtml}</div>`;
  if (live.op === 'TMRT') return '<p class="ot-note">台中捷運沒有提供即時或時刻資料給交通部 TDX。</p>';
  return '<p class="ot-note">現在沒有列車資料（可能已收班）。</p>';
}

async function cardClick(ev) {
  const act = ev.target.closest('[data-card]')?.dataset.card;
  const routeBtn = ev.target.closest('[data-route]');
  if (routeBtn) {
    const d = routeBtn.dataset;
    return openRoute(ctx, { uid: d.routeUid, name: d.route, city: d.city }, { stopUID: d.stop, dir: Number(d.dir) });
  }
  // 開始導航 sits inside its plan's button: it goes first.
  if (act === 'nav' && card) return canNav(card.plans?.[card.sel]) && navigate(card.plans[card.sel]);
  if (act === 'pick' && card) return togglePick(card, card.plans?.[card.sel]);
  const planBtn = ev.target.closest('[data-plan]');
  if (planBtn) return selectPlan(Number(planBtn.dataset.plan));
  const when = ev.target.closest('[data-when]');
  if (when) return setWhen(when.dataset.when);
  if (!act || !card) return;
  if (act === 'close') return closeCard();
  if (act === 'grow') {
    $('card').classList.toggle('grown');
    return $('card').classList.toggle('tall', $('card').classList.contains('grown'));
  }
  // From where you are; the start can be changed on the plan.
  if (act === 'go') return plan(null, placeOf(card));
  if (act === 'pin') return pinSheet(placeOf(card));
  if (act === 'edit-pin') return ctx.editPlace?.(ev.target.closest('[data-id]').dataset.id);
  if (act === 'back') return card.back ? openCard(card.back) : closeCard();
  if (act === 'swap') return card.from?.lat != null && plan(card.to, card.fromHere ? null : card.from, { swapHere: card.fromHere });
  if (act === 'edit-from' || act === 'edit-to') {
    const c = card;
    const pt = await pickPoint(act === 'edit-from' ? '從哪裡出發' : '要去哪裡', { here: true });
    if (!pt || card !== c) return;
    if (pt.map) {
      const spot = await pickOnMap(act === 'edit-from' ? '移動地圖，把出發地放在中間' : '移動地圖，把目的地放在中間', act === 'edit-from' ? c.from : c.to);
      if (card !== c) return;
      if (!spot) return renderCard();
      Object.assign(pt, spot);
    }
    const keepFrom = c.fromHere ? null : c.from;
    if (act === 'edit-from') return plan(pt.here ? null : pt, c.to);
    return plan(keepFrom, pt.here ? await hereNow() : pt);
  }
  if (act === 'more') {
    card.more = !card.more;
    return renderCard();
  }
  if (act === 'nav') return navigate(card.plans?.[card.sel]);
  if (act === 'save-trip') {
    const t = tripOf(card);
    return saveTripSheet(card, t ? { edit: t } : {});
  }
  if (act === 'train') {
    ctx.trainFrom = { sys: card.kind, id: card.item.id, name: card.item.name };
    return ctx.goTab('times');
  }
  if (act === 'metro') {
    ctx.metroStation = card.item;
    return ctx.openMetro?.();
  }
}

async function hereNow() {
  const h = await ctx.locate();
  return h ? { name: '目前位置', lat: h.lat, lon: h.lon } : null;
}

// Choosing a spot by moving the map under a pin in the middle.
function pickOnMap(text, near) {
  return new Promise(resolve => {
    const box = $('card');
    box.hidden = true;
    document.body.classList.add('ot-picking');
    if (near?.lat != null) map.setView(near.lat, near.lon, Math.max(map.zoom(), 16));
    const bar = document.createElement('div');
    bar.className = 'ot-pickbar';
    bar.innerHTML = `<i class="ot-cross">${icon('pin')}</i><div class="ot-pickbar-box"><p>${e(text)}</p><div class="ot-row"><button class="q-btn" type="button" data-pick="no">取消</button><button class="q-btn primary" type="button" data-pick="ok">用這個位置</button></div></div>`;
    $('panel-map').append(bar);
    bar.addEventListener('click', ev => {
      const a = ev.target.closest('[data-pick]')?.dataset.pick;
      if (!a) return;
      const c = map.center();
      bar.remove();
      document.body.classList.remove('ot-picking');
      box.hidden = false;
      resolve(a === 'ok' ? { name: '地圖上的位置', lat: c.lat, lon: c.lon } : null);
    });
  });
}

// ---- Search ------------------------------------------------------------------------------------------

let searchSession = '';
function wireSearch() {
  const input = $('q');
  const clear = $('q-clear');
  let timer = 0;
  let ask = 0;
  input.addEventListener('focus', () => {
    searchSession ||= uid() + uid();
    showResults(input.value);
  });
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(() => showResults(input.value, ++ask), 220);
  });
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    closeResults();
  });
  $('map-search').addEventListener('submit', ev => {
    ev.preventDefault();
    $('results').querySelector('[data-res]')?.click();
  });
  $('results').addEventListener('click', ev => {
    const b = ev.target.closest('[data-res]');
    if (b) chooseResult(JSON.parse(b.dataset.res));
  });
  const showResults = async (text, n = ask) => {
    const t = text.trim();
    const box = $('results');
    box.hidden = false;
    const local = await localMatches(t);
    const draw = remote =>
      (box.innerHTML =
        [
          ...local.map(r => resultRow(r)),
          ...(remote || []).map(r => resultRow(r)),
          !t && !local.length ? '<p class="ot-note">搜尋地點、地址、車站，或從下面的常用地點開始。</p>' : ''
        ].join('') || (remote ? '<p class="ot-note">找不到符合的地點</p>' : '<p class="ot-note">搜尋中…</p>'));
    draw(t.length >= 2 ? null : []);
    if (t.length < 2) return;
    try {
      const c = ctx.here || map.center();
      const out = await searchPlaces(t, { lat: c.lat, lon: c.lon, session: searchSession });
      if (n === ask) draw(out.items.map(i => ({ kind: i.lat != null ? 'geo' : 'google', id: i.id, name: i.name, sub: i.sub, lat: i.lat, lon: i.lon, dist: i.dist })));
    } catch (err) {
      if (n === ask) draw([]);
      ctx.status(errorText(err));
    }
  };
}
function closeResults() {
  $('results').hidden = true;
  $('q').blur();
}
const resultRow = r =>
  `<button class="ot-res" type="button" data-res="${e(JSON.stringify(r))}"><span class="ot-res-i">${r.kind === 'place' ? PLACE_ICONS[r.icon] || '📍' : r.kind === 'trip' ? icon('clock') : r.kind === 'tra' ? icon('tra') : r.kind === 'hsr' ? icon('hsr') : r.kind === 'metro' ? icon('metro') : r.kind === 'here' ? icon('locate') : r.kind === 'map' ? icon('layers') : icon('pin')}</span><span class="ot-res-t"><b>${e(r.name)}</b><small>${e(r.sub || '')}</small></span>${r.dist ? `<span class="ot-res-d">${e(distText(r.dist))}</span>` : ''}</button>`;

// A sheet to choose a trip's end: 目前位置, your places, stations, Google's
// places. → { name, lat, lon } (here: true for 目前位置), or null.
export function pickPoint(title, { here = false, onMap = true } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      d.close();
      resolve(v);
    };
    const session = uid() + uid();
    const d = sheet(`${sheetHead(e(title))}
      <form class="ot-pick-form" autocomplete="off"><div class="ot-search-in"><input id="pp-q" type="search" inputmode="search" placeholder="地點、地址、車站" enterkeyhint="search"></div></form>
      <div class="ot-results ot-pick" id="pp-res"></div>`);
    d.onclosed = () => finish(null);
    const box = d.querySelector('#pp-res');
    const input = d.querySelector('#pp-q');
    const hereRow = (here ? resultRow({ kind: 'here', name: '目前位置', sub: '用你現在的位置' }) : '') + (onMap && map ? resultRow({ kind: 'map', name: '在地圖上選', sub: '移動地圖，選一個位置' }) : '');
    let ask = 0;
    let timer = 0;
    const draw = async () => {
      const n = ++ask;
      const t = input.value.trim();
      const local = await localMatches(t);
      if (n !== ask) return;
      box.innerHTML = `${t ? '' : hereRow}${local.map(resultRow).join('')}${t.length >= 2 ? '<p class="ot-note">搜尋中…</p>' : ''}`;
      if (t.length < 2) return;
      try {
        const c = ctx.here || map?.center() || FALLBACK;
        const out = await searchPlaces(t, { lat: c.lat, lon: c.lon, session });
        if (n !== ask) return;
        const remote = out.items.map(i => ({ kind: i.lat != null ? 'geo' : 'google', id: i.id, name: i.name, sub: i.sub, lat: i.lat, lon: i.lon, dist: i.dist }));
        box.innerHTML = [...local, ...remote].map(resultRow).join('') || '<p class="ot-note">找不到符合的地點</p>';
      } catch (err) {
        if (n === ask) box.innerHTML = `${local.map(resultRow).join('')}<p class="ot-note bad">${e(errorText(err))}</p>`;
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(draw, 220);
    });
    d.querySelector('form').addEventListener('submit', ev => {
      ev.preventDefault();
      box.querySelector('[data-res]')?.click();
    });
    box.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-res]');
      if (!b) return;
      const r = JSON.parse(b.dataset.res);
      if (r.kind === 'here') return finish({ here: true, name: '目前位置' });
      if (r.kind === 'map') return finish({ map: true, name: '地圖上的位置' });
      if (r.kind === 'google') {
        try {
          const p = await placeDetails(r.id, { session });
          return finish({ name: r.name, lat: p.lat, lon: p.lon });
        } catch (err) {
          return (box.innerHTML = `<p class="ot-note bad">${e(errorText(err))}</p>`);
        }
      }
      if (Number.isFinite(r.lat)) finish({ name: r.name, lat: r.lat, lon: r.lon });
    });
    draw();
    setTimeout(() => input.focus(), 50);
  });
}

// Pinned places, recent trips and stations matching (no network).
async function localMatches(t) {
  const norm = s => String(s || '').replace(/台/g, '臺');
  const T = norm(t);
  const places = ctx.data.places.filter(p => !T || norm(p.name).includes(T)).map(p => ({ kind: 'place', icon: p.icon, name: p.name, sub: p.address || '我的地點', lat: p.lat, lon: p.lon }));
  const trips = T ? [] : ctx.data.trips.slice(0, 5).map(x => ({ kind: 'trip', name: x.name || '最近的目的地', sub: '最近', lat: x.lat, lon: x.lon }));
  let stations = [];
  if (T) {
    const rail = await railStations().catch(() => []);
    // Metro stations of the systems loaded already and those around you.
    if (ctx.here) await metroSystems(ctx.here).catch(() => []);
    const metro = (await metroSystems().catch(() => [])).flatMap(s => s.stations);
    stations = [...rail, ...metro]
      .filter(s => norm(s.name).includes(T.replace(/(車站|站)$/, '')))
      .slice(0, 6)
      .map(s => ({ kind: s.sys, key: s.key, id: s.id, op: s.op, name: s.sys === 'hsr' ? `高鐵${s.name}站` : s.sys === 'tra' ? `${s.name}車站` : stationTitle(s.name), sub: s.sys === 'metro' ? OPERATORS[s.op] : s.sys === 'hsr' ? '台灣高鐵' : '台鐵', lat: s.lat, lon: s.lon }));
  }
  return [...places, ...trips, ...stations].slice(0, 12);
}

async function chooseResult(r) {
  closeResults();
  $('q').value = r.name;
  $('q-clear').hidden = false;
  if (r.kind === 'google') {
    try {
      const d = await placeDetails(r.id, { session: searchSession });
      searchSession = '';
      return arrive({ kind: 'place', item: { id: r.id, name: r.name, sub: r.sub || d.address, lat: d.lat, lon: d.lon }, lat: d.lat, lon: d.lon });
    } catch (err) {
      return ctx.status(errorText(err));
    }
  }
  if (r.kind === 'tra' || r.kind === 'hsr' || r.kind === 'metro') {
    const rail = r.kind === 'metro' ? (await metroSystems()).flatMap(s => s.stations) : await railStations();
    const st = rail.find(s => s.key === r.key);
    if (st) return arrive({ kind: st.sys, item: st, lat: st.lat, lon: st.lon });
  }
  arrive({ kind: 'place', item: { name: r.name, sub: r.sub, lat: r.lat, lon: r.lon }, lat: r.lat, lon: r.lon });
}
function arrive(c) {
  map.setView(c.lat, c.lon, Math.max(map.zoom(), 16));
  openCard(c);
}

// ---- Pinned places ---------------------------------------------------------------------------------

function drawChips() {
  const L = ctx.data.layers;
  $('map-chips').innerHTML =
    ctx.data.places.map(p => `<button class="q-chip" type="button" data-place="${e(p.id)}">${PLACE_ICONS[p.icon] || '📍'} ${e(p.name)}</button>`).join('') +
    `<button class="q-chip ot-chip-muted" type="button" data-chip="pin">＋ 釘選</button>` +
    Object.entries(LAYERS)
      .map(([k, name]) => `<button class="q-chip ot-layer-chip" type="button" data-layer="${k}" aria-pressed="${L[k]}">${name}</button>`)
      .join('');
  $('map-chips').onclick = ev => {
    const pl = ev.target.closest('[data-place]');
    if (pl) {
      const p = ctx.data.places.find(x => x.id === pl.dataset.place);
      if (p) arrive({ kind: 'place', item: { name: p.name, sub: p.address, lat: p.lat, lon: p.lon, pin: p.id }, lat: p.lat, lon: p.lon });
      return;
    }
    const layer = ev.target.closest('[data-layer]')?.dataset.layer;
    if (layer) {
      ctx.data.layers[layer] = !ctx.data.layers[layer];
      drawChips();
      drawLayers();
      return ctx.save();
    }
    if (ev.target.closest('[data-chip="pin"]')) {
      const c = ctx.here || map.center();
      pinSheet({ name: '', lat: c.lat, lon: c.lon });
    }
  };
}

function pinSheet(p) {
  if (ctx.data.places.length >= MAX_PLACES) return ctx.status(`最多 ${MAX_PLACES} 個釘選地點`);
  let iconKey = 'pin';
  const d = sheet(`${sheetHead('釘選地點', '點地圖上的地點，或搜尋後按「釘選」')}
    <label class="ot-field"><span>名稱</span><input id="pin-name" maxlength="20" value="${e(p.name)}" placeholder="例如：家、公司、學校"></label>
    <div class="ot-field"><span>圖示</span><div class="q-chips">${Object.entries(PLACE_ICONS).map(([k, v]) => `<button class="q-chip" type="button" data-icon="${k}" aria-pressed="${k === iconKey}">${v}</button>`).join('')}</div></div>
    <div class="ot-row ot-actions"><button class="q-btn primary" type="button" data-save="1">儲存</button></div>
    ${ctx.data.places.length ? `<h3 class="q-sheet-h">已釘選</h3><div class="ot-list">${ctx.data.places.map((x, i) => `<div class="ot-order-row"><span>${PLACE_ICONS[x.icon]} ${e(x.name)}</span><button class="q-icon-btn" type="button" data-up="${i}" aria-label="上移" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="q-icon-btn" type="button" data-del="${e(x.id)}" aria-label="刪除">${icon('trash')}</button></div>`).join('')}</div>` : ''}`);
  d.addEventListener('click', ev => {
    const ic = ev.target.closest('[data-icon]');
    if (ic) {
      iconKey = ic.dataset.icon;
      d.querySelectorAll('[data-icon]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.icon === iconKey)));
      return;
    }
    const up = ev.target.closest('[data-up]');
    const del = ev.target.closest('[data-del]');
    if (up || del) {
      if (up) {
        const i = Number(up.dataset.up);
        const list = [...ctx.data.places];
        [list[i - 1], list[i]] = [list[i], list[i - 1]];
        ctx.data.places = list;
      } else ctx.data.places = ctx.data.places.filter(x => x.id !== del.dataset.del);
      ctx.save();
      drawChips();
      d.close();
      return pinSheet(p);
    }
    if (ev.target.closest('[data-save]')) {
      const clean = cleanPlace({ ...p, name: d.querySelector('#pin-name').value.trim() || p.name, icon: iconKey });
      if (!clean) return ctx.status('這個位置不在台灣');
      ctx.data.places = [...ctx.data.places, clean];
      ctx.save();
      drawChips();
      d.close();
      if (card) renderCard();
    }
  });
}

function layersSheet() {
  const L = ctx.data.layers;
  const d = sheet(`${sheetHead('地圖圖層')}
    <div class="ot-list">${Object.entries(LAYERS)
      .map(([k, name]) => `<div class="ot-order-row"><span>${name}<small>${{ bike: '放大到街道才顯示；數字是一般車，⚡ 是電輔車', bus: '放大到路口才顯示', rail: '台鐵與高鐵車站', metro: '各城市捷運與輕軌車站' }[k]}</small></span><button class="q-switch" type="button" role="switch" data-sw="${k}" aria-checked="${L[k]}" aria-label="${name}"><i></i></button></div>`)
      .join('')}</div>
    <p class="ot-note">${map.kind === 'google' ? 'Google 地圖（本月免費額度內）' : '國土測繪中心電子地圖（Google 地圖本月額度已用完，下個月自動換回）'}</p>`);
  d.addEventListener('click', ev => {
    const sw = ev.target.closest('[data-sw]');
    if (!sw) return;
    const k = sw.dataset.sw;
    L[k] = !L[k];
    sw.setAttribute('aria-checked', String(L[k]));
    drawChips();
    drawLayers();
    ctx.save();
  });
}

// ---- Plans: from here (or a chosen start) to a place --------------------------------------------------

let when = { by: 'now', at: null };
// A trip from `from` (null: where you are) to `to`. `opts.swapHere`: the
// trip turned round, ending where you are.
async function plan(from, to, opts = {}) {
  if (!map) {
    pendingTrip = { from, to, opts };
    return;
  }
  if (navigating()) stopNav();
  const here = !from ? await hereNow() : null;
  const start = from || here;
  const dest = opts.swapHere ? await hereNow() : to;
  const fromPt = start ? { name: start.name || '目前位置', lat: start.lat, lon: start.lon } : { name: '選擇出發地', lat: null, lon: null };
  if (!dest) return ctx.status('需要你的位置：請在設定允許定位');
  card = { kind: 'plans', from: fromPt, fromHere: !from, to: dest, lat: dest.lat, lon: dest.lon, plans: null, sel: -1, more: false, back: card?.kind !== 'plans' ? card : card.back };
  ctx.status('');
  document.body.classList.add('ot-planning');
  renderCard();
  if (!start) {
    card.plans = [];
    card.error = '需要你的位置（請在設定允許定位），或點上面的出發地選一個地點。';
    return renderCard();
  }
  map.fit([fromPt, dest], { top: 110, bottom: Math.round(innerHeight * 0.48), left: 40, right: 40 });
  ctx.data.trips = remember(ctx.data.trips, { name: dest.name, lat: dest.lat, lon: dest.lon, t: Date.now() }, tripKey, 10);
  ctx.save();
  const c = card;
  try {
    const at = when.by === 'now' ? null : when.at;
    const out = await planTrip(ctx.data, fromPt, dest, { at, by: when.by === 'arrive' ? 'arrive' : 'depart' });
    c.plans = out.plans;
    c.sources = out.sources;
    if (out.error && !out.plans.length) c.error = errorText(out.error);
  } catch (err) {
    c.error = errorText(err);
    c.plans = [];
  }
  if (card === c) {
    renderCard();
    // The best plan drawn on the map at once; its steps open with a tap.
    if (c.plans.length) drawPlan(c.plans[0], { fit: false });
    if (opts.nav && c.plans[opts.index || 0]) navigate(c.plans[opts.index || 0]);
  }
}

// 出發時間 / 抵達時間: a day (today, tomorrow…) and a time; it stays until
// 現在出發 is chosen again. A time already past today means tomorrow's.
function setWhen(kind) {
  const replan = () => card?.kind === 'plans' && plan(card.fromHere ? null : card.from, card.to);
  if (kind === 'now') {
    when = { by: 'now', at: null };
    return replan();
  }
  const base = when.at && when.at > Date.now() ? when.at : Date.now() + 15 * 60_000;
  const today = tw().date;
  const dayChips = [0, 1, 2].map(n => [addDays(today, n), ['今天', '明天', '後天'][n]]);
  let date = tw(base).date;
  const d = sheet(`${sheetHead(kind === 'arrive' ? '抵達時間' : '出發時間')}
    <div class="ot-field"><span>日期</span><div class="q-chips ot-days">${dayChips.map(([v, n]) => `<button class="q-chip" type="button" data-day="${v}" aria-pressed="${v === date}">${n}<small>${e(v.slice(5).replace('-', '/'))}</small></button>`).join('')}</div></div>
    <label class="ot-field"><span>時間</span><input id="w-time" type="time" value="${tw(base).hm}"></label>
    <div class="ot-row ot-actions"><button class="q-btn primary" type="button" data-ok="1">查詢</button></div>`);
  d.addEventListener('click', ev => {
    const b = ev.target.closest('[data-day]');
    if (b) {
      date = b.dataset.day;
      d.querySelectorAll('[data-day]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.day === date)));
      return;
    }
    if (!ev.target.closest('[data-ok]')) return;
    const time = d.querySelector('#w-time').value || '08:00';
    let at = twAt(date, time);
    if (at < Date.now() - 5 * 60_000 && date === today) at = twAt(addDays(today, 1), time);
    when = { by: kind, at: Math.max(at, Date.now()) };
    d.close();
    replan();
  });
}

const whenDay = at => {
  const n = Math.round((twAt(tw(at).date, '12:00') - twAt(tw().date, '12:00')) / 86_400_000);
  return n === 0 ? '' : n === 1 ? '明天 ' : n === 2 ? '後天 ' : `${tw(at).date.slice(5).replace('-', '/')} `;
};
const MODE_OFF = { bus: '公車', tra: '台鐵', hsr: '高鐵', metro: '捷運', bike: 'YouBike' };
function plansHtml(c) {
  const whenText = when.by === 'now' ? '現在出發' : `${when.by === 'arrive' ? '抵達' : '出發'} ${hm(when.at)}`;
  const saved = Boolean(tripOf(c));
  const off = Object.entries(ctx.data.prefs.modes).filter(([, v]) => !v).map(([k]) => MODE_OFF[k]);
  const top = `<div class="ot-card-grip" data-card="grow"></div>
    <div class="ot-card-head"><button class="q-icon-btn" type="button" data-card="back" aria-label="返回">${icon('back')}</button>
      <div class="ot-card-title ot-od"><button type="button" data-card="edit-from" aria-label="改出發地"><i class="ot-dot from"></i><span>${e(c.from.name)}</span></button><button type="button" data-card="edit-to" aria-label="改目的地"><i class="ot-dot to"></i><b>${e(c.to.name || '目的地')}</b></button></div>
      <button class="q-icon-btn" type="button" data-card="swap" aria-label="對調起訖">${icon('swap')}</button>
      <button class="q-icon-btn${saved ? ' on' : ''}" type="button" data-card="save-trip" aria-label="釘選這個行程">${icon('star')}</button>
      <button class="q-close" type="button" data-card="close" aria-label="關閉">×</button></div>
    <div class="q-chips ot-when"><button class="q-chip" type="button" data-when="now" aria-pressed="${when.by === 'now'}">現在出發</button><button class="q-chip" type="button" data-when="depart" aria-pressed="${when.by === 'depart'}">${when.by === 'depart' ? `${e(whenDay(when.at))}${hm(when.at)} 出發` : '出發時間'}</button><button class="q-chip" type="button" data-when="arrive" aria-pressed="${when.by === 'arrive'}">${when.by === 'arrive' ? `${e(whenDay(when.at))}${hm(when.at)} 抵達` : '抵達時間'}</button>${off.length ? `<span class="ot-off">不搭 ${e(off.join('、'))}</span>` : ''}</div>`;
  if (!c.plans) return `${top}<p class="ot-note">${e(whenText)}：比較公車、火車、捷運和 YouBike，看公車現在的位置…</p>`;
  if (!c.plans.length) return `${top}${c.error ? `<p class="ot-note bad">${e(c.error)}</p>` : '<p class="ot-note">找不到大眾運輸方案。</p>'}${sourcesNote(c.sources)}`;
  const row = (p, i) => `<button class="ot-plan${i === c.sel ? ' on' : ''}" type="button" data-plan="${i}">
        <div class="ot-plan-top">${picked(c, p) ? `<span class="ot-pinned" title="釘選的方案">${icon('star')}</span>` : ''}<b class="ot-plan-dur">${e(minsText(p.dur))}</b><span class="ot-plan-time">${e(timeRange(p.dep, p.arr))}</span>${p.tags.map(t => `<span class="ot-tag${t === 'YouBike' || t === '電輔車' ? ' bike' : t === '推薦' ? ' best' : t === '即時' ? ' live' : ''}">${e(t)}</span>`).join('')}</div>
        <div class="ot-legs">${legChips(p.legs)}</div>
        <div class="ot-plan-sub">${[leaveText(p), p.transfers ? `轉乘 ${p.transfers} 次` : '不必轉乘', p.walk > 50 ? `步行 ${distText(p.walk)}` : '', p.fareText || (p.fare ? `NT$${p.fare}` : '')].filter(Boolean).map(e).join(' · ')}</div>
        ${p.miss || p.off ? `<div class="ot-plan-sub warn">${e(p.off || p.miss)}</div>` : ''}
        ${i === c.sel ? stepsHtml(p, c) : ''}
      </button>`;
  const tops = c.plans.map((p, i) => [p, i]).filter(([p]) => p.top);
  const rest = c.plans.map((p, i) => [p, i]).filter(([p]) => !p.top);
  return `${top}<div class="ot-plans">${tops.map(([p, i]) => row(p, i)).join('')}</div>
    ${rest.length ? `<button class="q-btn ot-wide ot-more" type="button" data-card="more">${c.more ? '收起其他方案' : `其他 ${rest.length} 個方案`}</button>${c.more ? `<div class="ot-plans">${rest.map(([p, i]) => row(p, i)).join('')}</div>` : ''}` : ''}`;
}
// When to leave: 「12 分後出發」 soon, else 「建議 06:05 出發」; and when you're there.
function leaveText(p) {
  const m = Math.round((p.dep - Date.now()) / 60_000);
  return m <= 0 ? '現在出發' : m < 60 ? `${m} 分後出發` : `建議 ${hm(p.dep)} 出發`;
}

// Which planner didn't answer, said plainly: only when no plan came at all
// (when there are plans, they're what matters).
const SOURCE = { google: 'Google 路線', tdx: 'TDX 規劃', tdxBike: 'TDX 單車轉乘' };
function sourcesNote(src) {
  const why = v => (v === 'cap' ? '本月免費額度已用完' : v === 'busy' ? '忙碌中' : v === 'nokey' ? '未設定' : v === 'http 403' ? '金鑰未開通此服務' : '暫時沒有回應');
  const bad = Object.entries(src || {}).filter(([k, v]) => SOURCE[k] && v !== 'ok' && v !== 'off');
  return bad.length ? `<p class="ot-note">${bad.map(([k, v]) => `${SOURCE[k]}：${why(v)}`).map(e).join('；')}。</p>` : '';
}

// The saved trip a plans card is (the same two ends), and the plans pinned on it.
function tripOf(c) {
  const near = (a, b) => a && b && a.lat != null && b.lat != null && meters(a.lat, a.lon, b.lat, b.lon) < 80;
  return ctx.data.saved.find(x => (near(x.to, c.to) && (c.fromHere ? !x.from : near(x.from, c.from))) || (x.from && near(x.from, c.to) && (c.fromHere ? !x.to : near(x.to, c.from)))) || null;
}
const picked = (c, p) => Boolean(tripOf(c)?.picks.includes(pickSig(p)));
// ☆ on one plan: that way pinned on the trip (the trip saved first when it isn't), shown first in 交通.
function togglePick(c, p) {
  if (!p) return;
  const k = pickSig(p);
  let t = tripOf(c);
  if (!t) {
    if (ctx.data.saved.length >= MAX_SAVED) return ctx.status(`最多 ${MAX_SAVED} 個行程`);
    t = cleanSaved({ name: c.to.name, from: c.fromHere ? null : { name: c.from.name, lat: c.from.lat, lon: c.from.lon }, to: { name: c.to.name, lat: c.to.lat, lon: c.to.lon }, picks: [] });
    if (!t) return;
    ctx.data.saved = [...ctx.data.saved, t];
  }
  const on = t.picks.includes(k);
  const next = cleanSaved({ ...t, picks: on ? t.picks.filter(x => x !== k) : [k, ...t.picks] });
  ctx.data.saved = ctx.data.saved.map(x => (x.id === t.id ? next : x));
  ctx.save();
  ctx.status(on ? '已取消釘選這個方案' : `已釘選這個方案：「交通」會先列出它的下一班`);
  if (card) renderCard();
  ctx.refreshTabs?.();
}

function stepsHtml(p, c = card) {
  return `<ol class="ot-steps">${p.legs
    .map(l => {
      const c = legColor(l);
      const what =
        l.mode === 'walk'
          ? `步行 ${distText(l.dist)}${l.to?.name ? `到 ${e(l.to.name)}` : ''}`
          : l.mode === 'bike'
            ? `${l.swap ? '<b>換車</b>（每 30 分鐘內）・' : ''}${l.ebike ? 'YouBike 電輔車' : 'YouBike'}：在 <b>${e(l.from.name)}</b> 借車${l.rent ? `（${l.ebike ? `電輔 ${l.rent.ebike}` : `一般 ${l.rent.bikes}・電輔 ${l.rent.ebike || 0}`} 台）` : ''}，騎 ${e(distText(l.dist))} 到 <b>${e(l.to.name)}</b> 還車${l.ret ? `（空位 ${l.ret.ret}）` : ''}`
            : `<b>${e(MODE_NAME[l.mode])} ${e(l.short || l.name)}</b>${l.headsign ? ` 往 ${e(l.headsign)}` : ''}<br><small>${e(l.from.name)} → ${e(l.to.name)}${l.stops ? ` · ${l.stops} 站` : ''}${l.agency ? ` · ${e(l.agency)}` : ''}</small><span class="ot-live" data-live="${e(`${l.mode}|${l.short || l.name}|${l.from.lat}|${l.from.lon}`)}"></span>`;
      return `<li style="--c:${e(c)}"><span class="ot-step-time">${e(hm(l.dep))}${l.live ? `<i class="ot-livedot" title="即時"></i>` : ''}</span><span class="ot-step-i">${icon(l.mode)}</span><span class="ot-step-what">${what}<small class="ot-step-dur">${e(minsText(l.dur))}</small></span></li>`;
    })
    .join('')}<li class="end"><span class="ot-step-time">${e(hm(p.arr))}</span><span class="ot-step-i">${icon('pin')}</span><span class="ot-step-what"><b>抵達</b></span></li></ol>
    <span class="ot-plan-acts">${canNav(p) ? `<span class="q-btn primary" role="button" data-card="nav">${icon('route')} 開始導航</span>` : `<span class="ot-nav-later">${e(hm(p.dep - NAV_LEAD))} 起可以開始導航</span>`}<span class="q-btn${picked(c, p) ? ' on' : ''}" role="button" data-card="pick">${icon('star')} ${picked(c, p) ? '已釘選' : '釘選這個方案'}</span></span>`;
}

function selectPlan(i) {
  if (!card?.plans?.[i]) return;
  card.sel = card.sel === i ? -1 : i;
  renderCard();
  drawPlan(card.plans[card.sel >= 0 ? card.sel : 0], { fit: card.sel >= 0 });
  // The buses' next times, and the roads its walks and rides take, for the plan opened.
  if (card.sel >= 0) {
    liveLegs(card.plans[card.sel]);
    roadLegs(card.plans[card.sel]);
  }
}
// The streets a plan's walks and YouBike rides go along (planners give
// walks a line; our own legs are straight until this), then drawn again.
async function roadLegs(p, { lit = -1 } = {}) {
  const todo = p.legs.filter(l => (l.mode === 'bike' || (l.mode === 'walk' && !l.poly)) && !l.road && l.from?.lat != null && l.to?.lat != null && (l.dist || 0) > 120);
  if (!todo.length) return;
  await Promise.all(
    todo.map(async l => {
      const r = await roadPath(l.mode, l.from, l.to);
      if (!r) return;
      l.road = true;
      l.poly = r.poly;
      l.fmt = '';
      if (l.mode === 'bike') l.dist = r.dist;
    })
  );
  if (card?.plans?.includes(p) && (card.plans[card.sel] === p || navigating())) {
    drawPlan(p, { fit: false, lit });
    if (!navigating()) renderCard();
  }
}
function drawPlan(p, { fit = true, lit = -1 } = {}) {
  if (!p) return map.lines('plan', []);
  const lines = [];
  const pts = [];
  for (const [k, l] of p.legs.entries()) {
    const polys = Array.isArray(l.poly) ? l.poly : l.poly ? [l.poly] : [];
    let path = polys.flatMap(x => decodeLine(x, l.fmt));
    if (!path.length && l.from?.lat && l.to?.lat) path = [[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]];
    if (!path.length) continue;
    // Navigating: the step you're on bright, the others faint.
    const dim = lit >= 0 && k !== lit;
    lines.push({ pts: path, color: dim ? '#4b5263' : l.mode === 'walk' ? '#c5ccd8' : legColor(l), width: l.mode === 'walk' ? 4 : dim ? 5 : 8, dash: l.mode === 'walk', z: dim ? 4 : 6 });
    pts.push(...path.map(([lat, lon]) => ({ lat, lon })));
  }
  map.lines('plan', lines);
  map.layer('plan').set([
    { id: 'from', lat: card.from.lat, lon: card.from.lon, cls: 'end from', z: 30, html: '<i></i>' },
    ...p.legs.filter(l => l.mode !== 'walk' && l.from?.lat).map((l, k) => ({ id: `b${k}`, lat: l.from.lat, lon: l.from.lon, cls: 'board', z: 20, html: `<i style="--c:${e(legColor(l))}">${icon(l.mode)}</i>` }))
  ]);
  if (fit && pts.length) map.fit(pts, { top: 120, bottom: Math.round(innerHeight * 0.55), left: 30, right: 30 });
}

// A plan's buses: the one you'd catch, when you'll be at its stop (the
// plan's time there), not the one that happens to be coming now.
async function liveLegs(p) {
  for (const [k, l] of p.legs.entries()) {
    if (l.mode !== 'bus' || !l.from?.lat) continue;
    if (l.dep > Date.now() + 90 * 60_000) break;
    try {
      const name = l.short || l.name;
      const { times, off } = liveTimes(await etaNear(l.from.lat, l.from.lon, 150), name);
      const ready = Math.max(Date.now(), k ? p.legs[k - 1].arr : l.dep - 60_000);
      const bus = times.find(t => t.at >= ready - 60_000);
      const gone = times.length && !bus;
      const text = bus
        ? `${bus.planned ? '預計' : '即時'}：${hm(bus.at)} 到站（${Math.max(0, Math.round((bus.at - Date.now()) / 60_000))} 分後）${bus.at - l.dep > 3 * 60_000 ? `，比時刻表晚 ${Math.round((bus.at - l.dep) / 60_000)} 分` : ''}`
        : gone
          ? `即時：現在來的那班你趕不上（${Math.max(0, Math.round((times[0].at - Date.now()) / 60_000))} 分後到站），下一班看時刻表`
          : off === 3 ? '末班已過' : off === 4 ? '今日未營運' : '';
      const el = document.querySelector(`[data-live="${CSS.escape(`${l.mode}|${name}|${l.from.lat}|${l.from.lon}`)}"]`);
      if (el && text) el.innerHTML = `${icon('live')} ${e(text)}`;
    } catch {}
  }
}

// ---- Navigation ---------------------------------------------------------------------------------------

function navigate(p) {
  if (!p) return;
  const c = card;
  $('card').hidden = true;
  document.body.classList.add('ot-navigating');
  following = true;
  stopWatch();
  roadLegs(p);
  startNav(p, {
    box: $('nav'),
    here: ctx.here,
    draw: (plan, i) => {
      drawPlan(plan, { fit: false, lit: i });
      const l = plan.legs[i];
      const pts = [l.from, l.to].filter(x => x?.lat != null);
      if (ctx.here) pts.push(ctx.here);
      if (pts.length) map.fit(pts, { top: 190, bottom: 60, left: 40, right: 40 });
    },
    follow: pos => {
      ctx.here = { ...pos, at: Date.now() };
      drawMe(ctx.here);
    },
    onEnd: () => {
      $('nav').hidden = true;
      document.body.classList.remove('ot-navigating');
      if (card === c && c) {
        $('card').hidden = false;
        renderCard();
      }
    }
  });
}

// ---- Saving a trip (釘選行程): a name, an optional time, maybe every weekday ------------------------------

export function saveTripSheet(c, { edit = null } = {}) {
  const from = edit ? edit.from : c.fromHere ? null : { name: c.from.name, lat: c.from.lat, lon: c.from.lon };
  const to = edit ? edit.to : { name: c.to.name, lat: c.to.lat, lon: c.to.lon };
  const x = edit || { name: to.name, time: '', by: 'depart', days: [], back: '', alt: [] };
  if (!edit && ctx.data.saved.length >= MAX_SAVED) return ctx.status(`最多 ${MAX_SAVED} 個行程`);
  const days = new Set(x.days);
  // Days whose times differ: one row each (平日 07:30, but 週三 09:10).
  const alt = (x.alt || []).map(a => ({ days: new Set(a.days), time: a.time, back: a.back }));
  const W = '日一二三四五六';
  const d = sheet(`${sheetHead(edit ? '編輯行程' : '釘選行程', `${e(from ? from.name : '目前位置')} → ${e(to.name)}`)}
    <label class="ot-field"><span>名稱</span><input id="st-name" maxlength="24" value="${e(x.name)}" placeholder="例如：上學、回家"></label>
    <div class="ot-field"><span>每週這幾天（可不選）</span><div class="q-chips ot-weekdays" id="st-days"></div>
      <div class="q-chips ot-quick"><button class="q-chip" type="button" data-quick="12345">平日</button><button class="q-chip" type="button" data-quick="0123456">每天</button><button class="q-chip" type="button" data-quick="06">週末</button><button class="q-chip" type="button" data-quick="">不固定</button></div></div>
    <div class="ot-field"><span>時間（可不填）</span><div class="ot-times"><select id="st-by"><option value="depart" ${x.by === 'depart' ? 'selected' : ''}>出發</option><option value="arrive" ${x.by === 'arrive' ? 'selected' : ''}>抵達</option></select><input id="st-time" type="time" value="${e(x.time)}"><span class="ot-times-l">回程</span><input id="st-back" type="time" value="${e(x.back)}" aria-label="回程時間"></div></div>
    <div id="st-alt"></div>
    <div class="ot-row ot-actions">${edit ? '<button class="q-btn" type="button" data-del="1">刪除</button>' : ''}<button class="q-btn primary" type="button" data-save="1">儲存</button></div>`);
  const drawDays = () =>
    (d.querySelector('#st-days').innerHTML = W.split('')
      .map((n, i) => `<button class="q-chip" type="button" data-day="${i}" aria-pressed="${days.has(i)}">${n}</button>`)
      .join(''));
  const drawAlt = () => {
    const box = d.querySelector('#st-alt');
    if (!days.size) return (box.innerHTML = '');
    box.innerHTML = `${alt
      .map(
        (a, k) => `<div class="ot-alt"><div class="q-chips ot-weekdays small">${W.split('')
          .map((n, i) => (days.has(i) ? `<button class="q-chip" type="button" data-alt-day="${k}:${i}" aria-pressed="${a.days.has(i)}">${n}</button>` : ''))
          .join('')}</div><div class="ot-times"><span class="ot-times-l">去</span><input type="time" data-alt-time="${k}" value="${e(a.time)}" aria-label="這幾天的時間"><span class="ot-times-l">回</span><input type="time" data-alt-back="${k}" value="${e(a.back)}" aria-label="這幾天的回程"><button class="q-icon-btn" type="button" data-alt-del="${k}" aria-label="移除">${icon('trash')}</button></div></div>`
      )
      .join('')}${alt.length < 4 ? `<button class="ot-go-link" type="button" data-alt-add="1">${icon('plus')} 某幾天時間不一樣</button>` : ''}${alt.length ? '<p class="ot-note">沒填的時間就用上面的。</p>' : ''}`;
  };
  drawDays();
  drawAlt();
  d.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.altTime) alt[Number(t.dataset.altTime)].time = t.value;
    if (t.dataset.altBack) alt[Number(t.dataset.altBack)].back = t.value;
  });
  d.addEventListener('click', ev => {
    const day = ev.target.closest('[data-day]');
    const quick = ev.target.closest('[data-quick]');
    if (day || quick) {
      if (quick) {
        days.clear();
        for (const ch of quick.dataset.quick) days.add(Number(ch));
      } else {
        const k = Number(day.dataset.day);
        days.has(k) ? days.delete(k) : days.add(k);
      }
      for (const a of alt) for (const k of [...a.days]) if (!days.has(k)) a.days.delete(k);
      drawDays();
      return drawAlt();
    }
    const ad = ev.target.closest('[data-alt-day]');
    if (ad) {
      const [k, i] = ad.dataset.altDay.split(':').map(Number);
      if (alt[k].days.has(i)) alt[k].days.delete(i);
      else {
        // A day is in one row only.
        alt.forEach(a => a.days.delete(i));
        alt[k].days.add(i);
      }
      return drawAlt();
    }
    if (ev.target.closest('[data-alt-add]')) {
      alt.push({ days: new Set(), time: '', back: '' });
      return drawAlt();
    }
    const del = ev.target.closest('[data-alt-del]');
    if (del) {
      alt.splice(Number(del.dataset.altDel), 1);
      return drawAlt();
    }
    if (ev.target.closest('[data-del]')) {
      ctx.data.saved = ctx.data.saved.filter(y => y.id !== edit.id);
      ctx.save();
      d.close();
      ctx.refreshTabs?.();
      return;
    }
    if (!ev.target.closest('[data-save]')) return;
    const clean = cleanSaved({
      id: edit?.id,
      picks: edit?.picks,
      name: d.querySelector('#st-name').value.trim() || to.name,
      from,
      to,
      time: d.querySelector('#st-time').value,
      by: d.querySelector('#st-by').value,
      days: [...days],
      back: d.querySelector('#st-back').value,
      alt: alt.map(a => ({ days: [...a.days], time: a.time, back: a.back }))
    });
    if (!clean) return;
    ctx.data.saved = edit ? ctx.data.saved.map(y => (y.id === edit.id ? clean : y)) : [...ctx.data.saved, clean];
    ctx.save();
    d.close();
    ctx.status(edit ? '已更新行程' : `已釘選「${clean.name}」，在「交通」看接下來的班次`);
    if (card) renderCard();
    ctx.refreshTabs?.();
  });
}
