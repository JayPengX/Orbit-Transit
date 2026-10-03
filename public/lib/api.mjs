// Everything from the proxy (Shared-Proxy/transit.js), signed in with the
// Quadra Pass session: TDX's data, Google's map, places and routes. Answers
// are kept here too: in memory, and what lasts (stations, routes, a day's
// timetable) in this device's cache, so a second look costs nothing.

export const PROXY = 'https://orbit-workers-proxy.pengzjay.workers.dev';
const DATA_CACHE = 'orbit-transit-data';

let session = null;
export const useSession = s => (session = s);
const token = async () => {
  const t = await session?.ensureToken();
  if (!t) throw Object.assign(new Error('signed out'), { code: 'SIGNED_OUT', status: 401 });
  return t;
};

async function get(path, { signal } = {}) {
  const url = `${PROXY}${path}${path.includes('?') ? '&' : '?'}qt=${encodeURIComponent(await token())}`;
  const res = await fetch(url, { signal });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(body?.code || `${res.status}`), { code: body?.code || 'HTTP', status: res.status });
  return body;
}

// ---- TDX through the proxy -----------------------------------------------------------------

const memory = new Map();
const hasCaches = () => typeof caches !== 'undefined';
async function kept(path) {
  if (!hasCaches()) return null;
  try {
    const hit = await (await caches.open(DATA_CACHE)).match(`https://data.transit/${path}`);
    return hit ? { at: Number(hit.headers.get('x-at')) || 0, data: await hit.json() } : null;
  } catch {
    return null;
  }
}
async function keep(path, data, at) {
  if (!hasCaches()) return;
  try {
    await (await caches.open(DATA_CACHE)).put(`https://data.transit/${path}`, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'x-at': String(at) } }));
  } catch {}
}
const inflight = new Map();

// A TDX path (see transit.js TDX_RULES), parsed. `fresh`: how long a copy
// here is good (ms); `persist`: kept on the device across launches.
// A failed ask falls back to the last copy of any age (`{ stale: true }` on
// the returned array/object's meta via lastMeta).
export async function tdx(path, { fresh = 30_000, persist = false } = {}) {
  const now = Date.now();
  const mem = memory.get(path);
  if (mem && now - mem.at < fresh) return mem.data;
  if (persist && !mem) {
    const k = await kept(path);
    if (k) {
      memory.set(path, k);
      if (now - k.at < fresh) return k.data;
    }
  }
  if (inflight.has(path)) return inflight.get(path);
  const p = (async () => {
    try {
      const data = await get(`/transit/tdx?p=${encodeURIComponent(path)}`);
      memory.set(path, { at: Date.now(), data });
      if (persist) keep(path, data, Date.now());
      return data;
    } catch (err) {
      const last = memory.get(path);
      if (last) return last.data;
      throw err;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, p);
  return p;
}
// What's already here for a path (no network), or null.
export const peek = path => memory.get(path)?.data ?? null;

// Each way TDX answers a list: v2 an array, v3 an object with one list in it.
export const rows = j => (Array.isArray(j) ? j : j && typeof j === 'object' ? Object.values(j).find(Array.isArray) || [] : []);

// ---- The rest of the proxy -------------------------------------------------------------------

export const config = () => get('/transit/config');
export const searchPlaces = (q, { lat, lon, session: s } = {}, opts) => get(`/transit/search?q=${encodeURIComponent(q)}${lat != null ? `&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}` : ''}${s ? `&s=${s}` : ''}`, opts);
export const placeDetails = (id, { name = false, session: s } = {}) => get(`/transit/place?id=${encodeURIComponent(id)}${name ? '&name=1' : ''}${s ? `&s=${s}` : ''}`);
export const routePlans = (from, to, { at = null, by = 'depart' } = {}) => get(`/transit/route?from=${from.lat.toFixed(5)},${from.lon.toFixed(5)}&to=${to.lat.toFixed(5)},${to.lon.toFixed(5)}${at ? `&at=${at}` : ''}&by=${by}`);

// Taiwan's townships (the weather route's open list), kept a month.
const TOWNS_KEY = 'orbit-transit.towns';
let towns = null;
export async function townships() {
  if (towns) return towns;
  try {
    const k = JSON.parse(localStorage.getItem(TOWNS_KEY) || 'null');
    if (k && Date.now() - k.at < 30 * 86_400_000) return (towns = k.data);
  } catch {}
  const res = await fetch(`${PROXY}/weather/places`);
  if (!res.ok) throw new Error(`places ${res.status}`);
  towns = await res.json();
  try {
    localStorage.setItem(TOWNS_KEY, JSON.stringify({ at: Date.now(), data: towns }));
  } catch {}
  return towns;
}

// ---- Where the device is ---------------------------------------------------------------------

export async function permissionState(nav = globalThis.navigator) {
  try {
    return (await nav?.permissions?.query({ name: 'geolocation' }))?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}
export function getPosition({ timeout = 8000, maximumAge = 60_000, high = true } = {}, nav = globalThis.navigator) {
  return new Promise(resolve => {
    if (!nav?.geolocation) return resolve({ error: 'unsupported' });
    nav.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading }),
      err => resolve({ error: err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: high, timeout, maximumAge }
    );
  });
}
// Follows the device while the map is open: fn({ lat, lon, acc, heading }).
export function watchPosition(fn, nav = globalThis.navigator) {
  if (!nav?.geolocation?.watchPosition) return () => {};
  const id = nav.geolocation.watchPosition(p => fn({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading }), () => {}, { enableHighAccuracy: true, maximumAge: 10_000 });
  return () => nav.geolocation.clearWatch(id);
}

export const errorText = err =>
  err?.code === 'TDX_BUSY' || err?.status === 429
    ? '查詢的人有點多，請稍候幾秒再試。'
    : err?.code === 'TDX_NO_KEY'
      ? '交通資料尚未開通（TDX 金鑰還沒設定）。'
      : err?.code === 'SIGNED_OUT'
        ? '請先登入 Quadra Pass。'
        : '暫時無法取得資料，請檢查網路。';
