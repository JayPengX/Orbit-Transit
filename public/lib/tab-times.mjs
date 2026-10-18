// 查時刻: looking up a timetable on purpose (交通 shows what's coming by
// itself). 台鐵・高鐵: station to station, the changes found (tab-train.mjs).
// 公車: a route by its number or a stop's name, in your city, its
// neighbours and 公路客運; its stops each way with the buses now, or a stop's
// timetable for any day of the coming week; ☆ pins a stop.

import * as trainTab from './tab-train.mjs';
import { cityRoutes, findRoutes, stationsNear, routeCity, INTERCITY } from './bus.mjs';
import { openRoute, useBusCtx, strip, fitStrips, nextNear, busWhen } from './bus-ui.mjs';
import { errorText } from './api.mjs';
import { CITIES, cityShort, NEAR_CITIES } from './city.mjs';
import { icon } from './ui.mjs';
import { nearStops as busNear } from './bus-ui.mjs';
import { COLOR, pageHead, dateLine, tile, tag, countHtml, tick, hero } from './premium.mjs';
import { e, meters, distText, readJson, readSaved, UNREAD, writeJson } from './util.mjs';

import { W } from './lang.mjs';
const $ = id => document.getElementById(id);
const KEY = 'orbit-transit.times';
let ctx = null;
let view = 'train';
let trainStarted = false;

export function init(c) {
  ctx = c;
  useBusCtx(c);
  try {
    view = localStorage.getItem(KEY) === 'bus' ? 'bus' : 'train';
  } catch {}
  $('times-title').innerHTML = pageHead(W('查時刻', 'Times'), dateLine());
  $('times-seg').addEventListener('click', ev => {
    const b = ev.target.closest('[data-view]');
    if (b) pick(b.dataset.view);
  });
  busInit();
}

// What the opening waits for (a moment at most) when it opens on this tab.
export const ready = () => (view === 'train' ? trainTab.ready : Promise.resolve());

export function show() {
  if (ctx.trainQuery || ctx.trainFrom) view = 'train';
  pick(view);
}

function pick(v) {
  view = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {}
  $('times-seg').querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('panel-train').hidden = v !== 'train';
  $('times-bus').hidden = v !== 'bus';
  if (v === 'train') {
    if (!trainStarted) {
      trainStarted = true;
      trainTab.init(ctx);
    }
    trainTab.show();
  } else busShow();
}

// ---- 公車 -----------------------------------------------------------------------------------------------
// Nothing typed: the routes you looked at lately (rows) and the stops
// around you, each with its routes' numbers; typed: the routes found, each
// with its two ends (and TPASS when your pass takes it).

const NEAR = 'near';
const RECENT = 'orbit-transit.routes';
const bus = { city: NEAR, list: [], failed: '', loaded: '', around: null };
const routesIn = r => (Array.isArray(r) ? r.filter(x => x?.uid && x.name).slice(0, 8) : []);
const recentRoutes = () => routesIn(readJson(RECENT, []));
function rememberRoute(r) {
  const kept = readSaved(RECENT, []);
  if (kept === UNREAD) return; // (never saved over)
  writeJson(RECENT, [{ uid: r.uid, name: r.name, city: r.city, from: r.from || '', to: r.to || '' }, ...routesIn(kept).filter(x => x.uid !== r.uid)].slice(0, 8));
}
// (From a stop near you: the route at that stop, scrolled to it.)
const openBus = (r, stopUID = '', stopName = '') => {
  rememberRoute(r);
  openRoute(ctx, r, { add: true, stopUID, stopName });
  setTimeout(busDraw, 300);
};

