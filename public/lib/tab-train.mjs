// 查時刻 → 台鐵・高鐵: from one station to another, changing wherever it's
// faster (the router in rail.mjs): a branch line to the trunk line, 台鐵 to
// 高鐵 and back, the walk between them timed. The start is the nearest
// station (or any, picked by city first); each option shows its trains,
// where to change and how long you wait, the fare, and today's delays.

import { railStations, railNetwork, railSpan, traDelays, legFare } from './raildata.mjs';
import { journeys, findStations } from './rail.mjs';
import { errorText } from './api.mjs';
import { cityShort } from './city.mjs';
import { lineMapHtml, mapCities } from './linemap.mjs';
import { remember, trainKey } from './store.mjs';
import { pinTrain } from './tab-go.mjs';
import { tpassOf, passTrainTrip } from './tpass.mjs';
import { sheet, sheetHead, icon, tagText, trainKind, trainColor, inkOn, stationLabel, fitLegs } from './ui.mjs';
import { COLOR, tile, section, rowCard, emptyNote, noticesHtml } from './look.mjs';
import { loadNotices, onNotices } from './service.mjs';
import { e, hm, minsText, tw, twAt, addDays, meters, distText, readJson, writeJson, shown } from './util.mjs';

import { W } from '#kit/lang.mjs';
import * as kitUI from '#kit/ui.mjs';
const $ = id => document.getElementById(id);
let ctx = null;
let shownNow = '';
// The nearest station filled in (the opening waits for it a moment: never popping in after the loading screen).
export let ready = Promise.resolve();
const state = { from: null, to: null, mode: 'all', date: null, time: null, results: null, open: -1, error: '', delays: new Map(), fares: new Map(), passOnly: false };

export function init(c) {
  ctx = c;
  $('panel-train').addEventListener('click', onClick);
  $('panel-train').addEventListener('change', ev => {
    if (ev.target.id !== 't-time') return;
    $('t-time-text').textContent = ev.target.value || timeText(state.date || tw().date);
    state.time = ev.target.value && ev.target.value !== shownNow ? ev.target.value : null;
    search();
  });
  // A swipe across the page: the day either side (the strip's days).
  kitUI.daySwipe($('panel-train'), dir => {
    const next = kitUI.dayStep(trainDays(), state.date || tw().date, dir);
    return Boolean(next && (pickDay(next), true));
  });
  const last = ctx.data.trains[0];
  if (last) Object.assign(state, { from: last.from, to: last.to });
  render();
  if (!state.from) ready = nearestStart();
}

export function show() {
  if (ctx.trainFrom) {
    state.from = ctx.trainFrom;
    state.results = null;
    ctx.trainFrom = null;
    render();
  }
  // The trains between the stations last asked, at once (no 查詢 to press).
  if (state.from && state.to && !state.results && !ctx.trainQuery) search();
  // 交通's pinned connection: asked again now.
  if (ctx.trainQuery) {
    Object.assign(state, { from: ctx.trainQuery.from, to: ctx.trainQuery.to, time: null, date: null });
    ctx.trainQuery = null;
    search();
  }
}
const pinnedConn = () => state.from && state.to && ctx.data.pins.some(p => p.kind === 'train' && p.from.id === state.from.id && p.to.id === state.to.id && p.from.sys === state.from.sys);

