// 捷運: each city's metro as one big map (台北・新北, 桃園機捷, 台中, 高雄),
// drawn from TDX's stations and lines. Pinch or scroll to zoom, drag to
// move, tap a station for its next trains (live where the operator sends
// them, else the timetable), every 20 seconds while it's open.

import { MAPS, OPERATORS, loadSystem, mapSvg, liveBoard, nextTrains, stationTitle } from './metro.mjs';
import { errorText } from './api.mjs';
import { sheet, sheetHead, icon } from './ui.mjs';
import { metroBoardHtml } from './tab-map.mjs';
import { e, meters, clamp } from './util.mjs';

const $ = id => document.getElementById(id);
const KEY = 'orbit-transit.metro';
let ctx = null;
let current = null;
let systems = [];
let view = { x: 0, y: 0, k: 1 };

export function init(c) {
  ctx = c;
  const panel = $('panel-metro');
  panel.innerHTML = `<nav class="q-chips ot-metro-chips" id="m-maps">${MAPS.map(m => `<button class="q-chip" type="button" data-map="${m.id}">${e(m.name)}</button>`).join('')}</nav>
    <div class="ot-metro-view" id="m-view"><div class="ot-metro-stage" id="m-stage"></div>
      <div class="ot-metro-zoom"><button class="ot-fab" type="button" data-z="1" aria-label="放大">${icon('plus')}</button><button class="ot-fab" type="button" data-z="-1" aria-label="縮小"><svg class="ot-i" viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button></div>
      <div class="ot-metro-legend" id="m-legend"></div></div>`;
  $('m-maps').addEventListener('click', ev => {
    const b = ev.target.closest('[data-map]');
    if (b) open(b.dataset.map);
  });
  panel.querySelector('.ot-metro-zoom').addEventListener('click', ev => {
    const z = ev.target.closest('[data-z]');
    if (z) zoomAt(Number(z.dataset.z) > 0 ? 1.6 : 1 / 1.6);
  });
  gestures($('m-view'));
}

export async function show() {
  const want = ctx.metroStation ? mapFor(ctx.metroStation.op) : null;
  if (want && want !== current) await open(want);
  else if (!current) {
    // The map of the city you're in, else the last one seen, else 台北.
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    const byCity = { Taipei: 'taipei', NewTaipei: 'taipei', Keelung: 'taipei', Taoyuan: 'taoyuan', Taichung: 'taichung', Kaohsiung: 'kaohsiung' };
    await open(byCity[ctx.city] || saved || 'taipei');
  }
  if (ctx.metroStation) {
    const st = ctx.metroStation;
    ctx.metroStation = null;
    stationSheet([st]);
  }
}

const mapFor = op => MAPS.find(m => m.systems.includes(op))?.id || null;

