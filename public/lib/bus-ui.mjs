// Buses, the parts every tab uses: a route's sheet (its stops each way with
// the buses on them, or a stop's timetable), finding a route (your city, its
// neighbours and 公路客運 together, or one city), pinning a stop into a group
// (常用, 上班, 回家…), managing the groups, and the stops around a point with
// every bus due.

import { cityRoutes, findRoutes, routeStops, routeEta, etaText, etaOf, routeSchedule, stopTimes, stationsNear, INTERCITY } from './bus.mjs';
import { errorText, tdx, rows } from './api.mjs';
import { CITIES, CITY_CODES, cityName, cityShort, NEAR_CITIES } from './city.mjs';
import { cleanItem, MAX_GROUPS, MAX_ITEMS, move } from './store.mjs';
import { sheet, sheetHead, icon, ago } from './ui.mjs';
import { e, uid, meters, tw, twAt, zh, addDays, hm } from './util.mjs';
import { nextRun, liveTrusted } from './live.mjs';

const WEEK = '日一二三四五六';
// 'HH:MM' times as a stop's sign has them: an hour a row, its minutes beside it.
export const hours = times => [...times.reduce((m, t) => m.set(t.slice(0, 2), [...(m.get(t.slice(0, 2)) || []), t]), new Map())];
let ctx = null;
export const useBusCtx = c => (ctx = c);

// ---- The stops around a point: every bus due (one TDX ask) -----------------------------------------

