// 附近, one look wherever it shows (地圖's sheet, 交通): the next buses at the
// stops around you, then YouBike's stations. A whole kind stopped (a typhoon
// day: every bus 今日停駛, every station paused) is one calm row that says so,
// not a list of red rows; a tap opens the first one, its notice there.

import { etaRank, said } from './bus.mjs';
import { strip, busWhen } from './bus-ui.mjs';
import { icon } from './ui.mjs';
import { COLOR, tile } from './look.mjs';
import { e, distText, shown } from './util.mjs';
import { W } from '#kit/lang.mjs';

// A read of the stops around you not in by then: the bars give way (to the
// kept copy, or to nothing), the read going on behind and drawn when it
// lands. (The owner, 2026-10-23: 附近 stayed grey bars until a restart; on a
// typhoon day's slow TDX a read took 15 s, was asked again, and the bars
// waited on all of it.)
export const NEAR_WAIT_MS = 5000;
// → whether `p` settled within NEAR_WAIT_MS.
export const inTime = p => Promise.race([p.then(() => true, () => true), new Promise(r => setTimeout(r, NEAR_WAIT_MS, false))]);

// A bus that isn't coming today (今日停駛, or 可能停駛 with none on the road): its flag, else null.
const offFlag = v => {
  const s = v && said(v);
  return s?.status === 4 && s.flag ? s.flag : null;
};
const offRow = ({ glyph, title, sub, attrs }) => `<button class="q-ritem ot-near-off" type="button" ${attrs}>${tile(glyph, COLOR.walk)}<span class="q-ritem-text"><span class="q-ritem-title">${e(title)}</span><small>${e(sub)}</small></span></button>`;
const someOf = names => (names.length > 2 ? W(`${names.slice(0, 2).join('、')} 等 ${names.length} 條`, `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`) : names.join(W('、', ', ')));
const routeAttr = x => `data-route="${e(JSON.stringify({ uid: x.uid, name: x.route, city: x.city, stopUID: x.stopUID, dir: x.dir }))}"`;
const bars = () => ['', ''].map(() => `<div class="ot-strip">${strip({ no: '', wait: true })}</div>`).join('');

// The buses' rows (a .q-rowcard's inside), or ''. `stops`: nearStops' (null: still being asked);
// `skip`: a 'near:stopUID:uid' already shown above; `planned`: stopUID → the timetable's next.
export function nearBusRows(stops, { skip = '', planned = null, max = 4 } = {}) {
  if (stops === null) return bars();
  const seen = new Set();
  const all = stops
    .flatMap(st => st.rows.slice(0, 3).map(r => ({ ...r, dist: st.dist })))
    .sort((a, b) => etaRank(a.v) - etaRank(b.v))
    .filter(x => skip !== `near:${x.stopUID}:${x.uid}` && !seen.has(x.uid) && seen.add(x.uid));
  if (!all.length) return '';
  // (Soonest first: the first one stopped, every one is.)
  if (offFlag(all[0].v)) {
    const firm = all.every(x => offFlag(x.v)?.effect === 'off');
    return offRow({ glyph: 'bus', title: firm ? W('公車今日停駛', 'Buses off today') : W('公車可能停駛', 'Buses likely off'), sub: someOf(all.map(x => x.route)), attrs: routeAttr(all[0]) });
  }
  return all
    .slice(0, max)
    .map(x => `<div class="ot-strip">${strip({ no: x.route, note: Number.isFinite(x.dist) ? e(distText(x.dist)) : '', main: e(shown(x.stop || '')), eta: busWhen(x.v, planned?.get(x.stopUID) || null), attrs: routeAttr(x) })}</div>`)
    .join('');
}

// A station's card: the bikes there big; a paused one says only 暫停, greyed.
// (`walk`: { sec } by the streets, else `d`, metres in a straight line.)
function bikeCard(b) {
  const mins = b.walk ? Math.max(1, Math.round(b.walk.sec / 60)) : null;
  const far = mins != null ? `<i class="walk">${icon('walk')}${mins} ${W('分', 'min')}</i>` : b.d != null ? `<i class="walk">${icon('walk')}${e(distText(b.d))}</i>` : '';
  if (b.ok === false) return `<button class="ot-bk off" type="button" data-bk="${e(b.uid)}"><span class="ot-bk-name">${e(shown(b.name))}</span><span class="ot-bk-n"><b>${W('暫停', 'Paused')}</b></span><span class="ot-bk-f">${far}</span></button>`;
  const lv = b.bikes + b.ebike === 0 ? 'none' : b.bikes + b.ebike <= 3 ? 'few' : 'ok';
  return `<button class="ot-bk ${lv}" type="button" data-bk="${e(b.uid)}"><span class="ot-bk-name">${e(shown(b.name))}</span><span class="ot-bk-n"><b>${b.bikes}</b>${b.ebike ? `<em>${icon('bolt')}${b.ebike}</em>` : ''}</span><span class="ot-bk-f"><i>${icon('dock')}${b.ret}</i>${far}</span></button>`;
}
// YouBike's stations: a rail of cards, or one row when every one is paused; '' when none.
export function nearBikes(list) {
  if (!list?.length) return '';
  if (list.every(b => b.ok === false)) return `<div class="q-rowcard ot-near-bikes">${offRow({ glyph: 'bike', title: W('YouBike 暫停租借', 'YouBike paused'), sub: W(`附近 ${list.length} 站`, `${list.length} stations near you`), attrs: `data-bk="${e(list[0].uid)}"` })}</div>`;
  return `<div class="q-rail ot-bikes">${list.map(bikeCard).join('')}</div>`;
}
