// The metro as a metro map: each city's lines redrawn the way the
// operators draw them (straight runs at right angles and 45°, the stations
// evenly spaced, an interchange a ring), worked out from TDX's real station
// places, so a new line or station draws itself. `schematic` lays it out
// (no DOM: tested), `mountMap` draws it on a canvas and moves it under a
// finger: the drawing scales, its names and marks stay a size you can read.

import { interchanges, lineRuns } from './metro.mjs';
import { e, meters, shown } from './util.mjs';

const STEP = Math.PI / 4;

// systems (metro.mjs loadSystem's) → { nodes: [{ i, x, y, name, st: [station…],
// lines: [lineKey…], big, end }], lines: [{ key, sys, id, name, color, runs:
// [[node i…]…] }], edges: [[a, b, lineKey]…], box: [x0, y0, x1, y1] }, in units of
// one station gap. `preset`: drawings already worked out ({ sig, pos }, or a list), used when one is of these stations and track.
export function schematic(systems, { rounds = 600, preset = null, seed = 0, fisheye = 0.4, hold = 0 } = {}) {
  const stations = systems.flatMap(s => s.stations);
  const byKey = new Map(stations.map(s => [s.key, s]));
  const groups = interchanges(stations, systems.flatMap(s => s.transfers || []));
  const nodeOf = new Map();
  const nodes = groups.map((g, i) => {
    for (const s of g) nodeOf.set(s.key, i);
    const lat = g.reduce((a, s) => a + s.lat, 0) / g.length;
    const lon = g.reduce((a, s) => a + s.lon, 0) / g.length;
    return { i, lat, lon, name: g[0].name, st: g, lines: [], x: 0, y: 0 };
  });
  // Each line's track, station to station: the operator's routes (else its station order), less an
  // express's jumps (a pair joined some other way within a few stops: 機場捷運's 直達車).
  const lines = [];
  const edges = [];
  for (const l of systems.flatMap(s => s.lines)) {
    const key = `${l.sys}:${l.id}`;
    const seqs = (l.paths?.length ? l.paths : lineRuns(l, byKey).map(r => r.map(s => s.key))).map(p => p.map(k => (typeof k === 'string' ? nodeOf.get(k) : nodeOf.get(k.key))).filter(n => n != null));
    const pairs = new Map();
    for (const p of seqs)
      for (let j = 1; j < p.length; j++) {
        const [a, b] = [p[j - 1], p[j]];
        if (a !== b) pairs.set(a < b ? `${a},${b}` : `${b},${a}`, [Math.min(a, b), Math.max(a, b)]);
      }
    let mine = [...pairs.values()];
    const far = ([a, b]) => meters(nodes[a].lat, nodes[a].lon, nodes[b].lat, nodes[b].lon);
    mine = mine.filter(p => !joined(mine.filter(q => far(q) < far(p)), p[0], p[1]));
    if (!mine.length) continue;
    for (const [a, b] of mine) {
      edges.push([a, b, key]);
      for (const n of [a, b]) if (!nodes[n].lines.includes(key)) nodes[n].lines.push(key);
    }
    lines.push({ key, sys: l.sys, id: l.id, name: l.name, color: l.color, branch: l.branch, runs: chains(mine) });
  }
  const used = nodes.filter(n => n.lines.length);
  if (!used.length) return { nodes: [], lines: [], edges: [], box: [0, 0, 1, 1], sig: '' };
  // What the drawing is of: the same stations and track draw the same, so a kept drawing is used again.
  const sig = hash(nodes.map(n => n.st.map(s => s.key).join('+')).join('|') + edges.map(ed => ed.join()).join('|'));
  // The real places, flattened (metres), scaled so a usual gap is 1.
  const lat0 = used.reduce((a, n) => a + n.lat, 0) / used.length;
  const lon0 = used.reduce((a, n) => a + n.lon, 0) / used.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  // The centre (where the interchanges are) drawn larger, the suburbs nearer, as metro maps do.
  const hubs = used.filter(n => n.lines.length > 1);
  const cLat = hubs.length ? hubs.reduce((a, n) => a + n.lat, 0) / hubs.length : lat0;
  const cLon = hubs.length ? hubs.reduce((a, n) => a + n.lon, 0) / hubs.length : lon0;
  for (const n of nodes) {
    const dx = (n.lon - cLon) * 111_320 * k;
    const dy = -(n.lat - cLat) * 110_540;
    const r = Math.hypot(dx, dy);
    const f = r > 1 ? (r / 1500) ** -fisheye : 1;
    n.gx = dx * f;
    n.gy = dy * f;
  }
  const gaps = edges.map(([a, b]) => Math.hypot(nodes[a].gx - nodes[b].gx, nodes[a].gy - nodes[b].gy)).sort((a, b) => a - b);
  const unit = gaps[Math.floor(gaps.length * 0.3)] || 1;
  for (const n of nodes) {
    n.gx /= unit;
    n.gy /= unit;
    n.x = n.gx;
    n.y = n.gy;
  }
  const kept = [].concat(preset || []).find(p => p?.sig === sig && p.pos?.length === nodes.length);
  if (kept)
    nodes.forEach((n, i) => {
      [n.x, n.y] = kept.pos[i];
    });
  else {
    even(nodes, edges, lines);
    // (A seed nudges every start a little: tried several, the best drawing kept: scripts/metro-maps.mjs.)
    if (seed) {
      let r = seed >>> 0;
      const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.3;
      for (const n of nodes) {
        n.x += rnd();
        n.y += rnd();
      }
    }
    relax(nodes, edges, rounds, hold);
    straighten(nodes, edges);
  }
  // Tidy: the corner of the drawing at 0, whole positions to half a gap.
  const live = nodes.filter(n => n.lines.length);
  const x0 = Math.min(...live.map(n => n.x));
  const y0 = Math.min(...live.map(n => n.y));
  for (const n of nodes) {
    n.x -= x0;
    n.y -= y0;
  }
  for (const n of nodes) {
    n.big = n.st.length > 1 || n.lines.length > 1;
    n.end = edges.filter(([a, b]) => a === n.i || b === n.i).length === 1;
  }
  return { nodes, lines, edges, sig, pos: nodes.map(n => [Math.round(n.x * 1000) / 1000, Math.round(n.y * 1000) / 1000]), box: [0, 0, Math.max(...live.map(n => n.x)), Math.max(...live.map(n => n.y))] };
}
const hash = str => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + str.length.toString(36);
};

