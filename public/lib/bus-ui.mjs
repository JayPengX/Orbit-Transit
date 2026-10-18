// Buses, the parts every tab uses: a route's sheet (its stops each way with
// the buses on them, or a stop's timetable), finding a route (your city, its
// neighbours and 公路客運 together, or one city), pinning a stop into a group
// (常用, 上班, 回家…), managing the groups, and the stops around a point with
// every bus due.

import { routeStops, routeEta, routeEtaPath, etaText, etaOf, routeSchedule, stopTimes, stationsNear, etaRank, routeCity, INTERCITY } from './bus.mjs';
import { fitNumbers } from '#kit/quadra.mjs';
import { errorText, tdx, rows, dataAt, liveMs } from './api.mjs';
import { CITY_CODES, cityShort } from './city.mjs';
import { cleanItem, MAX_GROUPS, MAX_ITEMS, move } from './store.mjs';
import { sheet, sheetHead, icon, ago } from './ui.mjs';
import { e, uid, meters, tw, twAt, zh, addDays, hm, dayLabel } from './util.mjs';
import { nextRun, liveTrusted } from './live.mjs';

import { W, en } from './lang.mjs';
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
export function strip({ no, note = '', main = '', eta = null, attrs = '', wait = false }) {
  const when = wait
    ? `<span class="ot-strip-eta"><b>${skel('46px')}</b><small>${skel('28px')}</small></span>`
    : eta
      ? `<span class="ot-strip-eta ${eta.tone}${/\d/.test(eta.main) ? '' : ' words'}${/分|進站|min|Arriving|Due/.test(eta.main) ? ' live' : ''}"><b data-q-live="${e(`eta:${no}:${attrs}`)}">${e(eta.main)}</b>${eta.sub ? `<small>${e(eta.sub)}</small>` : ''}</span>`
      : '';
  const sub = wait ? `<small>${skel('84px')}</small>` : note ? `<small>${note}</small>` : '';
  return `<button class="ot-strip-main" type="button" ${attrs}><span class="ot-strip-no"><span>${e(no)}</span></span><span class="ot-strip-mid"><span class="ot-strip-what"><b>${wait ? skel('128px') : main}</b></span>${sub ? `<span class="ot-strip-note">${sub}</span>` : ''}</span>${when}</button>`;
}
// (The number too: its badge one width, so every strip's words start in one column.)
export const fitStrips = box => fitNumbers([...box.querySelectorAll('.ot-strip-note small, .ot-strip-what b, .ot-strip-no > span')]);

