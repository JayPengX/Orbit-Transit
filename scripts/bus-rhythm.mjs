// How often a stop card asks for its buses, and how soon each new estimate
// shows, through the app's own busEta (public/lib/api.mjs):
//   node scripts/bus-rhythm.mjs           against a model of TDX and the Worker, an hour of beats,
//                                         beside today's phone (every beat, the Worker's copy and a read behind it)
//   node scripts/bus-rhythm.mjs --live [s] against the live Worker (the dev door), 新竹站's three cities, s seconds
// The model: a city's estimates every 30.3 s (DataTime to the second), readable at TDX 7 s later ± J;
// a small stop's rows sit some out; the Worker's copy per address (fresh 10 s, stale 60 s, had=).
// 2026-11-06: 18 asks a minute → 7–9, each new estimate shown ~10 s sooner, none later.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = new URL('../public/lib/api.mjs', import.meta.url).href;
const args = process.argv.slice(2);
const SETS = {
  Hsinchu: 'HSZ291256,HSZ291301,HSZ291405,HSZ291740,HSZ291746,HSZ291747,HSZ291748,HSZ293711,HSZ296970,HSZ296971,HSZ298898,HSZ298899,HSZ299153,HSZ299155,HSZ304259,HSZ310266,HSZ310267,HSZ311555'.split(','),
  HsinchuCounty: ['HSQ290813', 'HSQ290819', 'HSQ311410'],
  InterCity: ['THB290782', 'THB290816']
};

