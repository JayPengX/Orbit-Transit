// The metros: each city's system from TDX's own stations, lines and changes
// (drawn as a metro map by metromap.mjs), and a station's board: the next
// trains each way, live where the operator sends it, else from the timetable,
// else how often the line runs; its first and last trains and exits.

import { tdx, rows } from './api.mjs';
import { zh, meters, tw, twAt, TDX_DAYS } from './util.mjs';

import { W, en } from '#kit/lang.mjs';
// The maps, by city; each draws one or more TDX rail systems.
export const MAPS = [
  // box: [south, west, north, east], a little past the farthest station.
  { id: 'taipei', name: W('台北・新北', 'Taipei'), systems: ['TRTC', 'NTMC', 'NTDLRT', 'NTALRT', 'TRTCMG'], box: [24.9, 121.33, 25.22, 121.67] },
  { id: 'taoyuan', name: W('桃園機場捷運', 'Taoyuan Airport'), systems: ['TYMC'], box: [24.93, 121.15, 25.1, 121.46] },
  { id: 'taichung', name: W('台中', 'Taichung'), systems: ['TMRT'], box: [24.1, 120.58, 24.22, 120.7] },
  { id: 'kaohsiung', name: W('高雄', 'Kaohsiung'), systems: ['KRTC', 'KLRT'], box: [22.53, 120.25, 22.8, 120.44] }
];
// The maps whose area a point (or a view [s, w, n, e]) touches.
export const mapsNear = ([s, w, n, e]) => MAPS.filter(m => !(n < m.box[0] || s > m.box[2] || e < m.box[1] || w > m.box[3]));
export const OPERATORS = en
  ? { TRTC: 'Taipei Metro', NTMC: 'New Taipei Metro', NTDLRT: 'Danhai LRT', NTALRT: 'Ankeng LRT', TRTCMG: 'Maokong Gondola', TYMC: 'Taoyuan Metro', TMRT: 'Taichung Metro', KRTC: 'Kaohsiung Metro', KLRT: 'Kaohsiung LRT' }
  : { TRTC: '臺北捷運', NTMC: '新北捷運', NTDLRT: '淡海輕軌', NTALRT: '安坑輕軌', TRTCMG: '貓空纜車', TYMC: '桃園捷運', TMRT: '臺中捷運', KRTC: '高雄捷運', KLRT: '高雄輕軌' };
// Which systems TDX gives a live board for, and a station timetable for.
const LIVE = new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT']);
// Which list their changes between lines (the rest answer an error).
const TRANSFERS = new Set(['TRTC', 'NTMC', 'KRTC']);
const TIMETABLE = new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT', 'NTDLRT', 'NTALRT', 'NTMC']);
// Colours TDX leaves out (貓空纜車 has none, 高雄 often none): by system, or system:line.
const FALLBACK_COLOR = { TRTCMG: '#77bc1f', 'KRTC:R': '#e2211c', 'KRTC:O': '#f8a51b', KLRT: '#7cc24d', TYMC: '#8246af', TMRT: '#8ec31f', NTDLRT: '#e3002c', NTALRT: '#c3b091' };

const DAY = 86_400_000;

// A metro line's colour by its name, for a planner's ride that came without
// one (Google's and TDX's plans often do): the lines loaded so far, else the
// operators' own colours. Longest name first (環狀輕軌 before 環狀).
const LINE_COLORS = new Map([
  ['板南', '#0a59ae'], ['文湖', '#b57a25'], ['松山新店', '#107547'], ['新店', '#107547'], ['中和新蘆', '#f5a818'], ['淡水信義', '#d90023'],
  ['環狀輕軌', '#7cc24d'], ['環狀', '#fedb00'], ['三鶯', '#47c1e1'], ['淡海', '#ff2a00'], ['安坑', '#c3b091'], ['貓空', '#77bc1f'],
  ['機場', '#8246af'], ['烏日文心北屯', '#84bd00'], ['高雄捷運紅', '#e2211c'], ['高雄捷運橘', '#f8a51b'], ['紅線', '#e2211c'], ['橘線', '#f8a51b'],
  ['Bannan', '#0a59ae'], ['Wenhu', '#b57a25'], ['Songshan', '#107547'], ['Zhonghe', '#f5a818'], ['Tamsui', '#d90023'], ['Circular', '#fedb00'], ['Airport', '#8246af']
]);
export function metroColor(name) {
  const n = String(name || '');
  if (!n) return '';
  let best = '';
  for (const [k] of LINE_COLORS) if (n.includes(k) && k.length > best.length) best = k;
  return best ? LINE_COLORS.get(best) : '';
}

