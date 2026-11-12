// A trip played as a phone's GPS would report it (Jay 2026-11-12: navigation
// is fragile because real fixes are rough, jump and come late or not at all).
// Pure: the tests drive navigation with it (tests/nav-gps.test.mjs) and the
// kit's 測試工具 plays it into the page (testing.mjs 模擬行程).
//
//   truthPath(plan, { scenario, k, more }) → where the person really is, a
//     sample a second: [{ t, lat, lon, k, phase }] (phase 'before' waiting
//     or walking up to step k, 'on' riding it, 'off' past what the plan said).
//   gpsFeed(truth, profile, seed) → what the phone hands over:
//     [{ got, lat, lon, acc, at }] (got: when the app hears it; at: the
//     device's own stamp, earlier than `got` for a fix kept and handed over late).
//
// Scenarios (on the first ride, or ride `k`):
//   plan     as planned
//   late     the ride leaves `delay` minutes late (default 6), you wait for it
//   miss     at the stop 3 minutes after it left; you then wait for the next (10 min later)
//   over     stayed on past your stop (a train: to the next station; a bus: two stops; else 800 m), then walked back
//   early    off a stop early (`before`, else 80% of the way), walked straight to where the next step ends
//   wrong    got on something else at the stop: away at a ride's pace off its way
//   stray    on foot away from everything after the first walk's halfway
import { meters, isRide } from './util.mjs';
import { routeCum } from './navlive.mjs';

