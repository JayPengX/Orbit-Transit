// Everything from the proxy (Orbit-Core/transit.js), signed in with the
// Orbit Pass session: TDX's data, Google's map, places and routes. Answers
// are kept here too: in memory, and what lasts (stations, routes, a day's
// timetable) in this device's cache, so a second look costs nothing.

import * as kit from '#kit/orbit.mjs';
import { dev } from '#kit/orbit.mjs';
import { WALK_M_MIN, readJson, readSaved, UNREAD, writeJson } from './util.mjs';

import { W } from '#kit/lang.mjs';
// (api.<domain> on the family's own domain: the kit's API, kit/domain.mjs.)
const PROXY = kit.API || 'https://orbit-workers-proxy.pengzjay.workers.dev';
const DATA_CACHE = 'orbit-transit-data';

let session = null;
export const useSession = s => (session = s);
const token = async (renew = false) => {
  // (A read: the token kept, up to 6 hours old, goes at once; a new one only when it's turned away.)
  const t = await session?.ensureToken({ renew, read: !renew });
  if (!t) throw Object.assign(new Error('signed out'), { code: 'SIGNED_OUT', status: 401 });
  return t;
};

// One ask of the proxy, given `wait` ms (a phone on a bad connection, or
// TDX slow behind it, shouldn't hang a card for ever), asked once more after
// a moment when it failed for a reason that passes (no answer, a timeout, a
// 5xx, TDX busy): most of what used to say 暫時無法取得資料 was one of those.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const passing = err => !err.status || err.status === 429 || err.status >= 500;
const BODY_QUIET_MS = 10_000;
// An answer's JSON, read a piece at a time, `quiet()` called before each.
async function bodyJson(res, quiet) {
  const reader = res.body?.getReader?.();
  quiet();
  if (!reader) return res.json();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    quiet();
    const { done, value } = await reader.read();
    if (done) return JSON.parse(text + decoder.decode());
    text += decoder.decode(value, { stream: true });
  }
}
async function ask(path, { signal, wait = 15_000, meta = null, renew = false } = {}) {
  // (The token is waited for within `wait` too: a sign-in refresh that never answered held every ask behind it.)
  const t = await Promise.race([token(renew), sleep(wait).then(() => Promise.reject(Object.assign(new Error('network'), { code: 'TIMEOUT', status: 0 })))]);
  const url = `${PROXY}${path}${path.includes('?') ? '&' : '?'}qt=${encodeURIComponent(t)}`;
  const timer = typeof AbortController !== 'undefined' ? new AbortController() : null;
  // (The answer's body is waited for too, not only its headers: a body that
  // stalled on a weak link, a city's YouBike list, half a megabyte, never
  // came and its ask never ended, so every later ask for it waited on it and
  // the map's bikes stayed empty until the app was restarted; 2026-10-22.
  // Each piece of it that comes gives it BODY_QUIET_MS more: a limit on the
  // whole body cut a big answer off while it was still coming on a slow,
  // busy link (a day's trains), and it was downloaded again; 2026-11-05.)
  let stop = 0;
  const quiet = () => {
    clearTimeout(stop);
    stop = setTimeout(() => timer?.abort(), BODY_QUIET_MS);
  };
  const head = setTimeout(() => timer?.abort(), wait);
  signal?.addEventListener?.('abort', () => timer?.abort());
  const failed = err => {
    const offline = globalThis.navigator?.onLine === false;
    return Object.assign(new Error('network'), { code: offline ? 'OFFLINE' : signal?.aborted ? 'ABORTED' : timer?.signal.aborted ? 'TIMEOUT' : 'NETWORK', status: 0, cause: err });
  };
  let res;
  let body = null;
  try {
    try {
      res = await fetch(url, { signal: timer?.signal || signal });
    } catch (err) {
      throw failed(err);
    } finally {
      clearTimeout(head);
    }
    try {
      body = await bodyJson(res, quiet);
    } catch (err) {
      // (A good answer whose body didn't come whole is a failed ask, never an empty answer.)
      if (res.ok) throw failed(err);
    }
  } finally {
    clearTimeout(stop);
  }
  if (!res.ok) throw Object.assign(new Error(body?.code || `${res.status}`), { code: body?.code || 'HTTP', status: res.status });
  // How old the proxy's copy is (s): TDX slow, it answers with the copy it has.
  if (meta) meta.age = Number(res.headers?.get?.('X-Transit-Age')) || 0;
  return body;
}
async function get(path, opts = {}) {
  try {
    return await ask(path, opts);
  } catch (err) {
    // Turned away for its token (signed before the proxy's secret changed, or run out): once more with a new one, as the kit's own asks do.
    if (err.status === 401 && err.code !== 'SIGNED_OUT') return ask(path, { ...opts, renew: true });
    if (!passing(err) || err.code === 'OFFLINE' || err.code === 'ABORTED' || err.code === 'SIGNED_OUT' || opts.signal?.aborted) throw err;
    await sleep(err.status === 429 ? 1500 : 700);
    return ask(path, opts);
  }
}

