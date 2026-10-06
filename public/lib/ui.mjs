// Shared UI: sheets, the transport icons, a plan's legs as chips.

import { e, minsText, hm } from './util.mjs';

// A modal sheet (the kit's look): closed by its × or a tap outside.
export function sheet(html, cls = '') {
  const d = document.createElement('dialog');
  d.className = `q-sheet ot-sheet ${cls}`;
  d.innerHTML = html;
  d.addEventListener('click', ev => (ev.target === d || ev.target.closest('[data-act="close"]')) && d.close());
  d.addEventListener('close', () => {
    d.onclosed?.();
    d.remove();
  });
  document.body.append(d);
  d.showModal();
  return d;
}
export const sheetHead = (title, sub = '') => `<div class="q-sheet-head"><div><h2>${title}</h2>${sub ? `<p class="ot-sheet-sub">${sub}</p>` : ''}</div><button class="q-close" type="button" data-act="close" aria-label="關閉">×</button></div>`;

// 24×24 stroked icons, one per way of moving.
const I = {
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M10.5 21l2-6.5 3 3V21M7 12.5l2.5-4.5 4 1 2.5 3.5M12.5 9l-1.5 5.5"/>',
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
  bolt: '<path d="M13 2.5L5.5 13.5H11l-1 8 7.5-11H12z"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  ticket: '<path d="M3.5 8V5.5h17V8a2.5 2.5 0 0 0 0 5v5.5h-17V13a2.5 2.5 0 0 0 0-5z"/><path d="M14 5.5v13" stroke-dasharray="2 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>',
  live: '<circle cx="12" cy="12" r="2.3"/><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8"/>'
};
export const icon = (name, cls = '') => `<svg class="ot-i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || I.rail}</svg>`;

export const MODE_NAME = { walk: '步行', bike: 'YouBike', bus: '公車', metro: '捷運', lightrail: '輕軌', tra: '台鐵', hsr: '高鐵', ferry: '渡輪', gondola: '纜車', car: '計程車', plane: '飛機', rail: '鐵路' };
export const MODE_COLOR = { walk: '#8a92a3', bike: '#f5b301', bus: '#22c55e', metro: '#3b82f6', lightrail: '#14b8a6', tra: '#0ea5e9', hsr: '#f97316', ferry: '#06b6d4', gondola: '#84cc16', car: '#eab308', plane: '#a78bfa', rail: '#0ea5e9' };
export const legColor = l => (l.color && /^#?[0-9a-f]{6}$/i.test(l.color.replace('#', '')) ? (l.color.startsWith('#') ? l.color : `#${l.color}`) : MODE_COLOR[l.mode] || '#94a3b8');

// What a leg is called on its chip: 「區間車」「板南線」「182」「YouBike」.
export function legLabel(l) {
  if (l.mode === 'walk') return minsText(l.dur);
  if (l.mode === 'bike') return l.ebike ? '電輔車' : 'YouBike';
  if (l.mode === 'bus') return l.short || l.name || '公車';
  if (l.mode === 'hsr') return '高鐵';
  // A planner's line (新竹-六家) once the train is known: its kind and number, as on its sign.
  if (l.mode === 'tra' && l.train?.type && l.train?.no && /-/.test(l.short || l.name || '')) return `${l.train.type} ${l.train.no}`;
  return l.short || l.name || MODE_NAME[l.mode];
}
// A plan's legs as a row of chips (the short walks left out).
// A route's departures as times to pick (its bus or train's own time; the
// train's kind too when they differ, 區間 or 自強). `plans`: the list, `idx`:
// which of it, `on`: the one shown; each carries data-* from `attrs(i)`.
export function depChips(plans, idx, on, attrs) {
  if (idx.length < 2) return '';
  // The ride the times differ by (a bus to the station, then a choice of trains: the trains').
  const rides = p => p.legs.filter(l => l.mode !== 'walk' && l.mode !== 'bike');
  const k = Math.max(0, rides(plans[idx[0]]).findIndex((l, j) => idx.some(i => rides(plans[i])[j]?.dep !== l.dep)));
  const ride = p => rides(p)[k] || rides(p)[0];
  const kind = p => (ride(p)?.train ? String(ride(p).name || '').replace(/[（(].*$/, '').replace(/號.*$/, '').replace(/車$/, '') : '');
  const mixed = new Set(idx.map(i => kind(plans[i]))).size > 1;
  // Some straight through, some changing trains (竹東 → 新竹, or via 竹中): which is which.
  const via = p => (rides(p).length > 1 ? `${String(rides(p)[0].to?.name || '').replace(/(火車站|車站|站)$/, '')}轉` : '直達');
  const changing = new Set(idx.map(i => rides(plans[i]).length)).size > 1;
  const tag = p => [mixed ? kind(p) : '', changing ? via(p) : ''].filter(Boolean).join('・');
  return `<div class="ot-plan-deps" role="group" aria-label="選班次">${idx.map(i => `<span class="ot-dep${i === on ? ' on' : ''}" role="button" tabindex="0" ${attrs(i)} aria-pressed="${i === on}">${e(hm(ride(plans[i])?.dep ?? plans[i].dep))}${tag(plans[i]) ? `<small>${e(tag(plans[i]))}</small>` : ''}</span>`).join('')}</div>`;
}

export function legChips(legs) {
  return legs
    // (A walk under 2 minutes anywhere, or under 3 between rides, is just getting on and off.)
    .filter((l, i) => !(l.mode === 'walk' && legs.length > 1 && (l.dur < 120 || (l.dur < 180 && i > 0 && i < legs.length - 1))))
    .map(l => {
      const c = legColor(l);
      // A walk or a ride of your own: its minutes (the plan's tags say YouBike); a bus or train: its line.
      const mins = `${Math.max(1, Math.round((l.dur || 0) / 60))}′`;
      if (l.mode === 'walk') return `<span class="ot-leg walk" aria-label="步行 ${mins}">${icon('walk')}${mins}</span>`;
      if (l.mode === 'bike') return `<span class="ot-leg bike" style="--c:${e(c)}" aria-label="${l.ebike ? '電輔車' : 'YouBike'} ${mins}">${icon(l.ebike ? 'bolt' : 'bike')}<b>${mins}</b></span>`;
      return `<span class="ot-leg" style="--c:${e(c)}">${icon(l.mode)}<b>${e(legLabel(l))}</b></span>`;
    })
    .join('<span class="ot-leg-sep">›</span>');
}

export const timeRange = (dep, arr) => `${hm(dep)} – ${hm(arr)}`;

// A line of "updated N seconds ago".
export function ago(at, now = Date.now()) {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 15 ? '剛剛更新' : s < 60 ? `${s} 秒前更新` : `${Math.round(s / 60)} 分鐘前更新`;
}
