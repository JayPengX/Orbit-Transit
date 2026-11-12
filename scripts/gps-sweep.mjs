// Every trip × scenario × GPS profile × seed navigated (tests/gps-run.mjs), what went wrong listed.
//   node scripts/gps-sweep.mjs [--trip bus] [--scenario plan] [--profile phone] [--seeds 8] [--verbose]
const { run } = await import('../tests/gps-run.mjs');
const { TRIPS } = await import('../tests/gps-trips.mjs');
const { PROFILES } = await import('../public/lib/tripsim.mjs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const trips = arg('trip', Object.keys(TRIPS).join(',')).split(',');
const scens = arg('scenario', 'plan,late,miss,over,early,wrong,stray').split(',');
const profs = arg('profile', Object.keys(PROFILES).join(',')).split(',');
const seeds = +arg('seeds', 6);
const reopen = arg('reopen', null);
const verbose = process.argv.includes('--verbose');
let n = 0, failed = 0;
const tally = new Map();
for (const trip of trips) for (const sc of scens) for (const pr of profs) for (let seed = 1; seed <= seeds; seed++) {
  n++;
  let res;
  try { res = run(trip, sc, pr, seed, { reopenAt: reopen != null ? +reopen * 1000 : null }); } catch (e) { console.log(`${trip} ${sc} ${pr} #${seed}: THREW ${e.stack.split('\n').slice(0, 3).join(' | ')}`); failed++; continue; }
  if (res.judge.length) {
    failed++;
    for (const b of res.judge) { const key = `${trip}/${sc}: ${b.replace(/\d+s/g, 'Ns').replace(/at .*$/, '')}`; tally.set(key, (tally.get(key) || 0) + 1); }
    console.log(`${trip} ${sc} ${pr} #${seed}: ${res.judge.join(' · ')}`);
    if (verbose) console.log('   ', res.ev.filter(e => e.what !== 'act').map(e => `${Math.round((e.t - res.truth[0].t) / 1000)}s ${e.what}${e.i != null ? ` ${e.i}/${e.phase}/${e.reached}` : ''}${e.kind !== undefined ? ` ${e.kind}` : ''}`).join(' · '), '| acts', res.acts.map(a => a[0]).join(','));
  }
}
console.log(`\n${failed} of ${n} runs went wrong`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k);
