// A bus ride's fare, stop to stop (a route's 票價; Jay 2026-11-09: "Add
// stop-to-stop bus fare lookup"). The route's fares as its operator
// publishes them (TDX RouteFare through the proxy, a route at a time, kept
// a week: fares change once in years). A route is priced one of three ways
// (FarePricingType):
//   0 段次: the route cut into sections, a fare each; round each line
//     between two sections a buffer zone of stops (緩衝區): getting on or
//     off inside it, that line isn't paid for;
//   1 OD: a fare for each pair of stops (公路客運);
//   2 stages: a fare for each pair of stages, a stop in the stage it's in.
// fareBetween → { kind, sections?, about?, unsure?, fares: [{ who, ticket, price }] } or null
// (nothing published for that ride).

import { tdx, rows } from './api.mjs';
import { INTERCITY } from './bus.mjs';
import { meters } from './util.mjs';

const scope = city => (city === INTERCITY ? 'InterCity' : `City/${city}`);

// TDX's codes (as its rail fares': TicketType 1 一般票, 3 電子票證; FareClass 1 成人 …;
// 10 半票, as the 公路客運 and 新竹's publish their one fare for 孩童, 敬老 and
// 愛心, named so: 「半票_不分時段_四排座」). Any other class isn't said.
export const TICKET = { 1: 'cash', 3: 'card' };
export const WHO = { 1: 'adult', 2: 'student', 3: 'child', 4: 'elder', 5: 'care', 10: 'half' };

// The route's fare rows (v3's Tainan answers in an object: rows()).
export async function routeFares(route) {
  const v = route.city === 'Tainan' ? 'v3' : 'v2';
  const j = await tdx(`basic/${v}/Bus/RouteFare/${scope(route.city)}/${encodeURIComponent(route.name)}`, { fresh: 7 * 86_400_000, persist: true });
  const list = rows(j);
  const id = String(route.uid || '').replace(/^[A-Z]{3}/, '');
  const mine = list.filter(r => r.RouteUID === route.uid || (id && String(r.RouteID) === id));
  return mine.length ? mine : list;
}

const idOf = uid => String(uid || '').replace(/^[A-Z]{3}/, '');
const nameOf = n => (typeof n === 'string' ? n : n?.Zh_tw || '');
// (A stop from a bus pack has no StopID: its StopUID is the city's code and it.)
const sameStop = (x, s) => Boolean(x) && ((x.StopID != null && String(x.StopID) === String(s.id ?? idOf(s.uid))) || (x.StopUID != null && x.StopUID === s.uid) || nameOf(x.StopName) === s.name);
const at = (stops, x) => stops.findIndex(s => sameStop(x, s));
const priceList = fares =>
  (fares || [])
    .map(f => ({ ticket: TICKET[f.TicketType] || `t${f.TicketType}`, who: WHO[f.FareClass] || `c${f.FareClass}`, price: Number(f.Price), name: f.FareName || '' }))
    .filter(f => Number.isFinite(f.price) && f.price >= 0);
const byDir = (list, dir) => {
  const own = list.filter(x => x.Direction == null || Number(x.Direction) === dir);
  return own.length ? own : list;
};
// A section count named in a fare's name (二段票, 2段): the ones for that many.
const SEG = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const segsIn = name => {
  const m = /([一二兩三四五六1-6])\s*段/.exec(name || '');
  return m ? SEG[m[1]] || Number(m[1]) : null;
};

// The rows for one way of the route: its own sub-route's, else those for all.
function forWay(list, way) {
  const sub = idOf(way.sub);
  const own = list.filter(r => sub && (r.SubRouteUID === way.sub || String(r.SubRouteID || '') === sub));
  if (own.length) return own;
  const all = list.filter(r => r.IsForAllSubRoutes !== false && r.IsForAllSubRoutes !== 0);
  return all.length ? all : list;
}

