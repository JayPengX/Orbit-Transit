// Orbit Transit: Taiwan's public transport in one app. An Orbit app (the
// everyday tools, like Orbit Weather): the Orbit Pass signs in and keeps the
// bus groups and places; the kit draws the loading screen, the tab bar and
// the account, and keeps the app current.
//
//   地圖    the map: places, YouBike (regular and 電輔車), bus stops,
//           stations; search, plans from here to anywhere (ranked by what's
//           practical, the buses' real times in them), navigation
//   交通    what's coming that you'd take: your trips' next ways to go,
//           what you pinned, what's near, your places
//   查時刻  a timetable on purpose: 台鐵 / 高鐵 station to station, a bus
//           route, the metro maps
//   我的    TPASS, places, trips, pinned transit, settings

import * as kitUI from '#kit/ui.mjs';
import { orbitSession, topActions, installGate, watchUpdates, tabBar, schedulePush, notifyOn, notifyPrefs, setNotifyOn, storedAccount, keepOffline, onlineOnly } from '#kit/orbit.mjs';
import { useSession, config, townships, getPosition } from './lib/api.mjs';
import { emptyData, encodeData, decodeData, mergeData } from './lib/store.mjs';
import { cityAt } from './lib/city.mjs';
import { warmRail } from './lib/raildata.mjs';
import { setHome, onNotices } from './lib/service.mjs';
import { startAlerts } from './lib/alerts.mjs';
import { savedNav, useMapsApp } from './lib/nav.mjs';
import * as mapTab from './lib/tab-map.mjs';
import * as goTab from './lib/tab-go.mjs';
import * as timesTab from './lib/tab-times.mjs';
import * as meTab from './lib/tab-me.mjs';
import { readSaved, UNREAD, writeJson } from './lib/util.mjs';
import { W, en, lang } from '#kit/lang.mjs';

const $ = id => document.getElementById(id);
const VERSION = document.querySelector('meta[name="build-version"]')?.content || 'dev';
const LOCAL = 'orbit-transit.v1';
document.documentElement.lang = en ? 'en' : 'zh-Hant';
// The page's own words, in English.
if (en) {
  const set = (sel, attr, v) => document.querySelector(sel)?.setAttribute(attr, v);
  set('#q', 'placeholder', 'Search places');
  set('#q', 'aria-label', 'Search');
  set('#q-clear', 'aria-label', 'Clear');
  set('#map', 'aria-label', 'Map');
  set('#msheet', 'aria-label', 'Map');
  set('#ms-grab', 'aria-label', 'Resize the panel');
  const cancel = document.getElementById('q-cancel');
  if (cancel) cancel.textContent = 'Cancel';
  set('#tabs', 'aria-label', 'Tabs');
  set('#map', 'aria-label', 'Map');
  set('#fab-layers', 'aria-label', 'Layers');
  set('#fab-locate', 'aria-label', 'My location');
  set('#times-seg', 'aria-label', 'Times');
  const seg = (v, t) => { const b = document.querySelector(`#times-seg [data-view="${v}"]`); if (b) b.textContent = t; };
  seg('train', 'Train');
  seg('bus', 'Bus');
  seg('metro', 'Metro');
}
const q = orbitSession('transit', { lang });
useSession(q);

// Where the device was last (opens the map there at once), this device's
// copy of the pass's data (one that couldn't be read is never saved over).
const kept = readSaved(LOCAL, {});
const local = (kept !== UNREAD && kept) || {};
const saveLocal = () => kept !== UNREAD && writeJson(LOCAL, local);

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
  // Where the device is now (asked again after a minute), from the session's
  // one watch on it (api.mjs): one ask a launch, never skipped.
  locate({ force = false } = {}) {
    if (!force && ctx.here && Date.now() - ctx.here.at < 60_000) return Promise.resolve(ctx.here);
    // (One ask at a time: the map and the opening both ask at launch.)
    if (!force && locating) return locating;
    const p = (locating = locateNow(force));
    p.finally(() => locating === p && (locating = null));
    return p;
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
  // What the app says (pinned, can't locate, replanning…): the kit's toast, a moment over the tab bar.
  status(text) {
    if (text) kitUI.toast(text, { batch: 'status', ms: 3200 });
  },
  goTab: id => select(id),
  // The metro maps (查時刻's third view), from a station's card.
  openMetro() {
    ctx.timesView = 'metro';
    select('times');
  },
  // Something kept changed (a pin, a trip, a preference): every tab that shows it redraws.
  onRefresh: [],
  refreshTabs: () => ctx.onRefresh.forEach(f => f())
};
// What's said about the buses and trains (service.mjs): the tabs drawn again when it changes.
setHome(ctx.city);
onNotices(() => ctx.refreshTabs());
let locating = null;
async function locateNow(force) {
  // (Always asked, never skipped by a note that it was asked before: the session's one watch, api.mjs, answers it.)
  const towns = townships().catch(() => null);
  const pos = await getPosition({ timeout: 10_000, maximumAge: force ? 10_000 : 60_000 });
  if (pos.error) return ctx.here;
  ctx.here = { lat: pos.lat, lon: pos.lon, acc: pos.acc, at: Date.now() };
  local.here = ctx.here;
  saveLocal();
  for (const fn of ctx.moved) fn(ctx.here);
  towns.then(t => {
    const c = t && cityAt(t, pos.lat, pos.lon);
    if (c?.city) setHome((ctx.city = local.city = c.city));
    saveLocal();
  });
  return ctx.here;
}
// (A walk or a ride handed to Google's or Apple's Maps, as 我的 says.)
useMapsApp(() => ctx.data.prefs?.maps);

