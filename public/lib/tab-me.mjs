// 我的: everything you keep, and how the planner should plan for you.
//
//   TPASS        the page's card: which pass you have (the planner counts
//                its rides as NT$0)
//   地點         pinned places (家, 學校…): renamed, reordered, removed
//   行程         saved trips: a place to a place, maybe at a time, maybe every
//                weekday (常用行程; the way back comes by itself)
//   釘選         bus stops in groups, trains (a connection, or one train)
//   設定         which ways of moving to use, 每 30 分鐘換 YouBike, the maps app

import { manageSheet, useBusCtx } from './bus-ui.mjs';
import { MODES, PLACE_ICONS, DAYS, move } from './store.mjs';
import { TPASSES, tpassOf, passModes } from './tpass.mjs';
import { sheet, sheetHead, icon, trainKind, stationLabel } from './ui.mjs';
import { e, distText, meters, dayLabel, shown } from './util.mjs';
import { COLOR, PLACE_COLOR, tile, section, rowCard } from './look.mjs';

import { W, en } from '#kit/lang.mjs';
const $ = id => document.getElementById(id);
let ctx = null;

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
}
export function init(c) {
  register(c);
  $('me-main').addEventListener('click', onClick);
  (ctx.onRefresh ||= []).push(() => render());
}
export function show() {
  render();
}

const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysText = d => (!d.length ? '' : d.length === 5 && [1, 2, 3, 4, 5].every(x => d.includes(x)) ? W('平日', 'Weekdays') : d.length === 7 ? W('每天', 'Daily') : d.length === 2 && d.includes(0) && d.includes(6) ? W('週末', 'Weekends') : W(`每週${d.map(x => DAYS[x]).join('、')}`, d.map(x => DAYS_EN[x]).join(', ')));
const placeTile = p => tile(PLACE_ICONS[p.icon] || 'pin', PLACE_COLOR[p.icon] || COLOR.place);
const addRow = (act, text) => `<button class="q-ritem ot-add" type="button" data-act="${act}"><span class="q-tile soft" aria-hidden="true">${icon('plus')}</span><span class="q-ritem-text"><span class="q-ritem-title">${text}</span></span></button>`;
// Which ways of moving the planner uses, in a word or a few.
const modesText = m => (Object.values(m).every(Boolean) ? W('全部', 'All') : Object.entries(MODES).filter(([k]) => m[k]).map(([, n]) => n).join('・'));

