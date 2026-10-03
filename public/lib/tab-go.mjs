// 交通: what's coming that you'd actually take, in one place, refreshed
// while it's open.
//
//   常用・釘選行程  your trips (家 → 學校 on weekday mornings, and the way
//                  back by itself): the next few ways to go, from the
//                  planner, with the buses' real times; one tap navigates
//   附近           around you: the buses due at the stops, the nearest
//                  station's next trains, the YouBike stations' bikes
//   釘選的公車・火車  what you pinned: a stop's bus, a connection (六家 → 竹東),
//                  one train
//   釘選地點        around each place: its buses, its bikes, its station,
//                  and how to get there from here
//
// What's recommended is never pinned by itself: ☆ pins it.

import { errorText } from './api.mjs';
import { stopsEta, etaText } from './bus.mjs';
import { nearStops, etaRank, openRoute, chooseGroup, useBusCtx } from './bus-ui.mjs';
import { bikesNear } from './bike.mjs';
import { railStations, traBoard, hsrBoard, railNetwork, traDelays } from './raildata.mjs';
import { journeys } from './rail.mjs';
import { planTrip } from './planner.mjs';
import { pickSig } from './plan.mjs';
import { canNav } from './nav.mjs';
import { cleanPin, MAX_PINS, PLACE_ICONS } from './store.mjs';
import { icon, legChips } from './ui.mjs';
import { e, hm, minsText, distText, meters, tw, twAt, addDays } from './util.mjs';

const $ = id => document.getElementById(id);
let ctx = null;
let timer = 0;
let shown = false;
const S = {
  near: null, // nearStops(here) | { error }
  station: null, // { st, list } nearest 台鐵 / 高鐵 station's next trains
  bikes: null, // nearest YouBike stations
  pinned: new Map(), // stopUID → eta
  trains: new Map(), // pin id → [{ dep, arr, label, delay }]
  trips: new Map(), // key → { at, plans, error, loading }
  places: new Map(), // place id → { stops, bikes, at }
  open: new Set(), // places opened
  more: new Set() // trips showing every plan
};

export function init(c) {
  ctx = c;
  useBusCtx(c);
  $('panel-go').addEventListener('click', onClick);
  (ctx.onRefresh ||= []).push(() => shown && render());
}
export function show() {
  shown = true;
  render();
  refresh(true);
  clearInterval(timer);
  timer = setInterval(() => refresh(false), 30_000);
}
export function hide() {
  shown = false;
  clearInterval(timer);
}

// ---- Which trips matter now ------------------------------------------------------------------------

const NEAR_END_M = 800;
// A saved trip's way now: forward, or back when you're at its far end (or
// it's the time home). → { from (null: here), to, at, by, label } or null.
export function tripNow(t, here, now = Date.now()) {
  const day = tw(now);
  const near = p => here && p && meters(here.lat, here.lon, p.lat, p.lon) <= NEAR_END_M;
  const back = { from: t.to, to: t.from, label: `${t.name || t.to.name} 回程`, time: t.back, rev: true };
  const fwd = { from: t.from, to: t.to, label: t.name || t.to.name, time: t.time, rev: false };
  let way = fwd;
  if (near(t.to) && t.from) way = back;
  else if (!near(t.from) && t.from && t.back && t.days.length) {
    // Neither end: by the clock (after the time out and nearer the time back).
    const mins = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    if (day.min > (t.time ? mins(t.time) + 60 : 12 * 60) && Math.abs(day.min - mins(t.back)) < Math.abs(day.min - (t.time ? mins(t.time) : 0))) way = back;
  }
  // From where you are, when the start is "wherever I am".
  const from = way.from && !near(way.from) ? way.from : null;
  if (!way.to) return null;
  if (!from && near(way.to)) return null;
  let at = null;
  let by = 'depart';
  if (way.time) {
    let when = twAt(day.date, way.time);
    // A time already past today (by more than 20 minutes) is tomorrow's.
    if (when < now - 20 * 60_000) when = twAt(addDays(day.date, 1), way.time);
    if (when > now) {
      at = when;
      by = t.by;
    }
  }
  return { id: `${t.id}:${way.rev ? 'b' : 'f'}`, from, to: way.to, at, by, label: way.label, recurring: t.days.length > 0, today: t.days.includes(day.dow) };
}