async function nearestStart() {
  const h = await ctx.locate();
  if (!h || state.from) return;
  try {
    const list = await railStations();
    const tra = list.filter(s => s.sys === 'tra').map(s => [meters(h.lat, h.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0])[0];
    if (tra && !state.from) {
      state.from = { sys: 'tra', id: tra[1].id, name: tra[1].name };
      render();
    }
  } catch {}
}

// The day: the family's strip of days pinned at the top (today and the 30
// after, as far as timetables go), 📅 among them; a day picked asks again.
const dayRec = {};
const trainDays = () => kitUI.dayList(tw().date, addDays(tw().date, 30));
function pickDay(d) {
  state.date = d === tw().date ? null : d;
  if (state.from && state.to) return search();
  render();
}
// The search is the page's card, as iOS lists it: 出發 over 抵達, ⇅ beside
// them, the time and which railways under; any change asks at once (no 查詢).
// A station in its railway's colour: 台鐵 blue, 高鐵 orange.
// (Only when the two ends are on different railways: a pair all of one kind needs no tile, DESIGN.md §3.)
const stPick = (which, st) => `<button class="ot-tq-st" type="button" data-pick="${which}"><small>${which === 'from' ? W('出發', 'From') : W('抵達', 'To')}</small>${st ? `${state.from && state.to && state.from.sys !== state.to.sys ? tile(st.sys === 'hsr' ? 'hsr' : 'tra', st.sys === 'hsr' ? COLOR.hsr : COLOR.tra) : ''}<b>${e(stationLabel(st))}</b>` : `<b class="muted">${W('選車站', 'Pick a station')}</b>`}</button>`;
// The time asked from, as the app writes it (24-hour; iPhone's own field said 晚上 7:09 and
// wrapped in the pill): 現在, the time picked, or 首班 on another day. The field itself is
// over it, unseen, so a tap still opens iPhone's wheel.
const timeText = date => state.time || (date === tw().date ? W('現在', 'Now') : W('首班', 'First'));
// 台鐵's and 高鐵's notices today (a typhoon's 停駛), above the trains.
let notices = [];
const loadTrainNotices = () =>
  loadNotices({ kinds: ['tra', 'hsr'] })
    .then(n => {
      notices = n;
      const box = $('t-notices');
      if (box) box.innerHTML = noticesHtml(notices);
    })
    .catch(() => {});
function render() {
  loadTrainNotices();
  const today = tw().date;
  const date = state.date || today;
  const recent = ctx.data.trains.filter(x => trainKey(x) !== (state.from && state.to ? trainKey({ from: state.from, to: state.to }) : '')).slice(0, 4);
  // 全部 / 台鐵 / 高鐵 kept across a redraw (the owner, 2026-10-27: it switched with no slide): a tap
  // redraws the page twice (the search's loading, then its trains), and a control drawn anew lands.
  const seg = $('panel-train').querySelector('.ot-tq-sys');
  $('panel-train').innerHTML = `
    <div class="ot-tq-days"></div>
    <section class="ot-tq">
      <div class="ot-tq-pair">${stPick('from', state.from)}${stPick('to', state.to)}<button class="ot-tq-swap" type="button" data-act="swap" aria-label="${W('對調', 'Swap')}">${icon('swap')}</button></div>
      <div class="ot-tq-when"><label class="ot-tq-pill">${icon('clock')}<b id="t-time-text">${e(timeText(date))}</b><input id="t-time" type="time" value="${state.time || (shownNow = tw().hm)}" aria-label="${W('出發時間', 'Leave at')}"></label><div class="q-seg ot-tq-sys" role="group" aria-label="${W('搭什麼', 'Trains')}">${[['all', W('全部', 'All')], ['tra', W('台鐵', 'TRA')], ['hsr', W('高鐵', 'HSR')]].map(([k, n]) => `<button type="button" data-mode="${k}" aria-pressed="${state.mode === k}">${n}</button>`).join('')}</div></div>
    </section>
    <div id="t-notices">${noticesHtml(notices)}</div>
    <div id="t-results">${resultsHtml()}</div>
    ${recent.length ? section(W('最近', 'Recent'), rowCard(recent.map((x, i) => `<button class="q-ritem chevron" type="button" data-recent="${i}">${tile(x.from.sys === 'hsr' ? 'hsr' : 'tra', x.from.sys === 'hsr' ? COLOR.hsr : COLOR.tra, 'sm')}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(x.from))} → ${e(stationLabel(x.to))}</span></span></button>`).join(''))) : ''}`;
  $('panel-train').querySelector('.ot-tq-days').replaceWith(kitUI.dayBar(dayRec, { days: trainDays(), current: date, today, follow: true, onPick: pickDay }));
  if (seg) {
    $('panel-train').querySelector('.ot-tq-sys').replaceWith(seg);
    for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
  }
  drawn();
}
// After the trains are drawn: their chips on one line, the next train's countdown kept true.
let ticker = 0;
function drawn() {
  fitLegs($('t-results'));
  clearInterval(ticker);
  if ($('t-results')?.querySelector('[data-leave]')) ticker = setInterval(tickLeave, 15_000);
}
function tickLeave() {
  const els = $('t-results')?.querySelectorAll('[data-leave]') || [];
  if (!$('t-results')?.isConnected || !els.length) return clearInterval(ticker);
  for (const el of els) {
    const t = leaveText(Number(el.dataset.leave));
    if (el.textContent !== t) el.textContent = t;
  }
}
const showResults = () => (($('t-results').innerHTML = resultsHtml()), drawn());

