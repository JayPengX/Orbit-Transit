// What Orbit Transit keeps on the Quadra Pass (`t1:` + JSON, at most
// 100,000 characters): the bus groups (pinned stops and lines), the pinned
// places, saved trips (a place to a place, maybe at a time, maybe every
// weekday: 常用行程), pinned trains (a connection, or one train), recent
// trips and train searches, the map's layers and the ways of moving the
// planner may use. The newer copy (by `t`) wins; this device keeps one too,
// so it opens at once.

import { uid } from './util.mjs';

export const MAX_GROUPS = 12;
export const MAX_ITEMS = 16;
export const MAX_PLACES = 20;
export const MAX_SAVED = 20;
export const MAX_PINS = 24;
// The ways of moving the planner may use (我的 → 交通偏好).
export const MODES = { bus: '公車', tra: '台鐵', hsr: '高鐵', metro: '捷運・輕軌', bike: 'YouBike' };
export const DAYS = '日一二三四五六';
export const LAYERS = { bike: 'YouBike', bus: '公車站', rail: '火車・高鐵', metro: '捷運' };
export const PLACE_ICONS = { home: '🏠', work: '💼', school: '🎓', pin: '📍', star: '⭐' };

export const emptyData = () => ({
  v: 1,
  groups: [{ id: 'g' + uid(), name: '常用', items: [] }],
  places: [],
  trips: [],
  trains: [],
  layers: { bike: true, bus: true, rail: true, metro: true },
  saved: [],
  pins: [],
  prefs: defaultPrefs(),
  t: 0
});
export const defaultPrefs = () => ({ modes: Object.fromEntries(Object.keys(MODES).map(k => [k, true])), bike30: false, tpass: '' });

const str = (v, n = 60) => (typeof v === 'string' ? v.slice(0, n) : '');
const coord = v => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1e6) / 1e6 : null);

