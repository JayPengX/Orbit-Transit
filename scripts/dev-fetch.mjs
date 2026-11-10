// The proxy's dev door for our scripts (a localhost Origin, no pass), its
// answers shared with every other tool run through Orbit-Core's keep
// (tools/live-keep.mjs: each address asked once in 5 minutes): on 11-10 our
// own tools sent nine in ten of the Workers' requests, and the Free plan has
// 100,000 a day for everything. A kept answer's X-Transit-Age counts the time
// it was kept, so a bus's estimate counts down from when it was made.
// ORBIT_LIVE_KEEP=off asks every time. (timing.mjs and bus-rhythm.mjs time
// the live answers themselves: they ask every time.)
const ORIGIN = 'http://localhost:8080';
const lk = await import('../../Orbit-Core/tools/live-keep.mjs').catch(() => null);

export function devFetch(f = globalThis.fetch, { now = Date.now } = {}) {
  // (The keep asks with `f`, never the fetch this replaces: it would ask itself.)
  const keep = lk?.liveKeep.on ? lk.makeKeep({ dir: lk.liveKeep.dir, ttlS: lk.liveKeep.ttl / 1000, fetchFn: (...a) => f(...a) }) : null;
  // (One ask an address at a time in this run: the keep's lock would have it wait on itself.)
  const asking = new Map();
  return async (u, o = {}) => {
    const headers = { ...(o.headers || {}), Origin: ORIGIN };
    const url = String(u?.url || u);
    if (!keep || (o.method && o.method !== 'GET') || !/^https:\/\/[^/]*(workers\.dev|jaypengx\.com)\//.test(url)) return f(u, { ...o, headers });
    if (!asking.has(url)) asking.set(url, keep.liveFetch(url, { headers }).finally(() => asking.delete(url)));
    const got = asking.get(url);
    const r = await (o.signal ? Promise.race([got, new Promise((_, no) => (o.signal.aborted ? no(o.signal.reason) : o.signal.addEventListener('abort', () => no(o.signal.reason), { once: true })))]) : got);
    const h = new Headers(r.headers);
    const age = Number(h.get('x-transit-age'));
    if (r.kept && r.at && Number.isFinite(age)) h.set('x-transit-age', String(Math.round(age * 10 + (now() - r.at) / 100) / 10));
    return new Response(r.status === 204 || r.status === 304 ? null : r.body, { status: r.status, headers: h });
  };
}
