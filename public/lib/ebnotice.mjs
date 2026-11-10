// The cities' bus notices read by the phone itself, from the cities' own bus
// sites (one maker's GraphQL, open to browsers, no key; Jay 2026-11-10: what
// a phone can read, it reads, to spare the Worker): 臺中's (every route's
// 臨時站位, 改道… in one ask: TDX's Bus Alert, its 110 rows, ids and words,
// 2026-11-10; its 最新消息 as TDX's News) and 高雄's (the same maker's site,
// answering only Taiwan's own networks: every route's at once, or, if it
// wants a route an ask, its pack's routes in parts). Worded as the proxy
// words them (kit/ebus.mjs). A site that can't answer (a phone abroad, a
// failed read, a phone on an older kit): the proxy's, and the proxy's alone
// for 5 minutes after.

import * as ebus from '#kit/ebus.mjs';
import { pack } from './packs.mjs';

const SITES = {
  Taichung: { gql: 'https://citybus.taichung.gov.tw/ebus/graphql', dept: '臺中市政府交通局', blog: 'https://citybus.taichung.gov.tw/ebus/blog/', news: true },
  Kaohsiung: { gql: 'https://ibus.tbkc.gov.tw/ibus/graphql', dept: '高雄市政府交通局', pre: 'KHH', news: false }
};
const FRESH = 5 * 60_000;
const DOWN_MS = 5 * 60_000;
const WAIT = 8000;
const PART = 100;
const held = new Map(); // `${kind}:${city}` → { at, rows } | { going }
const downAt = new Map(); // city → when its site last failed
const perRoute = new Set(); // (cities whose site wants a route an ask)
export const resetNotices = () => (held.clear(), downAt.clear(), perRoute.clear());

// Whether the phone reads this city's notices of this kind (Alert, News) itself.
export const phoneNotices = (kind, city) => Boolean(SITES[city]) && (kind === 'Alert' || SITES[city].news) && typeof ebus.ebAlertRows === 'function';

async function gql(city, query, fetchFn) {
  const res = await fetchFn(SITES[city].gql, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout?.(WAIT) });
  if (!res.ok) throw new Error(`${city} ${res.status}`);
  const j = await res.json();
  if (j?.data) return j.data;
  throw Object.assign(new Error(`${city}: ${String(j?.errors?.[0]?.message || 'no data').slice(0, 80)}`), { said: (j?.errors || []).map(e => String(e?.message || '')) });
}
// Every route's notices → their nodes ({ id, xno, title, description }).
async function alerts(city, { fetchFn, routes }) {
  if (!perRoute.has(city)) {
    try {
      const d = await gql(city, ebus.EB_ALERTS_ASK, fetchFn);
      if (!Array.isArray(d.clogMessages?.edges)) throw new Error(`${city}: not a list`);
      return d.clogMessages.edges.map(e => e?.node);
    } catch (err) {
      // (A site that wants the route asked: each of the pack's routes, in parts.)
      if (!err?.said?.some(m => /xno/.test(m))) throw err;
      perRoute.add(city);
    }
  }
  const xs = (await routes(city)).filter(x => /^\d{1,6}$/.test(x));
  if (!xs.length) throw new Error(`${city}: no routes`);
  const parts = Array.from({ length: Math.ceil(xs.length / PART) }, (_, i) => xs.slice(i * PART, (i + 1) * PART));
  const got = await Promise.all(parts.map(p => gql(city, `query { ${p.map(x => `r${x}: clogMessages(xno: ${x}) { edges { node { id title description } } }`).join(' ')} }`, fetchFn)));
  return got.flatMap((d, i) => parts[i].flatMap(x => (d[`r${x}`]?.edges || []).map(e => ({ ...e?.node, xno: x }))));
}
// A city's routes as TDX numbers them (its pack's: 'KHH100' → '100').
const packRoutes = async city => [...((await pack(city))?.byUid?.keys() || [])].filter(u => u.startsWith(SITES[city].pre || '')).map(u => u.slice(3));

const DEPS = { fetchFn: (...a) => fetch(...a), now: () => Date.now(), routes: packRoutes };
// A city's notices (`kind`: Alert or News) in TDX's rows, kept 5 minutes; throws when its site can't say.
export async function cityNotices(kind, city, deps = {}) {
  const d = { ...DEPS, ...deps };
  if (!phoneNotices(kind, city)) throw new Error(`${city} ${kind}: not the phone's`);
  if (d.now() - (downAt.get(city) || -Infinity) < DOWN_MS) throw new Error(`${city}: down`);
  const key = `${kind}:${city}`;
  const h = held.get(key);
  if (h?.going) return h.going;
  if (h && d.now() - h.at < FRESH) return h.rows;
  const going = (async () => {
    const site = SITES[city];
    const at = d.now();
    if (kind === 'News') {
      const g = await gql(city, ebus.EB_NEWS_ASK, d.fetchFn);
      if (!Array.isArray(g.blogs?.edges)) throw new Error(`${city} news: not a list`);
      return { at, rows: ebus.ebNewsRows(g.blogs.edges.map(e => e?.node), ebus.twNow(at).slice(0, 10), at, { dept: site.dept, blog: site.blog }) };
    }
    return { at, rows: ebus.ebAlertRows(await alerts(city, d), at, site.dept) };
  })();
  const shared = going.then(x => x.rows);
  shared.catch(() => {}); // (its failure is the caller's, below)
  held.set(key, { going: shared });
  try {
    const x = await going;
    held.set(key, x);
    return x.rows;
  } catch (err) {
    held.delete(key);
    downAt.set(city, d.now());
    throw err;
  }
}
