// Trips planned on today's real buses, trains and bikes, through the app's
// own planTrip (the proxy's localhost dev door: no pass), to see what the
// phone would recommend, and what a change to the ranking moves.
//   node scripts/live.mjs                      the batch below, its recommendations
//   node scripts/live.mjs 竹東站 縣體育場        one trip (names below, or lat,lon)
//   --against <ref>   the same trips on the code of <ref> (e.g. HEAD, main~1),
//                     at the same moment, and what changed between them
//   --all             every plan's card, not only the recommendations
//   --at <ms>         leaving then (default: in 5 minutes)
// Only public places here: a trip from home stays in captures/ (git-ignored).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACES = {
  竹東站: [24.73823, 121.09472], 橫山: [24.7206, 121.1162], 上員: [24.777, 121.06], 竹中站: [24.782, 121.031],
  縣體育場: [24.821, 121.0184], 竹北站: [24.8392, 121.0095], 高鐵新竹: [24.8081, 121.0403], 湖口: [24.901, 121.044],
  新豐: [24.8698, 120.9733], 新竹站: [24.8016, 120.9716], 巨城: [24.8098, 120.9747], 清大: [24.7962, 120.9967],
  竹南: [24.6866, 120.8803], 桃園站: [24.989, 121.3134], 板橋: [25.0143, 121.4635], 台北車站: [25.0478, 121.517],
  公館: [25.0147, 121.5343], 士林夜市: [25.0878, 121.5241], 台中站: [24.1372, 120.6869], 高鐵台中: [24.1121, 120.6157]
};
// Kinds of trips: short, across town, along a branch line, between cities, the metro.
const BATCH = [
  ['竹東站', '縣體育場'], ['竹東站', '新竹站'], ['竹東站', '湖口'], ['縣體育場', '竹東站'], ['橫山', '竹北站'], ['上員', '竹北站'],
  ['竹中站', '巨城'], ['高鐵新竹', '清大'], ['新豐', '竹東站'], ['湖口', '新竹站'], ['竹南', '清大'], ['桃園站', '台北車站'],
  ['板橋', '台北車站'], ['公館', '士林夜市'], ['台中站', '高鐵台中']
];

const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const against = opt('--against');
const at = Number(opt('--at')) || Date.now() + 5 * 60_000;
const all = args.includes('--all');
const named = args.filter((a, i) => !a.startsWith('--') && !['--against', '--at'].includes(args[i - 1]));
const point = s => {
  const ll = PLACES[s] || s.split(',').map(Number);
  if (!(ll.length === 2 && ll.every(Number.isFinite))) throw new Error(`unknown place ${s} (a name above, or lat,lon)`);
  return { name: s, lat: ll[0], lon: ll[1] };
};
const trips = named.length >= 2 ? [[named[0], named[1]]] : BATCH;

if (against) {
  // The other code in a worktree of its own, run at the same moment; then the two side by side.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = mkdtempSync(join(tmpdir(), 'transit-live-'));
  execFileSync('git', ['-C', here, 'worktree', 'add', '--detach', dir, against], { stdio: 'ignore' });
  try {
    symlinkSync(resolve(here, '.kit'), join(dir, '.kit'));
    const run = cwd => execFileSync('node', [join(cwd, 'scripts/live.mjs'), ...named, '--at', String(at), ...(all ? ['--all'] : [])], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
    // (The script itself from here: a ref from before it existed runs it too.)
    execFileSync('cp', [fileURLToPath(import.meta.url), join(dir, 'scripts/live.mjs')]);
    const [old, now] = [run(dir), run(here)];
    const blocks = s => new Map(s.split('\n\n').filter(Boolean).map(b => [b.split('\n')[0], b.split('\n').slice(1)]));
    const [a, b] = [blocks(old), blocks(now)];
    let changed = 0;
    for (const [trip, lines] of b) {
      const before = a.get(trip) || [];
      const gone = before.filter(l => !lines.includes(l));
      const added = lines.filter(l => !before.includes(l));
      if (!gone.length && !added.length) continue;
      changed++;
      console.log(`\n${trip}\n${gone.map(l => `- ${l}`).join('\n')}${gone.length ? '\n' : ''}${added.map(l => `+ ${l}`).join('\n')}`);
    }
    console.log(`\n${changed} of ${b.size} trips changed against ${against}. (A bus a minute off between the runs is the live data moving, not the change.)`);
  } finally {
    execFileSync('git', ['-C', here, 'worktree', 'remove', '--force', dir], { stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
}

// The proxy lets a localhost page in without a pass (worker.js TRANSIT_DEV).
const f = globalThis.fetch;
globalThis.fetch = (u, o = {}) => f(u, { ...o, headers: { ...(o.headers || {}), Origin: 'http://localhost:8080' } });
const { useSession } = await import('../public/lib/api.mjs');
useSession({ ensureToken: async () => 'dev' });
const { planTrip } = await import('../public/lib/planner.mjs');
const { emptyData } = await import('../public/lib/store.mjs');
const { hm } = await import('../public/lib/util.mjs');

const leg = x =>
  x.mode === 'walk' ? `走${Math.round(x.dur / 60)}′` : x.mode === 'bike' ? `🚲${Math.round(x.dur / 60)}′→${x.to?.name || ''}` : `${x.mode}:${x.short || x.name || ''} ${x.from?.name || ''}→${x.to?.name || ''}`;
for (const [a, b] of trips) {
  const r = await planTrip(emptyData(), point(a), point(b), { at });
  const res = (await r.later) || r;
  const shown = res.plans.filter(p => (all ? p.lead : p.top));
  console.log(`${a} → ${b}`);
  for (const p of shown) console.log(`${p.top ? '★' : p.weak ? '·' : ' '} ${String(p.score).padStart(4)} ${hm(p.dep)}→${hm(p.arr)} ${p.legs.map(leg).join(' · ')}`);
  if (!shown.length) console.log(`  nothing${res.error ? ` (${res.error.code || res.error.message})` : ''}`);
  console.log('');
}
process.exit(0);
