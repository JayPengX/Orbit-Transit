// A trip navigated on the phone, driven again fix by fix through today's
// navigation (tests/navreplay.mjs): the steps it moved on to and the trouble
// cards it showed then, beside what it does now. The trip from 除錯紀錄
// (Orbit Pass → 除錯紀錄 → 複製紀錄 or 分享檔案, saved as a file; its
// `navtrip` entries).
//   node scripts/replay-nav.mjs <log.json> [n]   (n: which trip, from the last: 1, 2…; default the last)
// Logs hold the places you went: keep them in captures/ (git-ignored), never
// in the repo. A trip worth keeping as a test: its route made with
// scripts/trip-fixture.mjs, nobody's own places in it.
import { readFile } from 'node:fs/promises';

const [file, which = '1'] = process.argv.slice(2);
if (!file) throw new Error('usage: node scripts/replay-nav.mjs <log.json> [n]');
const dump = JSON.parse(await readFile(file, 'utf8'));
const trips = [...(dump.log || []), ...Object.values(dump.last || {})].filter(x => x.kind === 'navtrip').sort((a, b) => a.at - b.at);
if (!trips.length) throw new Error('no navigated trip in this log (除錯紀錄 on while navigating)');
const trace = trips.at(-Number(which)).data;
const { replay } = await import('../tests/navreplay.mjs');
const r = await replay(trace);
const steps = list => list.map(([s, i, ph]) => `${s != null ? `${Math.round(s / 60)}′ ` : ''}${i}${ph === 'on' ? ' 上車' : ''}`).join(' → ') || '—';
const legs = trace.plan.legs.map((l, k) => `${k} ${l.mode}${l.short ? ` ${l.short}` : ''} ${l.from?.name || ''}→${l.to?.name || ''}`).join('\n  ');
console.log(`trip, ${trace.fixes.length} fixes:\n  ${legs}`);
console.log(`then: ${steps(trace.steps)}   cards: ${trace.trouble.map(x => x[1]).join(', ') || '—'}`);
console.log(`now:  ${steps(r.st.trace.steps)}   cards: ${r.trouble.join(', ') || '—'}${r.st.done ? '   (there)' : ''}`);
process.exit(0);
