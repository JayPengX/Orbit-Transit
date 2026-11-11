// 查時刻 → 台鐵・高鐵: from one station to another, changing wherever it's
// faster (the router in rail.mjs): a branch line to the trunk line, 台鐵 to
// 高鐵 and back, the walk between them timed. The start is the nearest
// station (or any, picked by city first); each option shows its trains,
// where to change and how long you wait, the fare, and today's delays.

import { railStations, railNetwork, railSpan, traDelays, legFare, stationPoint } from './raildata.mjs';
import { ticketOf, trainsNumbered } from './ticket.mjs';
import { journeys, findStations } from './rail.mjs';
import { errorText } from './api.mjs';
import { cityShort } from './city.mjs';
import { lineMapHtml, hsrMapHtml, fitStation, mapCities, mapCols, areaOf, areaName } from './linemap.mjs';
import { remember, trainKey } from './store.mjs';
import { pinTrain } from './tab-go.mjs';
import { canBook, bookHtml, openBooking } from './book.mjs';
import { tpassOf, passTrainTrip } from './tpass.mjs';
import { sheet, sheetHead, icon, tagText, trainKind, trainColor, inkOn, stationLabel, fitLegs, journeyLine } from './ui.mjs';
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
const state = { from: null, to: null, mode: 'all', date: null, time: null, results: null, open: -1, error: '', delays: new Map(), live: 0, fares: new Map(), passOnly: false };

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
    asked();
    render();
  }
  // The trains between the stations last asked, at once (no 查詢 to press).
  if (state.from && state.to && !state.results && !ctx.trainQuery) search();
  // 交通's pinned connection: asked again now.
  if (ctx.trainQuery) {
    Object.assign(state, { from: ctx.trainQuery.from, to: ctx.trainQuery.to, time: null, date: null });
    ctx.trainQuery = null;
    asked();
    search();
  }
}
// Stations asked as they are (a recent pair, a pin, a station's 查時刻) on
// the other railway than 台鐵/高鐵 picked: 全部, so they're asked as they were.
function asked() {
  if (state.mode !== 'all' && [state.from, state.to].some(s => s && s.sys !== state.mode)) state.mode = 'all';
}
// 台鐵 or 高鐵 picked with a station of the other picked: its own station
// there (六家 ↔ 高鐵新竹, 臺中 → 高鐵台中); none (花蓮 on 高鐵): left to pick, said.
async function fitMode() {
  if (state.mode === 'all' || ![state.from, state.to].some(s => s && s.sys !== state.mode)) return;
  let list = [];
  try {
    list = await railStations();
  } catch {}
  const lost = [];
  for (const which of ['from', 'to']) {
    const st = state[which];
    if (!st || st.sys === state.mode) continue;
    state[which] = fitStation(st, state.mode, list);
    if (!state[which]) lost.push(stationLabel(st));
  }
  // (Both ends the same station now, 六家 and 新竹 on 高鐵: the far end left to pick.)
  if (state.from && state.to && state.from.sys === state.to.sys && state.from.id === state.to.id) state.to = null;
  if (lost.length) ctx.status(state.mode === 'hsr' ? W(`${lost.join('、')}附近沒有高鐵`, `No HSR near ${lost.join(', ')}`) : W(`${lost.join('、')}沒有台鐵`, `No TRA at ${lost.join(', ')}`));
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
  // 最近: after the trains on a phone; on a wide screen under the question in its
  // column beside them, never a half screen empty under it (Jay's iPad 2026-11-11).
  const recentHtml = recent.length ? section(W('最近', 'Recent'), rowCard(recent.map((x, i) => `<button class="q-ritem chevron" type="button" data-recent="${i}">${tile(x.from.sys === 'hsr' ? 'hsr' : 'tra', x.from.sys === 'hsr' ? COLOR.hsr : COLOR.tra, 'sm')}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(x.from))} → ${e(stationLabel(x.to))}</span></span></button>`).join(''))) : '';
  // 查車次 at the top, a search bar (Jay 2026-11-10: "Move 查車次 to the top like a
  // search bar"; it was a row under the trains): a tap opens its sheet, the keys up.
  $('panel-train').innerHTML = `
    <button class="ob-plan ot-tn-bar q-press" type="button" data-act="train-no">${icon('search')}<span>${W('查車次，例如 107', 'Train number, e.g. 107')}</span></button>
    <div class="ot-tq-days"></div>
    <div class="ot-tq-side">
    <section class="ot-tq">
      <div class="ot-tq-pair">${stPick('from', state.from)}${stPick('to', state.to)}<button class="ot-tq-swap" type="button" data-act="swap" aria-label="${W('對調', 'Swap')}">${icon('swap')}</button></div>
      <div class="ot-tq-when"><label class="ot-tq-pill">${icon('clock')}<b id="t-time-text">${e(timeText(date))}</b><input id="t-time" type="time" value="${state.time || (shownNow = tw().hm)}" aria-label="${W('出發時間', 'Leave at')}"></label><div class="q-seg ot-tq-sys" role="group" aria-label="${W('搭什麼', 'Trains')}">${[['all', W('全部', 'All')], ['tra', W('台鐵', 'TRA')], ['hsr', W('高鐵', 'HSR')]].map(([k, n]) => `<button type="button" data-mode="${k}" aria-pressed="${state.mode === k}">${n}</button>`).join('')}</div></div>
    </section>
    <div id="t-notices">${noticesHtml(notices)}</div>
    ${recentHtml.replace('class="q-section', 'class="q-section ot-tq-recent-side')}
    </div>
    <div id="t-results">${resultsHtml()}</div>
    ${recentHtml}`;
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
  if ($('t-results')?.querySelector('[data-leave]') || (Array.isArray(state.results) && state.live)) ticker = setInterval(tickLeave, 15_000);
}
function tickLeave() {
  const els = $('t-results')?.querySelectorAll('[data-leave]') || [];
  if (!$('t-results')?.isConnected || (!els.length && !state.live)) return clearInterval(ticker);
  for (const el of els) {
    const t = leaveText(Number(el.dataset.leave));
    if (el.textContent !== t) el.textContent = t;
  }
  // 台鐵's board read again a minute on while the trains are in view (a train
  // that was 未發車 leaves; a delay grows), the same read for everyone at the edge.
  const box = $('t-results');
  if (state.live && Date.now() - delaysAt > 60_000 && box.offsetParent && document.visibilityState === 'visible') readDelays();
}
// Today's 台鐵 delays (the two stations' boards), then the cards told in place.
let delaysAt = 0;
function readDelays() {
  delaysAt = Date.now();
  const day = state.date || tw().date;
  // (The boards of the two stations asked: every train through each, its delay now.)
  traDelays([state.from, state.to].filter(s => s?.sys === 'tra').map(s => s.id))
    .then(m => {
      if ((state.date || tw().date) !== day || day !== tw().date) return;
      state.delays = m;
      state.live = 1;
      freshen();
    })
    .catch(() => {});
}
const showResults = () => (($('t-results').innerHTML = resultsHtml()), drawn());
// What came in after the trains were drawn (台鐵's delays, the fares, a pin):
// only what changed, in place. The list is never drawn again under the
// reader: a card drawn anew is a new card, and a page kept still by what it
// says lost it (Jay 2026-11-10: a tap on a train "jumps the UI").
function freshen() {
  const box = $('t-results');
  const cards = box?.querySelectorAll('.ot-jny[data-j]') || [];
  if (!Array.isArray(state.results) || cards.length !== state.results.length) return showResults();
  const now = Date.now();
  const next = (state.date || tw().date) === tw().date ? state.results.findIndex(j => leaveAt(j) >= now - 30_000) : -1;
  const make = html => {
    const t = document.createElement('template');
    t.innerHTML = html;
    return t.content;
  };
  cards.forEach((card, i) => {
    const j = state.results[i];
    // (The next train moved on: that card and the one before, whole.)
    if (card.classList.contains('next') !== (i === next)) {
      const n = make(journeyHtml(j, i, i === next)).firstElementChild;
      if (!n.isEqualNode(card)) card.replaceWith(n);
      return;
    }
    const leave = card.querySelector('[data-leave]');
    if (leave && Number(leave.dataset.leave) !== leaveAt(j)) {
      leave.dataset.leave = leaveAt(j);
      leave.textContent = leaveText(leaveAt(j));
    }
    const st = card.querySelector('.ot-jny-st');
    const st2 = make(statusHtml(j)).firstElementChild;
    if (st && !st.isEqualNode(st2)) st.replaceWith(st2);
    const more = card.querySelector('.ot-jny-more');
    if (more && i === state.open) {
      const m2 = make(detailHtml(j));
      const same = more.childNodes.length === m2.childNodes.length && [...m2.childNodes].every((n, k) => n.isEqualNode(more.childNodes[k]));
      if (!same) more.replaceChildren(m2);
    }
  });
  const pin = box.querySelector('[data-act="pin-conn"]');
  if (pin) {
    pin.setAttribute('aria-pressed', String(pinnedConn()));
    pin.textContent = pinnedConn() ? W('已釘選', 'Pinned') : W('釘選', 'Pin');
  }
  drawn();
}
// A train opened or shut where it is (its own card, nothing else drawn): the
// card tapped stays under the finger, its stops sliding open under it; one
// open above it shuts at once and the page moves by what it gave back, so
// the card tapped doesn't move.
const calm = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const scrollerOf = n => {
  for (let k = n.parentElement; k && k !== document.body; k = k.parentElement) if (k.scrollHeight > k.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(k).overflowY)) return k;
  return document.scrollingElement;
};
function shut(card, slide) {
  card.classList.remove('on');
  card.setAttribute('aria-expanded', 'false');
  const more = card.querySelector('.ot-jny-more');
  if (!more) return;
  const s = scrollerOf(card);
  const h = more.offsetHeight;
  // (Near the page's end the page would get shorter under the finger while it
  // slides: then at once, and the kit keeps the place.)
  if (!slide || calm() || s.scrollTop + s.clientHeight > s.scrollHeight - h - 1) return more.remove();
  more.classList.add('going');
  more.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 220, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' }).onfinish = () => more.remove();
}
function openCard(card, j) {
  card.querySelector('.ot-jny-more')?.remove();
  card.classList.add('on');
  card.setAttribute('aria-expanded', 'true');
  const more = document.createElement('span');
  more.className = 'ot-jny-more';
  more.innerHTML = detailHtml(j);
  card.append(more);
  if (calm()) return;
  more.classList.add('going');
  const run = more.animate([{ height: '0px', opacity: 0 }, { height: `${more.offsetHeight}px`, opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  run.onfinish = run.oncancel = () => more.classList.remove('going');
}
function toggleCard(i) {
  const box = $('t-results');
  const card = box?.querySelector(`.ot-jny[data-j="${i}"]`);
  const j = Array.isArray(state.results) ? state.results[i] : null;
  if (!card || !j) return;
  const was = state.open;
  state.open = was === i ? -1 : i;
  const old = was >= 0 && was !== i ? box.querySelector(`.ot-jny[data-j="${was}"]`) : null;
  if (old) {
    const s = scrollerOf(card);
    const top = card.getBoundingClientRect().top;
    shut(old, false);
    const moved = card.getBoundingClientRect().top - top;
    if (Math.abs(moved) >= 1) s.scrollTop += moved;
  }
  if (state.open === i) openCard(card, j);
  else shut(card, true);
}

function resultsHtml() {
  if (state.error) return `<p class="ot-note bad">${e(state.error)}</p>`;
  if (state.results === 'loading') return `<p class="ot-note">${W('找班次…', 'Finding trains…')}</p>`;
  if (!state.results) return '';
  const pin = `<button type="button" data-act="pin-conn" aria-pressed="${pinnedConn()}">${pinnedConn() ? W('已釘選', 'Pinned') : W('釘選', 'Pin')}</button>`;
  // (Inside the person's TPASS the list keeps to trains the pass covers: said, so
  // a missing 普悠瑪 or 高鐵 isn't a mystery; lost 10-19, back 2026-11-01.)
  // (And every train a tap away: a ticket bought for a 普悠瑪 or 高鐵, Jay 2026-11-03.)
  const passNote = state.passOnly
    ? `<p class="ot-note ot-pass-note">${W('只列 TPASS 能搭的車', 'Only trains your TPASS covers')}<button class="q-chip" type="button" data-act="all-trains">${W('全部班次', 'All trains')}</button></p>`
    : state.allTrains
      ? `<p class="ot-note ot-pass-note">${W('全部班次', 'All trains')}<button class="q-chip" type="button" data-act="pass-trains">${W('只看 TPASS', 'TPASS only')}</button></p>`
      : '';
  if (!state.results.length) return section(W('班次', 'Trains'), passNote + emptyNote(W('這個時間之後沒有班次', 'No trains after this time')), pin);
  // The next train still to leave today: lit, its countdown on it.
  const now = Date.now();
  const next = (state.date || tw().date) === tw().date ? state.results.findIndex(j => leaveAt(j) >= now - 30_000) : -1;
  return section(W('班次', 'Trains'), passNote + state.results.map((j, i) => journeyHtml(j, i, i === next)).join(''), pin);
}

// A train's delay now (台鐵's live board; 高鐵 has none): minutes, 0 on time, null not running yet.
const delayOf = t => (t.sys === 'tra' && state.delays.has(t.no) ? state.delays.get(t.no) : null);
// What a 台鐵 train is now, by the live board (read today): its delay in
// minutes (0 on time), 'wait' when it hasn't left its first station yet (the
// board lists only trains on their way: Jay 2026-11-10, "some show 準點 some
// doesn't"), or null when nobody can say (高鐵 has no live board; another day;
// a train past its start the board doesn't list yet).
export function trainNow(t, delays, live, now = Date.now()) {
  if (!t || t.sys !== 'tra' || !live) return null;
  if (delays.has(t.no)) return delays.get(t.no);
  const start = t.stops?.[0]?.dep;
  return start != null && start > now ? 'wait' : null;
}
const stateOf = t => trainNow(t, state.delays, state.live && (state.date || tw().date) === tw().date);
const notYet = () => `<span class="ot-jny-st wait">${W('未發車', 'Not started')}</span>`;
// A train's state as words beside its name (a ride's step, 查車次).
const nowText = d => (d === 'wait' ? ` <span class="ot-wait">${W('未發車', 'Not started')}</span>` : d ? ` <span class="ot-warn">${W(`晚 ${d} 分`, `${d} min late`)}</span>` : d === 0 ? ` <span class="ot-ok">${W('準點', 'On time')}</span>` : '');
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
// The journey as one line (ui.mjs journeyLine): each train in its colour, a change a ring.
const barHtml = j => journeyLine(j.legs.map(l => (l.walk ? { walk: true, min: l.min } : { min: (l.arr - l.dep) / 60_000, color: trainColor(l.trip) })));
// What changes the choice: late or run only if the weather allows (a tag: the exception),
// on time by the live board (plain green text: a fact, DESIGN.md §6), or not on its
// way yet (quiet grey: every 台鐵 train today says one of these once the board is read).
// (An empty one when nobody can say: kept in its place, so a status read later lands in it.)
function statusHtml(j) {
  const rides = j.legs.filter(l => !l.walk);
  const states = rides.map(l => stateOf(l.trip));
  const late = states.reduce((a, d) => a + (typeof d === 'number' ? d : 0), 0);
  return late
    ? `<span class="ot-jny-st late">${W(`晚 ${late} 分`, `${late} min late`)}</span>`
    : states.some(d => d === 0)
      ? `<span class="ot-jny-st ok" aria-label="${W('準點', 'On time')}">${icon('check')}<span>${W('準點', 'On time')}</span></span>`
      : rides.some(l => l.trip.maybe)
        ? `<span class="ot-jny-st maybe">${W('視天候', 'Weather')}</span>`
        : states[0] === 'wait'
          ? notYet()
          : '<span class="ot-jny-st"></span>';
}
function journeyHtml(j, i, next) {
  const rides = j.legs.filter(l => !l.walk);
  const state_ = statusHtml(j);
  // A change: where, between the trains.
  const legs = rides
    .map((l, k) => {
      const at = k ? `<span class="ot-leg-sep">›</span><span class="ot-jny-at">${e(nameOf(l.from))}</span><span class="ot-leg-sep">›</span>` : '';
      return at + trainChip(l.trip);
    })
    .join('');
  const eyebrow = next ? `<span class="ot-jny-next">${W('下一班', 'Next train')} · <b data-leave="${leaveAt(j)}">${e(leaveText(leaveAt(j)))}</b></span>` : '';
  return `<button class="ot-jny${i === state.open ? ' on' : ''}${next ? ' next' : ''}" type="button" data-j="${i}" aria-expanded="${i === state.open}">
    ${eyebrow}
    <span class="ot-jny-top"><b>${e(hm(j.dep))}</b><span class="ot-jny-mid"><small>${e(minsText((j.arr - j.dep) / 1000))}${state.allTrains && rides.every(onPass) ? ' · TPASS' : ''}</small>${barHtml(j)}</span><b>${e(hm(j.arr))}</b></span>
    <span class="ot-jny-foot${rides.length === 1 ? ' one' : ''}"><span class="ot-jny-legs">${legs}</span>${state_}</span>
    ${i === state.open ? `<span class="ot-jny-more">${detailHtml(j)}</span>` : ''}
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
    const d = stateOf(t);
    const pinned = ctx.data.pins.some(p => p.kind === 'trainNo' && p.no === t.no && p.sys === t.sys);
    const facts = [W(`${l.stops} 站`, `${l.stops} stops`), minsText((l.arr - l.dep) / 1000), onPass(l) ? 'TPASS' : state.fares.get(fareKey(l)) ? `NT$${state.fares.get(fareKey(l))}` : '', t.bike ? W('可攜車', 'bikes OK') : ''].filter(Boolean).join(' · ');
    out.push(`<li style="--c:${trainColor(t)}"><span class="ot-step-time">${e(hm(l.dep))}</span><span class="ot-step-i">${icon(t.sys)}</span><span class="ot-step-what"><b>${e(trainKind(t.typeFull || t.type))} ${e(t.no)}</b> ${W('往', 'to')} ${e(shown(String(t.headsign || '').replace(/^往/, '')))}${nowText(d)}<small>${e(nameOf(l.from))} → ${e(nameOf(l.to))} ${e(hm(l.arr))}</small><small>${e(facts)}</small><span class="ot-pin-train${pinned ? ' on' : ''}" role="button" data-pin-train="${e(JSON.stringify({ sys: t.sys, no: t.no, type: t.type, from: l.from, to: l.to, dep: hm(l.dep) }))}">${icon('star')}${pinned ? W('已釘選', 'Pinned') : W('釘選這班', 'Pin train')}</span>${t.sys === 'hsr' && canBook({ mode: 'hsr', dep: l.dep, train: t }) ? bookHtml({ from: net?.st.get(l.from)?.name || '', to: net?.st.get(l.to)?.name || '', dep: l.dep, train: t }, 'ot-pin-train') : ''}</span></li>`);
  });
  out.push(`<li class="end" style="--c:${COLOR.walk}"><span class="ot-step-time">${e(hm(j.arr))}</span><span class="ot-step-i">${icon('pin')}</span><span class="ot-step-what"><b>${W('抵達', 'Arrive')} ${e(nameOf(j.legs.at(-1).to))}</b></span></li>`);
  // 用這班規劃: the trip from where you are around these trains (the ticket you hold: ticket.mjs), on the map.
  return `<ol class="ot-steps">${out.join('')}</ol><span class="ot-jny-plan" role="button" data-ride-plan="${state.results.indexOf(j)}">${icon('route')} ${W('用這班規劃路線', 'Plan a trip on it')}</span>`;
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
    state.allTrains = false;
    if (state.mode !== 'hsr' && !state.everyTrain && inPassSt(fromKey) && inPassSt(toKey)) {
      const mine = journeys(net, starts, ends, t, { use: x => passTrainTrip(x) && use(x), n: 6 });
      if (mine.length) {
        state.passOnly = true;
        state.results = mine;
      }
    }
    if (!state.passOnly) {
      state.results = journeys(net, starts, ends, t, { use, n: 6 });
      state.allTrains = Boolean(state.everyTrain && state.mode !== 'hsr' && inPassSt(fromKey) && inPassSt(toKey));
    }
  } catch (err) {
    state.error = errorText(err);
    state.results = null;
  }
  render();
  // Today's delays and the fares, after.
  if (Array.isArray(state.results) && state.results.length) {
    // (Another day: no live board, none of today's delays on its trains.)
    if (date !== today) (state.delays = new Map()), (state.live = 0);
    if (date === today) readDelays();
    const legs = state.results.flatMap(j => j.legs.filter(l => !l.walk));
    const uniq = [...new Map(legs.map(l => [fareKey(l), l])).values()].slice(0, 12);
    Promise.all(uniq.map(l => legFare(l).then(p => p != null && state.fares.set(fareKey(l), p)).catch(() => {}))).then(() => freshen());
  }
}

const keyStation = key => {
  const s = net?.st.get(key);
  return s ? { sys: s.sys, id: s.id, name: s.name } : null;
};
function onClick(ev) {
  const rp = ev.target.closest('[data-ride-plan]');
  if (rp) {
    const j = state.results?.[Number(rp.dataset.ridePlan)];
    const rides = j?.legs.filter(l => !l.walk) || [];
    const end = net?.st.get(j?.legs.at(-1).to);
    if (!rides.length || !end) return;
    return ctx.openTrip?.(null, { ...stationPoint(end), name: stationLabel(end) }, { ticket: ticketOf(rides) });
  }
  // 高鐵訂票: 高鐵's own booking, this train filled in (book.mjs).
  const bk = ev.target.closest('[data-book]');
  if (bk) return void openBooking(JSON.parse(bk.dataset.book), m => ctx.status(m));
  const pt = ev.target.closest('[data-pin-train]');
  if (pt) {
    const x = JSON.parse(pt.dataset.pinTrain);
    const had = ctx.data.pins.find(p => p.kind === 'trainNo' && p.no === x.no && p.sys === x.sys);
    if (had) {
      ctx.data.pins = ctx.data.pins.filter(p => p !== had);
      ctx.save();
      ctx.status(W(`已取消釘選 ${x.no} 次`, `Unpinned train ${x.no}`));
      freshen();
      return;
    }
    if (pinTrain(ctx, { kind: 'trainNo', sys: x.sys, no: x.no, type: x.type, dep: x.dep, from: keyStation(x.from), to: keyStation(x.to) })) {
      ctx.status(W(`已釘選 ${x.no} 次到「交通」`, `Train ${x.no} pinned to Transit`));
      freshen();
    }
    return;
  }
  const pick = ev.target.closest('[data-pick]');
  if (pick) return pickStation(pick.dataset.pick);
  const mode = ev.target.closest('[data-mode]');
  if (mode) {
    state.mode = mode.dataset.mode;
    const was = [state.from, state.to];
    return fitMode().then(() => {
      if (state.from !== was[0] || state.to !== was[1]) state.results = null;
      render();
      return search();
    });
  }
  const rec = ev.target.closest('[data-recent]');
  if (rec) {
    const x = ctx.data.trains.filter(y => trainKey(y) !== (state.from && state.to ? trainKey({ from: state.from, to: state.to }) : ''))[Number(rec.dataset.recent)];
    if (x) Object.assign(state, { from: x.from, to: x.to });
    asked();
    return search();
  }
  const j = ev.target.closest('[data-j]');
  if (j) return toggleCard(Number(j.dataset.j));
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'all-trains' || act === 'pass-trains') {
    state.everyTrain = act === 'all-trains';
    return search();
  }
  if (act === 'train-no') return trainNoSheet();
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
      return freshen();
    }
    if (pinTrain(ctx, { kind: 'train', from: state.from, to: state.to })) ctx.status(W('已釘選到「交通」', 'Pinned to Transit'));
    return freshen();
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
// 查車次 (Jay 2026-11-06: "search for specific train using number"): a 台鐵
// or 高鐵 number, the day's trains with it (the day's timetable the page
// already reads: no read of its own), a tap its every stop and time.
function trainNoSheet() {
  const date = state.date || tw().date;
  const d = sheet(`${sheetHead(W('查車次', 'Find a train'), date === tw().date ? '' : timeText(date))}
    <label class="q-search ot-search-in"><input id="tn-q" type="search" inputmode="numeric" enterkeyhint="search" placeholder="${W('車次號碼，例如 107', 'Train number, e.g. 107')}" autocomplete="off"><button class="q-search-clear" type="button" aria-label="${W('清除', 'Clear')}">✕</button></label>
    <div id="tn-list"></div>`, 'ot-tall-sheet ot-ticket-sheet');
  const input = d.querySelector('#tn-q');
  const list = d.querySelector('#tn-list');
  const kind = t => (t.sys === 'hsr' ? W('高鐵', 'HSR') : trainKind(t.typeFull || t.type));
  const stName = (n, key) => {
    const s = n.st.get(key);
    return s ? stationLabel(s) : key;
  };
  let found = [];
  let n = null;
  let seq = 0;
  const draw = async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (!q) return (list.innerHTML = '');
    try {
      n = await railNetwork(date, { next: false, prev: false });
    } catch (err) {
      if (my === seq) list.innerHTML = `<p class="ot-note bad">${e(errorText(err))}</p>`;
      return;
    }
    if (my !== seq) return;
    found = trainsNumbered(n, q);
    list.innerHTML = found.length
      ? rowCard(found.map((t, i) => `<button class="q-ritem chevron" type="button" data-tn="${i}">${tile(t.sys, t.sys === 'hsr' ? COLOR.hsr : COLOR.tra, 'sm')}<span class="q-ritem-text"><span class="q-ritem-title">${e(kind(t))} ${e(t.no)}</span><small>${e(stName(n, t.stops[0].st))} ${e(hm(t.stops[0].dep))} → ${e(stName(n, t.stops.at(-1).st))} ${e(hm(t.stops.at(-1).arr))}</small></span></button>`).join(''))
      : `<p class="ot-note">${W('這天沒有這個車次', 'No train with that number that day')}</p>`;
  };
  // A train's stops: the time it leaves each (arrives at the last), its delay if 台鐵 says one.
  const stops = t => {
    const now = Date.now();
    list.innerHTML = `<p class="ot-note"><b>${e(kind(t))} ${e(t.no)}</b> ${W('往', 'to')} ${e(shown(String(t.headsign || '').replace(/^往/, '')))}${date === tw().date ? nowText(trainNow(t, state.delays, state.live)) : ''}</p>
      <ol class="ot-steps">${t.stops.map((x, k) => `<li style="--c:${trainColor(t)}"${(k === t.stops.length - 1 ? x.arr : x.dep) < now ? ' class="past"' : ''}><span class="ot-step-time">${e(hm(k === t.stops.length - 1 ? x.arr : x.dep))}</span><span class="ot-step-i">${icon(k === t.stops.length - 1 ? 'pin' : t.sys)}</span><span class="ot-step-what"><b>${e(stName(n, x.st))}</b></span></li>`).join('')}</ol>`;
  };
  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 200);
  });
  d.querySelector('.q-search-clear').addEventListener('click', () => {
    input.value = '';
    draw();
    input.focus();
  });
  list.addEventListener('click', ev => {
    const b = ev.target.closest('[data-tn]');
    if (b && found[Number(b.dataset.tn)]) stops(found[Number(b.dataset.tn)]);
  });
  input.focus();
}

async function pickStation(which) {
  let city = '';
  let list = [];
  let byKey = new Map();
  let both = new Map();
  const other = state[which === 'from' ? 'to' : 'from'];
  // 台鐵 or 高鐵 picked: only its stations, everywhere in the sheet; 高鐵's on
  // its own line's map, no counties (Jay 2026-11-10).
  const mode = state.mode;
  const hsrOnly = mode === 'hsr';
  const d = sheet(`${sheetHead(which === 'from' ? W('出發車站', 'From station') : W('抵達車站', 'To station'))}
    <label class="q-search ot-search-in"><input id="s-q" type="search" placeholder="${mode === 'tra' ? W('台鐵站名', 'TRA station') : hsrOnly ? W('高鐵站名', 'HSR station') : W('站名', 'Station')}" autocomplete="off"><button class="q-search-clear" type="button" aria-label="${W('清除', 'Clear')}">✕</button></label>
    <div id="s-body"></div>`, 'ot-tall-sheet ot-pick-sheet');
  let picking = false;
  const choose = (s, el) => {
    if (picking) return;
    picking = true;
    el?.classList.add('picked');
    state[which] = { sys: s.sys, id: s.id, name: s.name };
    state.results = null;
    if (!hsrOnly) writeJson(CITY_KEY, areaOf(s.city));
    // (The dot lights, then the sheet goes: a tap that shows it landed.)
    setTimeout(() => {
      d.shut();
      render();
      if (state.from && state.to) search();
    }, el?.closest('.ot-sn-st') ? 160 : 0);
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
  let cols = 0;
  const colsNow = map => mapCols(map.clientWidth - 16);
  const drawMap = (fresh = false) => {
    const map = d.querySelector('#s-map');
    if (!map) return;
    // (Room for a whole screen under the counties, and no more: a short
    // county ends where it ends, yet a tap never pulls the page from under the finger.)
    // (高鐵's one line: no counties to change, it ends where it ends.)
    const rail = d.querySelector('.ot-pick-cities');
    map.style.minHeight = hsrOnly ? '' : `${Math.max(0, d.clientHeight - (rail?.offsetHeight || 0))}px`;
    cols = colsNow(map);
    const at = { current: keyOf(state[which]), other: keyOf(other), cols };
    map.innerHTML = hsrOnly ? hsrMapHtml(both, at) : lineMapHtml(city, byKey, at);
    if (fresh) {
      map.classList.remove('fresh');
      void map.offsetWidth;
      map.classList.add('fresh');
    }
  };
  // (A phone turned, a window made wider: as many stations a row as fit.)
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const map = d.querySelector('#s-map');
    if (map && cols && colsNow(map) !== cols) drawMap();
  }) : null;
  const closed = d.onclosed;
  d.onclosed = () => {
    ro?.disconnect();
    closed?.();
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
      ${hsrOnly ? '' : `<div class="q-chips ot-chip-rail ot-pick-cities" role="group" aria-label="${W('縣市', 'County')}">${mapCities(list)
        .map(k => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === city}">${e(areaName(k))}</button>`)
        .join('')}</div>`}
      <div class="ot-pick-map${hsrOnly ? ' ot-pick-hsr' : ''}" id="s-map"></div>`;
    drawMap();
    ro?.observe(body.querySelector('#s-map'));
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
    const all = await railStations();
    both = new Map(all.map(s => [s.key, s]));
    list = mode === 'all' ? all : all.filter(s => s.sys === mode);
    byKey = new Map(list.map(s => [s.key, s]));
    // The county of the station picked now, else of the nearest, else the last one looked at.
    const now = byKey.get(keyOf(state[which])) || near()[0]?.[1];
    const cities = mapCities(list);
    city = [now?.city, readJson(CITY_KEY), ctx.city].map(areaOf).find(k => cities.includes(k)) || cities[0];
    draw();
  } catch (err) {
    d.querySelector('#s-body').innerHTML = `<p class="ot-note bad">${e(errorText(err))}</p>`;
  }
}
