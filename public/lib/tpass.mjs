// TPASS 行政院通勤月票: which pass you have (我的 → TPASS), and what of a
// plan it covers: buses, 台鐵 and metros inside its cities (never 高鐵),
// and YouBike's first 30 minutes where the pass includes it. Prices are
// what each pass costs a month (shown only; the ranking uses what a plan
// would still cost you).

export const TPASSES = [
  { id: 'kbnt', name: '基北北桃', price: 1200, cities: ['Keelung', 'Taipei', 'NewTaipei', 'Taoyuan'], bike: true },
  { id: 'thhm', name: '桃竹竹苗', price: 1200, cities: ['Taoyuan', 'Hsinchu', 'HsinchuCounty', 'MiaoliCounty'], bike: true },
  { id: 'thh', name: '桃竹竹', price: 799, cities: ['Taoyuan', 'Hsinchu', 'HsinchuCounty'], bike: true },
  { id: 'hhm', name: '竹竹苗', price: 699, cities: ['Hsinchu', 'HsinchuCounty', 'MiaoliCounty'], bike: true },
  { id: 'hh', name: '竹竹', price: 288, cities: ['Hsinchu', 'HsinchuCounty'], bike: true },
  { id: 'tcnm', name: '中彰投苗', price: 999, cities: ['Taichung', 'ChanghuaCounty', 'NantouCounty', 'MiaoliCounty'], bike: true },
  { id: 'tkp', name: '南高屏', price: 999, cities: ['Tainan', 'Kaohsiung', 'PingtungCounty'], bike: false }
];
export const tpassOf = id => TPASSES.find(p => p.id === id) || null;

const PAID = new Set(['bus', 'tra', 'metro', 'lightrail']);

// Each leg: covered by the pass or not. `cityOf(pt)` → TDX city of a point.
// → { all (every paid leg covered), some, legs: [bool] }.
export function coverage(plan, pass, cityOf) {
  if (!pass) return { all: false, some: false, legs: plan.legs.map(() => false) };
  const inside = pt => pt?.lat != null && pass.cities.includes(cityOf(pt));
  const legs = plan.legs.map(l => {
    if (l.mode === 'walk') return true;
    if (l.mode === 'bike') return pass.bike && (l.dur || 0) <= 30 * 60;
    if (PAID.has(l.mode)) return inside(l.from) && inside(l.to);
    return false;
  });
  const paid = plan.legs.map((l, i) => [l, legs[i]]).filter(([l]) => l.mode !== 'walk');
  return { all: paid.length > 0 && paid.every(([, c]) => c), some: paid.some(([, c]) => c), legs };
}

// What a plan's fare line says, and what it still costs (for the ranking):
// covered by the pass → 0; partly → the fare as known (Google's or TDX's
// whole-trip price), marked as partly covered.
export function fareOf(plan, cov) {
  const fare = Number(plan.fare) || 0;
  if (cov?.all) return { text: 'TPASS 涵蓋', cost: 0 };
  if (cov?.some) return { text: fare ? `NT$${fare}（部分 TPASS）` : '部分 TPASS', cost: Math.round(fare / 2) };
  return { text: fare ? `NT$${fare}` : '', cost: fare };
}
