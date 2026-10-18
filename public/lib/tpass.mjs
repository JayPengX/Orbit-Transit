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
import { EXPRESS } from './rail.mjs';
import { W } from './lang.mjs';
import { isRide } from './util.mjs';

const TAO_HSIN_MIAO_SKIP = { HsinchuCounty: ['觀光8號'] };

export const TPASSES = [
  { id: 'kbnt', name: W('基北北桃', 'Greater Taipei'), price: 1200, cities: ['Keelung', 'Taipei', 'NewTaipei', 'Taoyuan'], bike: true },
  { id: 'thhm', name: W('桃竹竹苗', 'Taoyuan–Miaoli'), price: 1200, cities: ['Taoyuan', 'Hsinchu', 'HsinchuCounty', 'MiaoliCounty'], bike: true, skip: TAO_HSIN_MIAO_SKIP },
  { id: 'thh', name: W('桃竹竹', 'Taoyuan–Hsinchu'), price: 799, cities: ['Taoyuan', 'Hsinchu', 'HsinchuCounty'], bike: true, skip: TAO_HSIN_MIAO_SKIP },
  { id: 'hhm', name: W('竹竹苗', 'Hsinchu–Miaoli'), price: 699, cities: ['Hsinchu', 'HsinchuCounty', 'MiaoliCounty'], bike: true, skip: TAO_HSIN_MIAO_SKIP },
  { id: 'hh', name: W('竹竹', 'Hsinchu'), price: 288, cities: ['Hsinchu', 'HsinchuCounty'], bike: true, skip: TAO_HSIN_MIAO_SKIP },
  { id: 'tcnm', name: W('中彰投苗', 'Central Taiwan'), price: 999, cities: ['Taichung', 'ChanghuaCounty', 'NantouCounty', 'MiaoliCounty'], bike: true },
  { id: 'tkp', name: W('南高屏', 'Tainan–Pingtung'), price: 999, cities: ['Tainan', 'Kaohsiung', 'PingtungCounty'], bike: false },
  // The others (2026-10, the prices each in two or more sources that agree:
  // iPASS's 宜蘭 page for 北北宜 and 宜蘭; SOGI 2024-09, 台灣懶人包 2026-05,
  // 早安健康 2023-09 for the rest). `modes`: what it takes (else bus, 台鐵 and
  // metro); `busCities`: where its buses count (北北宜's are 宜蘭's own, its
  // 國道客運 to 台北 left out: those routes can't be told apart here);
  // `trains`: the 台鐵 classes it takes (臺東's: 非對號 only). A pass whose
  // buses the sources disagree on takes only 台鐵 here (paid by the planner
  // rather than shown free when it isn't).
  { id: 'tc', name: W('臺中市', 'Taichung'), price: 599, cities: ['Taichung'], bike: true },
  { id: 'tcr', name: W('臺中市（市民）', 'Taichung (residents)'), price: 299, cities: ['Taichung'], bike: true },
  { id: 'kh', name: W('高雄市', 'Kaohsiung'), price: 399, cities: ['Kaohsiung'], bike: true },
  { id: 'kl', name: W('基隆市', 'Keelung'), price: 288, cities: ['Keelung'], bike: false, modes: ['tra'] },
  { id: 'tpy', name: W('北北宜', 'Taipei–Yilan'), price: 1800, cities: ['Taipei', 'NewTaipei', 'YilanCounty'], bike: false, modes: ['tra', 'bus'], busCities: ['YilanCounty'] },
  { id: 'yl', name: W('宜蘭縣', 'Yilan'), price: 750, cities: ['YilanCounty'], bike: false, modes: ['tra', 'bus'] },
  { id: 'hl', name: W('花蓮縣', 'Hualien'), price: 399, cities: ['HualienCounty'], bike: false, modes: ['tra', 'bus'] },
  { id: 'hlb', name: W('花蓮縣（基本）', 'Hualien (basic)'), price: 199, cities: ['HualienCounty'], bike: false, modes: ['tra'] },
  { id: 'tt', name: W('臺東縣', 'Taitung'), price: 299, cities: ['TaitungCounty'], bike: false, modes: ['tra', 'bus'], trains: ['6', '7', '10'] },
  { id: 'cy', name: W('嘉義', 'Chiayi'), price: 399, cities: ['Chiayi', 'ChiayiCounty'], bike: true, modes: ['tra', 'bus'] },
  { id: 'yla', name: W('雲林縣', 'Yunlin'), price: 199, cities: ['YunlinCounty'], bike: false, modes: ['tra'] }
];
export const tpassOf = id => TPASSES.find(p => p.id === id) || null;
// Long rides cut every 30 minutes (每 30 分鐘換車): when set, and always
// when your TPASS takes YouBike's first half hour, each half hour free (the
// owner, 2026-10-12: riding 成功九街 → 竹東高中 is two bikes for TPASS users).
export const bikeSwap = prefs => prefs?.bike30 === true || !!tpassOf(prefs?.tpass)?.bike;