// From stop `a` to stop `b` (`way`'s stops, a before b).
// A ride longer than one section is likely to be (a section is about 10 km
// on 臺北's and 新北's routes that publish theirs).
const LONG_SECTION_M = 15_000;
const rideMeters = (stops, i, j) => {
  let m = 0;
  for (let k = i; k < j; k++) if (stops[k].lat != null && stops[k + 1].lat != null) m += meters(stops[k].lat, stops[k].lon, stops[k + 1].lat, stops[k + 1].lon);
  return m;
};
// The sections of a ride by a city's own list of the route's fare (the
// pack's, builders/ntpc.js fareOf: [sections, [lines going], [lines back]],
// a line the stops of its buffer zone or a place's name): the lines it
// crosses, each found among the way's stops by name. Every line found and
// as many as the sections between: so many; else the whole way its
// sections, a part of it about its share by distance (988's 淡江大橋 is no
// stop's name, and its four sections have two lines: Jay 11-16).
const ROAD = /國道|高速|北二高|北宜|快速|高架|交流道|橋|^台\d|^省道|高公局/;
const bare = t => String(t || '').replace(/\[[^\]]*\]|[\s()（）]/g, '');
export function ownSections(own, way, ia, ib) {
  const [n, go, back] = own;
  const stops = way.stops || [];
  const names = stops.map(s => bare(s.name));
  const one = (x, from) => {
    if (!x) return -1;
    const k = names.findIndex((y, i) => i >= from && y === x);
    return k >= 0 ? k : names.findIndex((y, i) => i >= from && (y.includes(x) || (y.length >= 3 && x.includes(y))));
  };
  // (A name may be two, a space between: 「捷運永寧站 佳和公園」.)
  const find = (t, from = 0) => {
    for (const x of [bare(t), ...String(t || '').split(/\s+/).map(bare)]) {
      const k = one(x, from);
      if (k >= 0) return k;
    }
    return -1;
  };
  const zones = (Number(way.dir) === 1 ? back : go).map(([a, b]) => {
    const i = find(a);
    const j = b ? (find(b, Math.max(0, i)) >= 0 ? find(b, Math.max(0, i)) : find(b)) : i;
    // (One end on this way and not the other: the line at it, the rest past
    // where a branch ends: 878's 捷運淡水站-新市一路 on its way to 淡水.)
    if (i < 0 !== j < 0 && b) return [Math.max(i, j), Math.max(i, j)];
    return i >= 0 && j >= 0 ? [Math.min(i, j), Math.max(i, j)] : null;
  });
  // A highway or a bridge no stop is named for (國道3號, 北二高, 高公局,
  // 淡江大橋): the way's longest hop between two stops no other line is at.
  const taken = new Set(zones.filter(Boolean).flatMap(([p, q]) => [p - 1, p, q, q + 1]));
  const hops = stops.slice(0, -1).map((_, k) => [k, rideMeters(stops, k, k + 1)]).sort((x, y) => y[1] - x[1]);
  (Number(way.dir) === 1 ? back : go).forEach(([a, b], z) => {
    if (zones[z] || b || !ROAD.test(a)) return;
    const hop = hops.find(([k, m]) => m > 1500 && !taken.has(k) && !taken.has(k + 1));
    if (!hop) return;
    zones[z] = [hop[0], hop[0] + 1];
    for (const k of [hop[0] - 1, hop[0], hop[0] + 1, hop[0] + 2]) taken.add(k);
  });
  const crossed = zones.filter(z => z && ia < z[0] && ib > z[1]).length;
  if (zones.every(Boolean) && zones.length === n - 1) return { n: 1 + crossed, about: false };
  if (ia === 0 && ib === stops.length - 1) return { n, about: false };
  const share = rideMeters(stops, ia, ib) / (rideMeters(stops, 0, stops.length - 1) || 1);
  return { n: Math.min(n, Math.max(1 + crossed, Math.ceil(n * share))), about: true };
}
export function fareBetween(list, way, a, b, own = null) {
  const stops = way?.stops || [];
  const ia = stops.indexOf(a);
  const ib = stops.indexOf(b);
  if (ia < 0 || ib <= ia || !list?.length) return null;
  if (own?.[0] === 0) return { kind: 'free', fares: [] };
  for (const r of forWay(list, way)) {
    if (r.IsFreeBus === true || r.IsFreeBus === 1) return { kind: 'free', fares: [] };
    const type = Number(r.FarePricingType);
    if (type === 1) {
      // (This way's pair, else the pair either way round: a fare is the same both ways.)
      const od = r.ODFares || [];
      const pair = l => l.find(o => sameStop(o.OriginStop, a) && sameStop(o.DestinationStop, b)) || l.find(o => sameStop(o.OriginStop, b) && sameStop(o.DestinationStop, a));
      const hit = pair(byDir(od, way.dir)) || pair(od);
      if (hit) return { kind: 'od', fares: priceList(hit.Fares) };
    } else if (type === 0) {
      const sec = (r.SectionFares || [])[0];
      if (!sec) continue;
      // Each line between sections crossed: paid, unless you get on or off in its buffer zone.
      let n = 1;
      for (const z of byDir(sec.BufferZones || [], way.dir)) {
        const [zo, zd] = [at(stops, z.FareBufferZoneOrigin), at(stops, z.FareBufferZoneDestination)];
        if (zo >= 0 && zd >= 0 && ia < Math.min(zo, zd) && ib > Math.max(zo, zd)) n++;
      }
      const all = priceList(sec.Fares);
      const named = all.filter(f => segsIn(f.name) != null);
      const fares = named.length ? named.filter(f => segsIn(f.name) === n) : all.map(f => ({ ...f, price: f.price * n }));
      // (No section lines published at all and a long ride: TDX may just not
      // have them. 新北's 988 is 4 段票 and TDX has it one section with none,
      // Jay 11-16: so 起, never a sure 15.)
      const lines = (r.SectionFares || []).some(x => (x.BufferZones || []).length);
      // (None published to TDX: the city's own list's, when it has the route's.)
      const city = !lines && !named.length && own?.[0] > 1 ? ownSections(own, way, ia, ib) : null;
      const unsure = !lines && !named.length && !city && rideMeters(stops, ia, ib) > LONG_SECTION_M;
      if (city) {
        const per = all.filter(f => !segsIn(f.name));
        if (per.length) return { kind: 'section', sections: city.n, ...(city.about ? { about: true } : {}), fares: per.map(f => ({ ...f, price: f.price * city.n })) };
      }
      if (fares.length) return { kind: 'section', sections: n, ...(unsure ? { unsure } : {}), fares };
    } else if (type === 2) {
      const sts = byDir(r.StageFares || [], way.dir);
      // A stop's stage: the last stage's first stop at or before it along the way.
      const starts = [...new Set(sts.flatMap(x => [at(stops, x.OriginStage), at(stops, x.DestinationStage)]).filter(k => k >= 0))].sort((x, y) => x - y);
      const stage = k => starts.filter(x => x <= k).at(-1);
      const [sa, sb] = [stage(ia), stage(ib)];
      if (sa == null || sb == null) continue;
      let hit = sts.find(x => at(stops, x.OriginStage) === sa && at(stops, x.DestinationStage) === sb) || sts.find(x => at(stops, x.OriginStage) === sb && at(stops, x.DestinationStage) === sa);
      // Inside one stage (seldom published: 新竹站 to 民生路口 on 5608): the
      // way's least fare, its 基本票價.
      if (!hit && sa === sb) hit = sts.map(x => [Math.min(...priceList(x.Fares).filter(f => f.who === 'adult').map(f => f.price)), x]).sort((x, y) => x[0] - y[0])[0]?.[1];
      if (hit) return { kind: 'stage', fares: priceList(hit.Fares) };
    }
  }
  return null;
}

// Each kind of rider once, its single ticket and (when it differs) its card
// fare: [{ who, cash, card }], 成人 first.
const ORDER = ['adult', 'student', 'child', 'elder', 'care', 'half'];
export function fareRows(fares) {
  const out = [];
  for (const who of ORDER) {
    const mine = fares.filter(f => f.who === who);
    if (!mine.length) continue;
    const cash = mine.find(f => f.ticket === 'cash')?.price ?? null;
    const card = mine.find(f => f.ticket === 'card')?.price ?? null;
    if (cash == null && card == null) continue;
    out.push({ who, cash, card: card != null && card !== cash ? card : null });
  }
  return out;
}

// The riders after 全票, those paying the same together (敬老・愛心 at one
// price): [{ who: [...], cash, card }].
export function fareGroups(rows) {
  const out = [];
  for (const r of rows) {
    const same = out.find(g => g.cash === r.cash && g.card === r.card);
    if (same) same.who.push(r.who);
    else out.push({ who: [r.who], cash: r.cash, card: r.card });
  }
  return out;
}