if (args[0] === '--live') {
  await import('./phone.mjs');
  const f = globalThis.fetch;
  const t0 = Date.now();
  const log = [];
  globalThis.fetch = async (u, o = {}) => {
    const r = await f(u, { ...o, headers: { ...(o.headers || {}), Origin: 'http://localhost:8080' } });
    if (String(u).includes('/transit/eta')) {
      const rows = await r.clone().json().catch(() => []);
      const newest = Math.max(0, ...(Array.isArray(rows) ? rows : []).map(x => Date.parse(x.DataTime) || 0));
      const q = new URL(u).searchParams;
      log.push(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s  ${q.get('city').padEnd(14)} had ${String(q.get('had') || '-').padStart(3)}  age ${String(r.headers.get('x-transit-age')).padStart(4)}  newest ${newest ? new Date(newest + 8 * 3600e3).toISOString().slice(11, 19) : '-'}`);
    }
    return r;
  };
  const api = await import(API);
  api.useSession({ ensureToken: async () => 'dev' });
  const total = Number(args[1]) || 180;
  for (let s = 0; s < total; s += 10) {
    const b = Date.now();
    await Promise.all(Object.entries(SETS).map(([c, st]) => api.busEta(c, { stops: st }).catch(() => null)));
    await new Promise(r => setTimeout(r, Math.max(0, 10_000 - (Date.now() - b))));
  }
  console.log(log.join('\n'));
  console.log(`${log.length} asks in ${total} s: ${((log.length * 60) / total).toFixed(1)} a minute (every beat: ${((Object.keys(SETS).length * 60) / 10).toFixed(0)})`);
  process.exit(0);
}

if (args[0] === '--one') {
  // One hour on a fake clock: [J (s), sit-out share, seed, 'today' | 'new'].
  const [J, SKIP, SEED] = args.slice(1, 4).map(Number);
  const MODE = args[4];
  let seed = SEED;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let clock = Date.parse('2026-11-06T04:00:00Z');
  Date.now = () => clock;
  const pubs = [];
  for (let P = clock - 120_000 + rnd() * 30_000; P < clock + 3600_000 + 120_000; P += 30_300) pubs.push({ d: Math.floor(P / 1000) * 1000, V: P + 7000 + (rnd() * 2 - 1) * J * 1000 });
  for (let i = 1; i < pubs.length; i++) pubs[i].V = Math.max(pubs[i].V, pubs[i - 1].V + 1);
  const skip = { Hsinchu: 0, HsinchuCounty: SKIP, InterCity: SKIP };
  const has = Object.fromEntries(Object.keys(skip).map(c => [c, pubs.map(() => rnd() >= skip[c])]));
  const tdxNow = (city, t) => pubs.reduce((d, p, i) => (p.V <= t && has[city][i] ? p.d : d), 0);
  const copies = new Map();
  let asks = 0;
  let reads = 0;
  globalThis.fetch = async url => {
    const u = new URL(url);
    const city = u.searchParams.get('city');
    const had = Number(u.searchParams.get('had')) || 0;
    const key = `${city}|${u.searchParams.get('stops')}`;
    asks++;
    const c = copies.get(key);
    const age = c ? clock - c.at : Infinity;
    let d = 0;
    let out = 0;
    if (c && age < (had ? Math.min(10_000, had * 1000 - 1500) : 10_000)) [d, out] = [c.d, age];
    else if (c && !had && age < 60_000) {
      [d, out] = [c.d, age];
      copies.set(key, { at: clock, d: tdxNow(city, clock) });
      reads++;
    } else {
      d = tdxNow(city, clock);
      copies.set(key, { at: clock, d });
      reads++;
    }
    const rows = d ? [{ StopUID: `${city}1`, RouteUID: `${city}R`, EstimateTime: 120, DataTime: new Date(d).toISOString() }] : [];
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json', 'X-Transit-Age': String(Math.round(out / 100) / 10) } });
  };
  const api = await import(API);
  api.useSession({ ensureToken: async () => 'tok' });
  const shown = {};
  const t0 = clock;
  for (let t = t0; t < t0 + 3600_000; t += 10_000 + rnd() * 10) {
    clock = t;
    for (const city of Object.keys(skip)) {
      const got =
        MODE === 'today'
          ? { rows: await (await fetch(`https://w/transit/eta?city=${city}&stops=${SETS[city].join(',')}`)).json() }
          : await api.busEta(city, { stops: SETS[city] });
      const d = Math.max(0, ...got.rows.map(r => Date.parse(r.DataTime) || 0));
      shown[city] ||= {};
      if (d && !(d in shown[city])) shown[city][d] = clock;
    }
  }
  console.log(JSON.stringify({ asks: asks / 60, reads: reads / 60, shown }));
  process.exit(0);
}

const run = (J, skip, seed, mode) => JSON.parse(execFileSync('node', [fileURLToPath(import.meta.url), '--one', J, skip, seed, mode], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').pop());
for (const [J, skip] of [[0, 0], [2, 0], [2, 0.25], [5, 0.25]]) {
  const sum = { today: [0, 0], now: [0, 0] };
  let n = 0;
  let later = 0;
  let sooner = 0;
  let gain = 0;
  for (const seed of [1, 2, 3]) {
    const t = run(J, skip, seed, 'today');
    const x = run(J, skip, seed, 'new');
    sum.today[0] += t.asks / 3;
    sum.today[1] += t.reads / 3;
    sum.now[0] += x.asks / 3;
    sum.now[1] += x.reads / 3;
    for (const city of Object.keys(t.shown)) {
      for (const [d, at] of Object.entries(t.shown[city])) {
        // When the new phone first showed this estimate or a newer one.
        const first = Math.min(...Object.entries(x.shown[city] || {}).filter(([d2]) => Number(d2) >= Number(d)).map(([, a]) => a));
        if (!Number.isFinite(first)) continue;
        n++;
        gain += at - first;
        if (first - at > 500) later++;
        else if (at - first > 500) sooner++;
      }
    }
  }
  console.log(`TDX ±${J} s, small stops sit out ${skip * 100}%: asks a minute ${sum.today[0].toFixed(1)} → ${sum.now[0].toFixed(1)}, TDX reads ${sum.today[1].toFixed(1)} → ${sum.now[1].toFixed(1)}; each new estimate shown sooner ${Math.round((100 * sooner) / n)}%, later ${((100 * later) / n).toFixed(1)}%, ${(gain / n / 1000).toFixed(1)} s sooner on average`);
}
