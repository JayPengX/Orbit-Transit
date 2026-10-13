// Everything from the proxy (Shared-Proxy/transit.js), signed in with the
// Quadra Pass session: TDX's data, Google's map, places and routes. Answers
// are kept here too: in memory, and what lasts (stations, routes, a day's
// timetable) in this device's cache, so a second look costs nothing.

import { dev } from '#kit/quadra.mjs';
import { WALK_M_MIN } from './util.mjs';

export const PROXY = 'https://orbit-workers-proxy.pengzjay.workers.dev';
const DATA_CACHE = 'orbit-transit-data';

let session = null;
export const useSession = s => (session = s);
const token = async () => {
  const t = await session?.ensureToken();
  if (!t) throw Object.assign(new Error('signed out'), { code: 'SIGNED_OUT', status: 401 });
  return t;
};

// One ask of the proxy, given `wait` ms (a phone on a bad connection, or
// TDX slow behind it, shouldn't hang a card for ever), asked once more after
// a moment when it failed for a reason that passes (no answer, a timeout, a
// 5xx, TDX busy): most of what used to say 暫時無法取得資料 was one of those.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const passing = err => !err.status || err.status === 429 || err.status >= 500;
async function ask(path, { signal, wait = 15_000, meta = null } = {}) {
  const url = `${PROXY}${path}${path.includes('?') ? '&' : '?'}qt=${encodeURIComponent(await token())}`;
  const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const stop = setTimeout(() => timer?.abort(), wait);
  signal?.addEventListener?.('abort', () => timer?.abort());
  let res;
  try {
    res = await fetch(url, { signal: timer?.signal || signal });
  } catch (err) {
    const offline = globalThis.navigator?.onLine === false;
    throw Object.assign(new Error('network'), { code: offline ? 'OFFLINE' : signal?.aborted ? 'ABORTED' : timer?.signal.aborted ? 'TIMEOUT' : 'NETWORK', status: 0, cause: err });
  } finally {
    clearTimeout(stop);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(body?.code || `${res.status}`), { code: body?.code || 'HTTP', status: res.status });
  // How old the proxy's copy is (s): TDX slow, it answers with the copy it has.
  if (meta) meta.age = Number(res.headers?.get?.('X-Transit-Age')) || 0;
  return body;
}
async function get(path, opts = {}) {
  try {
    return await ask(path, opts);
  } catch (err) {
    if (!passing(err) || err.code === 'OFFLINE' || err.code === 'ABORTED' || err.code === 'SIGNED_OUT' || opts.signal?.aborted) throw err;
    await sleep(err.status === 429 ? 1500 : 700);
    return ask(path, opts);
  }
}

// ---- TDX through the proxy -----------------------------------------------------------------

const memory = new Map();
const hasCaches = () => typeof caches !== 'undefined';
export async function kept(path) {
  if (!hasCaches()) return null;
  try {
    const hit = await (await caches.open(DATA_CACHE)).match(`https://data.transit/${path}`);
    return hit ? { at: Number(hit.headers.get('x-at')) || 0, data: await hit.json() } : null;
  } catch {
    return null;
  }
}
export async function keep(path, data, at, max = Infinity) {
  if (!hasCaches()) return;
  try {
    const text = JSON.stringify(data);
    if (text.length > max) return;
    await (await caches.open(DATA_CACHE)).put(`https://data.transit/${path}`, new Response(text, { headers: { 'content-type': 'application/json', 'x-at': String(at) } }));
  } catch {}
}
const inflight = new Map();
// Paths answered from an old copy after a failed ask: path → when that copy is from.
export const stale = new Map();