function resultsHtml() {
  if (state.error) return `<p class="ot-note bad">${e(state.error)}</p>`;
  if (state.results === 'loading') return `<p class="ot-note">${W('找班次…', 'Finding trains…')}</p>`;
  if (!state.results) return '';
  const pin = `<button type="button" data-act="pin-conn" aria-pressed="${pinnedConn()}">${pinnedConn() ? W('已釘選', 'Pinned') : W('釘選', 'Pin')}</button>`;
  if (!state.results.length) return section(W('班次', 'Trains'), emptyNote(W('這個時間之後沒有班次', 'No trains after this time')), pin);
  // The next train still to leave today: lit, its countdown on it.
  const now = Date.now();
  const next = (state.date || tw().date) === tw().date ? state.results.findIndex(j => leaveAt(j) >= now - 30_000) : -1;
  return section(W('班次', 'Trains'), state.results.map((j, i) => journeyHtml(j, i, i === next)).join(''), pin);
}

// A train's delay now (台鐵's live board; 高鐵 has none): minutes, 0 on time, null not running yet.
const delayOf = t => (t.sys === 'tra' && state.delays.has(t.no) ? state.delays.get(t.no) : null);
// When a journey really leaves: its first train's time, with that train's delay.
const leaveAt = j => {
  const l = j.legs.find(x => !x.walk);
  return j.dep + (delayOf(l.trip) || 0) * 60_000;
};
export function leaveText(at, now = Date.now()) {
  const m = Math.round((at - now) / 60_000);
  if (m <= 0) return W('即將開車', 'Leaving now');
  if (m < 60) return W(`${m} 分後開`, `in ${m} min`);
  return W(`${Math.floor(m / 60)} 小時 ${m % 60} 分後開`, `in ${Math.floor(m / 60)} h ${m % 60} min`);
}
const kindName = t => (t.sys === 'hsr' ? W('高鐵', 'HSR') : trainKind(t.type));
// A train as a chip in its kind's colour: 自強 red, 莒光 amber, 區間快 teal, 區間 sky, 高鐵 orange.
const trainChip = t => {
  const c = trainColor(t);
  return `<span class="ot-leg" style="--c:${c};--ink:${inkOn(c)}">${icon(t.sys)}<b><span class="k">${e(kindName(t))} </span>${e(t.no)}</b></span>`;
};
// The journey as a line through its time: each train a stretch in its colour
// with a dot at each station it calls at, a change a gap, a walk dotted.
function barHtml(j) {
  const span = Math.max(1, j.arr - j.dep);
  const pos = t => `${(((t - j.dep) / span) * 100).toFixed(2)}%`;
  const wid = (a, b) => `${(((b - a) / span) * 100).toFixed(2)}%`;
  const out = [];
  j.legs.forEach(l => {
    if (l.walk) return out.push(`<i class="walk" style="left:${pos(l.dep)};width:${wid(l.dep, l.arr)}"></i>`);
    const c = trainColor(l.trip);
    // (The stations between: where the train stops on the way, at their own times.)
    const dots = l.trip.stops
      .slice(l.fromK + 1, l.toK)
      .map(s => `<em style="left:${(((s.arr - l.dep) / Math.max(1, l.arr - l.dep)) * 100).toFixed(2)}%"></em>`)
      .join('');
    out.push(`<i class="ride" style="left:${pos(l.dep)};width:${wid(l.dep, l.arr)};--c:${c}">${dots}</i>`);
  });
  return `<span class="ot-jbar" aria-hidden="true">${out.join('')}</span>`;
}
function journeyHtml(j, i, next) {
  const rides = j.legs.filter(l => !l.walk);
  const delays = rides.map(l => delayOf(l.trip));
  const late = delays.reduce((a, d) => a + (d || 0), 0);
  // What changes the choice: late or run only if the weather allows (a tag: the exception),
  // on time by the live board (plain green text: a fact, DESIGN.md §6).
  const state_ = late
    ? `<span class="ot-jny-st late">${W(`晚 ${late} 分`, `${late} min late`)}</span>`
    : delays.some(d => d === 0)
      ? `<span class="ot-jny-st ok">${icon('check')}${W('準點', 'On time')}</span>`
      : rides.some(l => l.trip.maybe)
        ? `<span class="ot-jny-st maybe">${W('視天候', 'Weather')}</span>`
        : '';
  // A change: where, between the trains.
  const legs = rides
    .map((l, k) => {
      const at = k ? `<span class="ot-leg-sep">›</span><span class="ot-jny-at">${e(nameOf(l.from))}</span><span class="ot-leg-sep">›</span>` : '';
      return at + trainChip(l.trip);
    })
    .join('');
  const eyebrow = next ? `<span class="ot-jny-next">${W('下一班', 'Next train')} · <b data-leave="${leaveAt(j)}">${e(leaveText(leaveAt(j)))}</b></span>` : '';
  return `<button class="ot-jny${i === state.open ? ' on' : ''}${next ? ' next' : ''}" type="button" data-j="${i}">
    ${eyebrow}
    <span class="ot-jny-top"><b>${e(hm(j.dep))}</b><span class="ot-jny-mid"><small>${e(minsText((j.arr - j.dep) / 1000))}</small>${barHtml(j)}</span><b>${e(hm(j.arr))}</b></span>
    <span class="ot-jny-foot"><span class="ot-jny-legs">${legs}</span>${state_}</span>
    ${i === state.open ? detailHtml(j) : ''}
  </button>`;
}

