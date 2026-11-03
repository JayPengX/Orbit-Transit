// The station picker's map (查時刻 → 出發/抵達車站): an area's 台鐵 lines,
// each on its own card, drawn as a route map that winds across the card's
// width: left to right, round the end, right to left, in the order the
// trains run. A branch is a card of its own right after the line it leaves,
// starting at the station it leaves from. A 高鐵 station beside a 台鐵 one
// (六家 and 高鐵新竹, the shared halls of 台北 and 板橋) is one stop on the
// 台鐵 line with its 高鐵 a tap beside it; the 高鐵 card holds only the rest.
// Where a line leaves the area, its end names the next station over the
// edge; a tap there moves the map to that area.
// (The owner, 2026-10-30: county pills jumped and a county's stations in a
// grid gave no idea where one was; then 北中南東 was too broad, and folded
// stations never folded back: a county's map shows every station.
// 2026-11-03: dots too small to look tappable, the right half of the card
// empty, 新竹市 and 新竹縣 one place, a 高鐵 station sharing a 台鐵 one shown once.)

import { TRA_MAP } from './tra-map.mjs';
import { CITIES, cityShort } from './city.mjs';
import { stationLabel, icon } from './ui.mjs';
import { e, meters } from './util.mjs';

import { W, en } from '#kit/lang.mjs';

// A 市 inside its 縣 is one area with it: every 新竹市 station sits between
// 新竹縣 ones on the same lines (嘉義市 inside 嘉義縣 the same). Keyed by the 縣.
const MERGED = { Hsinchu: 'HsinchuCounty', Chiayi: 'ChiayiCounty' };
export const areaOf = code => MERGED[code] || code;
export const areaName = code => (code === 'HsinchuCounty' ? W('新竹', 'Hsinchu') : code === 'ChiayiCounty' ? W('嘉義', 'Chiayi') : cityShort(code));
const members = area => CITIES.map(([k]) => k).filter(k => areaOf(k) === area);

// Big: 特等 to 二等 (TDX StationClass 0–2).
const big = s => s.sys === 'hsr' || /^[0-2]$/.test(s.cls);
const same = (a, b) => String(a).replace(/台/g, '臺') === String(b).replace(/台/g, '臺');
const label = s => (s.sys === 'hsr' ? (en && s.en) || s.name : stationLabel(s));

// The areas with a station, north to south.
export const mapCities = list => [...new Set(CITIES.map(([k]) => areaOf(k)))].filter(a => members(a).some(k => TRA_MAP[k] || list.some(s => s.sys === 'hsr' && s.city === k)));

// An area's stretches, the ones split at a member's border joined again
// (西部幹線 竹北 → 北新竹 over the 縣/市 line: one line).
export function areaParts(area) {
  const out = members(area).flatMap(k => (TRA_MAP[k] || []).map(p => ({ ...p, ids: [...p.ids] })));
  for (let joined = true; joined; ) {
    joined = false;
    for (const a of out) {
      const b = out.find(x => x !== a && x.line === a.line && a.next && x.ids[0] === a.next);
      if (!b) continue;
      a.ids.push(...b.ids);
      a.next = b.next;
      out.splice(out.indexOf(b), 1);
      joined = true;
      break;
    }
  }
  return out;
}

// How many stations a row holds at this width (px inside the card).
export const mapCols = width => Math.max(3, Math.min(8, Math.floor(width / (en ? 100 : 78)) || 3));

// A line's row: as many as fit, a shorter one where that leaves the last
// row less bare (8 on a computer's 7 a row was 7 + 1: 4 + 4).
export function rowLength(n, most) {
  if (n <= most) return Math.max(Math.min(3, most), n);
  const low = Math.max(3, Math.ceil(most * 0.5));
  for (let c = most; c >= low; c--) if (n % c === 0) return c;
  for (let c = most; c >= low; c--) if (n % c >= Math.ceil(c / 2)) return c;
  return most;
}

