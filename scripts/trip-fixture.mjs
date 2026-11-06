// Navigation traces for tests/nav-replay.test.mjs, made from 快捷8號's real
// route (TDX's stops and shape, tests/fixtures/k8-gps-2026-11-03) at a bus's
// real pace, so a replay drives the same geometry a phone would: nobody's own
// places in them (a real trip's 除錯紀錄 stays in captures/, git-ignored).
//   node scripts/trip-fixture.mjs   (writes tests/fixtures/trips/k8-*.json)
import { readFile, writeFile } from 'node:fs/promises';
import { decodeLine, meters } from '../public/lib/util.mjs';

const dir = new URL('../tests/fixtures/k8-gps-2026-11-03/', import.meta.url);
const ways = JSON.parse(await readFile(new URL('ways.json', dir), 'utf8'));
const shape = JSON.parse(await readFile(new URL('shape.json', dir), 'utf8'));
const stop = (d, name) => {
  const s = ways.find(w => w.Direction === d).Stops.find(x => x.StopName.Zh_tw === name);
  return { name, lat: s.StopPosition.PositionLat, lon: s.StopPosition.PositionLon };
};
const line = d => decodeLine(shape[`HSQ0747|${d}`][0][1]).map(([lat, lon]) => ({ lat, lon }));
// The shape from the point nearest `a` to the one nearest `b`.
const cut = (pts, a, b) => {
  const near = p => pts.reduce((k, q, n) => (meters(p.lat, p.lon, q.lat, q.lon) < meters(p.lat, p.lon, pts[k].lat, pts[k].lon) ? n : k), 0);
  const [i, j] = [near(a), near(b)];
  return i <= j ? pts.slice(i, j + 1) : pts.slice(j, i + 1).reverse();
};
// Fixes every `every` s along `pts` at `ms` metres a second, from second `t`.
function along(pts, ms, t, every = 5) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + meters(pts[k - 1].lat, pts[k - 1].lon, pts[k].lat, pts[k].lon));
  const out = [];
  for (let x = ms * every, k = 1; x <= cum.at(-1); x += ms * every) {
    while (cum[k] < x) k++;
    const f = (x - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
    const [a, b] = [pts[k - 1], pts[k]];
    out.push([(t += every), +(a.lat + (b.lat - a.lat) * f).toFixed(6), +(a.lon + (b.lon - a.lon) * f).toFixed(6), 10]);
  }
  return out;
}
const t0 = Date.parse('2026-11-03T18:00:00+08:00');
const at = m => t0 + m * 60_000;
const A = stop(1, '文興嘉興路口');
const B = stop(1, '台鐵竹中站');
const ride = cut(line(1), A, B);
const off = (p, n) => ({ lat: +(p.lat + n / 110_540).toFixed(6), lon: p.lon });
const D = { name: '竹中', ...off(B, 150) };
const plan = {
  dep: at(0),
  arr: at(32),
  dest: D,
  legs: [
    { mode: 'bus', name: '快捷8號', short: '快捷8號', from: A, to: B, dep: at(2), arr: at(28), dur: 1560, path: ride.map(p => [p.lat, p.lon]) },
    { mode: 'walk', from: B, to: D, dep: at(28), arr: at(32), dur: 240 }
  ]
};
// Waiting at the stop two minutes (a fix every 20 s).
const wait = Array.from({ length: 6 }, (_, n) => [n * 20, +(A.lat + 0.00002 * (n % 2)).toFixed(6), A.lon, 12]);
const base = { v: 1, t0, here: { lat: A.lat, lon: A.lon }, resume: null, plan };
// On the right one: along its way at 9 m/s, off at 台鐵竹中站, the walk to the place.
const right = along(ride, 9, 120);
const walkOff = along([B, D], 1.3, right.at(-1)[0]);
// On the wrong one: the same stop's other side, 快捷8號 the other way (toward 竹北).
const back = cut(line(0), stop(0, '文興嘉興路口'), stop(0, '家樂福'));
const wrong = along(back, 9, 120);
const out = {
  'k8-right-bus': { ...base, fixes: [...wait, ...right, ...walkOff], expect: { steps: [[0, 'on'], [1, 'before']], trouble: [], done: true } },
  'k8-wrong-way': { ...base, fixes: [...wait, ...wrong], expect: { steps: [], trouble: ['wrong'], done: false } }
};
for (const [name, trace] of Object.entries(out)) await writeFile(new URL(`../tests/fixtures/trips/${name}.json`, import.meta.url), JSON.stringify(trace) + '\n');
console.log(Object.entries(out).map(([n, x]) => `${n}: ${x.fixes.length} fixes`).join('\n'));