function render() {
  const D = ctx.data;
  const P = D.prefs;
  const pass = tpassOf(P.tpass);
  // The pass: its name and price big, what it covers as tags; the whole card picks another.
  // TPASS: one row in 設定 (the owner, 2026-10-21: a big card of it opening 我的 made no sense), its price beside its name.
  const passRow = `<button class="q-ritem chevron" type="button" data-act="tpass">${tile('tra', COLOR.tra)}<span class="q-ritem-text"><span class="q-ritem-title">TPASS${pass ? ` ${e(shown(pass.name))} <span class="ot-pass-price">NT$${pass.price}</span>` : ''}</span><small>${e(pass ? passModes(pass).join('、') : W('沒有月票', 'No pass'))}</small></span></button>`;
  const places = D.places
    .map(p => `<button class="q-ritem chevron" type="button" data-place-edit="${e(p.id)}">${placeTile(p)}<span class="q-ritem-text"><span class="q-ritem-title">${e(shown(p.name))}</span>${p.address ? `<small>${e(p.address)}</small>` : ''}</span>${ctx.here ? `<span class="q-ritem-value">${e(distText(meters(ctx.here.lat, ctx.here.lon, p.lat, p.lon)))}</span>` : ''}</button>`)
    .join('');
  const trips = D.saved
    .map(t => {
      // A trip's row (the owner, 2026-10-27, "Ugly": a clock tile floating mid-row, 20px times, an orphan line):
      // the tile is where it goes (a pinned place's own, else a route) beside its name and way, at the top;
      // under them the times on one line, a word before each (抵達 08:00 · 回程 16:45) and the days that differ
      // small under the time they change.
      const when = t.date ? dayLabel(t.date) : t.days.length ? daysText(t.days) : '';
      const altDays = a => (en ? a.days.map(x => DAYS_EN[x]).join(', ') : `週${a.days.map(x => DAYS[x]).join('、')}`);
      const alts = k => (t.alt || []).filter(a => a[k]).map(a => `<small>${e(altDays(a))} ${e(a[k])}</small>`).join('');
      const col = (label, time, k) => (time || alts(k) ? `<span class="ot-tt-col"><span><small>${e(label)}</small><b>${e(time || '—')}</b></span>${alts(k)}</span>` : '');
      const cols = col(t.by === 'arrive' ? W('抵達', 'Arrive') : W('出發', 'Leave'), t.time, 'time') + col(W('回程', 'Back'), t.back, 'back');
      const place = D.places.find(p => meters(p.lat, p.lon, t.to.lat, t.to.lon) < 80);
      const glyph = place ? placeTile(place) : tile(t.date ? 'calendar' : 'route', COLOR.route);
      return `<button class="q-ritem chevron ot-trip-row" type="button" data-trip="${e(t.id)}">${glyph}<span class="q-ritem-text"><span class="q-ritem-title">${e(t.name || shown(t.to.name))}</span><small>${e(t.from ? shown(t.from.name) : W('目前位置', 'Here'))} → ${e(shown(t.to.name))}${when ? ` · ${e(when)}` : ''}</small>${cols ? `<span class="ot-tt">${cols}</span>` : ''}</span></button>`;
    })
    .join('');
  const stops = D.groups.reduce((n, g) => n + g.items.length, 0);
  const pins = D.pins
    .map(p => `<div class="q-ritem">${tile(p.from.sys === 'hsr' ? 'hsr' : 'tra', p.from.sys === 'hsr' ? COLOR.hsr : COLOR.tra)}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(p.from))} → ${e(stationLabel(p.to))}</span><small>${p.kind === 'trainNo' ? `${e(trainKind(p.type || ''))} ${e(p.no)}${p.dep ? ` · ${e(p.dep)}` : ''}` : W('每一班', 'Every train')}</small></span><button class="q-icon-btn" type="button" data-pin-del="${e(p.id)}" aria-label="${W('刪除', 'Delete')}">${icon('trash')}</button></div>`)
    .join('');
  $('me-main').innerHTML = `<div class="ot-page">
    ${section(W('行程', 'Trips'), rowCard(trips + addRow('add-trip', W('新增行程', 'Add a trip'))))}
    ${section(W('地點', 'Places'), rowCard(places + addRow('add-place', W('釘選地點', 'Pin a place'))))}
    ${section(
      W('釘選', 'Pinned'),
      rowCard(`<button class="q-ritem chevron" type="button" data-act="groups">${tile('bus', COLOR.bus)}<span class="q-ritem-text"><span class="q-ritem-title">${W('公車站牌', 'Bus stops')}</span>${D.groups.some(g => g.items.length) ? `<small>${D.groups.filter(g => g.items.length).map(g => e(`${g.name} ${g.items.length}`)).join(' · ')}</small>` : ''}</span>${Number(stops) ? `<span class="q-ritem-value">${stops}</span>` : ''}</button>${pins}${addRow('times', W('查時刻', 'Find times'))}`)
    )}
    ${section(
      W('設定', 'Settings'),
      rowCard(`${passRow}<button class="q-ritem chevron" type="button" data-act="modes">${tile('route', COLOR.route)}<span class="q-ritem-text"><span class="q-ritem-title">${W('規劃使用', 'Routes use')}</span><small>${e(modesText(P.modes))}</small></span></button>
        ${pass?.bike ? '' : `<div class="q-ritem">${tile('bike', COLOR.bike)}<span class="q-ritem-text"><span class="q-ritem-title">${W('每 30 分換車', 'Swap at 30 min')}</span></span><button class="q-switch" type="button" role="switch" data-act="bike30" aria-checked="${P.bike30}" aria-label="${W('每 30 分鐘換 YouBike', 'Swap YouBikes every 30 min')}"><i></i></button></div>`}
        <label class="q-ritem chevron ot-pick-row">${tile('pin', COLOR.place)}<span class="q-ritem-text"><span class="q-ritem-title">${W('導航 App', 'Maps app')}</span></span><span class="q-ritem-value">${P.maps === 'apple' ? W('Apple 地圖', 'Apple Maps') : W('Google 地圖', 'Google Maps')}</span><select id="me-maps" class="ot-cover" aria-label="${W('導航 App', 'Maps app')}"><option value="google" ${P.maps !== 'apple' ? 'selected' : ''}>${W('Google 地圖', 'Google Maps')}</option><option value="apple" ${P.maps === 'apple' ? 'selected' : ''}>${W('Apple 地圖', 'Apple Maps')}</option></select></label>`)
    )}
  </div>`;
}

// The ways of moving the planner may use: all of them, or some left out.
function modesSheet() {
  const d = sheet('');
  const draw = () => {
    const m = ctx.data.prefs.modes;
    d.innerHTML = `${sheetHead(W('規劃使用', 'Routes use'), '', tile('route', COLOR.route))}<div class="q-chips ot-wrap-chips"><button class="q-chip" type="button" data-all-modes="1" aria-pressed="${Object.values(m).every(Boolean)}">${W('全部', 'All')}</button>${Object.entries(MODES).map(([k, n]) => `<button class="q-chip" type="button" data-mode="${k}" aria-pressed="${m[k]}">${e(n)}</button>`).join('')}</div>`;
  };
  draw();
  d.addEventListener('click', ev => {
    if (modeClick(ev)) draw();
  });
}
function modeClick(ev) {
  const D = ctx.data;
  const m = ev.target.closest('[data-mode]');
  if (m) {
    D.prefs.modes[m.dataset.mode] = !D.prefs.modes[m.dataset.mode];
    // Nothing left: everything (no plan can be made of nothing).
    if (!Object.values(D.prefs.modes).some(Boolean)) for (const k of Object.keys(MODES)) D.prefs.modes[k] = true;
  } else if (ev.target.closest('[data-all-modes]')) for (const k of Object.keys(MODES)) D.prefs.modes[k] = true;
  else return false;
  done();
  return true;
}

