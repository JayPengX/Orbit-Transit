// 地圖: the home tab. The map (Google's, or Taiwan's NLSC map past the
// month's cap) with what's around: YouBike stations with their bikes now
// (regular and 電輔車), every bus stop, 台鐵, 高鐵 and metro stations. Search
// for a place, tap anything for its card (a bike station's bikes and docks,
// a stop's buses, a station's next trains), and plan a trip there: from
// where you are (or any place: a pinned one, a search, a spot on the map),
// the recommendations first, then the rest; each one opens its steps and
// starts navigation.

import { createMap } from './map.mjs';
import { fitNumbers, netState } from '#kit/quadra.mjs';
import { searchPlaces, placeDetails, errorText, watchPosition, roadPath, walkTo, walksTo, walkKnown as walkKnownAt, PROXY, liveMs, bikeMs, onFresh } from './api.mjs';
import { cityBikes, bikeLevel } from './bike.mjs';
import { stationsNear, cityRoutes, BEARING, stopSides, stopGroups } from './bus.mjs';
import { railStations, metroSystems, traBoard, hsrBoard } from './raildata.mjs';
import { liveBoard, nextTrains, OPERATORS, stationTitle } from './metro.mjs';
import { planTrip } from './planner.mjs';
import { etaNear, liveTimes, officialLeg } from './live.mjs';
import { stationEta } from './near.mjs';
import { startNav, stopNav, navigating, canNav, NAV_LEAD, savedNav, mapsLink, mapsName, GOOGLE_ID, busPath, trainStops, navNow, setNavMin, navStopAt, navChangeOff, legEnd, wayText, stageView, navRetarget, navRest, navStops, navPickTimes, navCanPick, navOffer, onTimeWay, offerText, lateBy } from './nav.mjs';
import { setNavPush, setBikePush, notifyLocal } from './alerts.mjs';
import { rental, onRental, startRental, endRental, markWarned, rentalPush, swapDocks, FREE_MS, WARN_MS } from './rental.mjs';
import { railWay, railWayByStops, busWay } from './shapes.mjs';
import { bikeSwap } from './tpass.mjs';
import { pickSig, bikeTrip, finish, chainOn, keepBike, keepWins } from './plan.mjs';
import { addAlert, removeAlert, alertFor, onAlerts } from './alerts.mjs';
import { cleanPlace, cleanSaved, remember, tripKey, PLACE_ICONS, LAYERS, MAX_PLACES, MAX_SAVED } from './store.mjs';
import { sheet, sheetHead, icon, legChips, depChips, legColor, MODE_NAME, ago, timeRange } from './ui.mjs';
import { e, hm, minsText, distText, meters, decodeLine, uid, tw, twAt, addDays, walkSec, inTaiwan } from './util.mjs';
import { openRoute, strip, fitStrips, busWhen, plannedAt } from './bus-ui.mjs';
const plannedKey = r => `${r.routeUID}|${r.dir}|${r.stopUID}`;
import * as kit from '#kit/quadra.mjs';

const $ = id => document.getElementById(id);
const FALLBACK = { lat: 25.0478, lon: 121.517 }; // 台北車站
const VIEW_KEY = 'orbit-transit.view';
let ctx = null;
let map = null;
let card = null; // what the card shows: { kind, ... }
let me = null; // the device's dot
let stopWatch = () => {};
let following = false;
// The map placed: where it was left, at you, or where you went (arrive): the device's first fix doesn't move it then.
let centered = false;
let reopened = () => {};
let leftAt = Infinity;
const REOPEN_MS = 5 * 60_000;
globalThis.document?.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  leftAt = Date.now();
  pause();
});

// What other tabs use before the map was ever opened: saving and editing trips.
export function register(c) {
  ctx = c;
  // Other tabs open a trip here (交通's plans, 我的's saved trips). Set before
  // the map is made (the app opened on 交通): the trip waits for it.
  ctx.openTrip = (from, to, opts = {}) => {
    if (opts.at || opts.by) when = { by: opts.by === 'arrive' ? 'arrive' : opts.at ? 'depart' : 'now', at: opts.at || null };
    else when = { by: 'now', at: null };
    if (!map) pendingTrip = { from, to, opts };
    ctx.goTab('map');
    if (map) return plan(from, to, opts);
  };
  // 交通's one tap: that plan, navigated at once when it leaves within
  // NAV_LEAD; a later one only opens (its 開始導航 is there to tap).
  ctx.navPlan = (p, from, to) => {
    if (!map) pendingTrip = { nav: p, from, to };
    ctx.goTab('map');
    if (map) showPlan(p, from, to);
  };
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
  // (Never opened here before, nowhere known: where you are, briefly, not 台北車站's tiles first.)
  if (!ctx.here && !view) await Promise.race([ctx.locate(), wait(1500)]);
  const center = ctx.here || view || FALLBACK;
  const cfg = ctx.cfg?.map || { provider: 'nlsc' };
  try {
    map = await createMap($('map'), { provider: cfg.provider, key: cfg.key, center, zoom: view?.z || 16, onPick: pick, onTap: tap, onIdle: idle, onPlace: googlePlace, onDrag: dragged });
  } catch (err) {
    // (No connection the first time, before the phone kept the map: said plainly, not a script's address.)
    $('map').innerHTML = `<p class="ot-empty">${netState() === 'online' ? `地圖載入失敗：${e(err.message)}` : '沒有網路連線，地圖連上網路後載入'}</p>`;
    return isReady();
  }
  // Each opening, the map goes to where you are now once the phone says
  // (its first fresh fix, before the map was ready or after), as a phone's
  // own maps do: it opens where it was left or at the last fix kept, and
  // moves when the new one comes (it had stayed where it was left, so after
  // moving it opened somewhere else). Not when you've gone somewhere already
  // (a search picked, a finger on the map before the fix) or a ride is
  // being followed again (it keeps the trip in view).
  centered = centered || Boolean(savedNav());
  const arrived = here => {
    drawMe(here);
    nearBikes();
    if (!centered) {
      // (And keeps you in the middle as you move, as 我的位置 does, until a finger moves the map.)
      centered = true;
      map.setView(here.lat, here.lon, 16);
      follow();
    } else if (following) map.setView(here.lat, here.lon);
  };
  ctx.moved.push(arrived);
  reopened = () => {
    centered = false;
    ctx.locate().then(h => h && !centered && arrived(h));
  };
  if (ctx.here) arrived(ctx.here);
  else ctx.locate();
  wireSearch();
  drawChips();
  $('fab-locate').addEventListener('click', locateMe);
  $('fab-layers').addEventListener('click', layersSheet);
  $('card').addEventListener('click', cardClick);
  ctx.togglePick = togglePick;
  (ctx.onRefresh ||= []).push(() => {
    drawChips();
    if (card) renderCard();
  });
  onAlerts(() => card?.kind === 'bus' && renderCard());
  // (Opened on the counts kept on the phone: the new ones, once in, drawn over them.)
  onFresh(path => path.includes('Bike/Availability') && bikesAgain());
  // A YouBike rental timed: its chip ticking, its notice sent, the station's card saying what you can do there.
  onRental(() => {
    rentalTick();
    if (card?.kind === 'bike') renderCard();
  });
  rentalTick();
  $('near-bikes').addEventListener('click', ev => {
    const b = ev.target.closest('[data-nb]');
    const s = shownBikes.find(x => x.uid === b?.dataset.nb);
    if (s) arrive({ kind: 'bike', item: s, lat: s.lat, lon: s.lon });
  });
  idle();
  // A ride being followed when the app was swiped away: on with it.
  const was = savedNav();
  if (was) pendingTrip = { nav: was.plan, from: was.plan.legs[0].from, to: was.plan.legs.at(-1).to, resume: { i: was.i, reached: was.reached, phase: was.phase, min: Boolean(was.min) } };
  // (Started behind another tab, for a shrunk ride: only the ride, not the map's own refreshing.)
  if (pendingTrip) document.body.classList.contains('tab-map') ? show() : takePending();
  settle().finally(isReady);
}
let pendingTrip = null;

// The map's first screen finished, for the loading screen to lift onto
// (app.mjs, a few seconds at most): where you are now, the map's tiles,
// what's in view, and the strip of nearest stations in its order. Nothing
// pops in after it.
let isReady = () => {};
export const ready = new Promise(r => (isReady = r));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function settle() {
  const step = f => globalThis.__bootStep?.('', f);
  step(0.85);
  // What's in view asked now, beside the tiles (Google's map has no bounds
  // before its first frame: asked again after them, from the phone's copies).
  drawLayers();
  // A fresh fix, briefly (the one kept on the phone stands in after that).
  if (!ctx.here || Date.now() - (ctx.here.at || 0) > 60_000) await Promise.race([ctx.locate(), wait(1500)]);
  // (The tiles at most 1.5 s: on a poor connection the rest isn't held up by them.)
  await Promise.race([map.tiles(), wait(1500)]);
  step(0.92);
  // (As they stand after any move that fix made: the last drawing of each.)
  drawLayers();
  await Promise.race([Promise.all([drawn, nearDone]), wait(2500)]);
  await Promise.race([Promise.all([drawn, nearDone]), wait(500)]);
  step(1);
}
function showPlan(p, from, to, resume = null) {
  // (A ride being navigated goes on, shrunk to its bar, while this one opens: never both cards at once.)
  if (!resume && navFull()) shrinkNav(true);
  card = { kind: 'plans', from: { name: from?.name || '目前位置', lat: from?.lat, lon: from?.lon }, fromHere: !from || from.name === '目前位置', to, lat: to.lat, lon: to.lon, plans: [{ ...p, top: true, lead: true, weak: false, times: [] }], sel: 0, more: false, sources: {} };
  document.body.classList.add('ot-planning');
  // Navigated at once only when it's time to set out (or resumed); a plan
  // for later opens, to look at. A ride already being navigated (shrunk, you
  // went to 交通 to look at something else) isn't replaced by a tap: the plan
  // opens, and its 開始導航 is there.
  // (A ride resumed goes on even past its planned arrival: a late bus is still being ridden.)
  if (resume || (canNav(p) && !navigating() && p.dep - Date.now() <= NAV_LEAD)) {
    renderCard();
    drawPlan(p, { fit: false });
    return navigate(card.plans[0], resume);
  }
  card.sel = 0;
  renderCard();
  drawPlan(p, { fit: true });
}

// A trip another tab sent before the map was made (or a ride to go on with).
function takePending() {
  const t = pendingTrip;
  pendingTrip = null;
  return t.nav ? showPlan(t.nav, t.from, t.to, t.resume) : plan(t.from, t.to, t.opts);
}
export function show({ back = false } = {}) {
  map?.resize();
  // Back after a while with nothing open: an opening again, the map on where you are now.
  if (back && map && Date.now() - leftAt > REOPEN_MS && !card && !navFull() && !pendingTrip && !ctx.mapFocus) reopened();
  if (pendingTrip && map) return takePending();
  // Back to the app while navigating: the stage you're at again, once the page has its size.
  if (map && navFull()) setTimeout(() => {
    const n = navNow();
    if (n && navFollow && navFull()) navView(n.plan, n.i);
  }, 350);
  // A station sent from another tab (捷運's 在地圖上看).
  if (map && ctx.mapFocus) {
    const st = ctx.mapFocus;
    ctx.mapFocus = null;
    return arrive({ kind: st.sys, item: st, lat: st.lat, lon: st.lon });
  }
  if (card) refreshCard();
  bikesBeat();
}
// YouBike's counts read again while the map is seen (every 30 s, 開發's
// transitBike): the strip, the stations on the map and an open station's
// card, each number swapped in place (the owner, 2026-10-16: they stayed
// as they were when the map was drawn).
function bikesBeat() {
  nearBikes();
  clearInterval(bikeTimer);
  bikeTimer = setInterval(bikesAgain, bikeMs());
}
function bikesAgain() {
  if (document.visibilityState === 'hidden') return;
  nearBikes();
  if (map && ctx.data.layers.bike && map.zoom() >= 15 && !navFull()) drawLayers();
  if (card?.kind === 'bike') refreshCard();
}
export function hide() {
  // (An open search list doesn't follow you to another tab, or into navigation.)
  closeResults();
  stopWatch();
  following = false;
  pause();
}
// Nothing on the map read again while it isn't seen (another tab, the app
// away): show() reads the card and the strip again and starts them over.
function pause() {
  clearInterval(bikeTimer);
  clearInterval(cardTimer);
}

// ---- The YouBike stations nearest you, along the bottom of the map --------------------------------

