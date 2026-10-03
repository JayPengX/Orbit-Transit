// 我的: everything you keep, and how the planner should plan for you.
//
//   地點         pinned places (家, 學校…): renamed, reordered, removed
//   行程         saved trips: a place to a place, maybe at a time, maybe every
//                weekday (常用行程; the way back comes by itself)
//   釘選交通     bus stops in groups, trains (a connection, or one train)
//   交通偏好     which ways of moving to use (all public transport, or some
//                left out), 每 30 分鐘換 YouBike, which TPASS you have
//   車票         高鐵 T Express and 台鐵 e訂通, to buy tickets
//   捷運路網圖   each city's metro on the real map, a station's next trains

import * as metroTab from './tab-metro.mjs';
import { manageSheet, useBusCtx } from './bus-ui.mjs';
import { MODES, PLACE_ICONS, DAYS, move } from './store.mjs';
import { TPASSES, tpassOf } from './tpass.mjs';
import { sheet, sheetHead, icon } from './ui.mjs';
import { e } from './util.mjs';

const $ = id => document.getElementById(id);
let ctx = null;
let metroOpen = false;

// Where to buy tickets: the operators' own apps (the App Store / Google Play
// page opens the app when it's installed) and their booking sites.
const ios = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const TICKETS = [
  { id: 'hsr', name: '高鐵 T Express', sub: '台灣高鐵行動購票', app: { ios: 'https://apps.apple.com/tw/app/id468963664', android: 'https://play.google.com/store/search?q=%E5%8F%B0%E7%81%A3%E9%AB%98%E9%90%B5%20T%20Express&c=apps' }, web: 'https://irs.thsrc.com.tw/IMINT/?locale=tw' },
  { id: 'tra', name: '台鐵 e訂通', sub: '台鐵訂票、電子票證', app: { ios: 'https://apps.apple.com/tw/app/id1441617748', android: 'https://play.google.com/store/search?q=%E5%8F%B0%E9%90%B5e%E8%A8%82%E9%80%9A&c=apps' }, web: 'https://tip.railway.gov.tw/tra-tip-web/tip' }
];

export function init(c) {
  ctx = c;
  useBusCtx(c);
  $('me-main').addEventListener('click', onClick);
  ctx.editTrip = id => {
    const t = ctx.data.saved.find(x => x.id === id);
    if (t) ctx.saveTrip?.(null, { edit: t });
  };
  ctx.editPlace = placeSheet;
  ctx.openMetro = () => {
    ctx.goTab('me');
    openMetro();
  };
  (ctx.onRefresh ||= []).push(() => render());
}
export function show() {
  if (metroOpen) metroTab.show();
  else render();
}
export function hide() {
  metroTab.hide?.();
}

const name = s => (s.sys === 'hsr' ? `高鐵${s.name}` : s.name);
const daysText = d => (!d.length ? '' : d.length === 5 && [1, 2, 3, 4, 5].every(x => d.includes(x)) ? '平日' : d.length === 7 ? '每天' : d.length === 2 && d.includes(0) && d.includes(6) ? '週末' : `每週${d.map(x => DAYS[x]).join('、')}`);