// One system's stations and lines: { sys, stations: [{ key, sys, id, name,
// lat, lon, lines: [lineId] }], lines: [{ id, sys, name, color, seq: [key…],
// paths: [[key…]…], branch }] }. `paths` are the operator's routes (each a
// continuous run, a branch included: 南勢角–蘆洲 through 大橋頭), what the map draws.
export async function loadSystem(sys) {
  const [st, of, ln, ro, tr] = await Promise.all([
    tdx(`basic/v2/Rail/Metro/Station/${sys}?$select=StationUID,StationID,StationName,StationPosition,LocationCity`, { fresh: 7 * DAY, persist: true }),
    tdx(`basic/v2/Rail/Metro/StationOfLine/${sys}`, { fresh: 7 * DAY, persist: true }),
    tdx(`basic/v2/Rail/Metro/Line/${sys}`, { fresh: 7 * DAY, persist: true }),
    tdx(`basic/v2/Rail/Metro/StationOfRoute/${sys}?$select=LineID,RouteID,Direction,Stations`, { fresh: 7 * DAY, persist: true }).catch(() => []),
    TRANSFERS.has(sys) ? tdx(`basic/v2/Rail/Metro/LineTransfer/${sys}`, { fresh: 7 * DAY, persist: true }).catch(() => []) : []
  ]);
  return parseSystem(sys, st, of, ln, ro, tr);
}
// Changes TDX leaves out, between systems: 凱旋 and the 輕軌's 前鎮之星, 動物園 and 貓空纜車's.
const MORE_TRANSFERS = [
  ['metro:KRTC:R6', 'metro:KLRT:C3'],
  ['metro:TRTC:BR01', 'metro:TRTCMG:MK01']
];
// `transfers`: [[key, key]…], the operator's own changes (新埔 and 新埔民生 are one).
export function parseSystem(sys, st, of, ln, ro = [], tr = []) {
  const stations = new Map();
  for (const s of rows(st)) {
    const lat = Number(s.StationPosition?.PositionLat);
    const lon = Number(s.StationPosition?.PositionLon);
    if (!Number.isFinite(lat)) continue;
    stations.set(s.StationID, { key: `metro:${sys}:${s.StationID}`, sys: 'metro', op: sys, id: s.StationID, name: zh(s.StationName), lat, lon, lines: [] });
  }
  const meta = new Map(rows(ln).map(l => [l.LineID || l.LineNo, l]));
  const lines = [];
  for (const l of rows(of)) {
    const id = l.LineID || l.LineNo;
    const m = meta.get(id) || {};
    const seq = (l.Stations || []).slice().sort((a, b) => a.Sequence - b.Sequence).map(s => stations.get(s.StationID)).filter(Boolean);
    for (const s of seq) if (!s.lines.includes(id)) s.lines.push(id);
    lines.push({ id, sys, name: zh(m.LineName) || id, color: normColor(m.LineColor) || FALLBACK_COLOR[`${sys}:${id}`] || FALLBACK_COLOR[sys] || '#94a3b8', branch: m.IsBranch === true, seq: seq.map(s => s.key), paths: [] });
    // (Its name kept for a plan's ride: 高雄's 紅線 is its own, not 淡水信義線's red.)
    const bare = (zh(m.LineName) || '').replace(/線$/, '');
    if (bare.length > 1 && normColor(m.LineColor)) LINE_COLORS.set(sys === 'KRTC' ? `高雄捷運${bare}` : bare, normColor(m.LineColor));
  }
  // The routes, one way each (the other way is the same stations backwards).
  const seen = new Set();
  for (const r of rows(ro)) {
    const line = lines.find(l => l.id === r.LineID);
    const path = (r.Stations || []).slice().sort((a, b) => a.Sequence - b.Sequence).map(s => stations.get(s.StationID)?.key).filter(Boolean);
    const sig = [...path].sort().join();
    if (!line || path.length < 2 || seen.has(sig)) continue;
    seen.add(sig);
    line.paths.push(path);
  }
  const transfers = [
    ...rows(tr)
      .filter(t => t.FromStationID !== t.ToStationID)
      .map(t => [`metro:${sys}:${t.FromStationID}`, `metro:${stations.has(t.ToStationID) ? sys : LINE_OP[t.ToLineID] || sys}:${t.ToStationID}`]),
    ...MORE_TRANSFERS.filter(p => p.some(k => k.startsWith(`metro:${sys}:`)))
  ];
  return { sys, stations: [...stations.values()], lines, transfers };
}
// Which system a station in another's list is on, by its line (臺北捷運's 頂埔 changes to 新北's 三鶯線, LB).
const LINE_OP = { LB: 'NTMC', Y: 'NTMC', K: 'NTALRT', V: 'NTDLRT', BL: 'TRTC', BR: 'TRTC', G: 'TRTC', O: 'TRTC', R: 'TRTC' };
const normColor = c => (!c ? '' : c.startsWith('#') ? c : /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : c);

