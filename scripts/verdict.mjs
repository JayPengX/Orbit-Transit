// The owner's verdicts kept as cases every ranking change must pass: a trip
// planned on the day's real buses, trains and bikes (the proxy's dev door),
// its plans and bikes before ranking saved as tests/verdicts/<name>.json;
// tests/verdicts.test.mjs ranks them again and checks what the owner said.
//   node scripts/verdict.mjs <name> <from> <to> [--at <ISO time>] [--arrive <ISO time>] [--no-bike] [--tpass <id>]
// Places: a name in scripts/live.mjs or lat,lon. Only public places here (a
// trip from home stays in captures/, git-ignored).
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const f = globalThis.fetch;
globalThis.fetch = (u, o = {}) => f(u, { ...o, headers: { ...(o.headers || {}), Origin: 'http://localhost:8080' } });
const { useSession } = await import('../public/lib/api.mjs');
useSession({ ensureToken: async () => 'dev' });
const { planTrip } = await import('../public/lib/planner.mjs');
const { emptyData } = await import('../public/lib/store.mjs');
const { recDump } = await import('#kit/quadra.mjs');

const PLACES = { 竹東高中: [24.733, 121.0882], 成功九街: [24.8176, 121.0165], 成功九街北: [24.81788, 121.01603], 新竹站: [24.8016, 120.9716], 六家站: [24.8078, 121.039], 竹東站: [24.73823, 121.09472], 縣體育場: [24.821, 121.0184] };
const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const [name, a, b] = args.filter((x, i) => !x.startsWith('--') && !['--at', '--arrive', '--tpass'].includes(args[i - 1]));
const point = s => {
  const ll = PLACES[s] || s.split(',').map(Number);
  if (!(ll.length === 2 && ll.every(Number.isFinite))) throw new Error(`unknown place ${s}`);
  return { name: s, lat: ll[0], lon: ll[1] };
};
if (!name || !a || !b) throw new Error('usage: node scripts/verdict.mjs <name> <from> <to> [--at ISO] [--arrive ISO] [--no-bike] [--tpass id]');
const data = emptyData();
if (opt('--tpass')) data.prefs = { ...data.prefs, tpass: opt('--tpass') };
if (args.includes('--no-bike')) data.prefs = { ...data.prefs, modes: { ...data.prefs.modes, bike: false } };
const by = opt('--arrive') ? 'arrive' : 'depart';
const at = opt('--arrive') || opt('--at') ? new Date(opt('--arrive') || opt('--at')).getTime() : Date.now() + 5 * 60_000;
const r = await planTrip(data, point(a), point(b), { at, by });
await r.later;
const trip = JSON.parse(recDump('transit')).last?.trip?.data;
if (!trip) throw new Error('no trip recorded');
const out = join(dirname(fileURLToPath(import.meta.url)), '../tests/verdicts', `${name}.json`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(trip));
console.log(`${out}: ${trip.plans.length} plans, ${trip.bikes.length} stations`);
process.exit(0);