let bikeTimer = 0;
let shownBikes = [];
let nearRun = 0;
// (Settled once the strip is drawn, or a newer one is: the loading screen waits on it.)
let nearDone = Promise.resolve();
function nearBikes() {
  nearDone = nearBikesNow();
  return nearDone;
}
async function nearBikesNow() {
  const box = $('near-bikes');
  const h = ctx.here;
  if (!box || !h || !ctx.data.layers.bike) return box && (box.hidden = true);
  // (Not shown navigating or looking at a trip: not asked then; show() asks again after.)
  if (navigating() || document.body.classList.contains('ot-planning')) return;
  const run = ++nearRun;
  const city = await ctx.cityOf(h.lat, h.lon);
  const list = city ? await cityBikes(city).catch(() => []) : [];
  if (run !== nearRun) return nearDone;
  const near = list
    .map(s => ({ s, d: meters(h.lat, h.lon, s.lat, s.lon) }))
    .filter(x => x.d <= 1000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  // Drawn once, in its order: each walk by the streets (walksFrom, one ask
  // for the five; kept on the phone, so a reopen has them at once); one not
  // in after 1.5 s by the straight line, until the next time.
  const asked = walksFrom(h, near.map(x => x.s));
  const ws = await Promise.race([asked, new Promise(r => setTimeout(() => r(near.map(x => walkKnown(h, x.s))), 1500))]);
  if (run !== nearRun) return nearDone;
  const rows = near.map((x, k) => ({ ...x, walk: ws[k] || { dist: Math.round(x.d), sec: walkSec(x.d) } })).sort((a, b) => a.walk.dist - b.walk.dist);
  shownBikes = rows.map(x => x.s);
  box.hidden = !rows.length;
  box.innerHTML = rows
    .map(
      ({ s, walk }) => `<button class="ot-nb ${bikeLevel(s)}" type="button" data-nb="${e(s.uid)}"><span class="ot-nb-top"><i class="ot-nb-i">${icon('bike')}</i><b>${e(s.name)}</b></span>
      <span class="ot-nb-n">${s.ok === false ? '<em>暫停營運</em>' : `<em>${s.bikes}</em><small>一般</small><em class="e">${s.ebike}</em><small>電輔</small><em class="d">${s.ret}</em><small>空位</small>`}</span>
      <small class="ot-nb-d">${icon('walk')} ${Math.max(1, Math.round(walk.sec / 60))} 分 · ${e(distText(walk.dist))}</small></button>`
    )
    .join('');
}
export const navOn = () => navigating();
// Navigating with its card on the map (not shrunk to the bar to do something else).
const navFull = () => navigating() && !navNow()?.min;

// ---- The device -------------------------------------------------------------------------------

function drawMe(h) {
  me = h;
  map?.layer('me').set([{ id: 'me', lat: h.lat, lon: h.lon, cls: 'me', z: 50, html: '<i class="ot-me"></i>' }]);
}
async function locateMe() {
  const h = await ctx.locate({ force: true });
  if (!h) return ctx.status('無法取得位置：請在設定允許定位');
  map.setView(h.lat, h.lon, Math.max(map.zoom(), 16));
  follow();
}
function follow() {
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
// (Settled once what's in view is drawn, or a newer drawing is: the loading screen waits on it.)
let drawn = Promise.resolve();
function drawLayers() {
  drawn = drawLayersNow();
  return drawn;
}
async function drawLayersNow() {
  const run = ++drawing;
  const jobs = [];
  const b = map.bounds();
  if (!b) return;
  const z = map.zoom();
  const c = map.center();
  const L = ctx.data.layers;
  // Navigating: only the way (its stops and stations are on it); the rest is in the way.
  if (navFull()) {
    for (const k of ['bike', 'bus', 'rail', 'metro', 'places']) map.layer(k).set([]);
    return;
  }
  drawPlaces();
  const city = await ctx.cityOf(c.lat, c.lon);
  if (run !== drawing) return drawn;
  // Looking at a trip: no other bikes or bus stops in the way of the way (its
  // own YouBike stations are the plan's: drawPlan).
  if (document.body.classList.contains('ot-planning') && card?.plans) {
    map.layer('bus').set([]);
    map.layer('bike').set([]);
    return;
  }
  // YouBike: the city's stations, the 200 nearest the middle.
  if (L.bike && z >= 15 && city) {
    jobs.push(cityBikes(city)
      .then(list => run === drawing && map.layer('bike').set(closest(list.filter(s => inView(b, s)), c, 200).map(bikeMarker)))
      .catch(() => {}));
  } else map.layer('bike').set([]);
  // Bus stops: around the middle, from a closer zoom.
  if (L.bus && z >= 16) {
    jobs.push(stationsNear(c.lat, c.lon)
      .then(list => run === drawing && map.layer('bus').set(closest(stopGroups(list.filter(s => inView(b, s))), c, 120).flatMap(g => busMarkers(g, z))))
      .catch(() => {}));
  } else map.layer('bus').set([]);
  if (L.rail && z >= 10) {
    jobs.push(railStations()
      .then(list => run === drawing && map.layer('rail').set(list.filter(s => inView(b, s, 0.01) && (s.sys === 'hsr' || z >= 12 || s.cls <= '1')).map(railMarker)))
      .catch(() => {}));
  } else map.layer('rail').set([]);
  if (L.metro && z >= 12) {
    jobs.push(metroSystems([b.s, b.w, b.n, b.e])
      .then(systems => run === drawing && map.layer('metro').set(systems.flatMap(s => s.stations.map(st => ({ st, color: s.lines.find(l => st.lines.includes(l.id))?.color }))).filter(x => inView(b, x.st, 0.005)).map(metroMarker)))
      .catch(() => {}));
  } else map.layer('metro').set([]);
  await Promise.all(jobs);
}

const bikeMarker = s => {
  const lv = bikeLevel(s);
  return { id: `bike:${s.uid}`, lat: s.lat, lon: s.lon, cls: `bike ${lv}`, z: 3, kind: 'bike', data: s, html: `${icon('bike')}<b>${s.ok === false ? '停' : s.bikes}</b>${s.ebike ? `<i>⚡${s.ebike}</i>` : ''}` };
};
const busMarker = s => ({ id: `bus:${s.uid}`, lat: s.lat, lon: s.lon, cls: 'bus', z: 2, kind: 'bus', data: s, html: icon('bus') });
// A stop with a side on each side of the street, close in (zoom 17 on): a
// marker for each side (its signs by the way their buses go: stopSides),
// each opening that side's card, only the buses taken there. Further out:
// one, between them, its card every bus under each side's way.
const SIDES_ZOOM = 17;
function busMarkers(group, z) {
  const sides = z >= SIDES_ZOOM ? stopSides(group.group || [group]) : [];
  if (sides.length < 2) return [busMarker(group)];
  return sides.map(s => ({ ...busMarker(s), cls: 'bus side' }));
}
const railMarker = s => ({ id: s.key, lat: s.lat, lon: s.lon, cls: `rail ${s.sys}`, z: 4, kind: s.sys, data: s, html: `${icon(s.sys === 'hsr' ? 'hsr' : 'tra')}<span>${e(s.name)}</span>` });
const metroMarker = ({ st, color }) => ({ id: st.key, lat: st.lat, lon: st.lon, cls: 'metro', z: 4, kind: 'metro', data: st, html: `<i style="--c:${e(color || '#3b82f6')}"></i><span>${e(st.name)}</span>` });

// ---- Taps ----------------------------------------------------------------------------------------

function pick(it) {
  // Navigating: the map is to look at; a tap opens nothing (it would take the trip's card and its way off the map).
  if (navFull()) return dragged();
  following = false;
  openCard({ kind: it.kind, item: it.data, lat: it.lat, lon: it.lon, marker: it });
  focusAbove(it);
}
// The tapped stop or station brought to the middle of the map left above
// its card (the card came up over it), once the card has its height.
function focusAbove(p) {
  requestAnimationFrame(() => {
    const el = $('card');
    if (!card || el.hidden) return;
    const box = $('map').getBoundingClientRect();
    const top = Math.max(box.top, ($('map-search')?.getBoundingClientRect().bottom || box.top) + 8);
    const bottom = Math.min(box.bottom, el.getBoundingClientRect().top);
    // The map's middle down to the middle of what's left in view.
    if (bottom - top > 80) map.focus?.(p.lat, p.lon, (box.top + box.bottom) / 2 - (top + bottom) / 2);
  });
}
// An empty spot: closes the card, or marks the spot (to plan a trip there).
async function tap(pt) {
  if (navFull()) return dragged();
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
  if (navFull()) return dragged();
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
// The dropped pin of a place or a spot on the map (not a marker's), while its card is open.
let selDrop = null;
// (Taiwan only: a spot or a place outside it, the coast of Fujian beside 金門, isn't one.)
const OUTSIDE = '只支援台灣（含澎湖、金門、馬祖）的地點';
function openCard(c) {
  if (c.lat != null && !inTaiwan(c.lat, c.lon)) return ctx.status(OUTSIDE);
  const planned = document.body.classList.contains('ot-planning');
  document.body.classList.remove('ot-planning');
  if (planned) setTimeout(drawLayers, 0);
  const { marker, ...rest } = c;
  card = { ...rest, at: Date.now() };
  // A marker tapped shows itself selected; a spot or a place without one gets the pin.
  map.select(marker || null);
  selDrop = marker || c.lat == null ? null : { lat: c.lat, lon: c.lon };
  map.layer('sel').set(selDrop ? [{ id: 'sel', lat: c.lat, lon: c.lon, cls: 'sel', z: 40, html: '<i class="ot-drop-shadow"></i><i class="ot-drop"></i>' }] : []);
  renderCard();
  refreshCard();
}
function closeCard() {
  const planned = document.body.classList.contains('ot-planning');
  card = null;
  selDrop = null;
  document.body.classList.remove('ot-planning');
  // (The bikes and stops a trip hid: back.)
  if (planned) drawLayers();
  clearInterval(cardTimer);
  $('card').hidden = true;
  $('card').className = 'ot-card';
  map.layer('sel').set([]);
  map.select(null);
  map.lines('plan', []);
  planDraw++;
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
      } else if (c.kind === 'bus') {
        // Every bus through the stop (both sides of the street), once each way.
        const all = await stationEta(c.item.group || [c.item]);
        const seen = new Set();
        // Which way each goes (往 the route's last stop that way).
        const routes = new Map((await Promise.all([...new Set(all.map(r => r.city))].map(ct => cityRoutes(ct).catch(() => [])))).flat().map(r => [r.uid, r]));
        c.live = all
          .filter(r => !seen.has(`${r.routeUID}|${r.dir}`) && seen.add(`${r.routeUID}|${r.dir}`))
          .map(r => ({ ...r, toward: (Number(r.dir) === 1 ? routes.get(r.routeUID)?.from : routes.get(r.routeUID)?.to) || '' }));
        // No bus on its way: the timetable's next there, as 交通 and 查時刻
        // say it (kept on the card: its refreshes don't ask again).
        c.planned ||= new Map();
        const todo = c.live.filter(r => !(r.status === 0 && r.sec != null) && !c.planned.has(plannedKey(r)));
        for (const r of todo) c.planned.set(plannedKey(r), null);
        if (todo.length) Promise.all(todo.map(r => plannedAt(r, c.item).then(p => c.planned.set(plannedKey(r), p), () => {}))).then(() => card === c && renderCard());
      }
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
  if (card && card.kind !== 'plans' && card.kind !== 'place' && card.kind !== 'point') cardTimer = setInterval(load, liveMs());
}

// A card's place as a trip's end; one of Google's carries its id (Google Maps' own navigation goes to the place itself).
const placeOf = c => ({ name: c.item.name || '', lat: c.item.lat ?? c.lat, lon: c.item.lon ?? c.lon, ...(c.kind === 'place' && (c.item.gid || GOOGLE_ID.test(c.item.id || '')) ? { gid: c.item.gid || c.item.id } : {}) });
// Walking from where you are to a spot: one walk for the strip of nearest
// stations, a card's 距離 and 走過去, and the walk it starts (api walksTo:
// Google's streets). From where you were when it was last asked, until
// you're 50 m from there: every one of them from the same spot, so they
// agree, and Google is asked once each 50 m, not each step.
let anchor = null;
const fromHere = h => {
  if (!anchor || meters(anchor.lat, anchor.lon, h.lat, h.lon) > 20) anchor = { lat: Math.round(h.lat * 1e5) / 1e5, lon: Math.round(h.lon * 1e5) / 1e5 };
  return anchor;
};
const walkKnown = (h, p) => walkKnownAt(fromHere(h), p);
const walkFrom = (h, p, { line = false } = {}) => walkTo(fromHere(h), p, { line }).catch(() => null);
const walksFrom = (h, list) => walksTo(fromHere(h), list).catch(() => list.map(() => null));
// A trip that's only a walk from where you are says what the strip and the
// card say for it (the planner's own walk may be from a few metres off, or
// OpenStreetMap's): the one walk, its length and time. (`walkHereNow`: only
// what's known already.)
const onlyWalkHere = p => ctx.here && p.legs.length === 1 && p.legs[0].mode === 'walk' && p.legs[0].from?.lat != null && meters(ctx.here.lat, ctx.here.lon, p.legs[0].from.lat, p.legs[0].from.lon) < 50;
const asWalk = (p, w) => {
  const l = p.legs[0];
  return w ? finish({ ...p, legs: [{ ...l, dist: w.dist, dur: w.sec, arr: l.dep + w.sec * 1000 }] }) : p;
};
const walkHereNow = plans => plans.map(p => (onlyWalkHere(p) ? asWalk(p, walkKnown(ctx.here, p.legs[0].to)) : p));
async function walkHere(plans) {
  const ws = await Promise.all(plans.map(p => (onlyWalkHere(p) ? Promise.race([walkFrom(ctx.here, p.legs[0].to), wait(1500)]) : null)));
  return plans.map((p, k) => (ws[k] ? asWalk(p, ws[k]) : p));
}
// To a stop (or a bike station) on foot or by YouBike only, navigated at once.
function goThere(c, { bike = true } = {}) {
  const h = ctx.here;
  if (!h) return '';
  const d = meters(h.lat, h.lon, c.lat, c.lon);
  if (d < 40 || d > 8000) return '';
  const w = walkKnown(h, c);
  if (!w) walkFrom(h, c).then(x => x && card === c && renderCard());
  const walkMin = Math.max(1, Math.round((w ? w.sec : walkSec(d)) / 60));
  return `<div class="ot-go-there"><button class="q-btn" type="button" data-card="walk-there">${icon('walk')} 走過去 · ${walkMin} 分</button>${bike && d > 600 ? `<button class="q-btn" type="button" data-card="bike-there">${icon('bike')} 騎 YouBike</button>` : ''}</div>`;
}
async function directTo(c, mode) {
  const h = await ctx.locate();
  if (!h) return ctx.status('需要你的位置：請在設定允許定位');
  const from = { name: '目前位置', lat: h.lat, lon: h.lon };
  const to = { name: c.item.name || '目的地', lat: c.lat, lon: c.lon };
  const now = Date.now();
  let legs;
  if (mode === 'walk') {
    // (The walk its button said: walkFrom.)
    const w = await walkFrom(h, to, { line: true });
    const dist = w?.dist || Math.round(meters(h.lat, h.lon, c.lat, c.lon) * 1.3);
    const dur = w?.sec || walkSec(dist / 1.3);
    legs = [{ mode: 'walk', from, to, dist, dur, dep: now, arr: now + dur * 1000, poly: w?.poly, fmt: '', road: Boolean(w?.poly) }];
  } else {
    const city = await ctx.cityOf(h.lat, h.lon);
    const bikes = city ? await cityBikes(city).catch(() => []) : [];
    legs = bikeTrip(from, to, bikes, now, { first: true });
    if (!legs) return ctx.status('附近沒有 YouBike 站');
  }
  showPlan(finish({ src: mode, legs, tags: [] }), from, to);
}
function actions(c, { pin = true } = {}) {
  const pinned = ctx.data.places.find(p => meters(p.lat, p.lon, c.lat, c.lon) < 30);
  return `<div class="ot-card-acts">
    <button class="q-btn primary" type="button" data-card="go">${icon('route')} 路線</button>
    ${pin ? (pinned ? `<button class="q-btn on" type="button" data-card="edit-pin" data-id="${e(pinned.id)}">${icon('star')} 已釘選</button>` : `<button class="q-btn" type="button" data-card="pin">${icon('star')} 釘選</button>`) : ''}
  </div>`;
}
function head(title, sub, badge = '') {
  // (Walking, by the streets once known: what 走過去 and the strip say.)
  const d = ctx.here && card ? distText(walkKnown(ctx.here, card)?.dist ?? meters(ctx.here.lat, ctx.here.lon, card.lat, card.lon)) : '';
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
      <p class="ot-note">${s.ok === false ? '暫停營運 · ' : ''}${s.cap ? `共 ${s.cap} 柱 · ` : ''}${e(ago(s.at))}</p>${err}${goThere(c, { bike: false })}${rentButtons()}${actions(c)}`;
  } else if (c.kind === 'bus') {
    const s = c.item;
    const live = Array.isArray(c.live) ? c.live : null;
    // Both sides of the street on one card (from further out): each side's
    // buses under its way (往北), the nearer bus first within it.
    const sides = (s.group?.length || 0) > 1 ? stopSides(s.group) : [];
    const sideOf = r => (sides.length > 1 ? Math.max(0, sides.findIndex(x => x.group.some(st => st.uid === r.st?.uid))) : 0);
    const rowsHtml = live
      ? live
          .map(r => ({ r, t: busWhen(r, c.planned?.get(plannedKey(r))), side: sideOf(r) }))
          .sort((a, b) => a.side - b.side || (a.r.sec ?? 1e9) - (b.r.sec ?? 1e9))
          .map(({ r, t, side }, i, all) => {
            const heading = sides.length > 1 && (i === 0 || all[i - 1].side !== side) ? `<p class="ot-eta-side">${e(BEARING[sides[side].bearing] || '另一側')}</p>` : '';
            const al = alertFor(r.st || s, r.routeUID, r.dir);
            return `${heading}<div class="ot-strip">${strip({ no: r.route, main: r.toward ? `往 ${e(r.toward)}` : '', eta: { ...t, sub: al ? `${al.min} 分前提醒你` : t.sub }, attrs: `data-route="${e(r.route)}" data-city="${e(r.city)}" data-route-uid="${e(r.routeUID)}" data-stop="${e(r.stopUID)}" data-dir="${r.dir}"` })}<button class="q-icon-btn ot-bell ot-strip-act${al ? ' on' : ''}" type="button" data-alert="${e(JSON.stringify({ uid: (r.st || s).uid, routeUID: r.routeUID, route: r.route, dir: r.dir, stop: r.stopUID }))}" aria-label="到站提醒">${icon('bell')}</button></div>`;
          })
          .join('') || '<p class="ot-note">這個站牌現在沒有公車資料。</p>'
      : '<p class="ot-note">載入中…</p>';
    html = `${head(s.name, [sides.length > 1 ? '' : BEARING[s.bearing], s.routes.length ? `${s.routes.length} 條路線` : ''].filter(Boolean).join(' · '), `<span class="ot-badge bus">${icon('bus')}</span>`)}${err}${goThere(c)}<div class="ot-eta-list">${rowsHtml}</div><p class="ot-note">按 ${icon('bell')} 設定到站提醒：公車快到時通知你一次。</p>${actions(c)}`;
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
  // A long station name shrinks to its row (never a second row, never cut).
  fitNumbers([...box.querySelectorAll('.ot-bike-name')]);
  fitStrips(box);
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
  // A step's Google (or Apple) Maps link sits inside its plan's button: it opens the app, never selects the plan.
  const gm = ev.target.closest('[data-maps]');
  if (gm) return void window.open(gm.dataset.maps, '_blank', 'noopener');
  const act = ev.target.closest('[data-card]')?.dataset.card;
  const bell = ev.target.closest('[data-alert]');
  if (bell && card?.kind === 'bus') return alertSheet(card, JSON.parse(bell.dataset.alert));
  const routeBtn = ev.target.closest('[data-route]');
  if (routeBtn) {
    const d = routeBtn.dataset;
    return openRoute(ctx, { uid: d.routeUid, name: d.route, city: d.city }, { stopUID: d.stop, dir: Number(d.dir) });
  }
  // 開始導航 sits inside its plan's button: it goes first.
  if (act === 'nav' && card) return canNav(card.plans?.[card.sel]) && navigate(card.plans[card.sel]);
  if (act === 'pick' && card) return togglePick(card, card.plans?.[card.sel]);
  // Another departure of the same route: that one shown (and opened) on its card.
  const dep = ev.target.closest('[data-dep]');
  if (dep && card?.plans) {
    const j = Number(dep.dataset.dep);
    card.choice = { ...(card.choice || {}), [dep.dataset.lead]: j };
    card.sel = -1;
    return selectPlan(j);
  }
  const planBtn = ev.target.closest('[data-plan]');
  if (planBtn) return selectPlan(Number(planBtn.dataset.plan));
  // A way of moving on or off for this search (never all of them), and plan again.
  const mode = ev.target.closest('[data-mode]');
  if (mode && card?.kind === 'plans') {
    const next = { ...modesNow(), [mode.dataset.mode]: modesNow()[mode.dataset.mode] === false };
    if (!Object.values(next).some(Boolean)) return;
    const same = Object.keys(MODE_CHIP).every(k => next[k] === (ctx.data.prefs.modes[k] !== false));
    tripModes = same ? null : next;
    return plan(card.fromHere ? null : card.from, card.to);
  }
  const pickWhen = ev.target.closest('[data-when]');
  if (pickWhen) return setWhen(pickWhen.dataset.when);
  if (!act || !card) return;
  if (act === 'close') return closeCard();
  if (act === 'grow') {
    $('card').classList.toggle('grown');
    return $('card').classList.toggle('tall', $('card').classList.contains('grown'));
  }
  // From where you are; the start can be changed on the plan.
  // A new trip: from now (a time picked is for the trip it was picked for, not the next one: 2026-10-12).
  if (act === 'go') {
    when = { by: 'now', at: null };
    return plan(null, placeOf(card));
  }
  if (act === 'pin') return pinSheet(placeOf(card));
  if (act === 'rent-start' || act === 'rent-swap') {
    const s = card.live || card.item;
    startRental(s);
    return ctx.status(act === 'rent-swap' ? `換了一台：重新計時${bikeSwap(ctx.data.prefs) ? '，又有 30 分鐘免費' : ''}` : `開始計時：${s.name} 借車`);
  }
  if (act === 'rent-end') {
    const r = rental();
    endRental();
    return ctx.status(r ? `已還車，騎了 ${rentClock(Date.now() - r.at)}` : '已還車');
  }
  if (act === 'walk-there' || act === 'bike-there') return directTo(card, act === 'walk-there' ? 'walk' : 'bike');
  if (act === 'edit-pin') return ctx.editPlace?.(ev.target.closest('[data-id]').dataset.id);
  if (act === 'back') return card.back ? openCard(card.back) : closeCard();
  // (With stops: the trip backwards, the last place first.)
  if (act === 'swap') {
    if (card.from?.lat == null) return;
    const all = [card.to, ...(card.then || [])];
    if (all.length === 1) return plan(card.to, card.fromHere ? null : card.from, { swapHere: card.fromHere });
    // From the last place, through the stops in reverse, back to the start (where you are, if it was that).
    const back = [...all.slice(0, -1).reverse(), card.fromHere ? await hereNow() : card.from].filter(x => x?.lat != null);
    return plan(all.at(-1), back[0], { then: back.slice(1) });
  }
  // 加一站: another place after the last; the trip goes on to it once there.
  if (act === 'stop-add') {
    const c = card;
    const pt = await pickPoint('加一站：之後再去哪裡', { onMap: false });
    if (!pt || card !== c || pt.here) return;
    return plan(c.fromHere ? null : c.from, c.to, { then: [...(c.then || []), pt] });
  }
  // A later stop tapped: go there first (it and the first one change places).
  if (act === 'stop-first') {
    const k = Number(ev.target.closest('[data-k]').dataset.k);
    const c = card;
    const rest = [...c.then];
    const [first] = rest.splice(k, 1, c.to);
    return plan(c.fromHere ? null : c.from, first, { then: rest });
  }
  if (act === 'stop-drop') {
    const k = Number(ev.target.closest('[data-k]').dataset.k);
    const c = card;
    return plan(c.fromHere ? null : c.from, c.to, { then: c.then.filter((_, i) => i !== k) });
  }
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
    if (act === 'edit-from') return plan(pt.here ? null : pt, c.to, { then: c.then });
    return plan(keepFrom, pt.here ? await hereNow() : pt, { then: c.then });
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

// 到站提醒: when the bus is this many minutes away, once.
function alertSheet(c, x) {
  const st = (c.item.group || [c.item]).find(s => s.uid === x.uid) || c.item;
  const on = alertFor(st, x.routeUID, x.dir);
  const d = sheet(`${sheetHead(`${e(x.route)} 到站提醒`, e(st.name))}
    <p class="ot-note">公車還有幾分鐘到站時通知你（一次）：</p>
    <div class="q-chips ot-alert-min">${[2, 3, 5, 8, 10, 15].map(m => `<button class="q-chip" type="button" data-min="${m}" aria-pressed="${on?.min === m}">${m} 分</button>`).join('')}</div>
    <p class="ot-note">App 開著時每 20 秒看一次公車的即時位置；手機鎖著或 App 關著時，由伺服器每 2 分鐘看一次再通知你（iPhone 要先把 App 加到主畫面並允許通知）。</p>
    ${on ? '<div class="ot-row ot-actions"><button class="q-btn" type="button" data-off="1">取消提醒</button></div>' : ''}`);
  d.addEventListener('click', ev => {
    const m = ev.target.closest('[data-min]');
    if (m) {
      addAlert({ station: st, routeUID: x.routeUID, route: x.route, dir: x.dir, min: Number(m.dataset.min), stopUID: x.stop });
      ctx.status(`${x.route} 到站前 ${m.dataset.min} 分鐘會提醒你`);
    } else if (ev.target.closest('[data-off]')) removeAlert(on.id);
    else return;
    d.close();
    if (card) renderCard();
  });
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
    // 最近: one forgotten, or all of them.
    const del = ev.target.closest('[data-del-recent]');
    if (del || ev.target.closest('[data-clear-recent]')) {
      ev.preventDefault();
      ctx.data.trips = del ? ctx.data.trips.filter(x => tripKey(x) !== del.dataset.delRecent) : [];
      ctx.save();
      return showResults(input.value);
    }
    const b = ev.target.closest('[data-res]');
    if (b) chooseResult(JSON.parse(b.dataset.res));
  });
  const showResults = async (text, n = ask) => {
    const t = text.trim();
    const box = $('results');
    box.hidden = false;
    // Nothing typed: your places, then what you looked up lately (each one forgettable).
    if (!t) {
      const places = ctx.data.places;
      const recent = ctx.data.trips.slice(0, 8);
      box.innerHTML =
        (places.length ? `<h4 class="ot-res-h">釘選地點</h4><div class="ot-res-places">${places.map(p => `<button class="ot-res-place" type="button" data-res="${e(JSON.stringify({ kind: 'place', icon: p.icon, name: p.name, sub: p.address || '我的地點', lat: p.lat, lon: p.lon, gid: p.gid }))}"><i>${PLACE_ICONS[p.icon] || '📍'}</i><span>${e(p.name)}</span></button>`).join('')}</div>` : '') +
        (recent.length
          ? `<h4 class="ot-res-h">最近<button class="ot-res-clear" type="button" data-clear-recent="1">全部清除</button></h4>${recent
              .map(x => `<div class="ot-res-w">${resultRow({ kind: 'trip', name: x.name || '地圖上的位置', sub: ctx.here ? distText(meters(ctx.here.lat, ctx.here.lon, x.lat, x.lon)) : '', lat: x.lat, lon: x.lon, gid: x.gid })}<button class="q-icon-btn ot-res-del" type="button" data-del-recent="${e(tripKey(x))}" aria-label="刪除這筆">${icon('x')}</button></div>`)
              .join('')}`
          : '') || '<p class="ot-note">搜尋地點、地址、車站。找過的地方會留在這裡。</p>';
      return;
    }
    const local = await localMatches(t);
    const draw = remote =>
      (box.innerHTML = [...local.map(r => resultRow(r)), ...(remote || []).map(r => resultRow(r))].join('') || (remote ? '<p class="ot-note">找不到符合的地點</p>' : '<p class="ot-note">搜尋中…</p>'));
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
      if (v && !v.here && v.lat != null && !inTaiwan(v.lat, v.lon)) return ctx.status(OUTSIDE);
      if (done) return;
      done = true;
      d.close();
      resolve(v);
    };
    const session = uid() + uid();
    const d = sheet(`${sheetHead(e(title))}
      <form class="ot-pick-form" autocomplete="off"><label class="q-search ot-search-in"><input id="pp-q" type="search" inputmode="search" placeholder="地點、地址、車站" enterkeyhint="search"><button class="q-search-clear" type="button" aria-label="清除">✕</button></label></form>
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
          return finish({ name: r.name, lat: p.lat, lon: p.lon, gid: r.id });
        } catch (err) {
          return (box.innerHTML = `<p class="ot-note bad">${e(errorText(err))}</p>`);
        }
      }
      if (Number.isFinite(r.lat)) finish({ name: r.name, lat: r.lat, lon: r.lon, ...(r.gid ? { gid: r.gid } : {}) });
    });
    draw();
    setTimeout(() => input.focus(), 50);
  });
}

