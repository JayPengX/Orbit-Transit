// Orbit Transit: Taiwan's public transport in one app. A Quadra app (a
// related add-on, like Orbit Weather): the Quadra Pass signs in and keeps the
// bus groups and places; the kit draws the loading screen, the tab bar and
// the account, and keeps the app current.
//
//   地圖  the map: places, YouBike (regular and 電輔車), bus stops, stations;
//         search, and plans from here to anywhere (transit and YouBike)
//   公車  bus routes in groups, swiped, with when the bus comes
//   火車  台鐵 and 高鐵, changing trains (branch lines, 台鐵 ↔ 高鐵) by itself
//   捷運  each city's metro as one big map; a station's next trains, live

import { quadraSession, topActions, installGate, watchUpdates, tabBar, tell } from './lib/quadra.mjs';
import { useSession, config, townships, getPosition, permissionState } from './lib/api.mjs';
import { emptyData, encodeData, decodeData, mergeData } from './lib/store.mjs';
import { cityAt } from './lib/city.mjs';
import * as mapTab from './lib/tab-map.mjs';
import * as busTab from './lib/tab-bus.mjs';
import * as trainTab from './lib/tab-train.mjs';
import * as metroTab from './lib/tab-metro.mjs';

const $ = id => document.getElementById(id);
const VERSION = document.querySelector('meta[name="build-version"]')?.content || 'dev';
const LOCAL = 'orbit-transit.v1';
const q = quadraSession('transit', { lang: 'zh' });
useSession(q);

// Where the device was last (opens the map there at once), this device's
// copy of the pass's data.
const local = (() => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) || '{}') || {};
  } catch {
    return {};
  }
})();
const saveLocal = () => {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(local));
  } catch {}
};

// What every tab shares.
export const ctx = {
  q,
  data: decodeData(local.data) || emptyData(),
  here: local.here || null, // { lat, lon, acc, at }
  city: local.city || null, // TDX City where the device is
  cfg: null,
  // The pass's copy written after a change (the newest wins on every device).
  async save() {
    ctx.data.t = Date.now();
    local.data = encodeData(ctx.data);
    saveLocal();
    if (q.active) await q.write({ payload: local.data }).catch(() => {});
  },
  // Where the device is now (asked again after a minute).
  async locate({ force = false } = {}) {
    if (!force && ctx.here && Date.now() - ctx.here.at < 60_000) return ctx.here;
    const perm = await permissionState();
    if (perm === 'denied') return ctx.here;
    let pos = await getPosition({ high: true, timeout: 8000 });
    if (pos.error === 'timeout') pos = await getPosition({ high: false, timeout: 5000, maximumAge: 10 * 60_000 });
    if (pos.error) return ctx.here;
    ctx.here = { lat: pos.lat, lon: pos.lon, acc: pos.acc, at: Date.now() };
    local.here = ctx.here;
    try {
      const c = cityAt(await townships(), pos.lat, pos.lon);
      if (c?.city) ctx.city = local.city = c.city;
    } catch {}
    saveLocal();
    for (const fn of ctx.moved) fn(ctx.here);
    return ctx.here;
  },
  moved: [],
  // The TDX city of a point.
  async cityOf(lat, lon) {
    try {
      return cityAt(await townships(), lat, lon)?.city || null;
    } catch {
      return null;
    }
  },
  status(text) {
    $('status').textContent = text || '';
  },
  goTab: id => select(id)
};

// ---- Tabs --------------------------------------------------------------------------------------

const TABS = [
  { id: 'map', label: '地圖', icon: '<path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>', mod: mapTab },
  { id: 'bus', label: '公車', icon: '<rect x="4.5" y="3.5" width="15" height="15" rx="3"/><path d="M4.5 11h15M8 18.5V21M16 18.5V21"/>', mod: busTab },
  { id: 'train', label: '火車', icon: '<rect x="6" y="3" width="12" height="15" rx="3"/><path d="M6 10.5h12M12 3v7.5M8.5 21l1.5-3M15.5 21L14 18"/>', mod: trainTab },
  { id: 'metro', label: '捷運', icon: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 6h7M18 8.5v7M7.8 7.8l8.4 8.4"/>', mod: metroTab }
];
const started = new Set();
let bar = null;
function select(id, { again = false } = {}) {
  const tab = TABS.find(t => t.id === id) || TABS[0];
  bar.select(tab.id);
  document.body.className = `tab-${tab.id}`;
  if (!started.has(tab.id)) {
    started.add(tab.id);
    tab.mod.init(ctx);
  }
  tab.mod.show?.({ again });
  for (const t of TABS) if (t.id !== tab.id) t.mod.hide?.();
}

// ---- Start ---------------------------------------------------------------------------------------

const help = () =>
  tell({
    title: 'Orbit Transit',
    body: '台灣的公車、火車、高鐵、捷運和 YouBike，一個 App。',
    points: [
      '地圖：搜尋地點，或點地圖上的店家、車站、YouBike；按「路線」看從你這裡過去的各種方案（最快、YouBike、少轉乘）。',
      '地圖上的 YouBike 數字是現在可借的車（⚡ 是電輔車），點開看空位。',
      '公車：搜尋路線，把站牌加入群組；左右滑動切換群組，每 20 秒更新到站時間。',
      '火車：選起訖站（可先選縣市），自動找台鐵支線、台鐵 ↔ 高鐵的轉乘。',
      '捷運：雙指縮放路網圖，點車站看下一班車。'
    ]
  });

window.__fxStarted = true;
const gated = installGate('transit', 'zh');
watchUpdates({ current: VERSION, key: 'orbitTransit', cachePrefix: 'orbit-transit-', busy: () => Boolean(document.querySelector('dialog[open]')) });
topActions(q, { help });

async function boot() {
  bar = tabBar({ tabs: TABS, onSelect: (id, o) => select(id, o), label: '分頁' });
  const first = await q.start();
  const theirs = decodeData(first?.payload);
  const merged = mergeData(ctx.data, theirs);
  const changed = encodeData(merged) !== (first?.payload || '');
  ctx.data = merged;
  local.data = encodeData(merged);
  saveLocal();
  if (changed && theirs == null && merged.t && q.active) q.write({ payload: local.data }).catch(() => {});
  ctx.cfg = await config().catch(() => ({ map: { provider: 'nlsc' }, search: 'osm' }));
  $('loading').hidden = true;
  const start = /^#(map|bus|train|metro)/.exec(location.hash)?.[1] || 'map';
  select(start);
  ctx.locate();
}
q.on('active', live => live && ctx.data.t && q.write({ payload: encodeData(ctx.data) }).catch(() => {}));
if (!gated) boot();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !bar) return;
  TABS.find(t => t.id === bar.current)?.mod.show?.({ again: false, back: true });
});

if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