function render() {
  if (metroOpen) return;
  const D = ctx.data;
  const P = D.prefs;
  const pass = tpassOf(P.tpass);
  const allOn = Object.values(P.modes).every(Boolean);
  const platform = ios() ? 'ios' : 'android';
  $('me-main').innerHTML = `<div class="ot-wrap ot-mine">
    <h3 class="ot-go-h">地點</h3>
    <section class="ot-go-card">${D.places.map((p, i) => `<div class="ot-order-row"><button class="ot-place-name" type="button" data-place-edit="${e(p.id)}"><i>${PLACE_ICONS[p.icon] || '📍'}</i><span><b>${e(p.name)}</b><small>${e(p.address || '點一下改名稱或圖示')}</small></span>${icon('edit')}</button><button class="q-icon-btn" type="button" data-place-up="${i}" aria-label="上移" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="q-icon-btn" type="button" data-place-del="${e(p.id)}" aria-label="刪除">${icon('trash')}</button></div>`).join('') || '<p class="ot-note">還沒有釘選地點：在地圖上點一個地方，按「釘選」。</p>'}
      <button class="q-btn ot-wide" type="button" data-act="add-place">${icon('plus')} 在地圖上找地點釘選</button></section>

    <h3 class="ot-go-h">行程</h3>
    <section class="ot-go-card">${D.saved.map(t => `<button class="ot-row-btn" type="button" data-trip="${e(t.id)}">${icon(t.days.length ? 'clock' : 'route')}<span><b>${e(t.name || t.to.name)}</b><small>${e(t.from ? t.from.name : '目前位置')} → ${e(t.to.name)}${t.time ? ` · ${t.by === 'arrive' ? '抵達' : '出發'} ${e(t.time)}` : ''}${t.days.length ? ` · ${e(daysText(t.days))}` : ''}${t.back ? ` · 回程 ${e(t.back)}` : ''}${(t.alt || []).map(a => ` · 週${e(a.days.map(x => DAYS[x]).join(''))} ${e([a.time, a.back && `回 ${a.back}`].filter(Boolean).join(' '))}`).join('')}</small></span>${icon('edit')}</button>`).join('') || '<p class="ot-note">還沒有行程：在地圖上查路線時按 ☆，就能釘選（可以設定時間，或每週固定幾天）。</p>'}
      <button class="q-btn ot-wide" type="button" data-act="add-trip">${icon('plus')} 新增行程</button></section>

    <h3 class="ot-go-h">釘選交通</h3>
    <section class="ot-go-card">
      <button class="ot-row-btn" type="button" data-act="groups">${icon('bus')}<span><b>公車站牌</b><small>${D.groups.map(g => `${e(g.name)} ${g.items.length}`).join('、')}</small></span>${icon('chevron')}</button>
      ${D.pins.map(p => `<div class="ot-order-row"><span>${icon(p.from.sys === 'hsr' ? 'hsr' : 'tra')} ${e(name(p.from))} → ${e(name(p.to))}<small>${p.kind === 'trainNo' ? `${e(p.type || '')} ${e(p.no)} 次${p.dep ? ` · ${e(p.dep)}` : ''}` : '每一班'}</small></span><button class="q-icon-btn" type="button" data-pin-del="${e(p.id)}" aria-label="刪除">${icon('trash')}</button></div>`).join('')}
      <button class="q-btn ot-wide" type="button" data-act="times">${icon('tra')} 查時刻，釘選火車或公車</button></section>

    <h3 class="ot-go-h">交通偏好</h3>
    <section class="ot-go-card">
      <p class="ot-note">路線規劃使用：</p>
      <div class="q-chips ot-modes"><button class="q-chip" type="button" data-all-modes="1" aria-pressed="${allOn}">全部大眾運輸</button>${Object.entries(MODES).map(([k, n]) => `<button class="q-chip" type="button" data-mode="${k}" aria-pressed="${P.modes[k]}">${e(n)}</button>`).join('')}</div>
      <p class="ot-note">關掉一種，就用其他方式代替（例如不騎 YouBike 就改搭公車或步行）。</p>
      <div class="ot-order-row"><span>每 30 分鐘換一台 YouBike<small>長程騎車時，在半路的站還車再借：每段都在 30 分鐘內（TPASS 免費、或最便宜的時段）</small></span><button class="q-switch" type="button" role="switch" data-act="bike30" aria-checked="${P.bike30}" aria-label="每 30 分鐘換車"><i></i></button></div>
      <label class="ot-field"><span>我的 TPASS</span><select id="me-tpass"><option value="">沒有 TPASS</option>${TPASSES.map(t => `<option value="${t.id}" ${t.id === P.tpass ? 'selected' : ''}>${e(t.name)}（NT$${t.price}）</option>`).join('')}</select></label>
      <p class="ot-note">${pass ? `${e(pass.name)}：範圍內的公車、台鐵、捷運不另收費${pass.bike ? '，YouBike 前 30 分鐘免費' : ''}。路線比較會把這些算成 0 元（高鐵不含）。` : '選了 TPASS，路線比較會把月票涵蓋的車資算成 0 元。'}</p>
    </section>

    <h3 class="ot-go-h">車票</h3>
    <section class="ot-go-card">${TICKETS.map(t => `<div class="ot-ticket"><span>${icon(t.id)}<b>${e(t.name)}</b><small>${e(t.sub)}</small></span><a class="q-btn primary" href="${e(t.app[platform])}" target="_blank" rel="noopener">開啟 App</a><a class="q-btn" href="${e(t.web)}" target="_blank" rel="noopener">網頁訂票</a></div>`).join('')}</section>

    <h3 class="ot-go-h">工具</h3>
    <section class="ot-go-card"><button class="ot-row-btn" type="button" data-act="metro">${icon('metro')}<span><b>捷運路網圖</b><small>台北・新北、桃園機捷、台中、高雄：車站在真正的地圖上，點車站看下一班</small></span>${icon('chevron')}</button></section>
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
    ctx.status('搜尋或點地圖上的地點，再按「釘選」');
    return setTimeout(() => document.getElementById('q')?.focus(), 200);
  }
  if (act === 'add-trip') return ctx.newTrip?.();
}
document.addEventListener('change', ev => {
  if (ev.target.id !== 'me-tpass' || !ctx) return;
  ctx.data.prefs.tpass = ev.target.value;
  done();
});
// A pinned place's name and icon.
export function placeSheet(id) {
  const p = ctx.data.places.find(x => x.id === id);
  if (!p) return;
  let ic = p.icon;
  const d = sheet(`${sheetHead('編輯地點', e(p.address || ''))}
    <label class="ot-field"><span>名稱</span><input id="pl-name" maxlength="30" value="${e(p.name)}" placeholder="例如：家、公司、學校"></label>
    <div class="ot-field"><span>圖示</span><div class="q-chips">${Object.entries(PLACE_ICONS).map(([k, v]) => `<button class="q-chip" type="button" data-icon="${k}" aria-pressed="${k === ic}">${v}</button>`).join('')}</div></div>
    <div class="ot-row ot-actions"><button class="q-btn" type="button" data-del="1">刪除</button><button class="q-btn primary" type="button" data-save="1">儲存</button></div>`);
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
    d.close();
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