const fareKey = l => `${l.from}>${l.to}:${l.trip.code}`;
// Your TPASS (我的 → TPASS): a 台鐵 ride inside its cities, not a 太魯閣, 普悠瑪 or EMU3000.
const pass = () => tpassOf(ctx.data.prefs.tpass);
const inPassSt = key => Boolean(pass()?.cities.includes(net?.st.get(key)?.city));
const onPass = l => Boolean(pass()) && passTrainTrip(l.trip) && inPassSt(l.from) && inPassSt(l.to);
// What a journey costs you: the legs your pass doesn't take.
function fareText(rides) {
  const paid = rides.filter(l => !onPass(l));
  if (!paid.length && pass()) return W('TPASS 涵蓋', 'TPASS covers it');
  const f = paid.map(l => state.fares.get(fareKey(l))).reduce((a, b) => (a == null || b == null ? null : a + b), 0);
  return f ? `${W('約 ', '~')}NT$${f}${paid.length < rides.length ? W('（其餘 TPASS）', ' (rest TPASS)') : ''}` : '';
}
let net = null;
const nameOf = key => {
  const s = net?.st.get(key);
  return s ? stationLabel(s) : key;
};
// A journey's steps, as a plan's on the map: the time, the train's colour, what to do.
function detailHtml(j) {
  const out = [];
  j.legs.forEach((l, k) => {
    if (l.walk) {
      out.push(`<li style="--c:${COLOR.walk}"><span class="ot-step-time"></span><span class="ot-step-i">${icon('walk')}</span><span class="ot-step-what">${W('步行到', 'Walk to')} <b>${e(nameOf(l.to))}</b><small>${W(`約 ${l.min} 分`, `~${l.min} min`)}</small></span></li>`);
      return;
    }
    const prev = j.legs.slice(0, k).reverse().find(x => !x.walk);
    if (prev && prev.to === l.from) out.push(`<li class="change" style="--c:${COLOR.walk}"><span class="ot-step-time"></span><span class="ot-step-i">${icon('swap')}</span><span class="ot-step-what">${W(`在 <b>${e(nameOf(l.from))}</b> 換車`, `Change at <b>${e(nameOf(l.from))}</b>`)}<small>${W(`${Math.round((l.dep - prev.arr) / 60_000)} 分`, `${Math.round((l.dep - prev.arr) / 60_000)} min`)}</small></span></li>`);
    const t = l.trip;
    const d = delayOf(t);
    const pinned = ctx.data.pins.some(p => p.kind === 'trainNo' && p.no === t.no && p.sys === t.sys);
    const facts = [W(`${l.stops} 站`, `${l.stops} stops`), minsText((l.arr - l.dep) / 1000), onPass(l) ? 'TPASS' : state.fares.get(fareKey(l)) ? `NT$${state.fares.get(fareKey(l))}` : '', t.bike ? W('可攜車', 'bikes OK') : ''].filter(Boolean).join(' · ');
    out.push(`<li style="--c:${trainColor(t)}"><span class="ot-step-time">${e(hm(l.dep))}</span><span class="ot-step-i">${icon(t.sys)}</span><span class="ot-step-what"><b>${e(trainKind(t.typeFull || t.type))} ${e(t.no)}</b> ${W('往', 'to')} ${e(shown(String(t.headsign || '').replace(/^往/, '')))}${d ? ` <span class="ot-warn">${W(`晚 ${d} 分`, `${d} min late`)}</span>` : d === 0 ? ` <span class="ot-ok">${W('準點', 'On time')}</span>` : ''}<small>${e(nameOf(l.from))} → ${e(nameOf(l.to))} ${e(hm(l.arr))}</small><small>${e(facts)}</small><span class="ot-pin-train${pinned ? ' on' : ''}" role="button" data-pin-train="${e(JSON.stringify({ sys: t.sys, no: t.no, type: t.type, from: l.from, to: l.to, dep: hm(l.dep) }))}">${icon('star')}${pinned ? W('已釘選', 'Pinned') : W('釘選這班', 'Pin train')}</span></span></li>`);
  });
  out.push(`<li class="end" style="--c:${COLOR.walk}"><span class="ot-step-time">${e(hm(j.arr))}</span><span class="ot-step-i">${icon('pin')}</span><span class="ot-step-what"><b>${W('抵達', 'Arrive')} ${e(nameOf(j.legs.at(-1).to))}</b></span></li>`);
  return `<ol class="ot-steps">${out.join('')}</ol>`;
}

