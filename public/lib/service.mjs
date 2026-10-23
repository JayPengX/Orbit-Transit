// What isn't running: the operators' own notices (台鐵's alerts, 高鐵's,
// the metros', the bus companies' and cities'), read as rules that every
// view uses. A typhoon day (Jay, 2026-10-23: the app still showed every
// bus and train) is the case it's for; works and detours aren't.
//
//   traRules / traCut   台鐵: which trains a notice stops (對號 or 非對號, on
//                       which lines), dropped from the day's timetable; trains
//                       run "視風雨情形機動行駛" marked `maybe`
//   busNotices / busOff the bus notices of some cities; whether one stops a
//                       route today (by its id in the notice's scope, or its
//                       【number】 in the text)
//   metroNotices        each metro system's notice when it isn't 正常營運
//   hsrNotice           高鐵's, when it isn't 全線營運正常
//   loadNotices         all of it for where you are, for the banners
//
// Only what an operator says: a notice that names nothing it stops, or says
// "部分", "減班", "視…" or a time of day, is shown as written and never
// taken as a stop (Jay: never invent). A bus seen on the road beats a notice.

import { tdx, rows, busesRunning } from './api.mjs';
import { tw, zh, addDays, routeNorm } from './util.mjs';
import { CITIES, CITY_CODES, cityShort } from './city.mjs';

import { W } from '#kit/lang.mjs';

const MIN = 60_000;
const NOTICE_FRESH = 3 * MIN;
const listeners = new Set();
// Told when what's stopped changes (a new notice): timetables are cut again.
export const onNotices = fn => (listeners.add(fn), () => listeners.delete(fn));
let lastSig = '';
const changed = sig => {
  if (sig === lastSig) return;
  const first = !lastSig;
  lastSig = sig;
  if (!first) for (const fn of listeners) fn();
};

// ---- 台鐵 ---------------------------------------------------------------------------------------

// 非對號 (no reserved seats): 區間, 區間快, 普快. Every other class is 對號.
const UNRESERVED = new Set(['6', '7', '10']);
// The sections TRA's notices name that aren't lines of their own in TDX:
// [line, first station, last station] by name, along TDX's StationOfLine.
const SUBLINES = {
  宜蘭線: [['EL', '八堵', '蘇澳新'], ['SU', '蘇澳新', '蘇澳']],
  北迴線: [['EL', '蘇澳新', '花蓮']],
  臺東線: [['EL', '花蓮', '臺東']],
  花東線: [['EL', '花蓮', '臺東']],
  山線: [['WL', '竹南', '彰化']],
  臺中線: [['WL', '竹南', '彰化']],
  海線: [['WL-C', '竹南', '彰化']],
  屏東線: [['WL', '高雄', '屏東'], ['SL', '屏東', '枋寮']],
  南迴線: [['SL', '枋寮', '臺東']]
};
// TDX's TripLine: 2 經海線, 3 經成追線.
const VIA = { 海線: 2, 成追線: 3 };

// TDX StationOfLine → { 'EL': ['1000', …] in order, names: { 八堵: '7390' } }.
export function lineIndex(j) {
  const lines = {};
  const names = {};
  const byName = {};
  for (const l of j?.StationOfLines || []) {
    lines[l.LineID] = (l.Stations || []).map(s => s.StationID);
    for (const s of l.Stations || []) names[zh(s.StationName).replace(/台/g, '臺')] = s.StationID;
  }
  for (const l of j?.Lines || []) byName[zh(l.LineName).replace(/台/g, '臺')] = l.LineID;
  return { lines, names, byName };
}
const slice = (ix, [line, a, b]) => {
  const list = ix.lines[line] || [];
  const i = list.indexOf(ix.names[a]);
  const k = list.indexOf(ix.names[b]);
  return i < 0 || k < 0 ? [] : list.slice(Math.min(i, k), Math.max(i, k) + 1);
};
// A line's stations by the name a notice gives it (內灣線, 宜蘭線, 東部幹線).
function lineStations(ix, name) {
  const n = name.replace(/台/g, '臺');
  if (SUBLINES[n]) return SUBLINES[n].flatMap(s => slice(ix, s));
  const id = ix.byName[n];
  return id ? ix.lines[id] || [] : [];
}