function busInit() {
  const box = $('times-bus');
  box.innerHTML = `<div class="ot-wrap ot-bus"><div id="tb-hero"></div><div class="ot-bus-top">
    <label class="q-search ot-search-in"><input id="tb-q" type="search" inputmode="search" placeholder="${W('路線或站名，如 藍1、5608', 'Route or stop, e.g. 307')}" autocomplete="off" enterkeyhint="search"><button class="q-search-clear" type="button" aria-label="${W('清除', 'Clear')}">✕</button></label>
    <div class="q-chips ot-city-chips ot-scroll-chips" id="tb-city"></div></div>
    <div id="tb-list"></div></div>`;
  // (Drawn once the typing pauses: each letter asked for every route it matched.)
  let typing = 0;
  box.querySelector('#tb-q').addEventListener('input', ev => {
    clearTimeout(typing);
    typing = setTimeout(() => busDraw(ev), 200);
  });
  box.addEventListener('click', ev => {
    const c = ev.target.closest('[data-city]');
    if (c) {
      bus.city = c.dataset.city;
      return busLoad();
    }
    const r = ev.target.closest('[data-r]');
    if (r) {
      const [city, uid] = r.dataset.r.split('|');
      return openBus(routeOf(city, uid, r.dataset.name || ''), r.dataset.stop || '', r.dataset.stopName || r.closest('.ot-bus-stop')?.querySelector('.ot-bus-stop-h b')?.textContent || '');
    }
    if (ev.target.closest('[data-clear-routes]')) {
      writeJson(RECENT, null);
      busDraw();
    }
  });
}
// The next buses again every 30 s while the list is on screen (only the
// strips in view are asked).
let ticking = 0;
let ticks = 0;
function busShow() {
  ticking ||= setInterval(() => !$('times-bus').hidden && $('times-bus').offsetParent && document.visibilityState === 'visible' && (busDraw(), heroLoad()), 30_000);
  ticks ||= setInterval(() => !$('times-bus').hidden && tick($('tb-hero')), 5000);
  heroLoad();
  const home = ctx.city || 'Taipei';
  if (bus.loaded !== `${bus.city}:${home}`) busLoad();
  else busDraw();
  if (!bus.around) aroundRoutes();
}
// The bus due soonest at the stops around you, as the page's one card: its
// countdown runs on between reads.
let near = null;
let nearAsking = false;
async function heroLoad() {
  const h = ctx.here || (await ctx.locate());
  if (!h || nearAsking || (near && Date.now() - near.at < 20_000)) return heroDraw();
  nearAsking = true;
  try {
    const stops = await busNear(h, { n: 3, r: 350 });
    const x = stops.flatMap(st => st.rows.slice(0, 2).map(r => ({ ...r, dist: st.dist }))).filter(r => r.v?.status === 0 && r.v.sec != null).sort((a, b) => a.v.sec - b.v.sec)[0];
    near = { at: Date.now(), x: x ? { ...x, at: Date.now() + x.v.sec * 1000 } : null };
  } catch {
    near = { at: Date.now(), x: near?.x || null };
  }
  nearAsking = false;
  heroDraw();
}
function heroDraw() {
  const box = $('tb-hero');
  if (!box) return;
  const x = near?.x;
  box.innerHTML = x && x.at > Date.now() - 60_000
    ? hero({ eyebrow: W('附近的下一班', 'Next near you'), glyph: 'bus', big: countHtml(x.at, { floor: true }), title: `${x.route}${x.stop ? `・${x.stop}` : ''}`, sub: Number.isFinite(x.dist) ? W(`距離 ${distText(x.dist)}`, `${distText(x.dist)} away`) : W('附近站牌', 'Nearby stop'), tags: [tag(W('即時', 'Live'), 'solid green'), x.v.last ? tag(W('末班車', 'Last bus'), 'solid red') : ''], attrs: `data-r="${e(`${x.city}|${x.uid}`)}" data-name="${e(x.route)}" data-stop="${e(x.stopUID)}" data-stop-name="${e(x.stop)}"` })
    : near ? '' : hero({ eyebrow: W('附近的下一班', 'Next near you'), glyph: 'bus', big: '<strong class="q-hc-big ot-count">…</strong>', title: W('找附近的公車', 'Finding buses nearby'), empty: true });
}