// Whether a and b are joined by `pairs` (the shorter gaps) within 10 stops.
function joined(pairs, a, b) {
  const adj = new Map();
  for (const [p, q] of pairs) {
    if ((p === a && q === b) || (p === b && q === a)) continue;
    (adj.get(p) || adj.set(p, []).get(p)).push(q);
    (adj.get(q) || adj.set(q, []).get(q)).push(p);
  }
  let front = [a];
  const seen = new Set([a]);
  for (let d = 0; d < 10 && front.length; d++) {
    const next = [];
    for (const n of front)
      for (const m of adj.get(n) || []) {
        if (m === b) return true;
        if (!seen.has(m)) seen.add(m), next.push(m);
      }
    front = next;
  }
  return false;
}

// A line's pairs as runs to draw: from each end or fork to the next.
function chains(pairs) {
  const adj = new Map();
  for (const [a, b] of pairs) {
    (adj.get(a) || adj.set(a, []).get(a)).push(b);
    (adj.get(b) || adj.set(b, []).get(b)).push(a);
  }
  const done = new Set();
  const id = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const runs = [];
  const walk = (from, to) => {
    const run = [from, to];
    done.add(id(from, to));
    while (adj.get(to).length === 2) {
      const nx = adj.get(to).find(n => !done.has(id(to, n)));
      if (nx == null) break;
      done.add(id(to, nx));
      run.push(nx);
      to = nx;
    }
    return run;
  };
  for (const [n, list] of adj) if (list.length !== 2) for (const m of list) if (!done.has(id(n, m))) runs.push(walk(n, m));
  // A loop (高雄's 環狀輕軌): from anywhere round.
  for (const [a, b] of pairs) if (!done.has(id(a, b))) runs.push(walk(a, b));
  return runs;
}

// A run's stations evenly along its real way (its ends and forks where they
// are), so close stations start in order and in step.
function even(nodes, edges, lines) {
  const deg = new Map();
  for (const [a, b] of edges) for (const n of [a, b]) deg.set(n, (deg.get(n) || 0) + 1);
  for (const r of lines.flatMap(l => l.runs)) {
    if (r.length < 3) continue;
    const pts = r.map(i => nodes[i]);
    const cum = [0];
    for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j].gx - pts[j - 1].gx, pts[j].gy - pts[j - 1].gy));
    const total = cum.at(-1);
    const at = d => {
      let j = 1;
      while (j < cum.length - 1 && cum[j] < d) j++;
      const f = (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
      return [pts[j - 1].gx + (pts[j].gx - pts[j - 1].gx) * f, pts[j - 1].gy + (pts[j].gy - pts[j - 1].gy) * f];
    };
    const moved = [];
    for (let j = 1; j < r.length - 1; j++) if (deg.get(r[j]) === 2 && nodes[r[j]].lines.length === 1) moved.push([pts[j], at((total * j) / (r.length - 1))]);
    for (const [n, [x, y]] of moved) {
      n.x = n.gx = x;
      n.y = n.gy = y;
    }
  }
}

// Bend the real map into a metro map: each gap pulled to one station's
// length at the nearest of the eight directions, a station between two
// pulled onto their straight line, stations kept apart, and (fading) each
// kept near its real place so the city stays recognisable.
function relax(nodes, edges, rounds, hold) {
  const live = nodes.filter(n => n.lines.length);
  const deg = new Map();
  for (const [a, b] of edges) {
    (deg.get(a) || deg.set(a, []).get(a)).push(b);
    (deg.get(b) || deg.set(b, []).get(b)).push(a);
  }
  // Each line's own neighbours at an interchange (美麗島: 紅線 one way, 橘線 the other).
  const through = [];
  const by = new Map();
  for (const [a, b, key] of edges)
    for (const [n, m] of [[a, b], [b, a]]) {
      if (nodes[n].lines.length < 2) continue;
      const id = `${n}|${key}`;
      (by.get(id) || by.set(id, []).get(id)).push(m);
    }
  for (const [id, nb] of by) if (nb.length === 2) through.push([+id.split('|')[0], ...nb]);
  const pair = new Set();
  const uniq = edges.filter(([a, b]) => {
    const id = `${a},${b}`;
    if (pair.has(id)) return false;
    pair.add(id);
    return true;
  });
  for (let r = 0; r < rounds; r++) {
    const t = r / rounds;
    const fx = new Float64Array(nodes.length);
    const fy = new Float64Array(nodes.length);
    // The gaps: one length, the nearest of the eight directions (harder as it goes).
    const snap = Math.min(1, 0.15 + 1.2 * t);
    for (const [a, b] of uniq) {
      const A = nodes[a];
      const B = nodes[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1e-6;
      const ang = Math.atan2(dy, dx);
      const sa = Math.round(ang / STEP) * STEP;
      // (Room for the names at an interchange.)
      const min = A.lines.length > 1 || B.lines.length > 1 ? 1.6 : 1;
      const want = Math.min(Math.max(len, min), Math.max(min, 3 - 1.6 * Math.min(1, t * 1.4)));
      const tx = Math.cos(sa) * want;
      const ty = Math.sin(sa) * want;
      // Length first; the direction as it settles.
      const lx = (dx / len) * want;
      const ly = (dy / len) * want;
      const gx = lx + (tx - lx) * snap - dx;
      const gy = ly + (ty - ly) * snap - dy;
      fx[a] -= gx * 0.5;
      fy[a] -= gy * 0.5;
      fx[b] += gx * 0.5;
      fy[b] += gy * 0.5;
    }
    // A station between two: on their line (straight runs, bends only where they must).
    // A run folded back on itself (a station past the next one) is pulled straight however late.
    for (const n of live) {
      const nb = deg.get(n.i);
      if (nb?.length !== 2) continue;
      const [p, q] = nb.map(j => nodes[j]);
      const ax = p.x - n.x;
      const ay = p.y - n.y;
      const bx = q.x - n.x;
      const by = q.y - n.y;
      const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) || 1e-6) * (Math.hypot(bx, by) || 1e-6));
      const w = cos > -0.1 ? 0.5 : t < 0.75 ? 0.12 : 0;
      fx[n.i] += ((p.x + q.x) / 2 - n.x) * w;
      fy[n.i] += ((p.y + q.y) / 2 - n.y) * w;
    }
    // A line through an interchange goes on through it, bending a little at most:
    // the station drawn toward the line's straight way, its neighbours out to it.
    for (const [c, a, b] of through) {
      const [n, p, q] = [nodes[c], nodes[a], nodes[b]];
      const ax = p.x - n.x;
      const ay = p.y - n.y;
      const bx = q.x - n.x;
      const by2 = q.y - n.y;
      const cos = (ax * bx + ay * by2) / ((Math.hypot(ax, ay) || 1e-6) * (Math.hypot(bx, by2) || 1e-6));
      if (cos < -0.75) continue;
      const w = 0.12;
      const mx = ((p.x + q.x) / 2 - n.x) * w;
      const my = ((p.y + q.y) / 2 - n.y) * w;
      fx[c] += mx;
      fy[c] += my;
      fx[a] -= mx / 2;
      fy[a] -= my / 2;
      fx[b] -= mx / 2;
      fy[b] -= my / 2;
    }
    // Apart: never closer than a gap.
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const A = live[i];
        const B = live[j];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        if (dx > 1.05 || dx < -1.05 || dy > 1.05 || dy < -1.05) continue;
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d >= 1.05) continue;
        const push = ((1.05 - d) / d) * 0.5;
        fx[A.i] -= dx * push;
        fy[A.i] -= dy * push;
        fx[B.i] += dx * push;
        fy[B.i] += dy * push;
      }
    // Off others' track: a line never runs through a station it doesn't stop at.
    for (const n of live)
      for (const [a, b] of uniq) {
        if (a === n.i || b === n.i) continue;
        const A = nodes[a];
        const B = nodes[b];
        if (n.x < Math.min(A.x, B.x) - 0.7 || n.x > Math.max(A.x, B.x) + 0.7 || n.y < Math.min(A.y, B.y) - 0.7 || n.y > Math.max(A.y, B.y) + 0.7) continue;
        const vx = B.x - A.x;
        const vy = B.y - A.y;
        const l2 = vx * vx + vy * vy || 1e-6;
        const s = Math.max(0, Math.min(1, ((n.x - A.x) * vx + (n.y - A.y) * vy) / l2));
        const dx = n.x - (A.x + vx * s);
        const dy = n.y - (A.y + vy * s);
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d >= 0.7) continue;
        const push = ((0.7 - d) / d) * 0.4;
        fx[n.i] += dx * push;
        fy[n.i] += dy * push;
        fx[a] -= dx * push * 0.5;
        fy[a] -= dy * push * 0.5;
        fx[b] -= dx * push * 0.5;
        fy[b] -= dy * push * 0.5;
      }
    // Near home, less and less.
    const home = hold + (t < 0.6 ? 0.06 * (1 - t / 0.6) ** 2 : 0);
    for (const n of live) {
      fx[n.i] += (n.gx - n.x) * home;
      fy[n.i] += (n.gy - n.y) * home;
    }
    const step = 0.9 - 0.4 * t;
    for (const n of live) {
      n.x += fx[n.i] * step;
      n.y += fy[n.i] * step;
    }
  }
}

