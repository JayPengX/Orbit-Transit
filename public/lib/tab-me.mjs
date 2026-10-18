// 我的: everything you keep, and how the planner should plan for you.
//
//   地點         pinned places (家, 學校…): renamed, reordered, removed
//   行程         saved trips: a place to a place, maybe at a time, maybe every
//                weekday (常用行程; the way back comes by itself)
//   釘選交通     bus stops in groups, trains (a connection, or one train)
//   交通偏好     which ways of moving to use (all public transport, or some
//                left out), 每 30 分鐘換 YouBike, which TPASS you have
//   捷運路網圖   each city's metro on the real map, a station's next trains

import * as metroTab from './tab-metro.mjs';
import { manageSheet, useBusCtx } from './bus-ui.mjs';
import { MODES, PLACE_ICONS, DAYS, move } from './store.mjs';
import { TPASSES, tpassOf } from './tpass.mjs';
import { sheet, sheetHead, icon, trainKind, stationLabel } from './ui.mjs';
import { e, distText, meters } from './util.mjs';
import { COLOR, pageHead, tile, tag, section, rowCard, hero } from './premium.mjs';

import { W, en } from './lang.mjs';
const $ = id => document.getElementById(id);
let ctx = null;
let metroOpen = false;


// What other tabs ask of this one (交通's pencil, the map's 編輯), set at the
// start: this tab's init runs only when it's first opened, and a tap before
// that did nothing.
export function register(c) {
  ctx = c;
  useBusCtx(c);
  ctx.editTrip = id => {
    const t = ctx.data.saved.find(x => x.id === id);
    if (t) ctx.saveTrip?.(null, { edit: t });
  };
  ctx.editPlace = placeSheet;
  ctx.openMetro = () => {
    ctx.goTab('me');
    openMetro();
  };
}
export function init(c) {
  register(c);
  $('me-main').addEventListener('click', onClick);
  (ctx.onRefresh ||= []).push(() => render());
}
export function show() {
  if (metroOpen) metroTab.show();
  else render();
}
export function hide() {
  metroTab.hide?.();
}

const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysText = d => (!d.length ? '' : d.length === 5 && [1, 2, 3, 4, 5].every(x => d.includes(x)) ? W('平日', 'Weekdays') : d.length === 7 ? W('每天', 'Daily') : d.length === 2 && d.includes(0) && d.includes(6) ? W('週末', 'Weekends') : W(`每週${d.map(x => DAYS[x]).join('、')}`, d.map(x => DAYS_EN[x]).join(', ')));