// The stops within ~400 m of you, nearest first, each with its routes:
// [{ name, dist, routes: [{ uid, name, city }] }] (a stop's two sides as one).
async function aroundRoutes() {
  const h = ctx.here || (await ctx.locate());
  if (!h) return;
  try {
    const list = await stationsNear(h.lat, h.lon);
    const byName = new Map();
    for (const s of list) {
      const dist = meters(h.lat, h.lon, s.lat, s.lon);
      if (dist > 400) continue;
      const stop = byName.get(s.name) || { name: s.name, dist, routes: new Map() };
      stop.dist = Math.min(stop.dist, dist);
      for (const x of s.stops) if (!stop.routes.has(x.routeUID)) stop.routes.set(x.routeUID, { uid: x.routeUID, name: x.route, city: routeCity(x.routeUID), stopUID: x.stopUID });
      byName.set(s.name, stop);
    }
    const byNo = (a, b) => a.name.localeCompare(b.name, 'zh-Hant', { numeric: true });
    bus.around = [...byName.values()]
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)
      .map(x => ({ ...x, routes: [...x.routes.values()].sort(byNo) }));
  } catch {
    bus.around = [];
  }
  busDraw();
}
async function busLoad() {
  const home = ctx.city || 'Taipei';
  bus.loaded = `${bus.city}:${home}`;
  bus.list = [];
  bus.failed = '';
  busDraw();
  const want = bus.city === NEAR ? [home, ...(NEAR_CITIES[home] || []), INTERCITY] : [bus.city];
  const got = await Promise.all(want.map(c => cityRoutes(c).catch(err => ((bus.failed = errorText(err)), []))));
  bus.list = got.flat();
  busDraw();
}
const where = r => (r.city === INTERCITY ? W('公路客運', 'Intercity') : cityShort(r.city));
// A route as a strip: its next bus at its stop nearest you (that stop, over
// the way it goes, and when); with no position, or none found, where it runs
// between. Still being asked: the strip in its place with bars (no row
// changes shape or pops in on its own).
const row = r => {
  const n = next.get(r.uid);
  const attrs = `data-r="${e(`${r.city}|${r.uid}`)}" data-name="${e(r.name)}"`;
  if (n?.x) return `<div class="ot-strip">${strip({ no: r.name, note: `${W('往', 'to')} ${e(n.x.headsign)}`, main: e(n.x.stop), eta: busWhen(n.x.v, n.x.planned), attrs: `${attrs} data-stop="${e(n.x.stopUID)}" data-stop-name="${e(n.x.stop)}"` })}</div>`;
  if (ctx.here && !n?.at) return `<div class="ot-strip">${strip({ no: r.name, wait: true, attrs })}</div>`;
  const ends = r.from && r.to ? `${e(r.from)}<i>↔</i>${e(r.to)}` : e(r.to ? `${W('往', 'to')} ${r.to}` : where(r));
  return `<div class="ot-strip">${strip({ no: r.name, note: e(where(r)), main: ends, attrs })}</div>`;
};
// Each route's next bus, asked for the strips on screen (a search's 60
// routes aren't 60 asks), kept 25 s like the route's sheet. The strips that
// come into view together are asked together and drawn once, when all are in
// (8 s at most: a first search reads each route's stops, the long
// intercity ones taking seconds; one stuck answer doesn't hold the rest
// longer), not one by one.
const next = new Map();
const NEXT_MS = 25_000;
const BATCH_WAIT_MS = 8000;
let seen = null;
const routeOf = (city, uid, name = '') => bus.list.find(x => x.uid === uid) || recentRoutes().find(x => x.uid === uid) || bus.around?.flatMap(x => x.routes).find(x => x.uid === uid) || { uid, city, name };
async function askNext(els) {
  if (!ctx.here) return;
  const due = els
    .map(el => [el, ...el.dataset.r.split('|')])
    .filter(([, , uid], k, all) => all.findIndex(x => x[2] === uid) === k)
    .filter(([, , uid]) => {
      const old = next.get(uid);
      return !old?.asking && !(old?.at && Date.now() - old.at < NEXT_MS);
    });
  if (!due.length) return;
  for (const [, , uid] of due) next.set(uid, { ...next.get(uid), asking: true });
  const ask = ([el, city, uid]) =>
    nextNear(routeOf(city, uid, el.dataset.name), ctx.here)
      .catch(() => next.get(uid)?.x || null)
      .then(x => next.set(uid, { at: Date.now(), x }));
  const all = Promise.all(due.map(ask));
  const whole = await Promise.race([all.then(() => true), new Promise(r => setTimeout(r, BATCH_WAIT_MS, false))]);
  busDraw();
  // (Any still out keep their bars, and are drawn together when they land.)
  if (!whole) all.then(busDraw);
}
function watchRows() {
  seen?.disconnect();
  seen = new IntersectionObserver(list => askNext(list.filter(x => x.isIntersecting).map(x => x.target)));
  for (const el of $('tb-list').querySelectorAll('.ot-strip-main[data-r]')) seen.observe(el);
}
// A stop near you: its name and distance, its routes as numbers to tap.
const nearStop = s => `<div class="ot-bus-stop"><div class="ot-bus-stop-h">${tile('bus', COLOR.bus, 'sm')}<b>${e(s.name)}</b>${tag(distText(s.dist))}</div><div class="ot-bus-nos">${s.routes.map(r => `<button class="ot-bus-chip" type="button" data-r="${e(`${r.city}|${r.uid}`)}" data-name="${e(r.name)}"${r.stopUID ? ` data-stop="${e(r.stopUID)}"` : ''}>${e(r.name)}</button>`).join('')}</div></div>`;
function busDraw() {
  const home = ctx.city || 'Taipei';
  $('tb-city').innerHTML = [[NEAR, W(`${cityShort(home)}附近`, `Near ${cityShort(home)}`)], [INTERCITY, W('公路客運', 'Intercity')], ...CITIES.map(([k]) => [k, cityShort(k)])]
    .map(([k, n]) => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === bus.city}">${e(n)}</button>`)
    .join('');
  const t = $('tb-q').value;
  if (!t) {
    const recent = recentRoutes();
    const around = bus.around || [];
    $('tb-list').innerHTML =
      (recent.length ? `<section class="q-section ot-sec"><div class="q-section-head"><h2>${W('最近查看', 'Recent')}</h2><button type="button" data-clear-routes="1">${W('清除', 'Clear')}</button></div><div class="q-rowcard ot-bus-group">${recent.slice(0, 5).map(row).join('')}</div></section>` : '') +
      (around.length ? `<section class="q-section ot-sec"><div class="q-section-head"><h2>${W('附近站牌', 'Stops near you')}</h2></div><div class="q-rowcard ot-bus-near">${around.map(nearStop).join('')}</div></section>` : bus.around ? '' : `<p class="ot-note">${W('找你附近的站牌…', 'Finding stops near you…')}</p>`) +
      (bus.failed && !bus.list.length ? `<p class="ot-note bad">${e(bus.failed)}</p>` : '');
  } else {
    const found = findRoutes(bus.list, t);
    $('tb-list').innerHTML = !bus.list.length
      ? `<p class="ot-note${bus.failed ? ' bad' : ''}">${e(bus.failed || W('載入路線中…', 'Loading routes…'))}</p>`
      : found.length
        ? `<div class="q-rowcard ot-bus-group">${found.map(row).join('')}</div>`
        : `<p class="ot-note">${W('沒有符合的路線，試試其他縣市。', 'No matching route. Try another city.')}</p>`;
  }
  fitStrips($('tb-list'));
  watchRows();
}