// The relaxed drawing made exact (Jay 2026-11-10: "so ugly"): every gap at
// one of the eight directions, a straight run's stations evenly spaced, by
// least squares from where relaxing left them: each gap held to its nearest
// direction (hard) and its run's even length (soft), stations a gap apart
// and off others' track (added where a round finds them too near), all kept
// near where they were. A drawing already exact comes out the same.
export function straighten(nodes, edges, rounds = 4) {
  const live = nodes.filter(n => n.lines.length);
  const idx = new Map(live.map((n, i) => [n.i, i]));
  const N = live.length;
  if (!N) return;
  const uniq = [];
  const seen = new Set();
  for (const [a, b] of edges) {
    const id = a < b ? `${a},${b}` : `${b},${a}`;
    if (!seen.has(id)) seen.add(id), uniq.push([a, b]);
  }
  const adj = new Map();
  for (const [a, b] of uniq) {
    (adj.get(a) || adj.set(a, []).get(a)).push(b);
    (adj.get(b) || adj.set(b, []).get(b)).push(a);
  }
  // The runs between interchanges, forks and ends.
  const anchor = n => (adj.get(n.i)?.length || 0) !== 2 || n.lines.length > 1 || n.st.length > 1;
  const eid = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const done = new Set();
  const runs = [];
  const walk = (from, to) => {
    const run = [from, to];
    done.add(eid(from, to));
    let cur = to;
    while (!anchor(nodes[cur])) {
      const nx = adj.get(cur).find(q => !done.has(eid(cur, q)));
      if (nx == null) break;
      done.add(eid(cur, nx));
      run.push(nx);
      cur = nx;
    }
    return run;
  };
  for (const n of live) if (anchor(n)) for (const m of adj.get(n.i) || []) if (!done.has(eid(n.i, m))) runs.push(walk(n.i, m));
  for (const [a, b] of uniq) if (!done.has(eid(a, b))) runs.push(walk(a, b));
  const home = live.map(n => [n.x, n.y]);
  const apart = [];
  for (let round = 0; round < rounds; round++) {
    // Each gap's direction: the nearest of the eight, never two gaps out of a station the same way
    // (the busiest stations choose first). Kept from the smaller station's end.
    const dir = new Map();
    const m8 = d => ((d % 8) + 8) % 8;
    for (const n of live.slice().sort((p, q) => adj.get(q.i).length - adj.get(p.i).length)) {
      const taken = new Set();
      const free = [];
      for (const m of adj.get(n.i)) {
        const k = eid(n.i, m);
        if (dir.has(k)) taken.add(m8(n.i < m ? dir.get(k) : dir.get(k) + 4));
        else {
          const a = Math.atan2(nodes[m].y - n.y, nodes[m].x - n.x) / STEP;
          free.push({ m, a, d: Math.round(a) });
        }
      }
      for (const o of free.sort((p, q) => Math.abs(p.a - p.d) - Math.abs(q.a - q.d))) {
        let d = o.d;
        const alt = o.a > o.d ? d + 1 : d - 1;
        if (taken.has(m8(d)) && !taken.has(m8(alt))) d = alt;
        taken.add(m8(d));
        dir.set(eid(n.i, o.m), n.i < o.m ? d : d + 4);
      }
    }
    const terms = [];
    for (const run of runs) {
      const ds = [];
      for (let j = 1; j < run.length; j++) {
        const [a, b] = [run[j - 1], run[j]];
        const d = dir.get(eid(a, b));
        ds.push(a < b ? d : d + 4);
      }
      // A straight's stations evenly along it, a gap beside an interchange room for its name.
      for (let s = 0; s < ds.length; ) {
        let e = s;
        while (e + 1 < ds.length && (((ds[e + 1] - ds[s]) % 8) + 8) % 8 === 0) e++;
        let len = 0;
        for (let j = s; j <= e; j++) len += Math.hypot(nodes[run[j + 1]].x - nodes[run[j]].x, nodes[run[j + 1]].y - nodes[run[j]].y);
        for (let j = s; j <= e; j++) {
          const big = nodes[run[j]].lines.length > 1 || nodes[run[j + 1]].lines.length > 1;
          terms.push([run[j], run[j + 1], ds[j] * STEP, Math.max(big ? 1.5 : 1, len / (e - s + 1))]);
        }
        s = e + 1;
      }
    }
    const M = 2 * N;
    const A = Array.from({ length: M }, () => new Float64Array(M));
    const rhs = new Float64Array(M);
    // (A row Σ c·v = t at weight w, into the normal equations.)
    const add = (cs, t, w) => {
      for (const [i, ci] of cs) {
        rhs[i] += w * ci * t;
        for (const [j, cj] of cs) A[i][j] += w * ci * cj;
      }
    };
    // (b − a)·(cx, cy) = t
    const along = (a, b, cx, cy, t, w) => add([[2 * b, cx], [2 * b + 1, cy], [2 * a, -cx], [2 * a + 1, -cy]], t, w);
    for (const [a, b, th, L] of terms) {
      const [cx, cy] = [Math.cos(th), Math.sin(th)];
      along(idx.get(a), idx.get(b), -cy, cx, 0, 60);
      along(idx.get(a), idx.get(b), cx, cy, L, 1);
    }
    for (const [a, b, cx, cy, t] of apart) along(idx.get(a), idx.get(b), cx, cy, t, 8);
    for (let i = 0; i < N; i++) {
      add([[2 * i, 1]], home[i][0], 0.02);
      add([[2 * i + 1, 1]], home[i][1], 0.02);
    }
    const x = solve(A, rhs);
    live.forEach((n, i) => {
      n.x = x[2 * i];
      n.y = x[2 * i + 1];
    });
    if (round === rounds - 1) break;
    // Too near another station, or on another line's track: held off it next round.
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++) {
        const [P, Q] = [live[i], live[j]];
        const d = Math.hypot(Q.x - P.x, Q.y - P.y);
        if (d < 1) apart.push([P.i, Q.i, (Q.x - P.x) / (d || 1), (Q.y - P.y) / (d || 1), 1.15]);
      }
    for (const n of live)
      for (const [a, b] of uniq) {
        if (a === n.i || b === n.i) continue;
        const [P, Q] = [nodes[a], nodes[b]];
        const vx = Q.x - P.x;
        const vy = Q.y - P.y;
        const l = Math.hypot(vx, vy) || 1;
        const t = ((n.x - P.x) * vx + (n.y - P.y) * vy) / (l * l);
        if (t < -0.05 || t > 1.05) continue;
        const d = ((n.x - P.x) * -vy + (n.y - P.y) * vx) / l;
        if (Math.abs(d) < 0.6) apart.push([a, n.i, -vy / l, vx / l, Math.sign(d || 1) * 0.85]);
      }
  }
}