function render() {
  if (metroOpen) return;
  const D = ctx.data;
  const P = D.prefs;
  const pass = tpassOf(P.tpass);
  const allOn = Object.values(P.modes).every(Boolean);
  const PLACE_GLYPH = { home: 'pin', work: 'route', school: 'star', pin: 'pin', star: 'star' };
  const add = (act, text) => `<button class="q-ritem ot-add-row" type="button" data-act="${act}">${tile('plus', '', '', false).replace('q-tile', 'q-tile soft')}<span class="q-ritem-text"><span class="q-ritem-title">${text}</span></span></button>`;
  const places = D.places
    .map((p, i) => `<div class="q-ritem ot-order">${`<button class="ot-place-name" type="button" data-place-edit="${e(p.id)}">${tile(PLACE_GLYPH[p.icon] || 'pin', COLOR.place)}<span class="q-ritem-text"><span class="q-ritem-title">${e(p.name)}</span>${p.address || ctx.here ? `<small>${e(p.address || `${W('距離 ', '')}${distText(meters(ctx.here.lat, ctx.here.lon, p.lat, p.lon))}${W('', ' away')}`)}</small>` : ''}</span></button>`}<button class="q-icon-btn" type="button" data-place-up="${i}" aria-label="${W('上移', 'Move up')}" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="q-icon-btn" type="button" data-place-del="${e(p.id)}" aria-label="${W('刪除', 'Delete')}">${icon('trash')}</button></div>`)
    .join('');
  const trips = D.saved
    .map(t => {
      const tags = [t.time ? tag(`${t.by === 'arrive' ? W('抵達', 'Arrive') : W('出發', 'Leave')} ${t.time}`, 'blue') : '', t.days.length ? tag(daysText(t.days), 'green') : '', t.back ? tag(`${W('回程', 'Back')} ${t.back}`, 'indigo') : '', ...(t.alt || []).map(a => tag(`${en ? a.days.map(x => DAYS_EN[x]).join(', ') : `週${a.days.map(x => DAYS[x]).join('')}`} ${[a.time, a.back && `${W('回', 'back')} ${a.back}`].filter(Boolean).join(' ')}`))].join('');
      return `<button class="q-ritem chevron" type="button" data-trip="${e(t.id)}">${tile(t.days.length ? 'clock' : 'route', COLOR.route)}<span class="q-ritem-text"><span class="q-ritem-title">${e(t.name || t.to.name)}</span><small>${e(t.from ? t.from.name : W('目前位置', 'Here'))} → ${e(t.to.name)}</small>${tags ? `<span class="q-tags">${tags}</span>` : ''}</span></button>`;
    })
    .join('');
  const pins = D.pins
    .map(p => `<div class="q-ritem">${tile(p.from.sys === 'hsr' ? 'hsr' : 'tra', p.from.sys === 'hsr' ? COLOR.hsr : COLOR.tra)}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(p.from))} → ${e(stationLabel(p.to))}</span><small>${p.kind === 'trainNo' ? `${e(trainKind(p.type || ''))} ${e(p.no)}${W(' 次', '')}${p.dep ? ` · ${e(p.dep)}` : ''}` : W('每一班', 'Every train')}</small></span><button class="q-icon-btn" type="button" data-pin-del="${e(p.id)}" aria-label="${W('刪除', 'Delete')}">${icon('trash')}</button></div>`)
    .join('');
  const stops = D.groups.reduce((n, g) => n + g.items.length, 0);
  $('me-main').innerHTML = `<div class="ot-wrap ot-mine">
    ${pageHead(W('我的', 'Me'), W('地點、行程與偏好', 'Places, trips and settings'))}
    ${hero({ eyebrow: W('捷運路網圖', 'Metro map'), glyph: 'metro', title: W('車站在真正的地圖上', 'Stations on the real map'), sub: W('點車站，看下一班', 'Tap a station for the next trains'), tags: [], color: COLOR.metro, attrs: 'data-act="metro"' })}
    <div class="q-stats ot-stats" style="--q-stats-n:3">
      <div class="q-stat">${tile('pin', COLOR.place, 'sm')}<small>${W('地點', 'Places')}</small><strong>${D.places.length}</strong></div>
      <div class="q-stat">${tile('route', COLOR.route, 'sm')}<small>${W('行程', 'Trips')}</small><strong>${D.saved.length}</strong></div>
      <div class="q-stat">${tile('bus', COLOR.bus, 'sm')}<small>${W('釘選', 'Pinned')}</small><strong>${stops + D.pins.length}</strong></div>
    </div>
    ${section(W('地點', 'Places'), rowCard(places + add('add-place', W('在地圖上釘選地點', 'Pin a place on the map'))))}
    ${section(W('行程', 'Trips'), rowCard(trips + add('add-trip', W('新增行程', 'Add a trip'))))}
    ${section(
      W('釘選交通', 'Pinned rides'),
      rowCard(`<button class="q-ritem chevron" type="button" data-act="groups">${tile('bus', COLOR.bus)}<span class="q-ritem-text"><span class="q-ritem-title">${W('公車站牌', 'Bus stops')}</span><small>${e(D.groups.map(g => `${g.name} ${g.items.length}`).join('、'))}</small></span></button>${pins}${add('times', W('查時刻，釘選火車或公車', 'Find times to pin'))}`)
    )}
    ${section(
      W('交通偏好', 'Preferences'),
      `<div class="q-rowcard ot-pad"><p class="ot-pref-h">${W('路線規劃使用', 'Routes may use')}</p><div class="q-chips ot-modes"><button class="q-chip" type="button" data-all-modes="1" aria-pressed="${allOn}">${W('全部大眾運輸', 'All transit')}</button>${Object.entries(MODES).map(([k, n]) => `<button class="q-chip" type="button" data-mode="${k}" aria-pressed="${P.modes[k]}">${e(n)}</button>`).join('')}</div></div>
      ${rowCard(`${pass?.bike ? '' : `<div class="q-ritem">${tile('bike', COLOR.bike)}<span class="q-ritem-text"><span class="q-ritem-title">${W('每 30 分鐘換車', 'Swap YouBikes every 30 min')}</span><small>${W('長程騎車時，半路還車再借', 'On long rides, re-rent on the way')}</small></span><button class="q-switch" type="button" role="switch" data-act="bike30" aria-checked="${P.bike30}" aria-label="${W('每 30 分鐘換車', 'Swap every 30 min')}"><i></i></button></div>`}
        <label class="q-ritem ot-sel-row">${tile('route', COLOR.route)}<span class="q-ritem-text"><span class="q-ritem-title">${W('導航 App', 'Maps app')}</span></span><select id="me-maps"><option value="google" ${P.maps !== 'apple' ? 'selected' : ''}>${W('Google 地圖', 'Google Maps')}</option><option value="apple" ${P.maps === 'apple' ? 'selected' : ''}>${W('Apple 地圖', 'Apple Maps')}</option></select></label>
        <label class="q-ritem ot-sel-row">${tile('tra', COLOR.tra)}<span class="q-ritem-text"><span class="q-ritem-title">${W('我的 TPASS', 'TPASS')}</span>${pass ? `<small>${W('範圍內公車、台鐵、捷運 NT$0', 'Buses, TRA, metro inside: NT$0')}${pass.bike ? W('；YouBike 前 30 分鐘免費', '; YouBike’s first 30 min free') : ''}</small>` : ''}</span><select id="me-tpass"><option value="">${W('沒有 TPASS', 'No TPASS')}</option>${TPASSES.map(t => `<option value="${t.id}" ${t.id === P.tpass ? 'selected' : ''}>${e(t.name)}${W(`（NT$${t.price}）`, ` (NT$${t.price})`)}</option>`).join('')}</select></label>`)}`
    )}
  </div>`;
}