// ---- Tabs --------------------------------------------------------------------------------------

const TABS = [
  { id: 'map', label: W('地圖', 'Map'), icon: '<path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>', mod: mapTab },
  { id: 'go', label: W('交通', 'Transit'), icon: '<rect x="4.5" y="3.5" width="15" height="15" rx="3"/><path d="M4.5 11h15M8 18.5V21M16 18.5V21"/><path d="M12 3.5V11"/>', mod: goTab },
  { id: 'times', label: W('查時刻', 'Times'), icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', mod: timesTab },
  { id: 'me', label: W('我的', 'Me'), icon: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6"/>', mod: meTab }
];
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

window.__fxStarted = true;
const gated = installGate('transit', 'zh');
watchUpdates({ current: VERSION, key: 'orbitTransit', cachePrefix: 'orbit-transit-' });
// Pull to refresh (the page's, on a phone): the 交通 tab's read again; the map pans, so it keeps its drags.
topActions(q, { refresh: () => (bar?.current === 'go' ? goTab.pull?.() : undefined) });
$('panel-map')?.setAttribute('data-no-ptr', '');
// A large title at the top of each tab but the first (the kit's navTitle, in the panel that scrolls).
for (const [id, title, before] of [['times', W('查時刻', 'Times'), '.ot-page'], ['me', W('我的', 'Me'), '#me-main']]) {
  const panel = $(`panel-${id}`);
  if (panel) panel.insertBefore(kitUI.navTitle(title), panel.querySelector(before));
}

async function boot() {
  bar = tabBar({ tabs: TABS, onSelect: (id, o) => select(id, o), label: W('分頁', 'Tabs') });
  // Opened again (back from the background after iOS let it go): on what this
  // device has, at once — its copy of the pass's data and the map's settings
  // kept from last time — and the pass and the settings read behind it
  // Signed out, or the first time, they're waited for.
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
  // A ride being navigated when the app was swiped away: on with it, on the
  // map (or, shrunk to its bar, on the tab you were on).
  const was = savedNav();
  const asked = /^#(map|go|times|me)/.exec(location.hash)?.[1] || 'map';
  const want = was && !was.min ? 'map' : asked;
  mapTab.register(ctx);
  meTab.register(ctx);
  // The first tab drawn behind the loading screen, which lifts onto it
  // finished: the map's tiles, what's in view, the strip (mapTab.ready), at
  // most 4 s (then as it stands).
  select(want);
  // (Shrunk, on another tab: the map started behind it, so the ride goes on and its bar shows.)
  if (was && want !== 'map' && !started.has('map')) {
    started.add('map');
    mapTab.init(ctx);
  }
  if (want === 'map') await Promise.race([mapTab.ready, new Promise(r => setTimeout(r, 4000))]);
  else await Promise.race([TABS.find(t => t.id === want)?.mod.ready?.(), new Promise(r => setTimeout(r, 1500))]);
  $('loading').hidden = true;
  ctx.locate();
  startAlerts(t => ctx.status(t), {
    schedule: items => schedulePush(q, items),
    // Whether the Worker can tell you with the phone locked; if not, why.
    allow() {
      if (!('Notification' in globalThis)) return W('加到主畫面後，手機鎖著也能收到到站提醒', 'Add to Home Screen to get arrival alerts while locked');
      if (Notification.permission !== 'granted') return W('沒有允許通知：只在 App 開著時提醒', 'Notifications off: alerts only while the app is open');
      if (notifyPrefs().on === false) return W('通知在帳戶裡關閉了：只在 App 開著時提醒', 'Notifications off in your account: alerts only while open');
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

// Opens without a connection: the kit registers the worker and has it keep every file loaded.
keepOffline();
// Every screen is live (an old copy would read as now): no connection, the kit's cover, not the saved copy.
onlineOnly({ zh: '即時到站和路線規劃需要網路連線', en: 'Live arrivals and trips need a connection.' });