// A x = b for the normal equations (symmetric, positive definite: elimination as is).
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    const piv = A[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / piv;
      if (!f) continue;
      const [Ar, Ac] = [A[r], A[c]];
      for (let k = c; k < n; k++) Ar[k] -= f * Ac[k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / (A[r][r] || 1e-12);
  }
  return x;
}
// ---- Drawing -----------------------------------------------------------------------------------------

// Drawing pixels a station gap at zoom 1.
export const PX = 54;
// The marks and names on screen, by the zoom: the drawing grows as you pinch
// in, its lines and names much less (readable far out, never huge close in).
export const sizes = k => {
  const line = Math.min(12, Math.max(3.4, 7 * k ** 0.55));
  return { line, dot: line * 0.5 + 1.6, ring: line * 0.42, x: line * 0.78 + 3.4, font: Math.min(16.5, Math.max(11.5, 13 * k ** 0.28)) };
};
// Where a name goes from its station: right, left, above, below, then the corners.
const SIDES = [
  [1, 0, 0],
  [-1, 0, 0.15],
  [0, -1, 0.5],
  [0, 1, 0.5],
  [0.72, -0.72, 0.3],
  [0.72, 0.72, 0.3],
  [-0.72, -0.72, 0.4],
  [-0.72, 0.72, 0.4]
];
// The zoom steps names are placed at (a quarter of a doubling apart): placed once a step, kept.
const LEVEL = 4;
export const levelOf = k => Math.round(Math.log2(k) * LEVEL);

// Each line's track, edge by edge, in drawing pixels: an edge two lines share
// is drawn side by side (`off`: how many line widths from its middle).
export function tracks(map) {
  const { nodes, edges, lines } = map;
  const share = new Map();
  for (const [a, b, key] of edges) {
    const id = a < b ? `${a},${b}` : `${b},${a}`;
    const list = share.get(id) || share.set(id, []).get(id);
    if (!list.includes(key)) list.push(key);
  }
  return lines.map(l => ({
    key: l.key,
    color: l.color,
    segs: edges
      .filter(ed => ed[2] === l.key)
      .map(([a, b]) => {
        const list = share.get(a < b ? `${a},${b}` : `${b},${a}`);
        return { a, b, pts: [nodes[a], nodes[b]].map(n => [n.x * PX, n.y * PX]), off: list.indexOf(l.key) - (list.length - 1) / 2 };
      })
  }));
}

