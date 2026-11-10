// 捷運 (查時刻 → 捷運): each city's metro as a metro map (metromap.mjs: the
// lines in their colours, straight runs, the names a size you can read at
// any zoom), filling the screen down to the tabs (Jay 2026-11-10: "so small
// hard to navigate"). On it: the cities, 搜尋車站 (every station of the nine
// systems, by name or code), 實景, you, full screen; the lines along its foot,
// a tap bringing one forward; the trains arriving now. Tap a station: it's
// ringed, and its sheet has the next trains each way counting down, the
// day's first and last, its exits (metro-ui.mjs). 實景 shows the same lines
// on the real map (Google's, or NLSC's past the month's cap).

import { MAPS, OPERATORS, loadSystem, lineRuns, interchanges, liveTrains, stationTitle } from './metro.mjs';
import { schematic, mountMap, trainFrom } from './metromap.mjs';
import DRAWINGS from './metro-drawings.mjs';
import { codesHtml, linesOf, loadBoards, boardHtml, firstLastHtml, exitsHtml } from './metro-ui.mjs';
import { createMap } from './map.mjs';
import { errorText, liveMs, keptLocal, keepLocal } from './api.mjs';
import { sheet, sheetHead, icon, inkOn } from './ui.mjs';
import { tile, tick, noticesHtml, rowCard } from './look.mjs';
import { loadNotices } from './service.mjs';
import { e, meters, shown, distText, readJson, writeJson } from './util.mjs';

import { W, en } from '#kit/lang.mjs';
const $ = id => document.getElementById(id);
// A station as its sheet and the search name it: 西門站, 台北車站; Ximen in English.
const title = name => (en ? shown(name) : stationTitle(name));
const KEY = 'orbit-transit.metro';
const MODE_KEY = 'orbit-transit.metro.mode';
// The stations last opened (from the map or a search), newest first: [{ map, key }].
const RECENT_KEY = 'orbit-transit.metro.recent.v1';
let ctx = null;
let current = null;
let systems = [];
let retry = 0;
// The metro map now drawn: its layout and its view.
let schem = null;
let view = null;
let focused = null;
let trainTimer = 0;
// The real map (實景), made the first time it's asked for.
let geo = null;
let mode = 'schem';

export function init(c) {
  ctx = c;
  try {
    mode = localStorage.getItem(MODE_KEY) === 'geo' ? 'geo' : 'schem';
  } catch {}
  const panel = $('panel-metro');
  panel.innerHTML = `<div id="m-notice" class="ot-m-notice"></div>
    <div class="ot-metro-view" id="m-view">
      <div id="m-schem" class="mm-box" role="img" aria-label="${W('捷運路線圖', 'Metro map')}"></div>
      <div id="m-map" class="ot-map" hidden></div>
      <div class="mm-top">
        <nav class="mm-cities" id="m-maps" aria-label="${W('城市', 'City')}">${MAPS.map(m => `<button type="button" data-map="${m.id}" aria-pressed="false">${e(m.short)}</button>`).join('')}</nav>
        <button class="mm-fab" type="button" data-full aria-pressed="false" aria-label="${W('全螢幕', 'Full screen')}">${icon('expand', 'mm-grow')}${icon('shrink', 'mm-shrink')}</button>
      </div>
      <button class="mm-find" type="button" data-find>${icon('search')}<span>${W('搜尋車站', 'Find a station')}</span></button>
      <div class="mm-side">
        <button class="mm-pill" type="button" data-mode-flip><span class="mm-to-geo">${W('實景', 'Real map')}</span><span class="mm-to-schem">${W('路線圖', 'Lines')}</span></button>
        <button class="mm-fab" type="button" data-locate aria-label="${W('最近的車站', 'Nearest station')}">${icon('locate')}</button>
        <div class="mm-zoom" role="group" aria-label="${W('縮放', 'Zoom')}"><button type="button" data-zoom="in" aria-label="${W('放大', 'Zoom in')}">${icon('plus')}</button><button type="button" data-zoom="out" aria-label="${W('縮小', 'Zoom out')}">${icon('minus')}</button></div>
      </div>
      <p class="ot-metro-msg" id="m-msg"></p>
      <div class="mm-legend" id="m-legend"></div>
    </div>`;
  panel.addEventListener('click', ev => {
    const b = ev.target.closest('[data-map]');
    if (b) return open(b.dataset.map);
    if (ev.target.closest('[data-mode-flip]')) return setMode(mode === 'geo' ? 'schem' : 'geo');
    const l = ev.target.closest('#m-legend [data-line]');
    if (l) return focusLine(l.dataset.line === focused ? null : l.dataset.line);
    if (ev.target.closest('[data-locate]')) return locate();
    if (ev.target.closest('[data-find]')) return findSheet();
    if (ev.target.closest('[data-full]')) return full(!$('m-view').classList.contains('mm-full'));
    const z = ev.target.closest('[data-zoom]');
    if (z) return view?.zoomBy(z.dataset.zoom === 'in' ? 1.6 : 1 / 1.6);
  });
  addEventListener('resize', () => {
    fitHeight();
    view?.resize();
  });
  addEventListener('keydown', ev => ev.key === 'Escape' && $('m-view')?.classList.contains('mm-full') && !document.querySelector('dialog[open]') && full(false));
}

