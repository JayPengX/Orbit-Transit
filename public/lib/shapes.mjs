// A ride drawn along its line (the owner, 2026-10-11: buses, trains and the
// metro were straight lines on the map): TDX's shapes, from Shared-Data's
// weekly packs (shape/rail.json: 台鐵, 高鐵 and every metro; shape/bus/<City>
// and the 公路客運's squares), kept on the phone a week.
//
// A line comes in pieces (TDX cuts 台鐵's into dozens; a branch is a piece of
// its own; a ride can run from one line onto the next, 宜蘭線 into 北迴線), so
// a ride's way is found on the pieces as a network: each piece's ends joined
// to the nearest point of any other piece within JOIN metres, where you get
// on and off each put on the nearest piece (within REACH), and the shortest
// way between them taken. Null when there's no such way (a pack not built,
// a stop off every line): the map draws through the stops, as before.

import * as kit from '#kit/quadra.mjs';
import { decodeLine } from './util.mjs';
import { squareOf } from './packs.mjs';

// A shape pack ('rail', 'bus/Hsinchu'), as every app reads the family's data (the kit's packJson). null: none.
const shapePack = name => kit.packJson(`shape/${name}.json`, { ttl: 6 * 86_400_000 }).catch(() => null);

// ---- The way along the pieces --------------------------------------------------------------

