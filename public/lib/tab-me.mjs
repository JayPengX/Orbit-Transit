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
import { MODES, PLACE_ICONS, iconName, DAYS } from './store.mjs';
import { gripHtml, reorder } from '#kit/ui.mjs';
import { TPASSES, tpassOf, passModes, bikeSwap } from './tpass.mjs';
import { sheet, sheetHead, icon, trainKind, stationLabel } from './ui.mjs';
import { e, distText, meters, dayLabel, shown } from './util.mjs';
import { COLOR, PLACE_COLOR, tile, tripTile, tpassTile, bikeTile, section, rowCard } from './look.mjs';

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
const addRow = (act, text) => `<button class="q-ritem q-add" type="button" data-act="${act}"><span class="q-add-i" aria-hidden="true">${icon('plus')}</span><span class="q-ritem-text"><span class="q-ritem-title">${text}</span></span></button>`;
// Which ways of moving the planner uses, in a word or a few.
const modesText = m => (Object.values(m).every(Boolean) ? W('全部', 'All') : Object.entries(MODES).filter(([k]) => m[k]).map(([, n]) => n).join('・'));

function render() {
  const D = ctx.data;
  const P = D.prefs;
  const pass = tpassOf(P.tpass);
  // The pass: its name and price big, what it covers as tags; the whole card picks another.
  // TPASS: one row in 設定 (the owner, 2026-10-21: a big card of it opening 我的 made no sense), its price beside its name.
  const passRow = `<button class="q-ritem chevron" type="button" data-act="tpass">${tpassTile()}<span class="q-ritem-text"><span class="q-ritem-title">TPASS${pass ? ` ${e(shown(pass.name))} <span class="ot-pass-price">NT$${pass.price}</span>` : ''}</span><small>${e(pass ? passModes(pass).join('、') : W('沒有月票', 'No pass'))}</small></span></button>`;
  // Places in their order: two or more carry the kit's grip (reorder), the row itself opens its sheet.
  const placeBody = p => `${placeTile(p)}<span class="q-ritem-text"><span class="q-ritem-title">${e(shown(p.name))}</span>${p.address ? `<small>${e(p.address)}</small>` : ''}</span>${ctx.here ? `<span class="q-ritem-value">${e(distText(meters(ctx.here.lat, ctx.here.lon, p.lat, p.lon)))}</span>` : ''}`;
  const places = D.places
    .map(p =>
      D.places.length > 1
        ? `<div class="q-ritem" data-q-key="${e(p.id)}"><button class="q-row-open" type="button" data-place-edit="${e(p.id)}">${placeBody(p)}</button>${gripHtml(W(`拖曳排序：${shown(p.name)}`, `Reorder ${shown(p.name)}`))}</div>`
        : `<button class="q-ritem chevron" type="button" data-place-edit="${e(p.id)}">${placeBody(p)}</button>`
    )
    .join('');
  // A trip as what it is, a way there and a way back (Jay 2026-11-03: the old row, a tile and
  // times in a heap, looked terrible): its name and days on top, then one line each way, the
  // places it joins and its time at the right edge (the days whose time differs small under it).
  const trips = D.saved
    .map(t => {
      const when = t.date ? dayLabel(t.date) : t.days.length ? daysText(t.days) : '';
      const altDays = a => (en ? a.days.map(x => DAYS_EN[x]).join(', ') : `週${a.days.map(x => DAYS[x]).join('、')}`);
      const alts = (k, word) => (t.alt || []).filter(a => a[k]).map(a => `<span class="ot-tl-alt">${e(altDays(a))}</span><span class="ot-tl-t alt"><b>${e(a[k])}</b><small>${e(word)}</small></span>`).join('');
      const from = t.from ? shown(t.from.name) : W('目前位置', 'Here');
      const to = shown(t.to.name);
      // (A way's row: where it goes on the left, its time and word on the right as 交通's 07:13 到; the
      // days whose time differs each a row of their own under it, the same sizes.)
      const leg = (a, b, time, word, k) => `<span class="ot-tl"><span class="ot-tl-way q-fit-wrap">${e(a)}<i>${icon('arrow')}</i>${e(b)}</span><span class="ot-tl-t">${time ? `<b>${e(time)}</b>` : ''}<small>${e(word)}</small></span>${alts(k, word)}</span>`;
      const go = leg(from, to, t.time, t.time ? (t.by === 'arrive' ? W('抵達', 'arrive') : W('出發', 'leave')) : W('隨時', 'any time'), 'time');
      const back = t.back || (t.alt || []).some(a => a.back) ? leg(to, from, t.back, W('出發', 'leave'), 'back') : '';
      const place = D.places.find(p => meters(p.lat, p.lon, t.to.lat, t.to.lon) < 80);
      const glyph = tripTile(t.name || '', place, !!t.date);
      return `<button class="q-ritem ot-trip" type="button" data-trip="${e(t.id)}"><span class="ot-trip-top">${glyph}<span class="ot-trip-name"><b>${e(t.name || to)}</b>${when ? `<small>${e(when)}</small>` : ''}</span><span class="ot-trip-go" aria-hidden="true">${icon('chevron')}</span></span><span class="ot-trip-legs">${go}${back}</span></button>`;
    })
    .join('');
  const stops = D.groups.reduce((n, g) => n + g.items.length, 0);
  const pins = D.pins
    .map(p => `<div class="q-ritem">${tile(p.from.sys === 'hsr' ? 'hsr' : 'tra', p.from.sys === 'hsr' ? COLOR.hsr : COLOR.tra)}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(p.from))} → ${e(stationLabel(p.to))}</span><small>${p.kind === 'trainNo' ? `${e(trainKind(p.type || ''))} ${e(p.no)}${p.dep ? ` · ${e(p.dep)}` : ''}` : W('每一班', 'Every train')}</small></span><button class="q-icon-btn" type="button" data-pin-del="${e(p.id)}" aria-label="${W('刪除', 'Delete')}">${icon('trash')}</button></div>`)
    .join('');
  const box = $('panel-me');
  const keep = box?.scrollTop || 0;
  $('me-main').innerHTML = `<div class="ot-page"><div class="q-cols ot-cols"><div>
    ${section(W('行程', 'Trips'), rowCard(trips + addRow('add-trip', W('新增行程', 'Add a trip'))))}
    ${section(W('地點', 'Places'), rowCard(places + addRow('add-place', W('釘選地點', 'Pin a place'))).replace('class="q-rowcard', 'id="me-places" class="q-rowcard'))}
    </div><div>
    ${section(
      W('釘選', 'Pinned'),
      rowCard(`<button class="q-ritem chevron" type="button" data-act="groups">${tile('bus', COLOR.bus)}<span class="q-ritem-text"><span class="q-ritem-title">${W('公車站牌', 'Bus stops')}</span>${D.groups.some(g => g.items.length) ? `<small>${D.groups.filter(g => g.items.length).map(g => e(`${g.name} ${g.items.length}`)).join(' · ')}</small>` : ''}</span>${Number(stops) ? `<span class="q-ritem-value">${stops}</span>` : ''}</button>${pins}${addRow('times', W('查時刻', 'Find times'))}`)
    )}
    ${section(
      W('規劃', 'Planning'),
      rowCard(`${passRow}${modeRows(P)}<div class="q-ritem">${tile('bike', COLOR.bike)}<span class="q-ritem-text"><span class="q-ritem-title">${W('每 30 分換一台 YouBike', 'New YouBike every 30 min')}</span><small>${W('前 30 分鐘最便宜', 'The first half hour costs least')}</small></span><button class="q-switch" type="button" role="switch" data-act="bike30" aria-checked="${bikeSwap(P)}" aria-label="${W('每 30 分鐘換 YouBike', 'Swap YouBikes every 30 min')}"><i></i></button></div>${ebikeRow(P)}
        <label class="q-ritem chevron ot-pick-row">${tile('pin', COLOR.place)}<span class="q-ritem-text"><span class="q-ritem-title">${W('導航 App', 'Maps app')}</span></span><span class="q-ritem-value">${P.maps === 'apple' ? W('Apple 地圖', 'Apple Maps') : W('Google 地圖', 'Google Maps')}</span><select id="me-maps" class="ot-cover" aria-label="${W('導航 App', 'Maps app')}"><option value="google" ${P.maps !== 'apple' ? 'selected' : ''}>${W('Google 地圖', 'Google Maps')}</option><option value="apple" ${P.maps === 'apple' ? 'selected' : ''}>${W('Apple 地圖', 'Apple Maps')}</option></select></label>`)
    )}
  </div></div></div>`;
  reorder($('me-places'), {
    onChange: ids => {
      ctx.data.places = ids.map(id => ctx.data.places.find(p => p.id === id)).filter(Boolean);
      done();
    }
  });
  // (A switch flipped, a row changed: the page stays where it was read.)
  if (box) box.scrollTop = keep;
}