export async function show() {
  paintMode();
  fitHeight();
  // (The screen may have turned while another tab was showing: the drawing fits its box again.)
  view?.resize();
  const want = ctx.metroStation ? MAPS.find(m => m.systems.includes(ctx.metroStation.op))?.id : null;
  if (want && want !== current) await open(want);
  else if (!current) {
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    // The system you're in (or within 10 km of); else the last one you chose; else 台北.
    const h = ctx.here;
    const away = m => (!h ? Infinity : meters(h.lat, h.lon, Math.min(Math.max(h.lat, m.box[0]), m.box[2]), Math.min(Math.max(h.lon, m.box[1]), m.box[3])));
    const here = h ? MAPS.map(m => [away(m), m]).sort((a, b) => a[0] - b[0])[0] : null;
    await open(here && here[0] < 10_000 ? here[1].id : MAPS.some(m => m.id === saved) ? saved : 'taipei');
  } else {
    view?.resize();
    geo?.resize();
    trainsSoon();
  }
  if (ctx.metroStation && schem) {
    const st = ctx.metroStation;
    ctx.metroStation = null;
    const n = schem.nodes.find(x => x.st.some(s => s.key === st.key));
    if (n) {
      view?.view(n, Math.max(1.3, view.zoom()));
      stationSheet(n);
    }
  }
}
export function hide() {
  clearTimeout(trainTimer);
  full(false);
}

// The map from where it starts down to the tabs (a phone's floating bar, else the window's foot).
function fitHeight() {
  const v = $('m-view');
  if (!v || v.classList.contains('mm-full') || $('panel-metro').hidden) return;
  const top = v.getBoundingClientRect().top + (document.scrollingElement?.scrollTop || 0);
  v.style.setProperty('--mm-top', `${Math.round(top)}px`);
}

// Full screen: the map over everything (moved to the page's end, so nothing it sits in can hold it).
let fullHome = null;
function full(on) {
  const v = $('m-view');
  if (!v || v.classList.contains('mm-full') === on) return;
  if (on) {
    fullHome = document.createComment('m-view');
    v.before(fullHome);
    document.body.append(v);
  } else if (fullHome) {
    fullHome.replaceWith(v);
    fullHome = null;
  }
  v.classList.toggle('mm-full', on);
  document.documentElement.classList.toggle('mm-fulled', on);
  v.querySelector('[data-full]').setAttribute('aria-pressed', String(on));
  v.querySelector('[data-full]').setAttribute('aria-label', on ? W('結束全螢幕', 'Exit full screen') : W('全螢幕', 'Full screen'));
  fitHeight();
  requestAnimationFrame(() => {
    view?.resize();
    geo?.resize();
  });
}

function paintMode() {
  const v = $('m-view');
  v.classList.toggle('mm-geo', mode === 'geo');
  $('m-schem').hidden = mode !== 'schem';
  $('m-map').hidden = mode !== 'geo';
}
async function setMode(m) {
  if (m === mode) return;
  mode = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {}
  paintMode();
  if (mode === 'geo') await drawGeo();
  else view?.resize();
}

