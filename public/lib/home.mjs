// The shelves of 地圖's sheet (Maps' home): few calm shelves, big pictures,
// what the app already knows put first.
//
//   常用  round tiles: 家, 公司, 學校 and your pins, and one to add; a tap plans a trip there
//   建議  the best one to three things to do now (suggest.mjs ranks them): the
//         first a big card, the rest rows; each opens what it already opens
//   最近  where you looked lately, each one forgettable
//   附近  the next buses at the stops around you, the YouBike stations
//
// Nothing here asks a new question of any server: the pinned buses' times, the
// stops and YouBike around you, the day's trains are what 交通 reads too. The
// sheet's other contents (search results, a card) are tab-map's.

import * as kitUI from '#kit/ui.mjs';
import { suggest } from './suggest.mjs';
import { tripNow, keptLead, pinnedTrainsNext, rideNow } from './tab-go.mjs';
import { stopsEta, etaRank } from './bus.mjs';
import { nearStops, strip, fitStrips, busWhen } from './bus-ui.mjs';
import { stationLabel, icon, legChips } from './ui.mjs';
import { COLOR, tile, tag, countHtml, tick, hero } from './look.mjs';
import { tripKey } from './store.mjs';
import { e, hm, distText, meters } from './util.mjs';

// Where you already are (within 100 m): 這裡, not 0 公尺.
const near = m => (m < 100 ? W('這裡', 'Here') : distText(m));
import { W } from './lang.mjs';

const PLACE_WORD = { home: W('家', 'Home'), work: W('公司', 'Work'), school: W('學校', 'School') };
const KINDS = ['home', 'work', 'school'];
const HERO_COLOR = { tra: COLOR.tra, hsr: COLOR.hsr, home: '#ef7d00' };
const RECENTS = 4;
const NEAR_BUSES = 4;
// A read of the pinned buses and the stops around you is this old before it is asked again.
const FRESH_MS = 20_000;

// A shelf's head (the kit's).
const head = (title, { more = '', moreTap = '' } = {}) => kitUI.sectionHeadHtml(title, { more, moreTap });
// A saved place's tile, in its own colour (the kit's).
const placeTile = kind => kitUI.placeTileHtml(kind);