// 偏好電輔車, off unless turned on (Jay 2026-11-04): every trip starts with the
// plans card's ⚡ on, and a station's 電輔車 are counted first. Only while
// YouBike is one of the ways of moving.
const ebikeRow = P =>
  P.modes.bike === false ? '' : `<div class="q-ritem">${tile('bolt', COLOR.bike)}<span class="q-ritem-text"><span class="q-ritem-title">${W('偏好電輔車', 'Prefer e-bikes')}</span><small>${W('站上有就騎電輔車', 'Ride one where a dock has it')}</small></span><button class="q-switch" type="button" role="switch" data-act="ebike" aria-checked="${P.ebike === true}" aria-label="${W('偏好電輔車', 'Prefer e-bikes')}"><i></i></button></div>`;

// The ways of moving the planner may use, each a row with its switch, right in 我的 (Jay
// 2026-11-03: the sheet of chips sat four and two, and a tap in it lost the page's place).
// The last one on stays on: a plan can't be made of nothing.
const MODE_TILE = { bus: () => tile('bus', COLOR.bus), tra: () => tile('tra', COLOR.tra), hsr: () => tile('hsr', COLOR.hsr), metro: () => tile('metro', COLOR.metro), bike: () => bikeTile() };
const modeRows = P =>
  Object.entries(MODES)
    .map(([k, n]) => `<div class="q-ritem">${MODE_TILE[k]()}<span class="q-ritem-text"><span class="q-ritem-title">${e(n)}</span></span><button class="q-switch" type="button" role="switch" data-mode="${k}" aria-checked="${P.modes[k]}" aria-label="${e(n)}"${P.modes[k] && Object.values(P.modes).filter(Boolean).length === 1 ? ' disabled' : ''}><i></i></button></div>`)
    .join('');