async function open(id) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  $('m-maps').querySelectorAll('[data-map]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.map === id)));
  const m = MAPS.find(x => x.id === id);
  // Its systems' notices when one isn't running as usual (a typhoon's headways, 貓空 closed).
  $('m-notice').innerHTML = '';
  loadNotices({ kinds: ['metro'], systems: m.systems })
    .then(n => {
      if (current !== id) return;
      $('m-notice').innerHTML = noticesHtml(n);
      fitHeight();
    })
    .catch(() => {});
  fitHeight();
  $('m-msg').textContent = W('載入路網…', 'Loading the network…');
  clearTimeout(retry);
  clearTimeout(trainTimer);
  try {
    const got = (await Promise.all(m.systems.map(s => loadSystem(s).catch(() => null)))).filter(s => s?.stations.length);
    if (current !== id) return;
    systems = got;
    if (!systems.length) throw Object.assign(new Error('empty'), { code: 'TDX_FAILED' });
  } catch (err) {
    if (current !== id) return;
    // Not the last city's map under this one's error, and tried again as the message says.
    systems = [];
    schem = null;
    view?.destroy();
    view = null;
    geo?.lines('metro', []);
    geo?.layer('metro').set([]);
    $('m-legend').innerHTML = '';
    $('m-msg').textContent = errorText(err);
    retry = setTimeout(() => current === id && open(id), 30_000);
    return;
  }
  // The drawing: kept from last time when the network's the same, else worked out (a moment, once).
  const kept = await keptLocal(`metro-map-v2/${id}`).catch(() => null);
  if (current !== id) return;
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  // (Worked out ahead for each city, scripts/metro-maps.mjs; a phone works out its own only when TDX's network has changed since.)
  schem = schematic(systems, { preset: [DRAWINGS[id], kept?.data] });
  if (schem.sig !== DRAWINGS[id]?.sig && schem.sig !== kept?.data?.sig) keepLocal(`metro-map-v2/${id}`, { sig: schem.sig, pos: schem.pos });
  $('m-msg').textContent = '';
  focused = null;
  view?.destroy();
  view = mountMap($('m-schem'), schem, { onTap: n => stationSheet(n) });
  // You at your station when you're near one; the whole city when it fits at a size you can read; else its busiest interchange.
  const mine = hereNode();
  const live = schem.nodes.filter(n => n.lines.length);
  // (The busiest: the most track out of it, then the one nearest the middle of the city's interchanges: 台北車站, 美麗島.)
  const out = n => schem.edges.filter(([a, b]) => a === n.i || b === n.i).length;
  const hubs = live.filter(n => n.lines.length > 1);
  const mid = hubs.length ? [hubs.reduce((a, n) => a + n.x, 0) / hubs.length, hubs.reduce((a, n) => a + n.y, 0) / hubs.length] : [0, 0];
  const off = n => Math.hypot(n.x - mid[0], n.y - mid[1]);
  const hub = live.slice().sort((a, b) => b.lines.length - a.lines.length || out(b) - out(a) || off(a) - off(b))[0];
  view.here(mine);
  if (mine) view.view(mine, 1.2, { now: true });
  else if (view.fitZoom() >= 0.7) view.fit(null, { now: true });
  else view.view(hub, 0.9, { now: true });
  legend();
  if (mode === 'geo') drawGeo();
  trains();
}

// The lines, one chip each along the map's foot: tap to bring one forward.
function legend() {
  const seen = new Set();
  $('m-legend').innerHTML = schem.lines
    .filter(l => !seen.has(l.name) && seen.add(l.name))
    .map(l => `<button type="button" data-line="${e(l.key)}" style="--c:${e(l.color)};--ink:${inkOn(l.color)}" aria-pressed="false"><i></i>${e(shown(l.name))}</button>`)
    .join('');
  $('m-legend').scrollLeft = 0;
}
function focusLine(key) {
  focused = key;
  for (const b of $('m-legend').querySelectorAll('[data-line]')) b.setAttribute('aria-pressed', String(b.dataset.line === key));
  view?.focus(key);
  if (key) view?.fit(key);
}

const hereNode = () => {
  const h = ctx.here;
  if (!h || !schem) return null;
  const best = schem.nodes
    .filter(n => n.lines.length)
    .map(n => [Math.min(...n.st.map(s => meters(h.lat, h.lon, s.lat, s.lon))), n])
    .sort((a, b) => a[0] - b[0])[0];
  return best && best[0] < 1500 ? best[1] : null;
};
async function locate() {
  await ctx.locate?.({ force: true });
  const n = hereNode();
  view?.here(n);
  if (n) view?.view(n, Math.max(1.2, view.zoom()));
  else ctx.status(W('附近沒有這個城市的捷運站', 'No station of this metro near you'));
}

