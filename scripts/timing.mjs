// How long a trip takes to plan, through the app's own planTrip (the
// proxy's dev door): when the first plans are in, and when all are; and how
// many asks of the Worker it took, by kind (each a Worker request, and a TDX
// or Google call behind it unless the Worker had it).
//   node scripts/timing.mjs <from> <to> [n]   (lat,lon each; n: the n slowest asks listed)
//   --warm   the same trip twice on one phone (scripts/phone.mjs): a phone that
//            never opened Transit, then the same phone opening it again (its
//            stations, timetables, fares and packs kept), the second the usual
//            day's cost (2026-11-06, 竹東 → 縣體育場: 117 asks new, 32 again;
//            with a plan's buses batched, 75–85 and 26–30)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.includes('--warm')) {
  const dir = mkdtempSync(join(tmpdir(), 'transit-phone-'));
  const run = () => execFileSync('node', [fileURLToPath(import.meta.url), ...args.filter(a => a !== '--warm')], { env: { ...process.env, PHONE_DIR: dir }, encoding: 'utf8', maxBuffer: 1 << 24 });
  try {
    console.log(`== a new phone\n${run()}\n== the same phone again\n${run()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
}
await import('./phone.mjs');

const f = globalThis.fetch;
const asked = [];
globalThis.fetch = async (u, o = {}) => {
  const t = Date.now();
  const r = await f(u, { ...o, headers: { ...(o.headers || {}), Origin: 'http://localhost:8080' } });
  asked.push([Date.now() - t, String(u)]);
  return r;
};
const { useSession } = await import('../public/lib/api.mjs');
useSession({ ensureToken: async () => 'dev' });
const { planTrip } = await import('../public/lib/planner.mjs');
const { emptyData } = await import('../public/lib/store.mjs');
const pt = s => {
  const [lat, lon] = s.split(',').map(Number);
  return { name: s, lat, lon };
};
const [a, b, n] = args;
const t0 = Date.now();
const r = await planTrip(emptyData(), pt(a), pt(b), { at: Date.now() + 5 * 60_000 });
const t1 = Date.now();
const res = (await r.later) || r;
await r.pending?.catch?.(() => {});
const t2 = Date.now();
console.log(JSON.stringify(r.ms || {}));
const worker = asked.filter(([, u]) => /workers\.dev|jaypengx\.com/.test(u));
console.log(`first ${((t1 - t0) / 1000).toFixed(1)} s (${r.plans.length} plans), all ${((t2 - t0) / 1000).toFixed(1)} s (${res.plans.length} plans), ${asked.length} reads, ${worker.length} of the Worker`);
// The Worker's asks by kind: the route, and a TDX read's kind of data (its path to the city).
const kinds = new Map();
for (const [, u] of worker) {
  const url = new URL(u);
  const p = url.searchParams.get('p');
  const k = url.pathname.replace(/^\/api/, '') + (p ? ` ${p.split('?')[0].split('/').slice(1, 4).join('/')}` : url.pathname.startsWith('/data/') ? '' : '');
  const key = url.pathname.startsWith('/data/') ? '/data/…' : k;
  kinds.set(key, (kinds.get(key) || 0) + 1);
}
for (const [k, c] of [...kinds].sort((x, y) => y[1] - x[1])) console.log(String(c).padStart(5), k);
for (const [ms, u] of asked.sort((x, y) => y[0] - x[0]).slice(0, Number(n) || 12)) console.log(String(ms).padStart(6), u.replace(/^https:\/\/[^/]+/, '').replace(/&qt=[^&]*/, '').slice(0, 110));
process.exit(0);
