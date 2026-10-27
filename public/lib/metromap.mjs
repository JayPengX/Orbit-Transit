// The metro as a metro map: each city's lines redrawn the way the
// operators draw them (straight runs at right angles and 45°, the stations
// evenly spaced, an interchange a ring), worked out from TDX's real station
// places, so a new line or station draws itself. `schematic` lays it out
// (no DOM: tested), `metroSvg` draws it, `panZoom` moves it under a finger.

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

// ---- Drawing -----------------------------------------------------------------------------------------

export const PX = 54;
// Where a station's name goes: the side its tracks leave free, then the side clear of others' names.
const SIDES = [
  [1, 0, 'start'],
  [-1, 0, 'end'],
  [0, -1, 'middle'],
  [0, 1, 'middle'],
  [0.75, -0.75, 'start'],
  [0.75, 0.75, 'start'],
  [-0.75, -0.75, 'end'],
  [-0.75, 0.75, 'end']
];
export function labels(map) {
  const { nodes, edges } = map;
  const font = 12;
  const boxes = [];
  const segs = edges.map(([a, b]) => [nodes[a].x * PX, nodes[a].y * PX, nodes[b].x * PX, nodes[b].y * PX]);
  const out = new Map();
  const pts = nodes.filter(n => n.lines.length).map(n => ({ i: n.i, x: n.x * PX, y: n.y * PX }));
  const order = nodes.filter(n => n.lines.length).sort((a, b) => Number(b.big) - Number(a.big) || Number(b.end) - Number(a.end));
  for (const n of order) {
    const w = [...n.name].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? font : font * 0.6), 0);
    const h = font + 2;
    const r = n.big ? 10 : 7;
    let best = null;
    for (const [sx, sy, anchor] of SIDES) {
      const ax = n.x * PX + sx * (r + 3);
      const ay = n.y * PX + sy * (r + 3);
      const x0 = anchor === 'start' ? ax : anchor === 'end' ? ax - w : ax - w / 2;
      const y0 = sy < 0 ? ay - h : sy > 0 ? ay : ay - h / 2;
      const box = [x0 - 2, y0 - 1, x0 + w + 2, y0 + h + 1];
      let cost = 0;
      for (const b of boxes) if (overlap(box, b)) cost += 10;
      for (const s of segs) if (segHits(box, s)) cost += 3;
      // Never over another station (whose name it would seem to be).
      for (const o of pts) if (o.i !== n.i && o.x > box[0] - 9 && o.x < box[2] + 9 && o.y > box[1] - 9 && o.y < box[3] + 9) cost += 8;
      // Sideways reads best.
      cost += sy === 0 ? 0 : sx === 0 ? 0.6 : 0.3;
      if (!best || cost < best.cost) best = { cost, box, x: anchor === 'start' ? x0 : anchor === 'end' ? x0 + w : x0 + w / 2, y: y0 + h / 2, anchor };
      if (cost === 0) break;
    }
    boxes.push(best.box);
    out.set(n.i, best);
  }
  return out;
}
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function segHits(box, [x1, y1, x2, y2]) {
  // Sampled along the gap: enough at a station's spacing.
  for (let t = 0.12; t < 0.9; t += 0.12) {
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (x > box[0] && x < box[2] && y > box[1] && y < box[3]) return true;
  }
  return false;
}