async function search() {
  if (!state.from || !state.to) return;
  if (state.from.sys === state.to.sys && state.from.id === state.to.id) {
    state.error = W('起訖站相同', 'Same station both ends');
    return render();
  }
  state.error = '';
  state.results = 'loading';
  state.open = -1;
  render();
  ctx.data.trains = remember(ctx.data.trains, { from: state.from, to: state.to, t: Date.now() }, trainKey, 8);
  ctx.save();
  const today = tw().date;
  const date = state.date || today;
  const now = Date.now();
  const t = state.time ? twAt(date, state.time) : date === today ? now : twAt(date, '05:00');
  try {
    const span = railSpan(t);
    net = await railNetwork(span.date, span);
    const use = state.mode === 'tra' ? x => x.sys === 'tra' : state.mode === 'hsr' ? x => x.sys === 'hsr' : () => true;
    const fromKey = `${state.from.sys}:${state.from.id}`;
    const toKey = `${state.to.sys}:${state.to.id}`;
    // (A station beside the other railway, 六家 and 高鐵新竹, is reached on foot:
    // the walks are in the network.)
    const starts = [{ key: fromKey, at: Math.max(t, now - 60_000) }];
    const ends = [{ key: toKey, extra: 0 }];
    // Both stations inside your TPASS's cities: only the trains it takes (unless there are none).
    state.passOnly = false;
    if (state.mode !== 'hsr' && inPassSt(fromKey) && inPassSt(toKey)) {
      const mine = journeys(net, starts, ends, t, { use: x => passTrainTrip(x) && use(x), n: 6 });
      if (mine.length) {
        state.passOnly = true;
        state.results = mine;
      }
    }
    if (!state.passOnly) state.results = journeys(net, starts, ends, t, { use, n: 6 });
  } catch (err) {
    state.error = errorText(err);
    state.results = null;
  }
  render();
  // Today's delays and the fares, after.
  if (Array.isArray(state.results) && state.results.length) {
    // (Another day: no live board, none of today's delays on its trains.)
    if (date !== today) state.delays = new Map();
    if (date === today) traDelays().then(m => ((state.delays = m), render())).catch(() => {});
    const legs = state.results.flatMap(j => j.legs.filter(l => !l.walk));
    const uniq = [...new Map(legs.map(l => [fareKey(l), l])).values()].slice(0, 12);
    Promise.all(uniq.map(l => legFare(l).then(p => p != null && state.fares.set(fareKey(l), p)).catch(() => {}))).then(() => render());
  }
}

