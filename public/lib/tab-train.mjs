// 火車: 台鐵 and 高鐵 from one station to another, changing wherever it's
// faster (the router in rail.mjs): a branch line to the trunk line, 台鐵 to
// 高鐵 and back, the walk between them timed. The start is the nearest
// station (or any, picked by city first); each option shows its trains,
// where to change and how long you wait, the fare, and today's delays.

import { railStations, railNetwork, traDelays, legFare } from './raildata.mjs';
import { journeys, tags, SYSTEMS } from './rail.mjs';
import { errorText } from './api.mjs';
import { CITIES, cityShort } from './city.mjs';
import { remember, trainKey } from './store.mjs';
import { sheet, sheetHead, icon } from './ui.mjs';
import { e, hm, minsText, tw, twAt, addDays, meters, distText } from './util.mjs';

const $ = id => document.getElementById(id);
let ctx = null;
const state = { from: null, to: null, mode: 'all', date: null, time: null, results: null, open: -1, error: '', delays: new Map(), fares: new Map() };

export function init(c) {
  ctx = c;
  $('panel-train').addEventListener('click', onClick);
  $('panel-train').addEventListener('change', ev => {
    if (ev.target.id === 't-time') state.time = ev.target.value || null;
    if (ev.target.id === 't-date') state.date = ev.target.value || null;
  });
  const last = ctx.data.trains[0];
  if (last) Object.assign(state, { from: last.from, to: last.to });
  render();
  if (!state.from) nearestStart();
}

export function show() {
  if (ctx.trainFrom) {
    state.from = ctx.trainFrom;
    state.results = null;
    ctx.trainFrom = null;
    render();
  }
}

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

const stationLabel = s => (!s ? '' : s.sys === 'hsr' ? `高鐵${s.name}` : s.name);
const sysTag = s => (s ? `<span class="ot-sys ${s.sys}">${SYSTEMS[s.sys]}</span>` : '');

function render() {
  const today = tw().date;
  const date = state.date || today;
  const recent = ctx.data.trains.filter(x => trainKey(x) !== (state.from && state.to ? trainKey({ from: state.from, to: state.to }) : '')).slice(0, 5);
  $('panel-train').innerHTML = `
    <div class="ot-wrap">
      <section class="ot-od-card">
        <button class="ot-st-pick" type="button" data-pick="from"><small>出發</small>${state.from ? `<b>${e(stationLabel(state.from))}</b>${sysTag(state.from)}` : '<b class="muted">選擇車站</b>'}</button>
        <button class="ot-swap" type="button" data-act="swap" aria-label="對調">${icon('swap')}</button>
        <button class="ot-st-pick" type="button" data-pick="to"><small>抵達</small>${state.to ? `<b>${e(stationLabel(state.to))}</b>${sysTag(state.to)}` : '<b class="muted">選擇車站</b>'}</button>
      </section>
      <div class="q-chips ot-mode">
        ${[['all', '智慧轉乘（台鐵＋高鐵）'], ['tra', '只搭台鐵'], ['hsr', '只搭高鐵']].map(([k, n]) => `<button class="q-chip" type="button" data-mode="${k}" aria-pressed="${state.mode === k}">${n}</button>`).join('')}
      </div>
      <div class="ot-when-row">
        <label class="ot-field inline"><span>日期</span><input id="t-date" type="date" value="${date}" min="${today}" max="${addDays(today, 30)}"></label>
        <label class="ot-field inline"><span>出發</span><input id="t-time" type="time" value="${state.time || ''}" placeholder="現在"></label>
        <button class="q-btn primary" type="button" data-act="go" ${state.from && state.to ? '' : 'disabled'}>${icon('search')} 查詢</button>
      </div>
      ${recent.length ? `<div class="q-chips ot-recent">${recent.map((x, i) => `<button class="q-chip" type="button" data-recent="${i}">${e(stationLabel(x.from))} → ${e(stationLabel(x.to))}</button>`).join('')}</div>` : ''}
      <div id="t-results">${resultsHtml()}</div>
    </div>`;
}