// The trains arriving now, on the map, again each time the operators' boards refresh.
async function trains() {
  clearTimeout(trainTimer);
  if (!schem || !view) return;
  const id = current;
  const nodeOf = new Map(schem.nodes.flatMap(n => n.st.map(s => [s.key, n.i])));
  const colorOf = new Map(schem.lines.map(l => [l.key, l.color]));
  const all = (await Promise.all(systems.map(s => liveTrains(s.sys).catch(() => [])))).flat();
  if (current !== id || !view) return;
  view.trains(
    all
      .map(t => {
        const node = nodeOf.get(t.at);
        const dest = nodeOf.get(t.dest);
        const key = `${t.at.split(':')[1]}:${t.line}`;
        if (node == null || dest == null || node === dest) return null;
        return { node, from: trainFrom(schem, node, dest, colorOf.has(key) ? key : null), min: t.min, color: colorOf.get(key) || '#8e8e93' };
      })
      .filter(Boolean)
  );
  trainsSoon();
}
function trainsSoon() {
  clearTimeout(trainTimer);
  trainTimer = setTimeout(() => !$('panel-metro').hidden && trains(), liveMs());
}

// ---- 搜尋車站: every station of the nine systems ------------------------------------------------------

// Each city's stations as the map groups them (台北車站: BL12 and R10 one), with their lines: [{ map, name, list, lines, lat, lon }].
let everyStation = null;
function allStations() {
  everyStation ||= Promise.all(
    MAPS.map(async m => {
      const sys = (await Promise.all(m.systems.map(s => loadSystem(s).catch(() => null)))).filter(s => s?.stations.length);
      const lines = sys.flatMap(s => s.lines.map(l => ({ ...l, key: `${l.sys}:${l.id}` })));
      return interchanges(
        sys.flatMap(s => s.stations),
        sys.flatMap(s => s.transfers || [])
      ).map(list => ({ map: m.id, name: list[0].name, list, lines: lines.filter(l => list.some(st => l.seq.includes(st.key))), lat: list[0].lat, lon: list[0].lon }));
    })
  )
    .then(all => all.flat())
    .catch(err => {
      everyStation = null;
      throw err;
    });
  return everyStation;
}
// The words as typed and a name, alike: 臺 as 台, no 站 at the end, no spaces, any case.
const norm = s =>
  String(s || '')
    .toLowerCase()
    .replace(/臺/g, '台')
    .replace(/\s+/g, '')
    .replace(/站$/, '');