// Saved trips in the order they matter: recurring ones today first, then the rest.
function trips(now = Date.now()) {
  return ctx.data.saved
    .map(t => ({ t, w: tripNow(t, ctx.here, now) }))
    .filter(x => x.w)
    .sort((a, b) => (b.w.recurring && b.w.today) - (a.w.recurring && a.w.today));
}

// ---- Loading ------------------------------------------------------------------------------------------

let refreshing = false;
async function refresh(all) {
  if (refreshing) return;
  refreshing = true;
  try {
    const h = ctx.here || (await ctx.locate());
    const jobs = [];
    if (h) {
      jobs.push(nearStops(h, { n: 4 }).then(x => (S.near = x)).catch(err => (S.near = S.near?.length ? S.near : { error: errorText(err) })));
      if (all || !S.station) jobs.push(nearStation(h));
      jobs.push(bikesNear(h.lat, h.lon).then(list => (S.bikes = list.map(s => ({ ...s, d: meters(h.lat, h.lon, s.lat, s.lon) })).filter(s => s.d <= 600).sort((a, b) => a.d - b.d).slice(0, 3))).catch(() => {}));
    } else S.near = { error: '開啟定位，就能看到附近的公車、火車和 YouBike。' };
    const items = ctx.data.groups.flatMap(g => g.items);
    if (items.length) jobs.push(stopsEta(items).then(m => (S.pinned = m)).catch(() => {}));
    jobs.push(trainPins());
    // The two trips that matter most get their plans at once (a planner call each, kept 4 minutes).
    for (const { w } of trips().slice(0, 2)) jobs.push(loadTrip(w));
    for (const id of S.open) jobs.push(loadPlace(id));
    render();
    await Promise.all(jobs);
  } finally {
    refreshing = false;
  }
  render();
}

async function nearStation(h) {
  try {
    const list = await railStations();
    const best = list.map(s => ({ s, d: meters(h.lat, h.lon, s.lat, s.lon) })).filter(x => x.d <= (x.s.sys === 'hsr' ? 3000 : 2000)).sort((a, b) => a.d - b.d)[0];
    if (!best) return (S.station = { none: true });
    const board = best.s.sys === 'hsr' ? await hsrBoard(best.s.id) : (await traBoard(best.s.id)).filter(r => r.sched == null || r.sched + r.delay * 60_000 > Date.now() - 60_000);
    S.station = { st: best.s, d: best.d, list: board.slice(0, 4) };
  } catch (err) {
    S.station = { error: errorText(err) };
  }
}

async function trainPins() {
  const pins = ctx.data.pins;
  if (!pins.length) return;
  try {
    const now = Date.now();
    const net = await railNetwork(tw(now).date, { next: tw(now).min >= 21 * 60 });
    const delays = await traDelays().catch(() => new Map());
    for (const p of pins) {
      const from = `${p.from.sys}:${p.from.id}`;
      const to = `${p.to.sys}:${p.to.id}`;
      if (p.kind === 'train') {
        const js = journeys(net, [{ key: from, at: now }], [{ key: to, extra: 0 }], now, { n: 3 });
        S.trains.set(p.id, js.map(j => {
          const rides = j.legs.filter(l => !l.walk);
          return { dep: j.dep, arr: j.arr, label: rides.map(l => `${l.trip.type} ${l.trip.no}`).join(' › '), delay: rides[0]?.trip.sys === 'tra' ? delays.get(rides[0].trip.no) || 0 : 0 };
        }));
      } else {
        // That train today (or tomorrow, after it's gone): its times at your two stations.
        const runs = net.trips.filter(t => t.sys === p.sys && t.no === p.no);
        const times = runs.map(t => ({ a: t.stops.find(x => x.st === from), b: t.stops.find(x => x.st === to) })).filter(x => x.a && x.b && x.a.dep > now - 60_000);
        const x = times[0];
        S.trains.set(p.id, [{ dep: x ? x.a.dep : null, arr: x ? x.b.arr : null, label: x ? `${p.type || ''} ${p.no} 次`.trim() : `${p.no} 次今天不開或已過`, delay: p.sys === 'tra' ? delays.get(p.no) || 0 : 0 }]);
      }
    }
  } catch {}
}

