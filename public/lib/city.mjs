// Taiwan's counties and cities as TDX names them (its City parameter), and
// which one a point is in.

import { meters } from './util.mjs';

// [TDX City, 中文, north-to-south order for the pickers]
export const CITIES = [
  ['Keelung', '基隆市'],
  ['Taipei', '臺北市'],
  ['NewTaipei', '新北市'],
  ['Taoyuan', '桃園市'],
  ['Hsinchu', '新竹市'],
  ['HsinchuCounty', '新竹縣'],
  ['MiaoliCounty', '苗栗縣'],
  ['Taichung', '臺中市'],
  ['ChanghuaCounty', '彰化縣'],
  ['NantouCounty', '南投縣'],
  ['YunlinCounty', '雲林縣'],
  ['ChiayiCounty', '嘉義縣'],
  ['Chiayi', '嘉義市'],
  ['Tainan', '臺南市'],
  ['Kaohsiung', '高雄市'],
  ['PingtungCounty', '屏東縣'],
  ['YilanCounty', '宜蘭縣'],
  ['HualienCounty', '花蓮縣'],
  ['TaitungCounty', '臺東縣'],
  ['PenghuCounty', '澎湖縣'],
  ['KinmenCounty', '金門縣'],
  ['LienchiangCounty', '連江縣']
];
export const cityName = code => CITIES.find(c => c[0] === code)?.[1] || code;
export const cityShort = code => cityName(code).replace(/[市縣]$/, '');
const BY_NAME = Object.fromEntries(CITIES.map(([code, name]) => [name, code]));
// 「台北市」 is written both ways.
export const cityOf = name => BY_NAME[String(name || '').replace(/台/g, '臺')] || null;

// The cities with a public bike system on TDX.
export const BIKE_CITIES = new Set(['Taipei', 'NewTaipei', 'Taoyuan', 'Hsinchu', 'HsinchuCounty', 'MiaoliCounty', 'Taichung', 'ChanghuaCounty', 'YunlinCounty', 'ChiayiCounty', 'Chiayi', 'Tainan', 'Kaohsiung', 'PingtungCounty', 'TaitungCounty']);

// 「300新竹市東區中華路二段445號」 → 'Hsinchu'.
export function cityFromAddress(addr) {
  const text = String(addr || '').replace(/台/g, '臺');
  let best = null;
  for (const [code, name] of CITIES) {
    const i = text.indexOf(name);
    if (i >= 0 && (best == null || i < best.i)) best = { i, code };
  }
  return best?.code || null;
}

// Taiwan's townships [[county, town, lat, lon]…] (the proxy's
// /weather/places): the nearest one's county. Good to a few hundred metres
// near a border, which is all a city choice needs.
export function cityAt(towns, lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const t of towns || []) {
    const d = meters(lat, lon, t[2], t[3]);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best ? { city: cityOf(best[0]), county: best[0], town: best[1] } : null;
}

// TDX's three-letter city codes (ISO 3166-2:TW), as bus stations carry them.
export const CITY_CODES = { TPE: 'Taipei', NWT: 'NewTaipei', TAO: 'Taoyuan', TXG: 'Taichung', TNN: 'Tainan', KHH: 'Kaohsiung', KEE: 'Keelung', HSZ: 'Hsinchu', HSQ: 'HsinchuCounty', MIA: 'MiaoliCounty', CHA: 'ChanghuaCounty', NAN: 'NantouCounty', YUN: 'YunlinCounty', CYQ: 'ChiayiCounty', CYI: 'Chiayi', PIF: 'PingtungCounty', ILA: 'YilanCounty', HUA: 'HualienCounty', TTT: 'TaitungCounty', KIN: 'KinmenCounty', PEN: 'PenghuCounty', LIE: 'LienchiangCounty' };
