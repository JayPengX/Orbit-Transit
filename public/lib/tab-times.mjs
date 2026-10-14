// 查時刻: looking up a timetable on purpose (交通 shows what's coming by
// itself). 台鐵・高鐵: station to station, the changes found (tab-train.mjs).
// 公車: a route by its number or a stop's name, in your city, its
// neighbours and 公路客運; its stops each way with the buses now, or a stop's
// timetable for any day of the coming week; ☆ pins a stop.

import * as trainTab from './tab-train.mjs';
import { cityRoutes, findRoutes, stationsNear, routeCity, INTERCITY } from './bus.mjs';
import { tpassOf, routeOnPass } from './tpass.mjs';
import { openRoute, useBusCtx, strip, fitStrips, nextNear, busWhen } from './bus-ui.mjs';
import { errorText } from './api.mjs';
import { CITIES, cityShort, NEAR_CITIES } from './city.mjs';
import { icon } from './ui.mjs';
import { e, meters } from './util.mjs';

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
  $('times-seg').addEventListener('click', ev => {
    const b = ev.target.closest('[data-view]');
    if (b) pick(b.dataset.view);
  });
  busInit();
}

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
const recentRoutes = () => {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT) || '[]');
    return Array.isArray(r) ? r.filter(x => x?.uid && x.name).slice(0, 8) : [];
  } catch {
    return [];
  }
};
function rememberRoute(r) {
  try {
    localStorage.setItem(RECENT, JSON.stringify([{ uid: r.uid, name: r.name, city: r.city, from: r.from || '', to: r.to || '' }, ...recentRoutes().filter(x => x.uid !== r.uid)].slice(0, 8)));
  } catch {}
}
// (From a stop near you: the route at that stop, scrolled to it.)
const openBus = (r, stopUID = '', stopName = '') => {
  rememberRoute(r);
  openRoute(ctx, r, { add: true, stopUID, stopName });
  setTimeout(busDraw, 300);
};

