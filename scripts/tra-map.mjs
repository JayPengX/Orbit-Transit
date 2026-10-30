// 台鐵's lines as the station picker draws them (public/lib/tra-map.mjs):
// each region's stretch of the trunk lines in order, the branch lines
// hanging off the station where they leave. TDX's Line and StationOfLine,
// through the proxy; run again when 台鐵 opens or closes a station.
//   node scripts/tra-map.mjs

import { writeFileSync } from 'node:fs';
import { traStations } from '../public/lib/rail.mjs';
import { REGIONS } from '../public/lib/tra-regions.mjs';

const PROXY = 'https://orbit-workers-proxy.pengzjay.workers.dev/transit/tdx?p=';
const get = async path => {
  const r = await fetch(PROXY + encodeURIComponent(path), { headers: { Origin: 'http://localhost:8123' } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};
// In the order drawn: the trunk lines first, a branch after the line it leaves.
const LINES = [
  ['WL', '西部幹線', 'Western Line'],
  ['WL-C', '海線', 'Coast Line'],
  ['EL', '東部幹線', 'Eastern Line'],
  ['SL', '南迴線', 'South-Link Line'],
  ['SU', '蘇澳線', 'Su-ao Line'],
  ['SA', '深澳線', 'Shen-ao Line'],
  ['PX', '平溪線', 'Pingxi Line'],
  ['NW', '內灣線', 'Neiwan Line'],
  ['LJ', '六家線', 'Liujia Line'],
  ['JJ', '集集線', 'Jiji Line'],
  ['SH', '沙崙線', 'Shalun Line']
];
const BRANCH = new Set(['WL-C', 'SU', 'SA', 'PX', 'NW', 'LJ', 'JJ', 'SH']);

const [stationsJ, solJ] = await Promise.all([get('basic/v3/Rail/TRA/Station'), get('basic/v3/Rail/TRA/StationOfLine')]);
// (臺北-環島 is the round-the-island ticket's, not a platform.)
const byId = new Map(traStations(stationsJ).filter(s => !s.name.includes('-')).map(s => [s.id, s]));
const lineIds = id => (solJ.StationOfLines.find(l => l.LineID === id)?.Stations || []).map(x => x.StationID).filter(x => byId.has(x));
const regionOf = id => Object.keys(REGIONS).find(r => REGIONS[r].includes(byId.get(id).city));

const out = {};
for (const region of Object.keys(REGIONS)) {
  const placed = new Set();
  const parts = [];
  for (const [id, zh, en] of LINES) {
    // The line's stretches inside the region.
    const runs = [];
    for (const s of lineIds(id)) {
      if (regionOf(s) !== region) runs.push([]);
      else (runs.at(-1) || runs[runs.push([]) - 1]).push(s);
    }
    for (let run of runs.filter(r => r.length)) {
      // Read on from a station already drawn (turned round if the stretch reaches it at its far end);
      // a branch hangs off that station.
      if (!placed.has(run[0]) && placed.has(run.at(-1))) run = run.reverse();
      const at = placed.has(run[0]) ? run[0] : null;
      const ids = run.filter(s => !placed.has(s));
      if (!ids.length) continue;
      ids.forEach(s => placed.add(s));
      parts.push({ line: id, zh, en, at, branch: BRANCH.has(id), ids });
    }
  }
  const missing = [...byId.values()].filter(s => REGIONS[region].includes(s.city) && !placed.has(s.id));
  if (missing.length) console.warn(region, 'on no line:', missing.map(s => s.name).join(' '));
  out[region] = parts;
  for (const p of parts) console.log(region, p.zh, p.at ? `@${byId.get(p.at).name}` : '', p.ids.map(s => byId.get(s).name).join(' '));
}

writeFileSync(
  new URL('../public/lib/tra-map.mjs', import.meta.url),
  `// Made by scripts/tra-map.mjs (TDX ${new Date().toISOString().slice(0, 10)}): don't edit by hand.\n// Each region's 台鐵 lines in order; \`at\`: the station a stretch goes on from\n// (a branch hangs off it; a trunk line's stretch is its own line after).\nexport const TRA_MAP = ${JSON.stringify(out)};\n`
);
