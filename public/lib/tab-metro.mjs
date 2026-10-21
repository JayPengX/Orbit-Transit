// 捷運 (查時刻 → 捷運): each city's metro as a metro map (metromap.mjs: the
// lines in their colours, straight runs, every station named), moved with a
// finger; the trains arriving now on it; you at your station. A line's chip
// brings it forward. Tap a station: its next trains each way counting down,
// the day's first and last, its exits (metro-ui.mjs). 實景 shows the same
// lines on the real map (Google's, or NLSC's past the month's cap).

import { MAPS, OPERATORS, loadSystem, lineRuns, interchanges, liveTrains, stationTitle } from './metro.mjs';
import { schematic, mountMap, trainFrom } from './metromap.mjs';
import DRAWINGS from './metro-drawings.mjs';
import { codesHtml, linesOf, loadBoards, boardHtml, firstLastHtml, exitsHtml } from './metro-ui.mjs';
import { createMap } from './map.mjs';
import { errorText, liveMs, keptLocal, keepLocal } from './api.mjs';
import { sheet, sheetHead, icon, inkOn } from './ui.mjs';
import { tile, tick } from './look.mjs';
import { e, meters } from './util.mjs';

import { W } from '#kit/lang.mjs';
const $ = id => document.getElementById(id);
const KEY = 'orbit-transit.metro';
const MODE_KEY = 'orbit-transit.metro.mode';
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
  panel.innerHTML = `<nav class="q-chips ot-chip-rail" id="m-maps" aria-label="${W('城市', 'City')}">${MAPS.map(m => `<button class="q-chip" type="button" data-map="${m.id}">${e(m.name)}</button>`).join('')}</nav>
    <div class="ot-metro-view" id="m-view">
      <div id="m-schem" class="mm-box" role="img" aria-label="${W('捷運路線圖', 'Metro map')}"></div>
      <div id="m-map" class="ot-map" hidden></div>
      <div class="mm-tools">
        <div class="mm-mode" role="group" aria-label="${W('地圖', 'Map')}"><button type="button" data-mode="schem">${W('路線圖', 'Lines')}</button><button type="button" data-mode="geo">${W('實景', 'Real')}</button></div>
        <button class="mm-fab" type="button" data-locate aria-label="${W('最近的車站', 'Nearest station')}">${icon('locate')}</button>
      </div>
      <div class="ot-metro-legend" id="m-legend"></div>
      <p class="ot-metro-msg" id="m-msg"></p>
    </div>`;
  panel.addEventListener('click', ev => {
    const b = ev.target.closest('[data-map]');
    if (b) return open(b.dataset.map);
    const m = ev.target.closest('[data-mode]');
    if (m) return setMode(m.dataset.mode);
    const l = ev.target.closest('#m-legend [data-line]');
    if (l) return focusLine(l.dataset.line === focused ? null : l.dataset.line);
    if (ev.target.closest('[data-locate]')) return locate();
  });
  addEventListener('resize', () => view?.resize());
}

export async function show() {
  paintMode();
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
      view?.view(n, 1.2);
      stationSheet(n.st);
    }
  }
}
export function hide() {
  clearTimeout(trainTimer);
}

function paintMode() {
  $('m-view').querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
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
  // (The city's chip in sight on a narrow phone: 高雄's past the edge at 320.)
  const rail = $('m-maps');
  const chip = rail.querySelector(`[data-map="${id}"]`).getBoundingClientRect();
  const box = rail.getBoundingClientRect();
  if (chip.right > box.right || chip.left < box.left) rail.scrollBy({ left: chip.right > box.right ? chip.right - box.right + 16 : chip.left - box.left - 16, behavior: 'smooth' });
  const m = MAPS.find(x => x.id === id);
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
  const kept = await keptLocal(`metro-map-v1/${id}`).catch(() => null);
  if (current !== id) return;
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  // (Worked out ahead for each city, scripts/metro-maps.mjs; a phone works out its own only when TDX's network has changed since.)
  schem = schematic(systems, { preset: [DRAWINGS[id], kept?.data] });
  if (schem.sig !== DRAWINGS[id]?.sig && schem.sig !== kept?.data?.sig) keepLocal(`metro-map-v1/${id}`, { sig: schem.sig, pos: schem.pos });
  $('m-msg').textContent = '';
  focused = null;
  view?.destroy();
  view = mountMap($('m-schem'), schem, { onTap: n => stationSheet(n.st) });
  // You at your station when you're near one; else the city's busiest interchange.
  const mine = hereNode();
  const live = schem.nodes.filter(n => n.lines.length);
  const hub = live.slice().sort((a, b) => b.lines.length - a.lines.length || b.st.length - a.st.length)[0];
  view.here(mine);
  if (mine) view.view(mine, 1, { now: true });
  else if (live.length < 30) view.fit(null, { now: true });
  else view.view(hub, 0.75, { now: true });
  legend();
  if (mode === 'geo') drawGeo();
  trains();
}

// The lines, one chip each: tap to bring one forward.
function legend() {
  const seen = new Set();
  $('m-legend').innerHTML = schem.lines
    .filter(l => !seen.has(l.name) && seen.add(l.name))
    .map(l => `<button type="button" data-line="${e(l.key)}" style="--c:${e(l.color)};--ink:${inkOn(l.color)}" aria-pressed="false"><i></i>${e(l.name)}</button>`)
    .join('');
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
  if (n) view?.view(n, Math.max(1, view.zoom()));
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

// ---- 實景: the lines on the real map --------------------------------------------------------------------

let geoGroups = [];
async function drawGeo() {
  if (!geo) {
    const cfg = ctx.cfg?.map || { provider: 'nlsc' };
    try {
      geo = await createMap($('m-map'), { provider: cfg.provider, key: cfg.key, center: { lat: 25.05, lon: 121.52 }, zoom: 12, onPick: it => it.data && stationSheet(it.data), onIdle: geoNames });
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
      return { id: `m:${s.key}`, lat, lon, cls: `mstop${big ? ' x' : ''}${z < 13 ? ' far' : ''}`, z: big ? 6 : 5, data: g, html: `<i style="--c:${e(colorOf(s))}"></i>${label ? `<span>${e(s.name)}</span>` : ''}` };
    })
  );
}

// ---- A station ------------------------------------------------------------------------------------------

async function stationSheet(list) {
  if (!list?.length) return;
  const name = list[0].name;
  const lines = await linesOf(list).catch(() => []);
  const color = lines[0]?.color || '#3b82f6';
  const ops = [...new Set(list.map(s => OPERATORS[s.op]))].join('・');
  const d = sheet(
    `${sheetHead(e(stationTitle(name)), e(ops), tile('metro', color))}
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
  };
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-exits]') && exits) {
      sheet(`${sheetHead(W('出口', 'Exits'), e(stationTitle(name)), tile('walk', '#8e8e93'))}${exits.html}`, 'mm-sheet');
    } else if (ev.target.closest('[data-route-here]')) {
      d.shut();
      ctx.openTrip(null, { name: stationTitle(name), lat: list[0].lat, lon: list[0].lon });
    }
  });
}
