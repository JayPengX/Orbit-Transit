// Where the bus or train is, for navigation: coming to your stop (how many
// stops away, which it's at now), and once you're on it, the stops still to
// go and when it's at each. Worked out from what TDX already says: a route's
// estimates at every stop (a bus), the trains' live board and the day's
// timetable (a train). No positions of vehicles needed.

import { meters } from './util.mjs';

// The bus coming to stop i, from the route's estimates at its stops (StopUID
// → { sec, status }): walking back from yours, the estimates fall towards
// the bus; the first stop where they rise again (the bus after it) is
// behind it. → { k (the stop it comes to next), away (stops from yours),
// sec (to yours), in (to stop k), far (further back than we look) } or null.
export function busWhere(stops, i, eta, max = 12) {
  const v = eta?.get(stops[i]?.uid);
  if (!v || v.status !== 0 || v.sec == null) return null;
  let k = i;
  let cur = v.sec;
  for (let j = i - 1; j >= 0; j--) {
    const x = eta.get(stops[j].uid);
    if (!x || x.status !== 0 || x.sec == null || x.sec > cur + 20) break;
    cur = x.sec;
    k = j;
    if (i - k >= max) return { k, away: i - k, sec: v.sec, in: cur, far: true };
  }
  return { k, away: i - k, sec: v.sec, in: cur, far: false };
}

// The train coming to stop i, from its row on the live board ({ st, status:
// 0 arriving, 1 at the station, 2 left it }). → { k, away, at (standing at
// stop k), far } or null (not on the board yet, or gone past you).
export function trainWhere(stops, i, live) {
  if (!live) return null;
  const at = stops.findIndex(s => s.id === live.st);
  if (at < 0 || at > i) return null;
  const k = live.status === 2 ? at + 1 : at;
  if (k > i) return null;
  return { k, away: i - k, at: live.status === 1, far: false };
}

// On board: the stop you're coming to next, between the one you got on at
// (i) and yours (j), from where you are: the nearest, or the one after it
// once you're past it (or stopped at it).
export function nextStop(stops, i, j, pos) {
  if (!pos) return i + 1 <= j ? i + 1 : j;
  const d = s => meters(pos.lat, pos.lon, s.lat, s.lon);
  let h = i;
  for (let k = i; k <= j; k++) if (d(stops[k]) < d(stops[h])) h = k;
  if (h < j && (d(stops[h]) < 40 || d(stops[h + 1]) < meters(stops[h].lat, stops[h].lon, stops[h + 1].lat, stops[h + 1].lon))) h++;
  return Math.max(h, Math.min(i + 1, j));
}

// When the bus you're on is at each stop ahead, from the estimates: only
// while they rise stop by stop (a fall is the bus after yours).
export function busAhead(stops, from, j, eta, now = Date.now()) {
  const out = new Map();
  let last = -1;
  for (let k = from; k <= j; k++) {
    const x = eta?.get(stops[k].uid);
    if (!x || x.status !== 0 || x.sec == null || x.sec + 20 < last) break;
    last = x.sec;
    out.set(k, now + x.sec * 1000);
  }
  return out;
}

// The stop of a list nearest a point (from index `after` on), within `max` metres.
export function nearestStop(stops, pt, after = 0, max = 400) {
  let best = -1;
  let bd = max;
  for (let k = after; k < stops.length; k++) {
    const d = meters(pt.lat, pt.lon, stops[k].lat, stops[k].lon);
    if (d < bd) [best, bd] = [k, d];
  }
  return best;
}

// A countdown as it's read off a station's sign: 4:05 under ten minutes, else minutes.
export function countText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${Math.round(s / 60)}`;
}

// A train with no live board (高鐵): where its timetable has it. → as trainWhere.
export function trainByTime(stops, i, now = Date.now()) {
  const k = stops.findIndex(s => (s.dep ?? s.at) > now);
  if (k < 0 || k > i) return null;
  return { k, away: i - k, at: stops[k].at <= now, far: false, planned: true };
}

// A train leg without its number (a planner that gives only the line, as
// TDX's 新竹-六家): the day's train of its kind that leaves a station by
// where you board within 3 minutes of the time given and stops later by
// where you get off; the nearest in time. → { no, type (區間, 自強…), code }, or null.
export function trainFor(trips, stations, l, slack = 3 * 60_000) {
  const near = (pt, m = 800) => new Set(stations.filter(s => s.sys === l.mode && s.lat != null && meters(pt.lat, pt.lon, s.lat, s.lon) < m).map(s => s.key));
  const from = near(l.from);
  const to = near(l.to);
  let best = null;
  for (const t of trips) {
    if (t.sys !== l.mode) continue;
    const a = t.stops.findIndex(s => from.has(s.st));
    if (a < 0 || !t.stops.slice(a + 1).some(s => to.has(s.st))) continue;
    const d = Math.abs(t.stops[a].dep - l.dep);
    if (d <= slack && (!best || d < best.d)) best = { t, d };
  }
  return best ? { no: String(best.t.no), type: best.t.type || '', code: best.t.code ?? '' } : null;
}

// ---- On board, from where the phone has been: the ride's own pace ----
// The phone is on the bus or train, so where it's been seen is where the
// ride has been: how far along its stops it is now, and how fast it has come
// over the last few minutes (stops and lights included), says when it'll be
// at each stop ahead, with nothing from TDX. A second source beside TDX's
// estimates: theirs where they have one (they know the traffic ahead), this
// for every stop they don't (a line's last stop, 高鐵, a gap in the feed).

// Metres from the first stop to each stop, along the line through them.
export function routeCum(stops) {
  const cum = [0];
  for (let k = 1; k < stops.length; k++) cum.push(cum[k - 1] + meters(stops[k - 1].lat, stops[k - 1].lon, stops[k].lat, stops[k].lon));
  return cum;
}
// How far along the stops a point is (metres from the first, on the nearest
// stretch between two stops, from stop `from` on), and how far off that line.
export function alongRoute(stops, pt, cum = routeCum(stops), from = 0) {
  const cos = Math.cos((pt.lat * Math.PI) / 180);
  const xy = s => [(s.lon - pt.lon) * 111_320 * cos, (s.lat - pt.lat) * 110_540];
  let best = null;
  for (let k = Math.max(0, from); k + 1 < stops.length; k++) {
    const [ax, ay] = xy(stops[k]);
    const [bx, by] = xy(stops[k + 1]);
    const [dx, dy] = [bx - ax, by - ay];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (!best || off < best.off) best = { d: cum[k] + t * (cum[k + 1] - cum[k]), off };
  }
  return best;
}
// The pace over the last few minutes of `track` ([{ d, t }], oldest first):
// metres a second, once there's a minute and 100 m of it; a stretch stood
// still counts (it's part of the ride), backwards doesn't (a bad fix).
export function ridePace(track, now = Date.now(), window = 5 * 60_000) {
  const xs = track.filter(x => x.t >= now - window);
  if (xs.length < 2) return null;
  const [a, b] = [xs[0], xs.at(-1)];
  const dt = (b.t - a.t) / 1000;
  const dd = b.d - a.d;
  if (dt < 60 || dd < 100) return null;
  return Math.min(25, Math.max(1.5, dd / dt));
}
// When you'll be at each stop from `from` to `to`, at that pace from `d` (now).
export function aheadByPace(cum, from, to, d, pace, now = Date.now()) {
  const out = new Map();
  if (!pace) return out;
  for (let k = from; k <= to; k++) out.set(k, now + (Math.max(0, cum[k] - d) / pace) * 1000);
  return out;
}