async function loadTrip(w, { force = false } = {}) {
  const old = S.trips.get(w.id);
  if (!force && old && (old.loading || Date.now() - old.at < 4 * 60_000)) return;
  S.trips.set(w.id, { ...(old || {}), loading: true, at: Date.now() });
  render();
  try {
    const from = w.from || (ctx.here ? { name: '目前位置', lat: ctx.here.lat, lon: ctx.here.lon } : null);
    if (!from) throw Object.assign(new Error('nohere'), { code: 'NO_HERE' });
    const out = await planTrip(ctx.data, from, w.to, { at: w.at, by: w.by });
    S.trips.set(w.id, { at: Date.now(), from, plans: out.plans.slice(0, 12), error: out.plans.length ? '' : out.error ? errorText(out.error) : '找不到大眾運輸方案。' });
  } catch (err) {
    S.trips.set(w.id, { at: Date.now(), plans: old?.plans || [], error: err.code === 'NO_HERE' ? '需要你的位置。' : errorText(err) });
  }
  render();
}

async function loadPlace(id) {
  const p = ctx.data.places.find(x => x.id === id);
  if (!p) return;
  const old = S.places.get(id);
  if (old && Date.now() - old.at < 25_000) return;
  try {
    const [stops, bikes] = await Promise.all([nearStops(p, { n: 2, r: 400 }), bikesNear(p.lat, p.lon).catch(() => [])]);
    S.places.set(id, { at: Date.now(), stops, bikes: bikes.map(s => ({ ...s, d: meters(p.lat, p.lon, s.lat, s.lon) })).filter(s => s.d <= 500).sort((a, b) => a.d - b.d).slice(0, 2) });
  } catch (err) {
    S.places.set(id, { at: Date.now(), error: errorText(err), stops: old?.stops || [], bikes: old?.bikes || [] });
  }
}

// ---- Drawing ------------------------------------------------------------------------------------------

const leave = t => {
  const m = Math.round((t - Date.now()) / 60_000);
  return m <= 0 ? '現在' : m < 60 ? `${m} 分後` : hm(t);
};
const busRow = (x, { pin = true, stopName = '' } = {}) => {
  const t = etaText(x.v);
  const pinned = ctx.data.groups.some(g => g.items.some(i => i.stopUID === x.stopUID));
  return `<div class="ot-go-row"><button class="ot-go-main" type="button" data-route="${e(JSON.stringify({ uid: x.uid, name: x.route, city: x.city, stopUID: x.stopUID, dir: x.dir }))}"><span class="ot-route-no">${e(x.route)}</span><span class="ot-go-what"><b>${e(stopName || x.stop || '')}</b><small>${x.dir ? '返程' : '去程'}</small></span><span class="ot-eta ${t.tone}"><b>${e(t.main)}</b><small>${e(t.sub)}</small></span></button>${pin ? `<button class="q-icon-btn${pinned ? ' on' : ''}" type="button" data-pinbus="${e(JSON.stringify({ city: x.city, routeUID: x.uid, route: x.route, dir: x.dir, stopUID: x.stopUID, stop: x.stop, lat: x.lat, lon: x.lon }))}" aria-label="釘選" ${pinned ? 'disabled' : ''}>${icon('star')}</button>` : ''}</div>`;
};