// ---- TDX through the proxy -----------------------------------------------------------------

const memory = new Map();
const hasCaches = () => typeof caches !== 'undefined';
// (1.5 s at most: the phone's cache storage, which now and then
// doesn't answer, never holds up the ask.)
export async function kept(path) {
  if (!hasCaches()) return null;
  const read = (async () => {
    const hit = await (await caches.open(DATA_CACHE)).match(`https://data.transit/${path}`);
    return hit ? { at: Number(hit.headers.get('x-at')) || 0, data: await hit.json() } : null;
  })().catch(() => null);
  return Promise.race([read, new Promise(r => setTimeout(r, 1500, null))]);
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
// `swr` (ms): no copy here yet (a launch), the device's copy that old at
// most answers at once, the fresh one asked behind it; `onFresh` tells who
// drew from it (YouBike's counts: the map opens on the last ones, swapped
// for the new a second later, not a strip waiting on the network).
// `late` (ms): the network slower than that, the last copy here or on the
// device (up to LATE_MAX old) answers instead, the ask going on behind for
// the next look (YouBike: a trip's bikes never wait on a slow TDX, and never
// go missing; Jay 2026-10-22). `max`: the biggest answer kept on the device.
const LATE_MAX = 30 * 60_000;
const freshers = new Set();
export const onFresh = f => freshers.add(f);
export async function tdx(path, opts = {}) {
  const ask = tdxAsk(path, opts);
  if (!opts.late) return ask;
  const last = memory.get(path) || (await kept(path));
  if (!last || Date.now() - last.at > LATE_MAX) return ask;
  ask.catch(() => {});
  return Promise.race([ask, sleep(opts.late).then(() => (stale.set(path, last.at), last.data))]);
}
async function tdxAsk(path, { fresh = 30_000, persist = false, store = true, swr = 0, max = 200_000 } = {}) {
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
  if (swr && !mem && !inflight.has(path)) {
    const k = await kept(path);
    if (k && now - k.at < swr && !memory.has(path)) {
      memory.set(path, k);
      tdxAsk(path, { fresh, persist, store, max }).then(() => freshers.forEach(f => f(path)), () => {});
      return k.data;
    }
  }
  // (An ask that somehow never ended is not waited on for ever: after a minute, asked anew.)
  const going = inflight.get(path);
  if (going && Date.now() - going.at < 60_000) return going;
  const p = (async () => {
    try {
      const meta = {};
      const data = await get(`/transit/tdx?p=${encodeURIComponent(path)}`, { meta });
      // When the data is from (the proxy's copy can be older): its "N 秒前更新", and asked again sooner.
      memory.set(path, { at: Date.now() - meta.age * 1000, data });
      stale.delete(path);
      // Live answers are kept too (a minute's copy beats an error after a relaunch).
      if (store) keep(path, data, Date.now(), persist ? Infinity : max);
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
      if (inflight.get(path) === p) inflight.delete(path);
    }
  })();
  p.at = Date.now();
  inflight.set(path, p);
  return p;
}
// Something of the app's own kept on the device (a compact timetable): → { at, data } or null.
export const keptLocal = key => kept(`local/${key}`);
export const keepLocal = (key, data) => keep(`local/${key}`, data, Date.now());

// When a path's data is from (ms), or 0.
export const dataAt = path => memory.get(path)?.at || 0;

// Each way TDX answers a list: v2 an array, v3 an object with one list in it.
export const rows = j => (Array.isArray(j) ? j : j && typeof j === 'object' ? Object.values(j).find(Array.isArray) || [] : []);

// ---- The rest of the proxy -------------------------------------------------------------------

export const config = () => get('/transit/config');
// The buses due at these stops (or on one route) from the Worker (transit.js
// etaRows: a busy city's from one TDX call for everyone, a quiet one's from
// TDX's read of those stops): → { rows, at } (when the copy is from).
// The same ask while one is on its way, or within the live speed of the last,
// is that one: a trip's ways asked their buses' route up to five times in one
// plan, each a Worker request for the same rows (2026-11-06). Asked again at
// each beat as before (a beat is the live speed, this a second under it).
// And the routes asked within a moment of each other go as one ask a city
// (`routes=`, 20 at most), each route given its own rows: a plan's buses were
// five to ten asks, one a route.
// A city makes its estimates all at once every so often (the newest of its
// rows' DataTime: Hsinchu's, Hsinchu County's and 公路客運's every 30 s,
// Taipei's every 10 to 20 s), and TDX has each a few seconds later, about as
// regular as the clock (5 to 10 s, 2026-11-06). So the phone learns each
// city's rhythm: its step (the lower middle of its last ones, at most 30 s)
// and how soon after its DataTime a new estimate has been had (the least of
// the last 12 times an answer brought one the ask before hadn't: never
// sooner than it can be read). The same stops or route aren't asked again
// until the next estimate can be there (a second sooner, DataTime being to
// the second): one ask an estimate, not three, and none later than asking
// every beat would have shown it. A stop or route whose rows sat one out
// (none of them new in it) waits for the next once it's surely there (5 s
// on: TDX has a city's estimates 5 to 10 s after their time; a beat more
// asked a quiet stop's three times an estimate, each one TDX's, 2026-11-06).
// Where the step is no longer than a beat (Taipei; or rows with
// no DataTime), every beat asks as before. And an ask says how old the
// phone's copy is (`had`): the Worker reads TDX then if its own copy is no
// newer, not answering with it and reading behind (each phone saw the
// estimates a beat late). Estimates are counted from their DataTime
// (util.mjs etaAge), so no countdown moves.
const etaAsks = new Map(); // address (or city|route) → { got, ask, dt, at (its data's time) }
const feeds = new Map(); // city → { dt: its newest DataTime seen, steps, seen: how long after its DataTime each new one was had }
const newestOf = rows => rows.reduce((m, r) => Math.max(m, Date.parse(r?.DataTime || '') || 0), 0);
const stepOf = f => {
  const s = [...f.steps].sort((a, b) => a - b);
  return s.length ? Math.min(s[(s.length - 1) >> 1], 30_000) : 0;
};
// An answer (data from `at`) with newest DataTime `d`; the same ask's last
// answer was from `was` with newest `had`.
function feedSaw(city, d, at, was, had) {
  const f = feeds.get(city) || { dt: 0, steps: [], seen: [] };
  feeds.set(city, f);
  if (d > f.dt) {
    if (f.dt) f.steps = [...f.steps.slice(-7), d - f.dt];
    f.dt = d;
  }
  if (was && had && d > had) f.seen = [...f.seen.slice(-11), at - d];
}
// When the first estimate an answer (data from `at`, newest `had`) hasn't
// had can be there: one newer than its newest, and not surely there by
// then (its rows sat that one out). 0: the city's rhythm not known yet.
const SURE_MS = 5000;
function nextDue(city, at, had) {
  const f = feeds.get(city);
  const step = f ? stepOf(f) : 0;
  if (!f?.seen.length || !f.dt || !(step > liveMs())) return 0;
  const soon = Math.min(...f.seen);
  const j = Math.max(Math.floor((had - f.dt) / step) + 1, Math.floor((at - (soon + SURE_MS) - f.dt) / step) + 1);
  return f.dt + j * step + soon - 1000;
}
export function busEta(city, { stops = [], route = '' } = {}) {
  const key = stops.length ? `/transit/eta?city=${encodeURIComponent(city)}&stops=${stops.map(encodeURIComponent).join(',')}` : `${city}|${route}`;
  const now = Date.now();
  const k = etaAsks.get(key);
  if (k && (now - k.got < liveMs() - 1000 || (k.at && now <= nextDue(city, k.at, k.dt)))) return k.ask;
  const had = k?.at ? Math.max(1, Math.floor((now - k.at) / 1000)) : 0;
  const ask = stops.length ? etaAsk(had ? `${key}&had=${had}` : key) : routeEta(city, route, had);
  const x = { got: now, ask, dt: k?.dt || 0, at: k?.at || 0 };
  etaAsks.set(key, x);
  ask.then(
    got => {
      const d = newestOf(got?.rows || []);
      const at = Math.min(Date.now(), got?.at || Date.now());
      feedSaw(city, d, at, k?.at || 0, k?.dt || 0);
      x.dt = Math.max(x.dt, d);
      x.at = at;
    },
    () => etaAsks.get(key)?.ask === ask && etaAsks.delete(key)
  );
  // (Only the last minute's asks are kept.)
  if (etaAsks.size > 100) for (const [p, y] of etaAsks) if (now - y.got > 60_000) etaAsks.delete(p);
  return ask;
}
// Where routes' buses are (/transit/gps: the Worker reads a city's whole list
// once for every route and every phone, 公路客運's by its routes), `had`: how
// old the phone's copy is (s), as busEta's. → { rows, at } (when the copy is from).
export async function busGps(city, routes, had = 0) {
  const meta = {};
  const got = await get(`/transit/gps?city=${encodeURIComponent(city)}&routes=${routes.map(encodeURIComponent).join(',')}${had ? `&had=${had}` : ''}`, { meta, wait: 8000 });
  return { rows: Array.isArray(got) ? got : [], at: Date.now() - (meta.age || 0) * 1000 };
}
async function etaAsk(path) {
  const meta = {};
  const got = await get(path, { meta, wait: 8000 });
  return { rows: Array.isArray(got) ? got : [], at: Date.now() - (meta.age || 0) * 1000 };
}
const ROUTES_AT_ONCE = 20;
let routeBatch = null; // city → { had, per: Map(RouteUID → [{ resolve, reject }]) }
function routeEta(city, uid, had = 0) {
  return new Promise((resolve, reject) => {
    if (!routeBatch) {
      const b = (routeBatch = new Map());
      setTimeout(() => {
        if (routeBatch === b) routeBatch = null;
        for (const [c, one] of b) sendRoutes(c, one);
      }, 20);
    }
    if (!routeBatch.has(city)) routeBatch.set(city, { had: 0, per: new Map() });
    const one = routeBatch.get(city);
    // (Asked with the youngest copy any of them has: an older one of the Worker's is no use to it.)
    if (had) one.had = one.had ? Math.min(one.had, had) : had;
    if (!one.per.has(uid)) one.per.set(uid, []);
    one.per.get(uid).push({ resolve, reject });
  });
}
function sendRoutes(city, { had, per }) {
  const uids = [...per.keys()];
  for (let i = 0; i < uids.length; i += ROUTES_AT_ONCE) {
    const part = uids.slice(i, i + ROUTES_AT_ONCE);
    const q = part.length === 1 ? `route=${encodeURIComponent(part[0])}` : `routes=${part.map(encodeURIComponent).join(',')}`;
    etaAsk(`/transit/eta?city=${encodeURIComponent(city)}&${q}${had ? `&had=${had}` : ''}`).then(
      ({ rows: list, at }) => {
        for (const u of part) for (const w of per.get(u)) w.resolve({ rows: part.length === 1 ? list : list.filter(r => r.RouteUID === u), at });
      },
      err => {
        for (const u of part) for (const w of per.get(u)) w.reject(err);
      }
    );
  }
}
// Which of a city's bus routes have a bus on the road now: { at, routes: { RouteUID: n } } (transit.js running).
export const busesRunning = city => get(`/transit/running?city=${encodeURIComponent(city)}`);
export const searchPlaces = (q, { lat, lon, session: s } = {}, opts) => get(`/transit/search?q=${encodeURIComponent(q)}${lat != null ? `&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}` : ''}${s ? `&s=${s}` : ''}`, opts);
export const placeDetails = (id, { name = false, session: s } = {}) => get(`/transit/place?id=${encodeURIComponent(id)}${name ? '&name=1' : ''}${s ? `&s=${s}` : ''}`);
// (`src`: one planner's alone, google or tdx: Google's come in a tenth of a second, TDX's in seconds.)
export const routePlans = (from, to, { at = null, by = 'depart', modes = null, src = '' } = {}) =>
  get(`/transit/route?from=${from.lat.toFixed(5)},${from.lon.toFixed(5)}&to=${to.lat.toFixed(5)},${to.lon.toFixed(5)}${at ? `&at=${at}` : ''}&by=${by}${modes ? `&modes=${modes.join(',')}` : ''}${src ? `&src=${src}` : ''}`, { wait: 30_000 });