const keyStation = key => {
  const s = net?.st.get(key);
  return s ? { sys: s.sys, id: s.id, name: s.name } : null;
};
function onClick(ev) {
  const pt = ev.target.closest('[data-pin-train]');
  if (pt) {
    const x = JSON.parse(pt.dataset.pinTrain);
    const had = ctx.data.pins.find(p => p.kind === 'trainNo' && p.no === x.no && p.sys === x.sys);
    if (had) {
      ctx.data.pins = ctx.data.pins.filter(p => p !== had);
      ctx.save();
      ctx.status(W(`已取消釘選 ${x.no} 次`, `Unpinned train ${x.no}`));
      showResults();
      return;
    }
    if (pinTrain(ctx, { kind: 'trainNo', sys: x.sys, no: x.no, type: x.type, dep: x.dep, from: keyStation(x.from), to: keyStation(x.to) })) {
      ctx.status(W(`已釘選 ${x.no} 次到「交通」`, `Train ${x.no} pinned to Transit`));
      showResults();
    }
    return;
  }
  const pick = ev.target.closest('[data-pick]');
  if (pick) return pickStation(pick.dataset.pick);
  const mode = ev.target.closest('[data-mode]');
  if (mode) {
    state.mode = mode.dataset.mode;
    render();
    return search();
  }
  const rec = ev.target.closest('[data-recent]');
  if (rec) {
    const x = ctx.data.trains.filter(y => trainKey(y) !== (state.from && state.to ? trainKey({ from: state.from, to: state.to }) : ''))[Number(rec.dataset.recent)];
    if (x) Object.assign(state, { from: x.from, to: x.to });
    return search();
  }
  const j = ev.target.closest('[data-j]');
  if (j) {
    state.open = state.open === Number(j.dataset.j) ? -1 : Number(j.dataset.j);
    return showResults();
  }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'swap') {
    [state.from, state.to] = [state.to, state.from];
    state.results = null;
    render();
    return search();
  }
  if (act === 'pin-conn') {
    if (pinnedConn()) {
      ctx.data.pins = ctx.data.pins.filter(p => !(p.kind === 'train' && p.from.id === state.from.id && p.to.id === state.to.id && p.from.sys === state.from.sys));
      ctx.save();
      ctx.status(W('已取消釘選', 'Unpinned'));
      return showResults();
    }
    if (pinTrain(ctx, { kind: 'train', from: state.from, to: state.to })) ctx.status(W('已釘選到「交通」', 'Pinned to Transit'));
    return showResults();
  }
}

// ---- Picking a station ---------------------------------------------------------------------------------
// Search first (a character or two finds it, either railway); with nothing
// typed: 常用 (both ends of what you've asked) and 附近, a row each, then the
// counties and the county's map of its lines (linemap.mjs). A county tapped
// changes only the map: the rows above stay where they are, and the map
// keeps its height until the sheet closes (nothing jumps under the finger).
// (The owner, 2026-10-23: a county's stations in a grid were too many to
// find one; 2026-10-30: 常用 and 附近 filled the sheet, the county pills
// jumped; then 北中南東 too broad, back to counties.)