// Where each station's name goes at zoom k, in screen pixels from its station:
// node i → { dx, dy, align, w, h, big } (none: no room at this zoom). The
// interchanges choose first, then the ends, then the rest along their lines;
// a name never over another name or another station, kept off the track
// where it can. `measure(text, font)` → its width.
export function placeNames(map, k, measure, { first = [] } = {}) {
  const { nodes, edges } = map;
  const sz = sizes(k);
  const live = nodes.filter(n => n.lines.length);
  const at = n => [n.x * PX * k, n.y * PX * k];
  const segs = edges.map(([a, b]) => [...at(nodes[a]), ...at(nodes[b])]);
  const marks = live.map(n => [...at(n), (n.big ? sz.x : sz.dot) + 2, n.i]);
  const ends = new Set(live.filter(n => n.end).map(n => n.i));
  const pri = n => (first.includes(n.i) ? 100 : 0) + (n.big ? 10 + n.lines.length : 0) + (ends.has(n.i) ? 5 : 0);
  const order = live.slice().sort((a, b) => pri(b) - pri(a) || a.i - b.i);
  const boxes = [];
  const out = new Map();
  for (const n of order) {
    const big = n.big || ends.has(n.i);
    const font = big ? sz.font + 0.5 : sz.font;
    const w = measure(n.name, font, big);
    const h = font * 1.25;
    const [px, py] = at(n);
    const r = (n.big ? sz.x : sz.dot) + 4;
    let best = null;
    for (const [sx, sy, pref] of SIDES) {
      const ax = px + sx * r;
      const ay = py + sy * r;
      const x0 = sx > 0.1 ? ax : sx < -0.1 ? ax - w : ax - w / 2;
      const y0 = sy < -0.1 ? ay - h : sy > 0.1 ? ay : ay - h / 2;
      const box = [x0 - 2, y0, x0 + w + 2, y0 + h];
      let cost = pref;
      if (boxes.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) continue;
      if (marks.some(([mx, my, mr, i]) => i !== n.i && mx + mr > box[0] && mx - mr < box[2] && my + mr > box[1] && my - mr < box[3])) continue;
      for (const s of segs) if (segHits(box, s)) cost += 2;
      if (!best || cost < best.cost) best = { cost, box, dx: x0 - px, dy: y0 + h / 2 - py, w, h, font, big };
      if (cost === pref && pref === 0) break;
    }
    if (!best) continue;
    boxes.push(best.box);
    out.set(n.i, best);
  }
  return out;
}
function segHits(box, [x1, y1, x2, y2]) {
  if (Math.max(x1, x2) < box[0] || Math.min(x1, x2) > box[2] || Math.max(y1, y2) < box[1] || Math.min(y1, y2) > box[3]) return false;
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 6));
  for (let i = 0; i <= n; i++) {
    const x = x1 + ((x2 - x1) * i) / n;
    const y = y1 + ((y2 - y1) * i) / n;
    if (x > box[0] && x < box[2] && y > box[1] && y < box[3]) return true;
  }
  return false;
}

// ---- On screen ---------------------------------------------------------------------------------------