function onClick(ev) {
  const t = ev.target.closest('[data-trip]');
  if (t) return ctx.editTrip(t.dataset.trip);
  const pe = ev.target.closest('[data-place-edit]');
  if (pe) return placeSheet(pe.dataset.placeEdit);
  const pin = ev.target.closest('[data-pin-del]');
  if (pin) {
    ctx.data.pins = ctx.data.pins.filter(p => p.id !== pin.dataset.pinDel);
    return done();
  }
  const act = ev.target.closest('[data-act]')?.dataset.act || (ev.target.closest('.ot-pass') ? 'tpass' : '');
  if (act === 'tpass') return tpassSheet();
  if (act === 'bike30') {
    ctx.data.prefs.bike30 = !ctx.data.prefs.bike30;
    return done();
  }
  if (act === 'modes') return modesSheet();
  if (act === 'groups') return manageSheet();
  if (act === 'times') return ctx.goTab('times');
  if (act === 'add-place') {
    ctx.goTab('map');
    return setTimeout(() => document.getElementById('q')?.focus(), 200);
  }
  if (act === 'add-trip') return ctx.newTrip?.();
}
document.addEventListener('change', ev => {
  if (!ctx || ev.target.id !== 'me-maps') return;
  ctx.data.prefs.maps = ev.target.value === 'apple' ? 'apple' : 'google';
  done();
});
// The monthly pass, picked from a list in a sheet (a native picker wrapped
// its long names): each with its price, the chosen one ticked.
function tpassSheet() {
  const now = ctx.data.prefs.tpass || '';
  const row = (id, name, sub) =>
    `<button class="q-ritem" type="button" data-tp="${e(id)}" aria-pressed="${id === now}">${tile(id ? 'tra' : 'x', id ? COLOR.tra : 'var(--q-gray)')}<span class="q-ritem-text"><span class="q-ritem-title">${e(name)}</span>${sub ? `<small>${e(sub)}</small>` : ''}</span>${id === now ? `<span class="q-ritem-value ot-tick">${icon('check')}</span>` : ''}</button>`;
  const d = sheet(`${sheetHead(W('選擇月票', 'Pick a pass'))}${rowCard(row('', W('沒有 TPASS', 'No TPASS'), '') + TPASSES.map(t => row(t.id, t.name, `NT$${t.price}${W(' / 月', ' a month')} · ${passModes(t).join('、')}`)).join(''))}`, 'ot-tpass-sheet');
  d.addEventListener('click', ev => {
    const b = ev.target.closest('[data-tp]');
    if (!b) return;
    ctx.data.prefs.tpass = b.dataset.tp;
    d.shut();
    done();
  });
}

// A pinned place: its name and icon, its place in the list, or gone.
function placeSheet(id) {
  const p = ctx.data.places.find(x => x.id === id);
  if (!p) return;
  const at = ctx.data.places.indexOf(p);
  let ic = p.icon;
  const d = sheet(`${sheetHead(W('編輯地點', 'Edit place'), p.address ? e(p.address) : '', placeTile(p))}
    <label class="ot-field"><span>${W('名稱', 'Name')}</span><input id="pl-name" maxlength="30" value="${e(p.name)}" placeholder="${W('家、公司、學校', 'Home, Work, School')}"></label>
    <div class="ot-field"><span>${W('圖示', 'Icon')}</span><div class="q-chips ot-wrap-chips">${Object.entries(PLACE_ICONS).map(([k, v]) => `<button class="q-chip" type="button" data-icon="${k}" aria-pressed="${k === ic}" aria-label="${k}">${icon(v)}</button>`).join('')}</div></div>
    <div class="ot-sheet-acts"><button class="q-btn" type="button" data-del="1">${icon('trash')} ${W('刪除', 'Delete')}</button>${at ? `<button class="q-btn" type="button" data-up="1">${icon('up')} ${W('上移', 'Move up')}</button>` : ''}<button class="q-btn primary" type="button" data-save="1">${W('儲存', 'Save')}</button></div>`);
  d.addEventListener('click', ev => {
    const b = ev.target.closest('[data-icon]');
    if (b) {
      ic = b.dataset.icon;
      return d.querySelectorAll('[data-icon]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.icon === ic)));
    }
    if (ev.target.closest('[data-del]')) ctx.data.places = ctx.data.places.filter(x => x.id !== id);
    else if (ev.target.closest('[data-up]')) ctx.data.places = move(ctx.data.places, ctx.data.places.findIndex(x => x.id === id), -1);
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
