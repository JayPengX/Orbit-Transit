// The metros: each city's system drawn as one big map from TDX's own
// stations and lines (where they really are, so it lines up with the
// streets), and a station's board: the next trains each way, live where the
// operator sends it, else from the timetable.

import { tdx, rows } from './api.mjs';
import { zh, meters, tw, e } from './util.mjs';

// The maps, by city; each draws one or more TDX rail systems.
export const MAPS = [
  { id: 'taipei', name: '台北・新北', systems: ['TRTC', 'NTMC', 'NTDLRT', 'NTALRT', 'TRTCMG'] },
  { id: 'taoyuan', name: '桃園機場捷運', systems: ['TYMC'] },
  { id: 'taichung', name: '台中', systems: ['TMRT'] },
  { id: 'kaohsiung', name: '高雄', systems: ['KRTC', 'KLRT'] }
];
export const OPERATORS = { TRTC: '臺北捷運', NTMC: '新北捷運', NTDLRT: '淡海輕軌', NTALRT: '安坑輕軌', TRTCMG: '貓空纜車', TYMC: '桃園捷運', TMRT: '臺中捷運', KRTC: '高雄捷運', KLRT: '高雄輕軌' };
// Which systems TDX gives a live board for, and a station timetable for.
export const LIVE = new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT']);
export const TIMETABLE = new Set(['TRTC', 'KRTC', 'TYMC', 'KLRT', 'NTDLRT', 'NTALRT', 'NTMC']);
// Colours TDX leaves out (貓空纜車 has none).
const FALLBACK_COLOR = { TRTCMG: '#77bc1f' };

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
    lines.push({ id, sys, name: zh(m.LineName) || id, color: normColor(m.LineColor) || FALLBACK_COLOR[sys] || '#94a3b8', branch: m.IsBranch === true, seq: seq.map(s => s.key), paths: [] });
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

// The map as SVG: lines as thick coloured strokes, a dot per station, a
// white ring per interchange, names beside them. Fitted to W × H.
export function mapSvg(systems, { W = 1000, H = 1000, pad = 60 } = {}) {
  const stations = systems.flatMap(s => s.stations);
  const lines = systems.flatMap(s => s.lines);
  if (!stations.length) return { svg: '', points: new Map() };
  const lat0 = stations.reduce((a, s) => a + s.lat, 0) / stations.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = stations.map(s => s.lon * kx);
  const ys = stations.map(s => -s.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1));
  const ox = (W - (x1 - x0) * scale) / 2;
  const oy = (H - (y1 - y0) * scale) / 2;
  const P = s => [ox + (s.lon * kx - x0) * scale, oy + (-s.lat - y0) * scale];
  const byKey = new Map(stations.map(s => [s.key, s]));
  const points = new Map(stations.map(s => [s.key, P(s)]));
  const f = n => n.toFixed(1);
  const paths = lines
    .map(l =>
      (l.paths?.length ? l.paths.map(p => p.map(k => byKey.get(k)).filter(Boolean)) : lineRuns(l, byKey))
        .filter(r => r.length > 1)
        .map(r => `<path d="M${r.map(s => points.get(s.key).map(f).join(' ')).join(' L')}" stroke="${e(l.color)}" class="mt-line" data-line="${e(l.id)}"/>`)
        .join('')
    )
    .join('');
  const colorOf = new Map(lines.flatMap(l => l.seq.map(k => [k, l.color])));
  const groups = interchanges(stations);
  const dots = groups
    .map(g => {
      const [x, y] = g.map(s => points.get(s.key)).reduce((a, p) => [a[0] + p[0] / g.length, a[1] + p[1] / g.length], [0, 0]);
      const big = g.length > 1 || g[0].lines.length > 1;
      const s = g[0];
      const label = `<text x="${big ? 10 : 8}" y="4" class="mt-name${big ? ' big' : ''}">${e(s.name)}</text>`;
      // Placed by CSS (translate, then scaled back by 1/zoom): the same size on screen at any zoom.
      return `<g class="mt-st${big ? ' x' : ''}" data-st="${e(g.map(x => x.key).join(','))}" style="--x:${f(x)}px;--y:${f(y)}px"><circle r="15" class="mt-hit"/><circle r="${big ? 6.5 : 4.5}" class="mt-dot" stroke="${e(big ? '#0a0b0f' : colorOf.get(s.key) || '#fff')}"/>${label}</g>`;
    })
    .join('');
  return { svg: `<svg viewBox="0 0 ${W} ${H}" class="mt-svg" xmlns="http://www.w3.org/2000/svg"><g class="mt-zoom"><g class="mt-lines">${paths}</g><g class="mt-dots">${dots}</g></g></svg>`, points };
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
