// 捷運路網圖 (in 我的): each city's metro on the real map (Google's, or
// Taiwan's NLSC map past the month's cap) instead of a drawing of our own:
// the lines in their colours along the stations, the stations with their
// names once zoomed in. Tap a station for its next trains: live where the
// operator sends them (臺北捷運 sends only the trains about to arrive, so its
// timetable shows beside), else the timetable.

import { MAPS, OPERATORS, loadSystem, lineRuns, interchanges, liveBoard, nextTrains, stationTitle } from './metro.mjs';
import { createMap } from './map.mjs';
import { errorText } from './api.mjs';
import { sheet, sheetHead, icon } from './ui.mjs';
import { metroBoardHtml } from './tab-map.mjs';
import { e, meters } from './util.mjs';

const $ = id => document.getElementById(id);
const KEY = 'orbit-transit.metro';
let ctx = null;
let map = null;
let current = null;
let systems = [];
let onClose = () => {};

export function init(c, opts = {}) {
  ctx = c;
  onClose = opts.onClose || onClose;
  const panel = $('panel-metro');
  panel.innerHTML = `<div class="ot-metro-top"><button class="q-icon-btn" type="button" data-m="close" aria-label="返回">${icon('back')}</button><b>捷運路網圖</b><nav class="q-chips ot-metro-chips" id="m-maps">${MAPS.map(m => `<button class="q-chip" type="button" data-map="${m.id}">${e(m.name)}</button>`).join('')}</nav></div>
    <div class="ot-metro-view"><div id="m-map" class="ot-map"></div><div class="ot-metro-legend" id="m-legend"></div><p class="ot-note ot-metro-msg" id="m-msg"></p></div>`;
  panel.addEventListener('click', ev => {
    const b = ev.target.closest('[data-map]');
    if (b) return open(b.dataset.map);
    if (ev.target.closest('[data-m="close"]')) onClose();
  });
}

export async function show() {
  if (!map) {
    const cfg = ctx.cfg?.map || { provider: 'nlsc' };
    try {
      map = await createMap($('m-map'), { provider: cfg.provider, key: cfg.key, center: { lat: 25.05, lon: 121.52 }, zoom: 12, onPick: it => it.data && stationSheet(it.data), onIdle: names });
      // Google's own transit lines would draw a second map under ours.
      map.showTransit(false);
    } catch (err) {
      $('m-msg').textContent = `地圖載入失敗：${err.message}`;
      return;
    }
  }
  map.resize();
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
  }
  if (ctx.metroStation) {
    const st = ctx.metroStation;
    ctx.metroStation = null;
    map.setView(st.lat, st.lon, 15);
    stationSheet(groupOf(st));
  }
}
export function hide() {}

async function open(id) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  $('m-maps').querySelectorAll('[data-map]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.map === id)));
  const m = MAPS.find(x => x.id === id);
  $('m-msg').textContent = '載入路網…';
  try {
    systems = (await Promise.all(m.systems.map(s => loadSystem(s).catch(() => null)))).filter(s => s?.stations.length);
    if (current !== id) return;
    if (!systems.length) throw Object.assign(new Error('empty'), { code: 'TDX_FAILED' });
  } catch (err) {
    $('m-msg').textContent = errorText(err);
    return;
  }
  $('m-msg').textContent = '';
  draw();
  const all = systems.flatMap(s => s.stations);
  // Around you when you're in this city, else the whole system.
  const h = ctx.here;
  const nearest = h ? all.map(s => [meters(h.lat, h.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0])[0] : null;
  if (nearest && nearest[0] < 3000) map.setView(nearest[1].lat, nearest[1].lon, 15);
  else map.fit(all, 30);
  $('m-legend').innerHTML = systems
    .flatMap(s => s.lines.filter(l => !l.branch))
    .filter((l, i, a) => a.findIndex(x => x.name === l.name) === i)
    .map(l => `<span><i style="background:${e(l.color)}"></i>${e(l.name)}</span>`)
    .join('');
}

let groups = [];
const groupOf = st => groups.find(g => g.some(x => x.key === st.key)) || [st];
function draw() {
  const byKey = new Map(systems.flatMap(s => s.stations).map(s => [s.key, s]));
  const lines = systems.flatMap(s => s.lines);
  // Each line along its stations (the operator's routes, else its station order, split where it jumps).
  map.lines(
    'metro',
    lines.flatMap(l =>
      (l.paths?.length ? l.paths.map(p => p.map(k => byKey.get(k)).filter(Boolean)) : lineRuns(l, byKey))
        .filter(r => r.length > 1)
        .map(r => ({ pts: r.map(s => [s.lat, s.lon]), color: l.color, width: 6, z: 3 }))
    )
  );
  groups = interchanges([...byKey.values()]);
  names();
}
// The stations: a dot each (a ring for an interchange); their names once zoomed in.
function names() {
  if (!map || !groups.length) return;
  const z = map.zoom();
  const lines = systems.flatMap(s => s.lines);
  const colorOf = st => lines.find(l => l.seq.includes(st.key))?.color || '#fff';
  map.layer('metro').set(
    groups.map(g => {
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

function stationSheet(list) {
  if (!list?.length) return;
  const name = list[0].name;
  const lines = systems.flatMap(s => s.lines).filter(l => list.some(st => l.seq.includes(st.key)));
  const d = sheet(`${sheetHead(e(stationTitle(name)), [...new Set(list.map(s => OPERATORS[s.op]))].map(e).join('・'))}
    <div class="ot-line-chips">${lines.filter((l, i, a) => a.findIndex(x => x.name === l.name) === i).map(l => `<span style="--c:${e(l.color)}">${e(l.name)}</span>`).join('')}</div>
    <div id="mb"><p class="ot-note">載入中…</p></div>
    <div class="ot-row ot-actions"><button class="q-btn" type="button" data-route-here="1">${icon('route')} 怎麼去</button></div>`);
  const load = async () => {
    const parts = await Promise.all(
      list.map(async st => {
        try {
          const live = { board: await liveBoard(st).catch(() => null), next: await nextTrains(st).catch(() => null), op: st.op };
          const names = [...new Set(lines.filter(l => l.seq.includes(st.key)).map(l => l.name))].join('・') || OPERATORS[st.op];
          return list.length > 1 ? `<h3 class="q-sheet-h">${e(names)}</h3>${metroBoardHtml(live)}` : metroBoardHtml(live);
        } catch (err) {
          return `<p class="ot-note bad">${e(errorText(err))}</p>`;
        }
      })
    );
    if (d.open) d.querySelector('#mb').innerHTML = parts.join('');
  };
  load();
  const t = setInterval(load, 20_000);
  d.onclosed = () => clearInterval(t);
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-route-here]')) {
      d.close();
      ctx.openTrip(null, { name: stationTitle(name), lat: list[0].lat, lon: list[0].lon });
    }
  });
}