// A trip's plans to show: the ways you pinned first (their next two
// departures), then the recommendations, up to four; the rest behind 更多.
export function tripPlans(plans, picks = [], now = Date.now()) {
  const live = plans.filter(p => p.dep >= now - 2 * 60_000);
  const pinned = [];
  for (const k of picks) pinned.push(...live.filter(p => pickSig(p) === k).sort((a, b) => a.dep - b.dep).slice(0, 2));
  const first = [...pinned, ...live.filter(p => p.top && !pinned.includes(p))].slice(0, Math.max(4, pinned.length));
  return { first, rest: live.filter(p => !first.includes(p)) };
}

function tripCard({ t, w }) {
  const st = S.trips.get(w.id);
  const head = `<header class="ot-go-head"><span class="ot-go-title">${icon(w.recurring ? 'clock' : 'route')}<b>${e(w.label)}</b></span><small>${e(w.from ? w.from.name : '目前位置')} → ${e(w.to.name)}${w.at ? ` · ${w.by === 'arrive' ? '抵達' : '出發'} ${hm(w.at)}` : ''}</small><button class="q-icon-btn" type="button" data-edit-trip="${e(t.id)}" aria-label="編輯">${icon('edit')}</button></header>`;
  if (!st) return `<section class="ot-go-card">${head}<button class="q-btn ot-wide" type="button" data-load-trip="${e(t.id)}">看接下來的班次</button></section>`;
  const all = st.plans || [];
  const { first, rest } = tripPlans(all, t.picks);
  const row = p => {
    const i = all.indexOf(p);
    const pin = t.picks.includes(pickSig(p));
    return `<div class="ot-go-plan-row"><button class="ot-go-plan" type="button" data-nav-trip="${e(w.id)}" data-i="${i}">
      <span class="ot-go-leave"><b>${e(leave(p.dep))}</b><small>${p.dep - Date.now() < 60 * 60_000 ? `${e(hm(p.dep))} 出發` : '建議出發'}</small></span>
      <span class="ot-go-legs"><span class="ot-legs">${legChips(p.legs)}</span><small>${p.live ? '預計 ' : ''}${e(hm(p.arr))} 抵達 · ${e(minsText(p.dur))}${p.transfers ? ` · 轉乘 ${p.transfers}` : ''}${p.fareText ? ` · ${e(p.fareText)}` : ''}${p.live ? ' · <i class="ot-livedot"></i>即時' : ''}</small>${p.miss || p.off ? `<small class="warn">${e(p.off || p.miss)}</small>` : ''}</span>
      ${icon(canNav(p) ? 'route' : 'chevron')}</button><button class="q-icon-btn${pin ? ' on' : ''}" type="button" data-pick-trip="${e(w.id)}" data-i="${i}" aria-label="${pin ? '取消釘選這個方案' : '釘選這個方案'}">${icon('star')}</button></div>`;
  };
  const more = S.more.has(w.id);
  const plans = first.map(row).join('') + (rest.length ? (more ? rest.map(row).join('') : '') + `<button class="ot-go-link" type="button" data-more-trip="${e(w.id)}">${more ? '收起' : `更多方案（${rest.length}）`}</button>` : '');
  const hint = all.length && !t.picks.length ? '<p class="ot-note ot-go-tip">按 ☆ 釘選你常搭的方案，它的下一班會排在最前面。</p>' : '';
  return `<section class="ot-go-card">${head}${plans}${hint}${st.loading && !all.length ? '<p class="ot-note">找班次…</p>' : ''}${st.error && !all.length ? `<p class="ot-note">${e(st.error)}</p>` : ''}<button class="ot-go-link" type="button" data-all-trip="${e(w.id)}">在地圖上看所有方案 ${icon('chevron')}</button></section>`;
}