// A line's stations in order, split where it jumps (a branch listed after
// the main line: 蘆洲's after 迴龍), each piece after the first joined to the
// nearest station already drawn on the line (蘆洲線 at 大橋頭).
export function lineRuns(line, byKey) {
  const pts = line.seq.map(k => byKey.get(k)).filter(Boolean);
  const runs = [];
  let run = [];
  for (const s of pts) {
    const prev = run.at(-1);
    if (prev && (meters(prev.lat, prev.lon, s.lat, s.lon) > 4500 || jump(prev.id, s.id))) {
      runs.push(run);
      run = [];
    }
    run.push(s);
  }
  if (run.length) runs.push(run);
  const drawn = [...(runs[0] || [])];
  for (const r of runs.slice(1)) {
    const head = r[0];
    let best = null;
    let bd = Infinity;
    for (const s of drawn) {
      const d = meters(head.lat, head.lon, s.lat, s.lon);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best && bd < 3500) r.unshift(best);
    drawn.push(...r);
  }
  return runs;
}
// 'O21' → 'O50': the numbers jump (a branch), 'BL11' → 'BL12' don't.
function jump(a, b) {
  const ma = /^([A-Z]+)(\d+)/.exec(a || '');
  const mb = /^([A-Z]+)(\d+)/.exec(b || '');
  if (!ma || !mb || ma[1] !== mb[1]) return false;
  return Math.abs(Number(mb[2]) - Number(ma[2])) > 5;
}

// ---- The drawing ------------------------------------------------------------------------------

