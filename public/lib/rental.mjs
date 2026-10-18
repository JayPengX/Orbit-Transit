// A YouBike rental timed for you (the owner, 2026-10-15): 我借車了 on a
// station's card (or in 交通's bar) starts it, the map's chip shows how long
// you've had the bike, 已還車 ends it, 換了一台 starts it again. With
// TPASS's free half hour (or 每 30 分鐘換車): a notice 5 minutes before it
// runs out, and the docks near you to return it at and take another
// (`swapDocks`), the way you're going first. Kept on this device (12 hours
// at most), the notice sent with the alerts' (the Worker tells you once the
// phone is locked).

import { meters } from './util.mjs';
import { canRent, canReturn } from './bike.mjs';

import { W } from './lang.mjs';
const KEY = 'orbit-transit.rental';
const TTL = 12 * 60 * 60_000;
export const FREE_MS = 30 * 60_000;
export const WARN_MS = 25 * 60_000;
const listeners = new Set();
let cur = load();

function load() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    return r && Number.isFinite(r.at) && Date.now() - r.at < TTL ? r : null;
  } catch {
    return null;
  }
}
function keep() {
  try {
    if (cur) localStorage.setItem(KEY, JSON.stringify(cur));
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach(f => f(cur));
}

export const rental = () => (cur && Date.now() - cur.at < TTL ? cur : null);
export const onRental = f => listeners.add(f);
// `station`: where the bike was taken ({ uid, name, lat, lon }), or none.
// `key`: what started it (navigation: the trip's step), so a step seen again doesn't start it over.
export function startRental(station = null, at = Date.now(), key = '') {
  cur = { at, station: station ? { uid: station.uid || '', name: station.name || '', lat: station.lat, lon: station.lon } : null, n: (cur?.n || 0) + 1, ...(key ? { key } : {}) };
  keep();
}

// Navigating, the trip got to step `i`: the timer as the steps say. A ride
// on a bike just taken (not the one kept from a stop) starts it, or starts
// it over (換一台); off a bike that was returned (not parked at a stop) to
// walk or ride something else ends it. → 'start' | 'end' | null.
export function rentalStep(plan, i) {
  const l = plan.legs[i];
  const prev = plan.legs[i - 1];
  if (l?.mode === 'bike' && !l.kept) return 'start';
  if (prev?.mode === 'bike' && !prev.park && l?.mode !== 'bike') return 'end';
  return null;
}
export function markWarned() {
  if (!cur) return;
  cur.warned = true;
  keep();
}
export function endRental() {
  cur = null;
  keep();
}

// The notice before the free half hour runs out (kit schedulePush's shape).
export const rentalPush = (r, swap) =>
  r && swap && r.at + WARN_MS > Date.now() - 60_000
    ? [{ at: r.at + WARN_MS, title: W('YouBike 已騎 25 分鐘', 'YouBike: 25 minutes'), body: W('5 分鐘內還車再借一台，下一段仍免費（地圖上有附近的站）', 'Return and re-rent within 5 minutes to keep the next ride free (nearby docks are on the map).'), tag: `bike:rent:${r.at}`, kind: 'bike', hash: 'map' }]
    : [];

// Where to return the bike and take another, near you: a station with a free
// dock and a bike, nearest first; with where you're going, a station that
// way is as good as one 150 m nearer behind you. → [{ s, d }] (d: metres).
export function swapDocks(here, bikes, { toward = null, max = 800, n = 3 } = {}) {
  if (!here) return [];
  return bikes
    .filter(s => canReturn(s) && canRent(s))
    .map(s => {
      const d = meters(here.lat, here.lon, s.lat, s.lon);
      const ahead = toward ? meters(s.lat, s.lon, toward.lat, toward.lon) < meters(here.lat, here.lon, toward.lat, toward.lon) : false;
      return { s, d: Math.round(d), k: d - (ahead ? 150 : 0) };
    })
    .filter(x => x.d <= max)
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map(({ s, d }) => ({ s, d }));
}
