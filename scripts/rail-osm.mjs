// node scripts/rail-osm.mjs [overpass.json] → public/rail-tra.json: 台鐵's track
// from OpenStreetMap (© OpenStreetMap contributors, ODbL), drawn under a train's
// ride and used to tell you're on it. TDX's own shape has none or little of a
// quarter of the stations' track (the 山線 竹南 → 臺中 almost nothing: Jay
// 2026-11-07 on 普悠瑪 107, the ride drawn straight, km off him). Each way of
// track joined into runs where two meet end to end, thinned to 8 m, encoded
// as Google polylines (lib/shapes.mjs railGroups reads it for 'tra').
// Without a file: read from Overpass (maps.mail.ru's; overpass-api.de cuts off here).
import { readFileSync, writeFileSync } from 'node:fs';

const Q = '[out:json][timeout:100];way["railway"="rail"]["usage"~"^(main|branch)$"][!"service"](21.8,119.9,25.4,122.1);out tags geom;';
const src = process.argv[2];
const osm = src ? JSON.parse(readFileSync(src, 'utf8')) : await (await fetch('https://maps.mail.ru/osm/tools/overpass/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: Q }) })).json();
// 台鐵's ways (高鐵's are TDX's, kept as they are).
const tra = osm.elements.filter(w => w.type === 'way' && w.geometry?.length > 1 && !/高速鐵路|High Speed/i.test(`${w.tags?.operator || ''} ${w.tags?.name || ''}`));
const key = p => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
// Runs: ways joined end to end where exactly two ends meet (not at a junction).
const ends = new Map();
for (const w of tra) for (const p of [w.geometry[0], w.geometry.at(-1)]) ends.set(key(p), (ends.get(key(p)) || 0) + 1);
const byEnd = new Map();
for (const w of tra) for (const p of [w.geometry[0], w.geometry.at(-1)]) (byEnd.get(key(p)) || byEnd.set(key(p), []).get(key(p))).push(w);
const used = new Set();
const runs = [];
for (const w of tra) {
  if (used.has(w)) continue;
  used.add(w);
  let pts = w.geometry.map(p => [p.lat, p.lon]);
  for (const side of [1, 0]) {
    for (;;) {
      const end = side ? pts.at(-1) : pts[0];
      const k = key({ lat: end[0], lon: end[1] });
      if (ends.get(k) !== 2) break;
      const next = byEnd.get(k).find(x => !used.has(x));
      if (!next) break;
      used.add(next);
      let g = next.geometry.map(p => [p.lat, p.lon]);
      if (key({ lat: g[0][0], lon: g[0][1] }) !== k) g = g.reverse();
      pts = side ? [...pts, ...g.slice(1)] : [...g.reverse().slice(0, -1), ...pts];
      if (!side) pts = pts; // (g reversed: it ends where pts begins)
    }
  }
  runs.push({ name: w.tags?.name || '', pts });
}
// Douglas–Peucker, metres.
const M = (a, b) => Math.hypot((a[0] - b[0]) * 111_000, (a[1] - b[1]) * 101_000);
function off(p, a, b) {
  const [ax, ay, bx, by, px, py] = [a[1] * 101_000, a[0] * 111_000, b[1] * 101_000, b[0] * 111_000, p[1] * 101_000, p[0] * 111_000];
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function thin(pts, tol = 8) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, far = tol;
    for (let k = i + 1; k < j; k++) {
      const d = off(pts[k], pts[i], pts[j]);
      if (d > far) (far = d), (best = k);
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}
function enc(pts) {
  let out = '', la = 0, lo = 0;
  const num = v => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) (s += String.fromCharCode((0x20 | (v & 0x1f)) + 63)), (v >>= 5);
    return s + String.fromCharCode(v + 63);
  };
  for (const [a, b] of pts) {
    const A = Math.round(a * 1e5), B = Math.round(b * 1e5);
    out += num(A - la) + num(B - lo);
    la = A;
    lo = B;
  }
  return out;
}
const lines = runs.map(r => ({ sys: 'tra', op: 'TRA', id: 'OSM', name: r.name, line: enc(thin(r.pts)) })).filter(l => l.line.length > 4);
const n = lines.reduce((a, l) => a + l.line.length, 0);
writeFileSync(new URL('../public/rail-tra.json', import.meta.url), JSON.stringify({ v: 1, src: 'OpenStreetMap', license: 'ODbL, © OpenStreetMap contributors', built: osm.osm3s?.timestamp_osm_base || new Date().toISOString(), lines }));
console.log(`${tra.length} ways → ${lines.length} runs, ${n} chars`);