// → [{ name, dist, lat, lon, rows: [{ route, uid, city, dir, stopUID, v }] }], nearest stop first.
export async function nearStops(h, { r = 350, n = 6 } = {}) {
  const at = p => (Math.round(p * 1000) / 1000).toFixed(3);
  const [j, stations] = await Promise.all([
    tdx(`advanced/v2/Bus/EstimatedTimeOfArrival/NearBy?$spatialFilter=nearby(${at(h.lat)},${at(h.lon)},${r})&$select=StopUID,StopName,RouteUID,RouteName,Direction,EstimateTime,StopStatus,NextBusTime,IsLastBus,Estimates&$top=300`, { fresh: 20_000 }),
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
// A bus's place in a list: due soonest first, not out yet after, not running last.
export const etaRank = v => (!v ? 3e6 : v.sec != null ? v.sec : v.status === 1 ? 1e6 + ((v.next || 0) - Date.now()) / 1000 : 2e6);

// ---- Finding a route --------------------------------------------------------------------------------

export function searchSheet() {
  const home = ctx.city || 'Taipei';
  // 附近: your city, its neighbours and 公路客運 together; or one city.
  const NEAR = 'near';
  let city = NEAR;
  let list = [];
  let failed = '';
  const d = sheet(`${sheetHead('搜尋公車路線')}
    <div class="ot-search-in"><input id="r-q" type="search" inputmode="search" placeholder="路線號碼或站名，例如 藍1、快捷8、新竹車站" autocomplete="off" enterkeyhint="search"></div>
    <div class="q-chips ot-city-chips" id="r-city"></div>
    <div id="r-list" class="ot-list"></div>`, 'ot-tall-sheet');
  const cities = () =>
    (d.querySelector('#r-city').innerHTML = [[NEAR, `${cityShort(home)}附近`], [INTERCITY, '公路客運'], ...CITIES.map(([k]) => [k, cityShort(k)])]
      .map(([k, n]) => `<button class="q-chip" type="button" data-city="${k}" aria-pressed="${k === city}">${e(n)}</button>`)
      .join(''));
  const where = r => (r.city === INTERCITY ? '公路客運' : cityShort(r.city));
  const draw = () => {
    const t = d.querySelector('#r-q').value;
    const found = t ? findRoutes(list, t) : [];
    d.querySelector('#r-list').innerHTML = !list.length
      ? failed
        ? `<p class="ot-note bad">${e(failed)}</p>`
        : '<p class="ot-note">載入路線中…</p>'
      : !t
        ? `<p class="ot-note">${e(city === NEAR ? `${cityShort(home)}、鄰近縣市與公路客運` : city === INTERCITY ? '公路客運與國道客運' : cityName(city))}共 ${list.length} 條路線，輸入號碼或站名。</p>`
        : found.map(r => `<button class="ot-row-btn" type="button" data-r="${e(`${r.city}|${r.uid}`)}"><span class="ot-route-no">${e(r.name)}</span><span><b>${e(r.from)} ↔ ${e(r.to)}</b><small>${e(where(r))}</small></span>${icon('chevron')}</button>`).join('') || '<p class="ot-note">沒有符合的路線，試試其他縣市。</p>';
  };
  const load = async () => {
    list = [];
    failed = '';
    draw();
    const want = city === NEAR ? [home, ...(NEAR_CITIES[home] || []), INTERCITY] : [city];
    const got = await Promise.all(want.map(c => cityRoutes(c).catch(err => ((failed = errorText(err)), []))));
    // What loaded is searched; one city failing doesn't hide the rest.
    list = got.flat();
    draw();
  };
  cities();
  load();
  d.querySelector('#r-q').addEventListener('input', draw);
  d.addEventListener('click', ev => {
    const c = ev.target.closest('[data-city]');
    if (c) {
      city = c.dataset.city;
      cities();
      return load();
    }
    const r = ev.target.closest('[data-r]');
    if (r) {
      const route = list.find(x => `${x.city}|${x.uid}` === r.dataset.r);
      d.close();
      openRoute(ctx, route, { add: true });
    }
  });
  setTimeout(() => d.querySelector('#r-q').focus(), 50);
}

// ---- A route: its stops each way, the buses on them ----------------------------------------------------

export async function openRoute(c, route, { stopUID = '', dir = null, add = false } = {}) {
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
    return n === 1 ? `明天（週${WEEK[(t.dow + 1) % 7]}）` : `週${WEEK[(t.dow + n) % 7]}`;
  };
  // The route not running again today: which day the stops' times are of.
  const offNote = w => {
    const first = planned(w, 0);
    if (!first || first.day === 0) return '';
    const ranToday = nextRun(sched, w, 0, twAt(today().date, '00:00'), 0);
    return `${ranToday ? '今天已收班' : '今天不行駛'}，以下是${dayName(first.day)}的時刻`;
  };
  const tableHtml = w => {
    if (!sched) return '<p class="ot-note">載入時刻表…</p>';
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
        moved = `今天不行駛，顯示${dayName(n)}的時刻`;
      }
    }
    const date = addDays(t0.date, day);
    const dow = (t0.dow + day) % 7;
    // Today's past times greyed and its next one marked; another day's all alike.
    const now = day ? '' : t0.hm;
    const { times, every } = stopTimes(sched, { stopUID: s.uid, name: s.name, dir: w.dir }, date, dow);
    const next = day ? null : times.find(t => t >= now);
    const named = day === 0 ? '今天' : day === 1 ? '明天' : `週${WEEK[dow]}`;
    // The coming week, a day a column: 今天, 明天, then by weekday.
    const days = `<div class="ot-tt-days" role="group" aria-label="哪一天">${[0, 1, 2, 3, 4, 5, 6].map(i => `<button type="button" data-day="${i}" aria-pressed="${i === day}"><small>${i === 0 ? '今天' : i === 1 ? '明天' : '週'}</small><b>${WEEK[(t0.dow + i) % 7]}</b></button>`).join('')}</div>`;
    // The stop: a native picker (an iPhone's wheel), its name the label.
    const stopPick = `<label class="ot-tt-stop"><b>${e(s.name)}</b>${icon('down')}<select data-pickstop aria-label="換站牌">${w.stops.map(x => `<option value="${e(x.uid)}"${x.uid === s.uid ? ' selected' : ''}>${e(x.name)}</option>`).join('')}</select></label>`;
    const body = times.length
      ? `<div class="ot-timetable">${hours(times)
          .map(([h, list]) => `<div class="ot-tt-hour"><b>${e(h)}</b><span>${list.map(t => `<i class="${t < now ? 'past' : t === next ? 'next' : ''}">${e(t.slice(3, 5))}</i>`).join('')}</span></div>`)
          .join('')}</div>`
      : every.length
        ? `<div class="ot-list">${every.map(f => `<div class="ot-order-row"><span>${e(f.from)}–${e(f.to)}</span><b>${f.min && f.max && f.min !== f.max ? `每 ${f.min}–${f.max} 分` : `每 ${f.min || f.max} 分`}</b></div>`).join('')}</div>`
        : `<p class="ot-note">${named}這個站牌沒有排班資料（業者沒提供，或${named}停駛）。</p>`;
    return `${days}${moved ? `<p class="ot-note ot-off-note">${e(moved)}</p>` : ''}<div class="ot-tt-head">${stopPick}<small>${e(named)}${times.length ? ` ${times.length} 班${day ? '' : next ? `・下一班 ${e(next)}` : '・已收班'}` : ''}</small></div>${body}`;
  };
  let offDay = 0;
  const draw = () => {
    const w = ways?.[way];
    const off = w && sched?.length ? offNote(w) : '';
    offDay = off ? planned(w, 0).day : 0;
    const keep = d.scrollTop;
    // Like a stop's sign: the route's number big, where it's going beside it;
    // the way and the view stay at the top while the stops scroll under.
    const where = route.city === INTERCITY ? '公路客運' : cityShort(route.city);
    const head = `<div class="q-sheet-head ot-rt-head"><div class="ot-rt-id"><span class="ot-rt-no">${e(route.name)}</span><div><h2>${w ? `往 ${e(w.headsign)}` : '路線'}</h2><p class="ot-sheet-sub">${e(where)}${w?.subName && w.subName !== route.name ? ` · ${e(w.subName)}` : ''}</p></div></div><button class="q-close" type="button" data-act="close" aria-label="關閉">×</button></div>`;
    const tabs = ways && ways.length > 1 ? `<div class="ot-segctl ot-dir" role="group" aria-label="方向">${ways.map((x, i) => `<button type="button" data-way="${i}" aria-pressed="${i === way}">往 ${e(x.headsign)}</button>`).join('')}</div>` : '';
    const views = `<div class="ot-segctl ot-view" role="group" aria-label="即時或時刻表"><button type="button" data-view="live" aria-pressed="${view === 'live'}">即時到站</button><button type="button" data-view="table" aria-pressed="${view === 'table'}">時刻表</button></div>`;
    const stops = !ways
      ? '<p class="ot-note">載入站牌中…</p>'
      : !w
        ? '<p class="ot-note">這條路線沒有站牌資料。</p>'
        : view === 'table'
          ? tableHtml(w)
          : `${off ? `<p class="ot-note ot-off-note">${e(off)}</p>` : ''}<ol class="ot-route-stops">${w.stops
            .map(s => {
              const k = w.stops.indexOf(s);
              let v = live.get(s.uid);
              // A bus 'coming' that the timetable has nowhere near (resting
              // with its tracker on): not taken; the timetable's time instead.
              if (v?.status === 0 && v.sec != null && !liveTrusted(sched, w, k, Date.now() + v.sec * 1000)) v = null;
              let t = etaText(v);
              // No bus on its way to it (尚未發車, 末班已過 the other way…): the timetable's next.
              const p = !v || v.status !== 0 || v.sec == null ? planned(w, k) : null;
              // (Another day's said once above the stops, when it's every stop's.)
              if (p) t = { main: hm(p.at), sub: p.day && p.day !== offDay ? `${dayName(p.day)}・時刻表` : '時刻表', tone: 'wait' };
              const mine = s.uid === stopUID;
              const ride = pinnedAt(s.uid);
              // Choosing where to get off: the stops after the one you get on at.
              const at = boarding ? w.stops.findIndex(x => x.uid === boarding.uid) : -1;
              const pick = boarding ? (k > at ? ' can-off' : k === at ? ' on-here' : ' before') : '';
              // A bus at the stop (進站中, 即將進站) rides on its dot.
              return `<li class="${t.tone}${mine ? ' mine' : ''}${pick}" data-stop="${e(s.uid)}"${boarding && k > at ? ` data-off="${e(s.uid)}"` : ''}><span class="ot-rs-eta ${t.tone}">${e(t.main)}</span><span class="ot-rs-dot">${t.tone === 'now' ? icon('bus') : ''}</span><span class="ot-rs-name"><b>${e(s.name)}</b>${k === at ? '<small>上車</small>' : ride?.off ? `<small>${icon('star')} 到 ${e(ride.off.stop)}</small>` : t.sub ? `<small>${e(t.sub)}</small>` : ''}</span>${boarding ? '' : `<button class="ot-rs-star${ride ? ' on' : ''}" type="button" data-add="${e(s.uid)}" aria-label="${ride ? '取消釘選' : '從這站上車，釘選'}">${icon('star')}</button>`}</li>`;
            })
            .join('')}</ol>`;
    const choose = boarding && view === 'live' ? `<div class="ot-ride-pick"><div><b>從「${e(boarding.name)}」上車</b><small>點你下車的站，回程會自動對調</small></div><button class="q-btn" type="button" data-only="1">只釘這站</button><button class="q-icon-btn" type="button" data-cancel-ride="1" aria-label="取消">${icon('x')}</button></div>` : '';
    d.querySelector('#rt').innerHTML = `<div class="ot-rt-top">${head}${tabs}${views}${choose}</div>${err && view === 'live' ? `<p class="ot-note bad">${e(err)}</p>` : ''}${stops}${view === 'live' && !boarding ? `<p class="ot-note center">${e(ago(at))}・每 20 秒更新・☆ 釘選你搭的這段</p>` : ''}`;
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
    if (all.length >= MAX_ITEMS * ctx.data.groups.length) return ctx.status('釘選的公車太多了，先刪掉一些');
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
    const g = ctx.data.groups[0] || (ctx.data.groups[0] = { id: 'g' + uid(), name: '常用', items: [] });
    g.items.push(item);
    ctx.save();
    ctx.refreshTabs?.();
    ctx.status(off ? `已釘選 ${route.name}：${on.name} → ${off.name}${back ? '，回程自動對調' : ''}` : `已釘選 ${route.name} ${on.name}`);
  };
  const refresh = async () => {
    try {
      live = await routeEta(route);
      at = Date.now();
      err = '';
    } catch (x) {
      err = errorText(x);
    }
    if (d.open) draw();
  };
  draw();
  try {
    ways = await routeStops(route, c?.here);
    if (dir != null) {
      const i = ways.findIndex(w => w.dir === dir && (!stopUID || w.stops.some(s => s.uid === stopUID)));
      way = i >= 0 ? i : Math.max(0, ways.findIndex(w => w.stops.some(s => s.uid === stopUID)));
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
  const t = setInterval(refresh, 20_000);
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
        ctx.status('已取消釘選');
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
  const d = sheet(`${sheetHead('加入群組', `${e(item.route)} · ${e(item.stop)}`)}
    <div class="ot-list">${ctx.data.groups
      .map((g, i) => {
        const has = g.items.some(x => x.stopUID === item.stopUID);
        return `<button class="ot-row-btn" type="button" data-to="${i}" ${has ? 'disabled' : ''}><span><b>${e(g.name)}</b><small>${g.items.length} 個站牌${has ? ' · 已在這裡' : ''}</small></span>${icon('plus')}</button>`;
      })
      .join('')}</div>
    ${ctx.data.groups.length < MAX_GROUPS ? `<label class="ot-field"><span>或新的群組</span><div class="ot-row"><input id="g-new" maxlength="12" placeholder="例如：上班、回家"><button class="q-btn" type="button" data-new="1">建立並加入</button></div></label>` : ''}`);
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
    if (g.items.length >= MAX_ITEMS) return ctx.status(`一個群組最多 ${MAX_ITEMS} 個站牌`);
    g.items.push(item);
    ctx.save();
    d.close();
    ctx.refreshTabs?.();
    done?.();
    ctx.status(`已加入「${g.name}」`);
  });
}

