// Shared UI: sheets, the transport icons, a plan's legs as chips.

import { e, minsText, hm, rides } from './util.mjs';
import * as kitUI from '#kit/ui.mjs';

import { W, en } from './lang.mjs';

// A railway station's name as shown: 高鐵 before an HSR station's.
export const stationLabel = s => (!s ? '' : s.sys === 'hsr' ? W(`高鐵${s.name}`, `HSR ${s.name}`) : s.name);
// A modal sheet (the kit's look): closed by its ✕, a tap on the page
// behind or Escape, sliding down as every app's sheets do; `d.shut()`
// closes it the same way and `d.onclosed` runs once after. The kit's
// bindSheet does the closing where the kit has it (an older kit: as before).
export function sheet(html, cls = '') {
  const box = document.createElement('template');
  box.innerHTML = html;
  const first = box.content.firstElementChild;
  const simple = first?.classList.contains('q-sheet-head') && !first.querySelector('.ot-sheet-sub') && first.children.length === 2 ? first.querySelector('h2') : null;
  const title = simple && !simple.children.length ? simple.textContent : '';
  if (title) first.remove();
  // The kit's sheet: ✕, Esc, a tap outside and a drag down close it. A plain title becomes its head; a head with a tile or a sub-line stays as written.
  const k = kitUI.sheet({ title, body: [...box.content.childNodes], cls: `ot-sheet ${cls}`, closeLabel: W('關閉', 'Close'), onClose: () => d.onclosed?.() });
  const d = k.el;
  if (!title) k.head.remove();
  d.shut = () => k.close();
  d.addEventListener('click', ev => ev.target.closest('[data-act="close"]') && d.shut());
  return d;
}
// A sheet's head: its title (html), a small line under it, a colour tile before it (`lead`, html).
// Just a title: centred between the ✕ and a spacer, as the kit's sheets (iOS's).
const closeBtn = () => `<button class="q-close" type="button" data-act="close" data-q-close aria-label="${W('關閉', 'Close')}">✕</button>`;
export const sheetHead = (title, sub = '', lead = '') =>
  !lead && !sub ? `<div class="q-sheet-head"><span></span><h2>${title}</h2>${closeBtn()}</div>` : `<div class="q-sheet-head${lead ? ' ot-sheet-tile' : ''}">${lead}<div><h2>${title}</h2>${sub ? `<p class="ot-sheet-sub">${sub}</p>` : ''}</div>${closeBtn()}</div>`;

// 24×24 stroked icons, one per way of moving.
const I = {
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M10.5 21l2-6.5 3 3V21M7 12.5l2.5-4.5 4 1 2.5 3.5M12.5 9l-1.5 5.5"/>',
  // Where a YouBike goes back: a parking sign's P, centred in its square.
  dock: '<rect x="3" y="3" width="18" height="18" rx="4.5"/><path d="M9 16.5v-9h3a2.75 2.75 0 0 1 0 5.5H9"/>',
  bike: '<circle cx="6" cy="16.5" r="3.5"/><circle cx="18" cy="16.5" r="3.5"/><path d="M6 16.5l4-8h5l3 8M10 8.5L12.5 16.5h-6.5M14 5.5h2.5"/>',
  bus: '<rect x="4.5" y="3.5" width="15" height="15" rx="3"/><path d="M4.5 11h15M8 18.5V21M16 18.5V21"/><circle cx="8" cy="15" r=".6"/><circle cx="16" cy="15" r=".6"/>',
  metro: '<rect x="5.5" y="3" width="13" height="15" rx="4"/><path d="M5.5 11.5h13M9 21l1.5-3M15 21l-1.5-3"/><circle cx="9" cy="14.8" r=".6"/><circle cx="15" cy="14.8" r=".6"/>',
  lightrail: '<rect x="5.5" y="6" width="13" height="12" rx="3"/><path d="M9 3h6M12 3v3M5.5 12h13M8.5 21l1.5-3M15.5 21L14 18"/>',
  tra: '<rect x="6" y="3" width="12" height="15" rx="3"/><path d="M6 10.5h12M12 3v7.5M8.5 21l1.5-3M15.5 21L14 18"/><circle cx="9" cy="14.5" r=".6"/><circle cx="15" cy="14.5" r=".6"/>',
  hsr: '<path d="M3.5 15.5c2-6 6.5-9.5 13-9.5h3.5v9.5z"/><path d="M3.5 15.5h16.5M8 20.5h9M12 6.3v9.2"/>',
  ferry: '<path d="M3 15.5l2.2 4h13.6l2.2-4zM6 15.5V10h12v5.5M9.5 10V6.5h5V10"/><path d="M2.5 21.5c2 0 2-.8 4-.8s2 .8 4 .8 2-.8 4-.8 2 .8 4 .8"/>',
  gondola: '<path d="M3 4l18 4M12 6v4"/><rect x="6.5" y="10" width="11" height="9" rx="2"/><path d="M6.5 14h11"/>',
  rail: '<rect x="6" y="3" width="12" height="15" rx="3"/><path d="M6 10.5h12M8.5 21l1.5-3M15.5 21L14 18"/>',
  car: '<path d="M4 16.5V12l2-5h12l2 5v4.5zM4 12h16"/><circle cx="7.5" cy="16.5" r="1.6"/><circle cx="16.5" cy="16.5" r="1.6"/>',
  plane: '<path d="M10.5 20.5l1.5-1 1.5 1V16l7-3v-2l-7 1.5V5a1.5 1.5 0 0 0-3 0v7.5L3.5 11v2l7 3z"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  locate: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  layers: '<path d="M12 3.5l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.5l9 4.8 9-4.8M3 16.7l9 4.8 9-4.8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
  swap: '<path d="M7 4v15M3.5 7.5L7 4l3.5 3.5M17 20V5M13.5 16.5L17 20l3.5-3.5"/>',
  route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h6.5a3.5 3.5 0 0 1 0 7H9a3.5 3.5 0 0 0 0 7h6.5"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  home: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5.5h4V20"/>',
  work: '<rect x="3.5" y="7.5" width="17" height="12" rx="3"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 13h17"/>',
  school: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.8V16c0 1.4 2.5 2.7 5.5 2.7s5.5-1.3 5.5-2.7v-4.2M21.5 9.5V15"/>',
  bolt: '<path d="M13 2.5L5.5 13.5H11l-1 8 7.5-11H12z"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>',
  // Saved places (the kit's own glyphs, for an older kit's placeTile).
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  work: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 13h17M10.5 13v1.5h3V13"/>',
  school: '<path d="m12 4.5 9 4.5-9 4.5L3 9zM7 11.5v4.2c0 1.2 2.2 2.3 5 2.3s5-1.1 5-2.3v-4.2M21 9v5"/>',
  live: '<circle cx="12" cy="12" r="2.3"/><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8"/>'
};
export const icon = (name, cls = '') => `<svg class="ot-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || I.rail}</svg>`;