function nearHtml() {
  const out = [];
  if (S.near?.error) out.push(`<p class="ot-note">${e(S.near.error)}</p>`);
  else if (!S.near) out.push('<p class="ot-note">找附近的公車…</p>');
  else if (!S.near.length) out.push('<p class="ot-note">附近 350 公尺內沒有公車站牌。</p>');
  else {
    // Every bus due around you, soonest first, its stop beside it.
    const all = S.near.flatMap(st => st.rows.map(r => ({ ...r, lat: st.lat, lon: st.lon, sd: st.dist }))).sort((a, b) => etaRank(a.v) - etaRank(b.v));
    // Buses done for the day are one line, not a list.
    const done = x => x.v && (x.v.status === 3 || x.v.status === 4);
    const running = all.filter(x => !done(x));
    out.push(running.slice(0, 8).map(x => busRow(x)).join(''));
    const off = new Set(all.filter(done).map(x => x.route));
    if (off.size) out.push(`<p class="ot-note">${running.length ? '另有 ' : '附近的公車'}${e([...off].slice(0, 6).join('、'))}${off.size > 6 ? ' 等' : ''}今天已收班。</p>`);
  }
  if (S.station?.st) {
    const s = S.station.st;
    out.push(`<h4 class="ot-go-sub">${icon(s.sys)} ${e(s.sys === 'hsr' ? `高鐵${s.name}站` : `${s.name}車站`)}<small>${e(distText(S.station.d))}</small></h4>`);
    out.push(
      S.station.list
        .map(r => `<div class="ot-go-row train"><span class="ot-time">${e(hm(r.sched ?? r.dep))}</span><span class="ot-go-what"><b>${e(s.sys === 'hsr' ? `${r.no} 次` : `${r.type} ${r.no}`)}</b><small>往 ${e(r.dest)}${r.platform ? ` · ${e(r.platform)} 月台` : ''}</small></span><span class="ot-delay ${r.status === 2 ? 'bad' : r.delay ? 'warn' : 'ok'}">${r.status === 2 ? '取消' : r.delay ? `晚 ${r.delay} 分` : leave(r.sched ?? r.dep)}</span></div>`)
        .join('') || '<p class="ot-note">接下來沒有車。</p>'
    );
  }
  if (S.bikes?.length) out.push(`<div class="ot-go-bikes">${S.bikes.map(b => `<button class="ot-go-bike" type="button" data-bike="${e(b.uid)}"><span>${icon('bike')}<b>${e(b.name)}</b></span><small>${b.ok === false ? '暫停' : `一般 ${b.bikes}・⚡${b.ebike}・空位 ${b.ret}`} · ${e(distText(b.d))}</small></button>`).join('')}</div>`);
  return out.join('');
}

function pinnedHtml() {
  const items = ctx.data.groups.flatMap(g => g.items.map(it => ({ it, g })));
  const trains = ctx.data.pins;
  if (!items.length && !trains.length) return '';
  const buses = items
    .map(({ it, g }) => ({ it, g, v: S.pinned.get(it.stopUID) }))
    .sort((a, b) => etaRank(a.v) - etaRank(b.v))
    .map(({ it, g, v }) => {
      const t = etaText(v);
      return `<div class="ot-go-row"><button class="ot-go-main" type="button" data-route="${e(JSON.stringify({ uid: it.routeUID, name: it.route, city: it.city, stopUID: it.stopUID, dir: it.dir }))}"><span class="ot-route-no">${e(it.route)}</span><span class="ot-go-what"><b>${e(it.stop)}</b><small>往 ${e(it.headsign || '—')} · ${e(g.name)}</small></span><span class="ot-eta ${t.tone}"><b>${e(t.main)}</b><small>${e(t.sub)}</small></span></button></div>`;
    })
    .join('');
  const name = s => (s.sys === 'hsr' ? `高鐵${s.name}` : s.name);
  const tr = trains
    .map(p => {
      const list = S.trains.get(p.id) || [];
      const rowsHtml = list
        .filter(x => x.dep == null || x.dep > Date.now() - 60_000 || p.kind === 'trainNo')
        .map(x => `<span class="ot-go-tr"><b>${e(hm(x.dep))}</b>${x.arr ? `→${e(hm(x.arr))}` : ''} <small>${e(x.label)}</small>${x.delay ? `<i class="warn">晚 ${x.delay} 分</i>` : ''}</span>`)
        .join('');
      return `<div class="ot-go-row train"><span class="ot-go-what"><b>${e(name(p.from))} → ${e(name(p.to))}</b><small>${p.kind === 'trainNo' ? '釘選的車次' : '接下來的車'}</small><span class="ot-go-trs">${rowsHtml || '<small>載入中…</small>'}</span></span><button class="q-icon-btn" type="button" data-times="${e(p.id)}" aria-label="查時刻">${icon('chevron')}</button></div>`;
    })
    .join('');
  return `<h3 class="ot-go-h">釘選的公車・火車</h3><section class="ot-go-card">${buses}${tr}</section>`;
}