// Taiwan's townships (the weather route's open list), kept a month.
const TOWNS_KEY = 'orbit-transit.towns';
let towns = null;
// (One ask at a time: a first trip's parts asked for it three or four times at once.)
let townsAsk = null;
export function townships() {
  if (towns) return Promise.resolve(towns);
  return (townsAsk ||= readTownships().finally(() => (townsAsk = null)));
}
// The township and village at a point (a spot tapped on the map: 竹北市 斗崙里附近).
export const whereIs = pt => get(`/weather/where?lat=${pt.lat.toFixed(5)}&lon=${pt.lon.toFixed(5)}`, { wait: 8000 });
async function readTownships() {
  const k = readJson(TOWNS_KEY);
  if (k && Date.now() - k.at < 30 * 86_400_000) return (towns = k.data);
  const res = await fetch(`${PROXY}/weather/places`, { signal: AbortSignal.timeout?.(10_000) });
  if (!res.ok) throw new Error(`places ${res.status}`);
  towns = await res.json();
  writeJson(TOWNS_KEY, { at: Date.now(), data: towns });
  return towns;
}

// ---- Where the device is ---------------------------------------------------------------------

// One watch on the device for the whole session, every ask answered from it
// (the map, the opening, 交通, navigation). On an iPhone's home screen each
// separate ask (a getCurrentPosition, a second watch, a watch started again on
// coming back) could put up 「允許取用位置？」 again: one watch asks once a
// launch, and is never skipped (an ask suppressed once had left the app with
// no location at all; the owner, 2026-10-21). Refused, it stops; the next
// ask (a tap on 我的位置) starts it again.
// `answered`: the watch running now has said anything (a fix or an error). One
// that hasn't may be waiting on 「允許取用位置？」: never started over then, or
// a second ask went up over the first (Jay 2026-10-30, asked twice on opening:
// navigation's 5 s restart on coming back fired while the first ask was up).
// Silent a minute (no ask is left up that long; a dead watch is): started over then.
const UNANSWERED_MS = 60_000;
const geo = { id: null, last: null, fns: new Set(), waiting: new Set(), answered: false, at: 0 };
const restartable = () => geo.answered || Date.now() - geo.at > UNANSWERED_MS;
// (`at`: when the device took it, by its own stamp: an iPhone back from the
// background can hand over the last fix it had, minutes old, as if new; Jay
// 2026-11-07, on 普悠瑪 107 past 香山, the trip took his fix at 新竹 as him still
// there and said he'd missed it. A stamp a day off or ahead isn't believed.)
const fixAt = (p, now = Date.now()) => (Number.isFinite(p?.timestamp) && p.timestamp <= now + 60_000 && p.timestamp > now - 86_400_000 ? Math.min(now, p.timestamp) : now);
const fixOf = p => ({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, at: fixAt(p) });
// The last three minutes of fixes, for telling whether you're on a bus or train (aboard.mjs).
const TRACK_MS = 180_000;
const track = [];
export const recentFixes = (now = Date.now()) => track.filter(x => x.t >= now - TRACK_MS);
function watchDevice(nav) {
  if (geo.id != null || !nav?.geolocation?.watchPosition) return;
  geo.answered = false;
  geo.at = Date.now();
  geo.id = nav.geolocation.watchPosition(
    p => {
      geo.answered = true;
      const fix = fixOf(p);
      // (One taken a while ago, handed over late: never the last, nor in the track.)
      if (!geo.last || Date.now() - fix.at <= 30_000) {
        geo.last = { fix, t: fix.at };
        track.push({ ...fix, t: fix.at });
      }
      while (track.length && track[0].t < Date.now() - TRACK_MS) track.shift();
      for (const f of [...geo.fns]) f(fix);
      for (const w of [...geo.waiting]) w(fix);
    },
    err => {
      geo.answered = true;
      const error = err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable';
      if (err?.code === 1) {
        nav.geolocation.clearWatch?.(geo.id);
        geo.id = null;
      }
      for (const w of [...geo.waiting]) w({ error });
    },
    // (Fresh fixes only: one the device kept up to 10 s had the dot that far
    // behind, 160 m on a train; Jay 2026-10-30, 「slower than my grandma」.)
    { enableHighAccuracy: true, maximumAge: 0 }
  );
}
// Back in the app and the watch silent (an iPhone can leave one stopped after the background): started again.
globalThis.document?.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || geo.id == null) return;
  const back = Date.now();
  setTimeout(() => {
    if (geo.id == null || !restartable() || (geo.last && geo.last.t >= back) || document.visibilityState !== 'visible') return;
    globalThis.navigator?.geolocation?.clearWatch?.(geo.id);
    geo.id = null;
    watchDevice(globalThis.navigator);
  }, 15_000);
});
// Where the device is: a fix no older than `maximumAge`, else the watch's next (within `timeout`).
// `kick` (a tap on 我的位置): the watch started again, as a phone standing still (or an iPhone's
// watch gone silent) sends nothing new until it moves, and a new watch answers at once.
export function getPosition({ timeout = 8000, maximumAge = 60_000, kick = false } = {}, nav = globalThis.navigator) {
  if (!nav?.geolocation) return Promise.resolve({ error: 'unsupported' });
  if (geo.last && Date.now() - geo.last.t <= maximumAge) return Promise.resolve({ ...geo.last.fix });
  if (kick && geo.id != null && restartable()) {
    nav.geolocation.clearWatch?.(geo.id);
    geo.id = null;
  }
  watchDevice(nav);
  return new Promise(resolve => {
    const done = x => {
      geo.waiting.delete(done);
      clearTimeout(timer);
      resolve(x);
    };
    const timer = setTimeout(() => done({ error: 'timeout' }), timeout);
    geo.waiting.add(done);
  });
}
// Follows the device: fn({ lat, lon, acc, heading }) at each fix, until the function returned is called.
export function watchPosition(fn, nav = globalThis.navigator) {
  if (!nav?.geolocation?.watchPosition) return () => {};
  watchDevice(nav);
  geo.fns.add(fn);
  return () => geo.fns.delete(fn);
}

