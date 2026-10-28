// Buses, the parts every tab uses: a route's sheet (its stops each way with
// the buses on them, or a stop's timetable), finding a route (your city, its
// neighbours and 公路客運 together, or one city), pinning a stop into a group
// (常用, 上班, 回家…), managing the groups, and the stops around a point with
// every bus due.

import { emptyNote, saidRows } from './look.mjs';
import { routeStops, routeEta, routeEtaPath, etaKey, etaText, etaOf, said as saidNow, routeSchedule, stopTimes, stationsNear, etaRank, routeCity, INTERCITY } from './bus.mjs';
import { fitNumbers } from '#kit/orbit.mjs';
import { errorText, tdx, rows, dataAt, liveMs } from './api.mjs';
import { CITY_CODES, cityShort } from './city.mjs';
import { cleanItem, MAX_GROUPS, MAX_ITEMS, move } from './store.mjs';
import { sheet, sheetHead, icon, ago } from './ui.mjs';
import { e, uid, meters, tw, twAt, zh, addDays, hm, dayLabel, readJson, writeJson, shown } from './util.mjs';
import { nextRun, nextUnseen, liveTrusted } from './live.mjs';
import { routeStatus, effectLabel } from './service.mjs';

import { W, en } from '#kit/lang.mjs';
import * as kitUI from '#kit/ui.mjs';
const WEEK = '日一二三四五六';
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const wk = i => (en ? WEEK_EN[i] : `週${WEEK[i]}`);
// 'HH:MM' times as a stop's sign has them: an hour a row, its minutes beside it.
export const hours = times => [...times.reduce((m, t) => m.set(t.slice(0, 2), [...(m.get(t.slice(0, 2)) || []), t]), new Map())];
let ctx = null;
export const useBusCtx = c => (ctx = c);

// ---- The stops around a point: every bus due (one TDX ask) -----------------------------------------

