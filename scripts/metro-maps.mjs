// The metro maps' drawings, worked out here once (many tries, the best
// kept) instead of on every phone: writes public/lib/metro-drawings.mjs.
// A phone uses a drawing while TDX's stations and track still match it
// (its `sig`), else works one out itself (one try) and keeps it.
//   node scripts/metro-maps.mjs [tries=40]
// Reads TDX through the Worker's dev door (a localhost origin, as preview.mjs does).
import { writeFileSync } from 'node:fs';
import { MAPS, parseSystem } from '../public/lib/metro.mjs';
import { schematic, faults } from '../public/lib/metromap.mjs';

const tries = Number(process.argv[2] || 40);
const PROXY = 'https://orbit-workers-proxy.pengzjay.workers.dev/transit/tdx?p=';
const get = async path => {
  const r = await fetch(PROXY + encodeURIComponent(path), { headers: { Origin: 'http://localhost:8123' } });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};
const TRANSFERS = new Set(['TRTC', 'NTMC', 'KRTC']);
const load = async sys => {
  const [st, of, ln, ro, tr] = await Promise.all([
    get(`basic/v2/Rail/Metro/Station/${sys}`),
    get(`basic/v2/Rail/Metro/StationOfLine/${sys}`),
    get(`basic/v2/Rail/Metro/Line/${sys}`),
    get(`basic/v2/Rail/Metro/StationOfRoute/${sys}`).catch(() => []),
    TRANSFERS.has(sys) ? get(`basic/v2/Rail/Metro/LineTransfer/${sys}`).catch(() => []) : []
  ]);
  return parseSystem(sys, st, of, ln, ro, tr);
};

const out = {};
for (const m of MAPS) {
  const systems = await Promise.all(m.systems.map(load));
  let best = null;
  for (const tune of [{}, { hold: 0.015 }, { fisheye: 0.5 }])
    for (let seed = 0; seed < tries; seed++) {
      const map = schematic(systems, { seed, ...tune });
      const f = faults(map);
      if (!best || f.cost < best.f.cost) best = { map, f, seed, tune };
    }
  out[m.id] = { sig: best.map.sig, pos: best.map.pos };
  console.log(m.id, JSON.stringify(best.f), 'seed', best.seed, JSON.stringify(best.tune));
}
writeFileSync(
  new URL('../public/lib/metro-drawings.mjs', import.meta.url),
  `// Made by scripts/metro-maps.mjs: each city's metro map, worked out once (see metromap.mjs).\nexport default ${JSON.stringify(out)};\n`
);