// What went wrong, said plainly: the network here, the data source there, or busy.
export const errorText = err =>
  err?.code === 'STOPPED'
    ? W(`這段路的車今日停駛或路上沒車：${err.said}`, `Not running today (or none on the road): ${err.said}`)
    : err?.code === 'OFFLINE'
    ? W('沒有網路連線，連上後會自動更新。', 'Offline. It updates once you’re back.')
    : err?.code === 'TDX_BUSY' || err?.status === 429
      ? W('查詢的人有點多，稍後自動再試。', 'Busy right now. Retrying shortly.')
      : err?.code === 'TDX_NO_KEY'
        ? W('交通資料尚未開通。', 'Transit data isn’t set up yet.')
        : err?.code === 'SIGNED_OUT'
          ? W('請先登入 Orbit Pass。', 'Sign in to Orbit Pass first.')
          : err?.code === 'TIMEOUT'
            ? W('回應太慢，稍後自動再試。', 'Slow to answer. Retrying shortly.')
            : err?.code === 'TDX_FAILED' || err?.status >= 500
              ? W('交通資料暫時沒有回應，稍後自動再試。', 'Transit data isn’t answering. Retrying shortly.')
              : W('暫時無法取得資料，稍後自動再試。', 'Can’t get data right now. Retrying shortly.');

