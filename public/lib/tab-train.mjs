// 查時刻 → 台鐵・高鐵: from one station to another, changing wherever it's
// faster (the router in rail.mjs): a branch line to the trunk line, 台鐵 to
// 高鐵 and back, the walk between them timed. The start is the nearest
// station (or any, picked by city first); each option shows its trains,
// where to change and how long you wait, the fare, and today's delays.

import { railStations, railNetwork, railSpan, traDelays, legFare } from './raildata.mjs';
import { journeys, tags } from './rail.mjs';
import { errorText } from './api.mjs';
import { CITIES, cityShort } from './city.mjs';
import { remember, trainKey } from './store.mjs';
import { pinTrain } from './tab-go.mjs';
import { tpassOf, passTrainTrip } from './tpass.mjs';
import { sheet, sheetHead, icon, tagText, trainKind, stationLabel } from './ui.mjs';
import { COLOR, tile, tag, section, rowCard, emptyNote } from './look.mjs';
import { e, hm, minsText, tw, twAt, addDays, meters, distText, stationKey } from './util.mjs';

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
    if (ev.target.id === 't-time') state.time = ev.target.value && ev.target.value !== shownNow ? ev.target.value : null;
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
  if (state.from && state.to && state.results) return search();
  render();
}
// The search is the page's card: the two stations, turned round with ⇄,
// the time, and 查詢 (the day on the strip above it).
const stPick = (which, st) => `<button class="ot-tq-st" type="button" data-pick="${which}"><small>${which === 'from' ? W('出發', 'From') : W('抵達', 'To')}</small>${st ? `<b>${e(stationLabel(st))}</b>` : `<b class="muted">${W('選車站', 'Pick')}</b>`}</button>`;
function render() {
  const today = tw().date;
  const date = state.date || today;
  const recent = ctx.data.trains.filter(x => trainKey(x) !== (state.from && state.to ? trainKey({ from: state.from, to: state.to }) : '')).slice(0, 4);
  $('panel-train').innerHTML = `
    <div class="ot-tq-days"></div>
    <section class="q-hero-card ot-tq" style="--q-hc-b:#0ea5e9;--q-hc-a:color-mix(in srgb, #0ea5e9 55%, #0b1020)">
      <span class="q-hc-eyebrow">${icon('tra')}<span>${W('台鐵・高鐵', 'TRA・HSR')}</span></span>
      <div class="ot-tq-pair">${stPick('from', state.from)}<button class="ot-tq-swap" type="button" data-act="swap" aria-label="${W('對調', 'Swap')}">${icon('swap')}</button>${stPick('to', state.to)}</div>
      <div class="ot-tq-when"><label class="ot-tq-pill">${icon('clock')}<input id="t-time" type="time" value="${state.time || (shownNow = tw().hm)}" aria-label="${W('出發時間', 'Leave at')}"></label></div>
      <button class="q-hc-btn ot-tq-go" type="button" data-act="go" ${state.from && state.to ? '' : 'disabled'}>${icon('search')} ${W('查詢', 'Search')}</button>
    </section>
    <div class="q-chips ot-chip-rail" role="group" aria-label="${W('搭什麼', 'Trains')}">
      ${[['all', W('台鐵＋高鐵', 'TRA + HSR')], ['tra', W('台鐵', 'TRA')], ['hsr', W('高鐵', 'HSR')]].map(([k, n]) => `<button class="q-chip" type="button" data-mode="${k}" aria-pressed="${state.mode === k}">${n}</button>`).join('')}
    </div>
    <div id="t-results">${resultsHtml()}</div>
    ${recent.length ? section(W('最近', 'Recent'), rowCard(recent.map((x, i) => `<button class="q-ritem chevron" type="button" data-recent="${i}">${tile(x.from.sys === 'hsr' ? 'hsr' : 'tra', x.from.sys === 'hsr' ? COLOR.hsr : COLOR.tra, 'sm')}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(x.from))} → ${e(stationLabel(x.to))}</span></span></button>`).join(''))) : ''}`;
  $('panel-train').querySelector('.ot-tq-days').replaceWith(kitUI.dayBar(dayRec, { days: trainDays(), current: date, today, follow: true, onPick: pickDay }));
}

