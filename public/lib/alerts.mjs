// One-time bus alerts: "tell me when the 5608 is 5 minutes from my stop".
// Checked every 20 s while the app is open (TDX's estimates at that stop,
// every alert's stops in one ask a city: near.mjs etaStops),
// told by a notification (and a buzz, a chime on an iPhone, and the status line), then gone. Kept
// on this device for two hours, so a reload doesn't lose one, and on the
// Pass (underway.mjs), so Transit opened anywhere else keeps it.
// The Worker gets the list too (the kit's schedulePush, check `bus` in
// push.js) and checks each 2 minutes itself: an iPhone stops the app once
// it's locked or in the background, so that's what tells you then.

import { stationEtaAsk, etaOf, routeCity } from './bus.mjs';
import { etaStops } from './near.mjs';
import { uid, readSaved, UNREAD, writeJson } from './util.mjs';
import { buzz, primeBuzz } from './buzz.mjs';
import { underWay, changed } from './underway.mjs';

import { W } from '#kit/lang.mjs';
const KEY = 'orbit-transit.alerts';
const TTL = 2 * 60 * 60_000;
let unread = false; // (couldn't be read: never saved over)
let list = load();
let timer = 0;
let say = () => {};
let push = null;
const listeners = new Set();

function load() {
  const all = readSaved(KEY, []);
  unread = all === UNREAD;
  return Array.isArray(all) ? all.filter(a => a && Date.now() - a.at < TTL) : [];
}
// (`mine`: changed here, sent to the Pass; not for a notice list redone.)
function keep(mine = false) {
  if (!unread) writeJson(KEY, list);
  if (mine && !unread) changed('alerts', list.length ? list : null);
  listeners.forEach(f => f());
  push?.schedule([...list.map(pushItem), ...navItems, ...bikeItems, ...tripItems]);
  if (list.length && !timer) timer = setInterval(check, 20_000);
  if (!list.length && timer) {
    clearInterval(timer);
    timer = 0;
  }
}

// One alert as the Worker's notice: its check runs from when it was set
// until it lapses; the Worker writes {result} ("約 4 分鐘到站").
export const pushItem = a => ({
  at: a.at,
  until: a.at + TTL,
  title: W(`${a.route} 快到了`, `${a.route} is almost here`),
  body: `{result}（${a.station.name}）`,
  tag: `bus:${a.id}`,
  kind: 'bus',
  check: { bus: { path: stationEtaAsk(a.station), route: a.routeUID, dir: Number(a.dir), min: a.min } }
});

// The navigation's notices (nav.mjs navNotices), sent with the alerts: the
// Worker takes one list for the app.
let navItems = [];
export function setNavPush(items) {
  navItems = items || [];
  keep();
}

// A YouBike rental's notice (rental.mjs), sent with them too.
let bikeItems = [];
export function setBikePush(items) {
  const next = items || [];
  if (JSON.stringify(next) === JSON.stringify(bikeItems)) return;
  bikeItems = next;
  keep();
}
// A one-time trip's 「該出發了」 (tab-go.mjs tripPush), sent with them too.
let tripItems = [];
export function setTripPush(items) {
  const next = items || [];
  if (JSON.stringify(next) === JSON.stringify(tripItems)) return;
  tripItems = next;
  keep();
}
// Told now: the status line, a buzz, a notification when they're allowed.
export const notifyLocal = (text, body, tag) => notify(text, body, tag);

export const alerts = () => list;
export const onAlerts = f => listeners.add(f);
export const alertFor = (station, routeUID, dir) => list.find(a => a.station.uid === station.uid && a.routeUID === routeUID && a.dir === dir) || null;

// `station`: the map's stop ({ uid, id, cityCode, name }); the bus by its route and way, at its sign (`stopUID`).
export async function addAlert({ station, routeUID, route, dir, min, stopUID }) {
  primeBuzz();
  list = list.filter(a => !(a.station.uid === station.uid && a.routeUID === routeUID && a.dir === dir));
  list.push({ id: uid(), station: { uid: station.uid, id: station.id, cityCode: station.cityCode || '', name: station.name }, stop: { uid: stopUID, scope: routeCity(stopUID) }, routeUID, route, dir, min, at: Date.now() });
  try {
    if (globalThis.Notification?.permission === 'default') await Notification.requestPermission();
  } catch {}
  // Asking for an alert is asking for notices (unless they were turned off).
  // → why the lock screen won't hear of it ('' when it will): the caller says
  // it in place of its 會提醒你 (said after, that toast replaced it at once, so
  // a phone with notices off never heard alerts come only while it's open).
  const why = push?.allow() || '';
  keep(true);
  check();
  return why;
}
export function removeAlert(id) {
  list = list.filter(a => a.id !== id);
  keep(true);
}
// (Another place's alerts: taken as they are, checked here from now on; never sent back.)
underWay('alerts', {
  now: () => (list.length ? list : null),
  take(all) {
    if (unread) return;
    list = (Array.isArray(all) ? all : []).filter(a => a && a.station && a.routeUID && Date.now() - a.at < TTL);
    keep();
  },
  until: all => (Array.isArray(all) && all.length ? Math.max(...all.map(a => a.at || 0)) + TTL : undefined)
});

// The status line and the like (app.mjs).
// `withPush`: { schedule(items), allow() → why the lock screen won't hear of it, or '' }.
export function startAlerts(status, withPush = null) {
  say = status;
  push = withPush;
  keep();
}

async function notify(text, body, tag) {
  say(text);
  buzz();
  try {
    if (globalThis.Notification?.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) await reg.showNotification(text, { body, tag, renotify: true, icon: './icons/icon-192.png' });
    else new Notification(text, { body });
  } catch {}
}

let checking = false;
async function check() {
  if (checking || !list.length) return;
  checking = true;
  const had = list.length;
  try {
    list = list.filter(a => Date.now() - a.at < TTL);
    // (An alert set before its sign was kept is the Worker's to tell.)
    const stops = [...new Map(list.filter(a => a.stop?.uid).map(a => [a.stop.uid, a.stop])).values()];
    const rows = stops.length ? await etaStops(stops).catch(() => []) : [];
    for (const a of list.filter(x => x.stop?.uid)) {
      const r = rows.filter(x => x.StopUID === a.stop.uid && x.RouteUID === a.routeUID && Number(x.Direction) === Number(a.dir)).map(x => etaOf(x)).find(x => x.sec != null);
      if (!r || r.sec > a.min * 60) continue;
      const m = Math.max(0, Math.round(r.sec / 60));
      await notify(`${a.route} ${m <= 1 ? W('即將進站', 'arriving') : W(`${m} 分後到站`, `in ${m} min`)}`, `${a.station.name}${r.plate ? ` · ${r.plate}` : ''} · ${W('該出發了', 'time to go')}`, `transit:bus:${a.id}`);
      list = list.filter(x => x !== a);
    }
  } finally {
    checking = false;
    keep(list.length !== had);
  }
}