// A TDX path (see transit.js TDX_RULES), parsed. `fresh`: how long a copy
// here is good (ms); `persist`: kept on the device across launches.
// A failed ask falls back to the last copy of any age (`{ stale: true }` on
// the returned array/object's meta via lastMeta).
// `store: false`: never written to the device (a big answer kept in a smaller form by its caller).
// Live data's speeds (the admin panel's 開發, kit dev): a card read again
// every transitLive seconds, YouBike every transitBike; a copy here good a
// second less, so each beat asks the Worker (whose own cache follows tdxLive).
export const liveMs = () => dev('transitLive') * 1000;
export const bikeMs = () => dev('transitBike') * 1000;
export async function tdx(path, { fresh = 30_000, persist = false, store = true } = {}) {
  if (fresh === 'live') fresh = liveMs() - 1000;
  else if (fresh === 'bike') fresh = bikeMs() - 1000;
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
      const meta = {};
      const data = await get(`/transit/tdx?p=${encodeURIComponent(path)}`, { meta });
      // When the data is from (the proxy's copy can be older): its "N 秒前更新", and asked again sooner.
      memory.set(path, { at: Date.now() - meta.age * 1000, data });
      stale.delete(path);
      // Live answers are kept too (a minute's copy beats an error after a relaunch).
      if (store) keep(path, data, Date.now(), persist ? Infinity : 200_000);
      return data;
    } catch (err) {
      // The last copy, here or kept on the device, however old: better than nothing.
      const last = memory.get(path) || (persist || !store ? null : await kept(path));
      if (last) {
        stale.set(path, last.at);
        return last.data;
      }
      throw err;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, p);
  return p;
}
// Something of the app's own kept on the device (a compact timetable): → { at, data } or null.
export const keptLocal = key => kept(`local/${key}`);
export const keepLocal = (key, data) => keep(`local/${key}`, data, Date.now());

// When a path's data is from (ms), or 0.
export const dataAt = path => memory.get(path)?.at || 0;
// What's already here for a path (no network), or null.
export const peek = path => memory.get(path)?.data ?? null;

// Each way TDX answers a list: v2 an array, v3 an object with one list in it.
export const rows = j => (Array.isArray(j) ? j : j && typeof j === 'object' ? Object.values(j).find(Array.isArray) || [] : []);

// ---- The rest of the proxy -------------------------------------------------------------------

export const config = () => get('/transit/config');
export const searchPlaces = (q, { lat, lon, session: s } = {}, opts) => get(`/transit/search?q=${encodeURIComponent(q)}${lat != null ? `&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}` : ''}${s ? `&s=${s}` : ''}`, opts);
export const placeDetails = (id, { name = false, session: s } = {}) => get(`/transit/place?id=${encodeURIComponent(id)}${name ? '&name=1' : ''}${s ? `&s=${s}` : ''}`);
// (`src`: one planner's alone, google or tdx: Google's come in a tenth of a second, TDX's in seconds.)
export const routePlans = (from, to, { at = null, by = 'depart', modes = null, src = '' } = {}) =>
  get(`/transit/route?from=${from.lat.toFixed(5)},${from.lon.toFixed(5)}&to=${to.lat.toFixed(5)},${to.lon.toFixed(5)}${at ? `&at=${at}` : ''}&by=${by}${modes ? `&modes=${modes.join(',')}` : ''}${src ? `&src=${src}` : ''}`, { wait: 30_000 });

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

// What went wrong, said plainly: the network here, the data source there, or busy.
export const errorText = err =>
  err?.code === 'OFFLINE'
    ? '沒有網路連線，連上後會自動更新。'
    : err?.code === 'TDX_BUSY' || err?.status === 429
      ? '查詢的人有點多，稍後自動再試。'
      : err?.code === 'TDX_NO_KEY'
        ? '交通資料尚未開通（TDX 金鑰還沒設定）。'
        : err?.code === 'SIGNED_OUT'
          ? '請先登入 Quadra Pass。'
          : err?.code === 'TIMEOUT'
            ? '資料來源回應太慢，稍後自動再試。'
            : err?.code === 'TDX_FAILED' || err?.status >= 500
              ? '交通部 TDX 暫時沒有回應，稍後自動再試。'
              : '暫時無法取得資料，稍後自動再試。';

