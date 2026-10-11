// How long a trip takes to plan, through the app's own planTrip (the
// proxy's dev door): when the first plans are in, and when all are.
//   node scripts/timing.mjs <from> <to>    (lat,lon each)
const f = globalThis.fetch;
const asked = [];
globalThis.fetch = async (u, o = {}) => {
  const t = Date.now();
  const r = await f(u, { ...o, headers: { ...(o.headers || {}), Origin: 'http://localhost:8080' } });
  asked.push([Date.now() - t, String(u).replace(/^https:\/\/[^/]+/, '').slice(0, 110)]);
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
const [a, b] = process.argv.slice(2);
const t0 = Date.now();
const r = await planTrip(emptyData(), pt(a), pt(b), { at: Date.now() + 5 * 60_000 });
const t1 = Date.now();
const res = (await r.later) || r;
const t2 = Date.now();
console.log(JSON.stringify(r.ms || {}));
console.log(`first ${((t1 - t0) / 1000).toFixed(1)} s (${r.plans.length} plans), all ${((t2 - t0) / 1000).toFixed(1)} s (${res.plans.length} plans), ${asked.length} reads`);
for (const [ms, u] of asked.sort((x, y) => y[0] - x[0]).slice(0, Number(process.argv[4]) || 12)) console.log(String(ms).padStart(6), u);
process.exit(0);