// Pinned places, recent trips and stations matching (no network).
async function localMatches(t) {
  const norm = s => String(s || '').replace(/台/g, '臺');
  const T = norm(t);
  const places = ctx.data.places.filter(p => !T || norm(p.name).includes(T)).map(p => ({ kind: 'place', icon: p.icon, name: p.name, sub: p.address || '我的地點', lat: p.lat, lon: p.lon, gid: p.gid }));
  const trips = T ? [] : ctx.data.trips.slice(0, 5).map(x => ({ kind: 'trip', name: x.name || '最近的目的地', sub: '最近', lat: x.lat, lon: x.lon, gid: x.gid }));
  let stations = [];
  if (T) {
    const rail = await railStations().catch(() => []);
    // Metro stations of the systems loaded already and those around you.
    if (ctx.here) await metroSystems(ctx.here).catch(() => []);
    const metro = (await metroSystems().catch(() => [])).flatMap(s => s.stations);
    // Nearest first (竹北 before 北竹).
    const c = ctx.here || map?.center();
    stations = [...rail, ...metro]
      .filter(s => norm(s.name).includes(T.replace(/(車站|站)$/, '')))
      .map(s => ({ s, d: c ? meters(c.lat, c.lon, s.lat, s.lon) : 0, exact: norm(s.name) === T.replace(/(車站|站)$/, '') }))
      .sort((a, b) => b.exact - a.exact || a.d - b.d)
      .map(x => ({ ...x.s, dist: c ? x.d : null }))
      .slice(0, 6)
      .map(s => ({ kind: s.sys, key: s.key, id: s.id, op: s.op, name: s.sys === 'hsr' ? `高鐵${s.name}站` : s.sys === 'tra' ? `${s.name}車站` : stationTitle(s.name), sub: s.sys === 'metro' ? OPERATORS[s.op] : s.sys === 'hsr' ? '台灣高鐵' : '台鐵', lat: s.lat, lon: s.lon, dist: s.dist }));
  }
  return [...places, ...trips, ...stations].slice(0, 12);
}