export function createHome(box, ctx, act) {
  const S = { stops: null, bikes: null, pinned: new Map(), pinnedAt: 0, trains: [], read: 0, sug: [] };
  let last = '';
  let ticker = 0;
  let running = false;

  // ---- what each shelf says ----

  const favs = () => {
    const here = ctx.here;
    const rank = p => (KINDS.includes(p.icon) ? KINDS.indexOf(p.icon) : KINDS.length);
    const list = ctx.data.places.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(x => x.p);
    const tiles = list.map(p => `<button class="ot-fav" type="button" data-fav="${e(p.id)}">${placeTile(p.icon)}<b>${e(p.name)}</b>${here ? `<small>${e(near(meters(here.lat, here.lon, p.lat, p.lon)))}</small>` : ''}</button>`);
    // 家 and 公司 not set yet: their tiles wait, to be filled in with a tap.
    const ghosts = ['home', 'work'].filter(k => !ctx.data.places.some(p => p.icon === k)).map(k => `<button class="ot-fav ghost" type="button" data-fav-add="${k}">${placeTile(k)}<b>${e(PLACE_WORD[k])}</b><small>${W('加入', 'Add')}</small></button>`);
    const add = `<button class="ot-fav add" type="button" data-fav-add="" aria-label="${W('釘選地點', 'Pin a place')}"><span class="ot-fav-plus">${icon('plus')}</span><b>${W('新增', 'New')}</b></button>`;
    return `<section class="ot-shelf">${head(W('常用', 'Favorites'))}<div class="q-rail ot-favs">${[...tiles, ...ghosts, add].join('')}</div></section>`;
  };

  // What the sheet has to say now, ranked (suggest.mjs).
  const candidates = () => {
    const now = Date.now();
    const here = ctx.here;
    const trips = ctx.data.saved
      .map(t => ({ t, w: tripNow(t, here, now) }))
      // (A time just gone is still news for a few minutes: `late`.)
      .filter(x => x.w && (x.w.at || x.w.late))
      .map(({ t, w }) => {
        const plan = w.at ? keptLead(w, { prefs: ctx.data.prefs, here, picks: t.picks, now }) : null;
        // (By an arrival time with no way found yet, the time is when it must be there by, not when to leave.)
        const arriveBy = w.by === 'arrive' && !plan && w.at ? w.at : null;
        return { id: w.id, label: w.label, from: w.from, to: w.to, leaveAt: plan ? plan.dep : w.at || w.late, plan, arriveBy, w, recurring: w.recurring, today: w.today };
      });
    const buses = ctx.data.groups
      .flatMap(g => g.items)
      .map(it => {
        const r = { ...it, ...rideNow(it, here) };
        const v = S.pinned.get(r.stopUID);
        const live = v?.status === 0 && v.sec != null;
        return { id: it.id, route: it.route, stop: r.stop, toward: r.off ? r.off.stop : r.headsign, at: live ? (v.t ?? S.pinnedAt) + v.sec * 1000 : null, live, last: Boolean(v?.last), d: here && r.lat != null ? meters(here.lat, here.lon, r.lat, r.lon) : null, it, r };
      });
    const trains = S.trains
      .map(({ p, rows }) => {
        const x = rows.find(r => r.dep != null && r.dep > now - 60_000);
        return x ? { id: p.id, p, from: stationLabel(p.from), to: stationLabel(p.to), dep: x.dep, arr: x.arr, label: x.label, delay: x.delay, hsr: p.from.sys === 'hsr' } : null;
      })
      .filter(Boolean);
    const bikes = (S.bikes || []).map(b => ({ ...b, d: b.walk?.dist ?? b.d }));
    return suggest({ now, here, places: ctx.data.places, trips, buses, trains, bikes });
  };

  // One suggestion as { glyph, eyebrow, title, sub, tags, at, big, color, body }.
  const say = x => {
    if (x.kind === 'trip') {
      const p = x.plan;
      return {
        glyph: 'route',
        eyebrow: x.label,
        title: `${x.from ? x.from.name : W('目前位置', 'Here')} → ${x.to.name}`,
        at: x.leaveAt,
        tags: [x.arriveBy ? tag(W(`${hm(x.arriveBy)} 前到`, `Arrive by ${hm(x.arriveBy)}`), 'solid') : tag(W(`${hm(x.leaveAt)} 出發`, `Leave ${hm(x.leaveAt)}`), 'solid'), p ? tag(W(`${hm(p.arr)} 到`, `Arrive ${hm(p.arr)}`), 'solid') : ''],
        body: p ? `<span class="ot-legs ot-hc-legs">${legChips(p.legs)}</span>` : '',
        tile: tile('route', COLOR.route)
      };
    }
    if (x.kind === 'bus')
      return {
        glyph: 'bus',
        eyebrow: W('釘選公車', 'Pinned bus'),
        title: `${x.route} ${W('往', 'to')} ${x.toward || '—'}`,
        sub: W(`${x.stop} 上車`, `Board at ${x.stop}`),
        at: x.at,
        floor: true,
        tags: [tag(W('即時', 'Live'), 'solid green'), x.d != null ? tag(distText(x.d), 'solid') : '', x.last ? tag(W('末班車', 'Last bus'), 'solid red') : ''],
        tile: tile('bus', COLOR.bus)
      };
    if (x.kind === 'train')
      return {
        glyph: x.hsr ? 'hsr' : 'tra',
        eyebrow: x.hsr ? W('高鐵', 'HSR') : W('台鐵', 'TRA'),
        title: `${x.from} → ${x.to}`,
        at: x.dep,
        color: x.hsr ? HERO_COLOR.hsr : HERO_COLOR.tra,
        tags: [tag(`${hm(x.dep)}${x.arr ? ` → ${hm(x.arr)}` : ''}`, 'solid'), x.label ? tag(x.label, 'solid') : '', x.delay ? tag(W(`晚 ${x.delay} 分`, `${x.delay} min late`), 'solid orange') : ''],
        tile: tile(x.hsr ? 'hsr' : 'tra', x.hsr ? COLOR.hsr : COLOR.tra)
      };
    if (x.kind === 'bike') {
      const n = (x.bikes || 0) + (x.ebike || 0);
      return {
        glyph: 'bike',
        eyebrow: W('附近的 YouBike', 'YouBike near you'),
        title: x.name,
        big: `<strong class="q-hc-big">${n}<small>${W('台可借', 'bikes')}</small></strong>`,
        num: n,
        tags: [x.d != null ? tag(distText(x.d), 'solid') : '', x.ebike ? tag(W(`電輔車 ${x.ebike}`, `E-bikes ${x.ebike}`), 'solid') : '', tag(W(`空位 ${x.ret}`, `Docks ${x.ret}`), 'solid')],
        tile: tile('bike', COLOR.bike)
      };
    }
    return {
      glyph: 'home',
      eyebrow: W('回家', 'Head home'),
      title: x.place.name,
      big: `<strong class="q-hc-big">${e(distText(x.d))}</strong>`,
      numText: distText(x.d),
      color: HERO_COLOR.home,
      tags: [tag(W('從目前位置', 'From here'), 'solid')],
      tile: placeTile('home')
    };
  };

  const sugHtml = list => {
    if (!list.length) return '';
    S.sug = list;
    const cards = list.map((x, i) => {
      const s = say(x);
      const big = s.big || (s.at != null ? countHtml(s.at, { floor: Boolean(s.floor) }) : '');
      if (i === 0) return hero({ eyebrow: s.eyebrow, glyph: s.glyph, big, title: s.title, sub: s.sub || '', tags: s.tags, body: s.body || '', color: s.color || '', attrs: `data-sg="${e(x.key)}"` });
      // The rest: a row, its number on the right.
      const end = s.num != null ? `<span class="ot-eta"><strong class="ot-eta-n">${s.num}</strong><small>${W('台', 'bikes')}</small></span>` : s.numText ? `<span class="ot-eta"><strong class="ot-eta-n sm">${e(s.numText)}</strong></span>` : s.at != null ? `<span class="ot-eta">${countHtml(s.at, { floor: Boolean(s.floor), cls: 'ot-eta-n' })}<small>${e(hm(s.at))}</small></span>` : '';
      return `<button class="q-ritem ot-sg" type="button" data-sg="${e(x.key)}">${s.tile}<span class="q-ritem-text"><span class="q-ritem-title">${e(s.eyebrow)}</span><small>${e(s.title)}</small></span>${end}</button>`;
    });
    const [first, ...rest] = cards;
    return `<section class="ot-shelf ot-sugs">${head(W('建議', 'For you'))}${first}${rest.length ? `<div class="q-rowcard">${rest.join('')}</div>` : ''}</section>`;
  };

  const recents = () => {
    const list = ctx.data.trips.slice(0, RECENTS);
    if (!list.length) return '';
    const here = ctx.here;
    const rows = list.map(x => {
      const k = tripKey(x);
      return `<div class="q-ritem ot-rec"><button class="ot-rec-main" type="button" data-recent="${e(k)}"><span class="ot-rec-i">${icon('clock')}</span><span class="q-ritem-text"><span class="q-ritem-title">${e(x.name || W('地圖上的位置', 'Spot on the map'))}</span>${here ? `<small>${e(distText(meters(here.lat, here.lon, x.lat, x.lon)))}</small>` : ''}</span></button><button class="q-icon-btn ot-rec-x" type="button" data-del-recent="${e(k)}" aria-label="${W('刪除這筆', 'Delete')}">${icon('x')}</button></div>`;
    });
    return `<section class="ot-shelf">${head(W('最近', 'Recents'), { more: W('清除', 'Clear'), moreTap: 'clear-recents' })}<div class="q-rowcard">${rows.join('')}</div></section>`;
  };

  const bikeCard = b => {
    const lv = b.ok === false ? 'off' : b.bikes + b.ebike === 0 ? 'none' : b.bikes + b.ebike <= 3 ? 'few' : 'ok';
    const mins = b.walk ? Math.max(1, Math.round(b.walk.sec / 60)) : null;
    return `<button class="ot-bk ${lv}" type="button" data-bk="${e(b.uid)}"><span class="ot-bk-name">${e(b.name)}</span><span class="ot-bk-n">${b.ok === false ? `<b>—</b><em>${W('暫停', 'Closed')}</em>` : `<b>${b.bikes}</b>${b.ebike ? `<em>${icon('bolt')}${b.ebike}</em>` : ''}`}</span><span class="ot-bk-f"><i>${icon('dock')}${b.ret}</i>${mins != null ? `<i class="walk">${icon('walk')}${mins} ${W('分', 'min')}</i>` : ''}</span></button>`;
  };
  const nearby = () => {
    if (!ctx.here) return '';
    // (Still being asked: bars the height of the rows, so nothing moves when they come.)
    const wait = S.stops === null;
    const seen = new Set();
    const buses = (S.stops || [])
      .flatMap(st => st.rows.slice(0, 3).map(r => ({ ...r, dist: st.dist })))
      .sort((a, b) => etaRank(a.v) - etaRank(b.v))
      .filter(x => !seen.has(x.uid) && seen.add(x.uid))
      .slice(0, NEAR_BUSES);
    const rows = wait
      ? ['', ''].map(() => `<div class="ot-strip">${strip({ no: '··', wait: true })}</div>`).join('')
      : buses.map(x => `<div class="ot-strip">${strip({ no: x.route, note: Number.isFinite(x.dist) ? e(distText(x.dist)) : '', main: e(x.stop || ''), eta: busWhen(x.v, null), attrs: `data-route="${e(JSON.stringify({ uid: x.uid, name: x.route, city: x.city, stopUID: x.stopUID, dir: x.dir }))}"` })}</div>`).join('');
    const bikes = (S.bikes || []).length ? `<div class="q-rail ot-bikes">${S.bikes.map(bikeCard).join('')}</div>` : '';
    if (!rows && !bikes) return '';
    return `<section class="ot-shelf">${head(W('附近', 'Nearby'))}${rows ? `<div class="q-rowcard">${rows}</div>` : ''}${bikes}</section>`;
  };

  // ---- drawing ----

  function draw() {
    const html = `${favs()}${sugHtml(candidates())}${recents()}${nearby()}`;
    if (html === last) return;
    last = html;
    const rails = [...box.querySelectorAll('.q-rail')].map(r => r.scrollLeft);
    box.innerHTML = html;
    box.querySelectorAll('.q-rail').forEach((r, i) => (r.scrollLeft = rails[i] || 0));
    kitUI.wireLogos(box);
    fitStrips(box);
  }

  // ---- reading (what 交通 reads too; the kept copies first) ----

  async function readStops() {
    const h = ctx.here;
    if (!h) return;
    try {
      S.stops = await nearStops(h, { n: 3, r: 350 });
    } catch {
      S.stops ||= [];
    }
  }
  async function readPinned() {
    const items = ctx.data.groups.flatMap(g => g.items).map(it => ({ ...it, ...rideNow(it, ctx.here) }));
    if (!items.length) return (S.pinned = new Map());
    try {
      S.pinned = await stopsEta(items);
      S.pinnedAt = Date.now();
    } catch {}
  }
  async function readTrains() {
    try {
      S.trains = await pinnedTrainsNext(ctx);
    } catch {}
  }
  // The shelves' own reads, at most each 20 s; the day's trains a moment later (they are the heaviest, and not what the first look is for).
  let trainsLater = 0;
  let trainsAt = 0;
  let inflight = null;
  async function refresh({ force = false } = {}) {
    // (Nothing around you to read before the phone says where you are: asked again when it does.)
    if (!ctx.here) return draw();
    if (inflight && !force) return inflight;
    if (!force && Date.now() - S.read < FRESH_MS) return draw();
    S.read = Date.now();
    inflight = Promise.allSettled([readStops(), readPinned()]).finally(() => (inflight = null));
    await inflight;
    draw();
    if (ctx.data.pins.length && !trainsLater && Date.now() - trainsAt > 60_000) {
      trainsLater = setTimeout(async () => {
        trainsAt = Date.now();
        await readTrains();
        trainsLater = 0;
        draw();
      }, 1500);
    }
  }

  // ---- taps ----

  box.addEventListener('click', ev => {
    const t = ev.target;
    const fav = t.closest('[data-fav]');
    if (fav) return act.place(ctx.data.places.find(p => p.id === fav.dataset.fav));
    const add = t.closest('[data-fav-add]');
    if (add) return act.add(add.dataset.favAdd);
    const sg = t.closest('[data-sg]');
    if (sg) {
      const x = S.sug.find(y => y.key === sg.dataset.sg);
      if (!x) return;
      // (A bike's own fields kept: the card opens the station itself.)
      if (x.kind === 'bike') return act.bike(S.bikes?.find(b => b.uid === x.uid));
      return act[x.kind === 'home' ? 'place' : x.kind]?.(x.kind === 'home' ? x.place : x);
    }
    const del = t.closest('[data-del-recent]');
    if (del) return act.delRecent(del.dataset.delRecent);
    if (t.closest('[data-more="clear-recents"]')) return act.clearRecents();
    const rec = t.closest('[data-recent]');
    if (rec) return act.recent(ctx.data.trips.find(x => tripKey(x) === rec.dataset.recent));
    const bk = t.closest('[data-bk]');
    if (bk) return act.bike(S.bikes?.find(b => b.uid === bk.dataset.bk));
    const rt = t.closest('[data-route]');
    if (rt) return act.route(JSON.parse(rt.dataset.route));
  });

  return {
    el: box,
    draw,
    refresh,
    // YouBike stations around you, as the map reads them (tab-map's nearBikes): [{ ...station, walk, d }].
    setBikes(rows) {
      S.bikes = rows;
      draw();
    },
    start() {
      if (running) return;
      running = true;
      ticker = setInterval(() => tick(box), 5000);
    },
    stop() {
      running = false;
      clearInterval(ticker);
      clearTimeout(trainsLater);
      trainsLater = 0;
    }
  };
}
