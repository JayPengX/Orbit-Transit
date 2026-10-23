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

import { tdx, rows } from './api.mjs';
import { tw, zh, addDays, routeNorm } from './util.mjs';
import { CITIES, CITY_CODES } from './city.mjs';

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

const STOPS = /停駛|停止營運|暫停行駛|停止行駛|暫停營運|取消發車|不營運/;
// What makes a notice only part of a day or some buses: shown, never a stop.
const PARTLY = /部分|部份|減班|調整|機動|視.{0,8}(情形|情況|狀況|天候)|正常行駛|改道|短駛|截|折返|繞駛|班距|班次如下|\d{1,2}\s*[:：點時]|上午|下午|中午|晚間|起停駛|前停駛|後停駛/;
const TYPHOON = /颱風|豪雨|停班停課|停止上班/;
const CITY_NAMES = CITIES.map(([code, name]) => [code, name, name.replace(/^臺/, '台')]);
// The cities a notice speaks of (新竹市, 宜蘭縣): its city routes are matched by id there.
const citiesIn = text => new Set(CITY_NAMES.filter(([, a, b]) => text.includes(a) || text.includes(b)).map(([code]) => code));

// A TDX Bus Alert or News row → { id, city (null: 公路客運's), title, text,
// routes (Set of RouteIDs), names (Set of routeNorm'd 【numbers】), cities, stop, typhoon, from, to, url }.
export function busNotice(a, city = null) {
  const title = zh(a.Title).trim();
  const desc = zh(a.Description).trim();
  const text = desc.startsWith(title) ? desc : `${title}\n${desc}`;
  const end = Date.parse(a.EndTime);
  // (An end at midnight sharp is that day's: 「10/23 00:00」 for a notice about the 23rd.)
  const to = !Number.isFinite(end) ? Infinity : /T00:00(:00)?/.test(a.EndTime) ? end + 86_400_000 - 1 : end;
  const routes = new Set([...(a.Scope?.Routes || []), ...(a.Scope?.SubRoutes || [])].map(r => String(r.RouteID || r.SubRouteID || '')).filter(Boolean));
  const names = new Set([...text.matchAll(/【([^【】]{1,12})】/g)].map(m => routeNorm(m[1])).filter(n => n && !/客運|公司|巴士|颱風|公告|說明/.test(n)));
  return {
    id: String(a.AlertID ?? a.NewsID ?? title),
    city,
    title,
    text,
    routes,
    names,
    cities: citiesIn(text),
    stop: STOPS.test(text) && !PARTLY.test(text),
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

// The notice that stops a route today, or null. `uid`: TDX's RouteUID
// (HSZ0010: 新竹市's 0010; THB…: 公路客運's); `name`: its number (182).
export function busOff(notices, uid, name, now = Date.now()) {
  if (!uid && !name) return null;
  const id = uid ? uid.slice(3) : '';
  const city = CITY_CODES[/^[A-Z]{3}/.exec(uid || '')?.[0]] || null;
  const n = routeNorm(name);
  for (const x of liveNotices(notices, now)) {
    if (!x.stop) continue;
    // A city's own notice: its routes by id, or by the number in its text.
    if (x.city && x.city === city && ((id && x.routes.has(id)) || (n && x.names.has(n)))) return x;
    // 公路客運's: its own routes by id; a city's routes by id only when it names that city.
    if (!x.city && id && x.routes.has(id) && (!city || x.cities.has(city))) return x;
  }
  return null;
}

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

// What's known so far, for the views that draw at once (a stop's buses): the
// notices of every city asked for, kept 3 minutes; a city not asked yet is
// asked behind, and the views told (onNotices) when it comes.
const busKnown = new Map(); // city ('' the 公路客運's) → { at, list }
const busAsking = new Map();
export function ensureBus(cities = []) {
  const want = ['', ...cities.filter(Boolean)].filter(c => !(busKnown.get(c) && Date.now() - busKnown.get(c).at < NOTICE_FRESH));
  const asks = want.map(c => {
    if (!busAsking.has(c)) {
      busAsking.set(
        c,
        busNotices(c ? [c] : [])
          .then(list => {
            busKnown.set(c, { at: Date.now(), list: c ? list.filter(n => n.city === c) : list });
            changed([...busKnown].map(([k, v]) => `${k}:${v.list.filter(n => n.stop).map(n => n.id).join(',')}`).join('|'));
          })
          .finally(() => busAsking.delete(c))
      );
    }
    return busAsking.get(c);
  });
  return Promise.all(asks).then(() => [...busKnown.values()].flatMap(v => v.list));
}
// Whether what's known stops a route today: its notice, or null (a city not
// known yet: asked for, null now).
export function stoppedNow(uid, name, now = Date.now()) {
  const city = CITY_CODES[/^[A-Z]{3}/.exec(uid || '')?.[0]] || '';
  if (!busKnown.has('') || (city && !busKnown.has(city))) ensureBus([city]).catch(() => {});
  return busOff([...(busKnown.get('')?.list || []), ...(busKnown.get(city)?.list || [])], uid, name, now);
}

// ---- Everything for a place ---------------------------------------------------------------------

// For the banners: what's stopped or changed today around `cities` (TDX
// City names) and the metro `systems`: [{ kind, title, lines: [text], stop }].
// `kinds`: which to ask for ('tra', 'hsr', 'bus', 'metro'); `bikes`: the YouBike line, when they're all off.
export async function loadNotices({ cities = [], systems = [], kinds = ['tra', 'hsr', 'bus', 'metro'], bikes = '' } = {}, now = Date.now()) {
  const want = k => kinds.includes(k);
  const [tra, hsr, bus, metro] = await Promise.all([want('tra') ? traNotices() : null, want('hsr') ? hsrNotice() : null, want('bus') ? ensureBus(cities) : [], want('metro') ? metroNotices(systems) : []]);
  return summarize({ tra, hsr, bus, metro, cities, bikes }, now);
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
export function summarize({ tra, hsr, bus, metro, bikes, cities = [] }, now = Date.now()) {
  const out = [];
  const today = tw(now).date;
  const traNow = (tra?.notes || []).filter(n => n.from <= now + 6 * 3600_000 && now <= n.to && n.days.some(d => !d || d === today));
  if (traNow.length) out.push({ kind: 'tra', title: W('台鐵', 'TRA'), sum: traSummary(tra.rules, today), lines: traNow.map(n => n.text), stop: true });
  if (hsr) out.push({ kind: 'hsr', title: W('高鐵', 'HSR'), sum: hsr.title, lines: [hsr.text].filter(t => t && t !== hsr.title), stop: /停駛|停止/.test(hsr.title + hsr.text) });
  for (const m of metro || []) out.push({ kind: 'metro', sys: m.sys, title: METRO_NAMES[m.sys] || m.sys, sum: m.title, lines: [m.text].filter(t => t && t !== m.title), stop: m.stop });
  const here = new Set(cities);
  // Today's bus notices from the cities you're in, and the 公路客運's that name them: stops, and typhoon changes.
  const mine = liveNotices(bus || [], now).filter(n => (n.typhoon || n.stop) && (n.city ? here.has(n.city) : n.typhoon && [...n.cities].some(c => here.has(c))));
  const seen = new Set();
  const uniq = mine.filter(n => !seen.has(n.title) && seen.add(n.title)).sort((a, b) => b.stop - a.stop);
  if (uniq.length) {
    const stops = uniq.filter(n => n.stop).length;
    const sum = [stops ? W(`${stops} 則停駛公告`, `${stops} suspension notice${stops > 1 ? 's' : ''}`) : '', uniq.length > stops ? W(`${uniq.length - stops} 則班次調整`, `${uniq.length - stops} change${uniq.length - stops > 1 ? 's' : ''}`) : ''].filter(Boolean).join(W('・', ' · '));
    out.push({ kind: 'bus', title: W('公車', 'Buses'), sum, lines: uniq.map(n => n.text), stop: stops > 0 });
  }
  if (bikes) out.push({ kind: 'bike', title: 'YouBike', sum: bikes, lines: [], stop: true });
  return out;
}
const METRO_NAMES = { TRTC: W('臺北捷運', 'Taipei Metro'), TRTCMG: W('貓空纜車', 'Maokong Gondola'), TYMC: W('桃園捷運', 'Taoyuan Metro'), TMRT: W('臺中捷運', 'Taichung Metro'), KRTC: W('高雄捷運', 'Kaohsiung Metro'), KLRT: W('高雄輕軌', 'Kaohsiung LRT') };