// Stations at the same place on different lines (or systems) are one
// interchange: within 250 m and the same name, or within 80 m.
// So are the operators' own changes (`transfers`: [[key, key]…]: 新埔 and 新埔民生).
export function interchanges(stations, transfers = []) {
  const bare = n => String(n).replace(/站$/, '');
  const linked = new Set(transfers.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const groups = [];
  for (const s of stations) {
    const hits = groups.filter(g => g.some(x => linked.has(`${x.key}|${s.key}`) || (bare(x.name) === bare(s.name) && meters(x.lat, x.lon, s.lat, s.lon) < 250) || meters(x.lat, x.lon, s.lat, s.lon) < 80));
    // (One group, even when a station joins two that were apart.)
    const g = hits.shift() || (groups.push([]), groups.at(-1));
    for (const h of hits) {
      g.push(...h);
      groups.splice(groups.indexOf(h), 1);
    }
    g.push(s);
  }
  return groups;
}

// ---- A station's board --------------------------------------------------------------------------

// Live: [{ dest, min, status, line }] for the station (and the same station
// on other lines when it's an interchange).
export async function liveBoard(st) {
  if (!LIVE.has(st.op)) return null;
  const j = await tdx(`basic/v2/Rail/Metro/LiveBoard/${st.op}?$filter=StationID eq '${st.id}'`, { fresh: 'live' });
  return rows(j).map(r => ({ dest: zh(r.DestinationStationName) || r.TripHeadSign || '', min: r.EstimateTime == null ? null : Number(r.EstimateTime), status: Number(r.ServiceStatus) || 0, line: r.LineID || r.LineNO || '' }));
}

// A station's timetable rows (TDX's), or null where the operator has none.
async function timetable(st) {
  if (!TIMETABLE.has(st.op)) return null;
  return rows(await tdx(`basic/v2/Rail/Metro/StationTimeTable/${st.op}?$filter=StationID eq '${st.id}'`, { fresh: DAY, persist: true }));
}

// The first and last train each way on the service day running now (04:00
// to 04:00): [{ line, dest, first, last }] (ms), a row a line and way, named by
// where most of its trains go (板南線's to 頂埔, not the few to 亞東醫院).
export function firstLast(list, now = Date.now()) {
  const t = serviceDay(now);
  const out = new Map();
  for (const r of list) {
    if (r.ServiceDay && r.ServiceDay[TDX_DAYS[t.dow]] === false) continue;
    const times = (r.Timetables || []).map(x => x.DepartureTime || x.ArrivalTime).filter(Boolean).map(hhmm => at(t, hhmm));
    if (!times.length) continue;
    const k = `${r.LineID || ''}:${r.Direction}`;
    const o = out.get(k) || { line: r.LineID || '', dest: '', first: Infinity, last: -Infinity, most: 0 };
    o.first = Math.min(o.first, ...times);
    o.last = Math.max(o.last, ...times);
    if (times.length > o.most) [o.most, o.dest] = [times.length, zh(r.DestinationStationName)];
    out.set(k, o);
  }
  return [...out.values()].map(({ most, ...o }) => o);
}
const serviceDay = now => (tw(now).min < 240 ? tw(now - DAY) : tw(now));
const at = (t, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return twAt(t.date, `${h < 4 ? h + 24 : h}:${m}`);
};

// A line with no timetable (文湖線, 台中捷運): how often it runs now, and its
// hours, from the operator's frequencies: { min, max, first, last } or null.
export function frequency(list, line, now = Date.now()) {
  const t = serviceDay(now);
  const r = list.find(x => x.LineID === line && !(x.ServiceDay && x.ServiceDay[TDX_DAYS[t.dow]] === false)) || list.find(x => x.LineID === line);
  if (!r) return null;
  const nowMin = tw(now).min < 240 ? tw(now).min + 1440 : tw(now).min;
  const mins = hhmm => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h < 4 ? h + 24 : h) * 60 + m;
  };
  const h = (r.Headways || []).find(x => mins(x.StartTime) <= nowMin && nowMin < (mins(x.EndTime) || 1440) + (mins(x.EndTime) <= mins(x.StartTime) ? 1440 : 0));
  const op = r.OperationTime || {};
  return { min: h ? Number(h.MinHeadwayMins) : null, max: h ? Number(h.MaxHeadwayMins) : null, first: op.StartTime ? at(t, op.StartTime) : null, last: op.EndTime ? at(t, op.EndTime === '24:00' ? '00:00' : op.EndTime) : null };
}
// (Which systems TDX has headways and station-to-station times for; it refuses the rest.)
const FREQUENCY = new Set(['TRTC', 'KRTC', 'TYMC', 'TMRT', 'NTMC']);
export const S2S = new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT', 'TMRT', 'NTMC']);
export const frequencies = op => (FREQUENCY.has(op) ? tdx(`basic/v2/Rail/Metro/Frequency/${op}`, { fresh: DAY, persist: true }).then(rows) : Promise.resolve([]));