// ---- Walks ---------------------------------------------------------------------------------------
// One walk wherever it's shown (the strip of nearest stations, a card's 距離
// and 走過去, a trip's walks): Google's streets (the proxy's /transit/walk:
// the lanes and short cuts OpenStreetMap's router misses; free under the
// month's cap, each walk kept there a month), OpenStreetMap's router past
// it. Its time at our pace (WALK_M_MIN), for every one alike. Kept on the
// phone, the newest 400 (without their lines): a reopen has them at once.
// One Google didn't answer (`g` unset: its cap, an outage) is OpenStreetMap's
// alone, asked again after WALK_RETRY_MS: kept for good, 11-07's 460 m round
// the school stood for days over Google's 267 by the lane to 成功國中 (Jay
// 2026-11-09). (Those kept before `g` count as not answered: asked once more.)
//   → [{ dist, sec, poly?, g?, at? } | null]
const WALKS_KEY = 'orbit-transit.walks';
const walksRead = readSaved(WALKS_KEY, []);
const walksKept = new Map(Array.isArray(walksRead) ? walksRead.filter(Array.isArray) : []);
let walksSave = 0;
const keepWalks = () => {
  if (walksRead === UNREAD) return; // (never saved over)
  clearTimeout(walksSave);
  walksSave = setTimeout(() => {
    writeJson(WALKS_KEY, [...walksKept].slice(-400).map(([k, w]) => [k, { dist: w.dist, sec: w.sec, ...(w.g ? { g: 1 } : { at: w.at || 0 }) }]));
  }, 1000);
};
const p5 = p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
const walkKey = (a, b) => `${p5(a)}|${p5(b)}`;
const paced = (dist, extra = {}) => ({ dist, sec: Math.round((dist / WALK_M_MIN) * 60), ...extra });
export const WALK_RETRY_MS = 6 * 3600_000;
// (Kept and settled: Google's answer in it, or OpenStreetMap's asked again too soon.)
const settled = (w, now = Date.now()) => Boolean(w && (w.g || now - (w.at || 0) < WALK_RETRY_MS));
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
// (A walk already being asked is waited for, not asked again: a trip asks
// for the walks to its YouBike stations as it starts, and again to rank.)
const walking = new Map(); // walkKey → the ask it's in (walks without their lines)
export async function walksTo(from, tos, { line = false } = {}) {
  const have = t => settled(walksKept.get(walkKey(from, t))) && (!line || walksKept.get(walkKey(from, t)).poly);
  const waits = new Set(line ? [] : tos.map(t => !have(t) && walking.get(walkKey(from, t))).filter(Boolean));
  const need = tos.map((t, i) => (have(t) || (!line && walking.has(walkKey(from, t))) ? -1 : i)).filter(i => i >= 0);
  if (need.length) {
    const job = askWalks(from, tos, need, line);
    if (!line) {
      const keys = need.map(i => walkKey(from, tos[i]));
      for (const k of keys) walking.set(k, job);
      job.finally(() => keys.forEach(k => walking.get(k) === job && walking.delete(k))).catch(() => {});
    }
    waits.add(job);
  }
  await Promise.all(waits);
  return tos.map(t => walksKept.get(walkKey(from, t)) || null);
}
async function askWalks(from, tos, need, line) {
  const [asked, osm] = await Promise.all([get(`/transit/walk?from=${p5(from)}&to=${need.map(i => p5(tos[i])).join(';')}${line ? '&line=1' : ''}`).catch(() => null), osmWalks(from, need.map(i => tos[i]))]);
  await Promise.all(
    need.map(async (i, k) => {
      const g = asked?.walks?.[k];
      const o = osm[k];
      const key = walkKey(from, tos[i]);
      // (Google answered: settled. Else OpenStreetMap's for now, Google asked again later.)
      const mark = g ? { g: 1 } : { at: Date.now() };
      // Google's, unless OpenStreetMap's is shorter (or Google's isn't there: past its cap).
      if (g && (o == null || g.dist <= o)) return walksKept.set(key, paced(g.dist, { ...(g.poly ? { poly: g.poly } : {}), ...mark }));
      // (Its line, when one's wanted: OpenStreetMap's route.)
      const r = line || o == null ? await roadPath('walk', from, tos[i]) : null;
      const dist = o ?? r?.dist;
      // (Neither answering again: the one kept stays, asked again later.)
      if (dist != null) walksKept.set(key, paced(dist, { ...(r?.poly ? { poly: r.poly } : {}), ...mark }));
      else if (walksKept.has(key)) walksKept.get(key).at = Date.now();
    })
  );
  keepWalks();
}
export const walkTo = (from, to, opts) => walksTo(from, [to], opts).then(r => r[0]);