// The drawing in `box`, on a canvas: a finger drags it (and it coasts when
// let go), two pinch it about their middle, two taps zoom in there, a tap with
// two fingers out; the wheel and the keys too. The lines grow as you zoom,
// the names stay a size you can read, as many as fit. A tap on a station (or
// its name) → onTap(node). Colours from CSS: --mm-bg, --mm-ink, --mm-pick.
// → { view(node, k), fit(lineKey), focus(lineKey), select(node), trains([…]), here(node), zoomBy(f), resize(), zoom(), fitZoom(), destroy() }.
export function mountMap(box, map, { onTap = () => {}, onMove = () => {} } = {}) {
  const { nodes, edges } = map;
  const live = nodes.filter(n => n.lines.length);
  const lines = tracks(map);
  const colorOf = new Map(map.lines.map(l => [l.key, l.color]));
  const P = n => [n.x * PX, n.y * PX];
  const xs = live.map(n => n.x * PX);
  const ys = live.map(n => n.y * PX);
  // The drawing's extent, a little room round it for the names.
  const ext = [Math.min(...xs) - 60, Math.min(...ys) - 40, Math.max(...xs) + 60, Math.max(...ys) + 40];
  const W = ext[2] - ext[0];
  const H = ext[3] - ext[1];
  const canvas = document.createElement('canvas');
  canvas.className = 'mm-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  box.replaceChildren(canvas);
  box.tabIndex = 0;
  const g = canvas.getContext('2d');
  let cw = box.clientWidth || 1;
  let ch = box.clientHeight || 1;
  let dpr = 1;
  // The view: the drawing's point at the box's top left, and screen pixels a drawing pixel.
  let x = ext[0];
  let y = ext[1];
  let k = 1;
  const MAXK = 3.2;
  const minK = () => Math.min(0.9, Math.min(cw / W, ch / H) * 0.9);
  // Never lost: a drawing smaller than the view stays in it; a bigger one keeps 40% of the view.
  const keep = (v, lo, hi, span) => (hi - lo < span ? Math.min(Math.max(v, hi - span), lo) : Math.min(Math.max(v, lo - span * 0.4), hi - span * 0.6));
  const clamp = () => {
    k = Math.min(MAXK, Math.max(minK(), k));
    x = keep(x, ext[0], ext[2], cw / k);
    y = keep(y, ext[1], ext[3], ch / k);
  };
  // Colours, read again when the phone turns light or dark (each through a probe: the browser's own resolved colour).
  let ink = {};
  const probe = document.createElement('i');
  probe.hidden = true;
  box.append(probe);
  const readInk = () => {
    const v = (name, d) => {
      probe.style.color = d;
      probe.style.color = `var(${name}, ${d})`;
      return getComputedStyle(probe).color || d;
    };
    ink = { bg: v('--mm-bg', '#fff'), ink: v('--mm-ink', '#111'), pick: v('--mm-pick', '#0a84ff'), you: v('--mm-you', '#0a84ff'), family: getComputedStyle(box).fontFamily || 'system-ui, sans-serif' };
    widths.clear();
    placed.clear();
  };
  // Names' widths (measured once a size) and where they go (once a zoom step).
  const widths = new Map();
  const font = (size, big) => `${big ? 650 : 500} ${size.toFixed(1)}px ${ink.family}`;
  const measure = (text, size, big) => {
    const id = `${big ? 1 : 0}|${size.toFixed(1)}|${text}`;
    if (!widths.has(id)) {
      g.font = font(size, big);
      widths.set(id, g.measureText(text).width);
    }
    return widths.get(id);
  };
  // (The names as the page's language shows them.)
  const named = { ...map, nodes: nodes.map(n => ({ ...n, name: shown(n.name) })) };
  const placed = new Map();
  let firstNames = [];
  // [[node i, place]…], the ordinary names before the interchanges' (one font at a time).
  const namesAt = lvl => {
    if (!placed.has(lvl)) placed.set(lvl, [...placeNames(named, 2 ** (lvl / LEVEL), measure, { first: firstNames })].sort((a, b) => Number(a[1].big) - Number(b[1].big)));
    return placed.get(lvl);
  };

  let focused = null;
  let picked = null;
  let you = null;
  let trainList = [];
  const size = () => {
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cw = box.clientWidth || cw;
    ch = box.clientHeight || ch;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
  };

  // ---- Painting
  let frame = 0;
  const paint = () => {
    frame = 0;
    clamp();
    const sz = sizes(k);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const sx = px => (px - x) * k;
    const sy = py => (py - y) * k;
    const pad = 40;
    const onScreen = (X, Y) => X > -pad && X < cw + pad && Y > -pad && Y < ch + pad;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // The lines: each over a thin edge of the card's colour, so crossings part cleanly.
    const order = focused ? lines.filter(l => l.key !== focused).concat(lines.filter(l => l.key === focused)) : lines;
    for (const l of order) {
      g.globalAlpha = focused && l.key !== focused ? 0.16 : 1;
      g.beginPath();
      for (const s of l.segs) {
        const [[ax, ay], [bx, by]] = s.pts;
        let [x1, y1, x2, y2] = [sx(ax), sy(ay), sx(bx), sy(by)];
        if (Math.max(x1, x2) < -pad || Math.min(x1, x2) > cw + pad || Math.max(y1, y2) < -pad || Math.min(y1, y2) > ch + pad) continue;
        if (s.off) {
          const len = Math.hypot(x2 - x1, y2 - y1) || 1;
          const ox = (-(y2 - y1) / len) * s.off * sz.line * 1.05;
          const oy = ((x2 - x1) / len) * s.off * sz.line * 1.05;
          [x1, y1, x2, y2] = [x1 + ox, y1 + oy, x2 + ox, y2 + oy];
        }
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
      }
      g.strokeStyle = ink.bg;
      g.lineWidth = sz.line + 3;
      g.stroke();
      g.strokeStyle = l.color;
      g.lineWidth = sz.line;
      g.stroke();
    }
    g.globalAlpha = 1;
    // The trains due now: a capsule on the track just before their station, pointing on.
    for (const t of trainList) {
      const a = nodes[t.node];
      const b = t.from == null ? null : nodes[t.from];
      if (!a?.lines.length) continue;
      const f = t.min ? 0.55 : 0.3;
      const [ax, ay] = P(a);
      const [bx, by] = b ? P(b) : [ax, ay];
      const X = sx(ax + (bx - ax) * f);
      const Y = sy(ay + (by - ay) * f);
      if (!onScreen(X, Y)) continue;
      g.globalAlpha = focused && !a.lines.includes(focused) ? 0.2 : 1;
      g.save();
      g.translate(X, Y);
      g.rotate(b ? Math.atan2(ay - by, ax - bx) : 0);
      const L = sz.line * 1.5 + 6;
      const R = sz.line * 0.55 + 3;
      // (Beside the track on its right, as the trains keep: two passing on one gap both seen.)
      g.translate(0, R * 0.9);
      g.beginPath();
      if (g.roundRect) g.roundRect(-L, -R, L * 2, R * 2, R);
      else g.rect(-L, -R, L * 2, R * 2);
      g.fillStyle = t.color;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = ink.bg;
      g.stroke();
      g.beginPath();
      g.moveTo(L * 0.15, -R * 0.5);
      g.lineTo(L * 0.55, 0);
      g.lineTo(L * 0.15, R * 0.5);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.8;
      g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;
    // The stations: a ring in the line's colour; an interchange a bigger ring in ink.
    for (const n of live) {
      const [px, py] = P(n);
      const X = sx(px);
      const Y = sy(py);
      if (!onScreen(X, Y)) continue;
      g.globalAlpha = focused && !n.lines.includes(focused) ? 0.25 : 1;
      g.beginPath();
      if (n.big) {
        g.arc(X, Y, sz.x, 0, Math.PI * 2);
        g.fillStyle = ink.bg;
        g.fill();
        g.lineWidth = Math.max(2.2, sz.ring * 1.15);
        g.strokeStyle = ink.ink;
        g.stroke();
      } else {
        g.arc(X, Y, sz.dot, 0, Math.PI * 2);
        g.fillStyle = ink.bg;
        g.fill();
        g.lineWidth = Math.max(1.8, sz.ring);
        g.strokeStyle = colorOf.get(focused && n.lines.includes(focused) ? focused : n.lines[0]);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    // You, and the station chosen.
    const ring = (n, color, r, fill) => {
      const [px, py] = P(n);
      g.beginPath();
      g.arc(sx(px), sy(py), r, 0, Math.PI * 2);
      if (fill) {
        g.fillStyle = fill;
        g.fill();
      }
      g.lineWidth = 3;
      g.strokeStyle = color;
      g.stroke();
    };
    if (you) {
      const [px, py] = P(you);
      g.beginPath();
      g.arc(sx(px), sy(py), sz.x + 9, 0, Math.PI * 2);
      g.globalAlpha = 0.2;
      g.fillStyle = ink.you;
      g.fill();
      g.globalAlpha = 1;
      ring(you, ink.bg, 6.5, ink.you);
    }
    if (picked) ring(picked, ink.pick, (picked.big ? sz.x : sz.dot) + 5);
    // The names: as many as fit at this zoom, each on a halo of the card's colour.
    const names = namesAt(levelOf(k));
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.lineWidth = 4;
    g.strokeStyle = ink.bg;
    for (const pass of ['halo', 'text']) {
      let set = '';
      for (const [i, l] of names) {
        const n = nodes[i];
        const [px, py] = P(n);
        // (Placed at the step's zoom: the offsets held, the station where it is now.)
        const X = sx(px) + l.dx;
        const Y = sy(py) + l.dy;
        if (X > cw + 4 || X + l.w < -4 || Y < -l.h || Y > ch + l.h) continue;
        g.globalAlpha = focused && !n.lines.includes(focused) ? 0.3 : 1;
        const f = font(l.font, l.big);
        if (f !== set) g.font = set = f;
        if (pass === 'halo') g.strokeText(named.nodes[i].name, X, Y);
        else {
          g.fillStyle = n === picked ? ink.pick : ink.ink;
          g.fillText(named.nodes[i].name, X, Y);
        }
      }
    }
    g.globalAlpha = 1;
    onMove({ k });
  };
  const draw = () => frame || (frame = requestAnimationFrame(paint));

  // ---- Moving
  const zoomAt = (px, py, nk) => {
    const cx = x + px / k;
    const cy = y + py / k;
    k = Math.min(MAXK, Math.max(minK(), nk));
    x = cx - px / k;
    y = cy - py / k;
    draw();
  };
  let anim = 0;
  const stop = () => {
    cancelAnimationFrame(anim);
    anim = 0;
  };
  // A smooth move to a view (the drawing's point in the middle, and the zoom).
  const glide = (tx, ty, tk, ms = 360) => {
    stop();
    tk = Math.min(MAXK, Math.max(minK(), tk));
    const [fx, fy, fk] = [x + cw / k / 2, y + ch / k / 2, k];
    const t0 = performance.now();
    const tick = now => {
      const t = Math.min(1, (now - t0) / ms);
      const s = 1 - (1 - t) ** 3;
      // (The zoom eased in its own scale, so a long zoom feels even.)
      k = fk * (tk / fk) ** s;
      x = fx + (tx - fx) * s - cw / k / 2;
      y = fy + (ty - fy) * s - ch / k / 2;
      paint();
      anim = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    anim = requestAnimationFrame(tick);
  };
  const local = ev => {
    const r = box.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const ptrs = new Map();
  let pinch = null;
  let tap = null;
  let lastTap = null;
  let trail = [];
  box.addEventListener('pointerdown', ev => {
    if (ev.button > 0) return;
    stop();
    try {
      box.setPointerCapture?.(ev.pointerId);
    } catch {}
    ptrs.set(ev.pointerId, local(ev));
    trail = [];
    if (ptrs.size === 1) tap = { at: performance.now(), p: local(ev), moved: 0, fingers: 1 };
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], k, x, y };
      if (tap) tap.fingers = 2;
    }
  });
  box.addEventListener('pointermove', ev => {
    if (!ptrs.has(ev.pointerId)) return;
    const prev = ptrs.get(ev.pointerId);
    const p = local(ev);
    ptrs.set(ev.pointerId, p);
    if (tap) tap.moved += Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]);
    if (ptrs.size >= 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // The drawing's point under the fingers' middle when they landed stays under it.
      const cx = pinch.x + pinch.m[0] / pinch.k;
      const cy = pinch.y + pinch.m[1] / pinch.k;
      k = Math.min(MAXK, Math.max(minK(), pinch.k * (d / pinch.d)));
      x = cx - m[0] / k;
      y = cy - m[1] / k;
      draw();
    } else if (ptrs.size === 1) {
      x -= (p[0] - prev[0]) / k;
      y -= (p[1] - prev[1]) / k;
      const now = performance.now();
      trail.push([now, p[0], p[1]]);
      while (trail.length > 2 && now - trail[0][0] > 90) trail.shift();
      draw();
    }
  });
  const up = ev => {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.delete(ev.pointerId);
    if (ptrs.size === 1) {
      // One finger left of a pinch: it drags on from here.
      pinch = null;
      trail = [];
      return;
    }
    if (ptrs.size) return;
    pinch = null;
    const t = tap;
    tap = null;
    const now = performance.now();
    if (t && t.moved < 12 && now - t.at < 380) {
      const [px, py] = local(ev);
      if (t.fingers === 2) return glide(x + px / k, y + py / k, k / 1.8, 280);
      const hit = nodeAt(px, py);
      if (hit && ev.type === 'pointerup') {
        lastTap = null;
        return onTap(hit);
      }
      // Two taps on the map's empty ground: in, about there.
      if (lastTap && now - lastTap.at < 320 && Math.hypot(px - lastTap.p[0], py - lastTap.p[1]) < 40) {
        lastTap = null;
        return glide(x + px / k, y + py / k, k * 2, 280);
      }
      lastTap = { at: now, p: [px, py] };
      return;
    }
    // Let go while moving: it coasts, slowing as iOS's lists do.
    if (trail.length >= 2 && now - trail.at(-1)[0] < 60) {
      const [t0, x0, y0] = trail[0];
      const [t1, x1, y1] = trail.at(-1);
      let vx = (x1 - x0) / Math.max(8, t1 - t0);
      let vy = (y1 - y0) / Math.max(8, t1 - t0);
      if (Math.hypot(vx, vy) < 0.25) return;
      let last = performance.now();
      const coast = at => {
        const dt = Math.min(40, at - last);
        last = at;
        x -= (vx * dt) / k;
        y -= (vy * dt) / k;
        const f = Math.exp(-dt / 300);
        vx *= f;
        vy *= f;
        paint();
        anim = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(coast) : 0;
      };
      anim = requestAnimationFrame(coast);
    }
  };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  box.addEventListener('lostpointercapture', up);
  box.addEventListener(
    'wheel',
    ev => {
      ev.preventDefault();
      stop();
      const [px, py] = local(ev);
      // (A trackpad's pinch comes as the wheel with ctrl held: finer steps.)
      const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      zoomAt(px, py, k * Math.exp(-dy / (ev.ctrlKey ? 100 : 300)));
    },
    { passive: false }
  );
  box.addEventListener('keydown', ev => {
    const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (pan) {
      ev.preventDefault();
      glide(x + cw / k / 2 + (pan[0] * cw * 0.3) / k, y + ch / k / 2 + (pan[1] * ch * 0.3) / k, k, 200);
    } else if (ev.key === '+' || ev.key === '=') api.zoomBy(1.6);
    else if (ev.key === '-' || ev.key === '_') api.zoomBy(1 / 1.6);
  });
  // The station under a tap: its mark within a finger's width, else its name.
  const nodeAt = (px, py) => {
    const cx = x + px / k;
    const cy = y + py / k;
    let best = null;
    let bd = 24 / k;
    for (const n of live) {
      const [nx, ny] = P(n);
      const d = Math.hypot(nx - cx, ny - cy);
      if (d < bd) [best, bd] = [n, d];
    }
    if (best) return best;
    for (const [i, l] of namesAt(levelOf(k))) {
      const [nx, ny] = P(nodes[i]);
      const X = (nx - x) * k + l.dx;
      const Y = (ny - y) * k + l.dy;
      if (px > X - 6 && px < X + l.w + 6 && py > Y - l.h / 2 - 6 && py < Y + l.h / 2 + 6) return nodes[i];
    }
    return null;
  };

  // The view a set of stations fits (with room for the map's buttons along its edges).
  const fitting = list => {
    if (!list.length) return null;
    const px = list.map(n => n.x * PX);
    const py = list.map(n => n.y * PX);
    const [x0, x1, y0, y1] = [Math.min(...px), Math.max(...px), Math.min(...py), Math.max(...py)];
    const fk = Math.min((cw - 110) / Math.max(1, x1 - x0), (ch - 150) / Math.max(1, y1 - y0));
    return [(x0 + x1) / 2, (y0 + y1) / 2, Math.min(MAXK, Math.max(minK(), fk))];
  };
  const onLine = key => live.filter(n => n.lines.includes(key));
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => api.resize()) : null;
  ro?.observe(box);
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const reink = () => {
    readInk();
    draw();
  };
  dark.addEventListener?.('change', reink);
  // (A look chosen on the Pass: the page's own light or dark.)
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(reink) : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-look'] });
  const api = {
    // Centre on a station at zoom nk (or the zoom now).
    view(node, nk = k, { now = false } = {}) {
      const n = typeof node === 'number' ? nodes[node] : node;
      if (!n?.lines?.length) return;
      const [px, py] = P(n);
      if (now) {
        stop();
        k = Math.min(MAXK, Math.max(minK(), nk));
        x = px - cw / k / 2;
        y = py - ch / k / 2;
        paint();
      } else glide(px, py, nk);
    },
    // The whole drawing, or a line's stations.
    fit(lineKey = null, { now = false } = {}) {
      const f = fitting(lineKey ? onLine(lineKey) : live);
      if (!f) return;
      if (now) {
        stop();
        k = f[2];
        x = f[0] - cw / k / 2;
        y = f[1] - ch / k / 2;
        paint();
      } else glide(...f);
    },
    // One line bright, the rest faded (null: all).
    focus(lineKey) {
      focused = lineKey || null;
      draw();
    },
    // The station chosen: ringed, its name first wherever it is.
    select(node) {
      picked = node == null ? null : typeof node === 'number' ? nodes[node] : nodes[node.i];
      firstNames = [picked?.i, you?.i].filter(i => i != null);
      placed.clear();
      draw();
    },
    // The trains at (or a minute from) a station: [{ node, from, min, color }].
    trains(list) {
      trainList = list || [];
      draw();
    },
    // You: a dot at your station.
    here(node) {
      you = node == null ? null : nodes[node.i ?? node];
      firstNames = [picked?.i, you?.i].filter(i => i != null);
      placed.clear();
      draw();
    },
    zoomBy(f) {
      glide(x + cw / k / 2, y + ch / k / 2, k * f, 260);
    },
    resize() {
      const cx = x + cw / k / 2;
      const cy = y + ch / k / 2;
      const [w0, h0] = [cw, ch];
      size();
      if (cw === w0 && ch === h0 && canvas.width) return draw();
      x = cx - cw / k / 2;
      y = cy - ch / k / 2;
      paint();
    },
    zoom: () => k,
    // The zoom the whole drawing fits the box at.
    fitZoom: () => fitting(live)?.[2] || 0,
    destroy() {
      stop();
      cancelAnimationFrame(frame);
      ro?.disconnect();
      mo?.disconnect();
      dark.removeEventListener?.('change', reink);
      box.replaceChildren();
    }
  };
  readInk();
  size();
  paint();
  return api;
}

