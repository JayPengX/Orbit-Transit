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
// fareBetween → { kind, sections?, fares: [{ who, ticket, price }] } or null
// (nothing published for that ride).

import { tdx, rows } from './api.mjs';
import { INTERCITY } from './bus.mjs';

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
export function fareBetween(list, way, a, b) {
  const stops = way?.stops || [];
  const ia = stops.indexOf(a);
  const ib = stops.indexOf(b);
  if (ia < 0 || ib <= ia || !list?.length) return null;
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
      if (fares.length) return { kind: 'section', sections: n, fares };
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
