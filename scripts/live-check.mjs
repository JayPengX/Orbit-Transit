// Trip plans checked on today's real data, for the faults that came back again
// and again (git history 10-15 → 11-16: wrong-way rides, the same way twice,
// a bus chain recommended, a way that can't be done as written,
// nothing at all, and slow first plans). Each trip of live.mjs's batch through
// the app's own planTrip (the proxy's dev door), a phone that never opened
// Transit, then every rule below; exit code 1 on a fault.
//   node scripts/live-check.mjs              the batch, leaving in 5 minutes
//   node scripts/live-check.mjs 竹東站 新竹站   one trip (live.mjs's names, or lat,lon)
//   --at HH:MM   leaving then today (Taiwan time); --by arrive with it
// Speed: first plans within FIRST_S, all within ALL_S (from the cloud the Worker
// may sit in another country: Taiwan's phones are faster, never slower).
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const FIRST_S = 6;
const ALL_S = 15;

const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const atOpt = opt('--at');
const by = opt('--by') || 'depart';
const twToday = (h, m) => { const d = new Date(Date.now() + 8 * 3600_000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 8, m); };
const at = /^\d\d?:\d\d$/.test(atOpt || '') ? twToday(...atOpt.split(':').map(Number)) : Date.now() + 5 * 60_000;
const named = args.filter((a, i) => !a.startsWith('--') && !['--at', '--by'].includes(args[i - 1]));

// live.mjs's places and batch, one list for both.
const src = readFileSync(fileURLToPath(new URL('./live.mjs', import.meta.url)), 'utf8');
const PLACES = Function(`return ${src.match(/const PLACES = (\{[\s\S]*?\n\});/)[1]}`)();
const BATCH = Function(`return ${src.match(/const BATCH = (\[[\s\S]*?\n\]);/)[1]}`)();
const point = s => {
  const ll = PLACES[s] || s.split(',').map(Number);
  if (!(ll.length === 2 && ll.every(Number.isFinite))) throw new Error(`unknown place ${s}`);
  return { name: s, lat: ll[0], lon: ll[1] };
};
const trips = named.length >= 2 ? [[named[0], named[1]]] : BATCH;

globalThis.fetch = (await import('./dev-fetch.mjs')).devFetch(globalThis.fetch);
const { useSession } = await import('../public/lib/api.mjs');
useSession({ ensureToken: async () => 'dev' });
const { planTrip } = await import('../public/lib/planner.mjs');
const { emptyData } = await import('../public/lib/store.mjs');
const { inOrder, wrongWay, planKey, sameWay } = await import('../public/lib/plan.mjs');
const { hm, rides, meters } = await import('../public/lib/util.mjs');

const say = p => `${hm(p.dep)}→${hm(p.arr)} ${p.legs.map(l => (l.mode === 'walk' ? `走${Math.round(l.dur / 60)}′` : l.mode === 'bike' ? `🚲${Math.round(l.dur / 60)}′` : `${l.mode}:${l.short || l.name || ''} ${l.from?.name || ''}→${l.to?.name || ''}`)).join(' · ')}`;
const busChain = p => rides(p).some((l, i, a) => i > 0 && l.mode === 'bus' && a[i - 1].mode === 'bus');

export function faults(res, from, to, { at, by }) {
  const out = [];
  if (res.error) return [`no plans: ${res.error.code || res.error.message}`];
  const shown = res.plans.filter(p => p.lead && !p.weak);
  const top = res.plans.filter(p => p.top);
  const km = meters(from.lat, from.lon, to.lat, to.lon) / 1000;
  if (!shown.length) return ['nothing shown'];
  if (!top.length) out.push('no recommendation');
  for (const p of shown) {
    if (!inOrder(p)) out.push(`can't be done as written: ${say(p)}`);
    if (wrongWay(p, to)) out.push(`rides the wrong way for a change: ${say(p)}`);
    if (!(p.arr > p.dep)) out.push(`arrives before it leaves: ${say(p)}`);
    if (p.arr - p.dep > Math.max(3, km / 15) * 3600_000) out.push(`takes ${Math.round((p.arr - p.dep) / 60_000)}′ for ${km.toFixed(1)} km: ${say(p)}`);
    if (by !== 'arrive' && p.dep < at - 3 * 60_000) out.push(`leaves before the time asked (${hm(at)}): ${say(p)}`);
  }
  const keys = shown.map(planKey);
  const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (twice.length) out.push(`the same plan shown twice: ${twice[0]}`);
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) if (sameWay(top[i], top[j])) out.push(`one way recommended twice: ${say(top[i])} / ${say(top[j])}`);
  if (shown.some(p => !busChain(p))) for (const p of top.filter(busChain)) out.push(`a bus then a bus recommended while there's another way: ${say(p)}`);
  // (One way alone is fine when the others make no sense: plan.mjs rank, Jay 11-15.)
  return out;
}

let bad = 0;
const times = [];
for (const [a, b] of trips) {
  const from = point(a);
  const to = point(b);
  const t0 = Date.now();
  let r, res;
  try {
    r = await planTrip(emptyData(), from, to, { at, by });
  } catch (e) {
    console.log(`✗ ${a} → ${b}\n    planTrip threw: ${e.stack?.split('\n').slice(0, 2).join(' ') || e}`);
    bad++;
    continue;
  }
  const t1 = Date.now();
  res = (await r.later) || r;
  const t2 = Date.now();
  const f = faults(res, from, to, { at, by });
  const [first, all] = [(t1 - t0) / 1000, (t2 - t0) / 1000];
  times.push([first, all]);
  if (first > FIRST_S) f.push(`first plans in ${first.toFixed(1)} s (over ${FIRST_S})`);
  if (all > ALL_S) f.push(`all plans in ${all.toFixed(1)} s (over ${ALL_S})`);
  console.log(`${f.length ? '✗' : '✓'} ${a} → ${b}  first ${first.toFixed(1)} s, all ${all.toFixed(1)} s, ${res.plans.filter(p => p.lead && !p.weak).length} shown${f.length ? `\n    ${f.join('\n    ')}` : ''}`);
  if (f.length) bad++;
}
const med = xs => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;
console.log(`\n${trips.length - bad} of ${trips.length} trips clean; median first ${med(times.map(t => t[0])).toFixed(1)} s, all ${med(times.map(t => t[1])).toFixed(1)} s`);
process.exit(bad ? 1 : 0);