const CITY_KEY = 'orbit-transit.st-city';
async function pickStation(which) {
  let city = '';
  let list = [];
  let byKey = new Map();
  const other = state[which === 'from' ? 'to' : 'from'];
  const d = sheet(`${sheetHead(which === 'from' ? W('出發車站', 'From station') : W('抵達車站', 'To station'))}
    <label class="q-search ot-search-in"><input id="s-q" type="search" placeholder="${W('站名', 'Station')}" autocomplete="off"><button class="q-search-clear" type="button" aria-label="${W('清除', 'Clear')}">✕</button></label>
    <div id="s-body"></div>`, 'ot-tall-sheet ot-pick-sheet');
  let picking = false;
  const choose = (s, el) => {
    if (picking) return;
    picking = true;
    el?.classList.add('picked');
    state[which] = { sys: s.sys, id: s.id, name: s.name };
    state.results = null;
    writeJson(CITY_KEY, s.city);
    // (The dot lights, then the sheet goes: a tap that shows it landed.)
    setTimeout(() => {
      d.shut();
      render();
      if (state.from && state.to) search();
    }, el?.classList.contains('ot-lm-row') ? 160 : 0);
  };
  const keyOf = x => (x ? `${x.sys}:${x.id}` : '');
  const isOther = s => s.key === keyOf(other);
  const row = (s, value = '') => `<button class="q-ritem" type="button" data-st="${e(s.key)}">${tile(s.sys, s.sys === 'hsr' ? COLOR.hsr : COLOR.tra, 'sm')}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(s))}</span></span>${value ? `<span class="q-ritem-value">${e(value)}</span>` : ''}</button>`;
  const usual = () => {
    const seen = new Set();
    return ctx.data.trains
      .flatMap(x => [x.from, x.to])
      .map(x => x && byKey.get(keyOf(x)))
      .filter(s => s && !isOther(s) && !seen.has(s.key) && seen.add(s.key))
      .slice(0, 6);
  };
  const near = () => {
    const h = ctx.here;
    return h ? list.filter(s => !isOther(s)).map(s => [meters(h.lat, h.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0]).slice(0, 3) : [];
  };
  const chip = (s, sub = '') => `<button class="q-chip" type="button" data-st="${e(s.key)}">${e(stationLabel(s))}${sub ? `<small>${e(sub)}</small>` : ''}</button>`;
  const quickRow = (label, chips) => (chips.length ? `<div class="q-chips ot-chip-rail ot-pick-quick"><span class="ot-pick-label">${label}</span>${chips.join('')}</div>` : '');
  const drawMap = (fresh = false) => {
    const map = d.querySelector('#s-map');
    if (!map) return;
    // (Never shorter than it was: the sheet doesn't shrink and scroll under the finger.)
    map.style.minHeight = `${map.offsetHeight}px`;
    map.innerHTML = lineMapHtml(city, byKey, { current: keyOf(state[which]), other: keyOf(other) });
    if (fresh) {
      map.classList.remove('fresh');
      void map.offsetWidth;
      map.classList.add('fresh');
    }
  };
  const draw = () => {
    const q = d.querySelector('#s-q').value;
    const body = d.querySelector('#s-body');
    if (q.trim()) {
      const found = findStations(list, q).filter(s => !isOther(s)).slice(0, 12);
      body.innerHTML = found.length ? rowCard(found.map(s => row(s, cityShort(s.city))).join('')) : `<p class="ot-note">${W('沒有符合的車站', 'No matching station')}</p>`;
      return;
    }
    const mine = usual();
    const seen = new Set(mine.map(s => s.key));
    const close = near().filter(([, s]) => !seen.has(s.key));
    body.innerHTML = `${quickRow(W('常用', 'Yours'), mine.map(s => chip(s)))}${quickRow(W('附近', 'Nearby'), close.map(([m, s]) => chip(s, distText(m))))}
      <div class="q-chips ot-chip-rail ot-pick-cities" role="group" aria-label="${W('縣市', 'County')}">${mapCities(list)
        .map(k => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === city}">${e(cityShort(k))}</button>`)
        .join('')}</div>
      <div class="ot-pick-map" id="s-map"></div>`;
    drawMap();
    // (The county in sight in its row, once as the sheet opens.)
    const on = body.querySelector('.ot-pick-cities [aria-pressed="true"]');
    if (on) on.parentElement.scrollLeft = on.offsetLeft - on.parentElement.offsetWidth / 2 + on.offsetWidth / 2;
  };
  const pickCity = k => {
    if (!k || k === city) return;
    city = k;
    writeJson(CITY_KEY, city);
    d.querySelectorAll('.ot-pick-cities [data-city]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.city === city)));
    drawMap(true);
    // (Scrolled down a long county: the new one from its top, just under the counties, which stay put.)
    const rail = d.querySelector('.ot-pick-cities');
    const gap = d.querySelector('#s-map').getBoundingClientRect().top - rail.getBoundingClientRect().bottom;
    if (gap < 0) d.scrollTop += gap;
  };
  d.querySelector('#s-body').innerHTML = `<p class="ot-note">${W('載入車站中…', 'Loading stations…')}</p>`;
  d.querySelector('#s-q').addEventListener('input', draw);
  d.addEventListener('click', ev => {
    const c = ev.target.closest('[data-city]');
    if (c) {
      // (A county's chip, or the station over a county's edge: that county's map.)
      pickCity(c.dataset.city);
      return;
    }
    const st = ev.target.closest('[data-st]');
    if (st) {
      const x = byKey.get(st.dataset.st);
      if (x) choose(x, st);
    }
  });
  try {
    list = await railStations();
    byKey = new Map(list.map(s => [s.key, s]));
    // The county of the station picked now, else of the nearest, else the last one looked at.
    const now = byKey.get(keyOf(state[which])) || near()[0]?.[1];
    const cities = mapCities(list);
    city = [now?.city, readJson(CITY_KEY), ctx.city].find(k => cities.includes(k)) || cities[0];
    draw();
  } catch (err) {
    d.querySelector('#s-body').innerHTML = `<p class="ot-note bad">${e(errorText(err))}</p>`;
  }
}