function resultsHtml() {
  if (state.error) return `<p class="ot-note bad">${e(state.error)}</p>`;
  if (state.results === 'loading') return '<p class="ot-note">載入今天的台鐵與高鐵時刻，找最好的轉乘…</p>';
  if (!state.results) return `<div class="ot-empty-card">${icon('tra', 'big')}<h3>台鐵、高鐵一起查</h3><p>選起訖站，自動找出最快的走法：支線換幹線、台鐵換高鐵，換車要走多久都算好了。</p></div>`;
  if (!state.results.length) return '<p class="ot-note">這個時間之後找不到班次，換個時間或日期試試。</p>';
  const labels = tags(state.results);
  return state.results
    .map((j, i) => {
      const rides = j.legs.filter(l => !l.walk);
      const delay = rides.reduce((a, l) => a + (l.trip.sys === 'tra' ? state.delays.get(l.trip.no) || 0 : 0), 0);
      const first = rides[0];
      const fare = rides.map(l => state.fares.get(fareKey(l))).reduce((a, b) => (a == null || b == null ? null : a + b), 0);
      return `<button class="ot-jny${i === state.open ? ' on' : ''}" type="button" data-j="${i}">
        <div class="ot-jny-top"><span class="ot-jny-time"><b>${e(hm(j.dep))}</b> → <b>${e(hm(j.arr))}</b></span><span class="ot-jny-dur">${e(minsText((j.arr - j.dep) / 1000))}</span></div>
        <div class="ot-jny-legs">${rides.map(l => `<span class="ot-train-chip ${l.trip.sys} ${l.trip.code === '6' || l.trip.code === '10' ? 'local' : ''}">${e(l.trip.type)} ${e(l.trip.no)}</span>`).join('<span class="ot-leg-sep">›</span>')}</div>
        <div class="ot-jny-sub">${[j.transfers ? `轉乘 ${j.transfers} 次` : '直達', first && state.delays.get(first.trip.no) ? `首班晚 ${state.delays.get(first.trip.no)} 分` : '', fare ? `約 NT$${fare}` : '', ...(labels.get(j) || [])].filter(Boolean).map(t => `<span>${e(t)}</span>`).join('')}${delay && !state.delays.get(first?.trip.no) ? `<span class="warn">途中誤點 ${delay} 分</span>` : ''}</div>
        ${i === state.open ? detailHtml(j) : ''}
      </button>`;
    })
    .join('');
}

const fareKey = l => `${l.from}>${l.to}:${l.trip.code}`;
let net = null;
const nameOf = key => {
  const s = net?.st.get(key);
  return s ? (s.sys === 'hsr' ? `高鐵${s.name}` : s.name) : key;
};
function detailHtml(j) {
  const out = [];
  j.legs.forEach((l, k) => {
    if (l.walk) {
      out.push(`<li class="walk"><span class="ot-step-i">${icon('walk')}</span><span class="ot-step-what">步行到 <b>${e(nameOf(l.to))}</b><small>約 ${l.min} 分（含進出站）</small></span></li>`);
      return;
    }
    const prev = j.legs.slice(0, k).reverse().find(x => !x.walk);
    if (prev) {
      const wait = Math.round((l.dep - prev.arr) / 60_000);
      const same = prev.to === l.from;
      out.push(`<li class="change"><span class="ot-step-i">${icon('swap')}</span><span class="ot-step-what">${same ? `在 <b>${e(nameOf(l.from))}</b> 換車` : '換車'}<small>${wait} 分鐘可以換車</small></span></li>`);
    }
    const t = l.trip;
    const d = t.sys === 'tra' ? state.delays.get(t.no) : 0;
    out.push(`<li class="ride ${t.sys}"><span class="ot-step-i">${icon(t.sys)}</span><span class="ot-step-what">
      <b>${e(t.typeFull || t.type)} ${e(t.no)} 次</b> 往 ${e(t.headsign)}${d ? ` <span class="warn">晚 ${d} 分</span>` : ''}
      <span class="ot-ride"><span><b>${e(hm(l.dep))}</b> ${e(nameOf(l.from))}</span><span><b>${e(hm(l.arr))}</b> ${e(nameOf(l.to))}</span></span>
      <small>${l.stops} 站 · ${e(minsText((l.arr - l.dep) / 1000))}${state.fares.get(fareKey(l)) ? ` · NT$${state.fares.get(fareKey(l))}` : ''}${t.bike ? ' · 可攜自行車' : ''}</small></span></li>`);
  });
  return `<ol class="ot-steps rail">${out.join('')}</ol>`;
}

