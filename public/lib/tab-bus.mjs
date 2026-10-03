// 公車: the stops you care about, in groups (常用, 上班, 回家…), one page
// each, swiped sideways; every stop says when its bus comes, refreshed every
// 20 seconds while the page is open. ＋ finds a route (in your city first, or
// any city, or 公路客運), shows its stops each way with the buses on them,
// and puts a stop in a group.

import { cityRoutes, findRoutes, routeStops, routeEta, stopsEta, etaText, INTERCITY } from './bus.mjs';
import { errorText } from './api.mjs';
import { CITIES, cityName, cityShort } from './city.mjs';
import { cleanItem, MAX_GROUPS, MAX_ITEMS, move } from './store.mjs';
import { sheet, sheetHead, icon, ago } from './ui.mjs';
import { e, uid, meters, distText } from './util.mjs';

const $ = id => document.getElementById(id);
let ctx = null;
let index = 0;
let timer = 0;
let lastAt = 0;
let eta = new Map();
let error = '';

export function init(c) {
  ctx = c;
  $('groups').addEventListener('click', ev => {
    const g = ev.target.closest('[data-g]');
    if (g) return goTo(Number(g.dataset.g));
    if (ev.target.closest('[data-act="manage"]')) return manageSheet();
  });
  $('bus-pager').addEventListener('click', onClick);
  let settle = 0;
  $('bus-pager').addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      const p = $('bus-pager');
      const i = Math.round(p.scrollLeft / Math.max(1, p.clientWidth));
      if (i !== index) {
        index = i;
        drawChips();
        refresh();
      }
    }, 120);
  });
  render();
}

export function show() {
  render();
  refresh();
  clearInterval(timer);
  timer = setInterval(refresh, 20_000);
}
export function hide() {
  clearInterval(timer);
}

const groups = () => ctx.data.groups;