// ---- Managing the groups: names, order, their stops ------------------------------------------------------

export function manageSheet() {
  const d = sheet('', 'ot-tall-sheet');
  const draw = () => {
    d.innerHTML = `${sheetHead('管理群組', '上下移動調整順序；左右滑動就照這個順序切換')}
      ${ctx.data.groups
        .map(
          (g, i, all) => `<section class="ot-manage">
          <div class="ot-order-row head"><input class="ot-name-in" data-name="${i}" value="${e(g.name)}" maxlength="16" aria-label="群組名稱">
            <button class="q-icon-btn" type="button" data-gmove="${i}" data-by="-1" aria-label="上移" ${i ? '' : 'disabled'}>${icon('up')}</button>
            <button class="q-icon-btn" type="button" data-gmove="${i}" data-by="1" aria-label="下移" ${i < all.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
            <button class="q-icon-btn" type="button" data-gdel="${i}" aria-label="刪除群組" ${all.length > 1 ? '' : 'disabled'}>${icon('trash')}</button></div>
          ${g.items
            .map(
              (it, k, list) => `<div class="ot-order-row"><span><b>${e(it.route)}</b> ${e(it.stop)}${it.off ? ` → ${e(it.off.stop)}` : ''}<small>往 ${e(it.headsign)}${it.back ? ' · 回程自動對調' : ''}</small></span>
              <button class="q-icon-btn" type="button" data-imove="${i}:${k}" data-by="-1" aria-label="上移" ${k ? '' : 'disabled'}>${icon('up')}</button>
              <button class="q-icon-btn" type="button" data-imove="${i}:${k}" data-by="1" aria-label="下移" ${k < list.length - 1 ? '' : 'disabled'}>${icon('down')}</button>
              <button class="q-icon-btn" type="button" data-idel="${i}:${k}" aria-label="移除">${icon('trash')}</button></div>`
            )
            .join('')}
        </section>`
        )
        .join('')}
      ${ctx.data.groups.length < MAX_GROUPS ? `<button class="q-btn ot-wide" type="button" data-gadd="1">${icon('plus')} 新增群組</button>` : ''}`;
  };
  draw();
  d.addEventListener('change', ev => {
    const n = ev.target.closest('[data-name]');
    if (!n) return;
    ctx.data.groups[Number(n.dataset.name)].name = n.value.trim().slice(0, 16) || '群組';
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
    } else if (ev.target.closest('[data-gadd]')) ctx.data.groups.push({ id: 'g' + uid(), name: `群組 ${ctx.data.groups.length + 1}`, items: [] });
    else return;
    ctx.save();
    draw();
    ctx.refreshTabs?.();
  });
}