async function search() {
  if (!state.from || !state.to) return;
  if (state.from.sys === state.to.sys && state.from.id === state.to.id) {
    state.error = '起訖站相同';
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
    net = await railNetwork(date, { next: tw(t).min >= 21 * 60 });
    const use = state.mode === 'tra' ? x => x.sys === 'tra' : state.mode === 'hsr' ? x => x.sys === 'hsr' : () => true;
    const fromKey = `${state.from.sys}:${state.from.id}`;
    const toKey = `${state.to.sys}:${state.to.id}`;
    // (A station beside the other railway, 六家 and 高鐵新竹, is reached on foot:
    // the walks are in the network.)
    const starts = [{ key: fromKey, at: Math.max(t, now - 60_000) }];
    const ends = [{ key: toKey, extra: 0 }];
    state.results = journeys(net, starts, ends, t, { use, n: 6 });
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

function onClick(ev) {
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
  if (act === 'go') {
    state.time = $('t-time').value || null;
    state.date = $('t-date').value || null;
    return search();
  }
}

// ---- Picking a station: the nearest, or by city -------------------------------------------------------

async function pickStation(which) {
  let sys = state[which]?.sys === 'hsr' ? 'hsr' : 'tra';
  let city = ctx.city || 'Taipei';
  let list = [];
  const d = sheet(`${sheetHead(which === 'from' ? '出發車站' : '抵達車站')}
    <div class="q-chips ot-sys-tabs"><button class="q-chip" type="button" data-sys="tra">台鐵</button><button class="q-chip" type="button" data-sys="hsr">高鐵</button></div>
    <div class="ot-search-in"><input id="s-q" type="search" placeholder="站名，例如 竹中、新竹" autocomplete="off"></div>
    <div id="s-near"></div>
    <div class="q-chips ot-city-chips" id="s-city"></div>
    <div id="s-list" class="ot-st-grid"></div>`, 'ot-tall-sheet');
  const choose = s => {
    state[which] = { sys: s.sys, id: s.id, name: s.name };
    state.results = null;
    d.close();
    render();
    if (state.from && state.to) search();
  };
  const draw = () => {
    d.querySelectorAll('[data-sys]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sys === sys)));
    const t = d.querySelector('#s-q').value.trim().replace(/台/g, '臺').replace(/(車站|站)$/, '');
    const mine = list.filter(s => s.sys === sys);
    const cities = CITIES.filter(([k]) => mine.some(s => s.city === k));
    if (!cities.some(([k]) => k === city)) city = cities[0]?.[0] || city;
    d.querySelector('#s-city').innerHTML = t ? '' : cities.map(([k]) => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === city}">${e(cityShort(k))}</button>`).join('');
    const shown = t ? mine.filter(s => s.name.replace(/台/g, '臺').includes(t)) : mine.filter(s => s.city === city);
    d.querySelector('#s-list').innerHTML = shown.map(s => `<button class="ot-st-btn" type="button" data-st="${e(s.key)}">${e(s.name)}${s.cls === '0' || s.cls === '1' ? '<i></i>' : ''}</button>`).join('') || '<p class="ot-note">沒有符合的車站</p>';
    const h = ctx.here;
    const near = h ? mine.map(s => [meters(h.lat, h.lon, s.lat, s.lon), s]).sort((a, b) => a[0] - b[0]).slice(0, 3) : [];
    d.querySelector('#s-near').innerHTML = !t && near.length ? `<h3 class="q-sheet-h">離你最近</h3><div class="ot-list">${near.map(([m, s]) => `<button class="ot-row-btn" type="button" data-st="${e(s.key)}">${icon(s.sys)}<span><b>${e(stationLabel(s))}</b><small>${e(distText(m))}</small></span></button>`).join('')}</div><h3 class="q-sheet-h">依縣市</h3>` : '';
  };
  d.querySelector('#s-list').innerHTML = '<p class="ot-note">載入車站中…</p>';
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