const PAID = new Set(['bus', 'tra', 'metro', 'lightrail']);

// 台鐵 trains no TPASS takes: 太魯閣, 普悠瑪 and the EMU3000 自強 (type
// codes 1, 2, 11; Google names them). Every other class does (自強 too).
const PREMIUM = new Set(['1', '2', '11']);
// A pass with its own list of classes (臺東's 非對號: 區間, 普快, 區間快) takes only those.
const classOk = (pass, code) => (pass?.trains ? pass.trains.includes(code) : !PREMIUM.has(code));
const passTrain = (l, pass) => {
  if (l.mode !== 'tra') return true;
  const code = String(l.train?.code ?? l.trip?.code ?? '');
  if (pass?.trains) return classOk(pass, code);
  return !(PREMIUM.has(code) || /普悠瑪|太魯閣|3000/.test(`${l.name || ''} ${l.short || ''} ${l.typeFull || ''}`));
};
// The same for a train in the day's timetable (rail.mjs's trips): a 台鐵 one of a class the pass takes.
export const passTrainTrip = (x, pass = null) => x.sys === 'tra' && classOk(pass, String(x.code));
// The kinds of ride a pass takes, and where its buses count.
const modeOn = (pass, mode) => PAID.has(mode) && (!pass?.modes || pass.modes.includes(mode));
const busCity = (pass, city) => !pass?.busCities || pass.busCities.includes(city);
// Can a ride ever be on the pass (高鐵 and a taxi never are)?
const passMode = (l, pass) => !isRide(l) || (modeOn(pass, l.mode) && passTrain(l, pass));

// A route the pass leaves out though it runs inside its cities (its skip list).
const skipped = (pass, city, name) => Boolean(pass?.skip?.[city]?.includes(String(name || '').trim()));
// A bus route by its city and number: on the pass?
export const routeOnPass = (pass, city, name) => Boolean(pass) && modeOn(pass, 'bus') && pass.cities.includes(city) && busCity(pass, city) && !skipped(pass, city, name);
// A plan's bus ride on a skipped route (its city from the ride, else either end's).
const skippedLeg = (l, pass, cityOf) => l.mode === 'bus' && [l.route?.city, ...[l.from, l.to].map(p => (p?.lat != null ? cityOf(p) : null))].some(c => c && skipped(pass, c, l.short || l.name));

// A bus ride where the pass's buses count (both ends; 北北宜's: in 宜蘭).
const busOk = (l, pass, cityOf) => l.mode !== 'bus' || !pass.busCities || [l.from, l.to].every(p => p?.lat != null && busCity(pass, cityOf(p)));

// Each leg: covered by the pass or not. `cityOf(pt)` → TDX city of a point.
// → { all (every paid leg covered), some, legs: [bool] }.
export function coverage(plan, pass, cityOf) {
  if (!pass) return { all: false, some: false, legs: plan.legs.map(() => false) };
  const inside = pt => pt?.lat != null && pass.cities.includes(cityOf(pt));
  const legs = plan.legs.map(l => {
    if (l.mode === 'walk') return true;
    if (l.mode === 'bike') return pass.bike && (l.dur || 0) <= 30 * 60;
    if (PAID.has(l.mode)) return passMode(l, pass) && inside(l.from) && inside(l.to) && busOk(l, pass, cityOf) && !skippedLeg(l, pass, cityOf);
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
export const passOk = (plan, pass, cityOf) => plan.legs.every(l => !isRide(l) || (passMode(l, pass) && [l.from, l.to].every(p => p?.lat != null && pass.cities.includes(cityOf(p))) && busOk(l, pass, cityOf) && !skippedLeg(l, pass, cityOf)));

export function fareOf(plan, cov) {
  const fare = Number(plan.fare) || 0;
  // (What it costs, for the ranking: a plan our own router made has no fare,
  // so its trains by their distance at Taiwan's rates; never shown as a price.)
  const cost = fare || trainCost(plan);
  if (cov?.all) return { text: W('TPASS 涵蓋', 'TPASS covers it'), cost: 0 };
  if (cov?.some) return { text: fare ? W(`NT$${fare}（部分 TPASS）`, `NT$${fare} (part TPASS)`) : W('部分 TPASS', 'Part TPASS'), cost: Math.round(cost / 2) };
  return { text: fare ? `NT$${fare}` : '', cost };
}
// A plan's trains at about what they cost: 高鐵 NT$4.3 a km, 台鐵's express
// trains 2.27 and the rest 1.46 (the track a sixth longer than the line between
// stations), each at least its least fare. HSR was free to the ranking.
const trainCost = plan =>
  Math.round(
    plan.legs.reduce((t, l) => {
      const km = ((l.dist || 0) / 1000) * 1.15;
      if (l.mode === 'hsr') return t + Math.max(40, km * 4.3);
      if (l.mode === 'tra') return t + Math.max(15, km * (EXPRESS.has(String(l.train?.code ?? '')) ? 2.27 : 1.46));
      return t;
    }, 0)
  );