const KX = 101_000;
const KY = 111_000;
const dist = (a, b) => Math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * KX);
// The nearest point on segment a–b to p: [point, t, metres].
function onSegment(p, a, b) {
  const [ax, ay, bx, by, px, py] = [a[1] * KX, a[0] * KY, b[1] * KX, b[0] * KY, p[1] * KX, p[0] * KY];
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return [q, t, dist(p, q)];
}
const JOIN = 150;
const REACH = 400;
const graphs = new WeakMap();
// The pieces as a graph: { pts: [[lat, lon]…], adj: [[[node, metres]…]…], seg: [[i, j]…] }.
function graphOf(lines) {
  const hit = graphs.get(lines);
  if (hit) return hit;
  const pts = [];
  const adj = [];
  const seg = [];
  const pieceOf = [];
  const ends = [];
  const add = (a, b, w) => {
    adj[a].push([b, w]);
    adj[b].push([a, w]);
  };
  for (const [piece, line] of lines.entries()) {
    const base = pts.length;
    for (const p of line) {
      pts.push(p);
      adj.push([]);
    }
    for (let k = 1; k < line.length; k++) {
      add(base + k - 1, base + k, dist(line[k - 1], line[k]));
      seg.push([base + k - 1, base + k]);
      pieceOf.push(piece);
    }
    ends.push([base, base, base + line.length - 1], [base + line.length - 1, base, base + line.length - 1]);
  }
  // Each end joined to the nearest point of another piece (its nearer vertex).
  for (const [e, first, last] of ends) {
    let best = null;
    for (const [i, j] of seg) {
      if (i >= first && j <= last) continue;
      const [, t, d] = onSegment(pts[e], pts[i], pts[j]);
      if (d <= JOIN && (!best || d < best.d)) best = { d, n: t < 0.5 ? i : j };
    }
    if (best) add(e, best.n, dist(pts[e], pts[best.n]));
  }
  const g = { pts, adj, seg, pieceOf };
  graphs.set(lines, g);
  return g;
}
// The way from a to b along the pieces ([[lat, lon]…]), or null. Each end
// is tried on its nearest point of each piece within reach (two tracks side
// by side are two pieces joined only at their far ends: one end on each made
// a way round by the far end), the shortest way of all kept.
export function wayAlong(lines, a, b, { reach = REACH } = {}) {
  if (!lines?.length || !a || !b) return null;
  const g = graphOf(lines);
  const snaps = p => {
    const best = new Map();
    for (const [k, [i, j]] of g.seg.entries()) {
      const [q, t, d] = onSegment(p, g.pts[i], g.pts[j]);
      const piece = g.pieceOf[k];
      if (d <= reach && (!best.has(piece) || d < best.get(piece).d)) best.set(piece, { q, t, d, i, j, k });
    }
    return [...best.values()].sort((x, y) => x.d - y.d).slice(0, 3);
  };
  const as = snaps(a);
  const bs = snaps(b);
  if (!as.length || !bs.length) return null;
  const straight = dist(a, b);
  let found = null;
  for (const sa of as) {
    // On one segment: straight along it.
    const same = bs.find(sb => sb.k === sa.k);
    if (same) {
      const w = [sa.q, same.q];
      if (!found || found.cost > dist(sa.q, same.q) + sa.d + same.d) found = { w, cost: dist(sa.q, same.q) + sa.d + same.d };
      continue;
    }
    const [far, from] = dijkstra(g, sa);
    for (const sb of bs)
      for (const [end, tail] of [[sb.i, dist(sb.q, g.pts[sb.i])], [sb.j, dist(sb.q, g.pts[sb.j])]]) {
        if (!Number.isFinite(far[end])) continue;
        const cost = far[end] + tail + sa.d + sb.d;
        if (found && found.cost <= cost) continue;
        // A way far longer than the ride straight (round by a far end, a wrong turn at a junction): not taken.
        if (far[end] + tail > 3 * straight + 2_000) continue;
        const way = [];
        for (let u = end; u >= 0; u = from[u]) way.push(g.pts[u]);
        found = { w: [sa.q, ...way.reverse(), sb.q], cost };
      }
  }
  return found ? found.w : null;
}
// Distances from a point on a segment to every node: [far, from].
function dijkstra(g, s) {
  const n = g.pts.length;
  const far = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const heap = [];
  const push = (node, d) => {
    heap.push([d, node]);
    for (let k = heap.length - 1; k > 0; ) {
      const up = (k - 1) >> 1;
      if (heap[up][0] <= heap[k][0]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const [l, r] = [2 * k + 1, 2 * k + 2];
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (const v of [s.i, s.j]) {
    far[v] = dist(s.q, g.pts[v]);
    push(v, far[v]);
  }
  while (heap.length) {
    const [d, u] = pop();
    if (d > far[u]) continue;
    for (const [v, w] of g.adj[u])
      if (d + w < far[v]) {
        far[v] = d + w;
        from[v] = u;
        push(v, far[v]);
      }
  }
  return [far, from];
}

// ---- A ride's way ---------------------------------------------------------------------------

// 台鐵, 高鐵 or the metro: each line's pieces on their own first (lines
// cross mid-line, 台北車站 on both 淡水信義線 and 板南線, and are joined only at
// pieces' ends), the shortest way any one line gives; else the system's
// pieces together (a train running from one line onto the next). A piece
// that closes on itself is left out (TDX draws rings at some stations).
const SYS = { tra: 'tra', hsr: 'hsr', metro: 'metro' };
const railLines = new WeakMap();
const lengthOf = w => w.reduce((s, p, k) => (k ? s + dist(w[k - 1], p) : s), 0);
export function railGroups(pack, sys) {
  let by = railLines.get(pack);
  if (!by) railLines.set(pack, (by = {}));
  if (!by[sys]) {
    const groups = new Map();
    for (const x of pack.lines.filter(y => y.sys === sys)) {
      const pts = decodeLine(x.line);
      if (pts.length < 2 || (dist(pts[0], pts.at(-1)) < 30 && lengthOf(pts) > 200)) continue;
      const k = `${x.op}:${x.id}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(pts);
    }
    by[sys] = { lines: [...groups.values()], all: [...groups.values()].flat() };
  }
  return by[sys];
}
export function railWayIn(groups, a, b) {
  let best = null;
  for (const g of groups.lines) {
    const w = wayAlong(g, a, b);
    if (w && (!best || lengthOf(w) < lengthOf(best))) best = w;
  }
  return best || wayAlong(groups.all, a, b);
}
export async function railWay(l) {
  const sys = SYS[l?.mode];
  if (!sys || l.from?.lat == null || l.to?.lat == null) return null;
  const pack = await shapePack('rail');
  if (!pack?.lines) return null;
  return railWayIn(railGroups(pack, sys), [l.from.lat, l.from.lon], [l.to.lat, l.to.lon]);
}
// A train by its own stops ([[lat, lon]…] from where you get on to where
// you get off: the day's timetable), each hop along the track where TDX's
// shape has it, straight between those two stations where it doesn't (TDX's
// 西部幹線 has gaps of kilometres around 台中): the whole ride never one
// straight line, never wrong where the shape is thin.
export async function railWayByStops(mode, stops) {
  const sys = SYS[mode];
  if (!sys || !(stops?.length > 1)) return null;
  const pack = await shapePack('rail');
  const groups = pack?.lines ? railGroups(pack, sys) : null;
  const way = [stops[0]];
  for (let k = 1; k < stops.length; k++) {
    const hop = groups ? railWayIn(groups, stops[k - 1], stops[k]) : null;
    way.push(...(hop ? hop.slice(1) : [stops[k]]));
  }
  return way;
}
// A bus: its route's own pieces that way (`route`: { uid, dir, city }).
export async function busWay(l, route) {
  if (!route?.uid || l.from?.lat == null || l.to?.lat == null) return null;
  const city = route.city || '';
  const name = city === 'InterCity' || !city ? `bus/InterCity/${squareOf(l.from.lat, l.from.lon)}` : `bus/${city}`;
  const pack = await shapePack(name);
  const parts = pack?.shapes?.[`${route.uid}|${Number(route.dir) || 0}`];
  if (!parts?.length) return null;
  return wayAlong(
    parts.map(([, enc]) => decodeLine(enc)),
    [l.from.lat, l.from.lon],
    [l.to.lat, l.to.lon],
    { reach: 250 }
  );
}
