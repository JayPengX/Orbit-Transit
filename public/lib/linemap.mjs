// The station picker's map (查時刻 → 出發/抵達車站): a county's 台鐵 lines
// drawn as a route map, top to bottom in the order the trains run, each
// branch line hanging off the station it leaves from, its 高鐵 stations
// above. Where a line leaves the county, a last row names the next station
// over the edge; a tap there moves the map to that county.
// (The owner, 2026-10-30: county pills jumped and a county's stations in a
// grid gave no idea where one was; then 北中南東 was too broad, and folded
// stations never folded back: a county's map shows every station.)

import { TRA_MAP } from './tra-map.mjs';
import { CITIES, cityShort } from './city.mjs';
import { stationLabel, icon } from './ui.mjs';
import { e } from './util.mjs';

import { W, en } from '#kit/lang.mjs';

// Big: 特等 to 二等 (TDX StationClass 0–2).
// (On the 高鐵 card, 高鐵 isn't said again.)
const label = s => (s.sys === 'hsr' ? (en && s.en) || s.name : stationLabel(s));
const big = s => s.sys === 'hsr' || /^[0-2]$/.test(s.cls);

// The counties with a station, north to south.
export const mapCities = list => CITIES.map(([k]) => k).filter(k => TRA_MAP[k] || list.some(s => s.sys === 'hsr' && s.city === k));

// city: TDX city code; stations: Map key → station (rail.mjs's), 台鐵 and 高鐵;
// current: the station picked now; other: the other end (not pickable).
export function lineMapHtml(city, stations, { current = '', other = '' } = {}) {
  const tra = id => stations.get(`tra:${id}`);
  const parts = (TRA_MAP[city] || []).map(p => ({ ...p, list: p.ids.map(tra).filter(Boolean) })).filter(p => p.list.length);
  const branches = new Map();
  for (const p of parts) if (p.branch && p.at) branches.set(p.at, [...(branches.get(p.at) || []), p]);
  const name = p => (en ? p.en : p.zh);

  const row = (s, cls) => {
    const tags = [big(s) ? 'big' : '', s.key === current ? 'on' : '', cls].filter(Boolean).join(' ');
    return `<button class="ot-lm-row ${tags}" type="button" data-st="${e(s.key)}"${s.key === other ? ' disabled' : ''}${s.key === current ? ' aria-current="true"' : ''}><i class="ot-lm-dot"></i><span class="ot-lm-name">${e(label(s))}</span></button>${s.sys === 'tra' ? (branches.get(s.id) || []).map(b => line(b, true)).join('') : ''}`;
  };
  // The station just over the county's edge: the line going on, dotted.
  const edge = (id, cls) => {
    const s = id && tra(id);
    return s ? `<button class="ot-lm-edge ${cls}" type="button" data-city="${e(s.city)}"><span class="ot-lm-name">${e(stationLabel(s))}</span><span class="ot-lm-city">${e(cityShort(s.city))}${icon('chevron')}</span></button>` : '';
  };
  const line = (p, sub) => {
    const n = p.list.length;
    const rows = p.list.map((s, i) => row(s, [i === 0 && !sub && !p.prev ? 'first' : '', i === n - 1 && !p.next ? 'last' : ''].filter(Boolean).join(' '))).join('');
    const from = p.at && !sub ? tra(p.at) : null;
    const head = `<h4 class="ot-lm-h">${e(name(p))}${from ? `<span>${W(`${e(stationLabel(from))}起`, `from ${e(stationLabel(from))}`)}</span>` : ''}</h4>`;
    return `<div class="${sub ? 'ot-lm-sub' : 'ot-lm'}">${head}${sub ? '' : edge(p.prev, 'prev')}${rows}${edge(p.next, 'next')}</div>`;
  };
  const hsr = [...stations.values()].filter(s => s.sys === 'hsr' && s.city === city).sort((a, b) => a.id.localeCompare(b.id));
  const hsrHtml = hsr.length ? `<div class="ot-lm ot-lm-hsr"><h4 class="ot-lm-h">${W('高鐵', 'HSR')}</h4>${hsr.map((s, i) => row(s, [i === 0 ? 'first' : '', i === hsr.length - 1 ? 'last' : ''].filter(Boolean).join(' '))).join('')}</div>` : '';
  return hsrHtml + parts.filter(p => !(p.branch && p.at)).map(p => line(p, false)).join('');
}