// What a stop's time says: the live time while a bus is on its way, else the
// timetable's next there (`planned`: { at, day }, its day when not today's).
export const busWhen = (v, planned) => (planned && !(v?.status === 0 && v.sec != null) ? { main: hm(planned.at), sub: planned.day ? dayLabel(tw(planned.at).date) : W('預計', 'planned'), tone: 'wait' } : etaText(v));
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
    if (i >= 0 && d < Infinity) near.push({ d, w, i, stop: w.stops[i].name, stopUID: w.stops[i].uid, dir, headsign: w.headsign, v: live.get(w.stops[i].uid) || null });
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
    // The coming week, a day a column: 今天, 明天, then by weekday.
    const days = `<div class="ot-tt-days" role="group" aria-label="${W('哪一天', 'Day')}">${[0, 1, 2, 3, 4, 5, 6].map(i => `<button type="button" data-day="${i}" aria-pressed="${i === day}"><small>${i === 0 ? W('今天', 'Today') : i === 1 ? W('明天', 'Tmrw') : W('週', '')}</small><b>${en ? WEEK_EN[(t0.dow + i) % 7] : WEEK[(t0.dow + i) % 7]}</b></button>`).join('')}</div>`;
    // The stop: a native picker (an iPhone's wheel), its name the label.
    const stopPick = `<label class="ot-tt-stop"><b>${e(s.name)}</b>${icon('down')}<select data-pickstop aria-label="${W('換站牌', 'Change stop')}">${w.stops.map(x => `<option value="${e(x.uid)}"${x.uid === s.uid ? ' selected' : ''}>${e(x.name)}</option>`).join('')}</select></label>`;
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
    const off = w && sched?.length ? offNote(w) : '';
    offDay = off ? planned(w, 0).day : 0;
    const keep = d.scrollTop;
    // Like a stop's sign: the route's number big, where it's going beside it;
    // the way and the view stay at the top while the stops scroll under.
    const where = route.city === INTERCITY ? W('公路客運', 'Intercity') : cityShort(route.city);
    const head = `<div class="q-sheet-head ot-rt-head"><div class="ot-rt-id"><span class="ot-rt-no">${e(route.name)}</span><div><h2>${w ? `${W('往', 'To')} ${e(w.headsign)}` : W('路線', 'Route')}</h2><p class="ot-sheet-sub">${e(where)}${w?.subName && w.subName !== route.name ? ` · ${e(w.subName)}` : ''}</p></div></div><button class="q-close" type="button" data-act="close" aria-label="${W('關閉', 'Close')}">×</button></div>`;
    const tabs = ways && ways.length > 1 ? `<div class="q-seg ot-dir" role="group" aria-label="${W('方向', 'Direction')}">${ways.map((x, i) => `<button type="button" data-way="${i}" aria-pressed="${i === way}">${W('往', 'To')} ${e(x.headsign)}</button>`).join('')}</div>` : '';
    const views = `<div class="q-seg ot-view" role="group" aria-label="${W('即時或時刻表', 'Live or timetable')}"><button type="button" data-view="live" aria-pressed="${view === 'live'}">${W('即時到站', 'Live')}</button><button type="button" data-view="table" aria-pressed="${view === 'table'}">${W('時刻表', 'Timetable')}</button></div>`;
    // Each stop's live time, trusted: a bus 'coming' that the timetable has
    // nowhere near (resting with its tracker on) isn't taken (the
    // timetable's time instead).
    const lives = (w?.stops || []).map((s, k) => {
      const v = live.get(s.uid);
      return v?.status === 0 && v.sec != null && !liveTrusted(sched, w, k, Date.now() + v.sec * 1000) ? null : v;
    });
    const between = k => busBetween(lives, k);
    const stops = !ways
      ? `<p class="ot-note">${W('載入站牌中…', 'Loading stops…')}</p>`
      : !w
        ? `<p class="ot-note">${W('這條路線沒有站牌資料。', 'No stops for this route.')}</p>`
        : view === 'table'
          ? tableHtml(w)
          : `${off ? `<p class="ot-note ot-off-note">${e(off)}</p>` : ''}<ol class="ot-route-stops">${w.stops
            .map(s => {
              const k = w.stops.indexOf(s);
              const v = lives[k];
              let t = etaText(v);
              // No bus on its way to it (尚未發車, 末班已過 the other way…): the timetable's next.
              const p = !v || v.status !== 0 || v.sec == null ? planned(w, k) : null;
              // (Another day's said once above the stops, when it's every stop's.)
              // (Said once above the stops that it's the timetable; another day's only when it's this stop's own.)
              if (p) t = { main: hm(p.at), sub: p.day && p.day !== offDay ? dayName(p.day) : '', tone: 'wait' };
              const mine = s.uid === stopUID;
              const ride = pinnedAt(s.uid);
              // Choosing where to get off: the stops after the one you get on at.
              const at = boarding ? w.stops.findIndex(x => x.uid === boarding.uid) : -1;
              const pick = boarding ? (k > at ? ' can-off' : k === at ? ' on-here' : ' before') : '';
              // A bus at the stop (進站中, 即將進站) rides on its dot.
              return `<li class="${t.tone}${busAt(lives, k) ? ' at' : ''}${mine ? ' mine' : ''}${pick}" data-stop="${e(s.uid)}"${boarding && k > at ? ` data-off="${e(s.uid)}"` : ''}><span class="ot-rs-eta ${t.tone}">${e(t.main)}</span>${between(k) ? `<i class="ot-rs-bus" aria-label="${W('公車在這兩站之間', 'Bus between these stops')}">${icon('bus')}</i>` : ''}<span class="ot-rs-dot">${busAt(lives, k) ? icon('bus') : ''}</span><span class="ot-rs-name"><b>${e(s.name)}</b>${k === at ? `<small>${W('上車', 'Board')}</small>` : ride?.off ? `<small>${icon('star')} ${W('到', 'to')} ${e(ride.off.stop)}</small>` : t.sub ? `<small>${e(t.sub)}</small>` : ''}</span>${boarding ? '' : `<button class="ot-rs-star${ride ? ' on' : ''}" type="button" data-add="${e(s.uid)}" aria-label="${ride ? W('取消釘選', 'Unpin') : W('從這站上車，釘選', 'Board here and pin')}">${icon('star')}</button>`}</li>`;
            })
            .join('')}</ol>`;
    const choose = boarding && view === 'live' ? `<div class="ot-ride-pick"><div><b>${W(`從「${e(boarding.name)}」上車`, `Board at ${e(boarding.name)}`)}</b><small>${W('點你下車的站，回程會自動對調', 'Tap where you get off; the way back flips')}</small></div><button class="q-btn" type="button" data-only="1">${W('只釘這站', 'Just this stop')}</button><button class="q-icon-btn" type="button" data-cancel-ride="1" aria-label="${W('取消', 'Cancel')}">${icon('x')}</button></div>` : '';
    d.querySelector('#rt').innerHTML = `<div class="ot-rt-top">${head}${tabs}${views}${choose}</div>${err && view === 'live' ? `<p class="ot-note bad">${e(err)}</p>` : ''}${stops}${view === 'live' && !boarding ? `<p class="ot-note center">${e(ago(at))}・${W('每 20 秒更新・☆ 釘選你搭的這段', 'every 20 s・☆ pins your ride')}</p>` : ''}`;
    d.scrollTop = keep;
  };
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
    const dy = ev.target.closest('[data-day]');
    if (dy) {
      day = Number(dy.dataset.day);
      dayPicked = true;
      moved = '';
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
  const d = sheet(`${sheetHead(W('加入群組', 'Add to group'), `${e(item.route)} · ${e(item.stop)}`)}
    <div class="ot-list">${ctx.data.groups
      .map((g, i) => {
        const has = g.items.some(x => x.stopUID === item.stopUID);
        return `<button class="ot-row-btn" type="button" data-to="${i}" ${has ? 'disabled' : ''}><span><b>${e(g.name)}</b><small>${W(`${g.items.length} 個站牌`, `${g.items.length} stops`)}${has ? W(' · 已在這裡', ' · already here') : ''}</small></span>${icon('plus')}</button>`;
      })
      .join('')}</div>
    ${ctx.data.groups.length < MAX_GROUPS ? `<label class="ot-field"><span>${W('或新的群組', 'Or a new group')}</span><div class="ot-row"><input id="g-new" maxlength="12" placeholder="${W('例如：上班、回家', 'e.g. Work, Home')}"><button class="q-btn" type="button" data-new="1">${W('建立並加入', 'Create')}</button></div></label>` : ''}`);
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
    d.innerHTML = `${sheetHead(W('管理群組', 'Groups'), W('上下移動調整順序；左右滑動就照這個順序切換', 'Reorder; swipe sideways in this order'))}
      ${ctx.data.groups
        .map(
          (g, i, all) => `<section class="ot-manage">
          <div class="ot-order-row head"><input class="ot-name-in" data-name="${i}" value="${e(g.name)}" maxlength="16" aria-label="${W('群組名稱', 'Group name')}">
            <button class="q-icon-btn" type="button" data-gmove="${i}" data-by="-1" aria-label="${W('上移', 'Move up')}" ${i ? '' : 'disabled'}>${icon('up')}</button>
            <button class="q-icon-btn" type="button" data-gmove="${i}" data-by="1" aria-label="${W('下移', 'Move down')}" ${i < all.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
            <button class="q-icon-btn" type="button" data-gdel="${i}" aria-label="${W('刪除群組', 'Delete group')}" ${all.length > 1 ? '' : 'disabled'}>${icon('trash')}</button></div>
          ${g.items
            .map(
              (it, k, list) => `<div class="ot-order-row"><span><b>${e(it.route)}</b> ${e(it.stop)}${it.off ? ` → ${e(it.off.stop)}` : ''}<small>${W('往', 'to')} ${e(it.headsign)}${it.back ? W(' · 回程自動對調', ' · back flips') : ''}</small></span>
              <button class="q-icon-btn" type="button" data-imove="${i}:${k}" data-by="-1" aria-label="${W('上移', 'Move up')}" ${k ? '' : 'disabled'}>${icon('up')}</button>
              <button class="q-icon-btn" type="button" data-imove="${i}:${k}" data-by="1" aria-label="${W('下移', 'Move down')}" ${k < list.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
              <button class="q-icon-btn" type="button" data-idel="${i}:${k}" aria-label="${W('移除', 'Remove')}">${icon('trash')}</button></div>`
            )
            .join('')}
        </section>`
        )
        .join('')}
      ${ctx.data.groups.length < MAX_GROUPS ? `<button class="q-btn ot-wide" type="button" data-gadd="1">${icon('plus')} ${W('新增群組', 'New group')}</button>` : ''}`;
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