// area: the area's key (mapCities); stations: Map key → station (rail.mjs's),
// 台鐵 and 高鐵; current: the station picked now; other: the other end (not
// pickable); cols: stations a row.
export function lineMapHtml(area, stations, { current = '', other = '', cols: most = 4 } = {}) {
  const tra = id => stations.get(`tra:${id}`);
  const inArea = s => s && areaOf(s.city) === area;
  const parts = areaParts(area)
    .map(p => ({ ...p, list: p.ids.map(tra).filter(Boolean) }))
    .filter(p => p.list.length);
  const traHere = parts.flatMap(p => p.list);
  // Each 高鐵 station beside a 台鐵 one on this map (within 900 m, as the router walks it).
  const twin = new Map();
  const hsrAll = [...stations.values()].filter(s => s.sys === 'hsr' && inArea(s)).sort((a, b) => a.id.localeCompare(b.id));
  for (const h of hsrAll) {
    let best = null;
    let bd = 900;
    for (const t of traHere) {
      if (!Number.isFinite(t.lat) || !Number.isFinite(h.lat)) continue;
      const d = meters(h.lat, h.lon, t.lat, t.lon);
      if (d < bd) [best, bd] = [t, d];
    }
    if (best && !twin.has(best.key)) twin.set(best.key, h);
  }
  const twinned = new Set([...twin.values()].map(h => h.key));
  const name = p => (en ? p.en : p.zh);

  const edge = (id, cls) => {
    const s = id && tra(id);
    return s ? `<button class="ot-lm-edge ${cls}" type="button" data-city="${e(areaOf(s.city))}">${cls === 'prev' ? icon('chevron') : ''}<span class="ot-lm-city">${e(areaName(areaOf(s.city)))}</span><span class="ot-lm-name">${e(stationLabel(s))}</span>${cls === 'next' ? icon('chevron') : ''}</button>` : '';
  };
  // One station: its stop on the line, its name, and its 高鐵 twin's tap.
  const stop = (s, i, n, p, via, tallRows, cols) => {
    const r = Math.floor(i / cols);
    const k = i % cols;
    const rtl = r % 2 === 1;
    const c = rtl ? cols - 1 - k : k;
    const endOfRow = k === cols - 1 && i < n - 1;
    const startOfRow = k === 0 && i > 0;
    // The line in (from the station before) and out (to the next); at a row's end it turns down.
    const lineIn = i > 0 && !startOfRow ? 'in' : i === 0 && p.prev && !via ? 'in dash' : '';
    const lineOut = i < n - 1 && !endOfRow ? 'out' : i === n - 1 && p.next ? 'out dash' : '';
    const h = twin.get(s.key);
    const tags = ['ot-sn-st', rtl ? 'rtl' : '', big(s) || h ? 'big' : '', s.key === current ? 'on' : '', via ? 'via' : '', h ? 'twin' : ''].filter(Boolean).join(' ');
    const tap = (x, cls, inner) => `<button class="${cls}" type="button" data-st="${e(x.key)}"${x.key === other ? ' disabled' : ''}${x.key === current ? ' aria-current="true"' : ''}${inner ? '' : ` aria-label="${e(label(x))}"`}>${inner}</button>`;
    return `<div class="${tags}" style="grid-area:${r + 1}/${c + 1}${tallRows[r] ? ';--sn-h:var(--sn-tall)' : ''}">${lineIn ? `<i class="ot-sn-ln ${lineIn}"></i>` : ''}${lineOut ? `<i class="ot-sn-ln ${lineOut}"></i>` : ''}${endOfRow ? `<i class="ot-sn-turn${rtl ? ' left' : ''}"></i>` : ''}${tap(s, 'ot-sn-tap', `<i class="ot-lm-dot"></i><span class="ot-lm-name q-fit">${e(label(s))}</span>`)}${h ? tap(h, `ot-sn-hsr${h.key === current ? ' on' : ''}`, e(same(h.name, s.name) || en ? W('高鐵', 'HSR') : `${W('高鐵', 'HSR ')}${(en && h.en) || h.name}`)) : ''}</div>`;
  };
  const card = (p, cls = '') => {
    const from = p.at ? tra(p.at) : null;
    const list = from ? [from, ...p.list] : p.list;
    const n = list.length;
    const cols = rowLength(n, most);
    // (A row with a 高鐵 tap in it is that much taller; the others stay as they are.)
    const tallRows = Array.from({ length: Math.ceil(n / cols) }, (_, r) => list.slice(r * cols, (r + 1) * cols).some(s => twin.has(s.key)));
    const rows = tallRows.map(t => (t ? 'var(--sn-tall)' : 'var(--sn-h)')).join(' ');
    const head = `<h4 class="ot-lm-h">${e(name(p))}${from ? `<span>${W(`${e(stationLabel(from))}起`, `from ${e(stationLabel(from))}`)}</span>` : ''}</h4>`;
    const ends = p.prev && !from ? edge(p.prev, 'prev') : '';
    const next = p.next ? edge(p.next, 'next') : '';
    return `<div class="ot-lm${cls}">${head}<div class="ot-sn" style="--cols:${cols};grid-template-rows:${rows}">${list.map((s, i) => stop(s, i, n, p, from && i === 0, tallRows, cols)).join('')}</div>${ends || next ? `<div class="ot-lm-ends">${ends}${next}</div>` : ''}</div>`;
  };
  // Each line, then the lines leaving from it (a branch off a branch after that).
  const done = new Set();
  const order = [];
  const take = p => {
    if (done.has(p)) return;
    done.add(p);
    order.push(p);
    for (const b of parts) if (b.at && p.ids.includes(b.at)) take(b);
  };
  for (const p of parts) if (!p.at || !parts.some(q => q !== p && q.ids.includes(p.at))) take(p);
  for (const p of parts) take(p);
  const hsr = hsrAll.filter(h => !twinned.has(h.key));
  const hsrHtml = hsr.length ? card({ zh: '高鐵', en: 'HSR', list: hsr }, ' ot-lm-hsr') : '';
  return hsrHtml + order.map(p => card(p)).join('');
}
