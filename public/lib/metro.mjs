// The metros: each city's system from TDX's own stations and lines (drawn
// on the real map by tab-metro.mjs), and a station's board: the next trains each way, live where the
// operator sends it, else from the timetable.

import { tdx, rows } from './api.mjs';
import { zh, meters, tw } from './util.mjs';

// The maps, by city; each draws one or more TDX rail systems.
export const MAPS = [
  // box: [south, west, north, east], a little past the farthest station.
  { id: 'taipei', name: '台北・新北', systems: ['TRTC', 'NTMC', 'NTDLRT', 'NTALRT', 'TRTCMG'], box: [24.9, 121.33, 25.22, 121.67] },
  { id: 'taoyuan', name: '桃園機場捷運', systems: ['TYMC'], box: [24.93, 121.15, 25.1, 121.46] },
  { id: 'taichung', name: '台中', systems: ['TMRT'], box: [24.1, 120.58, 24.22, 120.7] },
  { id: 'kaohsiung', name: '高雄', systems: ['KRTC', 'KLRT'], box: [22.53, 120.25, 22.8, 120.44] }
];
// The maps whose area a point (or a view [s, w, n, e]) touches.
export const mapsNear = ([s, w, n, e]) => MAPS.filter(m => !(n < m.box[0] || s > m.box[2] || e < m.box[1] || w > m.box[3]));
export const OPERATORS = { TRTC: '臺北捷運', NTMC: '新北捷運', NTDLRT: '淡海輕軌', NTALRT: '安坑輕軌', TRTCMG: '貓空纜車', TYMC: '桃園捷運', TMRT: '臺中捷運', KRTC: '高雄捷運', KLRT: '高雄輕軌' };
// Which systems TDX gives a live board for, and a station timetable for.
export const LIVE = new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT']);
export const TIMETABLE = new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT', 'NTDLRT', 'NTALRT', 'NTMC']);
// Colours TDX leaves out (貓空纜車 has none, 高雄 often none): by system, or system:line.
const FALLBACK_COLOR = { TRTCMG: '#77bc1f', 'KRTC:R': '#e2211c', 'KRTC:O': '#f8a51b', KLRT: '#7cc24d', TYMC: '#8246af', TMRT: '#8ec31f', NTDLRT: '#e3002c', NTALRT: '#c3b091' };

const DAY = 86_400_000;

// One system's stations and lines: { sys, stations: [{ key, sys, id, name,
// lat, lon, lines: [lineId] }], lines: [{ id, sys, name, color, seq: [key…],
// paths: [[key…]…], branch }] }. `paths` are the operator's routes (each a
// continuous run, a branch included: 南勢角–蘆洲 through 大橋頭), what the map draws.
export async function loadSystem(sys) {
  const [st, of, ln, ro] = await Promise.all([
    tdx(`basic/v2/Rail/Metro/Station/${sys}?$select=StationUID,StationID,StationName,StationPosition,LocationCity`, { fresh: 7 * DAY, persist: true }),
    tdx(`basic/v2/Rail/Metro/StationOfLine/${sys}`, { fresh: 7 * DAY, persist: true }),
    tdx(`basic/v2/Rail/Metro/Line/${sys}`, { fresh: 7 * DAY, persist: true }),
    tdx(`basic/v2/Rail/Metro/StationOfRoute/${sys}?$select=LineID,RouteID,Direction,Stations`, { fresh: 7 * DAY, persist: true }).catch(() => [])
  ]);
  return parseSystem(sys, st, of, ln, ro);
}
export function parseSystem(sys, st, of, ln, ro = []) {
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
  return { sys, stations: [...stations.values()], lines };
}
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
export function interchanges(stations) {
  const groups = [];
  for (const s of stations) {
    const g = groups.find(g => g.some(x => (x.name === s.name && meters(x.lat, x.lon, s.lat, s.lon) < 250) || meters(x.lat, x.lon, s.lat, s.lon) < 80));
    if (g) g.push(s);
    else groups.push([s]);
  }
  return groups;
}

// ---- A station's board --------------------------------------------------------------------------

// Live: [{ dest, min, status, line }] for the station (and the same station
// on other lines when it's an interchange).
export async function liveBoard(st) {
  if (!LIVE.has(st.op)) return null;
  const j = await tdx(`basic/v2/Rail/Metro/LiveBoard/${st.op}?$filter=StationID eq '${st.id}'`, { fresh: 20_000 });
  return rows(j).map(r => ({ dest: zh(r.DestinationStationName) || r.TripHeadSign || '', min: r.EstimateTime == null ? null : Number(r.EstimateTime), status: Number(r.ServiceStatus) || 0, line: r.LineID || r.LineNO || '' }));
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// From the timetable: the next departures each way, [{ dest, times: [ms…], line }].
export async function nextTrains(st, now = Date.now(), n = 4) {
  if (!TIMETABLE.has(st.op)) return null;
  const j = await tdx(`basic/v2/Rail/Metro/StationTimeTable/${st.op}?$filter=StationID eq '${st.id}'`, { fresh: DAY, persist: true });
  return upcoming(rows(j), now, n);
}
export function upcoming(list, now = Date.now(), n = 4) {
  const t = tw(now);
  const day = DOW[t.dow];
  const out = [];
  for (const r of list) {
    if (r.ServiceDay && r.ServiceDay[day] === false) continue;
    const times = (r.Timetables || [])
      .map(x => x.DepartureTime || x.ArrivalTime)
      .filter(Boolean)
      .map(hhmm => {
        const [h, m] = hhmm.split(':').map(Number);
        // After midnight belongs to the day before (00:30 is tonight's last train).
        const mins = (h < 4 ? h + 24 : h) * 60 + m;
        return Date.parse(`${t.date}T00:00:00+08:00`) + mins * 60_000;
      })
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
