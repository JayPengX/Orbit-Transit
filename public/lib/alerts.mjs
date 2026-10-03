// One-time bus alerts: "tell me when the 5608 is 5 minutes from my stop".
// Checked every 20 s while the app is open (TDX's estimates at that stop),
// told by a notification (and a buzz and the status line), then gone. Kept
// on this device for two hours, so a reload doesn't lose one.

import { stationEta } from './bus.mjs';
import { uid } from './util.mjs';

const KEY = 'orbit-transit.alerts';
const TTL = 2 * 60 * 60_000;
let list = load();
let timer = 0;
let say = () => {};
const listeners = new Set();

function load() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(all) ? all.filter(a => a && Date.now() - a.at < TTL) : [];
  } catch {
    return [];
  }
}
function keep() {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  listeners.forEach(f => f());
  if (list.length && !timer) timer = setInterval(check, 20_000);
  if (!list.length && timer) {
    clearInterval(timer);
    timer = 0;
  }
}

export const alerts = () => list;
export const onAlerts = f => listeners.add(f);
export const alertFor = (station, routeUID, dir) => list.find(a => a.station.uid === station.uid && a.routeUID === routeUID && a.dir === dir) || null;

// `station`: the map's stop ({ uid, id, cityCode, name }); the bus by its route and way.
export async function addAlert({ station, routeUID, route, dir, min }) {
  list = list.filter(a => !(a.station.uid === station.uid && a.routeUID === routeUID && a.dir === dir));
  list.push({ id: uid(), station: { uid: station.uid, id: station.id, cityCode: station.cityCode || '', name: station.name }, routeUID, route, dir, min, at: Date.now() });
  keep();
  try {
    if (globalThis.Notification?.permission === 'default') await Notification.requestPermission();
  } catch {}
  check();
}
export function removeAlert(id) {
  list = list.filter(a => a.id !== id);
  keep();
}

// The status line and the like (app.mjs).
export function startAlerts(status) {
  say = status;
  keep();
}

async function notify(text, body) {
  say(text);
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {}
  try {
    if (globalThis.Notification?.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) await reg.showNotification(text, { body, tag: 'bus-alert', renotify: true, icon: './icons/icon-192.png' });
    else new Notification(text, { body });
  } catch {}
}

let checking = false;
async function check() {
  if (checking || !list.length) return;
  checking = true;
  try {
    list = list.filter(a => Date.now() - a.at < TTL);
    const byStop = new Map();
    for (const a of list) byStop.set(a.station.uid, a.station);
    for (const st of byStop.values()) {
      let rows;
      try {
        rows = await stationEta(st);
      } catch {
        continue;
      }
      for (const a of list.filter(x => x.station.uid === st.uid)) {
        const r = rows.find(x => x.routeUID === a.routeUID && Number(x.dir) === Number(a.dir) && x.sec != null);
        if (!r || r.sec > a.min * 60) continue;
        const m = Math.max(0, Math.round(r.sec / 60));
        await notify(`${a.route} ${m <= 1 ? '即將進站' : `${m} 分後到站`}`, `${a.station.name}${r.plate ? ` · ${r.plate}` : ''}：該出發了`);
        list = list.filter(x => x !== a);
      }
    }
  } finally {
    checking = false;
    keep();
  }
}