function resultsHtml() {
  if (state.error) return `<p class="ot-note bad">${e(state.error)}</p>`;
  if (state.results === 'loading') return `<p class="ot-note">${W('找班次…', 'Finding trains…')}</p>`;
  if (!state.results) return '';
  const pin = `<button type="button" data-act="pin-conn" aria-pressed="${pinnedConn()}">${pinnedConn() ? W('已釘選', 'Pinned') : W('釘選', 'Pin')}</button>`;
  if (!state.results.length) return section(W('班次', 'Trains'), emptyNote(W('這個時間之後沒有班次', 'No trains after this time')), pin);
  const labels = tags(state.results);
  const passTag = state.passOnly ? `<span class="q-tags ot-pass">${tag(W(`${pass().name} 範圍內`, `Inside ${pass().name}`), 'green')}</span>` : '';
  return section(
    W('班次', 'Trains'),
    passTag +
      state.results
        .map((j, i) => {
          const rides = j.legs.filter(l => !l.walk);
          const delay = rides.reduce((a, l) => a + (l.trip.sys === 'tra' ? state.delays.get(l.trip.no) || 0 : 0), 0);
          const t = [j.transfers ? tag(W(`轉乘 ${j.transfers}`, `${j.transfers} change${j.transfers > 1 ? 's' : ''}`)) : tag(tagText('直達'), 'green'), delay ? tag(W(`晚 ${delay} 分`, `${delay} min late`), 'red') : '', fareText(rides) ? tag(fareText(rides)) : '', ...(labels.get(j) || []).slice(0, 1).map(x => tag(tagText(x), 'blue'))].join('');
          return `<button class="ot-jny${i === state.open ? ' on' : ''}" type="button" data-j="${i}">
        <span class="ot-jny-top"><b>${e(hm(j.dep))}</b><i></i><b>${e(hm(j.arr))}</b><span class="ot-jny-dur">${e(minsText((j.arr - j.dep) / 1000))}</span></span>
        <span class="ot-jny-legs">${rides.map(l => `<span class="ot-train-chip ${l.trip.sys}${l.trip.code === '6' || l.trip.code === '10' ? ' local' : ''}">${e(trainKind(l.trip.type))} ${e(l.trip.no)}</span>`).join('<span class="ot-leg-sep">›</span>')}</span>
        <span class="q-tags">${t}</span>
        ${i === state.open ? detailHtml(j) : ''}
      </button>`;
        })
        .join(''),
    pin
  );
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
    const d = t.sys === 'tra' ? state.delays.get(t.no) : 0;
    const pinned = ctx.data.pins.some(p => p.kind === 'trainNo' && p.no === t.no && p.sys === t.sys);
    const facts = [W(`${l.stops} 站`, `${l.stops} stops`), minsText((l.arr - l.dep) / 1000), onPass(l) ? 'TPASS' : state.fares.get(fareKey(l)) ? `NT$${state.fares.get(fareKey(l))}` : '', t.bike ? W('可攜車', 'bikes OK') : ''].filter(Boolean).join(' · ');
    out.push(`<li style="--c:${t.sys === 'hsr' ? COLOR.hsr : COLOR.tra}"><span class="ot-step-time">${e(hm(l.dep))}</span><span class="ot-step-i">${icon(t.sys)}</span><span class="ot-step-what"><b>${e(trainKind(t.typeFull || t.type))} ${e(t.no)}</b> ${W('往', 'to')} ${e(t.headsign)}${d ? ` <span class="ot-warn">${W(`晚 ${d} 分`, `${d} min late`)}</span>` : ''}<small>${e(nameOf(l.from))} → ${e(nameOf(l.to))} ${e(hm(l.arr))}</small><small>${e(facts)}</small><span class="ot-pin-train${pinned ? ' on' : ''}" role="button" data-pin-train="${e(JSON.stringify({ sys: t.sys, no: t.no, type: t.type, from: l.from, to: l.to, dep: hm(l.dep) }))}">${icon('star')}${pinned ? W('已釘選', 'Pinned') : W('釘選這班', 'Pin train')}</span></span></li>`);
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
      $('t-results').innerHTML = resultsHtml();
      return;
    }
    if (pinTrain(ctx, { kind: 'trainNo', sys: x.sys, no: x.no, type: x.type, dep: x.dep, from: keyStation(x.from), to: keyStation(x.to) })) {
      ctx.status(W(`已釘選 ${x.no} 次到「交通」`, `Train ${x.no} pinned to Transit`));
      $('t-results').innerHTML = resultsHtml();
    }
    return;
  }
  const pick = ev.target.closest('[data-pick]');
  if (pick) return pickStation(pick.dataset.pick);
  const mode = ev.target.closest('[data-mode]');
  if (mode) {
    state.mode = mode.dataset.mode;
    render();
    return state.from && state.to && state.results && search();
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
    return ($('t-results').innerHTML = resultsHtml());
  }
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'swap') {
    [state.from, state.to] = [state.to, state.from];
    state.results = null;
    return render();
  }
  if (act === 'pin-conn') {
    if (pinnedConn()) {
      ctx.data.pins = ctx.data.pins.filter(p => !(p.kind === 'train' && p.from.id === state.from.id && p.to.id === state.to.id && p.from.sys === state.from.sys));
      ctx.save();
      ctx.status(W('已取消釘選', 'Unpinned'));
      return ($('t-results').innerHTML = resultsHtml());
    }
    if (pinTrain(ctx, { kind: 'train', from: state.from, to: state.to })) ctx.status(W('已釘選到「交通」', 'Pinned to Transit'));
    return ($('t-results').innerHTML = resultsHtml());
  }
  if (act === 'go') {
    // The time shown when nobody changed it is "now", whenever 查詢 is pressed.
    const v = $('t-time').value;
    state.time = v && v !== shownNow ? v : null;
    return search();
  }
}