function drawChips() {
  $('groups').innerHTML =
    groups()
      .map((g, i) => `<button class="q-chip" type="button" data-g="${i}" aria-pressed="${i === index}">${e(g.name)}<small>${g.items.length || ''}</small></button>`)
      .join('') + `<button class="q-chip ot-chip-muted" type="button" data-act="manage">${icon('edit')} 管理</button>`;
  const on = $('groups').querySelector(`[data-g="${index}"]`);
  if (on) {
    const box = $('groups');
    const l = on.offsetLeft - box.offsetLeft;
    if (l < box.scrollLeft || l + on.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollTo({ left: Math.max(0, l - 16), behavior: 'smooth' });
  }
}

function render() {
  index = Math.min(index, groups().length - 1);
  drawChips();
  const pager = $('bus-pager');
  const sig = groups().map(g => g.id).join();
  if (pager.dataset.sig !== sig) {
    pager.innerHTML = groups().map(g => `<article class="ot-page" data-group="${e(g.id)}"></article>`).join('');
    pager.dataset.sig = sig;
    pager.scrollLeft = index * pager.clientWidth;
  }
  groups().forEach(drawGroup);
}

function drawGroup(g) {
  const el = document.querySelector(`.ot-page[data-group="${CSS.escape(g.id)}"]`);
  if (!el) return;
  const here = ctx.here;
  const items = g.items
    .map((it, i) => {
      const t = etaText(eta.get(it.stopUID));
      const d = here && it.lat != null ? meters(here.lat, here.lon, it.lat, it.lon) : null;
      return `<div class="ot-stop-card" data-item="${i}">
        <button class="ot-stop-main" type="button" data-open="${i}">
          <span class="ot-route-no big">${e(it.route)}</span>
          <span class="ot-stop-what"><b>${e(it.stop)}</b><small>往 ${e(it.headsign || '—')}${it.city !== INTERCITY ? ` · ${e(cityShort(it.city))}` : ' · 公路客運'}${d != null ? ` · ${e(distText(d))}` : ''}</small></span>
          <span class="ot-eta ${t.tone}"><b>${e(t.main)}</b><small>${e(t.sub)}</small></span>
        </button>
      </div>`;
    })
    .join('');
  el.innerHTML = `
    ${error ? `<p class="ot-note bad">${e(error)}</p>` : ''}
    ${items || `<div class="ot-empty-card">${icon('bus', 'big')}<h3>${e(g.name)} 還沒有站牌</h3><p>搜尋路線，點你上車的站牌，就會出現在這裡，並顯示公車還有幾分鐘到。</p></div>`}
    <button class="q-btn primary ot-wide" type="button" data-act="add">${icon('plus')} 新增路線站牌</button>
    ${g.items.length ? `<p class="ot-note center">${e(ago(lastAt))} · 每 20 秒更新</p>` : ''}`;
}

async function refresh() {
  const g = groups()[index];
  if (!g?.items.length) return;
  try {
    const m = await stopsEta(g.items);
    for (const [k, v] of m) eta.set(k, v);
    lastAt = Date.now();
    error = '';
  } catch (err) {
    error = errorText(err);
  }
  drawGroup(g);
}

function goTo(i) {
  index = Math.max(0, Math.min(groups().length - 1, i));
  $('bus-pager').scrollLeft = index * $('bus-pager').clientWidth;
  drawChips();
  refresh();
}

function onClick(ev) {
  const add = ev.target.closest('[data-act="add"]');
  if (add) return searchSheet();
  const open = ev.target.closest('[data-open]');
  if (open) {
    const it = groups()[index].items[Number(open.dataset.open)];
    if (it) openRoute(ctx, { uid: it.routeUID, name: it.route, city: it.city }, { stopUID: it.stopUID, dir: it.dir });
  }
}

// ---- Finding a route --------------------------------------------------------------------------------

function searchSheet() {
  let city = ctx.city || 'Taipei';
  let list = [];
  const d = sheet(`${sheetHead('搜尋公車路線')}
    <div class="ot-search-in"><input id="r-q" type="search" inputmode="search" placeholder="路線號碼或站名，例如 藍1、182、新竹車站" autocomplete="off" enterkeyhint="search"></div>
    <div class="q-chips ot-city-chips" id="r-city"></div>
    <div id="r-list" class="ot-list"></div>`, 'ot-tall-sheet');
  const cities = () =>
    (d.querySelector('#r-city').innerHTML = [...CITIES.filter(([k]) => k === (ctx.city || 'Taipei')), [INTERCITY, '公路客運'], ...CITIES.filter(([k]) => k !== (ctx.city || 'Taipei'))].map(([k, n]) => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === city}">${e(k === INTERCITY ? n : cityShort(k))}</button>`).join(''));
  const draw = () => {
    const t = d.querySelector('#r-q').value;
    const found = t ? findRoutes(list, t) : list.slice(0, 0);
    d.querySelector('#r-list').innerHTML = !list.length
      ? '<p class="ot-note">載入路線中…</p>'
      : !t
        ? `<p class="ot-note">${e(city === INTERCITY ? '公路客運與國道客運' : cityName(city))}共 ${list.length} 條路線，輸入號碼或站名。</p>`
        : found.map(r => `<button class="ot-row-btn" type="button" data-r="${e(r.uid)}"><span class="ot-route-no">${e(r.name)}</span><span><b>${e(r.from)} ↔ ${e(r.to)}</b></span>${icon('chevron')}</button>`).join('') || '<p class="ot-note">這個縣市沒有符合的路線，試試其他縣市或公路客運。</p>';
  };
  const load = async () => {
    list = [];
    draw();
    try {
      list = await cityRoutes(city);
    } catch (err) {
      d.querySelector('#r-list').innerHTML = `<p class="ot-note bad">${e(errorText(err))}</p>`;
      return;
    }
    draw();
  };
  cities();
  load();
  d.querySelector('#r-q').addEventListener('input', draw);
  d.addEventListener('click', ev => {
    const c = ev.target.closest('[data-city]');
    if (c) {
      city = c.dataset.city;
      cities();
      return load();
    }
    const r = ev.target.closest('[data-r]');
    if (r) {
      const route = list.find(x => x.uid === r.dataset.r);
      d.close();
      openRoute(ctx, route, { add: true });
    }
  });
  setTimeout(() => d.querySelector('#r-q').focus(), 50);
}

// ---- A route: its stops each way, the buses on them ----------------------------------------------------

export async function openRoute(c, route, { stopUID = '', dir = null, add = false } = {}) {
  ctx ||= c;
  let ways = null;
  let way = 0;
  let live = new Map();
  let at = 0;
  let err = '';
  const d = sheet(`<div id="rt"></div>`, 'ot-tall-sheet ot-route-sheet');
  const draw = () => {
    const w = ways?.[way];
    const head = sheetHead(`${e(route.name)}`, w ? `往 ${e(w.headsign)}${route.city === INTERCITY ? ' · 公路客運' : ` · ${e(cityShort(route.city))}`}` : '');
    const tabs = ways && ways.length > 1 ? `<div class="q-chips ot-dir">${ways.map((x, i) => `<button class="q-chip" type="button" data-way="${i}" aria-pressed="${i === way}">往 ${e(x.headsign)}${x.subName && x.subName !== route.name ? `<small>${e(x.subName)}</small>` : ''}</button>`).join('')}</div>` : '';
    const stops = !ways
      ? '<p class="ot-note">載入站牌中…</p>'
      : !w
        ? '<p class="ot-note">這條路線沒有站牌資料。</p>'
        : `<ol class="ot-route-stops">${w.stops
            .map(s => {
              const t = etaText(live.get(s.uid));
              const mine = s.uid === stopUID;
              const inGroup = ctx.data.groups.some(g => g.items.some(x => x.stopUID === s.uid));
              return `<li class="${t.tone}${mine ? ' mine' : ''}" data-stop="${e(s.uid)}"><span class="ot-eta ${t.tone}"><b>${e(t.main)}</b></span><span class="ot-rs-dot"></span><button class="ot-rs-name" type="button" data-add="${e(s.uid)}"><b>${e(s.name)}</b>${inGroup ? `<small>${icon('star')} 已加入</small>` : '<small>＋ 加入群組</small>'}</button></li>`;
            })
            .join('')}</ol>`;
    d.querySelector('#rt').innerHTML = `${head}${tabs}${err ? `<p class="ot-note bad">${e(err)}</p>` : ''}${add ? '<p class="ot-note">點你上車的站牌，加入群組。</p>' : ''}${stops}<p class="ot-note center">${e(ago(at))}</p>`;
  };
  const refresh = async () => {
    try {
      live = await routeEta(route);
      at = Date.now();
      err = '';
    } catch (x) {
      err = errorText(x);
    }
    if (d.open) draw();
  };
  draw();
  try {
    ways = await routeStops(route);
    if (dir != null) {
      const i = ways.findIndex(w => w.dir === dir && (!stopUID || w.stops.some(s => s.uid === stopUID)));
      way = i >= 0 ? i : Math.max(0, ways.findIndex(w => w.stops.some(s => s.uid === stopUID)));
    }
    // A sub-route the main pattern already covers is one tab less.
    ways = ways.filter((w, i) => i === way || !ways.some((o, j) => j < i && o.dir === w.dir && w.stops.every(s => o.stops.some(x => x.uid === s.uid))));
    way = Math.min(way, ways.length - 1);
  } catch (x) {
    err = errorText(x);
    ways = [];
  }
  draw();
  refresh();
  const t = setInterval(refresh, 20_000);
  d.onclosed = () => clearInterval(t);
  // Scrolled to the stop asked for.
  if (stopUID) requestAnimationFrame(() => d.querySelector(`[data-stop="${CSS.escape(stopUID)}"]`)?.scrollIntoView({ block: 'center' }));
  d.addEventListener('click', ev => {
    const w = ev.target.closest('[data-way]');
    if (w) {
      way = Number(w.dataset.way);
      return draw();
    }
    const a = ev.target.closest('[data-add]');
    if (a && ways?.[way]) {
      const s = ways[way].stops.find(x => x.uid === a.dataset.add);
      if (s) chooseGroup({ city: route.city, routeUID: route.uid, route: route.name, dir: ways[way].dir, stopUID: s.uid, stop: s.name, headsign: ways[way].headsign, lat: s.lat, lon: s.lon }, draw);
    }
  });
}

// Which group a stop goes into (or a new one).
function chooseGroup(raw, done) {
  const item = cleanItem({ ...raw, id: 'i' + uid() });
  const d = sheet(`${sheetHead('加入群組', `${e(item.route)} · ${e(item.stop)}`)}
    <div class="ot-list">${ctx.data.groups
      .map((g, i) => {
        const has = g.items.some(x => x.stopUID === item.stopUID);
        return `<button class="ot-row-btn" type="button" data-to="${i}" ${has ? 'disabled' : ''}><span><b>${e(g.name)}</b><small>${g.items.length} 個站牌${has ? ' · 已在這裡' : ''}</small></span>${icon('plus')}</button>`;
      })
      .join('')}</div>
    ${ctx.data.groups.length < MAX_GROUPS ? `<label class="ot-field"><span>或新的群組</span><div class="ot-row"><input id="g-new" maxlength="12" placeholder="例如：上班、回家"><button class="q-btn" type="button" data-new="1">建立並加入</button></div></label>` : ''}`);
  d.addEventListener('click', ev => {
    const to = ev.target.closest('[data-to]');
    let g = null;
    if (to) g = ctx.data.groups[Number(to.dataset.to)];
    if (ev.target.closest('[data-new]')) {
      const name = d.querySelector('#g-new').value.trim();
      if (!name) return;
      g = { id: 'g' + uid(), name, items: [] };
      ctx.data.groups.push(g);
    }
    if (!g) return;
    if (g.items.length >= MAX_ITEMS) return ctx.status(`一個群組最多 ${MAX_ITEMS} 個站牌`);
    g.items.push(item);
    ctx.save();
    d.close();
    index = ctx.data.groups.indexOf(g);
    render();
    refresh();
    done?.();
    ctx.status(`已加入「${g.name}」`);
  });
}

// ---- Managing the groups: names, order, their stops ------------------------------------------------------

function manageSheet() {
  const d = sheet('', 'ot-tall-sheet');
  const draw = () => {
    d.innerHTML = `${sheetHead('管理群組', '上下移動調整順序；左右滑動就照這個順序切換')}
      ${ctx.data.groups
        .map(
          (g, i, all) => `<section class="ot-manage">
          <div class="ot-order-row head"><input class="ot-name-in" data-name="${i}" value="${e(g.name)}" maxlength="16" aria-label="群組名稱">
            <button class="q-icon-btn" type="button" data-gmove="${i}" data-by="-1" aria-label="上移" ${i ? '' : 'disabled'}>${icon('up')}</button>
            <button class="q-icon-btn" type="button" data-gmove="${i}" data-by="1" aria-label="下移" ${i < all.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
            <button class="q-icon-btn" type="button" data-gdel="${i}" aria-label="刪除群組" ${all.length > 1 ? '' : 'disabled'}>${icon('trash')}</button></div>
          ${g.items
            .map(
              (it, k, list) => `<div class="ot-order-row"><span><b>${e(it.route)}</b> ${e(it.stop)}<small>往 ${e(it.headsign)}</small></span>
              <button class="q-icon-btn" type="button" data-imove="${i}:${k}" data-by="-1" aria-label="上移" ${k ? '' : 'disabled'}>${icon('up')}</button>
              <button class="q-icon-btn" type="button" data-imove="${i}:${k}" data-by="1" aria-label="下移" ${k < list.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
              <button class="q-icon-btn" type="button" data-idel="${i}:${k}" aria-label="移除">${icon('trash')}</button></div>`
            )
            .join('')}
        </section>`
        )
        .join('')}
      ${ctx.data.groups.length < MAX_GROUPS ? `<button class="q-btn ot-wide" type="button" data-gadd="1">${icon('plus')} 新增群組</button>` : ''}`;
  };
  draw();
  d.addEventListener('change', ev => {
    const n = ev.target.closest('[data-name]');
    if (!n) return;
    ctx.data.groups[Number(n.dataset.name)].name = n.value.trim().slice(0, 16) || '群組';
    ctx.save();
    render();
  });
  d.addEventListener('click', ev => {
    const by = Number(ev.target.closest('[data-by]')?.dataset.by || 0);
    const gm = ev.target.closest('[data-gmove]');
    const gd = ev.target.closest('[data-gdel]');
    const im = ev.target.closest('[data-imove]');
    const id = ev.target.closest('[data-idel]');
    if (gm) ctx.data.groups = move(ctx.data.groups, Number(gm.dataset.gmove), by);
    else if (gd) ctx.data.groups = ctx.data.groups.filter((_, i) => i !== Number(gd.dataset.gdel));
    else if (im) {
      const [g, k] = im.dataset.imove.split(':').map(Number);
      ctx.data.groups[g].items = move(ctx.data.groups[g].items, k, by);
    } else if (id) {
      const [g, k] = id.dataset.idel.split(':').map(Number);
      ctx.data.groups[g].items = ctx.data.groups[g].items.filter((_, i) => i !== k);
    } else if (ev.target.closest('[data-gadd]')) ctx.data.groups.push({ id: 'g' + uid(), name: `群組 ${ctx.data.groups.length + 1}`, items: [] });
    else return;
    ctx.save();
    draw();
    render();
  });
}
