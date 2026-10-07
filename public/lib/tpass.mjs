// TPASS 行政院通勤月票: which pass you have (我的 → TPASS), and what of a
// plan it covers: buses, 台鐵 and metros inside its cities (never 高鐵),
// and YouBike's first 30 minutes where the pass includes it; 台鐵's
// 太魯閣, 普悠瑪 and EMU3000 never. Prices are
// what each pass costs a month (shown only; the ranking uses what a plan
// would still cost you).

// Routes inside a pass's cities it still leaves out, by city, from each
// pass's official route table: 桃竹竹苗's Q&A (2024-09-27) names 新竹縣's
// 觀光8號 (觀霧線, crossing the county line, no commuters); its 觀光1號 and
// 2號 are on it.
const TAO_HSIN_MIAO_SKIP = { HsinchuCounty: ['觀光8號'] };

export const TPASSES = [
  { id: 'kbnt', name: '基北北桃', price: 1200, cities: ['Keelung', 'Taipei', 'NewTaipei', 'Taoyuan'], bike: true },
  { id: 'thhm', name: '桃竹竹苗', price: 1200, cities: ['Taoyuan', 'Hsinchu', 'HsinchuCounty', 'MiaoliCounty'], bike: true, skip: TAO_HSIN_MIAO_SKIP },
  { id: 'thh', name: '桃竹竹', price: 799, cities: ['Taoyuan', 'Hsinchu', 'HsinchuCounty'], bike: true, skip: TAO_HSIN_MIAO_SKIP },
  { id: 'hhm', name: '竹竹苗', price: 699, cities: ['Hsinchu', 'HsinchuCounty', 'MiaoliCounty'], bike: true, skip: TAO_HSIN_MIAO_SKIP },
  { id: 'hh', name: '竹竹', price: 288, cities: ['Hsinchu', 'HsinchuCounty'], bike: true, skip: TAO_HSIN_MIAO_SKIP },
  { id: 'tcnm', name: '中彰投苗', price: 999, cities: ['Taichung', 'ChanghuaCounty', 'NantouCounty', 'MiaoliCounty'], bike: true },
  { id: 'tkp', name: '南高屏', price: 999, cities: ['Tainan', 'Kaohsiung', 'PingtungCounty'], bike: false }
];
export const tpassOf = id => TPASSES.find(p => p.id === id) || null;

const PAID = new Set(['bus', 'tra', 'metro', 'lightrail']);

// 台鐵 trains no TPASS takes: 太魯閣, 普悠瑪 and the EMU3000 自強 (type
// codes 1, 2, 11; Google names them). Every other class does (自強 too).
export const PREMIUM = new Set(['1', '2', '11']);
export const passTrain = l => l.mode !== 'tra' || !(PREMIUM.has(String(l.train?.code ?? l.trip?.code ?? '')) || /普悠瑪|太魯閣|3000/.test(`${l.name || ''} ${l.short || ''} ${l.typeFull || ''}`));
// Can a ride ever be on the pass (高鐵 and a taxi never are)?
export const passMode = l => l.mode === 'walk' || l.mode === 'bike' || (PAID.has(l.mode) && passTrain(l));

// A route the pass leaves out though it runs inside its cities (its skip list).
const skipped = (pass, city, name) => Boolean(pass?.skip?.[city]?.includes(String(name || '').trim()));
// A bus route by its city and number: on the pass?
export const routeOnPass = (pass, city, name) => Boolean(pass) && pass.cities.includes(city) && !skipped(pass, city, name);
// A plan's bus ride on a skipped route (its city from the ride, else either end's).
const skippedLeg = (l, pass, cityOf) => l.mode === 'bus' && [l.route?.city, ...[l.from, l.to].map(p => (p?.lat != null ? cityOf(p) : null))].some(c => c && skipped(pass, c, l.short || l.name));

// Each leg: covered by the pass or not. `cityOf(pt)` → TDX city of a point.
// → { all (every paid leg covered), some, legs: [bool] }.
export function coverage(plan, pass, cityOf) {
  if (!pass) return { all: false, some: false, legs: plan.legs.map(() => false) };
  const inside = pt => pt?.lat != null && pass.cities.includes(cityOf(pt));
  const legs = plan.legs.map(l => {
    if (l.mode === 'walk') return true;
    if (l.mode === 'bike') return pass.bike && (l.dur || 0) <= 30 * 60;
    if (PAID.has(l.mode)) return passTrain(l) && inside(l.from) && inside(l.to) && !skippedLeg(l, pass, cityOf);
    return false;
  });
  const paid = plan.legs.map((l, i) => [l, legs[i]]).filter(([l]) => l.mode !== 'walk');
  return { all: paid.length > 0 && paid.every(([, c]) => c), some: paid.some(([, c]) => c), legs };
}

// What a plan's fare line says, and what it still costs (for the ranking):
// covered by the pass → 0; partly → the fare as known (Google's or TDX's
// whole-trip price), marked as partly covered.
// A trip with both ends inside the pass's cities: only what the pass takes.
export const inPass = (o, d, pass, cityOf) => Boolean(pass) && [o, d].every(p => p?.lat != null && pass.cities.includes(cityOf(p)));

// Every ride of a plan one the pass takes (a long YouBike ride too: it
// only costs a little past the half hour).
export const passOk = (plan, pass, cityOf) => plan.legs.every(l => l.mode === 'walk' || l.mode === 'bike' || (passMode(l) && [l.from, l.to].every(p => p?.lat != null && pass.cities.includes(cityOf(p))) && !skippedLeg(l, pass, cityOf)));

export function fareOf(plan, cov) {
  const fare = Number(plan.fare) || 0;
  if (cov?.all) return { text: 'TPASS 涵蓋', cost: 0 };
  if (cov?.some) return { text: fare ? `NT$${fare}（部分 TPASS）` : '部分 TPASS', cost: Math.round(fare / 2) };
  return { text: fare ? `NT$${fare}` : '', cost: fare };
}