async function chooseResult(r) {
  closeResults();
  const known = p => {
    ctx.data.trips = remember(ctx.data.trips, { name: p.name, lat: p.lat, lon: p.lon, t: Date.now(), ...(p.gid ? { gid: p.gid } : {}) }, tripKey, 10);
    ctx.save();
  };
  if (Number.isFinite(r.lat) && r.kind !== 'place') known(r);
  $('q').value = r.name;
  $('q-clear').hidden = false;
  if (r.kind === 'google') {
    try {
      const d = await placeDetails(r.id, { session: searchSession });
      searchSession = '';
      known({ name: r.name, lat: d.lat, lon: d.lon, gid: r.id });
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
  arrive({ kind: 'place', item: { name: r.name, sub: r.sub, lat: r.lat, lon: r.lon, gid: r.gid }, lat: r.lat, lon: r.lon });
}
// Going to a place you picked (a search, a pinned place, a station): the map
// stays there, not pulled back to you by the next fix (it was, after a
// relaunch, the first fix coming late, or with 我的位置 still following).
function arrive(c) {
  following = false;
  centered = true;
  map.setView(c.lat, c.lon, Math.max(map.zoom(), 16));
  openCard(c);
}

// ---- Pinned places ---------------------------------------------------------------------------------

// On the map at every zoom (their icon and name), a tap opening the place's card, as its chip does.
const placeCard = p => ({ kind: 'place', item: { name: p.name, sub: p.address, lat: p.lat, lon: p.lon, pin: p.id, gid: p.gid }, lat: p.lat, lon: p.lon });
export const placeMarker = p => ({ id: `place:${p.id}`, lat: p.lat, lon: p.lon, cls: 'place', z: 6, kind: 'place', data: placeCard(p).item, html: `<i>${PLACE_ICONS[p.icon] || '📍'}</i><span>${e(p.name)}</span>` });
function drawPlaces() {
  map?.layer('places').set(navFull() ? [] : ctx.data.places.map(placeMarker));
}

// ---- A YouBike rental timed (rental.mjs) -------------------------------------------------------------

const rentClock = ms => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分`;
};
// The chip first in the row above the map: how long you've had it; with
// TPASS, the free minutes left (amber the last 5, red past them).
function rentalChip() {
  const r = rental();
  if (!r) return '';
  const ms = Date.now() - r.at;
  const swap = bikeSwap(ctx.data.prefs);
  const left = FREE_MS - ms;
  const cls = swap ? (left <= 0 ? ' over' : ms >= WARN_MS ? ' warn' : '') : '';
  return `<button class="q-chip ot-rent-chip${cls}" type="button" data-chip="rental" aria-label="YouBike 計時">${icon('bike')}<b>${e(rentClock(ms))}</b>${swap ? `<small>${left > 0 ? `免費剩 ${Math.ceil(left / 60_000)} 分` : '已過 30 分'}</small>` : ''}</button>`;
}
let rentTimer = 0;
function rentalTick() {
  const r = rental();
  const swap = bikeSwap(ctx.data.prefs);
  setBikePush(rentalPush(r, swap));
  clearInterval(rentTimer);
  rentTimer = 0;
  const paint = () => {
    const chip = $('map-chips').querySelector('[data-chip="rental"]');
    const html = rentalChip();
    if (chip && html) chip.outerHTML = html;
    else drawChips();
    const now = rental();
    if (now && swap && !now.warned && Date.now() - now.at >= WARN_MS) {
      markWarned();
      notifyLocal('YouBike 已騎 25 分鐘', '5 分鐘內還車再借一台，下一段仍免費（點地圖上的計時看附近的站）', `transit:bike:${now.at}`);
    }
  };
  // (The timer first: a notice marked from paint redraws through here.)
  if (r) rentTimer = setInterval(paint, 20_000);
  paint();
}
// On a station's card: 我在這裡借車了, or (renting) 在這裡還車 and, with TPASS, 在這裡換一台.
function rentButtons() {
  const r = rental();
  return `<div class="ot-go-there">${
    r
      ? `<button class="q-btn" type="button" data-card="rent-end">${icon('dock')} 在這裡還車</button>${bikeSwap(ctx.data.prefs) ? `<button class="q-btn" type="button" data-card="rent-swap">${icon('bike')} 在這裡換一台</button>` : ''}`
      : `<button class="q-btn" type="button" data-card="rent-start">${icon('bike')} 我在這裡借車了</button>`
  }</div>`;
}
// The timer's sheet: since when, until when it's free, and (TPASS) the
// stations near you to return it at and take another, the way you're
// going first; one tapped opens on the map.
async function rentalSheet() {
  const r = rental();
  if (!r) return drawChips();
  const swap = bikeSwap(ctx.data.prefs);
  const d = sheet(`${sheetHead('YouBike 計時', e(`${hm(r.at)} 借車${r.station?.name ? `・${r.station.name}` : ''}`))}<div class="ot-rent-body"></div>`);
  const body = d.querySelector('.ot-rent-body');
  let near = [];
  const paint = (loading = false) => {
    const ms = Date.now() - r.at;
    const free = swap ? (FREE_MS - ms > 0 ? `免費到 ${hm(r.at + FREE_MS)}` : '已超過免費的 30 分鐘') : '';
    const docks = !swap
      ? ''
      : `<h4 class="ot-res-h">還車再借一台，又有 30 分鐘免費</h4>${
          loading ? '<p class="ot-note">找附近的站…</p>' : near.length ? near.map(({ s, d: m }) => `<button class="ot-row-btn" type="button" data-rent-st="${e(s.uid)}">${icon('dock')}<span><b>${e(s.name)}</b><small>${e(distText(m))}・空位 ${s.ret}・可借 ${s.bikes + (s.ebike || 0)}</small></span></button>`).join('') : `<p class="ot-note">${ctx.here ? '附近 800 公尺內沒有可還又可借的站' : '需要你的位置，才找得到附近的站'}</p>`
        }`;
    body.innerHTML = `<p class="ot-rent-now"><b>${e(rentClock(ms))}</b>${free ? `<span>${e(free)}</span>` : ''}</p>${docks}<div class="ot-rent-acts"><button class="q-btn" type="button" data-rent="swap">換了一台</button><button class="q-btn primary" type="button" data-rent="end">已還車</button></div>`;
  };
  paint(swap);
  d.addEventListener('click', ev => {
    const b = ev.target.closest('[data-rent]');
    if (b) {
      d.close();
      if (b.dataset.rent === 'end') {
        endRental();
        ctx.status(`已還車，騎了 ${rentClock(Date.now() - r.at)}`);
      } else {
        startRental(r.station);
        ctx.status(`換了一台：重新計時${swap ? '，又有 30 分鐘免費' : ''}`);
      }
      return;
    }
    const st = near.find(x => x.s.uid === ev.target.closest('[data-rent-st]')?.dataset.rentSt)?.s;
    if (st) {
      d.close();
      arrive({ kind: 'bike', item: st, lat: st.lat, lon: st.lon });
    }
  });
  if (!swap) return;
  try {
    const h = ctx.here;
    const city = h && (await ctx.cityOf(h.lat, h.lon));
    const list = city ? await cityBikes(city).catch(() => []) : [];
    // (Navigating: the way you're going.)
    const n = navNow();
    near = swapDocks(h, list, { toward: n?.plan?.dest || n?.plan?.legs?.at(-1)?.to || null });
  } catch {}
  if (d.open) paint();
}

function drawChips() {
  drawPlaces();
  $('map-chips').innerHTML =
    rentalChip() +
    ctx.data.places.map(p => `<button class="q-chip" type="button" data-place="${e(p.id)}">${PLACE_ICONS[p.icon] || '📍'} ${e(p.name)}</button>`).join('') +
    `<button class="q-chip ot-chip-muted" type="button" data-chip="pin">${icon('plus')} 釘選地點</button>`;
  $('map-chips').onclick = ev => {
    if (ev.target.closest('[data-chip="rental"]')) return rentalSheet();
    const pl = ev.target.closest('[data-place]');
    if (pl) {
      const p = ctx.data.places.find(x => x.id === pl.dataset.place);
      if (p) arrive({ ...placeCard(p), marker: placeMarker(p) });
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
// This search's ways of moving (the chips under the time; 我的 → 交通偏好 is
// only where they start): null until one is changed, kept for the next search.
let tripModes = null;
const modesNow = () => ({ ...ctx.data.prefs.modes, ...(tripModes || {}) });
// A trip from `from` (null: where you are) to `to`. `opts.swapHere`: the
// trip turned round, ending where you are.
async function plan(from, to, opts = {}) {
  if (!map) {
    pendingTrip = { from, to, opts };
    return;
  }
  // (A ride being navigated goes on, shrunk, while you look; starting another replaces it.)
  if (navFull()) shrinkNav(true);
  const here = !from ? await hereNow() : null;
  const start = from || here;
  const dest = opts.swapHere ? await hereNow() : to;
  const fromPt = start ? { name: start.name || '目前位置', lat: start.lat, lon: start.lon } : { name: '選擇出發地', lat: null, lon: null };
  if (!dest) return ctx.status('需要你的位置：請在設定允許定位');
  if (dest.lat != null && !inTaiwan(dest.lat, dest.lon)) return ctx.status(OUTSIDE);
  // `then`: the places after this one, in order (a trip with stops: here to
  // the first, and on from each to the next once there).
  const then = (opts.then || []).filter(x => x?.lat != null).slice(0, MAX_STOPS);
  card = { kind: 'plans', from: fromPt, fromHere: !from, to: dest, then, have: Boolean(opts.keep || rental()), since: opts.since ?? rental()?.at ?? null, lat: dest.lat, lon: dest.lon, plans: null, sel: -1, more: false, back: card?.kind !== 'plans' ? card : card.back };
  ctx.status('');
  document.body.classList.add('ot-planning');
  renderCard();
  if (!start) {
    card.plans = [];
    card.error = '需要你的位置（請在設定允許定位），或點上面的出發地選一個地點。';
    return renderCard();
  }
  map.fit([fromPt, dest], { top: 110, bottom: Math.round(innerHeight * 0.48), left: 40, right: 40 });
  ctx.data.trips = remember(ctx.data.trips, { name: dest.name, lat: dest.lat, lon: dest.lon, t: Date.now(), ...(dest.gid ? { gid: dest.gid } : {}) }, tripKey, 10);
  ctx.save();
  const c = card;
  let out = null;
  try {
    const at = when.by === 'now' ? null : when.at;
    out = await planTrip(ctx.data, fromPt, dest, { at, by: when.by === 'arrive' ? 'arrive' : 'depart', modes: tripModes });
    c.plans = await walkHere(out.plans);
    c.choice = {};
    c.sources = out.sources;
    if (out.error && !out.plans.length) c.error = errorText(out.error);
  } catch (err) {
    c.error = errorText(err);
    c.plans = [];
  }
  if (card === c) {
    renderCard();
    // The best plan drawn on the map at once; its steps open with a tap.
    if (c.plans.length) {
      drawPlan(c.plans[0], { fit: false });
      // (Its buses along their stops, not straight across town.)
      roadLegs(c.plans[0], { roads: false });
    }
    if (opts.nav && c.plans[opts.index || 0]) navigate(c.plans[opts.index || 0]);
    if ((c.then.length || c.have) && c.plans.length) planRest(c);
  }
  // The direct buses and every bus's times come a moment later: the list
  // ranked again, the plan open (if one is) kept open, unless a time was picked.
  out?.later?.then(o => {
    if (!o?.plans?.length || card !== c || navFull() || Object.keys(c.choice || {}).length) return;
    const open = c.plans[c.sel];
    c.plans = walkHereNow(o.plans);
    if (c.keepPlan?.tags.includes('推薦')) {
      for (const q of c.plans) q.tags = (q.tags || []).filter(t => t !== '推薦');
      c.plans.unshift(c.keepPlan);
    } else if (c.keepPlan) c.plans.push(c.keepPlan);
    c.sel = open ? c.plans.findIndex(p => pickSig(p) === pickSig(open) && Math.abs(p.dep - open.dep) < 60_000) : -1;
    renderCard();
    if (c.sel < 0 && c.plans.length) {
      drawPlan(c.plans[0], { fit: false });
      roadLegs(c.plans[0], { roads: false });
    }
  });
}

// A trip with stops: each later stretch planned too, from when the
// recommended way gets you to its start, so every way on the card is the
// whole trip (the owner, 2026-10-15: planned to the first stop alone, a 3′
// walk was the trip). Navigating, each stretch is planned again once there.
async function planRest(c) {
  c.rest = [];
  let prev = c.to;
  for (const x of c.then) {
    const rec = c.plans.find(p => p.tags?.includes('推薦')) || c.plans[0];
    const at = chainOn(rec, c.rest)?.at(-1)?.arr || rec.arr;
    let plans = [];
    try {
      const o = await planTrip(ctx.data, prev, x, { at: Math.max(at, Date.now()), by: 'depart', modes: tripModes });
      const later = await o.later?.catch(() => null);
      plans = later?.plans?.length ? later.plans : o.plans;
    } catch {}
    if (card !== c) return;
    // (A short stretch the planners give no walk for, as the first one gets
    // one from here: the walk, the way when it's that short or nothing else came.)
    const d = meters(prev.lat, prev.lon, x.lat, x.lon);
    if (d <= 1500 && !plans.some(q => q.legs.every(l => l.mode === 'walk'))) {
      const dist = Math.round(d * 1.3);
      const dur = walkSec(d);
      const w = { mode: 'walk', from: { name: prev.name || '', lat: prev.lat, lon: prev.lon }, to: { name: x.name || '', lat: x.lat, lon: x.lon }, dist, dur, dep: at, arr: at + dur * 1000, straight: true };
      plans = [{ ...finish({ src: 'walk', legs: [w] }), top: d <= 500 || !plans.length, lead: true, weak: false, times: [], tags: [] }, ...plans];
    }
    c.rest.push(plans);
    prev = x;
  }
  // One YouBike kept to the last place (locked by each stop, returned only
  // there): a way of its own, among the rest unless it's there sooner than
  // the recommended (or you're on it already: first).
  try {
    const pts = [c.from, c.to, ...c.then];
    const cities = [...new Set(await Promise.all(pts.map(x => ctx.cityOf(x.lat, x.lon))))].filter(Boolean);
    const bikes = (await Promise.all(cities.map(x => cityBikes(x).catch(() => [])))).flat();
    const first = c.plans.find(p => p.tags?.includes('推薦')) || c.plans[0];
    const k = card === c && keepBike(c.from, [c.to, ...c.then], bikes, c.have ? Date.now() : first.dep, { have: c.have, swap: bikeSwap(ctx.data.prefs), since: c.since ?? Date.now() });
    if (k) {
      const whole = restOf(c, first);
      // (The recommendation unless a stop is far or it's all a short walk: keepWins.)
      const wins = c.have || keepWins(k, whole && [first, ...whole]);
      const p = { ...k[0], later: k.slice(1), lead: true, weak: false, times: [], tags: wins ? ['推薦', '全程 YouBike'] : ['全程 YouBike'] };
      p.top = wins || !whole || k.at(-1).arr < (whole.at(-1) || first).arr;
      c.keepPlan = p;
      if (wins) for (const q of c.plans) q.tags = (q.tags || []).filter(t => t !== '推薦');
      if (wins) {
        c.plans.unshift(p);
        if (c.sel >= 0) c.sel++;
      } else c.plans.push(p);
    }
  } catch {}
  if (card !== c) return;
  renderCard();
  drawPlan(c.plans[c.sel >= 0 ? c.sel : 0], { fit: false });
}
// A way on a card with stops, the whole trip: its later stretches (null
// while they're being planned, or nothing gets there).
const restOf = (c, p) => (p.keep ? p.later : c?.then?.length && c.rest?.length === c.then.length ? chainOn(p, c.rest) : null);

// 出發時間 / 抵達時間: a day (today, tomorrow…) and a time, for this trip
// (its other ways of moving, its stops, turned round); a new trip is from
// now (the owner, 2026-10-12: a test at 16:45 had the next trip planned for
// then, a bus long gone and no live times). A time already past today
// means tomorrow's.
function setWhen(kind) {
  const replan = () => card?.kind === 'plans' && plan(card.fromHere ? null : card.from, card.to);
  if (kind === 'now') {
    when = { by: 'now', at: null };
    return replan();
  }
  // The one chip: which of the three.
  if (kind === 'menu') {
    const m = sheet(`${sheetHead('什麼時候')}<div class="ot-when-menu">${[['now', '現在出發'], ['depart', '指定出發時間'], ['arrive', '指定抵達時間']].map(([k, t]) => `<button class="q-btn${(when.by === k) ? ' primary' : ''}" type="button" data-pick-when="${k}">${t}</button>`).join('')}</div>`);
    m.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pick-when]');
      if (!b) return;
      m.close();
      setWhen(b.dataset.pickWhen);
    });
    return;
  }
  const base = when.at && when.at > Date.now() ? when.at : Date.now() + 15 * 60_000;
  const today = tw().date;
  const dayChips = [0, 1, 2].map(n => [addDays(today, n), ['今天', '明天', '後天'][n]]);
  let date = tw(base).date;
  const d = sheet(`${sheetHead(kind === 'arrive' ? '抵達時間' : '出發時間')}
    <div class="ot-field ot-when-day"><span>日期</span><div class="ot-days" role="group" aria-label="日期">${dayChips.map(([v, n]) => `<button type="button" data-day="${v}" aria-pressed="${v === date}">${n}<small>${e(v.slice(5).replace('-', '/'))}</small></button>`).join('')}</div></div>
    <label class="ot-field ot-when-time"><span>時間</span><input id="w-time" type="time" value="${tw(base).hm}"></label>
    <button class="q-btn primary block ot-when-go" type="button" data-ok="1">查詢</button>`);
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
const MODE_CHIP = { bus: '公車', tra: '台鐵', hsr: '高鐵', metro: '捷運', bike: 'YouBike' };
function plansHtml(c) {
  const whenText = when.by === 'now' ? '現在出發' : `${when.by === 'arrive' ? '抵達' : '出發'} ${hm(when.at)}`;
  const saved = Boolean(tripOf(c));
  const top = `<div class="ot-card-grip" data-card="grow"></div>
    <div class="ot-card-head"><button class="q-icon-btn" type="button" data-card="back" aria-label="返回">${icon('back')}</button>
      <div class="ot-card-title ot-od"><button type="button" data-card="edit-from" aria-label="改出發地"><i class="ot-dot from"></i><span>${e(c.from.name)}</span></button><button type="button" data-card="edit-to" aria-label="${c.then?.length ? '改第一站' : '改目的地'}"><i class="ot-dot ${c.then?.length ? 'stop' : 'to'}"></i>${c.then?.length ? '<small class="ot-od-n">1</small>' : ''}<b>${e(c.to.name || '目的地')}</b></button>${(c.then || [])
        .map((x, k) => `<div class="ot-od-stop"><button type="button" data-card="stop-first" data-k="${k}" aria-label="先去 ${e(x.name)}"><i class="ot-dot ${k === c.then.length - 1 ? 'to' : 'stop'}"></i><small class="ot-od-n">${k + 2}</small><b>${e(x.name || '地點')}</b></button><button class="ot-od-x" type="button" data-card="stop-drop" data-k="${k}" aria-label="移除這一站">×</button></div>`)
        .join('')}${(c.then?.length || 0) < MAX_STOPS ? `<button class="ot-od-add" type="button" data-card="stop-add">${icon('plus')}<span>加一站</span></button>` : ''}</div>
      <button class="q-icon-btn" type="button" data-card="swap" aria-label="對調起訖">${icon('swap')}</button>
      <button class="q-icon-btn${saved ? ' on' : ''}" type="button" data-card="save-trip" aria-label="釘選這個行程">${icon('star')}</button>
      <button class="q-close" type="button" data-card="close" aria-label="關閉">×</button></div>
    <div class="ot-opts"><button class="q-chip ot-when-pick" type="button" data-when="menu" aria-haspopup="dialog">${icon('clock')}${e(when.by === 'now' ? '現在出發' : `${whenDay(when.at)}${hm(when.at)} ${when.by === 'arrive' ? '抵達' : '出發'}`)}${icon('down', 'ot-caret')}</button>
      <div class="ot-mtogs" role="group" aria-label="這次搭什麼">${Object.entries(MODE_CHIP).map(([k, v]) => `<button class="ot-mtog" type="button" data-mode="${k}" aria-pressed="${modesNow()[k] !== false}" aria-label="${e(v)}" title="${e(v)}">${icon(k)}</button>`).join('')}</div></div>`;
  if (!c.plans) return `${top}<p class="ot-note">${e(whenText)}：比較公車、火車、捷運和 YouBike，看公車現在的位置…</p>`;
  if (!c.plans.length) return `${top}${c.error ? `<p class="ot-note bad">${e(c.error)}</p>` : '<p class="ot-note">找不到大眾運輸方案。</p>'}${sourcesNote(c.sources)}`;
  // One row per route: the departure chosen (its best at first), the route's other departures as times to pick.
  const shownAt = i => c.choice?.[i] ?? i;
  const deps = (lead, i) => depChips(c.plans, c.plans[lead].times || [], i, j => `data-dep="${j}" data-lead="${lead}"`);
  // Compact, so several fit the card at once (the owner's phone showed one):
  // the time, the lines, one line of facts. The departures to pick and the
  // steps only on the plan opened; while one is open, the rest are a row each.
  const open = c.sel >= 0;
  const row = (p, i, lead = i) => {
    const on = i === c.sel;
    const mini = open && !on;
    // With stops: the whole trip, each stretch after its stop's number (the time and the facts all of it).
    const later = restOf(c, p);
    const all = [p, ...(later || [])];
    const arr = all.at(-1).arr;
    const sum = k => all.reduce((a, q) => a + (q[k] || 0), 0);
    const facts = !c.then?.length
      ? [leaveText(p), p.transfers ? `轉乘 ${p.transfers} 次` : '不必轉乘', p.walk > 50 ? `步行 ${distText(p.walk)}` : '', p.fareText || (p.fare ? `NT$${p.fare}` : '')]
      : !later
        ? [leaveText(p), `後面 ${c.then.length} 段規劃中…`]
        : [leaveText(p), sum('transfers') ? `轉乘 ${sum('transfers')} 次` : '不必轉乘', sum('walk') > 50 ? `步行 ${distText(sum('walk'))}` : '', sum('fare') ? `NT$${sum('fare')}` : ''];
    // (Nothing gets there from one stop on: said, the time up to it.)
    const short = later?.short != null ? `${[c.to, ...c.then][later.short].name || '這一站'}之後找不到方案` : '';
    // With stops, each stretch short so the whole trip is one line: its rides, or its walk or ride all of it.
    const chips = q => (c.then?.length ? stretchChips(q) : legChips(q.legs));
    return `<button class="ot-plan${on ? ' on' : ''}${mini ? ' mini' : ''}" type="button" data-plan="${i}">
        <div class="ot-plan-top">${picked(c, p) ? `<span class="ot-pinned" title="釘選的方案">${icon('star')}</span>` : ''}<b class="ot-plan-dur">${e(minsText((arr - p.dep) / 1000))}</b><span class="ot-plan-time">${e(timeRange(p.dep, arr))}</span>${mini ? '' : p.tags.filter(t => t !== 'YouBike' && t !== '電輔車').map(t => `<span class="ot-tag${t === '推薦' ? ' best' : t === '即時' ? ' live' : ''}">${e(t)}</span>`).join('')}</div>
        <div class="ot-legs">${all.map((q, k) => `${k ? `<span class="ot-leg-stop" aria-label="第 ${k} 站">${k}</span>` : ''}${chips(q)}`).join('')}</div>${on ? deps(lead, i) : ''}
        ${mini ? '' : `<div class="ot-plan-sub">${facts.filter(Boolean).map(e).join(' · ')}</div>`}${!mini && short ? `<div class="ot-plan-sub warn">${e(short)}</div>` : ''}${!mini && p.keep ? `<div class="ot-plan-sub">${!c.then.length ? '騎著的這台，到這裡還' : bikeSwap(ctx.data.prefs) ? '同一台騎到底，快滿 30 分鐘時在站旁換一台' : '同一台騎到最後才還，停留時也在計費'}</div>` : ''}
        ${!mini && (p.miss || p.off || p.late || lateBy(p, p.arr) || p.rivers?.length) ? `<div class="ot-plan-sub warn">${e(p.off || p.miss || p.late || (lateBy(p, p.arr) ? `比 ${hm(p.deadline)} 晚 ${lateBy(p, p.arr)} 分到` : '') || `${p.riverBy || '騎車'}過${p.rivers.join('、')}（汽車橋）`)}</div>` : ''}
        ${on ? stepsHtml(p, c) : ''}
      </button>`;
  };
  // The routes' cards (a way set aside shows only when it's pinned).
  const leads = c.plans.map((p, i) => [p, i]).filter(([p]) => p.lead !== false && (!p.weak || picked(c, p)));
  const card_ = ([p, i]) => row(c.plans[shownAt(i)], shownAt(i), i);
  const tops = leads.filter(([p]) => p.top || picked(c, p));
  const rest = leads.filter(([p]) => !p.top && !picked(c, p));
  return `${top}<div class="ot-plans">${tops.map(card_).join('')}</div>
    ${rest.length ? `<button class="q-btn ot-wide ot-more" type="button" data-card="more">${c.more ? '收起其他方案' : `其他 ${rest.length} 個方案`}</button>${c.more ? `<div class="ot-plans">${rest.map(card_).join('')}</div>` : ''}` : ''}`;
}
// A stretch of a trip with stops, short: its rides (YouBike too), or a walk of all its minutes.
function stretchChips(q) {
  const rides = q.legs.filter(l => l.mode !== 'walk');
  return legChips(rides.length ? rides : [{ mode: 'walk', dur: (q.arr - q.dep) / 1000 }]);
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


// A YouBike step's two ends, a row each: 借 or 還, the station's whole
// name, and under it what's there now as small tags (the bikes, the
// 電輔車, the free docks; one line of all of it wrapped or was cut).
const bikeEnd = (k, name, tags) =>
  `<span class="ot-bike-end"><i class="ot-bike-k">${k}</i><span class="ot-bike-at"><span class="ot-bike-name">${e(name)}</span>${tags.length ? `<span class="ot-bike-tags">${tags.map(([a, n]) => `<span class="ot-bike-tag${Number(n) ? '' : ' none'}">${a}<b>${e(String(n))}</b></span>`).join('')}</span>` : ''}</span></span>`;
function stepsHtml(p, c = card) {
  // With stops: each stretch's steps, 抵達 each stop between them.
  const later = restOf(c, p) || [];
  const stopAt = (q, k) => `<li class="stop"><span class="ot-step-time">${e(hm(q.arr))}</span><span class="ot-step-i">${k + 1}</span><span class="ot-step-what"><b>抵達 ${e([c.to, ...c.then][k]?.name || '')}</b></span></li>`;
  return `<ol class="ot-steps">${[p, ...later].map((q, k) => `${k ? stopAt([p, ...later][k - 1], k - 1) : ''}${stepItems(q.legs)}`).join('')}<li class="end"><span class="ot-step-time">${e(hm((later.at(-1) || p).arr))}</span><span class="ot-step-i">${icon('pin')}</span><span class="ot-step-what"><b>抵達${c.then?.length ? ` ${e([c.to, ...c.then][later.length].name || '')}` : ''}</b></span></li></ol>
    <span class="ot-plan-acts">${canNav(p) ? `<span class="q-btn primary" role="button" data-card="nav">${icon('route')} 開始導航</span>` : `<span class="ot-nav-later">${e(hm(p.dep - NAV_LEAD))} 起可以開始導航</span>`}<span class="q-btn${picked(c, p) ? ' on' : ''}" role="button" data-card="pick">${icon('star')} ${picked(c, p) ? '已釘選' : '釘選這個方案'}</span></span>`;
}
function stepItems(legs) {
  return legs
    .map(l => {
      const c = legColor(l);
      const what =
        l.mode === 'walk'
          ? `步行 ${distText(l.dist)}${l.to?.name ? `到 ${e(l.to.name)}` : ''}`
          : l.mode === 'bike'
            ? `<b>${l.swap ? '換一台，' : ''}騎 ${l.ebike ? 'YouBike 電輔車' : 'YouBike'} ${e(distText(l.dist))}</b>${l.to?.lat != null ? `<span class="ot-step-gm" role="link" data-maps="${e(mapsLink(l.to, 'bicycling', l.from))}">${icon('route')}${mapsName()}</span>` : ''}${bikeEnd(l.kept ? '騎' : '借', l.from.name, l.rent ? (l.ebike ? [[`${icon('bolt')}電輔`, l.rent.ebike]] : [[`${icon('bike')}一般`, l.rent.bikes], [`${icon('bolt')}電輔`, l.rent.ebike || 0]]) : [])}${bikeEnd(l.park ? '停' : '還', l.to.name, l.ret ? [['空位', l.ret.ret]] : [])}`
            : `<b>${e(MODE_NAME[l.mode])} ${e(l.short || l.name)}</b>${wayText(l) ? ` ${e(wayText(l))}` : ''}<small class="ot-step-line" title="${e(l.agency || '')}">${e(l.from.name)} → ${e(l.to.name)}${l.stops ? ` · ${l.stops} 站` : ''}</small><span class="ot-live" data-live="${e(`${l.mode}|${l.short || l.name}|${l.from.lat}|${l.from.lon}`)}"></span>`;
      return `<li style="--c:${e(c)}"><span class="ot-step-time">${e(hm(l.dep))}${l.live ? `<i class="ot-livedot" title="即時"></i>` : ''}</span><span class="ot-step-i">${icon(l.mode)}</span><span class="ot-step-what">${what}<small class="ot-step-dur">${e(minsText(l.dur))}</small></span></li>`;
    })
    .join('');
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
// (`roads: false`: only the buses' stops, from the packs; the walks' and rides' roads are an outside router's, asked for a plan opened.)
async function roadLegs(p, { lit = -1, roads = true } = {}) {
  const todo = !roads ? [] : p.legs.filter(l => (l.mode === 'bike' || (l.mode === 'walk' && !l.poly)) && !l.road && l.from?.lat != null && l.to?.lat != null && (l.dist || 0) > 120);
  // A ride the planner gave no shape: along its line (shapes.mjs: a bus its
  // route's road, a train or the metro its track), else a bus through its
  // stops; never a straight line across town.
  const buses = p.legs.filter(l => l.mode === 'bus' && !l.poly && !l.path && l.from?.lat != null && l.to?.lat != null);
  const rails = p.legs.filter(l => (l.mode === 'tra' || l.mode === 'hsr' || l.mode === 'metro') && !l.poly && !l.path && l.from?.lat != null && l.to?.lat != null);
  if (!todo.length && !buses.length && !rails.length) return;
  await Promise.all([
    ...buses.map(async l => {
      const o = l.route?.uid ? l : await officialLeg(l).catch(() => l);
      const path = (await busWay(l, o.route).catch(() => null)) || (await busPath(l).catch(() => null));
      if (path?.length > 1) l.path = path;
    }),
    ...rails.map(async l => {
      let path = await railWay(l).catch(() => null);
      // (A train the shape can't carry the whole way: by its own stops, a hop at a time.)
      if (!path && l.mode !== 'metro') path = await railWayByStops(l.mode, await trainStops(l).catch(() => null)).catch(() => null);
      if (path?.length > 1) l.path = path;
    }),
    ...todo.map(async l => {
      // A walk: the one walk (walkTo, Google's streets), from where you are
      // as the strip and the cards have it when it starts beside you; a
      // ride: OpenStreetMap's bike router.
      const here = l.mode === 'walk' && ctx.here && meters(ctx.here.lat, ctx.here.lon, l.from.lat, l.from.lon) < 50;
      const r = l.mode === 'walk' ? await (here ? walkFrom(ctx.here, l.to, { line: true }) : walkTo(l.from, l.to, { line: true }).catch(() => null)) : await roadPath(l.mode, l.from, l.to);
      if (!r?.poly) return;
      l.road = true;
      l.poly = r.poly;
      l.fmt = '';
      // (Its length too: the streets' walking distance, not the straight line's guess.)
      l.dist = r.dist;
    })
  ]);
  p.walk = p.legs.filter(l => l.mode === 'walk').reduce((a, l) => a + (l.dist || 0), 0);
  if (card?.plans?.includes(p) && (card.plans[card.sel] === p || (card.sel < 0 && card.plans[0] === p) || navFull())) {
    drawPlan(p, { fit: false, lit });
    if (!navFull()) renderCard();
  }
}
// A leg's way on the map: its shape; no shape from the planner, through its
// own stops when navigation has them (nav.mjs), else a straight line. → [[lat, lon]…]
function legPath(l) {
  const polys = Array.isArray(l.poly) ? l.poly : l.poly ? [l.poly] : [];
  const path = polys.flatMap(x => decodeLine(x, l.fmt));
  if (path.length) return path;
  if (Array.isArray(l.path) && l.path.length > 1) return l.path;
  return l.from?.lat && l.to?.lat ? [[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]] : [];
}
// A trip's YouBike stations, where you take a bike and where it goes back:
// each as the map's own station marker, its tip on the station (looking at
// the trip and navigating, when the map's other bike stations are off),
// with what you need there: where you take one its bikes (and ⚡), where it
// goes back its docks (a parking P), a swap (every 30 minutes, returned and
// another taken at one station) both, once.
//   → [{ st, rent, ret }]
export function planBikes(legs) {
  const at = new Map();
  for (const l of legs.filter(l => l.mode === 'bike'))
    for (const [st, role] of [[l.rent, 'rent'], [l.ret, 'ret']])
      if (st?.uid && st.lat != null) at.set(st.uid, { st, rent: false, ret: false, ...at.get(st.uid), [role]: true });
  return [...at.values()];
}
const dockLevel = s => (s.ok === false ? 'off' : s.ret === 0 ? 'none' : s.ret <= 3 ? 'few' : 'ok');
const LEVELS = ['ok', 'few', 'none', 'off'];
// (The station now when the city's bikes are in: `live`.)
export function planBikeMarker({ st, rent, ret }, live = null) {
  const s = live || st;
  const lv = [rent && bikeLevel(s), ret && dockLevel(s)].filter(Boolean).sort((a, b) => LEVELS.indexOf(b) - LEVELS.indexOf(a))[0];
  // (Docks as a parking sign's P, bikes as the map's own: its bike, the count, ⚡.)
  const parts = s.ok === false ? [`${icon('bike')}<b>停</b>`] : [ret && `${icon('dock')}<b>${s.ret}</b>`, rent && `${icon('bike')}<b>${s.bikes}</b>${s.ebike ? `<i>⚡${s.ebike}</i>` : ''}`].filter(Boolean);
  return { id: `pbike:${st.uid}`, lat: st.lat, lon: st.lon, cls: `bike plan ${lv}`, z: 20, kind: 'bike', data: s, html: parts.join('<s></s>') };
}
// A ride's end without its station (a plan from elsewhere): a bike at the spot.
export const bikeReturns = legs =>
  legs.filter((l, k) => {
    const next = legs[k + 1];
    return l.mode === 'bike' && l.to?.lat != null && !(next?.mode === 'bike' && next.from?.lat != null && meters(l.to.lat, l.to.lon, next.from.lat, next.from.lon) < 40);
  });
let planDraw = 0;
function drawPlan(p, { fit = true, lit = -1 } = {}) {
  if (!p) return map.lines('plan', []);
  // A way on a card with stops: the whole trip, to its last place.
  const later = lit < 0 && card?.plans?.includes(p) ? restOf(card, p) : null;
  if (later?.length) p = { ...p, legs: [...p.legs, ...later.flatMap(q => q.legs)], dest: card.then[later.length - 1] };
  // (Its own YouBike stations, only: drawLayers.)
  if (!navFull()) drawLayers();
  const lines = [];
  const pts = [];
  for (const [k, l] of p.legs.entries()) {
    const path = legPath(l);
    if (!path.length) continue;
    // Navigating: the whole trip in its colours, the step you're on the boldest, the steps behind you faint.
    const done = lit >= 0 && k < lit;
    const on = lit < 0 || k === lit;
    lines.push({ pts: path, color: done ? '#4b5263' : l.mode === 'walk' ? '#c5ccd8' : legColor(l), width: l.mode === 'walk' ? 4 : on ? 8 : 6, dash: l.mode === 'walk', z: on ? 6 : done ? 3 : 5 });
    pts.push(...path.map(([lat, lon]) => ({ lat, lon })));
  }
  map.lines('plan', lines);
  // Where it starts (the plan's own, not the card's: navigating, another may be open) and where it ends: a pin, like Maps'.
  const start = p.legs[0]?.from;
  const end = p.dest?.lat != null ? p.dest : p.legs.at(-1)?.to;
  // The place's own dropped pin already marks where it ends: one mark there, not two on top of each other.
  const marked = selDrop && end?.lat != null && meters(selDrop.lat, selDrop.lon, end.lat, end.lon) < 60;
  const bikes = planBikes(p.legs);
  const marks = live => [
    ...(start?.lat != null ? [{ id: 'from', lat: start.lat, lon: start.lon, cls: 'end from', z: 30, html: '<i></i>' }] : []),
    ...(end?.lat != null && !marked ? [{ id: 'to', lat: end.lat, lon: end.lon, cls: 'dest', z: 32, html: `<i aria-label="${e(end.name || '目的地')}">${icon('pin')}</i>` }] : []),
    ...p.legs.filter(l => l.mode !== 'walk' && l.from?.lat && !(l.mode === 'bike' && (l.rent?.uid || l.kept))).map((l, k) => ({ id: `b${k}`, lat: l.from.lat, lon: l.from.lon, cls: 'board', z: 20, html: `<i style="--c:${e(legColor(l))}">${icon(l.mode)}</i>` })),
    ...bikes.map(b => planBikeMarker(b, live?.get(b.st.uid))),
    ...bikeReturns(p.legs).filter(l => !l.ret?.uid && !l.park).map((l, k) => ({ id: `r${k}`, lat: l.to.lat, lon: l.to.lon, cls: 'board', z: 20, html: `<i style="--c:${e(legColor(l))}">${icon('bike')}</i>` })),
    // Navigating: each ride's stops on its line (a bus's, a train's, the metro's), where you get off ringed.
    ...(lit >= 0 ? navStops() : []).flatMap(({ k, stops }) =>
      stops.slice(1).map((s, x) => ({ id: `s${k}:${x}`, lat: s.lat, lon: s.lon, cls: `stopdot${x === stops.length - 2 ? ' off' : ''}`, z: 15, html: `<i style="--c:${e(legColor(p.legs[k]))}" title="${e(s.name || '')}"></i>` }))
    )
  ];
  const run = ++planDraw;
  map.layer('plan').set(marks(null));
  // Its YouBike stations as they are now (bikes to take, docks to return to).
  if (bikes.length)
    ctx
      .cityOf(bikes[0].st.lat, bikes[0].st.lon)
      .then(city => city && cityBikes(city))
      .then(list => list && run === planDraw && map.layer('plan').set(marks(new Map(list.map(x => [x.uid, x])))))
      .catch(() => {});
  if (fit && pts.length) map.fit(pts, { top: 120, bottom: Math.round(innerHeight * 0.55), left: 30, right: 30 });
}

// A bus leg's live line, short enough for one row: the bus you'd catch
// (the first at the stop once you're there, `ready`), live or as planned.
// One that's on its way now and gone before you're there is "趕不上" only
// when it's the plan's own bus; a later bus chosen (its time picked from
// the chips) hasn't set off yet, so it isn't among the live ones: its
// timetable time, not the earlier bus's "趕不上" (2026-10-10).
export function liveLegText(l, times, off, ready, now = Date.now()) {
  const mins = at => Math.max(0, Math.round((at - now) / 60_000));
  const bus = times.find(t => t.at >= ready - 60_000 && t.at <= l.dep + 25 * 60_000);
  if (bus) {
    const late = Math.round((bus.at - l.dep) / 60_000);
    return `${bus.planned ? '預計' : '即時'} ${hm(bus.at)} 到站 · ${mins(bus.at)} 分後${late > 3 ? ` · 晚 ${late} 分` : ''}`;
  }
  // The plan's own bus (its time within a few minutes of a live one), gone by the time you're there.
  const mine = times.find(t => Math.abs(t.at - l.dep) <= 6 * 60_000);
  if (mine && mine.at < ready - 60_000) return `即時：這班 ${mins(mine.at)} 分後到，趕不上`;
  if (off === 3) return '末班已過';
  if (off === 4) return '今日未營運';
  // Still to set off: its timetable time.
  return l.dep > now ? `時刻表 ${hm(l.dep)} 到站 · 還沒發車` : '';
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
      const text = liveLegText(l, times, off, Math.max(Date.now(), k ? p.legs[k - 1].arr : l.dep - 60_000));
      const el = document.querySelector(`[data-live="${CSS.escape(`${l.mode}|${name}|${l.from.lat}|${l.from.lon}`)}"]`);
      if (el && text) el.innerHTML = `${icon('live')} ${e(text)}`;
    } catch {}
  }
}

// ---- Navigation ---------------------------------------------------------------------------------------

async function navigate(p, resume = null, { swap = false } = {}) {
  if (!p) return;
  // A ride already being navigated isn't thrown away by a tap elsewhere (走過去,
  // 開始導航 on another plan): asked first, unless it's the new plan you asked
  // for from it (重新規劃, 改目的地).
  if (!resume && !swap && navigating() && !(card && card.to === replanTo)) {
    const n = navNow();
    const ask = kit.ask || (o => Promise.resolve(globalThis.confirm(`${o.title}\n${o.body}`)));
    const ok = await ask({ title: '取代目前的導航？', body: `正在導航到 ${navDest(n).name || '目的地'}，開始新的會結束它。`, ok: '開始新的導航', cancel: '繼續原本的' });
    if (!ok) return;
  }
  replanTo = null;
  // (Swapped for the way that's on time: the trip goes on, whatever card is open.)
  const c = swap ? null : card;
  closeResults();
  $('card').hidden = true;
  document.body.classList.add('ot-navigating');
  document.body.classList.toggle('ot-nav-min', Boolean(resume?.min));
  if (resume?.min) document.body.classList.remove('ot-planning');
  // (The map now fills the screen: its tiles for the new size.)
  map?.resize();
  following = !resume?.min;
  stopWatch();
  roadLegs(p);
  // The stops after this one ride with the plan (kept with it on the phone: on after the app is reopened).
  if (c?.then?.length) p = { ...p, then: c.then.map(x => ({ name: x.name || '', lat: x.lat, lon: x.lon, ...(x.gid ? { gid: x.gid } : {}) })) };
  startNav(p, {
    box: $('nav'),
    mini: $('nav-mini'),
    here: ctx.here,
    dest: c?.to,
    resume,
    push: setNavPush,
    draw: (plan, i) => {
      // (Shrunk: the map is yours; the way comes back with the card.)
      if (navNow()?.min) return;
      navDraw(plan, i);
    },
    follow: pos => {
      ctx.here = { ...pos, at: Date.now() };
      drawMe(ctx.here);
      // The stage you're at stays in view as you go (every few seconds; back a little after you've moved the map by hand).
      const n = navNow();
      if (navFollow && navFull() && n && Date.now() - viewAt > 5_000) navView(n.plan, n.i);
    },
    onAction: navAction,
    onEnd: (how = {}) => {
      // Arrived at a stop with places after it: on to the next (its plans from here, ready to go).
      const next = how.arrived && how.plan?.then?.length ? how.plan.then : null;
      if (how.arrived) ctx.status(next ? `已抵達 ${how.arrived}，接著去 ${next[0].name || '下一站'}` : `已抵達 ${how.arrived}，導航結束`);
      // (Navigation over: the map no longer follows you, until 我的位置 is tapped.)
      following = false;
      clearTimeout(followBack);
      $('nav').hidden = true;
      document.body.classList.remove('ot-navigating', 'ot-nav-min');
      $('nav-mini').innerHTML = '';
      map?.resize();
      drawLayers();
      // Arrived: the trip's over, its card and its way off the map; ended by hand, back to the plans it came from.
      if (next) {
        closeCard();
        when = { by: 'now', at: null };
        // (On one YouBike kept, parked here: it rides on from here; its rental from when it really began, a stay included.)
        const kp = how.plan;
        const parked = Boolean(kp?.keep && kp.legs.some(l => l.park));
        const since = parked && kp.rentAt != null ? (kp.rentAt >= kp.dep ? Date.now() - (kp.arr - kp.rentAt) : kp.rentAt) : null;
        return plan(null, next[0], { then: next.slice(1), keep: parked, since });
      }
      if (how.arrived || !card) return closeCard();
      // (Ended by hand: the trip's way off the map, whatever card is open; the plans it came from draw theirs again.
      // Reopened mid-trip, no card came with it: the line and its end had stayed.)
      map.lines('plan', []);
      planDraw++;
      map.layer('plan').set([]);
      $('card').hidden = false;
      renderCard();
      if (card.plans?.length) drawPlan(card.plans[card.sel >= 0 ? card.sel : 0], { fit: false });
    }
  });
  // (Only the way on the map now.)
  drawLayers();
}
// The way being navigated on the map, the step you're on lit; in view, that
// stage of the trip (nav.mjs stageView: a walk close up, a ride to its end).
function navDraw(plan, i) {
  if (!map) return;
  drawPlan(plan, { fit: false, lit: i });
  navFollow = true;
  navView(plan, i);
}
// Between the card on top and the one at the bottom: the stage you're at, you on it.
let viewAt = 0;
function navView(plan, i, tries = 0) {
  // (Not while the app is away: no size to fit into.)
  if (document.visibilityState !== 'visible') return;
  viewAt = Date.now();
  const n = navNow();
  const pts = stageView(plan, i, n?.phase, n?.pos || ctx.here, legPath);
  if (!pts.length) return;
  const box = $('map').getBoundingClientRect();
  const top = $('nav').querySelector('.ot-nav-top')?.getBoundingClientRect().bottom;
  const bottom = $('nav').querySelector('.ot-nav-bottom')?.getBoundingClientRect().top;
  const done = map.fit(pts, { top: Math.max(60, (top || box.top + 170) - box.top + 24), bottom: Math.max(60, box.bottom - (bottom || box.bottom - 150) + 24), left: 36, right: 36 });
  // (No room yet, the page still laying out: again in a moment, never zoomed out to the island.)
  if (done === false && tries < 6) setTimeout(() => {
    const m = navNow();
    if (m && navFollow && navFull() && Date.now() - viewAt >= 400) navView(m.plan, m.i, tries + 1);
  }, 500);
}
// Navigating, the map keeps the rest of the trip in view as you go; moved or
// zoomed by a finger (or tapped) it stops, and 10 s after the last touch it
// comes back to the trip (like a phone's own maps).
let navFollow = true;
let followBack = 0;
function dragged() {
  // Not navigating (or shrunk): a finger on the map means you're looking somewhere else; it stays there (a late first fix included).
  if (!navFull()) {
    following = false;
    centered = true;
    return;
  }
  navFollow = false;
  clearTimeout(followBack);
  followBack = setTimeout(() => {
    if (!navFull()) return;
    navFollow = true;
    const n = navNow();
    if (n) navView(n.plan, n.i);
  }, 10_000);
}

// Shrunk to the bar above the tabs (the map, search and the other tabs are
// yours; navigation goes on), or back to its card on the map.
function shrinkNav(on) {
  if (!navigating()) return;
  setNavMin(on);
  document.body.classList.toggle('ot-nav-min', on);
  if (on) {
    following = false;
    document.body.classList.remove('ot-planning');
    drawLayers();
    return;
  }
  ctx.goTab('map');
  closeResults();
  $('card').hidden = true;
  following = true;
  const n = navNow();
  if (n) navDraw(n.plan, n.i);
  drawLayers();
}

// What the navigation card asks for: back to it (the bar), its ⋯, a new plan from here.
let cardsTimer = 0;
function navAction(a, info) {
  if (a === 'open') return shrinkNav(false);
  if (a === 'more') return navMore();
  if (a === 'replan') return replanFromHere();
  if (a === 'late') return navLate(info);
  if (a === 'stayed') return stayedOn(info);
  // Its cards grew, shrank or folded (the stops on board coming in, a fold):
  // the stage fitted again in the room left, so you're never under a card.
  if (a === 'cards') {
    clearTimeout(cardsTimer);
    cardsTimer = setTimeout(() => {
      const n = navNow();
      if (n && navFollow && navFull()) navView(n.plan, n.i);
    }, 150);
    return;
  }
  if (a === 'offer') {
    const n = navNow();
    if (n?.offer?.plan) navigate(n.offer.plan, null, { swap: true });
  }
}
// To be there by a time and late for it (missed the bus, the next too late;
// or late for it on the way): the ways from here for the same deadline, and
// the best that's on time offered on the card (改騎電輔車，07:55 到), or said
// that none is. The owner, 2026-10-12: miss the bus, still at school by 8.
let lateBusy = false;
async function navLate({ eta = null, k = -1, ride = '' } = {}) {
  const n = navNow();
  const here = n?.pos || ctx.here;
  if (!n?.plan.deadline || !here || lateBusy || n.plan.deadline < Date.now()) return;
  lateBusy = true;
  try {
    const from = { name: '目前位置', lat: here.lat, lon: here.lon };
    const r = await planTrip(ctx.data, from, navDest(n), { at: n.plan.deadline, by: 'arrive', modes: tripModes });
    let best = onTimeWay(r.plans, n.plan, k, Date.now());
    if (!best && r.later) best = onTimeWay((await r.later)?.plans, n.plan, k, Date.now());
    if (navNow()?.plan !== n.plan) return;
    const late = eta == null ? 0 : lateBy(n.plan, eta);
    const title = late ? `這樣會晚 ${late} 分到` : ride ? `趕不上 ${ride} 的話` : '趕不上的話';
    if (best) navOffer({ title, sub: offerText(best), plan: { ...best, dest: n.plan.dest, then: n.plan.then } });
    else if (late) navOffer({ title, sub: '沒有能準時到的走法' });
  } catch {
  } finally {
    lateBusy = false;
  }
}
const navDest = n => n.plan.dest || n.plan.legs.at(-1).to;
// A trip's stops after its first place, at most.
const MAX_STOPS = 3;
// From where you are now to the same place: the ways now, to look at while
// this one goes on; 開始導航 on one replaces it.
let replanTo = null;
function replanFromHere(to = null, then = null) {
  const n = navNow();
  if (!n) return;
  replanTo = to || navDest(n);
  shrinkNav(true);
  ctx.goTab('map');
  // (To be there by a time: still by it, from here.)
  when = n.plan.deadline > Date.now() ? { by: 'arrive', at: n.plan.deadline } : { by: 'now', at: null };
  plan(null, replanTo, { then: then ?? n.plan.then ?? [] });
}
function navMore() {
  const n = navNow();
  if (!n) return;
  const l = n.plan.legs[n.i];
  const ride = l.mode !== 'walk' && l.mode !== 'bike';
  const d = sheet(`${sheetHead('導航', e(`到 ${navDest(n).name || '目的地'}`))}
    <div class="ot-nav-menu">
      <button class="ot-row-btn" type="button" data-m="min">${icon('down')}<span><b>縮小，先做別的事</b><small>導航繼續，點下方的列回來</small></span></button>
      ${navCanPick() ? `<button class="ot-row-btn" type="button" data-m="times">${icon('clock')}<span><b>改搭別班</b><small>趕不上或想晚一點，選同一路線的其他班次</small></span></button>` : ''}
      ${ride && n.ride ? `<button class="ot-row-btn" type="button" data-m="off">${icon('bell')}<span><b>改下車站</b><small>提早或晚一點下車，之後的路重新規劃</small></span></button>` : ''}
      <button class="ot-row-btn" type="button" data-m="replan">${icon('route')}<span><b>換一條路</b><small>還是去 ${e(navDest(n).name || '目的地')}，從現在的位置重新找車（錯過車、想改搭）</small></span></button>
      <button class="ot-row-btn" type="button" data-m="edit">${icon('pin')}<span><b>編輯行程</b><small>加一站、拿掉一站、改目的地</small></span></button>
    </div>`);
  d.addEventListener('click', async ev => {
    const m = ev.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    d.close();
    if (m === 'min') return shrinkNav(true);
    if (m === 'replan') return replanFromHere();
    if (m === 'off') return changeOffSheet();
    if (m === 'times') return navPickTimes();
    if (m === 'edit') return editTripSheet();
  });
}

// 編輯行程, navigating: the places still to go (where you're heading first,
// then the rest), each changed with a tap or taken off with ×, a stop added
// first or last (the owner, 2026-10-13: one place to add a stop and take it
// off again). A change to where you're heading first re-routes (on a bus or
// train, staying on it: onBoardTo); one to the places after it only changes
// the list.
function editTripSheet() {
  const n = navNow();
  if (!n) return;
  const places = [navDest(n), ...(n.plan.then || [])];
  const rows = places
    .map((p, k) => `<div class="ot-edit-row"><button class="ot-row-btn" type="button" data-ed="${k}">${icon('pin')}<span><b>${e(p.name || '地點')}</b><small>${k === 0 ? '現在要去' : `接著第 ${k + 1} 站`}${k === places.length - 1 ? '・終點' : ''}</small></span></button>${places.length > 1 ? `<button class="q-icon-btn" type="button" data-ed-x="${k}" aria-label="拿掉 ${e(p.name || '這一站')}">${icon('x')}</button>` : ''}</div>`)
    .join('');
  const d = sheet(`${sheetHead('編輯行程', '點一站改地點，× 拿掉')}
    <div class="ot-nav-menu">${rows}
      <button class="ot-row-btn" type="button" data-ed-add="first">${icon('plus')}<span><b>先去別的地方</b><small>插在 ${e(places[0].name || '目的地')} 之前</small></span></button>
      ${places.length <= MAX_STOPS ? `<button class="ot-row-btn" type="button" data-ed-add="last">${icon('plus')}<span><b>最後再去一個地方</b><small>${e(places.at(-1).name || '終點')} 之後</small></span></button>` : ''}
    </div>`);
  d.addEventListener('click', async ev => {
    const x = ev.target.closest('[data-ed-x]')?.dataset.edX;
    const k = ev.target.closest('[data-ed]')?.dataset.ed;
    const add = ev.target.closest('[data-ed-add]')?.dataset.edAdd;
    if (x == null && k == null && !add) return;
    d.close();
    let list = places.slice();
    if (x != null) list.splice(Number(x), 1);
    else {
      const pt = await pickPoint(add === 'first' ? '先去哪裡' : add === 'last' ? '最後再去哪裡' : '改去哪裡', { onMap: false });
      if (!pt || pt.here) return;
      const p = { name: pt.name, lat: pt.lat, lon: pt.lon, ...(pt.gid ? { gid: pt.gid } : {}) };
      if (add === 'first') list = [p, ...list];
      else if (add === 'last') list = [...list, p];
      else list[Number(k)] = p;
    }
    if (navNow()?.plan !== n.plan || !list.length) return;
    // Where you're heading first unchanged: only the places after it.
    const first = list[0];
    if (first.lat === places[0].lat && first.lon === places[0].lon) {
      navRetarget(first, list.slice(1));
      return ctx.status('已更新行程');
    }
    const now = navNow();
    if (now.phase === 'on' && !['walk', 'bike'].includes(now.plan.legs[now.i]?.mode)) return onBoardTo(first, list.slice(1));
    replanFromHere(first, list.slice(1));
  });
}

// 改下車站: the ride's stops from the next one to the end of its way, each
// with when it's there; one tapped, you get off there and the rest of the
// trip is planned again from it.
function changeOffSheet() {
  const n = navNow();
  const rs = n?.ride;
  if (!rs) return;
  const from = Math.max(rs.i + 1, n.phase === 'on' ? nextOf(n) : rs.i + 1);
  const rows = [];
  for (let k = from; k < rs.stops.length; k++) {
    const t = navStopAt(k);
    rows.push(`<button class="ot-row-btn ot-off-stop${k === rs.j ? ' on' : ''}" type="button" data-k="${k}"><span><b>${e(rs.stops[k].name)}</b>${k === rs.j ? '<small>現在的下車站</small>' : ''}</span>${t ? `<time>${e(hm(t))}</time>` : ''}</button>`);
  }
  const d = sheet(`${sheetHead('改下車站', '點一站在那裡下車，之後的路重新規劃')}<div class="ot-nav-menu">${rows.join('')}</div>`);
  d.querySelector('.ot-off-stop.on')?.scrollIntoView?.({ block: 'center' });
  d.addEventListener('click', async ev => {
    const k = Number(ev.target.closest('[data-k]')?.dataset.k);
    if (!Number.isFinite(k)) return;
    d.close();
    if (k === rs.j) return;
    const stop = rs.stops[k];
    const at = navStopAt(k) ?? Date.now();
    const dest = navDest(navNow());
    ctx.status(`在 ${stop.name} 下車：重新規劃之後的路…`);
    navChangeOff(k, await restFrom({ name: stop.name, lat: stop.lat, lon: stop.lon }, dest, at));
    ctx.status(`改在 ${stop.name} 下車`);
  });
}
// On board, somewhere else: the stop of this ride nearest it, or the one you
// were getting off at, whichever has you there sooner; the rest planned from
// it, the trip going on (the owner, 2026-10-13: a new plan from here on a
// bus was no use).
async function onBoardTo(to, then) {
  const n = navNow();
  if (!n) return;
  const rs = n.ride;
  // (Its stops not known: off where it was, the rest from there.)
  if (!rs) {
    const l = n.plan.legs[n.i];
    ctx.status(`去 ${to.name}：重新規劃 ${l.to.name} 之後的路…`);
    const rest = await restFrom({ name: l.to.name, lat: l.to.lat, lon: l.to.lon }, to, l.arr);
    if (navNow()?.plan !== n.plan) return ctx.status('');
    navRetarget(to, then);
    navRest(rest);
    return ctx.status(`去 ${to.name}：在 ${l.to.name} 下車`);
  }
  const from = Math.max(rs.i + 1, nextOf(n));
  let near = from;
  for (let k = from; k < rs.stops.length; k++) if (meters(rs.stops[k].lat, rs.stops[k].lon, to.lat, to.lon) < meters(rs.stops[near].lat, rs.stops[near].lon, to.lat, to.lon)) near = k;
  const ks = [...new Set([near, rs.j])].filter(k => k >= from && k < rs.stops.length);
  ctx.status(`去 ${to.name}：找在哪一站下車…`);
  const tries = await Promise.all(
    ks.map(async k => {
      const st = rs.stops[k];
      const rest = await restFrom({ name: st.name, lat: st.lat, lon: st.lon }, to, navStopAt(k) ?? Date.now());
      return { k, rest, arr: rest.at(-1)?.arr ?? Infinity };
    })
  );
  const best = tries.sort((a, b) => a.arr - b.arr)[0];
  if (!best || navNow()?.plan !== n.plan) return ctx.status('');
  navRetarget(to, then);
  navChangeOff(best.k, best.rest);
  ctx.status(`去 ${to.name}：在 ${rs.stops[best.k].name} 下車`);
}
// Still on the bus (or train) past your stop: off at the next one (`k`), the rest from there.
async function stayedOn({ k, was, stop }) {
  const n = navNow();
  if (!n?.ride) return;
  ctx.status(`過了 ${was}：改在 ${stop.name} 下車，重新規劃之後的路…`);
  const rest = await restFrom({ name: stop.name, lat: stop.lat, lon: stop.lon }, navDest(n), navStopAt(k) ?? Date.now());
  if (navNow()?.plan !== n.plan) return ctx.status('');
  navChangeOff(k, rest);
  ctx.status(`過了 ${was}：改在 ${stop.name} 下車`);
}
const nextOf = n => {
  const rs = n.ride;
  let best = rs.i + 1;
  if (n.pos) {
    let bd = Infinity;
    for (let k = rs.i; k < rs.stops.length; k++) {
      const d = meters(n.pos.lat, n.pos.lon, rs.stops[k].lat, rs.stops[k].lon);
      if (d < bd) [best, bd] = [k + 1, d];
    }
  }
  return Math.min(best, rs.stops.length - 1);
};
// The rest of a trip from a stop, leaving when you get there: the planner's
// best way; next to the place, or nothing found, a walk.
async function restFrom(stop, dest, at) {
  const d = meters(stop.lat, stop.lon, dest.lat, dest.lon);
  const walk = () => {
    const dur = walkSec(d);
    return [{ mode: 'walk', from: stop, to: dest, dep: at, arr: at + dur * 1000, dur, dist: Math.round(d), straight: true }];
  };
  if (d < 400) return walk();
  try {
    const r = await planTrip(ctx.data, stop, dest, { at, by: 'depart' });
    const res = (await r.later) || r;
    const best = res.plans?.find(p => p.top) || res.plans?.[0];
    return best?.legs?.length ? best.legs : walk();
  } catch {
    return walk();
  }
}

// ---- Saving a trip (釘選行程): a name, an optional time, maybe every weekday ------------------------------

// A point's name for a trip's end: one of your places within 300 m, else as given.
const endName = (pt, name) => ctx.data.places.map(p => ({ p, d: meters(pt.lat, pt.lon, p.lat, p.lon) })).filter(x => x.d <= 300).sort((a, b) => a.d - b.d)[0]?.p.name || name;
export function saveTripSheet(c, { edit = null } = {}) {
  // From where you are: that spot, kept (the trip's own start, for its way
  // back and to plan from it wherever you are; the owner, 2026-10-13). 目前位置
  // ("wherever I am") only when picked so.
  let from = edit ? edit.from : c.from?.lat != null ? { name: c.fromHere ? endName(c.from, '出發地') : c.from.name, lat: c.from.lat, lon: c.from.lon } : null;
  let to = edit ? edit.to : { name: c.to.name, lat: c.to.lat, lon: c.to.lon };
  const x = edit || { name: to.name, time: '', by: 'depart', days: [], back: '', alt: [] };
  if (!edit && ctx.data.saved.length >= MAX_SAVED) return ctx.status(`最多 ${MAX_SAVED} 個行程`);
  const days = new Set(x.days);
  // Days whose times differ: one row each (平日 07:30, but 週三 09:10).
  const alt = (x.alt || []).map(a => ({ days: new Set(a.days), time: a.time, back: a.back }));
  const W = '日一二三四五六';
  const d = sheet(`${sheetHead(edit ? '編輯行程' : '釘選行程')}
    <div class="ot-field"><span>從哪裡到哪裡</span><div class="ot-nav-menu" id="st-ends"></div></div>
    <label class="ot-field"><span>名稱</span><input id="st-name" maxlength="24" value="${e(x.name)}" placeholder="例如：上學、回家"></label>
    <div class="ot-field"><span>每週這幾天（可不選）</span><div class="q-chips ot-weekdays" id="st-days"></div>
      <div class="q-chips ot-quick"><button class="q-chip" type="button" data-quick="12345">平日</button><button class="q-chip" type="button" data-quick="0123456">每天</button><button class="q-chip" type="button" data-quick="06">週末</button><button class="q-chip" type="button" data-quick="">不固定</button></div></div>
    <div class="ot-field"><span>時間（可不填）</span><div class="ot-times"><select id="st-by"><option value="depart" ${x.by === 'depart' ? 'selected' : ''}>出發</option><option value="arrive" ${x.by === 'arrive' ? 'selected' : ''}>抵達</option></select><input id="st-time" type="time" value="${e(x.time)}"></div>
      <div class="ot-times"><span class="ot-times-l wide">回程出發</span><input id="st-back" type="time" value="${e(x.back)}" aria-label="回程時間"></div></div>
    <div id="st-alt" class="ot-field"></div>
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
        (a, k) => `<div class="ot-alt"><div class="ot-alt-top"><div class="q-chips ot-weekdays small">${W.split('')
          .map((n, i) => (days.has(i) ? `<button class="q-chip" type="button" data-alt-day="${k}:${i}" aria-pressed="${a.days.has(i)}">${n}</button>` : ''))
          .join('')}</div><button class="q-icon-btn" type="button" data-alt-del="${k}" aria-label="移除">${icon('trash')}</button></div><div class="ot-times"><span class="ot-times-l">去</span><input type="time" data-alt-time="${k}" value="${e(a.time)}" aria-label="這幾天的時間"><span class="ot-times-l">回</span><input type="time" data-alt-back="${k}" value="${e(a.back)}" aria-label="這幾天的回程"></div></div>`
      )
      .join('')}${alt.length < 4 ? `<button class="ot-go-link" type="button" data-alt-add="1">${icon('plus')} 某幾天時間不一樣</button>` : ''}${alt.length ? '<p class="ot-note">沒填的時間就用上面的。</p>' : ''}`;
  };
  const drawEnds = () =>
    (d.querySelector('#st-ends').innerHTML = `<button class="ot-row-btn" type="button" data-end="from">${icon('pin')}<span><b>${e(from ? from.name : '目前位置')}</b><small>${from ? '出發' : '出發：每次從你在的地方'}</small></span></button><button class="ot-row-btn" type="button" data-end="to">${icon('pin')}<span><b>${e(to.name)}</b><small>目的地</small></span></button>`);
  drawEnds();
  drawDays();
  drawAlt();
  d.addEventListener('input', ev => {
    const t = ev.target;
    if (t.dataset.altTime) alt[Number(t.dataset.altTime)].time = t.value;
    if (t.dataset.altBack) alt[Number(t.dataset.altBack)].back = t.value;
  });
  d.addEventListener('click', async ev => {
    const end = ev.target.closest('[data-end]')?.dataset.end;
    if (end) {
      const pt = await pickPoint(end === 'from' ? '從哪裡出發' : '要去哪裡', { here: end === 'from', onMap: false });
      if (!pt || (pt.here && end === 'to')) return;
      if (end === 'from') from = pt.here ? null : { name: pt.name, lat: pt.lat, lon: pt.lon };
      else to = { name: pt.name, lat: pt.lat, lon: pt.lon };
      return drawEnds();
    }
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