// ---- Walks ---------------------------------------------------------------------------------------
// One walk wherever it's shown (the strip of nearest stations, a card's 距離
// and 走過去, a trip's walks): Google's streets (the proxy's /transit/walk:
// the lanes and short cuts OpenStreetMap's router misses; free under the
// month's cap, each walk kept there a month), OpenStreetMap's router past
// it. Its time at our pace (WALK_M_MIN), for every one alike. Kept on the
// phone, the newest 400 (without their lines): a reopen has them at once.
//   → [{ dist, sec, poly? } | null]
const WALKS_KEY = 'orbit-transit.walks';
const walksKept = (() => {
  try {
    return new Map(JSON.parse(localStorage.getItem(WALKS_KEY) || '[]'));
  } catch {
    return new Map();
  }
})();
let walksSave = 0;
const keepWalks = () => {
  clearTimeout(walksSave);
  walksSave = setTimeout(() => {
    try {
      localStorage.setItem(WALKS_KEY, JSON.stringify([...walksKept].slice(-400).map(([k, w]) => [k, { dist: w.dist, sec: w.sec }])));
    } catch {}
  }, 1000);
};
const p5 = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
const walkKey = (a, b) => `${p5(a)}|${p5(b)}`;
const paced = (dist, extra = {}) => ({ dist, sec: Math.round((dist / WALK_M_MIN) * 60), ...extra });
// (Known on the phone now, or null.)
export const walkKnown = (a, b) => walksKept.get(walkKey(a, b)) || null;
// (OpenStreetMap's walks from one point to many, one ask: its table, the
// metres from each point to its nearest path added, which it leaves out.)
async function osmWalks(from, tos) {
  const pts = [from, ...tos].map(p => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const j = await fetch(`${OSRM.walk}/table/v1/driving/${pts}?sources=0&annotations=distance`, { signal: AbortSignal.timeout?.(8000) })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
  const row = j?.distances?.[0];
  if (!row) return tos.map(() => null);
  const snap = Number(j.sources?.[0]?.distance) || 0;
  return tos.map((_, i) => (row[i + 1] == null ? null : Math.round(row[i + 1] + snap + (Number(j.destinations?.[i + 1]?.distance) || 0))));
}
// Each walk the shorter of Google's and OpenStreetMap's: a router misses
// paths, it never makes one up (Google's 210 m by the lane to 成功國中 where
// OpenStreetMap goes round the block, 485; OpenStreetMap's 344 m into 縣體育場
// where Google goes round to an entrance, 748).
export async function walksTo(from, tos, { line = false } = {}) {
  const need = tos.map((t, i) => (walksKept.get(walkKey(from, t)) && (!line || walksKept.get(walkKey(from, t)).poly) ? -1 : i)).filter(i => i >= 0);
  if (need.length) {
    const [asked, osm] = await Promise.all([get(`/transit/walk?from=${p5(from)}&to=${need.map(i => p5(tos[i])).join(';')}${line ? '&line=1' : ''}`).catch(() => null), osmWalks(from, need.map(i => tos[i]))]);
    await Promise.all(
      need.map(async (i, k) => {
        const g = asked?.walks?.[k];
        const o = osm[k];
        // Google's, unless OpenStreetMap's is shorter (or Google's isn't there: past its cap).
        if (g && (o == null || g.dist <= o)) return walksKept.set(walkKey(from, tos[i]), paced(g.dist, g.poly ? { poly: g.poly } : {}));
        // (Its line, when one's wanted: OpenStreetMap's route.)
        const r = line || o == null ? await roadPath('walk', from, tos[i]) : null;
        const dist = o ?? r?.dist;
        if (dist != null) walksKept.set(walkKey(from, tos[i]), paced(dist, r?.poly ? { poly: r.poly } : {}));
      })
    );
    keepWalks();
  }
  return tos.map(t => walksKept.get(walkKey(from, t)) || null);
}
export const walkTo = (from, to, opts) => walksTo(from, [to], opts).then(r => r[0]);

// ---- The roads a walk or a YouBike ride takes ------------------------------------------------
// OpenStreetMap's routers (FOSSGIS's OSRM, open to all, light use only:
// a plan's legs when it's opened), kept for the session.
const OSRM = { bike: 'https://routing.openstreetmap.de/routed-bike', walk: 'https://routing.openstreetmap.de/routed-foot' };
const roads = new Map();
// → { poly (Google-encoded), dist (m), dur (s) } or null.
export function roadPath(mode, a, b) {
  const base = OSRM[mode];
  if (!base || a?.lat == null || b?.lat == null) return Promise.resolve(null);
  const k = `${mode}:${a.lat.toFixed(5)},${a.lon.toFixed(5)}:${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
  if (!roads.has(k))
    roads.set(
      k,
      fetch(`${base}/route/v1/driving/${a.lon.toFixed(5)},${a.lat.toFixed(5)};${b.lon.toFixed(5)},${b.lat.toFixed(5)}?overview=full&geometries=polyline`, { signal: AbortSignal.timeout?.(8000) })
        .then(r => (r.ok ? r.json() : null))
        .then(j => (j?.routes?.[0] ? { poly: j.routes[0].geometry, dist: Math.round(j.routes[0].distance), dur: Math.round(j.routes[0].duration) } : null))
        .catch(() => (roads.delete(k), null))
    );
  return roads.get(k);
}