function onClick(ev) {
  const t = ev.target.closest('[data-trip]');
  if (t) return ctx.editTrip(t.dataset.trip);
  const pe = ev.target.closest('[data-place-edit]');
  if (pe) return placeSheet(pe.dataset.placeEdit);
  const m = ev.target.closest('[data-mode]');
  if (m) {
    const modes = ctx.data.prefs.modes;
    if (modes[m.dataset.mode] && Object.values(modes).filter(Boolean).length === 1) return;
    modes[m.dataset.mode] = !modes[m.dataset.mode];
    return done();
  }
  const pin = ev.target.closest('[data-pin-del]');
  if (pin) {
    ctx.data.pins = ctx.data.pins.filter(p => p.id !== pin.dataset.pinDel);
    return done();
  }
  const act = ev.target.closest('[data-act]')?.dataset.act || (ev.target.closest('.ot-pass') ? 'tpass' : '');
  if (act === 'tpass') return tpassSheet();
  if (act === 'bike30') {
    ctx.data.prefs.swap30 = bikeSwap(ctx.data.prefs) ? 'off' : 'on';
    return done();
  }
  if (act === 'ebike') {
    ctx.data.prefs.ebike = ctx.data.prefs.ebike !== true;
    return done();
  }
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
    `<button class="q-ritem" type="button" data-tp="${e(id)}" aria-pressed="${id === now}">${id ? tpassTile() : tile('x', 'var(--q-gray)')}<span class="q-ritem-text"><span class="q-ritem-title">${e(name)}</span>${sub ? `<small>${e(sub)}</small>` : ''}</span>${id === now ? `<span class="q-ritem-value ot-tick">${icon('check')}</span>` : ''}</button>`;
  const d = sheet(`${sheetHead(W('選擇月票', 'Pick a pass'))}${rowCard(row('', W('沒有 TPASS', 'No TPASS'), '') + TPASSES.map(t => row(t.id, t.name, `NT$${t.price}${W(' / 月', ' a month')} · ${passModes(t).join('、')}`)).join(''))}`, 'ot-tpass-sheet');
  d.addEventListener('click', ev => {
    const b = ev.target.closest('[data-tp]');
    if (!b) return;
    ctx.data.prefs.tpass = b.dataset.tp;
    d.shut();
    done();
  });
}

// A pinned place: its name and icon, or gone (its place in the list: its grip on 我的).
function placeSheet(id) {
  const p = ctx.data.places.find(x => x.id === id);
  if (!p) return;
  let ic = p.icon;
  const d = sheet(`${sheetHead(W('編輯地點', 'Edit place'), p.address ? e(p.address) : '', placeTile(p))}
    <label class="ot-field"><span>${W('名稱', 'Name')}</span><input id="pl-name" maxlength="30" value="${e(p.name)}" placeholder="${W('家、公司、學校', 'Home, Work, School')}"></label>
    <div class="ot-field"><span>${W('圖示', 'Icon')}</span><div class="q-chips ot-wrap-chips">${Object.entries(PLACE_ICONS).map(([k, v]) => `<button class="q-chip" type="button" data-icon="${k}" aria-pressed="${k === ic}" aria-label="${e(iconName(k))}">${icon(v)}</button>`).join('')}</div></div>
    <div class="ot-sheet-acts"><button class="q-btn" type="button" data-del="1">${icon('trash')} ${W('刪除', 'Delete')}</button><button class="q-btn primary" type="button" data-save="1">${W('儲存', 'Save')}</button></div>`);
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