// ---- YouBike rides by the roads ------------------------------------------------------------------
// The metres a YouBike rides between stations (and from a station to a
// trip's end), by OpenStreetMap's bike router: one table ask, the stations
// near a trip's start to those near its end. The station to leave a bike at
// is chosen on these, never on the straight line (Jay 2026-11-07: from 竹北's
// 博愛街 to 成功九街 the straight line made 新竹縣體育場, 400 m from the door,
// look quicker than 綠41公園, 250 m; by the roads they ride the same).
// Kept on the phone, the newest 400. → nothing; rideKnown(a, b) → metres or null.
const RIDES_KEY = 'orbit-transit.rides';
const ridesRead = readSaved(RIDES_KEY, []);
const ridesKept = new Map(Array.isArray(ridesRead) ? ridesRead.filter(Array.isArray) : []);
let ridesSave = 0;
export const rideKnown = (a, b) => ridesKept.get(walkKey(a, b)) ?? null;
const riding = new Map(); // a table's key → its ask
export function bikeRides(froms, tos) {
  const need = froms.filter(a => tos.some(b => ridesKept.get(walkKey(a, b)) == null));
  if (!need.length || !tos.length) return Promise.resolve();
  const k = `${need.map(p5).join(';')}>${tos.map(p5).join(';')}`;
  if (riding.has(k)) return riding.get(k);
  const pts = [...need, ...tos].map(p => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const src = need.map((_, i) => i).join(';');
  const dst = tos.map((_, i) => need.length + i).join(';');
  const job = fetch(`${OSRM.bike}/table/v1/driving/${pts}?sources=${src}&destinations=${dst}&annotations=distance`, { signal: AbortSignal.timeout?.(8000) })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      // (Each end's metres to the nearest road, which the table leaves out, added.)
      const snap = x => Number(x?.distance) || 0;
      need.forEach((a, i) =>
        tos.forEach((b, n) => {
          const d = j?.distances?.[i]?.[n];
          if (d != null) ridesKept.set(walkKey(a, b), Math.round(d + snap(j.sources?.[i]) + snap(j.destinations?.[n])));
        })
      );
      if (ridesRead === UNREAD) return;
      clearTimeout(ridesSave);
      ridesSave = setTimeout(() => writeJson(RIDES_KEY, [...ridesKept].slice(-400)), 1000);
    })
    .catch(() => {})
    .finally(() => riding.delete(k));
  riding.set(k, job);
  return job;
}

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