function busInit() {
  const box = $('times-bus');
  box.innerHTML = `<div class="ot-wrap ot-bus"><div class="ot-bus-top">
    <label class="q-search ot-search-in"><input id="tb-q" type="search" inputmode="search" placeholder="路線或站名，如 藍1、5608" autocomplete="off" enterkeyhint="search"><button class="q-search-clear" type="button" aria-label="清除">✕</button></label>
    <div class="q-chips ot-city-chips ot-scroll-chips" id="tb-city"></div></div>
    <div id="tb-list"></div></div>`;
  box.querySelector('#tb-q').addEventListener('input', busDraw);
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
      try {
        localStorage.removeItem(RECENT);
      } catch {}
      busDraw();
    }
  });
}
// The next buses again every 30 s while the list is on screen (only the
// strips in view are asked).
let ticking = 0;
function busShow() {
  ticking ||= setInterval(() => !$('times-bus').hidden && $('times-bus').offsetParent && document.visibilityState === 'visible' && busDraw(), 30_000);
  const home = ctx.city || 'Taipei';
  if (bus.loaded !== `${bus.city}:${home}`) busLoad();
  else busDraw();
  if (!bus.around) aroundRoutes();
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
const where = r => (r.city === INTERCITY ? '公路客運' : cityShort(r.city));
// A city bus inside your TPASS's cities (公路客運 runs between them: not marked).
const onPass = r => routeOnPass(tpassOf(ctx.data.prefs.tpass), r.city, r.name);
// A route as a strip: its next bus at its stop nearest you (that stop, the
// way it goes, when it comes); until that's known, or with no position,
// where it runs between.
const row = r => {
  const n = next.get(r.uid)?.x;
  const tags = `${e(where(r))}${onPass(r) ? ' · <em>TPASS</em>' : ''}`;
  const attrs = `data-r="${e(`${r.city}|${r.uid}`)}" data-name="${e(r.name)}"`;
  if (n) return `<div class="ot-strip">${strip({ no: r.name, note: `往 ${e(n.headsign)} · ${tags}`, main: e(n.stop), eta: busWhen(n.v, n.planned), attrs: `${attrs} data-stop="${e(n.stopUID)}" data-stop-name="${e(n.stop)}"` })}</div>`;
  const ends = r.from && r.to ? `${e(r.from)}<i>↔</i>${e(r.to)}` : e(r.to ? `往 ${r.to}` : where(r));
  return `<div class="ot-strip">${strip({ no: r.name, note: tags, main: ends, attrs })}</div>`;
};
// Each route's next bus, asked for the strips on screen as each comes into
// view (a search's 60 routes aren't 60 asks), kept 25 s like the route's sheet.
const next = new Map();
const NEXT_MS = 25_000;
let seen = null;
let redraw = 0;
const routeOf = (city, uid, name = '') => bus.list.find(x => x.uid === uid) || recentRoutes().find(x => x.uid === uid) || bus.around?.flatMap(x => x.routes).find(x => x.uid === uid) || { uid, city, name };
async function askNext(el) {
  const [city, uid] = el.dataset.r.split('|');
  const old = next.get(uid);
  if (!ctx.here || old?.asking || (old && Date.now() - old.at < NEXT_MS)) return;
  next.set(uid, { ...old, asking: true });
  let x = old?.x || null;
  try {
    x = await nextNear(routeOf(city, uid, el.dataset.name), ctx.here);
  } catch {}
  next.set(uid, { at: Date.now(), x });
  clearTimeout(redraw);
  redraw = setTimeout(busDraw, 80);
}
function watchRows() {
  seen?.disconnect();
  seen = new IntersectionObserver(list => list.forEach(x => x.isIntersecting && askNext(x.target)));
  for (const el of $('tb-list').querySelectorAll('.ot-strip-main[data-r]')) seen.observe(el);
}
// A stop near you: its name and distance, its routes as numbers to tap.
const nearStop = s => `<div class="ot-bus-stop"><div class="ot-bus-stop-h"><b>${e(s.name)}</b><small>${Math.round(s.dist / 10) * 10} 公尺</small></div><div class="ot-bus-nos">${s.routes.map(r => `<button class="ot-bus-chip" type="button" data-r="${e(`${r.city}|${r.uid}`)}" data-name="${e(r.name)}"${r.stopUID ? ` data-stop="${e(r.stopUID)}"` : ''}>${e(r.name)}</button>`).join('')}</div></div>`;
function busDraw() {
  const home = ctx.city || 'Taipei';
  $('tb-city').innerHTML = [[NEAR, `${cityShort(home)}附近`], [INTERCITY, '公路客運'], ...CITIES.map(([k]) => [k, cityShort(k)])]
    .map(([k, n]) => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === bus.city}">${e(n)}</button>`)
    .join('');
  const t = $('tb-q').value;
  if (!t) {
    const recent = recentRoutes();
    const around = bus.around || [];
    $('tb-list').innerHTML =
      (recent.length ? `<h3 class="ot-go-h">最近查看<button class="ot-res-clear" type="button" data-clear-routes="1">清除</button></h3><div class="ot-bus-group">${recent.slice(0, 5).map(row).join('')}</div>` : '') +
      (around.length ? `<h3 class="ot-go-h">${icon('pin')} 你附近的站牌</h3><div class="ot-bus-near">${around.map(nearStop).join('')}</div>` : bus.around ? '' : '<p class="ot-note">找你附近的站牌…</p>') +
      (bus.failed && !bus.list.length ? `<p class="ot-note bad">${e(bus.failed)}</p>` : '');
  } else {
    const found = findRoutes(bus.list, t);
    $('tb-list').innerHTML = !bus.list.length
      ? `<p class="ot-note${bus.failed ? ' bad' : ''}">${e(bus.failed || '載入路線中…')}</p>`
      : found.length
        ? `<div class="ot-bus-group">${found.map(row).join('')}</div>`
        : '<p class="ot-note">沒有符合的路線，試試其他縣市。</p>';
  }
  fitStrips($('tb-list'));
  watchRows();
}