// The map as SVG (a string): the lines, then the stations, then their names;
// each station a `data-node` to tap. Its colours are CSS variables (light and dark).
// → { svg, w, h, at: node i → [x, y] in the drawing }.
export function metroSvg(map, { pad = 24 } = {}) {
  const { nodes, lines } = map;
  const live = nodes.filter(n => n.lines.length);
  const lab = labels(map);
  const boxes = [...lab.values()].map(l => l.box).concat(live.map(n => [n.x * PX - 12, n.y * PX - 12, n.x * PX + 12, n.y * PX + 12]));
  const x0 = Math.min(...boxes.map(b => b[0])) - pad;
  const y0 = Math.min(...boxes.map(b => b[1])) - pad;
  const W = Math.max(...boxes.map(b => b[2])) - x0 + pad;
  const H = Math.max(...boxes.map(b => b[3])) - y0 + pad;
  const at = new Map(live.map(n => [n.i, [n.x * PX - x0, n.y * PX - y0]]));
  const P = n => at.get(n.i).map(v => v.toFixed(1)).join(',');
  const colorOf = new Map(lines.map(l => [l.key, l.color]));
  const track = lines.map(l => l.runs.map(r => `<polyline class="mm-line" data-line="${e(l.key)}" style="--c:${e(l.color)}" points="${r.map(i => P(nodes[i])).join(' ')}"/>`).join('')).join('');
  const dots = live
    .map(n => {
      const [cx, cy] = at.get(n.i).map(v => v.toFixed(1));
      return n.big ? `<circle class="mm-x" data-node="${n.i}" cx="${cx}" cy="${cy}" r="8"/>` : `<circle class="mm-st" data-node="${n.i}" cx="${cx}" cy="${cy}" r="5" style="--c:${e(colorOf.get(n.lines[0]))}"/>`;
    })
    .join('');
  const names = live
    .map(n => {
      const l = lab.get(n.i);
      return `<text class="mm-name${n.big ? ' big' : ''}${n.end ? ' end' : ''}" data-node="${n.i}" x="${(l.x - x0).toFixed(1)}" y="${(l.y - y0).toFixed(1)}" text-anchor="${l.anchor}">${e(shown(n.name))}</text>`;
    })
    .join('');
  return { w: W, h: H, at, svg: `<svg class="mm-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}"><g class="mm-tracks">${track}</g><g class="mm-trains"></g><g class="mm-dots">${dots}</g><g class="mm-names">${names}</g><g class="mm-here"></g></svg>` };
}

// ---- On screen ---------------------------------------------------------------------------------------