// The day a notice is about: 「今(23)日」 or 「10/23」 or 「10月23日」, else
// every day it's up.
function noticeDay(text, start) {
  const s = tw(start || Date.now()).date;
  const m = /今\s*[（(]\s*(\d{1,2})\s*[)）]\s*日/.exec(text) || /\d{1,2}\s*[月/]\s*(\d{1,2})\s*日?/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  for (let k = -1; k <= 2; k++) {
    const d = addDays(s, k);
    if (Number(d.slice(8)) === day) return d;
  }
  return null;
}

// TDX v3 TRA Alert → rules: [{ id, date (or null: while it's up), from, to
// (ms), cls 'all'|'reserved'|'unreserved', stations (Set of ids), via
// (TripLine), maybe }], and the notices as written [{ title, text }].
export function traRules(alerts, stationsOfLine) {
  const ix = lineIndex(stationsOfLine);
  const rules = [];
  const notes = [];
  for (const a of rows(alerts?.Alerts ? alerts.Alerts : alerts)) {
    if (Number(a.Status) === 1 || !a.Description) continue;
    const from = Date.parse(a.StartTime) || 0;
    const to = Date.parse(a.EndTime) || Infinity;
    const scope = new Set((a.Scope?.Stations || []).map(s => s.StationID));
    const said = [];
    const days = [];
    // Each "八斗子 <--> 菁桐 : …" block on its own.
    for (const block of String(a.Description).split(/(?=\S+\s*<-->\s*\S+\s*[:：])/)) {
      const head = /^(\S+)\s*<-->\s*(\S+)\s*[:：]/.exec(block);
      const body = head ? block.slice(head[0].length) : block;
      const date = noticeDay(body, from);
      days.push(date);
      // The block's own stretch: its two ends along a line of the notice, else everything it covers.
      let whole = scope;
      if (head) {
        const [x, y] = [head[1], head[2]].map(n => ix.names[n.replace(/台/g, '臺')]);
        for (const list of Object.values(ix.lines)) {
          const i = list.indexOf(x);
          const k = list.indexOf(y);
          if (i >= 0 && k >= 0) {
            whole = new Set(list.slice(Math.min(i, k), Math.max(i, k) + 1));
            break;
          }
        }
      }
      for (const raw of body.split(/\n/)) {
        const line = raw.replace(/^[\s\t]*([（(][一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、)\s*/, '').trim();
        if (!line) continue;
        let cls = 'all';
        let rest = line;
        const c = /^(非對號|對號)列車\s*[:：]\s*/.exec(line);
        if (c) {
          cls = c[1] === '對號' ? 'reserved' : 'unreserved';
          rest = line.slice(c[0].length);
        }
        let any = false;
        for (const part of rest.split(/[；;。]/)) {
          for (const piece of part.split(/[，,]/)) {
            const p = piece.trim();
            if (!p) continue;
            const maybe = /機動|視.{0,6}(情形|情況|狀況)/.test(p);
            if (!maybe && !/停駛|停運|暫停行駛|停止行駛|不行駛/.test(p)) continue;
            any = true;
            // Named lines (宜蘭線、北迴線; 經海線列車), else the block's stretch (全區間; 其餘).
            const names = [...p.matchAll(/([一-鿿]{1,4}?線)/g)].map(m => m[1].replace(/^經/, '').replace(/列車$/, '')).filter(n => n !== '路線');
            if (!names.length) rules.push({ id: a.AlertID, date, from, to, cls, stations: whole, via: 0, maybe, name: '' });
            for (const n of names) {
              const via = /經/.test(p) && VIA[n] ? VIA[n] : n === '成追線' ? VIA[n] : 0;
              rules.push({ id: a.AlertID, date, from, to, cls, stations: new Set(via === 2 ? [] : lineStations(ix, n)), via, maybe, name: n });
            }
          }
        }
        if (any) said.push(cls === 'all' ? rest : line);
      }
    }
    if (said.length) notes.push({ id: a.AlertID, title: zh(a.Title).trim(), text: [...new Set(said)].join('\n'), url: a.AlertURL || '', from, to, days });
  }
  return { rules, notes };
}

// Whether a rule is on for a train of `date` (TDX's day: when it leaves its first station).
const ruleOn = (r, date, at) => (r.date ? r.date === date : at >= r.from - 6 * 3600_000 && at <= r.to);
// Whether a train runs along a rule's stations: two stops in a row there
// (a train only calling at a junction, 北新竹 for 內灣線, doesn't).
function along(trip, set) {
  if (!set.size) return false;
  const ids = trip.stops.map(s => s.st.replace(/^tra:/, ''));
  for (let i = 1; i < ids.length; i++) if (set.has(ids[i - 1]) && set.has(ids[i])) return true;
  return false;
}
// The rule a 台鐵 trip falls under (the stopping one before a maybe), or null.
export function traRuleFor(trip, rules, date) {
  if (trip.sys !== 'tra' || !rules?.length) return null;
  const at = trip.stops[0]?.dep ?? 0;
  let maybe = null;
  for (const r of rules) {
    if (!ruleOn(r, date, at)) continue;
    if (r.cls === 'reserved' && UNRESERVED.has(trip.code)) continue;
    if (r.cls === 'unreserved' && !UNRESERVED.has(trip.code)) continue;
    const hit = r.via ? trip.line === r.via || along(trip, r.stations) : along(trip, r.stations);
    if (!hit) continue;
    if (!r.maybe) return r;
    maybe ||= r;
  }
  return maybe;
}
// A planner's 台鐵 ride our (cut) timetable has no train for (nameTrains
// found none): stopped when a stopping rule today takes in either end
// (TDX's planner, like its timetable, lags the alerts: 內灣-新竹 from 竹東).
// `stationAt(point)`: our station id near a point.
export function traLegOff(l, rules, stationAt) {
  if (l.mode !== 'tra' || l.train?.no || !rules?.length || !l.from?.lat || !l.to?.lat) return null;
  const ends = [stationAt(l.from), stationAt(l.to)].filter(Boolean).map(k => String(k).replace(/^tra:/, ''));
  if (!ends.length) return null;
  const code = /自強|莒光|普悠瑪|太魯閣|復興|EMU3000/.test(`${l.name} ${l.short}`) ? '1' : '6';
  const date = tw(l.dep).date;
  for (const r of rules) {
    if (r.maybe || !ruleOn(r, date, l.dep)) continue;
    if (r.cls === 'reserved' && UNRESERVED.has(code)) continue;
    if (r.cls === 'unreserved' && !UNRESERVED.has(code)) continue;
    if (ends.some(k => r.stations.has(k))) return r;
  }
  return null;
}
// A day's trips with the stopped trains out, and those that may not run marked.
export function traCut(trips, rules, date) {
  if (!rules?.length) return trips;
  const out = [];
  for (const t of trips) {
    const r = traRuleFor(t, rules, date);
    if (!r) out.push(t);
    else if (r.maybe) out.push({ ...t, maybe: true });
  }
  return out;
}

let traP = null;
let traAt = 0;
// Today's 台鐵 rules (asked every 3 minutes at most; a failed ask: none, and asked again).
export function traNotices() {
  if (traP && Date.now() - traAt < NOTICE_FRESH) return traP;
  traAt = Date.now();
  traP = Promise.all([tdx('basic/v3/Rail/TRA/Alert', { fresh: NOTICE_FRESH }), tdx('basic/v3/Rail/TRA/StationOfLine', { fresh: 7 * 86_400_000, persist: true }), tdx('basic/v3/Rail/TRA/Line', { fresh: 7 * 86_400_000, persist: true })])
    .then(([a, sol, ln]) => {
      const out = traRules(a, { ...sol, Lines: ln?.Lines || [] });
      changed(JSON.stringify(out.notes));
      return out;
    })
    .catch(() => {
      traAt = 0;
      return { rules: [], notes: [] };
    });
  return traP;
}

// ---- 高鐵 ----------------------------------------------------------------------------------------

// TDX THSR AlertInfo → { title, text } when it isn't running normally, else null.
export function hsrNoticeOf(list) {
  const a = rows(list)[0];
  if (!a || /正常/.test(zh(a.Title))) return null;
  return { title: zh(a.Title), text: zh(a.Description) || '' };
}
export const hsrNotice = () => tdx('basic/v2/Rail/THSR/AlertInfo', { fresh: NOTICE_FRESH }).then(hsrNoticeOf, () => null);

// ---- 捷運 ----------------------------------------------------------------------------------------

// The systems TDX has notices for.
const METRO_ALERTS = new Set(['TRTC', 'TRTCMG', 'TYMC', 'TMRT', 'KRTC', 'KLRT']);
// TDX Metro Alert → [{ title, text, stop }] when not 正常營運 (`stop`: the system closed).
export function metroNoticesOf(j) {
  return rows(j?.Alerts ? j.Alerts : j)
    .filter(a => a.Title && !/^正常營運$/.test(zh(a.Title).trim()))
    .map(a => ({ title: zh(a.Title).trim(), text: zh(a.Description).trim(), stop: Number(a.Status) === 0 || /暫停營運|全線停駛|不營業/.test(`${zh(a.Title)} ${zh(a.Description)}`) }));
}
export async function metroNotices(systems) {
  const out = await Promise.all(systems.filter(s => METRO_ALERTS.has(s)).map(sys => tdx(`basic/v2/Rail/Metro/Alert/${sys}`, { fresh: NOTICE_FRESH }).then(j => metroNoticesOf(j).map(n => ({ ...n, sys })), () => [])));
  return out.flat();
}

// ---- 公車 ----------------------------------------------------------------------------------------

const STOPS = /停駛|停止營運|暫停行駛|停止行駛|暫停營運|取消發車|不營運|停開/;
// What makes a notice only part of a day or some buses: never the whole route off.
const PARTLY = /部分|部份|減班|調整|機動|視.{0,8}(情形|情況|狀況|天候)|正常行駛|改道|短駛|截|折返|繞駛|班距|班次如下|\d{1,2}\s*[:：點時]|上午|下午|中午|晚間|起停駛|前停駛|後停駛/;
const TYPHOON = /颱風|豪雨|停班停課|停止上班/;
const CITY_NAMES = CITIES.map(([code, name]) => [code, name, name.replace(/^臺/, '台')]);
// The cities a notice speaks of (新竹市, 宜蘭縣): its city routes are matched by id there.
const citiesIn = text => new Set(CITY_NAMES.filter(([, a, b]) => text.includes(a) || text.includes(b)).map(([code]) => code));

// What a notice does to a route, strongest first, and its two-word label:
// the status a bus shows (an arrival, a timetable, a plan), its notice a tap away.
export const EFFECTS = ['off', 'likely', 'part', 'less', 'short', 'detour', 'route', 'stops', 'time', 'info'];
export const effectLabel = k =>
  ({
    off: W('今日停駛', 'Off today'),
    likely: W('可能停駛', 'Likely off'),
    part: W('部分停駛', 'Some runs off'),
    less: W('減班', 'Fewer buses'),
    short: W('縮短行駛', 'Cut short'),
    detour: W('改道', 'Detour'),
    route: W('路線異動', 'Route changed'),
    stops: W('停靠異動', 'Stops changed'),
    time: W('班次異動', 'Times changed'),
    info: W('公告', 'Notice')
  })[k] || '';
export function effectOf(text) {
  if (STOPS.test(text) && !PARTLY.test(text)) return 'off';
  if (STOPS.test(text)) return 'part';
  if (/改道|繞駛|改行|改經|改走|動線/.test(text)) return 'detour';
  if (/取消停靠|不停靠|暫停停靠|停靠站/.test(text)) return 'stops';
  if (/取消/.test(text)) return 'part';
  if (/減班|班距|颱風.{0,4}班表|豪雨班表|假日班|例假日/.test(text)) return 'less';
  if (/短駛|縮駛|截|折返|行駛至.{1,12}止/.test(text)) return 'short';
  if (/封路|封閉|管制/.test(text)) return 'detour';
  if (/延伸|延駛|路線異動|起訖|發車站/.test(text)) return 'route';
  if (/停靠|站位|臨時站|遷移|裁撤|不停/.test(text)) return 'stops';
  if (/時刻|班次|發車時間|首班|末班|調整/.test(text)) return 'time';
  return 'info';
}

// A TDX Bus Alert or News row → { id, city (null: 公路客運's), title, text,
// routes (Set of RouteIDs), names (Set of routeNorm'd 【numbers】), stops
// (Set of StopIDs), cities, effect, stop, typhoon, from, to, url }.
export function busNotice(a, city = null) {
  const title = zh(a.Title).trim();
  const desc = zh(a.Description).trim();
  const text = desc.startsWith(title) ? desc : `${title}\n${desc}`;
  const end = Date.parse(a.EndTime);
  // (An end at midnight sharp is that day's: 「10/23 00:00」 for a notice about the 23rd.)
  const to = !Number.isFinite(end) ? Infinity : /T00:00(:00)?/.test(a.EndTime) ? end + 86_400_000 - 1 : end;
  const routes = new Set([...(a.Scope?.Routes || []), ...(a.Scope?.SubRoutes || [])].map(r => String(r.RouteID || r.SubRouteID || '')).filter(Boolean));
  const names = new Set([...text.matchAll(/【([^【】]{1,12})】/g)].map(m => routeNorm(m[1])).filter(n => n && !/客運|公司|巴士|颱風|公告|說明/.test(n)));
  const stops = new Set((a.Scope?.Stops || []).map(x => String(x.StopID || '')).filter(Boolean));
  const effect = effectOf(text);
  return {
    id: String(a.AlertID ?? a.NewsID ?? title),
    city,
    title,
    text,
    routes,
    names,
    stops,
    cities: citiesIn(text),
    effect,
    stop: effect === 'off',
    typhoon: TYPHOON.test(text),
    from: Date.parse(a.StartTime) || Date.parse(a.PublishTime) || 0,
    to,
    url: a.NewsURL || a.AlertURL || ''
  };
}
// The notices up now (and about today, when they name a day).
// (A notice still up past the day it names, and not naming today, is over.)
export function liveNotices(list, now = Date.now()) {
  const today = tw(now).date;
  const mentions = text => new RegExp(`(\\D|^)${Number(today.slice(8))}\\s*日`).test(text);
  return list.filter(n => {
    if (n.from > now || now > n.to) return false;
    const d = noticeDay(n.text, n.from);
    return !d || d >= today || mentions(n.text);
  });
}

const cityOfUid = uid => CITY_CODES[/^[A-Z]{3}/.exec(uid || '')?.[0]] || null;
// Whether a notice is about a route: a city's by its id or the 【number】 in
// its text; the 公路客運's by id (a city's route only when it names that city).
// With `stopUID`: a notice about that stop (its scope's stops) counts too.
function about(x, uid, name, stopUID = '') {
  const id = uid ? uid.slice(3) : '';
  const city = cityOfUid(uid);
  const n = routeNorm(name);
  if (x.city && x.city === city && ((id && x.routes.has(id)) || (n && x.names.has(n)))) return true;
  if (!x.city && id && x.routes.has(id) && (!city || x.cities.has(city))) return true;
  // (A 公路客運 notice naming its 【5614】: that route.)
  if (!x.city && !city && n && x.names.has(n)) return true;
  // A stop's own notice (closed, moved) with no routes named: every route there.
  if (stopUID && x.stops.size && !x.routes.size && x.stops.has(stopUID.slice(3)) && (!x.city || x.city === cityOfUid(stopUID))) return true;
  return false;
}
// The notices about a route today, strongest first.
export function routeNotices(notices, uid, name, now = Date.now(), stopUID = '') {
  if (!uid && !name) return [];
  return liveNotices(notices, now)
    .filter(x => about(x, uid, name, stopUID))
    .sort((a, b) => EFFECTS.indexOf(a.effect) - EFFECTS.indexOf(b.effect));
}
// The notice that stops a route today, or null.
export const busOff = (notices, uid, name, now = Date.now()) => routeNotices(notices, uid, name, now).find(x => x.stop) || null;

// The cities TDX has bus notices for (連江 none; Alert not for 臺南).
const NO_ALERT = new Set(['Tainan', 'LienchiangCounty']);
const NO_NEWS = new Set(['LienchiangCounty']);
// The bus notices of some cities and of the 公路客運 (a failed ask: none from it).
export async function busNotices(cities = []) {
  const asks = [
    ['basic/v2/Bus/Alert/InterCity', null],
    ['basic/v2/Bus/News/InterCity', null],
    ...[...new Set(cities)].filter(c => CITY_NAMES.some(([k]) => k === c)).flatMap(c => [...(NO_ALERT.has(c) ? [] : [[`basic/v2/Bus/Alert/City/${c}`, c]]), ...(NO_NEWS.has(c) ? [] : [[`basic/v2/Bus/News/City/${c}`, c]])])
  ];
  const lists = await Promise.all(asks.map(([p, c]) => tdx(p, { fresh: NOTICE_FRESH, max: 2e6 }).then(j => rows(j).map(a => busNotice(a, c)), () => [])));
  return lists.flat();
}

// ---- Buses on the road --------------------------------------------------------------------------

// A city's routes with a bus on the road ({ RouteUID: n stops with one
// coming; -1 TDX's 今日未營運 }, transit.js running) → whether that city's
// buses are, near enough, all off the road: under one route in twenty with
// a bus, of ten or more, between 07:00 and 20:00 (when every city's buses
// run). On 2026-10-23 at 16:00: 新竹市 0 of 29, 新竹縣 0 of 57.
export function cityIdle(run, now = Date.now()) {
  const list = Object.values(run?.routes || {});
  const h = tw(now).min / 60;
  if (list.length < 10 || h < 7 || h >= 20) return false;
  return list.filter(n => n > 0).length < list.length * 0.05;
}
// A route with no bus on the road while its city's buses are all off it:
// likely not running, said as that (never 今日停駛, which is the operator's word).
export const likelyOff = (run, uid, now = Date.now()) => Boolean(run?.routes) && (run.routes[uid] ?? 0) <= 0 && cityIdle(run, now);

// What's known so far, for the views that draw at once (a stop's buses): the
// notices and the buses on the road of every city asked for, kept 3 and 1
// minutes; a city not asked yet is asked behind, and the views told
// (onNotices) when it comes.
const busKnown = new Map(); // city ('' the 公路客運's) → { at, list }
const busAsking = new Map();
const runKnown = new Map(); // city → { at, run }
const runAsking = new Map();
const RUN_FRESH = 60_000;
const sigOf = () => [...busKnown].map(([k, v]) => `${k}:${v.list.map(n => `${n.id}${n.effect}`).join(',')}`).join('|') + [...runKnown].map(([k, v]) => `${k}:${cityIdle(v.run)}`).join('|');
export function ensureBus(cities = []) {
  const want = ['', ...cities.filter(Boolean)].filter(c => !(busKnown.get(c) && Date.now() - busKnown.get(c).at < NOTICE_FRESH));
  const asks = want.map(c => {
    if (!busAsking.has(c)) {
      busAsking.set(
        c,
        busNotices(c ? [c] : [])
          .then(list => {
            busKnown.set(c, { at: Date.now(), list: c ? list.filter(n => n.city === c) : list });
            changed(sigOf());
          })
          .finally(() => busAsking.delete(c))
      );
    }
    return busAsking.get(c);
  });
  for (const c of cities) if (c) ensureRunning(c);
  return Promise.all(asks).then(() => [...busKnown.values()].flatMap(v => v.list));
}
export function ensureRunning(city) {
  const k = runKnown.get(city);
  if (k && Date.now() - k.at < RUN_FRESH) return Promise.resolve(k.run);
  if (!runAsking.has(city)) {
    runAsking.set(
      city,
      busesRunning(city)
        .then(run => {
          runKnown.set(city, { at: Date.now(), run });
          changed(sigOf());
          return run;
        })
        .catch(() => k?.run || null)
        .finally(() => runAsking.delete(city))
    );
  }
  return runAsking.get(city);
}
export const runningIn = city => runKnown.get(city)?.run || null;

// A route's status now, from what's known: { effect, label, notice (or
// null for `likely`), notices (all of today's about it) } or null. The
// operator's word first; then, with nothing said, no bus on the road in a
// city whose buses are all off it. `stopUID`: a stop's own notices too.
export function routeStatus(uid, name, now = Date.now(), stopUID = '') {
  const city = cityOfUid(uid) || '';
  const runCity = city || 'InterCity';
  if (!busKnown.has('') || (city && !busKnown.has(city))) ensureBus([city]).catch(() => {});
  if (!runKnown.has(runCity)) ensureRunning(runCity);
  if (!city && home && !runKnown.has(home)) ensureRunning(home);
  const ns = routeNotices([...(busKnown.get('')?.list || []), ...(busKnown.get(city)?.list || [])], uid, name, now, stopUID);
  if (ns[0]?.effect === 'off') return { effect: 'off', label: effectLabel('off'), notice: ns[0], notices: ns };
  const run = runningIn(runCity);
  const n = run?.routes?.[uid];
  // TDX's 今日未營運 at every one of its stops: the operator's system says it, so it's off.
  if (n === -1) return { effect: 'off', label: effectLabel('off'), notice: null, why: 'tdx', notices: ns };
  // None on the road while its city's are all off it (a 公路客運 route: while yours are).
  const idle = city ? likelyOff(run, uid, now) : n === 0 && home && cityIdle(runningIn(home), now);
  if (idle) return { effect: 'likely', label: effectLabel('likely'), notice: null, why: 'idle', notices: ns };
  return ns.length ? { effect: ns[0].effect, label: effectLabel(ns[0].effect), notice: ns[0], notices: ns } : null;
}
// Where the phone is (TDX City): a 公路客運 route there is judged by its buses.
let home = '';
export const setHome = city => (home = city || '');
// Not running today (the operator's word, or likely so): its status, else null.
export function stoppedNow(uid, name, now = Date.now()) {
  const s = routeStatus(uid, name, now);
  return s && (s.effect === 'off' || s.effect === 'likely') ? s : null;
}

// ---- Everything for a place ---------------------------------------------------------------------

// For the banners: what's stopped or changed today around `cities` (TDX
// City names) and the metro `systems`: [{ kind, title, lines: [text], stop }].
// `kinds`: which to ask for ('tra', 'hsr', 'bus', 'metro'); `bikes`: the YouBike line, when they're all off.
export async function loadNotices({ cities = [], systems = [], kinds = ['tra', 'hsr', 'bus', 'metro'], bikes = '' } = {}, now = Date.now()) {
  const want = k => kinds.includes(k);
  const [tra, hsr, bus, metro, runs] = await Promise.all([want('tra') ? traNotices() : null, want('hsr') ? hsrNotice() : null, want('bus') ? ensureBus(cities) : [], want('metro') ? metroNotices(systems) : [], want('bus') ? Promise.all(cities.map(c => ensureRunning(c))) : []]);
  return summarize({ tra, hsr, bus, metro, cities, bikes, running: Object.fromEntries(cities.map((c, i) => [c, runs[i]])) }, now);
}
// YouBike closed around you (TDX's ServiceStatus 0 at every station near, three at least): its line.
export function bikesOff(stations) {
  const known = (stations || []).filter(s => s.ok != null);
  if (known.length < 3 || known.some(s => s.ok !== false)) return '';
  return W('附近的站全部暫停營運', 'Every station near you is closed');
}
// What's stopped, said short: 「對號列車停駛・平溪線、內灣線停駛」 (the banner's line).
export function traSummary(rules, date) {
  const on = (rules || []).filter(r => !r.date || r.date === date);
  const parts = [];
  if (on.some(r => !r.maybe && r.cls === 'reserved' && !r.name)) parts.push(W('對號列車停駛', 'Reserved-seat trains off'));
  if (on.some(r => !r.maybe && r.cls !== 'reserved' && !r.name)) parts.push(W('區間車停駛', 'Local trains off'));
  const lines = [...new Set(on.filter(r => !r.maybe && r.name).map(r => r.name))];
  if (lines.length) parts.push(W(`${lines.join('、')}停駛`, `${lines.length} lines off`));
  return parts.join(W('・', ' · '));
}

// The banners' rows: [{ kind, sys?, title, sum, lines: [text], stop }].
export function summarize({ tra, hsr, bus, metro, bikes, cities = [], running = {} }, now = Date.now()) {
  const out = [];
  const today = tw(now).date;
  const traNow = (tra?.notes || []).filter(n => n.from <= now + 6 * 3600_000 && now <= n.to && n.days.some(d => !d || d === today));
  if (traNow.length) out.push({ kind: 'tra', title: W('台鐵', 'TRA'), sum: traSummary(tra.rules, today), lines: traNow.map(n => n.text), stop: true });
  if (hsr) out.push({ kind: 'hsr', title: W('高鐵', 'HSR'), sum: hsr.title, lines: [hsr.text].filter(t => t && t !== hsr.title), stop: /停駛|停止/.test(hsr.title + hsr.text) });
  for (const m of metro || []) out.push({ kind: 'metro', sys: m.sys, title: METRO_NAMES[m.sys] || m.sys, sum: m.title, lines: [m.text].filter(t => t && t !== m.title), stop: m.stop });
  const here = new Set(cities);
  // Your cities' buses: none on the road (likely off), and today's notices from them and the 公路客運's naming them.
  const idle = cities.filter(c => cityIdle(running?.[c], now));
  const mine = liveNotices(bus || [], now).filter(n => (n.city ? here.has(n.city) : [...n.cities].some(c => here.has(c))) && (n.typhoon || (n.effect !== 'info' && (n.routes.size || n.names.size || n.stops.size))));
  const seen = new Set();
  const uniq = mine.filter(n => !seen.has(n.title) && seen.add(n.title)).sort((a, b) => EFFECTS.indexOf(a.effect) - EFFECTS.indexOf(b.effect));
  if (uniq.length || idle.length) {
    const offs = uniq.filter(n => n.stop).length;
    const sum = [idle.length ? W(`${idle.map(cityName).join('、')}的公車幾乎都沒在路上`, `Almost no buses on the road in ${idle.map(cityName).join(', ')}`) : '', offs ? W(`${offs} 則停駛公告`, `${offs} suspension notice${offs > 1 ? 's' : ''}`) : '', uniq.length > offs ? W(`${uniq.length - offs} 則異動`, `${uniq.length - offs} change${uniq.length - offs > 1 ? 's' : ''}`) : ''].filter(Boolean).join(W('・', ' · '));
    out.push({ kind: 'bus', title: W('公車', 'Buses'), sum, lines: [], said: uniq, stop: offs > 0 || idle.length > 0 });
  }
  if (bikes) out.push({ kind: 'bike', title: 'YouBike', sum: bikes, lines: [], stop: true });
  return out;
}
const cityName = c => cityShort(c);
const METRO_NAMES = { TRTC: W('臺北捷運', 'Taipei Metro'), TRTCMG: W('貓空纜車', 'Maokong Gondola'), TYMC: W('桃園捷運', 'Taoyuan Metro'), TMRT: W('臺中捷運', 'Taichung Metro'), KRTC: W('高雄捷運', 'Kaohsiung Metro'), KLRT: W('高雄輕軌', 'Kaohsiung LRT') };
