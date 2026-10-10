// Orbit Transit: Taiwan's public transport in one app. An Orbit app (the
// everyday tools, like Orbit Weather): the Quadra Pass signs in and keeps the
// bus groups and places; the kit draws the loading screen, the tab bar and
// the account, and keeps the app current.
//
//   地圖    the map: places, YouBike (regular and 電輔車), bus stops,
//           stations; search, plans from here to anywhere (ranked by what's
//           practical, the buses' real times in them), navigation
//   交通    what's coming that you'd take: your trips' next ways to go,
//           what you pinned, your places
//   查時刻  a timetable on purpose: 台鐵 / 高鐵 station to station, a bus route
//   我的    places, trips, pinned transit, preferences (ways of moving,
//           TPASS), tickets, the metro maps

import { quadraSession, topActions, installGate, watchUpdates, tabBar, tell, schedulePush, notifyOn, notifyPrefs, setNotifyOn, storedAccount } from '#kit/quadra.mjs';
import { useSession, config, townships, getPosition, permissionState } from './lib/api.mjs';
import { emptyData, encodeData, decodeData, mergeData } from './lib/store.mjs';
import { cityAt } from './lib/city.mjs';
import { warmRail } from './lib/raildata.mjs';
import { startAlerts } from './lib/alerts.mjs';
import { savedNav } from './lib/nav.mjs';
import * as mapTab from './lib/tab-map.mjs';
import * as goTab from './lib/tab-go.mjs';
import * as timesTab from './lib/tab-times.mjs';
import * as meTab from './lib/tab-me.mjs';
import { useHolidays } from './lib/util.mjs';
// Taiwan's holidays (the kit's), before the first screen: a weekdays-only
// trip (家 → 學校) isn't picked for a holiday (an older kit: none, at once).
const holidays = await Promise.race([import('#kit/holidays.mjs').catch(() => null), new Promise(r => setTimeout(r, 1500, null))]);
if (holidays?.twHoliday) useHolidays(date => Boolean(holidays.twHoliday(date)));

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
  goTab: id => select(id),
  // Something kept changed (a pin, a trip, a preference): every tab that shows it redraws.
  onRefresh: [],
  refreshTabs: () => ctx.onRefresh.forEach(f => f())
};

// ---- Tabs --------------------------------------------------------------------------------------

const TABS = [
  { id: 'map', label: '地圖', icon: '<path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>', mod: mapTab },
  { id: 'go', label: '交通', icon: '<rect x="4.5" y="3.5" width="15" height="15" rx="3"/><path d="M4.5 11h15M8 18.5V21M16 18.5V21"/><path d="M12 3.5V11"/>', mod: goTab },
  { id: 'times', label: '查時刻', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', mod: timesTab },
  { id: 'me', label: '我的', icon: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6"/>', mod: meTab }
];
// Old addresses (#bus, #train, #metro) open their new homes.
const OLD = { bus: 'go', train: 'times', metro: 'me' };
const started = new Set();
let bar = null;
function select(id, { again = false } = {}) {
  const tab = TABS.find(t => t.id === id) || TABS[0];
  bar.select(tab.id);
  for (const c of [...document.body.classList]) if (c.startsWith('tab-')) document.body.classList.remove(c);
  document.body.classList.add(`tab-${tab.id}`);
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
      '地圖：搜尋地點，或點地圖上的店家、車站、YouBike；按「路線」看從你現在的位置過去的推薦方案（公車的即時位置都算進去了），點方案再按「開始導航」。',
      '路線上方的出發地可以換成釘選地點、搜尋的地點，或在地圖上選；按 ☆ 釘選這個行程（可以設時間、每週固定幾天）。',
      '交通：常用行程接下來的班次、附近的公車火車和 YouBike、你釘選的公車與火車，點一下就導航。',
      '查時刻：台鐵、高鐵站到站（自動找轉乘），或查公車路線的即時到站與時刻表；都可以 ☆ 釘選。',
      '我的：地點、行程、釘選交通、交通偏好（不搭某些交通工具、每 30 分鐘換 YouBike、TPASS）、買車票、捷運路網圖。'
    ]
  });

window.__fxStarted = true;
const gated = installGate('transit', 'zh');
watchUpdates({ current: VERSION, key: 'orbitTransit', cachePrefix: 'orbit-transit-', busy: () => Boolean(document.querySelector('dialog[open]')) });
topActions(q, { help });

async function boot() {
  bar = tabBar({ tabs: TABS, onSelect: (id, o) => select(id, o), label: '分頁' });
  // Opened again (back from the background after iOS let it go): on what this
  // device has, at once — its copy of the pass's data and the map's settings
  // kept from last time — and the pass and the settings read behind it
  // (TRUTH §5). Signed out, or the first time, they're waited for.
  const merge = first => {
    const theirs = decodeData(first?.payload);
    const merged = mergeData(ctx.data, theirs);
    const changed = encodeData(merged) !== (first?.payload || '');
    const was = encodeData(ctx.data);
    ctx.data = merged;
    local.data = encodeData(merged);
    saveLocal();
    if (changed && theirs == null && merged.t && q.active) q.write({ payload: local.data }).catch(() => {});
    return local.data !== was;
  };
  const getCfg = () =>
    config()
      .then(c => {
        local.cfg = c;
        saveLocal();
        return c;
      })
      .catch(() => null);
  const quick = Boolean(storedAccount() && local.cfg);
  const session = q.start();
  if (quick) {
    ctx.cfg = local.cfg;
    getCfg();
    session.then(first => merge(first) && ctx.refreshTabs()).catch(() => {});
  } else {
    merge(await session);
    ctx.cfg = (await getCfg()) || { map: { provider: 'nlsc' }, search: 'osm' };
  }
  $('loading').hidden = true;
  // A ride being navigated when the app was swiped away: on with it, on the
  // map (or, shrunk to its bar, on the tab you were on).
  const was = savedNav();
  const asked = /^#(map|go|times|me|bus|train|metro)/.exec(location.hash)?.[1] || 'map';
  const want = was && !was.min ? 'map' : asked;
  mapTab.register(ctx);
  meTab.register(ctx);
  select(OLD[want] || want);
  // (Shrunk, on another tab: the map started behind it, so the ride goes on and its bar shows.)
  if (was && (OLD[want] || want) !== 'map' && !started.has('map')) {
    started.add('map');
    mapTab.init(ctx);
  }
  if (want === 'metro') ctx.openMetro?.();
  ctx.locate();
  startAlerts(t => ctx.status(t), {
    schedule: items => schedulePush(q, items),
    // Whether the Worker can tell you with the phone locked; if not, why.
    allow() {
      if (!('Notification' in globalThis)) return '加到主畫面後，手機鎖著也能收到到站提醒';
      if (Notification.permission !== 'granted') return '沒有允許通知：只在 App 開著時提醒';
      if (notifyPrefs().on === false) return '通知在帳戶裡關閉了：只在 App 開著時提醒';
      if (!notifyOn()) setNotifyOn(true, q);
      return '';
    }
  });
  // The day's trains loaded while nothing else is (a timetable search, a plan, 交通's pins use them).
  const P = ctx.data.prefs?.modes;
  if (!P || P.tra || P.hsr) setTimeout(() => (window.requestIdleCallback || (f => f()))(() => warmRail()), 2500);
}
q.on('active', live => live && ctx.data.t && q.write({ payload: encodeData(ctx.data) }).catch(() => {}));
if (!gated) boot();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !bar) return;
  TABS.find(t => t.id === bar.current)?.mod.show?.({ again: false, back: true });
});

if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./sw.js').catch(() => {});