function placesHtml() {
  const here = ctx.here;
  const list = ctx.data.places.filter(p => !here || meters(here.lat, here.lon, p.lat, p.lon) > 300);
  if (!list.length) return '';
  return `<h3 class="ot-go-h">釘選地點</h3>${list
    .map(p => {
      const open = S.open.has(p.id);
      const d = S.places.get(p.id);
      const body = !open
        ? ''
        : !d
          ? '<p class="ot-note">載入…</p>'
          : `${d.error ? `<p class="ot-note">${e(d.error)}</p>` : ''}${d.stops
              .flatMap(st => st.rows.slice(0, 3).map(r => ({ ...r, lat: st.lat, lon: st.lon })))
              .sort((a, b) => etaRank(a.v) - etaRank(b.v))
              .slice(0, 5)
              .map(x => busRow(x))
              .join('')}${d.bikes.length ? `<div class="ot-go-bikes">${d.bikes.map(b => `<span class="ot-go-bike">${icon('bike')}<b>${e(b.name)}</b><small>一般 ${b.bikes}・⚡${b.ebike}・空位 ${b.ret}</small></span>`).join('')}</div>` : ''}`;
      return `<section class="ot-go-card"><header class="ot-go-head"><button class="ot-go-title" type="button" data-place="${e(p.id)}">${PLACE_ICONS[p.icon] || '📍'} <b>${e(p.name)}</b>${here ? `<small>${e(distText(meters(here.lat, here.lon, p.lat, p.lon)))}</small>` : ''}</button><button class="q-btn" type="button" data-go-place="${e(p.id)}">${icon('route')} 怎麼去</button></header>${body}</section>`;
    })
    .join('')}`;
}

function render() {
  if (!shown) return;
  const ts = trips();
  const box = $('panel-go');
  const keep = box.scrollTop;
  box.innerHTML = `<div class="ot-wrap ot-go">
    ${ts.length ? `<h3 class="ot-go-h">${ts.some(x => x.w.recurring && x.w.today) ? '常用行程' : '釘選行程'}</h3>${ts.map(tripCard).join('')}` : `<section class="ot-go-card ot-go-hint"><b>釘選常去的行程</b><p>在地圖上查路線，按 ☆ 釘選（例如 家 → 學校，平日早上）。這裡會列出接下來最好的幾班，回程也會自動出現。</p><button class="q-btn" type="button" data-go-me="trip">${icon('plus')} 新增行程</button></section>`}
    <h3 class="ot-go-h">附近</h3><section class="ot-go-card">${nearHtml()}</section>
    ${pinnedHtml()}
    ${placesHtml()}
  </div>`;
  box.scrollTop = keep;
}

// ---- Taps ---------------------------------------------------------------------------------------------

