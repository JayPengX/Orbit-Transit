// 查時刻: looking up a timetable on purpose (交通 shows what's coming by
// itself). 台鐵・高鐵: station to station, the changes found (tab-train.mjs).
// 公車: a route by its number or a stop's name, in your city, its
// neighbours and 公路客運; its stops each way with the buses now, or a stop's
// whole timetable for today; ☆ pins a stop.

import * as trainTab from './tab-train.mjs';
import { cityRoutes, findRoutes, INTERCITY } from './bus.mjs';
import { openRoute, useBusCtx } from './bus-ui.mjs';
import { errorText } from './api.mjs';
import { CITIES, cityName, cityShort, NEAR_CITIES } from './city.mjs';
import { icon } from './ui.mjs';
import { e } from './util.mjs';

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

const NEAR = 'near';
const bus = { city: NEAR, list: [], failed: '', loaded: '' };

function busInit() {
  const box = $('times-bus');
  box.innerHTML = `<div class="ot-wrap">
    <div class="ot-search-in"><input id="tb-q" type="search" inputmode="search" placeholder="路線號碼或站名，例如 藍1、快捷8、5608" autocomplete="off" enterkeyhint="search"></div>
    <div class="q-chips ot-city-chips" id="tb-city"></div>
    <div id="tb-list" class="ot-list"></div></div>`;
  box.querySelector('#tb-q').addEventListener('input', busDraw);
  box.addEventListener('click', ev => {
    const c = ev.target.closest('[data-city]');
    if (c) {
      bus.city = c.dataset.city;
      return busLoad();
    }
    const r = ev.target.closest('[data-r]');
    if (r) {
      const route = bus.list.find(x => `${x.city}|${x.uid}` === r.dataset.r);
      if (route) openRoute(ctx, route, { add: true });
    }
  });
}
function busShow() {
  const home = ctx.city || 'Taipei';
  if (bus.loaded !== `${bus.city}:${home}`) busLoad();
  else busDraw();
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
function busDraw() {
  const home = ctx.city || 'Taipei';
  $('tb-city').innerHTML = [[NEAR, `${cityShort(home)}附近`], [INTERCITY, '公路客運'], ...CITIES.map(([k]) => [k, cityShort(k)])]
    .map(([k, n]) => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === bus.city}">${e(n)}</button>`)
    .join('');
  const t = $('tb-q').value;
  const found = t ? findRoutes(bus.list, t) : [];
  const where = r => (r.city === INTERCITY ? '公路客運' : cityShort(r.city));
  $('tb-list').innerHTML = !bus.list.length
    ? bus.failed
      ? `<p class="ot-note bad">${e(bus.failed)}</p>`
      : '<p class="ot-note">載入路線中…</p>'
    : !t
      ? `<p class="ot-note">${e(bus.city === NEAR ? `${cityShort(home)}、鄰近縣市與公路客運` : bus.city === INTERCITY ? '公路客運與國道客運' : cityName(bus.city))}共 ${bus.list.length} 條路線：輸入號碼或站名，點路線看即時到站或時刻表，點站牌 ☆ 釘選。</p>`
      : found.map(r => `<button class="ot-row-btn" type="button" data-r="${e(`${r.city}|${r.uid}`)}"><span class="ot-route-no">${e(r.name)}</span><span><b>${e(r.from)} ↔ ${e(r.to)}</b><small>${e(where(r))}</small></span>${icon('chevron')}</button>`).join('') || '<p class="ot-note">沒有符合的路線，試試其他縣市。</p>';
}
