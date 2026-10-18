// Small shared pieces: escaping, Taiwan time, distances, the two polyline
// encodings the planners use.

import { W } from './lang.mjs';

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const e = escapeHtml;

const TPE = 8 * 3_600_000;
// Taiwan's wall clock for a moment: { date: 'YYYY-MM-DD', hm: 'HH:MM', min (of the day), dow (0 = Sunday) }.
export function tw(t = Date.now()) {
  const d = new Date(t + TPE);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), hm: iso.slice(11, 16), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
}
// A Taiwan date and 'HH:MM[:SS]' (hours may pass 24 for after midnight) → ms.
// (Each date's midnight worked out once: a trip reads timetables thousands of times.)
const midnights = new Map();
export function twAt(date, hm) {
  const [h, m, s = 0] = String(hm).split(':').map(Number);
  let day = midnights.get(date);
  if (day === undefined) {
    if (midnights.size > 60) midnights.clear();
    midnights.set(date, (day = Date.parse(`${date}T00:00:00+08:00`)));
  }
  return day + ((h * 60 + m) * 60 + s) * 1000;
}
export const hm = t => (t == null ? '' : tw(t).hm);
export const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00+08:00`) + n * 86_400_000 + TPE).toISOString().slice(0, 10);
const WEEK = '日一二三四五六';
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayLabel = (date, today = tw().date) => {
  if (date === today) return W('今天', 'Today');
  if (date === addDays(today, 1)) return W('明天', 'Tomorrow');
  const d = new Date(`${date}T12:00:00+08:00`).getUTCDay();
  return W(`${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEK[d]}）`, `${WEEK_EN[d]} ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`);
};

// Taiwan, what the app covers: the main island, 澎湖, 綠島, 蘭嶼, 金門 and 馬祖
// (each by its own box, so the coast of Fujian beside them, and 平潭, are
// out). The map stays inside TAIWAN_BOX; a place outside inTaiwan isn't one.
export const TAIWAN_BOX = { s: 21.7, n: 26.6, w: 117.9, e: 122.5 };
export function inTaiwan(lat, lon) {
  if (!(lat >= 21.8 && lat <= 26.5 && lon >= 118.1 && lon <= 122.3)) return false;
  if (lat >= 24.35 && lat <= 24.56 && lon >= 118.21 && lon <= 118.5) return true; // 金門
  if (lat >= 25.9 && lat <= 26.42 && lon >= 119.9 && lon <= 120.55) return true; // 馬祖
  if (lon < 119.25) return false; // the mainland's coast
  if (lat > 25.35 && lon < 121) return false; // 平潭 and the coast north of it
  return true;
}

// Minutes, written the way a timetable says them: 「8 分」, 「1 小時 5 分」.
export function minsText(sec) {
  const m = Math.max(0, Math.round(sec / 60));
  if (m < 60) return W(`${m} 分`, `${m} min`);
  return W(`${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}`, `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
}
export const distText = m => (m == null ? '' : m < 1000 ? `${Math.round(m / 10) * 10} ${W('公尺', 'm')}` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} ${W('公里', 'km')}`);

// Metres between two points.
export function meters(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}
export const near = (a, b) => meters(a.lat, a.lon, b.lat, b.lon);

// Walking: streets aren't straight (×1.3) at 83 m a minute, 5 km/h (Google's
// pace; 75, 4.5 km/h, until the owner's call of 2026-10-13).
export const WALK_M_MIN = 83;
// How old a TDX bus estimate is, in seconds, by when it was made (its
// DataTime): an estimate is counted from then, not from when it reached the
// phone (Hsinchu's buses make one about a minute, and the proxy keeps it a
// while: counted from now, "4 minutes" stayed 4 minutes, the countdown back
// up each time it was read; the owner, 2026-10-13). 0 without one; at most 5 minutes.
export const etaAge = (r, now = Date.now()) => {
  const t = Date.parse(r?.DataTime || '');
  return Number.isFinite(t) ? Math.min(300, Math.max(0, (now - t) / 1000)) : 0;
};
export const walkSec = m => Math.round(((m * 1.3) / WALK_M_MIN) * 60);
// A walk of `m` metres as the crow flies, as shown and timed (the streets' ×1.3 in both).
export const walkGuess = m => ({ dist: Math.round(m * 1.3), sec: walkSec(m) });

// Google's encoded polyline → [[lat, lon]…].
export function decodeGoogle(str) {
  const out = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0;
      let result = 0;
      let b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i <= str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d;
      else lon += d;
    }
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

// HERE's flexible polyline (TDX's planner) → [[lat, lon]…].
const FLEX = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function decodeFlexible(str) {
  const vals = [];
  let shift = 0;
  let v = 0;
  for (const ch of str) {
    const n = FLEX.indexOf(ch);
    if (n < 0) return [];
    v |= (n & 0x1f) << shift;
    if (n & 0x20) shift += 5;
    else {
      vals.push(v);
      v = 0;
      shift = 0;
    }
  }
  if (vals.length < 2 || vals[0] !== 1) return [];
  const header = vals[1];
  const prec = 10 ** (header & 15);
  const third = (header >> 4) & 7;
  const dims = third ? 3 : 2;
  const out = [];
  let la = 0;
  let lo = 0;
  for (let i = 2; i + 1 < vals.length; i += dims) {
    const z = x => (x & 1 ? ~(x >> 1) : x >> 1);
    la += z(vals[i]);
    lo += z(vals[i + 1]);
    out.push([la / prec, lo / prec]);
  }
  return out;
}
export const decodeLine = (poly, fmt) => (!poly ? [] : fmt === 'f' ? decodeFlexible(poly) : decodeGoogle(poly));

export const zh = v => (v && typeof v === 'object' ? v.Zh_tw || v.En || '' : String(v ?? ''));
export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Taiwan's national holidays (the kit's holidays.mjs, set by the app once
// loaded): a trip saved for weekdays only (家 → 學校) keeps the work
// calendar and skips them. holidayOn('YYYY-MM-DD') → true on one.
let holidayCheck = () => false;
export const useHolidays = fn => (holidayCheck = typeof fn === 'function' ? fn : () => false);
export const holidayOn = date => holidayCheck(date);
export const weekdaysOnly = days => days.length > 0 && !days.includes(0) && !days.includes(6);

// Google's and TDX's names for one route differ (快捷8經興隆大橋, 快捷8號;
// 藍1區間車, 藍1): the same when one is the other plus words, never 5 and 5608.
// Chinese numerals as digits too (Google's 快捷八號 is TDX's 快捷8號).
const NUM = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const digits = s =>
  s.replace(/([一二三四五六七八九]?)十([一二三四五六七八九]?)/g, (_, a, b) => `${a ? NUM[a] : 1}${b ? NUM[b] : 0}`).replace(/[〇零一二兩三四五六七八九](?=[號号路線线支區]|$)/g, c => NUM[c]);
export const routeNorm = s => digits(String(s || '').replace(/\s+/g, '')).replace(/[號号线線]/g, '').replace(/[（(].*$/, '').replace(/台/g, '臺').toUpperCase();
export function sameRoute(a, b) {
  const x = routeNorm(a);
  const y = routeNorm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return l.startsWith(s) && !/\d/.test(l[s.length]) && !/^\d+$/.test(l.slice(s.length));
}

// A station's name however a source or a person writes it (台 or 臺, 臺鐵 or
// 高鐵 before it, 火車站, 車站 or 站 after): 竹北火車站, 臺鐵竹北車站 and 竹北 are one.
export const stationKey = n => {
  const s = String(n || '').replace(/\s+/g, '').replace(/台/g, '臺');
  return s.replace(/^(臺鐵|高鐵)/, '').replace(/(火車站|車站|站)$/, '') || s;
};
// A pinned way (plan.mjs pickSig) kept from before its lines were read by
// routeNorm (快捷八號 as 快捷8): read by the rule now, so the pin still holds.
export const pinSig = k => String(k).split('|').map(x => (/^(tra|hsr):/.test(x) ? x : x.replace(/^(\w+):(.*)$/, (_, m, n) => `${m}:${routeNorm(n)}`))).join('|');