// The stations a search finds, best first: a name or code as typed, then one beginning so, then any with it inside.
export function findMetro(all, q, here = null) {
  const w = norm(q);
  if (!w) return [];
  const score = g => {
    const names = [g.name, ...g.list.map(s => s.en), shown(g.name)].map(norm).filter(Boolean);
    const codes = g.list.map(s => s.id.toLowerCase());
    if (names.includes(w) || codes.includes(w)) return 0;
    if (names.some(n => n.startsWith(w)) || codes.some(c => c.startsWith(w))) return 1;
    if (names.some(n => n.includes(w))) return 2;
    return null;
  };
  return all
    .map(g => [score(g), g])
    .filter(([s]) => s != null)
    .sort((a, b) => a[0] - b[0] || Number(b[1].map === here) - Number(a[1].map === here) || a[1].name.length - b[1].name.length)
    .map(([, g]) => g);
}
async function findSheet() {
  const d = sheet(
    `${sheetHead(W('搜尋車站', 'Find a station'))}
    <label class="q-search ot-search-in"><input id="mf-q" type="search" placeholder="${W('站名或代號，如 BL12', 'Name or code, like BL12')}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"><button class="q-search-clear" type="button" aria-label="${W('清除', 'Clear')}">✕</button></label>
    <div id="mf-body">${boardHtml(null)}</div>`,
    'ot-tall-sheet mm-find-sheet'
  );
  const input = d.querySelector('#mf-q');
  const body = d.querySelector('#mf-body');
  let all = null;
  const city = id => MAPS.find(m => m.id === id)?.short || '';
  const row = (g, value = '') => `<button class="q-ritem mf-row" type="button" data-mf="${e(g.map)}|${e(g.list[0].key)}"><span class="q-ritem-text"><span class="q-ritem-title">${e(title(g.name))}</span><span class="mm-codes mf-codes">${codesHtml(g.list, g.lines)}</span></span>${value ? `<span class="q-ritem-value">${e(value)}</span>` : ''}</button>`;
  const head = t => `<h3 class="q-sheet-h">${t}</h3>`;
  const draw = () => {
    if (!d.open) return;
    if (!all) return;
    const q = input.value;
    if (q.trim()) {
      const found = findMetro(all, q, current).slice(0, 30);
      body.innerHTML = found.length ? rowCard(found.map(g => row(g, g.map === current ? '' : city(g.map))).join('')) : `<p class="ot-note">${W('沒有符合的車站', 'No matching station')}</p>`;
      return;
    }
    // Nothing typed: the stations you opened last, those near you, then this city's interchanges.
    const byKey = new Map(all.flatMap(g => g.list.map(s => [s.key, g])));
    const recent = readJson(RECENT_KEY, [])
      .map(r => byKey.get(r.key))
      .filter(Boolean)
      .slice(0, 5);
    const h = ctx.here;
    const near = h
      ? all
          .map(g => [meters(h.lat, h.lon, g.lat, g.lon), g])
          .filter(([m, g]) => m < 3000 && !recent.includes(g))
          .sort((a, b) => a[0] - b[0])
          .slice(0, 3)
      : [];
    const hubs = all
      .filter(g => g.map === current && g.lines.length > 1 && !recent.includes(g))
      .sort((a, b) => b.lines.length - a.lines.length || a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, 8);
    body.innerHTML = [recent.length ? head(W('最近查看', 'Recent')) + rowCard(recent.map(g => row(g, g.map === current ? '' : city(g.map))).join('')) : '', near.length ? head(W('附近', 'Nearby')) + rowCard(near.map(([m, g]) => row(g, distText(m))).join('')) : '', hubs.length ? head(W('轉乘站', 'Interchanges')) + rowCard(hubs.map(g => row(g)).join('')) : ''].join('');
  };
  input.addEventListener('input', draw);
  d.querySelector('.q-search-clear').addEventListener('click', () => {
    input.value = '';
    input.focus();
    draw();
  });
  input.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    body.querySelector('[data-mf]')?.click();
  });
  d.addEventListener('click', ev => {
    const b = ev.target.closest('[data-mf]');
    if (!b) return;
    const [map, key] = b.dataset.mf.split('|');
    d.shut();
    goTo(map, key);
  });
  // (The keyboard up at once on a phone: focus inside the tap that opened the sheet.)
  input.focus({ preventScroll: true });
  try {
    all = await allStations();
    draw();
  } catch (err) {
    if (d.open) body.innerHTML = `<p class="ot-note">${e(errorText(err))}</p>`;
  }
}
// A station found: its city's map, the map moved to it, its sheet.
async function goTo(map, key) {
  if (mode === 'geo') await setMode('schem');
  if (map !== current) await open(map);
  const n = schem?.nodes.find(x => x.st.some(s => s.key === key));
  if (!n) return;
  if (focused) focusLine(null);
  view?.view(n, Math.max(1.4, view.zoom()));
  stationSheet(n);
}
function remember(n) {
  const key = n.st[0].key;
  writeJson(RECENT_KEY, [{ map: current, key }, ...readJson(RECENT_KEY, []).filter(r => r.key !== key && !n.st.some(s => s.key === r.key))].slice(0, 8));
}

// ---- 實景: the lines on the real map --------------------------------------------------------------------