// The drawing in `box`, moved by a finger (one drags, two pinch), the
// wheel, a double tap; a tap on a station → onTap(node). It stays sharp at
// any zoom (the SVG's own viewBox moves, never a scaled picture).
// → { view(node, k), fit(), focus(lineKey | null), trains([{ node, toward, color }]), here(node | null), destroy() }.
export function mountMap(box, map, { onTap = () => {}, onMove = () => {} } = {}) {
  const drawn = metroSvg(map);
  box.innerHTML = drawn.svg;
  const svg = box.querySelector('svg');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  let cw = box.clientWidth || 1;
  let ch = box.clientHeight || 1;
  // The view: the drawing's point at the box's corner, and pixels a drawing unit.
  let x = 0;
  let y = 0;
  let k = 1;
  const minK = () => Math.min(cw / drawn.w, ch / drawn.h, 0.5);
  const MAXK = 2.6;
  const clamp = () => {
    k = Math.min(MAXK, Math.max(minK(), k));
    const vw = cw / k;
    const vh = ch / k;
    // Never lost off the drawing: at least a third of the box stays on it.
    x = Math.min(Math.max(x, -vw * 0.66), drawn.w - vw * 0.34);
    y = Math.min(Math.max(y, -vh * 0.66), drawn.h - vh * 0.34);
  };
  let frame = 0;
  const paint = () => {
    frame = 0;
    clamp();
    svg.setAttribute('viewBox', `${x.toFixed(2)} ${y.toFixed(2)} ${(cw / k).toFixed(2)} ${(ch / k).toFixed(2)}`);
    // Far out: only the interchanges and the ends named.
    box.classList.toggle('mm-far', k < 0.62);
    onMove({ k });
  };
  const draw = () => frame || (frame = requestAnimationFrame(paint));
  const zoomAt = (px, py, nk) => {
    const cx = x + px / k;
    const cy = y + py / k;
    k = Math.min(MAXK, Math.max(minK(), nk));
    x = cx - px / k;
    y = cy - py / k;
    draw();
  };
  // A smooth move to a view (the drawing's centre point and zoom).
  let anim = 0;
  const glide = (tx, ty, tk, ms = 320) => {
    cancelAnimationFrame(anim);
    const [fx, fy, fk] = [x + cw / k / 2, y + ch / k / 2, k];
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms);
      const s = 1 - (1 - t) ** 3;
      k = fk + (tk - fk) * s;
      x = fx + (tx - fx) * s - cw / k / 2;
      y = fy + (ty - fy) * s - ch / k / 2;
      paint();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };

  // Fingers.
  const ptrs = new Map();
  let start = null;
  let lastTap = 0;
  let vel = [0, 0];
  let lastMove = null;
  box.addEventListener('pointerdown', ev => {
    cancelAnimationFrame(anim);
    box.setPointerCapture?.(ev.pointerId);
    ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (ptrs.size === 1) start = { at: performance.now(), px: ev.clientX, py: ev.clientY, moved: 0, target: ev.target };
    else start && (start.moved = 99);
    vel = [0, 0];
    lastMove = { t: performance.now(), x: ev.clientX, y: ev.clientY };
  });
  box.addEventListener('pointermove', ev => {
    if (!ptrs.has(ev.pointerId)) return;
    const prev = ptrs.get(ev.pointerId);
    if (ptrs.size === 1) {
      const dx = ev.clientX - prev[0];
      const dy = ev.clientY - prev[1];
      x -= dx / k;
      y -= dy / k;
      if (start) start.moved += Math.abs(dx) + Math.abs(dy);
      const now = performance.now();
      const dt = Math.max(1, now - lastMove.t);
      vel = [(ev.clientX - lastMove.x) / dt, (ev.clientY - lastMove.y) / dt];
      lastMove = { t: now, x: ev.clientX, y: ev.clientY };
      ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
      draw();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const other = a === prev ? b : a;
      const d0 = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
      ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
      const d1 = Math.hypot(ev.clientX - other[0], ev.clientY - other[1]);
      const r = box.getBoundingClientRect();
      // The middle of the two fingers stays put while they spread.
      const m0 = [(prev[0] + other[0]) / 2 - r.left, (prev[1] + other[1]) / 2 - r.top];
      const m1 = [(ev.clientX + other[0]) / 2 - r.left, (ev.clientY + other[1]) / 2 - r.top];
      x -= (m1[0] - m0[0]) / k;
      y -= (m1[1] - m0[1]) / k;
      if (d0 > 0) zoomAt(m1[0], m1[1], k * (d1 / d0));
      else draw();
    }
  });
  const up = ev => {
    if (!ptrs.has(ev.pointerId)) return;
    ptrs.delete(ev.pointerId);
    if (ptrs.size) return;
    const s = start;
    start = null;
    if (s && s.moved < 10 && performance.now() - s.at < 400) {
      const r = box.getBoundingClientRect();
      const now = performance.now();
      // Two taps: in, about there.
      if (now - lastTap < 300) {
        lastTap = 0;
        const px = ev.clientX - r.left;
        const py = ev.clientY - r.top;
        return glide(x + px / k, y + py / k, Math.min(MAXK, k * 1.8), 260);
      }
      lastTap = now;
      const hit = nodeNear(ev.clientX - r.left, ev.clientY - r.top);
      if (hit != null) onTap(map.nodes[hit]);
      return;
    }
    // Let go while moving: it coasts.
    if (Math.hypot(...vel) > 0.25 && performance.now() - (lastMove?.t || 0) < 80) {
      let [vx, vy] = vel;
      const coast = () => {
        x -= (vx * 16) / k;
        y -= (vy * 16) / k;
        vx *= 0.92;
        vy *= 0.92;
        paint();
        if (Math.hypot(vx, vy) > 0.02) anim = requestAnimationFrame(coast);
      };
      anim = requestAnimationFrame(coast);
    }
  };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  box.addEventListener(
    'wheel',
    ev => {
      ev.preventDefault();
      const r = box.getBoundingClientRect();
      zoomAt(ev.clientX - r.left, ev.clientY - r.top, k * Math.exp(-ev.deltaY / (ev.ctrlKey ? 100 : 400)));
    },
    { passive: false }
  );
  // The station nearest a tap (a finger's width), in the box's pixels.
  const nodeNear = (px, py) => {
    const cx = x + px / k;
    const cy = y + py / k;
    let best = null;
    let bd = 24 / Math.min(k, 1);
    for (const [i, [nx, ny]] of drawn.at) {
      const d = Math.hypot(nx - cx, ny - cy);
      if (d < bd) [best, bd] = [i, d];
    }
    if (best == null) {
      // A tap on a station's name.
      const t = document.elementFromPoint(px + box.getBoundingClientRect().left, py + box.getBoundingClientRect().top)?.closest?.('[data-node]');
      if (t) best = Number(t.dataset.node);
    }
    return best;
  };

  const layer = name => svg.querySelector(`.mm-${name}`);
  const fitting = lineKey => {
    const pts = lineKey ? map.edges.filter(ed => ed[2] === lineKey).flatMap(ed => [drawn.at.get(ed[0]), drawn.at.get(ed[1])]) : [...drawn.at.values()];
    if (!pts.length) return null;
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return [x0, x1, y0, y1, Math.min(MAXK, Math.max(minK(), Math.min((cw - 60) / Math.max(1, x1 - x0), (ch - 90) / Math.max(1, y1 - y0))))];
  };
  const api = {
    // Centre on a station at zoom k (or where it is).
    view(node, nk = k, { now = false } = {}) {
      const p = drawn.at.get(node?.i ?? node);
      if (!p) return;
      if (now) {
        k = Math.min(MAXK, Math.max(minK(), nk));
        x = p[0] - cw / k / 2;
        y = p[1] - ch / k / 2;
        paint();
      } else glide(p[0], p[1], nk);
    },
    // The whole drawing, or a line's stations.
    fit(lineKey = null, { now = false } = {}) {
      const f = fitting(lineKey);
      if (!f) return;
      const [x0, x1, y0, y1, nk] = f;
      if (now) {
        k = nk;
        x = (x0 + x1) / 2 - cw / k / 2;
        y = (y0 + y1) / 2 - ch / k / 2;
        paint();
      } else glide((x0 + x1) / 2, (y0 + y1) / 2, nk);
    },
    // One line bright, the rest faded (null: all).
    focus(lineKey) {
      svg.classList.toggle('mm-focus', Boolean(lineKey));
      for (const el of svg.querySelectorAll('[data-line]')) el.classList.toggle('on', el.dataset.line === lineKey);
      const on = new Set(lineKey ? map.nodes.filter(n => n.lines.includes(lineKey)).map(n => String(n.i)) : []);
      for (const el of svg.querySelectorAll('[data-node]')) el.classList.toggle('on', on.has(el.dataset.node));
    },
    // The trains now at (or a minute from) a station: a capsule on the track just before it.
    trains(list) {
      layer('trains').innerHTML = list
        .map(t => {
          const a = drawn.at.get(t.node);
          const b = drawn.at.get(t.from);
          if (!a) return '';
          const f = t.min ? 0.55 : 0.3;
          const [px, py] = b ? [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] : a;
          const ang = b ? (Math.atan2(a[1] - b[1], a[0] - b[0]) * 180) / Math.PI : 0;
          return `<g class="mm-train" transform="translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${ang.toFixed(0)})" style="--c:${e(t.color)}"><rect x="-9" y="-5" width="18" height="10" rx="5"/><path d="M3 -2.6 6 0 3 2.6"/></g>`;
        })
        .join('');
    },
    // You: a dot at your station.
    here(node) {
      const p = node == null ? null : drawn.at.get(node.i ?? node);
      layer('here').innerHTML = p ? `<circle class="mm-you-ring" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="17"/><circle class="mm-you" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="6"/>` : '';
    },
    resize() {
      const cx = x + cw / k / 2;
      const cy = y + ch / k / 2;
      cw = box.clientWidth || cw;
      ch = box.clientHeight || ch;
      x = cx - cw / k / 2;
      y = cy - ch / k / 2;
      paint();
    },
    zoom: () => k,
    // The zoom the whole drawing fits the box at (an iPad's: names and all).
    fitZoom: () => fitting(null)?.[4] || 0,
    destroy() {
      cancelAnimationFrame(anim);
      box.innerHTML = '';
    }
  };
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
