// Navigation driven as the phone drives it, in Node: the clock, the
// position watch, the timers and the page are stand-ins (only for
// nav-drive.test.mjs, which runs in a process of its own).
let NOW = Date.parse('2026-10-19T08:00:00+08:00');
Date.now = () => NOW;
export const clock = { get: () => NOW, set: t => (NOW = t), add: ms => (NOW += ms) };
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
export const ls = store;
let watcher = null;
export const log = [];
Object.defineProperty(globalThis, 'navigator', {
  value: {
    geolocation: { watchPosition: cb => ((watcher = cb), 1), clearWatch: () => {}, getCurrentPosition: (ok, err) => err({ code: 3 }) },
    vibrate: () => (log.push(['buzz', NOW]), true),
    language: 'zh-TW',
    languages: ['zh-TW']
  },
  configurable: true,
  writable: true
});
globalThis.fetch = async () => {
  throw new Error('offline');
};
const classes = { contains: () => false, add() {}, remove() {}, toggle() {} };
const intervals = [];
const timeouts = [];
globalThis.setInterval = (f, ms) => intervals.push({ f, ms, on: true });
globalThis.clearInterval = id => intervals[id - 1] && (intervals[id - 1].on = false);
globalThis.setTimeout = (f, ms) => timeouts.push({ f, at: NOW + (ms || 0), on: true });
globalThis.clearTimeout = id => timeouts[id - 1] && (timeouts[id - 1].on = false);
function fakeEl() {
  const el = { innerHTML: '', hidden: false, className: '', offsetHeight: 100, classList: classes, querySelectorAll: () => [], _kids: {} };
  el.querySelector = function (s) {
    return s === ':scope > .ot-nav-bottom' && !this._b ? null : (this._kids[s] ||= fakeEl());
  };
  return new Proxy(el, {
    set(t, k, v) {
      if (k === 'innerHTML' && /ot-nav-bottom/.test(v)) t._b = true;
      t[k] = v;
      return true;
    }
  });
}
export const box = fakeEl();
// A fix (accuracy in metres).
export const pos = (p, acc = 10) => watcher?.({ coords: { latitude: p.lat, longitude: p.lon, accuracy: acc, heading: null } });
// The second-by-second timers and the timeouts due, for `ms`.
export function tick(ms = 1000) {
  const end = NOW + ms;
  while (NOW < end) {
    NOW += 1000;
    for (const iv of intervals) if (iv.on && iv.ms === 1000) iv.f();
    for (const t of timeouts) if (t.on && t.at <= NOW) (t.on = false), t.f();
  }
}
// Metres north and east of a point.
export const off = (p, n, e) => ({ lat: p.lat + n / 110_540, lon: p.lon + e / (111_320 * Math.cos((p.lat * Math.PI) / 180)) });
export const T = (h, m = 0) => Date.parse(`2026-10-19T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`);
const nav = await import('../public/lib/nav.mjs');
export const rental = await import('../public/lib/rental.mjs');
export const { tripAt } = nav;
// (The page once the app's modules are in: the kit draws nothing at import here.)
globalThis.document = { documentElement: { classList: classes, lang: 'zh-TW', style: {}, dataset: {} }, visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, body: { classList: classes }, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl() };
// Navigation started afresh (the last one stopped, nothing kept).
export function start(plan, opts = {}) {
  nav.stopNav();
  rental.endRental();
  store.clear();
  log.length = 0;
  const ends = [];
  const acts = [];
  const st = nav.startNav(plan, { box, mini: fakeEl(), draw() {}, follow() {}, onEnd: x => ends.push(x), onAction: (a, i) => acts.push([a, i]), ...opts });
  return { st, ends, acts };
}
const O = { name: 'Home', lat: 24.8, lon: 120.97 };
const L = s => ({ name: s.name, lat: s.lat, lon: s.lon });
// A walk to a bus along a straight road east (stops every 400 m), off at `offAt`, a walk to the place.
export function busTrip({ walk1 = 300, stops = 8, on = 1, offAt = 5, walk2E = 0, walk2N = 150, depMin = 10 } = {}) {
  const S0 = off(O, 0, walk1);
  const st = Array.from({ length: stops }, (_, k) => ({ uid: 's' + k, name: '站' + k, ...off(S0, 0, (k - on) * 400) }));
  const D = { name: 'Dest', ...off(st[offAt], walk2N, walk2E) };
  const t0 = T(8);
  const legs = [
    { mode: 'walk', from: O, to: L(st[on]), dep: t0, arr: t0 + 4 * 60e3, dur: 240 },
    { mode: 'bus', name: '5608', short: '5608', from: L(st[on]), to: L(st[offAt]), dep: t0 + depMin * 60e3, arr: t0 + (depMin + 8) * 60e3, dur: 480, path: st.slice(on, offAt + 1).map(s => [s.lat, s.lon]) },
    { mode: 'walk', from: L(st[offAt]), to: D, dep: t0 + (depMin + 8) * 60e3, arr: t0 + (depMin + 11) * 60e3, dur: 180 }
  ];
  return { plan: { legs, dep: t0, arr: legs[2].arr, dest: { name: 'Dest', lat: D.lat, lon: D.lon } }, st, O, rs: { stops: st, i: on, j: offAt } };
}
export const show = st => ({ i: st.i, phase: st.phase, reached: st.reached });