function onClick(ev) {
  const D = ctx.data;
  const t = ev.target.closest('[data-trip]');
  if (t) return ctx.editTrip(t.dataset.trip);
  const pe = ev.target.closest('[data-place-edit]');
  if (pe) return placeSheet(pe.dataset.placeEdit);
  const up = ev.target.closest('[data-place-up]');
  if (up) {
    D.places = move(D.places, Number(up.dataset.placeUp), -1);
    return done();
  }
  const pd = ev.target.closest('[data-place-del]');
  if (pd) {
    D.places = D.places.filter(p => p.id !== pd.dataset.placeDel);
    return done();
  }
  const pin = ev.target.closest('[data-pin-del]');
  if (pin) {
    D.pins = D.pins.filter(p => p.id !== pin.dataset.pinDel);
    return done();
  }
  const m = ev.target.closest('[data-mode]');
  if (m) {
    D.prefs.modes[m.dataset.mode] = !D.prefs.modes[m.dataset.mode];
    // Nothing left: everything (no plan can be made of nothing).
    if (!Object.values(D.prefs.modes).some(Boolean)) for (const k of Object.keys(MODES)) D.prefs.modes[k] = true;
    return done();
  }
  if (ev.target.closest('[data-all-modes]')) {
    for (const k of Object.keys(MODES)) D.prefs.modes[k] = true;
    return done();
  }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'bike30') {
    D.prefs.bike30 = !D.prefs.bike30;
    return done();
  }
  if (act === 'groups') return manageSheet();
  if (act === 'times') return ctx.goTab('times');
  if (act === 'metro') return openMetro();
  if (act === 'add-place') {
    ctx.goTab('map');
    ctx.status(W('搜尋或點地圖上的地點，再按「釘選」', 'Search or tap a place on the map, then Pin'));
    return setTimeout(() => document.getElementById('q')?.focus(), 200);
  }
  if (act === 'add-trip') return ctx.newTrip?.();
}
document.addEventListener('change', ev => {
  if (!ctx || !['me-tpass', 'me-maps'].includes(ev.target.id)) return;
  if (ev.target.id === 'me-maps') ctx.data.prefs.maps = ev.target.value === 'apple' ? 'apple' : 'google';
  else ctx.data.prefs.tpass = ev.target.value;
  done();
});
// A pinned place's name and icon.
function placeSheet(id) {
  const p = ctx.data.places.find(x => x.id === id);
  if (!p) return;
  let ic = p.icon;
  const d = sheet(`${sheetHead(W('編輯地點', 'Edit place'), p.address ? `<span class="ot-sub-1">${e(p.address)}</span>` : '')}
    <label class="ot-field"><span>${W('名稱', 'Name')}</span><input id="pl-name" maxlength="30" value="${e(p.name)}" placeholder="${W('例如：家、公司、學校', 'e.g. Home, Work, School')}"></label>
    <div class="ot-field"><span>${W('圖示', 'Icon')}</span><div class="q-chips">${Object.entries(PLACE_ICONS).map(([k, v]) => `<button class="q-chip" type="button" data-icon="${k}" aria-pressed="${k === ic}">${v}</button>`).join('')}</div></div>
    <div class="ot-row ot-actions"><button class="q-btn" type="button" data-del="1">${W('刪除', 'Delete')}</button><button class="q-btn primary" type="button" data-save="1">${W('儲存', 'Save')}</button></div>`);
  setTimeout(() => d.querySelector('#pl-name').select(), 50);
  d.addEventListener('click', ev => {
    const b = ev.target.closest('[data-icon]');
    if (b) {
      ic = b.dataset.icon;
      return d.querySelectorAll('[data-icon]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.icon === ic)));
    }
    if (ev.target.closest('[data-del]')) ctx.data.places = ctx.data.places.filter(x => x.id !== id);
    else if (ev.target.closest('[data-save]')) ctx.data.places = ctx.data.places.map(x => (x.id === id ? { ...x, name: d.querySelector('#pl-name').value.trim().slice(0, 30) || x.name, icon: ic } : x));
    else return;
    d.shut();
    done();
  });
}
function done() {
  ctx.save();
  render();
  ctx.refreshTabs?.();
}

// ---- 捷運路網圖: a page of its own inside 我的 ---------------------------------------------------------

let metroStarted = false;
function openMetro() {
  metroOpen = true;
  $('me-main').hidden = true;
  $('panel-metro').hidden = false;
  document.body.classList.add('ot-metro-on');
  if (!metroStarted) {
    metroStarted = true;
    metroTab.init(ctx, { onClose: closeMetro });
  }
  metroTab.show();
}
function closeMetro() {
  metroOpen = false;
  metroTab.hide?.();
  $('panel-metro').hidden = true;
  $('me-main').hidden = false;
  document.body.classList.remove('ot-metro-on');
  render();
}