export const MODE_NAME = en
  ? { walk: 'Walk', bike: 'YouBike', bus: 'Bus', metro: 'Metro', lightrail: 'Light rail', tra: 'TRA', hsr: 'HSR', ferry: 'Ferry', gondola: 'Gondola', car: 'Taxi', plane: 'Flight', rail: 'Rail' }
  : { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', lightrail: '輕軌', tra: '台鐵', hsr: '高鐵', ferry: '渡輪', gondola: '纜車', car: '計程車', plane: '飛機', rail: '鐵路' };
// A plan's tags (kept in Chinese: the code compares them) as shown.
const TAG_EN = { 推薦: 'Best', 最快抵達: 'Fastest', 最少轉乘: 'Fewest changes', 最少步行: 'Least walking', 電輔車: 'E-bike', 即時: 'Live', 最早抵達: 'Earliest', 車程最短: 'Shortest', 直達: 'Direct', '全程 YouBike': 'All YouBike', 騎車: 'Ride', 步行: 'Walk' };
export const tagText = t => (en ? TAG_EN[t] || t : t);
// TRA's train kinds in English (their own names, as on the board).
const TRAIN_EN = [[/區間快/, 'Fast Local'], [/區間/, 'Local'], [/自強/, 'Tze‑Chiang'], [/莒光/, 'Chu‑Kuang'], [/復興/, 'Fu‑Hsing'], [/普悠瑪/, 'Puyuma'], [/太魯閣/, 'Taroko'], [/新自強|EMU3000/, 'EMU3000'], [/觀光|鳴日/, 'Tourist'], [/普快/, 'Ordinary']];
export const trainKind = s => {
  const t = String(s || '');
  const hit = en && TRAIN_EN.find(([re]) => re.test(t));
  return hit ? t.replace(new RegExp(`(${hit[0].source})[號車]?`), hit[1]).replace(/[（(][^）)]*[）)]/g, '').trim() : t;
};
// A train by its kind and number, as a row shows it: 「區間 1804」「Local 1804」「高鐵 0612」「HSR 0612」.
// One piece on a narrow row: never broken at its hyphen (Tze‑Chiang, a
// non-breaking one) nor between kind and number (a no-break space).
export const trainName = t => (t.sys === 'hsr' ? W(`高鐵 ${t.no}`, `HSR ${t.no}`) : `${trainKind(t.type)} ${t.no}`);
const MODE_COLOR = { walk: '#8a92a3', bike: '#f5b301', bus: '#22c55e', metro: '#3b82f6', lightrail: '#14b8a6', tra: '#0ea5e9', hsr: '#f97316', ferry: '#06b6d4', gondola: '#84cc16', car: '#eab308', plane: '#a78bfa', rail: '#0ea5e9' };
export const legColor = l => (l.color && /^#?[0-9a-f]{6}$/i.test(l.color.replace('#', '')) ? (l.color.startsWith('#') ? l.color : `#${l.color}`) : MODE_COLOR[l.mode] || '#94a3b8');

// What a leg is called on its chip: 「區間車」「板南線」「182」「YouBike」.
export function legLabel(l) {
  if (l.mode === 'walk') return minsText(l.dur);
  if (l.mode === 'bike') return l.ebike ? W('電輔車', 'E-bike') : 'YouBike';
  if (l.mode === 'bus') return l.short || l.name || MODE_NAME.bus;
  if (l.mode === 'hsr') return MODE_NAME.hsr;
  // A planner's line (新竹-六家) once the train is known: its kind and number, as on its sign.
  if (l.mode === 'tra' && l.train?.type && l.train?.no && /-/.test(l.short || l.name || '')) return `${trainKind(l.train.type)} ${l.train.no}`;
  return l.short || l.name || MODE_NAME[l.mode];
}
// A plan's legs as a row of chips (the short walks left out).
// A route's departures as times to pick (its bus or train's own time; the
// train's kind too when they differ, 區間 or 自強). `plans`: the list, `idx`:
// which of it, `on`: the one shown; each carries data-* from `attrs(i)`.
export function depChips(plans, idx, on, attrs) {
  if (idx.length < 2) return '';
  // The ride the times differ by (a bus to the station, then a choice of trains: the trains').
  const k = Math.max(0, rides(plans[idx[0]]).findIndex((l, j) => idx.some(i => rides(plans[i])[j]?.dep !== l.dep)));
  const ride = p => rides(p)[k] || rides(p)[0];
  const kind = p => (ride(p)?.train ? trainKind(String(ride(p).name || '').replace(/[（(].*$/, '').replace(/號.*$/, '').replace(/車$/, '')) : '');
  const mixed = new Set(idx.map(i => kind(plans[i]))).size > 1;
  // Some straight through, some changing trains (竹東 → 新竹, or via 竹中): which is which.
  const via = p => (rides(p).length > 1 ? W(`${String(rides(p)[0].to?.name || '').replace(/(火車站|車站|站)$/, '')}轉`, `via ${String(rides(p)[0].to?.name || '').replace(/(火車站|車站|站)$/, '')}`) : W('直達', 'direct'));
  const changing = new Set(idx.map(i => rides(plans[i]).length)).size > 1;
  const tag = p => [mixed ? kind(p) : '', changing ? via(p) : ''].filter(Boolean).join('・');
  // One chip for a time shown twice (two ways boarding the same bus): the picked one's, else the first.
  const seen = new Map();
  for (const i of idx) {
    const key = `${hm(ride(plans[i])?.dep ?? plans[i].dep)}|${tag(plans[i])}`;
    if (!seen.has(key) || i === on) seen.set(key, i);
  }
  idx = idx.filter(i => [...seen.values()].includes(i));
  if (idx.length < 2) return '';
  return `<div class="ot-plan-deps" role="group" aria-label="${W('選班次', 'Departures')}"><span class="ot-dep-l">${W('下一班', 'Next')}</span>${idx.map(i => `<span class="ot-dep${i === on ? ' on' : ''}" role="button" tabindex="0" ${attrs(i)} aria-pressed="${i === on}">${e(hm(ride(plans[i])?.dep ?? plans[i].dep))}${tag(plans[i]) ? `<small>${e(tag(plans[i]))}</small>` : ''}</span>`).join('')}</div>`;
}

export function legChips(legs) {
  return legs
    // (A walk under 2 minutes anywhere, or under 3 between rides, is just getting on and off.)
    .filter((l, i) => !(l.mode === 'walk' && legs.length > 1 && (l.dur < 120 || (l.dur < 180 && i > 0 && i < legs.length - 1))))
    .map(l => {
      const c = legColor(l);
      // A walk or a ride of your own: its minutes (the plan's tags say YouBike); a bus or train: its line.
      const mins = `${Math.max(1, Math.round((l.dur || 0) / 60))}′`;
      if (l.mode === 'walk') return `<span class="ot-leg walk" aria-label="${W('步行', 'Walk')} ${mins}">${icon('walk')}${mins}</span>`;
      if (l.mode === 'bike') return `<span class="ot-leg bike" style="--c:${e(c)}" aria-label="${l.ebike ? W('電輔車', 'E-bike') : 'YouBike'} ${mins}">${icon(l.ebike ? 'bolt' : 'bike')}<b>${mins}</b></span>`;
      return `<span class="ot-leg" style="--c:${e(c)}">${icon(l.mode)}<b>${e(legLabel(l))}</b></span>`;
    })
    .join('<span class="ot-leg-sep">›</span>');
}

export const timeRange = (dep, arr) => `${hm(dep)} – ${hm(arr)}`;

// A line of "updated N seconds ago".
export function ago(at, now = Date.now()) {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 15 ? W('剛剛更新', 'Updated just now') : s < 60 ? W(`${s} 秒前更新`, `Updated ${s}s ago`) : W(`${Math.round(s / 60)} 分鐘前更新`, `Updated ${Math.round(s / 60)} min ago`);
}