// A station's board, live and timetable together: for each line and way,
// the next trains (live minutes first where the operator sends them),
// [{ line, dest, times: [ms…], live, note, every }], and the day's first and
// last trains. A line with neither: how often it runs (`every`: '4–10').
export async function stationBoard(st, now = Date.now()) {
  const [board, list] = await Promise.all([liveBoard(st).catch(() => null), timetable(st).catch(() => null)]);
  const next = list ? upcoming(list, now, 3) : [];
  const rowsOut = next.map(r => ({ line: r.line, dest: r.dest, times: r.times, live: false, note: '' }));
  for (const b of board || []) {
    if (!b.dest) continue;
    let r = rowsOut.find(x => x.dest === b.dest && (!b.line || !x.line || x.line === b.line));
    if (!r) rowsOut.push((r = { line: b.line, dest: b.dest, times: [], live: false, note: '' }));
    if (b.status === 3) r.note = W('末班車已過', 'Last train gone');
    else if (b.status === 4) r.note = W('今日未營運', 'Not running today');
    if (b.min == null || b.status >= 3) continue;
    const t = now + b.min * 60_000;
    r.times = [t, ...r.times.filter(x => x > t + 60_000)].slice(0, 3);
    r.live = true;
  }
  const fl = list ? firstLast(list, now) : [];
  // Its lines with no trains listed: their frequency, toward both ends.
  const bare = (st.lines || []).filter(l => !rowsOut.some(r => r.line === l));
  if (bare.length) {
    const [freq, sys] = await Promise.all([frequencies(st.op).catch(() => []), loadSystem(st.op).catch(() => null)]);
    for (const l of bare) {
      const f = frequency(freq, l, now);
      if (!f) continue;
      const seq = sys?.lines.find(x => x.id === l)?.seq || [];
      const name = k => sys?.stations.find(x => x.key === k)?.name || '';
      const ends = [name(seq[0]), name(seq.at(-1))].filter(n => n && n !== st.name);
      const running = f.first != null && f.last != null && now >= f.first && now <= f.last && f.min != null;
      rowsOut.push({ line: l, dest: ends.join('・'), times: [], live: false, note: running ? '' : W('現在沒有營運', 'Not running now'), every: running ? (f.max && f.max !== f.min ? `${f.min}–${f.max}` : String(f.min)) : '' });
      if (f.first != null && !fl.some(x => x.line === l)) fl.push({ line: l, dest: ends.join('・'), first: f.first, last: f.last });
    }
  }
  rowsOut.sort((a, b) => a.line.localeCompare(b.line) || (a.times[0] ?? Infinity) - (b.times[0] ?? Infinity));
  return { op: st.op, id: st.id, rows: rowsOut, firstLast: fl, none: !rowsOut.length };
}

// A station's exits: [{ id, desc, lift, escalator, lat, lon }].
export async function stationExits(st) {
  const j = await tdx(`basic/v2/Rail/Metro/StationExit/${st.op}`, { fresh: 7 * DAY, persist: true });
  return rows(j)
    .filter(x => x.StationID === st.id)
    .map(x => ({ id: String(x.ExitID || '').replace(/^.*出口/, ''), desc: String(x.LocationDescription || '').trim(), lift: x.Elevator === true, escalator: Number(x.Escalator) > 0, lat: Number(x.ExitPosition?.PositionLat), lon: Number(x.ExitPosition?.PositionLon) }))
    .sort((a, b) => a.id.localeCompare(b.id, 'zh-Hant', { numeric: true }));
}