function onClick(ev) {
  const r = ev.target.closest('[data-route]');
  if (r) {
    const x = JSON.parse(r.dataset.route);
    return openRoute(ctx, { uid: x.uid, name: x.name, city: x.city }, { stopUID: x.stopUID, dir: x.dir });
  }
  const pb = ev.target.closest('[data-pinbus]');
  if (pb) return chooseGroup(JSON.parse(pb.dataset.pinbus), render);
  const nav = ev.target.closest('[data-nav-trip]');
  if (nav) {
    const st = S.trips.get(nav.dataset.navTrip);
    const p = st?.plans?.[Number(nav.dataset.i)];
    if (p) return ctx.navPlan(p, st.from, p.legs.at(-1).to);
  }
  const pk = ev.target.closest('[data-pick-trip]');
  if (pk) {
    const x = trips().find(y => y.w.id === pk.dataset.pickTrip);
    const p = S.trips.get(pk.dataset.pickTrip)?.plans?.[Number(pk.dataset.i)];
    if (x && p) {
      const k = pickSig(p);
      const on = x.t.picks.includes(k);
      ctx.data.saved = ctx.data.saved.map(y => (y.id === x.t.id ? { ...y, picks: on ? y.picks.filter(z => z !== k) : [k, ...y.picks].slice(0, 6) } : y));
      ctx.save();
      ctx.status(on ? '已取消釘選這個方案' : '已釘選：這個方案的下一班會排在最前面');
      return render();
    }
  }
  const mo = ev.target.closest('[data-more-trip]');
  if (mo) {
    const id = mo.dataset.moreTrip;
    S.more.has(id) ? S.more.delete(id) : S.more.add(id);
    return render();
  }
  const all = ev.target.closest('[data-all-trip]');
  if (all) {
    const w = trips().find(x => x.w.id === all.dataset.allTrip)?.w;
    if (w) return ctx.openTrip(w.from, w.to, { at: w.at, by: w.by });
  }
  const lt = ev.target.closest('[data-load-trip]');
  if (lt) {
    const w = trips().find(x => x.t.id === lt.dataset.loadTrip)?.w;
    if (w) return loadTrip(w, { force: true });
  }
  const ed = ev.target.closest('[data-edit-trip]');
  if (ed) return ctx.editTrip?.(ed.dataset.editTrip);
  const pl = ev.target.closest('[data-place]');
  if (pl) {
    const id = pl.dataset.place;
    S.open.has(id) ? S.open.delete(id) : S.open.add(id);
    render();
    return loadPlace(id).then(render);
  }
  const gp = ev.target.closest('[data-go-place]');
  if (gp) {
    const p = ctx.data.places.find(x => x.id === gp.dataset.goPlace);
    if (p) return ctx.openTrip(null, { name: p.name, lat: p.lat, lon: p.lon });
  }
  const bk = ev.target.closest('[data-bike]');
  if (bk) {
    const b = S.bikes?.find(x => x.uid === bk.dataset.bike);
    if (b) return ctx.openTrip(null, { name: `YouBike ${b.name}`, lat: b.lat, lon: b.lon }, { walk: true });
  }
  const tm = ev.target.closest('[data-times]');
  if (tm) {
    const p = ctx.data.pins.find(x => x.id === tm.dataset.times);
    if (p) {
      ctx.trainQuery = { from: p.from, to: p.to };
      return ctx.goTab('times');
    }
  }
  if (ev.target.closest('[data-go-me]')) return ctx.goTab('me');
}

// Pinning a train (查時刻 calls it): a connection, or one train.
export function pinTrain(c, pin) {
  const clean = cleanPin(pin);
  if (!clean) return false;
  const same = x => x.kind === clean.kind && x.from.id === clean.from.id && x.to.id === clean.to.id && (x.kind !== 'trainNo' || x.no === clean.no);
  if (c.data.pins.some(same)) return true;
  if (c.data.pins.length >= MAX_PINS) {
    c.status(`最多 ${MAX_PINS} 個釘選`);
    return false;
  }
  c.data.pins = [...c.data.pins, clean];
  c.save();
  return true;
}
