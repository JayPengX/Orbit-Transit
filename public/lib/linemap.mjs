// The station picker's map (查時刻 → 出發/抵達車站): a region's 台鐵 lines
// drawn as a route map, top to bottom in the order the trains run, each
// branch line hanging off the station it leaves from, and the region's
// 高鐵 stations as one short line across the top. The big stations stand
// out; three or more small ones in a row fold into one row naming them
// (a tap opens it in place, nothing above it moves). The county is written
// beside the first station of each.
// (The owner, 2026-10-30: county pills jumped, and a county's stations in
// a grid gave no idea where one was.)

import { TRA_MAP } from './tra-map.mjs';
import { REGIONS } from './tra-regions.mjs';
import { cityShort } from './city.mjs';
import { stationLabel } from './ui.mjs';
import { e } from './util.mjs';

import { W, en } from '#kit/lang.mjs';

export const REGION_NAMES = { north: () => W('北部', 'North'), central: () => W('中部', 'Central'), south: () => W('南部', 'South'), east: () => W('東部', 'East') };

// Big enough to always show: 特等 to 二等 (TDX StationClass 0–2).
const big = s => /^[0-2]$/.test(s.cls);
const FOLD_MIN = 3;
// (English names run longer: two.)
const FOLD_NAMES = en ? 2 : 3;

// stations: Map key → station (rail.mjs's); open: the fold keys opened;
// mark: { current, other, keep: Set of keys always shown }.
export function lineMapHtml(region, stations, { open = new Set(), current = '', other = '', keep = new Set() } = {}) {
  const parts = (TRA_MAP[region] || []).map(p => ({ ...p, list: p.ids.map(id => stations.get(`tra:${id}`)).filter(Boolean) })).filter(p => p.list.length);
  const branches = new Map();
  for (const p of parts) if (p.branch && p.at) branches.set(p.at, [...(branches.get(p.at) || []), p]);
  const name = p => (en ? p.en : p.zh);
  let lastCity = '';

  const row = (s, cls) => {
    // (Not beside the station named as its county: 基隆 基隆.)
    const city = s.city !== lastCity && (lastCity = s.city) && cityShort(s.city) !== stationLabel(s) ? s.city : '';
    const tags = [big(s) ? 'big' : '', s.key === current ? 'on' : '', cls].filter(Boolean).join(' ');
    return `<button class="ot-lm-row ${tags}" type="button" data-st="${e(s.key)}"${s.key === other ? ' disabled' : ''}${s.key === current ? ' aria-current="true"' : ''}><i class="ot-lm-dot"></i><span class="ot-lm-name">${e(stationLabel(s))}</span>${city ? `<span class="ot-lm-city">${e(cityShort(city))}</span>` : ''}</button>${(branches.get(s.id) || []).map(b => line(b, true)).join('')}`;
  };
  const fold = run => {
    lastCity = run.at(-1).city;
    // (Four named at most, else three and the count of the rest: one line at 320.)
    const named = run.length <= FOLD_NAMES + 1 ? run.length : FOLD_NAMES;
    const rest = run.length - named;
    return `<button class="ot-lm-fold" type="button" data-fold="${e(run[0].key)}"><span class="ot-lm-names">${run
      .slice(0, named)
      .map(s => e(stationLabel(s)))
      .join(' · ')}</span>${rest > 0 ? `<span class="ot-lm-more">+${rest}</span>` : ''}</button>`;
  };
  // One line: its stations, the small ones in a row folded unless opened.
  const line = (p, sub) => {
    const shows = (s, i) => i === 0 || i === p.list.length - 1 || big(s) || branches.has(s.id) || keep.has(s.key) || s.key === current || s.key === other;
    const out = [];
    for (let i = 0; i < p.list.length; ) {
      if (shows(p.list[i], i)) {
        out.push(row(p.list[i], i === 0 && !sub ? 'first' : i === p.list.length - 1 ? 'last' : ''));
        i++;
        continue;
      }
      let j = i;
      while (j < p.list.length && !shows(p.list[j], j)) j++;
      const run = p.list.slice(i, j);
      out.push(run.length >= FOLD_MIN && !open.has(run[0].key) ? fold(run) : run.map(s => row(s, '')).join(''));
      i = j;
    }
    const from = p.at && !sub ? stations.get(`tra:${p.at}`) : null;
    const head = `<h4 class="ot-lm-h">${e(name(p))}${from ? `<span>${W(`${e(stationLabel(from))}起`, `from ${e(stationLabel(from))}`)}</span>` : ''}</h4>`;
    return sub ? `<div class="ot-lm-sub">${head}${out.join('')}</div>` : `<div class="ot-lm">${head}${out.join('')}</div>`;
  };
  return parts
    .filter(p => !(p.branch && p.at))
    .map(p => ((lastCity = ''), line(p, false)))
    .join('');
}

// The region's 高鐵 stations, north to south, as one line across.
export function hsrLineHtml(region, list, { current = '', other = '' } = {}) {
  const st = list.filter(s => s.sys === 'hsr' && REGIONS[region]?.includes(s.city)).sort((a, b) => a.id.localeCompare(b.id));
  if (!st.length) return '';
  return `<div class="ot-lm ot-lm-hsr"><h4 class="ot-lm-h">${W('高鐵', 'HSR')}</h4><div class="ot-hsr-line" style="--n:${st.length}">${st
    .map(s => `<button class="ot-hsr-st${s.key === current ? ' on' : ''}" type="button" data-st="${e(s.key)}"${s.key === other ? ' disabled' : ''}${s.key === current ? ' aria-current="true"' : ''}><i class="ot-lm-dot"></i><span>${e(en ? s.en || s.name : s.name)}</span></button>`)
    .join('')}</div></div>`;
}