const SPEED = { walk: 1.3, bike: 4.2 };
// Seeded randomness: the same seed, the same trip (a failing case can be replayed).
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.gauss = () => {
    const u = Math.max(1e-9, next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return next;
}
const shift = (p, n, e) => ({ lat: p.lat + n / 110_540, lon: p.lon + e / (111_320 * Math.cos((p.lat * Math.PI) / 180)) });
// A point `d` metres along `pts` (cum: routeCum), past the end along the last stretch's line.
function along(pts, cum, d) {
  if (pts.length === 1) return { ...pts[0] };
  let k = 0;
  while (k < pts.length - 2 && cum[k + 1] < d) k++;
  const seg = cum[k + 1] - cum[k] || 1;
  const f = (d - cum[k]) / seg;
  return { lat: pts[k].lat + (pts[k + 1].lat - pts[k].lat) * f, lon: pts[k].lon + (pts[k + 1].lon - pts[k].lon) * f };
}
// (A step's way: navigation's own reading of it when given, else its path, else straight.)
const ptsOf = (l, legPts) => (legPts?.(l) || (Array.isArray(l.path) && l.path.length > 1 ? l.path.map(([lat, lon]) => ({ lat, lon })) : [l.from, l.to])).filter(p => p?.lat != null).map(p => ({ lat: p.lat, lon: p.lon }));

export function truthPath(plan, { scenario = 'plan', k = null, delay = 6, more = null, before = null, legPts = null, start = plan.dep } = {}) {
  const out = [];
  const ride = k ?? plan.legs.findIndex(isRide);
  let t = Math.round(start / 1000) * 1000;
  let at = { ...plan.legs[0].from };
  const put = (p, i, phase) => {
    out.push({ t, lat: p.lat, lon: p.lon, k: i, phase });
    at = p;
  };
  const stay = (until, i, phase) => {
    if (out.length === 0) put(at, i, phase);
    while (t < until) {
      t += 1000;
      put(at, i, phase);
    }
  };
  // Moving along `pts` for `ms` (or at `speed`), sampled each second.
  const move = (pts, i, phase, { ms = null, speed = null, from = 0, to = null } = {}) => {
    const cum = routeCum(pts);
    const end = to ?? cum.at(-1);
    const dur = ms ?? ((end - from) / speed) * 1000;
    const t0 = t;
    if (out.length === 0) put(along(pts, cum, from), i, phase);
    while (t < t0 + dur) {
      t += 1000;
      put(along(pts, cum, from + ((end - from) * Math.min(1, (t - t0) / Math.max(1, dur)))), i, phase);
    }
  };
  for (let i = 0; i < plan.legs.length; i++) {
    const l = plan.legs[i];
    const pts = ptsOf(l, legPts);
    if (!pts.length) continue;
    if (!isRide(l)) {
      if (scenario === 'stray' && i === 0) {
        const cum = routeCum(pts);
        move(pts, i, 'before', { speed: SPEED.walk, to: cum.at(-1) / 2 });
        // (Away at a walk, square to the way, for 6 minutes.)
        const a = pts[0], b = pts.at(-1);
        const dn = b.lat - a.lat, de = b.lon - a.lon;
        const far = { lat: at.lat + de * 3, lon: at.lon - dn * 3 };
        move([at, far], i, 'off', { speed: SPEED.walk, ms: 6 * 60_000 });
        return out;
      }
      move(pts, i, 'before', { speed: SPEED[l.mode] || SPEED.walk });
      continue;
    }
    const mine = i === ride;
    let dep = l.dep;
    if (mine && scenario === 'late') dep += delay * 60_000;
    if (mine && scenario === 'miss') {
      // (At the stop 3 minutes after it left: waiting for the next, 10 minutes after it.)
      stay(Math.max(t, l.dep + 3 * 60_000), i, 'before');
      dep = l.dep + 10 * 60_000;
    }
    stay(Math.max(t, dep), i, 'before');
    const dur = Math.max(60_000, l.arr - l.dep);
    if (mine && scenario === 'wrong') {
      // (Something else from the same stop: off the way at its pace, 2 km in 4 minutes.)
      const a = pts[0], b = pts.at(-1);
      const far = shift(a, -(b.lon - a.lon) * 111_320 * 0.6, (b.lat - a.lat) * 110_540 * 0.6);
      const cum = routeCum([a, far]);
      const toward = shift(a, (far.lat - a.lat) * 110_540 * (2000 / cum[1]), (far.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180) * (2000 / cum[1]));
      move([a, toward], i, 'off', { ms: 4 * 60_000 });
      stay(t + 8 * 60_000, i, 'off');
      return out;
    }
    if (mine && scenario === 'early') {
      // (At the stop before yours when it's known, `before`; else four fifths of the way.)
      const cum = routeCum(pts);
      let f = 0.8;
      if (before?.lat != null) {
        let bestD = Infinity;
        for (let x = 0; x <= 200; x++) {
          const q = along(pts, cum, (cum.at(-1) * x) / 200);
          const dd = meters(q.lat, q.lon, before.lat, before.lon);
          if (dd < bestD) [bestD, f] = [dd, x / 200];
        }
      }
      move(pts, i, 'on', { ms: dur * f, to: cum.at(-1) * f });
      stay(t + 30_000, i, 'off');
      // (Walked straight to where the next step ends.)
      const goal = plan.legs[i + 1]?.to || l.to;
      move([at, goal], i, 'off', { speed: SPEED.walk });
      // (There, when that was the last step: the trip done.)
      if (i + 1 >= plan.legs.length - 1) stay(t + 10 * 60_000, plan.legs.length, 'done');
      else stay(t + 3 * 60_000, i, 'off');
      return out;
    }
    move(pts, i, 'on', { ms: dur });
    if (mine && scenario === 'over') {
      // (On along its way: the route's own stops when known, else on along its last stretch.)
      const prev = pts.length > 1 ? pts.at(-2) : pts[0];
      const beyond = more?.length ? [at, ...more] : [at, { lat: at.lat + (at.lat - prev.lat) * 4, lon: at.lon + (at.lon - prev.lon) * 4 }];
      const cum = routeCum(beyond);
      // (A train: on to the next station, the next stop it makes; a bus, two stops.)
      const dist = more?.length ? cum[Math.min(cum.length - 1, ['tra', 'hsr', 'metro'].includes(l.mode) ? 1 : 2)] : Math.min(cum.at(-1), 800);
      move(beyond, i, 'off', { ms: (dist / Math.max(4, routeCum(pts).at(-1) / (dur / 1000))) * 1000, to: dist });
      stay(t + 40_000, i, 'off');
      move([at, l.to], i, 'off', { speed: SPEED.walk });
    }
  }
  stay(t + 10 * 60_000, plan.legs.length, 'done');
  return out;
}

// How a phone reports where it is. Each a set of rates; `phone` is an iPhone
// in a hand on a normal day, the others worse.
//   every      seconds between fixes [lo, hi] (on foot / riding)
//   acc        reported accuracy, metres [lo, hi]
//   err        how far off the fix really is, as a share of acc (σ)
//   jump       chance a fix is a jump (off by jumpM metres, accuracy still small: lying)
//   rough      chance a fix is a cell tower's (acc 150–1500)
//   gap        chance per minute of a silence of gapS seconds; after it, the old fix handed over first (stale)
//   rideRough  riding: chance a fix is rough (in a bus or train the phone sees less sky)
//   tunnel     riding: chance per minute of a tunnel (no fix for 60–240 s, then rough ones)
export const PROFILES = {
  clean: { every: [1, 1], rideEvery: [1, 2], acc: [5, 8], err: 0.3, jump: 0, rough: 0, gap: 0, rideRough: 0, tunnel: 0 },
  phone: { every: [1, 3], rideEvery: [2, 6], acc: [8, 35], err: 0.5, jump: 0.01, jumpM: [60, 180], rough: 0.02, gap: 0.08, gapS: [20, 90], rideRough: 0.15, tunnel: 0 },
  city: { every: [1, 4], rideEvery: [3, 10], acc: [15, 65], err: 0.6, jump: 0.04, jumpM: [80, 300], rough: 0.05, gap: 0.12, gapS: [30, 120], rideRough: 0.3, tunnel: 0 },
  background: { every: [2, 6], rideEvery: [5, 20], acc: [10, 50], err: 0.5, jump: 0.02, jumpM: [80, 250], rough: 0.05, gap: 0.3, gapS: [90, 360], rideRough: 0.3, tunnel: 0 },
  train: { every: [1, 4], rideEvery: [8, 30], acc: [10, 60], err: 0.5, jump: 0.02, jumpM: [100, 400], rough: 0.03, gap: 0.1, gapS: [30, 120], rideRough: 0.45, tunnel: 0.15 }
};
export function gpsFeed(truth, profile = 'phone', seed = 1) {
  const P = typeof profile === 'string' ? PROFILES[profile] : profile;
  const r = rng(seed);
  const out = [];
  if (!truth.length) return out;
  const byT = new Map(truth.map(s => [s.t, s]));
  const t0 = truth[0].t;
  const tEnd = truth.at(-1).t;
  let t = t0;
  let silentTill = 0;
  let roughTill = 0;
  let lastDelivered = null;
  let lastMinute = -1;
  while (t <= tEnd) {
    const s = byT.get(t) || truth.find(x => x.t >= t);
    if (!s) break;
    const riding = s.phase === 'on' || (s.phase === 'off' && truth.some(x => x.t > t - 30_000 && x.t <= t && x.phase === 'on'));
    // Each new minute: maybe a silence (the screen off, iOS throttling), maybe a tunnel.
    const minute = Math.floor((t - t0) / 60_000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      if (t >= silentTill && P.gap && r() < P.gap) {
        silentTill = t + r.range(...P.gapS) * 1000;
        // (Back from it: the device hands over the last fix it had first, stamped then.)
        if (lastDelivered) out.push({ ...lastDelivered, got: silentTill, stale: true });
      } else if (riding && t >= silentTill && P.tunnel && r() < P.tunnel) {
        silentTill = t + r.range(60, 240) * 1000;
        roughTill = silentTill + 30_000;
      }
    }
    if (t >= silentTill) {
      let acc = r.range(...P.acc);
      let errM = acc * P.err;
      let p = s;
      const rough = (t < roughTill && riding) || r() < (riding ? P.rideRough : 0) + P.rough;
      if (rough) {
        acc = r.range(150, 1500);
        errM = acc * 0.5;
      } else if (P.jump && r() < P.jump) errM = r.range(...P.jumpM) / 2;
      p = shift(s, r.gauss() * errM, r.gauss() * errM);
      const fix = { got: t, at: t, lat: p.lat, lon: p.lon, acc: Math.round(acc) };
      out.push(fix);
      lastDelivered = fix;
    }
    const [lo, hi] = riding ? P.rideEvery : P.every;
    t += Math.max(1, Math.round(r.range(lo, hi))) * 1000;
  }
  return out.sort((a, b) => a.got - b.got);
}
// The true state at a time (for checks): the last sample at or before it.
export function truthAt(truth, t) {
  let best = truth[0];
  for (const s of truth) {
    if (s.t > t) break;
    best = s;
  }
  return best;
}
export const metersOff = (fix, s) => meters(fix.lat, fix.lon, s.lat, s.lon);
