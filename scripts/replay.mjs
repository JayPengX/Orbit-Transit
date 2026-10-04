// Runs a trip from a 除錯紀錄 again, on this computer, through the ranking
// the phone ran (Quadra Pass → 除錯紀錄 → 複製紀錄 or 分享檔案, saved as
// a file): the same plans, bikes, time and settings, so what the phone
// showed is shown here, and a change to plan.mjs can be tried on it.
//   node scripts/replay.mjs <log.json> [n]   (n: which trip, from the last: 1, 2…; default all)
//   --all   every plan, the ones set aside too
//   --why   each plan's score in its parts (time, wait, bike, river…)
// Logs hold the places you went: keep them in captures/ (git-ignored), never in the repo.
import { readFile } from 'node:fs/promises';
import { withBikes, scoreParts } from '../public/lib/plan.mjs';
import { coverage, fareOf, tpassOf, inPass, passOk } from '../public/lib/tpass.mjs';
import { hm } from '../public/lib/util.mjs';

const args = process.argv.slice(2);
const all = args.includes('--all');
const why = args.includes('--why');
const [file, which] = args.filter(a => !a.startsWith('--'));
if (!file) throw new Error('usage: node scripts/replay.mjs <log.json> [n] [--all]');
const dump = JSON.parse(await readFile(file, 'utf8'));
const trips = [...(dump.log || []), ...Object.values(dump.last || {})].filter(x => x.kind === 'trip').sort((a, b) => a.at - b.at);
if (!trips.length) throw new Error('no trip in this log');
const pick = which ? [trips.at(-Number(which))] : trips;

const leg = l => (l.mode === 'walk' ? `走${Math.round((l.dur || 0) / 60)}′` : l.mode === 'bike' ? `${l.ebike ? '⚡' : '🚲'}${Math.round((l.dur || 0) / 60)}′ ${l.from?.name || ''}→${l.to?.name || ''}` : `${l.mode}:${l.short || l.name || ''} ${l.from?.name || ''}→${l.to?.name || ''}`);
for (const { data: t } of pick) {
  const cityOf = pt => (pt?.lat != null ? t.cities[`${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`] ?? null : null);
  const pass = tpassOf(t.prefs.tpass);
  const keep = inPass(t.from, t.to, pass, cityOf) ? p => passOk(p, pass, cityOf) : null;
  const cost = p => fareOf(p, coverage(p, pass, cityOf)).cost;
  const ranked = withBikes(t.plans, t.from, t.to, t.bikes, t.t0, { modes: t.prefs.modes, swap: t.prefs.bike30, cost, by: t.by, deadline: t.by === 'arrive' ? t.at : null, keep, clock: t.now });
  console.log(`\n${t.from.name} → ${t.to.name} · ${new Date(t.now).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}${t.by === 'arrive' ? ` · 抵達 ${hm(t.at)}` : t.at ? ` · 出發 ${hm(t.at)}` : ''} · ${t.plans.length} plans in, ${t.bikes.length} stations`);
  for (const p of ranked) {
    if (!all && (!p.lead || p.weak)) continue;
    const times = p.times?.length > 1 ? ` [${p.times.map(i => hm(ranked[i].dep)).join(' ')}]` : '';
    if (why) {
      const parts = scoreParts(p, { o: t.from, d: t.to, now: t.t0, by: t.by, deadline: t.by === 'arrive' ? t.at : null, fare: cost(p) });
      const sum = Object.values(parts).reduce((a, b) => a + b, 0);
      parts.freq = p.score - sum;
      console.log(`         ${Object.entries(parts).filter(([, v]) => Math.abs(v) >= 0.5).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}`);
    }
    console.log(`${p.weak ? '  ·' : p.top ? '  ★' : '   '} ${String(p.score).padStart(4)}  ${hm(p.dep)}→${hm(p.arr)}  ${p.legs.map(leg).join(' · ')}${times}${p.lead ? '' : ' (another time)'}${p.rivers?.length ? ` 過${p.rivers.join('、')}` : ''}`);
  }
  if (t.buses) console.log(`  direct buses: near you ${t.buses.near?.join(' ')} | near there ${t.buses.there?.join(' ')} | both ${t.buses.both?.join(' ')} | kept ${t.buses.kept?.join(' ')}${t.buses.why?.length ? ` | dropped: ${t.buses.why.join('; ')}` : ''}${t.buses.error ? ` | error ${t.buses.error}` : ''}`);
  if (t.ms) console.log(`  took (ms): ${Object.entries(t.ms).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  if (t.shown) console.log(`  phone showed:\n${t.shown.map(x => `    ${x}`).join('\n')}`);
}
