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
import { sheet, sheetHead, icon, trainKind } from './ui.mjs';
import { e, distText, meters } from './util.mjs';

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

const name = s => (s.sys === 'hsr' ? W(`高鐵${s.name}`, `HSR ${s.name}`) : s.name);
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysText = d => (!d.length ? '' : d.length === 5 && [1, 2, 3, 4, 5].every(x => d.includes(x)) ? W('平日', 'Weekdays') : d.length === 7 ? W('每天', 'Daily') : d.length === 2 && d.includes(0) && d.includes(6) ? W('週末', 'Weekends') : W(`每週${d.map(x => DAYS[x]).join('、')}`, d.map(x => DAYS_EN[x]).join(', ')));

function render() {
  if (metroOpen) return;
  const D = ctx.data;
  const P = D.prefs;
  const pass = tpassOf(P.tpass);
  const allOn = Object.values(P.modes).every(Boolean);
  $('me-main').innerHTML = `<div class="ot-wrap ot-mine">
    <h3 class="ot-go-h">${W('地點', 'Places')}</h3>
    <section class="ot-go-card">${D.places.map((p, i) => `<div class="ot-order-row"><button class="ot-place-name" type="button" data-place-edit="${e(p.id)}"><i>${PLACE_ICONS[p.icon] || '📍'}</i><span><b>${e(p.name)}</b>${p.address || ctx.here ? `<small>${e(p.address || `${W('距離 ', '')}${distText(meters(ctx.here.lat, ctx.here.lon, p.lat, p.lon))}${W('', ' away')}`)}</small>` : ''}</span>${icon('edit')}</button><button class="q-icon-btn" type="button" data-place-up="${i}" aria-label="${W('上移', 'Move up')}" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="q-icon-btn" type="button" data-place-del="${e(p.id)}" aria-label="${W('刪除', 'Delete')}">${icon('trash')}</button></div>`).join('') || `<p class="ot-note">${W('還沒有釘選地點：在地圖上點一個地方，按「釘選」。', 'No pinned places yet: tap a place on the map, then Pin.')}</p>`}
      <button class="q-btn ot-wide" type="button" data-act="add-place">${icon('plus')} ${W('在地圖上找地點釘選', 'Find a place to pin')}</button></section>

    <h3 class="ot-go-h">${W('行程', 'Trips')}</h3>
    <section class="ot-go-card">${D.saved.map(t => `<button class="ot-row-btn" type="button" data-trip="${e(t.id)}">${icon(t.days.length ? 'clock' : 'route')}<span><b>${e(t.name || t.to.name)}</b><small>${e(t.from ? t.from.name : W('目前位置', 'Here'))} → ${e(t.to.name)}${t.time ? ` · ${t.by === 'arrive' ? W('抵達', 'arrive') : W('出發', 'leave')} ${e(t.time)}` : ''}${t.days.length ? ` · ${e(daysText(t.days))}` : ''}${t.back ? ` · ${W('回程', 'back')} ${e(t.back)}` : ''}${(t.alt || []).map(a => ` · ${e(en ? a.days.map(x => DAYS_EN[x]).join(', ') : `週${a.days.map(x => DAYS[x]).join('')}`)} ${e([a.time, a.back && `${W('回', 'back')} ${a.back}`].filter(Boolean).join(' '))}`).join('')}</small></span>${icon('edit')}</button>`).join('') || `<p class="ot-note">${W('還沒有行程：在地圖上查路線時按 ☆，就能釘選（可以設定時間，或每週固定幾天）。', 'No trips yet: tap ☆ on a route on the map (with a time, or set days each week).')}</p>`}
      <button class="q-btn ot-wide" type="button" data-act="add-trip">${icon('plus')} ${W('新增行程', 'Add a trip')}</button></section>

    <h3 class="ot-go-h">${W('釘選交通', 'Pinned rides')}</h3>
    <section class="ot-go-card">
      <button class="ot-row-btn" type="button" data-act="groups">${icon('bus')}<span><b>${W('公車站牌', 'Bus stops')}</b><small>${D.groups.map(g => `${e(g.name)} ${g.items.length}`).join('、')}</small></span>${icon('chevron')}</button>
      ${D.pins.map(p => `<div class="ot-order-row"><span>${icon(p.from.sys === 'hsr' ? 'hsr' : 'tra')} ${e(name(p.from))} → ${e(name(p.to))}<small>${p.kind === 'trainNo' ? `${e(trainKind(p.type || ''))} ${e(p.no)}${W(' 次', '')}${p.dep ? ` · ${e(p.dep)}` : ''}` : W('每一班', 'Every train')}</small></span><button class="q-icon-btn" type="button" data-pin-del="${e(p.id)}" aria-label="${W('刪除', 'Delete')}">${icon('trash')}</button></div>`).join('')}
      <button class="q-btn ot-wide" type="button" data-act="times">${icon('tra')} ${W('查時刻，釘選火車或公車', 'Find times to pin')}</button></section>

    <h3 class="ot-go-h">${W('交通偏好', 'Preferences')}</h3>
    <section class="ot-go-card">
      <p class="ot-note">${W('路線規劃使用：', 'Routes may use:')}</p>
      <div class="q-chips ot-modes"><button class="q-chip" type="button" data-all-modes="1" aria-pressed="${allOn}">${W('全部大眾運輸', 'All transit')}</button>${Object.entries(MODES).map(([k, n]) => `<button class="q-chip" type="button" data-mode="${k}" aria-pressed="${P.modes[k]}">${e(n)}</button>`).join('')}</div>
      <p class="ot-note">${W('關掉一種，就用其他方式代替（例如不騎 YouBike 就改搭公車或步行）。', 'Turn one off and others stand in (no YouBike: bus or walk).')}</p>
      ${pass?.bike ? '' : `<div class="ot-order-row"><span>${W('每 30 分鐘換一台 YouBike', 'Swap YouBikes every 30 min')}<small>${W('長程騎車時，在半路的站還車再借：每段都在 30 分鐘內（TPASS 免費、或最便宜的時段）', 'On long rides, return and re-rent on the way so each leg stays under 30 minutes (free with TPASS, or the cheapest rate).')}</small></span><button class="q-switch" type="button" role="switch" data-act="bike30" aria-checked="${P.bike30}" aria-label="${W('每 30 分鐘換車', 'Swap every 30 min')}"><i></i></button></div>`}
      <label class="ot-field"><span>${W('導航 App', 'Navigation app')}</span><select id="me-maps"><option value="google" ${P.maps !== 'apple' ? 'selected' : ''}>${W('Google 地圖', 'Google Maps')}</option><option value="apple" ${P.maps === 'apple' ? 'selected' : ''}>${W('Apple 地圖', 'Apple Maps')}</option></select></label>
      <p class="ot-note">${W('導航時走路、騎 YouBike 的那一段，交給這個 App 帶路（步行、自行車模式）。', 'Walking and YouBike legs open in this app (walk or cycle mode).')}</p>
      <label class="ot-field"><span>${W('我的 TPASS', 'My TPASS')}</span><select id="me-tpass"><option value="">${W('沒有 TPASS', 'No TPASS')}</option>${TPASSES.map(t => `<option value="${t.id}" ${t.id === P.tpass ? 'selected' : ''}>${e(t.name)}${W(`（NT$${t.price}）`, ` (NT$${t.price})`)}</option>`).join('')}</select></label>
      <p class="ot-note">${pass ? W(`${e(pass.name)}：範圍內的公車、台鐵、捷運不另收費${pass.bike ? '，YouBike 前 30 分鐘免費（長程騎車會在半路的站換一台，每段都免費）' : ''}。路線比較會把這些算成 0 元（高鐵不含）。`, `${e(pass.name)}: buses, TRA and metro inside it are free${pass.bike ? ', and YouBike’s first 30 minutes (long rides swap bikes on the way)' : ''}. Routes count those as NT$0 (not HSR).`) : W('選了 TPASS，路線比較會把月票涵蓋的車資算成 0 元。', 'With a TPASS, routes count what it covers as NT$0.')}</p>
    </section>


    <h3 class="ot-go-h">${W('工具', 'Tools')}</h3>
    <section class="ot-go-card"><button class="ot-row-btn" type="button" data-act="metro">${icon('metro')}<span><b>${W('捷運路網圖', 'Metro map')}</b><small>${W('台北・新北、桃園機捷、台中、高雄：車站在真正的地圖上，點車站看下一班', 'Taipei, Taoyuan, Taichung, Kaohsiung: tap a station for the next trains')}</small></span>${icon('chevron')}</button></section>
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
export function placeSheet(id) {
  const p = ctx.data.places.find(x => x.id === id);
  if (!p) return;
  let ic = p.icon;
  const d = sheet(`${sheetHead(W('編輯地點', 'Edit place'), e(p.address || ''))}
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
