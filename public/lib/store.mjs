// What Orbit Transit keeps on the Quadra Pass (`t1:` + JSON, at most
// 100,000 characters): the bus groups, the pinned places, recent trips and
// train searches, the map's layers. The newer copy (by `t`) wins; this
// device keeps one too, so it opens at once.

import { uid } from './util.mjs';

export const MAX_GROUPS = 12;
export const MAX_ITEMS = 16;
export const MAX_PLACES = 20;
export const LAYERS = { bike: 'YouBike', bus: '公車站', rail: '火車・高鐵', metro: '捷運' };
export const PLACE_ICONS = { home: '🏠', work: '💼', school: '🎓', pin: '📍', star: '⭐' };

export const emptyData = () => ({
  v: 1,
  groups: [{ id: 'g' + uid(), name: '常用', items: [] }],
  places: [],
  trips: [],
  trains: [],
  layers: { bike: true, bus: true, rail: true, metro: true },
  t: 0
});

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

// Moving one entry up or down a list.
export function move(list, i, by) {
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