async function open(id) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  $('m-maps').querySelectorAll('[data-map]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.map === id)));
  const stage = $('m-stage');
  stage.innerHTML = '<p class="ot-note center">載入路網圖…</p>';
  const m = MAPS.find(x => x.id === id);
  try {
    systems = (await Promise.all(m.systems.map(s => loadSystem(s).catch(() => null)))).filter(s => s?.stations.length);
    if (current !== id) return;
    if (!systems.length) throw Object.assign(new Error('empty'), { code: 'TDX_FAILED' });
  } catch (err) {
    stage.innerHTML = `<p class="ot-note bad center">${e(errorText(err))}</p>`;
    return;
  }
  const { svg } = mapSvg(systems, { W: 1000, H: 1000 });
  stage.innerHTML = svg;
  $('m-legend').innerHTML = systems
    .flatMap(s => s.lines.filter(l => !l.branch))
    .filter((l, i, all) => all.findIndex(x => x.name === l.name) === i)
    .map(l => `<span><i style="background:${e(l.color)}"></i>${e(l.name)}</span>`)
    .join('');
  stage.querySelector('svg').addEventListener('click', ev => {
    const g = ev.target.closest('[data-st]');
    if (!g || moved) return;
    const keys = g.dataset.st.split(',');
    const all = systems.flatMap(s => s.stations);
    stationSheet(keys.map(k => all.find(s => s.key === k)).filter(Boolean));
  });
  // Opened around you when you're in this city, else the whole map.
  view = { x: 0, y: 0, k: 1 };
  const h = ctx.here;
  const all = systems.flatMap(s => s.stations);
  const nearest = h ? all.map(s => [meters(h.lat, h.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0])[0] : null;
  requestAnimationFrame(() => {
    apply();
    if (nearest && nearest[0] < 3000) focusStation(nearest[1], 2.6);
  });
}

// ---- Pan and zoom ---------------------------------------------------------------------------------

function apply() {
  const svg = $('m-stage').querySelector('svg');
  const g = svg?.querySelector('.mt-zoom');
  if (!g) return;
  g.setAttribute('transform', `translate(${view.x.toFixed(1)} ${view.y.toFixed(1)}) scale(${view.k.toFixed(3)})`);
  // The SVG's units per screen pixel: dots and names are drawn in screen pixels.
  const r = svg.getBoundingClientRect();
  const u = 1000 / Math.max(1, Math.min(r.width, r.height));
  svg.style.setProperty('--inv', String(u / view.k));
  svg.style.setProperty('--k', String(view.k));
  // Interchanges' names from the start, every name once there's room.
  svg.classList.toggle('names', view.k >= 2.2);
}
// Screen point → the SVG's own units.
function toSvg(cx, cy) {
  const svg = $('m-stage').querySelector('svg');
  const r = svg.getBoundingClientRect();
  const s = 1000 / Math.min(r.width, r.height);
  const ox = (r.width - Math.min(r.width, r.height)) / 2;
  const oy = (r.height - Math.min(r.width, r.height)) / 2;
  return [(cx - r.left - ox) * s, (cy - r.top - oy) * s, s];
}
function zoomAt(f, cx, cy) {
  const svg = $('m-stage').querySelector('svg');
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const [px, py] = toSvg(cx ?? r.left + r.width / 2, cy ?? r.top + r.height / 2);
  const k = clamp(view.k * f, 0.8, 9);
  const real = k / view.k;
  view.x = px - (px - view.x) * real;
  view.y = py - (py - view.y) * real;
  view.k = k;
  apply();
}
function focusStation(st, k = 3) {
  const svg = $('m-stage').querySelector('svg');
  const g = [...(svg?.querySelectorAll('[data-st]') || [])].find(x => x.dataset.st.split(',').includes(st.key));
  if (!g) return;
  const x = parseFloat(g.style.getPropertyValue('--x'));
  const y = parseFloat(g.style.getPropertyValue('--y'));
  view = { k, x: 500 - x * k, y: 500 - y * k };
  apply();
}

let moved = false;
function gestures(el) {
  const pts = new Map();
  let last = null;
  el.addEventListener('pointerdown', ev => {
    if (ev.target.closest('.ot-metro-zoom')) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    el.setPointerCapture?.(ev.pointerId);
    moved = false;
    last = null;
  });
  el.addEventListener('pointermove', ev => {
    if (!pts.has(ev.pointerId)) return;
    const prev = pts.get(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const [, , s] = toSvg(0, 0);
    if (pts.size === 1) {
      const dx = (ev.clientX - prev.x) * s;
      const dy = (ev.clientY - prev.y) * s;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) {
        if (Math.hypot(dx, dy) > 3) moved = true;
        view.x += dx;
        view.y += dy;
        apply();
      }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (last) {
        zoomAt(dist / last.dist, mid.x, mid.y);
        view.x += (mid.x - last.mid.x) * s;
        view.y += (mid.y - last.mid.y) * s;
        apply();
      }
      last = { dist, mid };
      moved = true;
    }
  });
  const up = ev => {
    pts.delete(ev.pointerId);
    if (pts.size < 2) last = null;
    // A tap that didn't move still reaches the station (click fires after this).
    setTimeout(() => (moved = false), 50);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', ev => {
    ev.preventDefault();
    zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY);
  }, { passive: false });
  let tapAt = 0;
  el.addEventListener('dblclick', ev => zoomAt(1.8, ev.clientX, ev.clientY));
  el.addEventListener('touchend', ev => {
    if (ev.touches.length) return;
    const now = Date.now();
    if (now - tapAt < 280 && !moved) zoomAt(1.8, ev.changedTouches[0].clientX, ev.changedTouches[0].clientY);
    tapAt = now;
  });
}

// ---- A station ------------------------------------------------------------------------------------------

function stationSheet(list) {
  if (!list.length) return;
  const name = list[0].name;
  const lines = systems.flatMap(s => s.lines).filter(l => list.some(st => l.seq.includes(st.key)));
  const d = sheet(`${sheetHead(e(stationTitle(name)), [...new Set(list.map(s => OPERATORS[s.op]))].map(e).join('・'))}
    <div class="ot-line-chips">${lines.filter((l, i, a) => a.findIndex(x => x.name === l.name) === i).map(l => `<span style="--c:${e(l.color)}">${e(l.name)}</span>`).join('')}</div>
    <div id="mb"><p class="ot-note">載入中…</p></div>
    <div class="ot-row ot-actions"><button class="q-btn" type="button" data-on-map="1">${icon('pin')} 在地圖上看</button></div>`);
  const load = async () => {
    const parts = await Promise.all(
      list.map(async st => {
        try {
          const live = { board: await liveBoard(st).catch(() => null), next: await nextTrains(st).catch(() => null) };
          // An interchange: each line's board under its name.
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
    if (ev.target.closest('[data-on-map]')) {
      d.close();
      ctx.mapFocus = list[0];
      ctx.goTab('map');
    }
  });
}