// The live trains across a system now: [{ line, at: station key, dest: station key, min }].
export async function liveTrains(sys) {
  if (!LIVE.has(sys)) return [];
  const j = await tdx(`basic/v2/Rail/Metro/LiveBoard/${sys}`, { fresh: 'live' });
  return rows(j)
    .filter(r => r.EstimateTime != null && Number(r.EstimateTime) <= 1 && (Number(r.ServiceStatus) || 0) < 3 && r.DestinationStationID)
    .map(r => ({ line: r.LineID || r.LineNO || '', at: `metro:${sys}:${r.StationID}`, dest: `metro:${sys}:${r.DestinationStationID}`, min: Number(r.EstimateTime) }));
}
export function upcoming(list, now = Date.now(), n = 4) {
  // After midnight belongs to the day before (00:30 is tonight's last train):
  // before 04:00, the night that began yesterday (its own service day) and today's first trains.
  const days = [tw(now), ...(tw(now).min < 240 ? [tw(now - 86_400_000)] : [])];
  const out = [];
  for (const r of list) {
    const times = days
      .filter(t => !(r.ServiceDay && r.ServiceDay[TDX_DAYS[t.dow]] === false))
      .flatMap(t =>
        (r.Timetables || [])
          .map(x => x.DepartureTime || x.ArrivalTime)
          .filter(Boolean)
          .map(hhmm => {
            const [h, m] = hhmm.split(':').map(Number);
            return twAt(t.date, `${h < 4 ? h + 24 : h}:${m}`);
          })
      )
      .filter(x => x >= now - 30_000)
      .sort((a, b) => a - b)
      .slice(0, n);
    if (times.length) out.push({ dest: zh(r.DestinationStationName), times, line: r.LineID || '', dir: r.Direction });
  }
  // One row per destination.
  const seen = new Map();
  for (const r of out) {
    const k = `${r.line}:${r.dest}`;
    if (!seen.has(k)) seen.set(k, r);
    else seen.get(k).times = [...seen.get(k).times, ...r.times].sort((a, b) => a - b).slice(0, n);
  }
  return [...seen.values()];
}

// 「市政府站」, but 「台北車站」 (the name already says it).
export const stationTitle = name => (/站$/.test(name) ? name : `${name}站`);

// A metro ride's stations in order, from where it boards to where it gets
// off (the map's stops on its line, as a bus's and a train's): its line by
// name first, else any line through both, each end the line's station
// within 400 m of it. → { stops: [{ name, lat, lon }], i, j } or null.
export async function metroStops(l, { load = loadSystem } = {}) {
  if (l?.from?.lat == null || l?.to?.lat == null) return null;
  const maps = mapsNear([l.from.lat, l.from.lon, l.from.lat, l.from.lon]);
  const systems = (await Promise.all(maps.flatMap(m => m.systems).map(sys => load(sys).catch(() => null)))).filter(Boolean);
  const name = String(l.short || l.name || '');
  let best = null;
  for (const sys of systems) {
    const byKey = new Map(sys.stations.map(s => [s.key, s]));
    for (const line of sys.lines) {
      for (const seq of [line.seq, ...line.paths]) {
        const pts = seq.map(k => byKey.get(k)).filter(Boolean);
        const at = pt => {
          let k = -1;
          let bd = 400;
          pts.forEach((s, x) => {
            const d = meters(pt.lat, pt.lon, s.lat, s.lon);
            if (d < bd) [k, bd] = [x, d];
          });
          return k;
        };
        const a = at(l.from);
        const b = at(l.to);
        if (a < 0 || b < 0 || a === b) continue;
        const run = (a < b ? pts.slice(a, b + 1) : pts.slice(b, a + 1).reverse()).map(s => ({ name: s.name, lat: s.lat, lon: s.lon }));
        // (Its own line by name first; then the fewest stations: a branch's way, not round the main line.)
        const score = (name && (name.includes(line.name) || line.name.includes(name)) ? 0 : 1000) + run.length;
        if (!best || score < best.score) best = { score, run };
      }
    }
  }
  return best ? { stops: best.run, i: 0, j: best.run.length - 1 } : null;
}