// ---- Picking a station: the nearest, or by city -------------------------------------------------------

async function pickStation(which) {
  let sys = state[which]?.sys === 'hsr' ? 'hsr' : 'tra';
  let city = ctx.city || 'Taipei';
  let list = [];
  const d = sheet(`${sheetHead(which === 'from' ? W('出發車站', 'From station') : W('抵達車站', 'To station'))}
    <div class="q-seg ot-sys" role="group"><button type="button" data-sys="tra">${W('台鐵', 'TRA')}</button><button type="button" data-sys="hsr">${W('高鐵', 'HSR')}</button></div>
    <label class="q-search ot-search-in"><input id="s-q" type="search" placeholder="${W('站名，例如 竹中、新竹', 'Station, e.g. 新竹')}" autocomplete="off"><button class="q-search-clear" type="button" aria-label="${W('清除', 'Clear')}">✕</button></label>
    <div id="s-near"></div>
    <div class="q-chips ot-chip-rail" id="s-city"></div>
    <div id="s-list" class="ot-st-grid"></div>`, 'ot-tall-sheet');
  const choose = s => {
    state[which] = { sys: s.sys, id: s.id, name: s.name };
    state.results = null;
    d.shut();
    render();
    if (state.from && state.to) search();
  };
  const draw = () => {
    d.querySelectorAll('[data-sys]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sys === sys)));
    const t = d.querySelector('#s-q').value.trim() && stationKey(d.querySelector('#s-q').value);
    const mine = list.filter(s => s.sys === sys);
    const cities = CITIES.filter(([k]) => mine.some(s => s.city === k));
    if (!cities.some(([k]) => k === city)) city = cities[0]?.[0] || city;
    d.querySelector('#s-city').innerHTML = t ? '' : cities.map(([k]) => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === city}">${e(cityShort(k))}</button>`).join('');
    const shown = t ? mine.filter(s => stationKey(s.name).includes(t)) : mine.filter(s => s.city === city);
    d.querySelector('#s-list').innerHTML = shown.map(s => `<button class="ot-st-btn" type="button" data-st="${e(s.key)}">${e(s.name)}${s.cls === '0' || s.cls === '1' ? '<i></i>' : ''}</button>`).join('') || `<p class="ot-note">${W('沒有符合的車站', 'No matching station')}</p>`;
    const h = ctx.here;
    const near = h ? mine.map(s => [meters(h.lat, h.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0]).slice(0, 3) : [];
    d.querySelector('#s-near').innerHTML = !t && near.length ? `<h3 class="q-sheet-h">${W('最近', 'Nearest')}</h3>${rowCard(near.map(([m, s]) => `<button class="q-ritem" type="button" data-st="${e(s.key)}">${tile(s.sys, s.sys === 'hsr' ? COLOR.hsr : COLOR.tra, 'sm')}<span class="q-ritem-text"><span class="q-ritem-title">${e(stationLabel(s))}</span></span><span class="q-ritem-value">${e(distText(m))}</span></button>`).join(''))}<h3 class="q-sheet-h">${W('依縣市', 'By city')}</h3>` : '';
  };
  d.querySelector('#s-list').innerHTML = `<p class="ot-note">${W('載入車站中…', 'Loading stations…')}</p>`;
  d.querySelector('#s-q').addEventListener('input', draw);
  d.addEventListener('click', ev => {
    const s = ev.target.closest('[data-sys]');
    if (s) {
      sys = s.dataset.sys;
      return draw();
    }
    const c = ev.target.closest('[data-city]');
    if (c) {
      city = c.dataset.city;
      return draw();
    }
    const st = ev.target.closest('[data-st]');
    if (st) {
      const x = list.find(y => y.key === st.dataset.st);
      if (x) choose(x);
    }
  });
  try {
    list = await railStations();
    draw();
  } catch (err) {
    d.querySelector('#s-list').innerHTML = `<p class="ot-note bad">${e(errorText(err))}</p>`;
  }
}