let geoGroups = [];
async function drawGeo() {
  if (!geo) {
    const cfg = ctx.cfg?.map || { provider: 'nlsc' };
    try {
      geo = await createMap($('m-map'), { provider: cfg.provider, key: cfg.key, center: { lat: 25.05, lon: 121.52 }, zoom: 12, onPick: it => it.data && stationSheet({ st: it.data }), onIdle: geoNames });
      // Google's own transit lines would draw a second map under ours.
      geo.showTransit(false);
    } catch (err) {
      $('m-msg').textContent = W(`地圖載入失敗：${err.message}`, `Map failed to load: ${err.message}`);
      return;
    }
  }
  geo.resize();
  const byKey = new Map(systems.flatMap(s => s.stations).map(s => [s.key, s]));
  geo.lines(
    'metro',
    systems
      .flatMap(s => s.lines)
      .flatMap(l =>
        (l.paths?.length ? l.paths.map(p => p.map(k => byKey.get(k)).filter(Boolean)) : lineRuns(l, byKey))
          .filter(r => r.length > 1)
          .map(r => ({ pts: r.map(s => [s.lat, s.lon]), color: l.color, width: 6, z: 3 }))
      )
  );
  geoGroups = interchanges([...byKey.values()], systems.flatMap(s => s.transfers || []));
  const all = [...byKey.values()];
  const h = ctx.here;
  const nearest = h ? all.map(s => [meters(h.lat, h.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0])[0] : null;
  if (nearest && nearest[0] < 3000) geo.setView(nearest[1].lat, nearest[1].lon, 15);
  else geo.fit(all, 30);
  geoNames();
}
// The stations: a dot each (a ring for an interchange); their names once zoomed in.
function geoNames() {
  if (!geo || !geoGroups.length) return;
  const z = geo.zoom();
  const lines = systems.flatMap(s => s.lines);
  const colorOf = st => lines.find(l => l.seq.includes(st.key))?.color || '#fff';
  geo.layer('metro').set(
    geoGroups.map(g => {
      const s = g[0];
      const lat = g.reduce((a, x) => a + x.lat, 0) / g.length;
      const lon = g.reduce((a, x) => a + x.lon, 0) / g.length;
      const big = g.length > 1 || s.lines.length > 1;
      const label = z >= 14 || (big && z >= 12);
      return { id: `m:${s.key}`, lat, lon, cls: `mstop${big ? ' x' : ''}${z < 13 ? ' far' : ''}`, z: big ? 6 : 5, data: g, html: `<i style="--c:${e(colorOf(s))}"></i>${label ? `<span>${e(shown(s.name))}</span>` : ''}` };
    })
  );
}

// ---- A station ------------------------------------------------------------------------------------------

// `n`: the map's station (its stations `st`, one an interchange's each line); ringed on the map while its sheet is open.
async function stationSheet(n) {
  const list = n?.st;
  if (!list?.length) return;
  if (n.i != null && schem?.nodes[n.i] === n) {
    view?.select(n);
    remember(n);
  }
  const name = list[0].name;
  const lines = await linesOf(list).catch(() => []);
  const color = lines[0]?.color || '#3b82f6';
  const ops = [...new Set(list.map(s => OPERATORS[s.op]))].join('・');
  const d = sheet(
    `${sheetHead(e(title(name)), e(ops), tile('metro', color))}
    <div class="mm-codes">${codesHtml(list, lines)}</div>
    <h3 class="q-sheet-h">${W('下一班', 'Next trains')}</h3>
    <div id="mb">${boardHtml(null)}</div>
    <div id="mfl"></div>
    <div id="mex"></div>
    <button class="q-btn primary block ot-sheet-go" type="button" data-route-here="1">${icon('route')} ${W('怎麼去', 'Directions')}</button>`,
    'mm-sheet'
  );
  let exits = null;
  const load = async () => {
    const boards = await loadBoards(list);
    if (!d.open) return;
    d.querySelector('#mb').innerHTML = boardHtml(boards, lines);
    d.querySelector('#mfl').innerHTML = firstLastHtml(boards, lines);
  };
  load();
  exitsHtml(list).then(x => {
    exits = x;
    if (!d.open || !x.count) return;
    d.querySelector('#mex').innerHTML = `<div class="q-rowcard"><button class="q-ritem chevron" type="button" data-exits>${tile('walk', '#8e8e93', 'sm')}<span class="q-ritem-text"><span class="q-ritem-title">${W('出口', 'Exits')}</span><small>${x.lifts ? W(`${x.lifts} 個有電梯`, `${x.lifts} with a lift`) : W('每個出口在哪裡', 'Where each comes out')}</small></span><span class="q-ritem-value">${x.count}</span></button></div>`;
  });
  const t = setInterval(load, liveMs());
  const ticker = setInterval(() => tick(d), 5000);
  d.onclosed = () => {
    clearInterval(t);
    clearInterval(ticker);
    view?.select(null);
  };
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-exits]') && exits) {
      sheet(`${sheetHead(W('出口', 'Exits'), e(title(name)), tile('walk', '#8e8e93'))}${exits.html}`, 'mm-sheet');
    } else if (ev.target.closest('[data-route-here]')) {
      d.shut();
      full(false);
      ctx.openTrip(null, { name: stationTitle(name), lat: list[0].lat, lon: list[0].lon });
    }
  });
}