export function cleanItem(x) {
  if (!x || typeof x !== 'object' || !x.routeUID || !x.stopUID) return null;
  return {
    id: str(x.id, 20) || 'i' + uid(),
    city: str(x.city, 24),
    routeUID: str(x.routeUID, 40),
    route: str(x.route, 30),
    dir: [0, 1, 2, 10, 255].includes(Number(x.dir)) ? Number(x.dir) : 0,
    stopUID: str(x.stopUID, 40),
    stop: str(x.stop, 40),
    headsign: str(x.headsign, 40),
    ...(coord(x.lat) != null && coord(x.lon) != null ? { lat: coord(x.lat), lon: coord(x.lon) } : {})
  };
}
export function cleanPlace(p) {
  const lat = coord(p?.lat);
  const lon = coord(p?.lon);
  if (!p || lat == null || lon == null || !(lat > 21 && lat < 27 && lon > 118 && lon < 123)) return null;
  return { id: str(p.id, 20) || 'p' + uid(), name: str(p.name, 30) || '我的地點', icon: PLACE_ICONS[p.icon] ? p.icon : 'pin', lat, lon, address: str(p.address, 80) };
}
// A trip's end: { name, lat, lon } (null: wherever you are then).
export function cleanEnd(p) {
  const lat = coord(p?.lat);
  const lon = coord(p?.lon);
  if (!p || lat == null || lon == null || !(lat > 21 && lat < 27 && lon > 118 && lon < 123)) return null;
  return { name: str(p.name, 30) || '地點', lat, lon };
}
const hhmm = v => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '');
// A saved trip: { id, name, from (null: 目前位置), to, time ('HH:MM' or ''),
// by ('depart' | 'arrive'), days ([0–6], empty: not recurring), back (the
// time home, for a recurring trip; '' none) }.
export function cleanSaved(x) {
  const to = cleanEnd(x?.to);
  if (!to) return null;
  return {
    id: str(x.id, 20) || 's' + uid(),
    name: str(x.name, 24),
    from: x.from ? cleanEnd(x.from) : null,
    to,
    time: hhmm(x.time),
    by: x.by === 'arrive' ? 'arrive' : 'depart',
    days: [...new Set((Array.isArray(x.days) ? x.days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort(),
    back: hhmm(x.back)
  };
}
// A pinned train: a connection (from → to, every train), or one train by its number.
export function cleanPin(x) {
  if (!x || typeof x !== 'object') return null;
  const from = cleanStation(x.from);
  const to = cleanStation(x.to);
  if (!from || !to) return null;
  if (x.kind === 'train') return { id: str(x.id, 20) || 'n' + uid(), kind: 'train', from, to };
  if (x.kind === 'trainNo' && /^[0-9A-Za-z]{1,6}$/.test(String(x.no || ''))) return { id: str(x.id, 20) || 'n' + uid(), kind: 'trainNo', sys: x.sys === 'hsr' ? 'hsr' : 'tra', no: String(x.no), type: str(x.type, 12), dep: hhmm(x.dep), from, to };
  return null;
}
export function cleanPrefs(p) {
  const d = defaultPrefs();
  if (!p || typeof p !== 'object') return d;
  for (const k of Object.keys(MODES)) d.modes[k] = p.modes?.[k] !== false;
  // Nothing at all allowed is everything.
  if (!Object.values(d.modes).some(Boolean)) d.modes = defaultPrefs().modes;
  d.bike30 = p.bike30 === true;
  d.tpass = str(p.tpass, 12);
  return d;
}

const cleanStation = s => (s && s.id && ['tra', 'hsr', 'metro'].includes(s.sys) ? { sys: s.sys, id: str(s.id, 16), name: str(s.name, 20), ...(s.op ? { op: str(s.op, 8) } : {}) } : null);

export function cleanData(d) {
  if (!d || typeof d !== 'object') return emptyData();
  const groups = (Array.isArray(d.groups) ? d.groups : [])
    .slice(0, MAX_GROUPS)
    .map(g => ({ id: str(g?.id, 20) || 'g' + uid(), name: str(g?.name, 16) || '群組', items: (Array.isArray(g?.items) ? g.items : []).map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS) }));
  return {
    v: 1,
    groups: groups.length ? groups : emptyData().groups,
    places: (Array.isArray(d.places) ? d.places : []).map(cleanPlace).filter(Boolean).slice(0, MAX_PLACES),
    trips: (Array.isArray(d.trips) ? d.trips : [])
      .map(x => (x && coord(x.lat) != null ? { name: str(x.name, 40), lat: coord(x.lat), lon: coord(x.lon), t: Number(x.t) || 0 } : null))
      .filter(Boolean)
      .slice(0, 10),
    trains: (Array.isArray(d.trains) ? d.trains : [])
      .map(x => (x && cleanStation(x.from) && cleanStation(x.to) ? { from: cleanStation(x.from), to: cleanStation(x.to), t: Number(x.t) || 0 } : null))
      .filter(Boolean)
      .slice(0, 8),
    layers: Object.fromEntries(Object.keys(LAYERS).map(k => [k, d.layers?.[k] !== false])),
    saved: (Array.isArray(d.saved) ? d.saved : []).map(cleanSaved).filter(Boolean).slice(0, MAX_SAVED),
    pins: (Array.isArray(d.pins) ? d.pins : []).map(cleanPin).filter(Boolean).slice(0, MAX_PINS),
    prefs: cleanPrefs(d.prefs),
    t: Number(d.t) || 0
  };
}

export const encodeData = d => `t1:${JSON.stringify(cleanData(d))}`;
export function decodeData(text) {
  if (typeof text !== 'string' || !text.startsWith('t1:')) return null;
  try {
    return cleanData(JSON.parse(text.slice(3)));
  } catch {
    return null;
  }
}
// The newer copy wins.
export const mergeData = (mine, theirs) => (!theirs ? mine : !mine || (theirs.t || 0) >= (mine.t || 0) ? theirs : mine);

// A recent search or trip goes to the front, once.
export function remember(list, item, key, max) {
  return [item, ...list.filter(x => key(x) !== key(item))].slice(0, max);
}
export const trainKey = x => `${x.from.sys}:${x.from.id}>${x.to.sys}:${x.to.id}`;
export const tripKey = x => `${x.lat.toFixed(4)},${x.lon.toFixed(4)}`;
// The modes allowed, as the proxy's `modes=` list.
export const modeList = prefs => Object.keys(MODES).filter(k => prefs?.modes?.[k] !== false);

// Moving one entry up or down a list.
export function move(list, i, by) {
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