// Which station a live train comes from: its neighbour on the line farther from where it's going.
export function trainFrom(map, node, destNode, lineKey) {
  const adj = new Map();
  for (const [a, b, l] of map.edges) {
    if (lineKey && l !== lineKey) continue;
    (adj.get(a) || adj.set(a, []).get(a)).push(b);
    (adj.get(b) || adj.set(b, []).get(b)).push(a);
  }
  const dist = new Map([[destNode, 0]]);
  let front = [destNode];
  while (front.length) {
    const next = [];
    for (const n of front) for (const m of adj.get(n) || []) if (!dist.has(m)) dist.set(m, dist.get(n) + 1), next.push(m);
    front = next;
  }
  const nb = (adj.get(node) || []).filter(m => dist.has(m));
  if (!nb.length) return null;
  return nb.sort((a, b) => dist.get(b) - dist.get(a))[0];
}

// What's wrong with a drawing, to choose between tries: lines crossing
// where there's no station, gaps off the eight directions (radians, summed),
// stations too close, runs folded back, lines bent hard at an interchange. → { cross, ang, close, fold, bend, cost }.
export function faults(map) {
  const { nodes, edges } = map;
  let cross = 0;
  let ang = 0;
  let close = 0;
  let fold = 0;
  const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) - (B.y - A.y) * (C.x - A.x);
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    const [A, B] = [nodes[a], nodes[b]];
    const t = Math.atan2(B.y - A.y, B.x - A.x);
    const d = Math.abs(t - Math.round(t / STEP) * STEP);
    if (d > 0.03) ang += d;
    for (let k = i + 1; k < edges.length; k++) {
      const [c, d2] = edges[k];
      if (a === c || a === d2 || b === c || b === d2) continue;
      const [C, D] = [nodes[c], nodes[d2]];
      if (ccw(A, B, C) * ccw(A, B, D) < 0 && ccw(C, D, A) * ccw(C, D, B) < 0) cross++;
    }
  }
  const live = nodes.filter(n => n.lines.length);
  for (let i = 0; i < live.length; i++) for (let k = i + 1; k < live.length; k++) if (Math.hypot(live[i].x - live[k].x, live[i].y - live[k].y) < 0.8) close++;
  const adj = new Map();
  for (const [a, b] of edges) {
    (adj.get(a) || adj.set(a, []).get(a)).push(b);
    (adj.get(b) || adj.set(b, []).get(b)).push(a);
  }
  for (const [n, nb] of adj) {
    if (nb.length !== 2) continue;
    const [N, P, Q] = [nodes[n], nodes[nb[0]], nodes[nb[1]]];
    const [ax, ay, bx, by] = [P.x - N.x, P.y - N.y, Q.x - N.x, Q.y - N.y];
    if ((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1) > -0.1) fold++;
  }
  // A line turning hard at an interchange (more than 45°) where it could go on through.
  let bend = 0;
  const per = new Map();
  for (const [a, b, key] of edges)
    for (const [n, m] of [[a, b], [b, a]]) {
      if (nodes[n].lines.length < 2) continue;
      const id = `${n}|${key}`;
      (per.get(id) || per.set(id, []).get(id)).push(m);
    }
  for (const [id, nb] of per) {
    if (nb.length !== 2) continue;
    const [N, P, Q] = [nodes[+id.split('|')[0]], nodes[nb[0]], nodes[nb[1]]];
    const [ax, ay, bx, by] = [P.x - N.x, P.y - N.y, Q.x - N.x, Q.y - N.y];
    if ((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1) > -0.6) bend++;
  }
  return { cross, ang: Math.round(ang * 100) / 100, close, fold, bend, cost: cross * 10 + close * 5 + fold * 10 + bend * 3 + ang };
}