// → [{ name, dist, lat, lon, rows: [{ route, uid, city, dir, stopUID, v }] }], nearest stop first.
export async function nearStops(h, { r = 350, n = 6 } = {}) {
  const at = p => (Math.round(p * 1000) / 1000).toFixed(3);
  const [j, stations] = await Promise.all([
    tdx(`advanced/v2/Bus/EstimatedTimeOfArrival/NearBy?$spatialFilter=nearby(${at(h.lat)},${at(h.lon)},${r})&$select=StopUID,StopName,RouteUID,RouteName,Direction,EstimateTime,StopStatus,NextBusTime,IsLastBus,Estimates,DataTime&$top=300`, { fresh: 'live' }),
    stationsNear(h.lat, h.lon).catch(() => [])
  ]);
  const where = name => {
    const list = stations.filter(s => s.name === name).map(s => [meters(h.lat, h.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0]);
    return list[0] ? { dist: list[0][0], lat: list[0][1].lat, lon: list[0][1].lon } : { dist: Infinity };
  };
  const byStop = new Map();
  for (const r0 of rows(j)) {
    const name = zh(r0.StopName);
    if (!byStop.has(name)) byStop.set(name, new Map());
    const key = `${r0.RouteUID}|${r0.Direction}`;
    const v = etaOf(r0);
    const old = byStop.get(name).get(key);
    if (!old || (v.sec != null && (old.v.sec == null || v.sec < old.v.sec))) {
      const code = /^[A-Z]{3}/.exec(r0.RouteUID || '')?.[0];
      byStop.get(name).set(key, { route: zh(r0.RouteName), uid: r0.RouteUID, city: CITY_CODES[code] || INTERCITY, dir: Number(r0.Direction) || 0, stopUID: r0.StopUID, stop: name, v });
    }
  }
  // Soonest first at each stop; buses that aren't running today last.
  return [...byStop]
    .map(([name, m]) => ({ name, ...where(name), rows: [...m.values()].sort((a, b) => etaRank(a.v) - etaRank(b.v)) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

// The stops around you as last read, kept on the phone: an opening shows them
// at once (the owner, 2026-10-21: 附近 was grey bars every time, and then the
// stops of where the app was last opened), read again behind them, and again
// once the phone's fix is somewhere else. 交通 and the map's sheet share them.
const NEAR_KEY = 'orbit-transit.near';
const NEAR_KEEP_MS = 10 * 60_000;
// Moved this far from where they were read: read again.
const NEAR_MOVED_M = 150;
// A stop further than this isn't 附近.
const NEAR_STOP_M = 450;
export const nearMoved = (at, h) => Boolean(h) && (!at || at.lat == null || meters(h.lat, h.lon, at.lat, at.lon) > NEAR_MOVED_M);
// → { at, lat, lon, stops } or null (none kept, too old, or kept for somewhere else); the buses' times counted down since.
export function keptNear(h, now = Date.now()) {
  const k = readJson(NEAR_KEY);
  if (!Array.isArray(k?.stops) || now - k.at > NEAR_KEEP_MS || nearMoved(k, h)) return null;
  const age = Math.round((now - k.at) / 1000);
  const v = x => (x && x.sec != null ? { ...x, sec: Math.max(0, x.sec - age), more: (x.more || []).map(m => m - age).filter(m => m > 0), t: now } : x);
  return { ...k, stops: k.stops.map(st => ({ ...st, dist: st.dist ?? Infinity, rows: st.rows.map(r => ({ ...r, v: v(r.v) })) })) };
}
// The stops read at h, the far ones left out (unless none could be placed), kept.
export function keepNear(h, stops) {
  const near = stops.some(st => Number.isFinite(st.dist)) ? stops.filter(st => st.dist <= NEAR_STOP_M) : stops;
  writeJson(NEAR_KEY, { at: Date.now(), lat: h.lat, lon: h.lon, stops: near });
  return near;
}

// ---- Finding a route --------------------------------------------------------------------------------


// ---- A bus route as a strip: one look wherever a route is listed --------------------------------------
// (查時刻's routes, 交通's pinned rides and the buses near a pinned place, a
// stop's card on the map.) Like a card in Maps: the route's number and a
// note (its way, its city) on top, the main words (where you get on, or the
// way it goes) the whole width under them, its next bus on the right. Words
// shrink to their room (fitStrips): never a second line, never cut.
// (`note` and `main` are HTML, escaped by the caller.)
// A route as one row, the same wherever routes are listed (查時刻, 交通, a
// stop's card): its number on the left; the main words (the stop you'd get
// on at, or where it goes) over a quiet note; the next bus on the right, live
// minutes in green, a clock time plain, words (末班已過…) small and grey.
// `wait`: its next bus still being asked: bars in the words' places, the row
// already its full height (nothing moves when the answer comes).
const skel = w => `<i class="ot-skel" style="width:${w}"></i>&#8203;`;
// (Its time pops as it changes: the kit's data-q-live, keyed by the strip.)
// A route's name in its badge: a long one (快捷8號支, 藍15區) on two lines,
// its words over its number, each line fitted, never past the tile.
export function noHtml(no) {
  const t = String(no ?? '');
  // (Letters and digits only, 1813E: one line, shrunk; never split mid-number.)
  if ([...t].length <= 4 || !/[\u3400-\u9fff]/u.test(t)) return `<span>${e(t)}</span>`;
  const m = /^(\D+?)(\d.*)$/u.exec(t);
  const half = Math.ceil([...t].length / 2);
  const [a, b] = m && m[1].trim() && m[2].trim() ? [m[1], m[2]] : [[...t].slice(0, half).join(''), [...t].slice(half).join('')];
  return `<span class="ot-no2" aria-label="${e(t)}"><i>${e(a.trim())}</i><i>${e(b.trim())}</i></span>`;
}
export function strip({ no, note = '', main = '', eta = null, attrs = '', wait = false }) {
  const when = wait
    ? `<span class="ot-strip-eta"><b>${skel('46px')}</b><small>${skel('28px')}</small></span>`
    : eta
      ? `<span class="ot-strip-eta ${eta.tone}${/\d/.test(eta.main) ? '' : ' words'}${/分|進站|min|Arriving|Due/.test(eta.main) ? ' live' : ''}"><b data-q-live="${e(`eta:${no}:${attrs}`)}">${e(eta.main)}</b>${eta.sub ? `<small>${e(eta.sub)}</small>` : ''}</span>`
      : '';
  const sub = wait ? `<small>${skel('84px')}</small>` : note ? `<small>${note}</small>` : '';
  return `<button class="ot-strip-main" type="button" ${attrs}><span class="ot-strip-no${wait && !no ? ' wait' : ''}">${wait && !no ? '' : noHtml(shown(no))}</span><span class="ot-strip-mid"><span class="ot-strip-what"><b>${wait ? skel('128px') : main}</b></span>${sub ? `<span class="ot-strip-note">${sub}</span>` : ''}</span>${when}</button>`;
}
// (The number too: its badge one width, so every strip's words start in one column.)
// A note still too wide at the smallest size drops its less useful part
// (`.ot-drop`, e.g. 「· 4 站」) and fits again: shown whole, never cut.
export function fitStrips(box) {
  const all = () => [...box.querySelectorAll('.ot-strip-note small, .ot-strip-what b, .ot-strip-no > span:not(.ot-no2), .ot-no2 > i')];
  for (const x of box.querySelectorAll('.ot-drop')) x.hidden = false;
  fitNumbers(all());
  const over = [...box.querySelectorAll('.ot-strip-note small')].filter(el => el.querySelector('.ot-drop') && el.scrollWidth > (el.parentElement?.clientWidth || Infinity));
  if (!over.length) return;
  for (const el of over) el.querySelector('.ot-drop').hidden = true;
  fitNumbers(all());
}

// What's said about a route today (service.mjs routeStatus): a small chip in
// the route sheet's head (今日停駛 ›), the whole of it a tap away in its own
// sheet. (The owner, 2026-10-23: two fat notice cards over the stops took the
// room and made the list scroll strangely.) 可能停駛 says why there.
const OFF = new Set(['off', 'likely', 'part']);
export const saidChip = said => (said ? `<button class="ot-rt-flag${OFF.has(said.effect) ? ' off' : ''}" type="button" data-said>${e(said.label)}${icon('chevron')}</button>` : '');
const why = (label, title, text) => `<div class="ot-said"><details open class="ot-said-row off"><summary><b>${label}</b><span>${title}</span></summary><p>${text}</p></details></div>`;
export const saidHtml = said =>
  said
    ? `${said.why === 'idle' ? why(effectLabel('likely'), W('路上沒有公車', 'No bus on the road'), W('這一帶的公車現在幾乎都不在路上，這條也沒有；業者沒有公告，所以只說可能。', 'Almost no buses around here are on the road now, this one included. Its operator hasn’t said, so it’s only likely.')) : said.why === 'tdx' ? why(effectLabel('off'), W('每一站都今日未營運', 'Not running at any stop today'), W('公車動態系統說這條路線今天每一站都未營運。', 'The bus tracking system says this route isn’t running at any stop today.')) : ''}${said.notices.length ? saidRows(said.notices, { open: true }) : ''}`
    : '';

// What a stop's time says: the live time while a bus is on its way, else the
// timetable's next there (`planned`: { at, day }, its day when not today's).
// (Not running today, 今日停駛 or 可能停駛: that, never the timetable's next.)
export function busWhen(v, planned) {
  v = v && saidNow(v);
  if (planned && !(v?.status === 0 && v.sec != null) && !(v?.status === 4 && v.flag)) return { main: hm(planned.at), sub: v?.flag ? v.flag.label : planned.day ? dayLabel(tw(planned.at).date) : W('預計', 'planned'), tone: 'wait' };
  return etaText(v);
}
// The timetable's next bus at a stop with none on its way (`r`: routeUID,
// route, city, dir, stopUID; `near`: where, for the route's pack): its stops
// and times from the bus packs, no proxy read. → { at, day } or null.
export async function plannedAt(r, near = null) {
  const route = { uid: r.routeUID, name: r.route, city: r.city || routeCity(r.routeUID) };
  const [ways, sched] = await Promise.all([routeStops(route, near), routeSchedule(route, near)]);
  const w = ways.find(x => x.dir === r.dir && x.stops.some(y => y.uid === r.stopUID)) || ways.find(x => x.stops.some(y => y.uid === r.stopUID));
  return w && sched?.length ? nextRun(sched, w, w.stops.findIndex(y => y.uid === r.stopUID), Date.now()) : null;
}
// A route's next bus near you: at each way's stop nearest you (not its last,
// where its buses end), the sooner of the ways whose stop is about as near
// (a street's two sides; 300 m); with no bus on its way, the timetable's.
// → { stop, stopUID, dir, headsign, v, planned } or null.
export async function nextNear(route, here) {
  if (!here) return null;
  const [ways, live] = await Promise.all([routeStops(route, here), routeEta(route)]);
  const near = [];
  for (const dir of new Set(ways.map(w => w.dir))) {
    const w = ways.find(x => x.dir === dir);
    const [d, i] = w.stops
      .slice(0, -1)
      .map((x, k) => [Number.isFinite(x.lat) ? meters(here.lat, here.lon, x.lat, x.lon) : Infinity, k])
      .sort((a, b) => a[0] - b[0])[0] || [Infinity, -1];
    if (i >= 0 && d < Infinity) near.push({ d, w, i, stop: w.stops[i].name, stopUID: w.stops[i].uid, dir, headsign: w.headsign, v: live.get(etaKey(w.stops[i].uid, route.uid, dir)) || null });
  }
  if (!near.length) return null;
  const nearest = Math.min(...near.map(x => x.d));
  const close = near.filter(x => x.d <= nearest + 300);
  if (!close.some(x => x.v?.status === 0 && x.v.sec != null)) {
    const sched = await routeSchedule(route, here).catch(() => null);
    for (const x of close) x.planned = sched?.length ? nextRun(sched, x.w, x.i, Date.now()) : null;
  }
  const at = x => (x.v?.status === 0 && x.v.sec != null ? Date.now() + x.v.sec * 1000 : x.planned?.at ?? Infinity);
  const { w, i, ...best } = close.sort((a, b) => at(a) - at(b) || a.d - b.d)[0];
  return best;
}

// ---- A route: its stops each way, the buses on them ----------------------------------------------------

// A bus between stop k-1 and stop k of a way (`lives`: each stop's live
// time, trusted): k's live time sooner than k-1's (that one's is a later
// bus, or it's gone by), and not at k already (that bus rides on k's dot).
// Drawn on the line between them, so a bus on its way is seen at a glance.
const coming = v => v?.status === 0 && v.sec != null;
// Another bus than the one coming to stop k-1 first: k's live time sooner
// than k-1's. (The same bus reaches k a minute or two after k-1: one bus
// pulling in at 地方法院 is 2 分 to 東門市場 and 3 分 to 火車站, not three buses.)
const nextBus = (lives, k) => k === 0 || !coming(lives[k - 1]) || lives[k - 1].sec > lives[k].sec + 20;
export const busBetween = (lives, k) => k > 0 && coming(lives[k]) && etaText(lives[k]).tone !== 'now' && nextBus(lives, k);
// A bus at stop k (進站中, 即將進站), drawn on its dot: only the one bus, at
// the first stop it reaches; the stops after it say 即將進站 without one.
export const busAt = (lives, k) => coming(lives[k]) && etaText(lives[k]).tone === 'now' && nextBus(lives, k);

export async function openRoute(c, route, { stopUID = '', stopName = '', dir = null, add = false } = {}) {
  ctx ||= c;
  let ways = null;
  let way = 0;
  let live = new Map();
  let at = 0;
  let err = '';
  // 即時 (the buses on the stops now) or 時刻表 (a day's times at one stop:
  // today, or any day of the coming week, since weekends run their own).
  let view = 'live';
  let day = 0;
  let dayPicked = false;
  let moved = '';
  let sched = null;
  let picked = stopUID;
  // Pinning a ride: the stop you get on at, then the one you get off at.
  let boarding = null;
  const d = sheet(`<div id="rt"></div>`, 'ot-tall-sheet ot-route-sheet');
  routeSchedule(route, c?.here)
    .then(x => {
      sched = x;
      if (d.open) draw();
    })
    .catch(() => (sched = []));
  const today = () => tw();
  // The timetable's next bus at each stop (公路客運's first-stop times plus
  // the ride there), today or the nearest day the route runs.
  const planned = (w, k) => (sched?.length ? nextRun(sched, w, k, Date.now()) : null);
  const dayName = n => {
    const t = today();
    return n === 1 ? W(`明天（週${WEEK[(t.dow + 1) % 7]}）`, `tomorrow (${WEEK_EN[(t.dow + 1) % 7]})`) : wk((t.dow + n) % 7);
  };
  // The route not running again today: which day the stops' times are of.
  const offNote = w => {
    const first = planned(w, 0);
    if (!first || first.day === 0) return '';
    const ranToday = nextRun(sched, w, 0, twAt(today().date, '00:00'), 0);
    return W(`${ranToday ? '今天已收班' : '今天不行駛'}，以下是${dayName(first.day)}的時刻`, `${ranToday ? 'Done for today' : 'Not running today'}; times for ${dayName(first.day)}`);
  };
  const tableHtml = w => {
    if (!sched) return `<p class="ot-note">${W('載入時刻表…', 'Loading the timetable…')}</p>`;
    const s = w.stops.find(x => x.uid === picked) || w.stops[0];
    const t0 = today();
    // Not running today at this stop (a weekday route on Sunday): the nearest day it does, said so.
    if (!dayPicked) {
      day = 0;
      moved = '';
      const has = n => {
        const x = stopTimes(sched, { stopUID: s.uid, name: s.name, dir: w.dir }, addDays(t0.date, n), (t0.dow + n) % 7);
        return x.times.length || x.every.length;
      };
      const n = has(0) ? 0 : [1, 2, 3, 4, 5, 6].find(has);
      if (n) {
        day = n;
        moved = W(`今天不行駛，顯示${dayName(n)}的時刻`, `Not running today; showing ${dayName(n)}`);
      }
    }
    const date = addDays(t0.date, day);
    const dow = (t0.dow + day) % 7;
    // Today's past times greyed and its next one marked; another day's all alike.
    const now = day ? '' : t0.hm;
    const { times, every } = stopTimes(sched, { stopUID: s.uid, name: s.name, dir: w.dir }, date, dow);
    const next = day ? null : times.find(t => t >= now);
    const named = day === 0 ? W('今天', 'Today') : day === 1 ? W('明天', 'Tomorrow') : wk(dow);
    // The coming week: the family's strip of days (drawn in after, ttDays).
    const days = '<div class="ot-tt-strip"></div>';
    // The stop: a native picker (an iPhone's wheel), its name the label.
    const stopPick = `<label class="ot-tt-stop"><b>${e(shown(s.name))}</b>${icon('down')}<select data-pickstop aria-label="${W('換站牌', 'Change stop')}">${w.stops.map(x => `<option value="${e(x.uid)}"${x.uid === s.uid ? ' selected' : ''}>${e(shown(x.name))}</option>`).join('')}</select></label>`;
    const body = times.length
      ? `<div class="ot-timetable">${hours(times)
          .map(([h, list]) => `<div class="ot-tt-hour"><b>${e(h)}</b><span>${list.map(t => `<i class="${t < now ? 'past' : t === next ? 'next' : ''}">${e(t.slice(3, 5))}</i>`).join('')}</span></div>`)
          .join('')}</div>`
      : every.length
        ? `<div class="ot-list">${every.map(f => `<div class="ot-order-row"><span>${e(f.from)}–${e(f.to)}</span><b>${f.min && f.max && f.min !== f.max ? W(`每 ${f.min}–${f.max} 分`, `every ${f.min}–${f.max} min`) : W(`每 ${f.min || f.max} 分`, `every ${f.min || f.max} min`)}</b></div>`).join('')}</div>`
        : `<p class="ot-note">${W(`${named}這個站牌沒有排班資料（業者沒提供，或${named}停駛）。`, `No timetable at this stop for ${named.toLowerCase()} (none published, or not running).`)}</p>`;
    return `${days}${moved ? `<p class="ot-note ot-off-note">${e(moved)}</p>` : ''}<div class="ot-tt-head">${stopPick}<small>${e(named)}${times.length ? ` ${W(`${times.length} 班`, `${times.length} buses`)}${day ? '' : next ? `・${W('下一班', 'next')} ${e(next)}` : `・${W('已收班', 'done')}`}` : ''}</small></div>${body}`;
  };
  let offDay = 0;
  const draw = () => {
    const w = ways?.[way];
    // What's said about it today (service.mjs): its status at the top, the notice a tap away.
    const said = routeStatus(route.uid, route.name);
    const stopped = said && (said.effect === 'off' || said.effect === 'likely');
    const off = stopped ? '' : w && sched?.length ? offNote(w) : '';
    offDay = off ? planned(w, 0).day : 0;
    const keep = d.scrollTop;
    // Like a stop's sign: the route's number big, where it's going beside it;
    // the way and the view stay at the top while the stops scroll under.
    const where = route.city === INTERCITY ? W('公路客運', 'Intercity') : cityShort(route.city);
    // Two ways: the segmented control under the head names them, so the head says where (not 往 … twice).
    const both = Boolean(ways && ways.length > 1);
    const head = `<div class="q-sheet-head ot-rt-head"><div class="ot-rt-id"><span class="ot-rt-no">${e(shown(route.name))}</span><div><h2>${both ? e(where) : w ? `${W('往', 'To')} ${e(shown(w.headsign))}` : W('路線', 'Route')}</h2>${both ? (w?.subName && w.subName !== route.name ? `<p class="ot-sheet-sub">${e(shown(w.subName))}${saidChip(said)}</p>` : said ? `<p class="ot-sheet-sub">${saidChip(said)}</p>` : '') : `<p class="ot-sheet-sub">${e(where)}${w?.subName && w.subName !== route.name ? ` · ${e(shown(w.subName))}` : ''}${saidChip(said)}</p>`}</div></div><button class="q-close" type="button" data-act="close" aria-label="${W('關閉', 'Close')}">✕</button></div>`;
    // Two short ways: a segmented control. More (a loop's branches, 5 to 10 on
    // some intercity routes) or long names: chips in a row to scroll, each said whole.
    const many = Boolean(ways && (ways.length > 2 || ways.some(x => String(x.headsign || '').length > 7)));
    const tabs = ways && ways.length > 1 ? `<div class="${many ? 'q-chips ot-dir ot-dir-chips' : 'q-seg ot-dir'}" role="group" aria-label="${W('方向', 'Direction')}">${ways.map((x, i) => `<button type="button"${many ? ' class="q-chip"' : ''} data-way="${i}" aria-pressed="${i === way}">${W('往', 'To')} ${e(shown(x.headsign))}</button>`).join('')}</div>` : '';
    const views = `<div class="q-seg ot-view" role="group" aria-label="${W('即時或時刻表', 'Live or timetable')}"><button type="button" data-view="live" aria-pressed="${view === 'live'}">${W('即時到站', 'Live')}</button><button type="button" data-view="table" aria-pressed="${view === 'table'}">${W('時刻表', 'Timetable')}</button></div>`;
    // Each stop's live time, trusted: a bus 'coming' that the timetable has
    // nowhere near (resting with its tracker on) isn't taken (the
    // timetable's time instead).
    const lives = (w?.stops || []).map((s, k) => {
      const v = live.get(etaKey(s.uid, route.uid, w.dir));
      return v?.status === 0 && v.sec != null && !liveTrusted(sched, w, k, Date.now() + v.sec * 1000) ? null : v;
    });
    const between = k => busBetween(lives, k);
    const stops = !ways
      ? `<p class="ot-note">${W('載入站牌中…', 'Loading stops…')}</p>`
      : !w
        ? emptyNote(W('這條路線沒有站牌資料', 'No stops for this route'))
        : view === 'table'
          ? tableHtml(w)
          : `${off ? `<p class="ot-note ot-off-note">${e(off)}</p>` : ''}<ol class="ot-route-stops">${w.stops
            .map(s => {
              const k = w.stops.indexOf(s);
              const v = lives[k];
              let t = etaText(v);
              // No bus on its way to it (尚未發車, 末班已過 the other way…): the timetable's next.
              // (Not the bus already seen further on: nextUnseen.)
              const p = !stopped && (!v || v.status !== 0 || v.sec == null) && sched?.length ? nextUnseen(sched, w, k, lives, Date.now()) : null;
              // (Said once at the top: each stop only a dash.)
              if (stopped && !(v?.status === 0 && v.sec != null)) t = { main: '—', sub: '', tone: 'off' };
              // (Another day's said once above the stops, when it's every stop's.)
              // (Said once above the stops that it's the timetable; another day's only when it's this stop's own.)
              if (p) t = { main: hm(p.at), sub: p.day && p.day !== offDay ? dayName(p.day) : '', tone: 'wait' };
              const mine = s.uid === stopUID;
              const ride = pinnedAt(s.uid);
              // Choosing where to get off: the stops after the one you get on at.
              const at = boarding ? w.stops.findIndex(x => x.uid === boarding.uid) : -1;
              const pick = boarding ? (k > at ? ' can-off' : k === at ? ' on-here' : ' before') : '';
              // A bus at the stop (進站中, 即將進站) rides on its dot.
              return `<li class="${t.tone}${busAt(lives, k) ? ' at' : ''}${mine ? ' mine' : ''}${pick}" data-stop="${e(s.uid)}"${boarding && k > at ? ` data-off="${e(s.uid)}"` : ''}><span class="ot-rs-eta ${t.tone}">${e(t.main)}</span>${between(k) ? `<i class="ot-rs-bus" aria-label="${W('公車在這兩站之間', 'Bus between these stops')}">${icon('bus')}</i>` : ''}<span class="ot-rs-dot">${busAt(lives, k) ? icon('bus') : ''}</span><span class="ot-rs-name"><b>${e(shown(s.name))}</b>${k === at ? `<small>${W('上車', 'Board')}</small>` : ride?.off ? `<small>${icon('star')} ${W('到', 'to')} ${e(shown(ride.off.stop))}</small>` : t.sub ? `<small>${e(t.sub)}</small>` : ''}</span>${boarding ? '' : `<button class="ot-rs-star${ride ? ' on' : ''}" type="button" data-add="${e(s.uid)}" aria-label="${ride ? W('取消釘選', 'Unpin') : W('從這站上車，釘選', 'Board here and pin')}">${icon('star')}</button>`}</li>`;
            })
            .join('')}</ol>`;
    const choose = boarding && view === 'live' ? `<div class="ot-ride-pick"><div><b>${W(`${e(shown(boarding.name))} 上車`, `Board at ${e(shown(boarding.name))}`)}</b><small>${W('選下車站', 'Pick your stop')}</small></div><button class="q-btn" type="button" data-only="1">${W('只釘這站', 'Just this stop')}</button><button class="q-icon-btn" type="button" data-cancel-ride="1" aria-label="${W('取消', 'Cancel')}">${icon('x')}</button></div>` : '';
    const dirLeft = d.querySelector('.ot-dir-chips')?.scrollLeft || 0;
    d.querySelector('#rt').innerHTML = `<div class="ot-rt-top q-day-still">${head}${tabs}${views}${choose}</div>${err && view === 'live' ? `<p class="ot-note bad">${e(err)}</p>` : ''}${stops}${view === 'live' && !boarding && at ? `<p class="ot-note center">${e(ago(at))}</p>` : ''}`;
    // (The row of ways where it was; the one chosen in sight.)
    const row = d.querySelector('.ot-dir-chips');
    if (row) {
      row.scrollLeft = dirLeft;
      const on = row.querySelector('[aria-pressed="true"]');
      if (on && (on.offsetLeft < row.scrollLeft || on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth)) row.scrollLeft = on.offsetLeft - 16;
    }
    ttDays();
    d.scrollTop = keep;
  };
  // The timetable's days: the coming week on the family's strip (📅 among
  // them), a swipe across the times for the day either side.
  const ttRec = {};
  const week = () => kitUI.dayList(today().date, addDays(today().date, 6));
  const pickDay = date => {
    day = week().indexOf(date);
    if (day < 0) return void (day = 0);
    dayPicked = true;
    moved = '';
    draw();
  };
  const ttDays = () => d.querySelector('.ot-tt-strip')?.replaceWith(kitUI.dayBar(ttRec, { flat: true, days: week(), current: addDays(today().date, day), today: today().date, follow: true, onPick: pickDay }));
  kitUI.daySwipe(d.querySelector('#rt'), dir => {
    const next = view === 'table' && kitUI.dayStep(week(), addDays(today().date, day), dir);
    return Boolean(next && (pickDay(next), true));
  });
  // A ride pinned on at this stop, either way (the way back gets on where the ride gets off).
  const rideAt = uid => x => x.routeUID === route.uid && (x.stopUID === uid || x.back?.stopUID === uid);
  const pinnedAt = uid => {
    const x = ctx.data.groups.flatMap(g => g.items).find(rideAt(uid));
    return x && x.back?.stopUID === uid ? { ...x, off: x.back.off } : x;
  };
  // A ride pinned: on at `on`, off at `off` (null: just the stop), and the
  // way back: the other direction, on where you got off, off where you got on.
  const saveRide = (w, on, off) => {
    const all = ctx.data.groups.flatMap(g => g.items);
    if (all.length >= MAX_ITEMS * ctx.data.groups.length) return ctx.status(W('釘選的公車太多了，先刪掉一些', 'Too many pinned buses; remove some first'));
    const pt = s => ({ stopUID: s.uid, stop: s.name, lat: s.lat, lon: s.lon });
    let back = null;
    if (off) {
      for (const o of ways.filter(x => x.dir !== w.dir)) {
        const b = o.stops.findIndex(x => x.name === off.name);
        const f = o.stops.findIndex((x, i) => i > b && x.name === on.name);
        if (b >= 0 && f > b) {
          back = { ...pt(o.stops[b]), dir: o.dir, headsign: o.headsign, off: pt(o.stops[f]) };
          break;
        }
      }
    }
    const n = off ? w.stops.indexOf(off) - w.stops.indexOf(on) : 0;
    const item = cleanItem({ id: 'i' + uid(), city: route.city, routeUID: route.uid, route: route.name, dir: w.dir, stopUID: on.uid, stop: on.name, headsign: w.headsign, lat: on.lat, lon: on.lon, ...(off ? { off: pt(off), n, back } : {}) });
    const g = ctx.data.groups[0] || (ctx.data.groups[0] = { id: 'g' + uid(), name: W('常用', 'Favorites'), items: [] });
    g.items.push(item);
    ctx.save();
    ctx.refreshTabs?.();
    ctx.status(off ? W(`已釘選 ${route.name}：${on.name} → ${off.name}${back ? '，回程自動對調' : ''}`, `Pinned ${route.name}: ${on.name} → ${off.name}${back ? ', back flips' : ''}`) : W(`已釘選 ${route.name} ${on.name}`, `Pinned ${route.name} at ${on.name}`));
  };
  const refresh = async () => {
    try {
      live = await routeEta(route);
      at = Math.min(Date.now(), dataAt(routeEtaPath(route)) || Date.now());
      err = '';
    } catch (x) {
      err = errorText(x);
    }
    if (d.open) draw();
  };
  draw();
  try {
    ways = await routeStops(route, c?.here);
    // The stop asked for: by its id, else by its name (a stop's two sides of
    // the road have ids of their own: the side this route's way stops at).
    const has = (w, f) => w.stops.some(f);
    if (stopUID && stopName && !ways.some(w => has(w, s => s.uid === stopUID))) {
      const w = ways.find(x => (dir == null || x.dir === dir) && has(x, s => s.name === stopName)) || ways.find(x => has(x, s => s.name === stopName));
      if (w) picked = stopUID = w.stops.find(s => s.name === stopName).uid;
    }
    if (dir != null || stopUID) {
      const i = ways.findIndex(w => (dir == null || w.dir === dir) && (!stopUID || has(w, s => s.uid === stopUID)));
      way = i >= 0 ? i : Math.max(0, ways.findIndex(w => has(w, s => s.uid === stopUID)));
    }
    // A sub-route the main pattern already covers is one tab less.
    ways = ways.filter((w, i) => i === way || !ways.some((o, j) => j < i && o.dir === w.dir && w.stops.every(s => o.stops.some(x => x.uid === s.uid))));
    way = Math.min(way, ways.length - 1);
  } catch (x) {
    err = errorText(x);
    ways = [];
  }
  draw();
  refresh();
  const t = setInterval(refresh, liveMs());
  d.onclosed = () => clearInterval(t);
  // Scrolled to the stop asked for.
  if (stopUID) requestAnimationFrame(() => d.querySelector(`[data-stop="${CSS.escape(stopUID)}"]`)?.scrollIntoView({ block: 'center' }));
  d.addEventListener('change', ev => {
    if (!ev.target.matches('[data-pickstop]')) return;
    picked = ev.target.value;
    draw();
  });
  d.addEventListener('click', ev => {
    if (ev.target.closest('[data-said]')) {
      const said = routeStatus(route.uid, route.name);
      if (said) sheet(`${sheetHead(e(route.name))}${saidHtml(said)}`, 'ot-said-sheet');
      return;
    }
    const w = ev.target.closest('[data-way]');
    if (w) {
      way = Number(w.dataset.way);
      boarding = null;
      return draw();
    }
    const v = ev.target.closest('[data-view]');
    if (v) {
      view = v.dataset.view;
      return draw();
    }
    const cur = ways?.[way];
    if (!cur) return;
    if (ev.target.closest('[data-cancel-ride]')) {
      boarding = null;
      return draw();
    }
    if (ev.target.closest('[data-only]') && boarding) {
      saveRide(cur, boarding, null);
      boarding = null;
      return draw();
    }
    const off = ev.target.closest('[data-off]');
    if (off && boarding) {
      saveRide(cur, boarding, cur.stops.find(x => x.uid === off.dataset.off));
      boarding = null;
      return draw();
    }
    const a = ev.target.closest('[data-add]');
    if (a) {
      const s = cur.stops.find(x => x.uid === a.dataset.add);
      if (!s) return;
      // Pinned already: ☆ again takes it off.
      if (pinnedAt(s.uid)) {
        ctx.data.groups = ctx.data.groups.map(g => ({ ...g, items: g.items.filter(x => !rideAt(s.uid)(x)) }));
        ctx.save();
        ctx.refreshTabs?.();
        ctx.status(W('已取消釘選', 'Unpinned'));
        return draw();
      }
      boarding = s;
      // Straight to where you'd get off.
      draw();
      d.querySelector('.on-here')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });
}

// Which group a stop goes into (or a new one).
export function chooseGroup(raw, done) {
  const item = cleanItem({ ...raw, id: 'i' + uid() });
  const d = sheet(`${sheetHead(W('加入群組', 'Add to group'), `${e(shown(item.route))} · ${e(shown(item.stop))}`)}
    <div class="ot-list">${ctx.data.groups
      .map((g, i) => {
        const has = g.items.some(x => x.stopUID === item.stopUID);
        return `<button class="ot-row-btn" type="button" data-to="${i}" ${has ? 'disabled' : ''}><span><b>${e(shown(g.name))}</b><small>${W(`${g.items.length} 個站牌`, `${g.items.length} stops`)}${has ? W(' · 已在這裡', ' · already here') : ''}</small></span>${icon('plus')}</button>`;
      })
      .join('')}</div>
    ${ctx.data.groups.length < MAX_GROUPS ? `<label class="ot-field"><span>${W('或新的群組', 'Or a new group')}</span><div class="ot-row"><input id="g-new" maxlength="12" placeholder="${W('上班、回家', 'Work, Home')}"><button class="q-btn" type="button" data-new="1">${W('建立並加入', 'Create')}</button></div></label>` : ''}`);
  d.addEventListener('click', ev => {
    const to = ev.target.closest('[data-to]');
    let g = null;
    if (to) g = ctx.data.groups[Number(to.dataset.to)];
    if (ev.target.closest('[data-new]')) {
      const name = d.querySelector('#g-new').value.trim();
      if (!name) return;
      g = { id: 'g' + uid(), name, items: [] };
      ctx.data.groups.push(g);
    }
    if (!g) return;
    if (g.items.length >= MAX_ITEMS) return ctx.status(W(`一個群組最多 ${MAX_ITEMS} 個站牌`, `Up to ${MAX_ITEMS} stops a group`));
    g.items.push(item);
    ctx.save();
    d.shut();
    ctx.refreshTabs?.();
    done?.();
    ctx.status(W(`已加入「${g.name}」`, `Added to ${g.name}`));
  });
}

// ---- Managing the groups: names, order, their stops ------------------------------------------------------

export function manageSheet() {
  const d = sheet('', 'ot-tall-sheet');
  const draw = () => {
    d.innerHTML = `${sheetHead(W('公車站牌', 'Bus stops'))}
      ${ctx.data.groups
        .map(
          (g, i, all) => `<section class="ot-manage">
          <div class="ot-order-row head"><input class="ot-name-in" data-name="${i}" value="${e(g.name)}" maxlength="16" aria-label="${W('群組名稱', 'Group name')}">
            <button class="q-icon-btn" type="button" data-gmove="${i}" data-by="-1" aria-label="${W('上移', 'Move up')}" ${i ? '' : 'disabled'}>${icon('up')}</button>
            <button class="q-icon-btn" type="button" data-gmove="${i}" data-by="1" aria-label="${W('下移', 'Move down')}" ${i < all.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
            <button class="q-icon-btn" type="button" data-gdel="${i}" aria-label="${W('刪除群組', 'Delete group')}" ${all.length > 1 ? '' : 'disabled'}>${icon('trash')}</button></div>
          ${g.items
            .map(
              (it, k, list) => `<div class="ot-order-row"><span><b>${e(shown(it.route))}</b> ${e(shown(it.stop))}${it.off ? ` → ${e(shown(it.off.stop))}` : ''}<small>${W('往', 'to')} ${e(shown(it.headsign))}${it.back ? W(' · 回程自動對調', ' · back flips') : ''}</small></span>
              <button class="q-icon-btn" type="button" data-imove="${i}:${k}" data-by="-1" aria-label="${W('上移', 'Move up')}" ${k ? '' : 'disabled'}>${icon('up')}</button>
              <button class="q-icon-btn" type="button" data-imove="${i}:${k}" data-by="1" aria-label="${W('下移', 'Move down')}" ${k < list.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
              <button class="q-icon-btn" type="button" data-idel="${i}:${k}" aria-label="${W('移除', 'Remove')}">${icon('trash')}</button></div>`
            )
            .join('')}
        </section>`
        )
        .join('')}
      ${ctx.data.groups.length < MAX_GROUPS ? `<button class="q-btn block ot-sheet-go" type="button" data-gadd="1">${icon('plus')} ${W('新增群組', 'New group')}</button>` : ''}`;
  };
  draw();
  d.addEventListener('change', ev => {
    const n = ev.target.closest('[data-name]');
    if (!n) return;
    ctx.data.groups[Number(n.dataset.name)].name = n.value.trim().slice(0, 16) || W('群組', 'Group');
    ctx.save();
    ctx.refreshTabs?.();
  });
  d.addEventListener('click', ev => {
    const by = Number(ev.target.closest('[data-by]')?.dataset.by || 0);
    const gm = ev.target.closest('[data-gmove]');
    const gd = ev.target.closest('[data-gdel]');
    const im = ev.target.closest('[data-imove]');
    const id = ev.target.closest('[data-idel]');
    if (gm) ctx.data.groups = move(ctx.data.groups, Number(gm.dataset.gmove), by);
    else if (gd) ctx.data.groups = ctx.data.groups.filter((_, i) => i !== Number(gd.dataset.gdel));
    else if (im) {
      const [g, k] = im.dataset.imove.split(':').map(Number);
      ctx.data.groups[g].items = move(ctx.data.groups[g].items, k, by);
    } else if (id) {
      const [g, k] = id.dataset.idel.split(':').map(Number);
      ctx.data.groups[g].items = ctx.data.groups[g].items.filter((_, i) => i !== k);
    } else if (ev.target.closest('[data-gadd]')) ctx.data.groups.push({ id: 'g' + uid(), name: W(`群組 ${ctx.data.groups.length + 1}`, `Group ${ctx.data.groups.length + 1}`), items: [] });
    else return;
    ctx.save();
    draw();
    ctx.refreshTabs?.();
  });
}
