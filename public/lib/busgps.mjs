// A route's buses where their GPS says, when TDX's arrival estimates lag.
// Some operators send estimates only every few minutes (快捷8號's were 4 to
// 12 minutes old on 2026-11-03, once frozen 8 minutes: 進站中 at 富貴街口
// with the bus 5 minutes on, and the owner took the wrong bus), while their
// buses' GPS (TDX RealTimeByFrequency, A1) is never a minute old. The last
// estimates still say how long the bus takes from stop to stop; the GPS says
// where it is now, measured along the route's own line (its TDX shape: a
// straight line between stops misplaced a bus on a bending road): each stop's
// time is counted again from there.

const FIX_FRESH = 120_000; // a GPS fix this young places the bus
const OFF = 150; // m: a fix or a stop this far off the line at most
const AT = 40; // m: standing at the stop
const KX = 101_000;
const KY = 111_000;

// A line ([[lat, lon]…]) measured: each point's metres from its start.
export function measure(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot((line[i][0] - line[i - 1][0]) * KY, (line[i][1] - line[i - 1][1]) * KX));
  return { line, cum };
}
// A point's metres along a measured line, from `min` metres on (a stop after
// the one before it; a bus no further back than its estimates had it):
// { m, off } at the nearest place on the line, or null.
export function along(L, p, min = 0) {
  let best = null;
  for (let i = 0; i + 1 < L.line.length; i++) {
    if (L.cum[i + 1] < min) continue;
    const [a, b] = [L.line[i], L.line[i + 1]];
    const [ax, ay, bx, by, px, py] = [a[1] * KX, a[0] * KY, b[1] * KX, b[0] * KY, p.lon * KX, p.lat * KY];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    const m0 = L.cum[i] + t * (L.cum[i + 1] - L.cum[i]);
    if (m0 < min) t = Math.min(1, (min - L.cum[i]) / Math.max(1e-9, L.cum[i + 1] - L.cum[i]));
    const off = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (!best || off < best.off - 1) best = { m: L.cum[i] + t * (L.cum[i + 1] - L.cum[i]), off };
  }
  return best;
}
// A way's stops along its line, each after the one before: [metres…], or
// null when the stops don't lie on it (another branch's line).
export function stopsAlong(L, stops) {
  const out = [];
  let min = 0;
  for (const s of stops) {
    const a = along(L, s, min);
    if (!a || a.off > OFF) return null;
    out.push(a.m);
    min = a.m;
  }
  return out;
}

// rows: TDX EstimatedTimeOfArrival rows; buses: its RealTimeByFrequency rows;
// way: { dir, stops: [{ uid, lat, lon }] }; lines: the route's shape that
// way, in pieces ([[lat, lon]…]…). → the rows, a lagging bus's mended: each
// stop from the one it comes to timed from its fix, the stops it has passed
// without a time; DataTime its fix's. Unchanged with no line its stops lie on.
export function gpsFix(rows, buses, way, lines, now = Date.now()) {
  if (!rows?.length || !buses?.length || !way?.stops?.length || !lines?.length) return rows;
  let L = null;
  let at = null;
  for (const line of lines) {
    if (line.length < 2) continue;
    const m = measure(line);
    const s = stopsAlong(m, way.stops);
    if (s) [L, at] = [m, s];
    if (L) break;
  }
  if (!L) return rows;
  const dir = Number(way.dir) || 0;
  const idx = new Map(way.stops.map((s, k) => [s.uid, k]));
  const fixes = new Map();
  for (const b of buses) {
    if ((Number(b.Direction) || 0) !== dir || !b.PlateNumb || b.PlateNumb === '-1') continue;
    const t = Date.parse(b.GPSTime || '');
    const lat = Number(b.BusPosition?.PositionLat);
    const lon = Number(b.BusPosition?.PositionLon);
    if (!Number.isFinite(t) || now - t > FIX_FRESH || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    fixes.set(b.PlateNumb, { t, lat, lon });
  }
  if (!fixes.size) return rows;
  const byPlate = new Map();
  rows.forEach((r, i) => {
    if ((Number(r.Direction) || 0) !== dir || r.EstimateTime == null || Number(r.StopStatus) || !fixes.has(r.PlateNumb)) return;
    const k = idx.get(r.StopUID);
    if (k == null) return;
    if (!byPlate.has(r.PlateNumb)) byPlate.set(r.PlateNumb, []);
    byPlate.get(r.PlateNumb).push({ k, i, e: Number(r.EstimateTime), made: Date.parse(r.DataTime || '') });
  });
  const out = rows.slice();
  for (const [plate, list] of byPlate) {
    const f = fixes.get(plate);
    const made = Math.max(...list.map(x => x.made));
    // (An estimate as new as the fix needs nothing.)
    if (!Number.isFinite(made) || f.t - made < 60_000) continue;
    list.sort((a, b) => a.k - b.k);
    const est = new Map(list.map(x => [x.k, x.e]));
    // Where it is on the line: no further back than the stop before where the estimates had it.
    const from = list[0].k > 0 ? at[list[0].k - 1] : 0;
    const p = along(L, f, Math.max(0, from - AT));
    if (!p || p.off > OFF) continue;
    // The stop it comes to (standing at one: that one).
    let next = at.findIndex(m => m >= p.m - AT);
    if (next < 0 || !est.has(next)) continue;
    // Its pace there from the estimates (the stretch before the stop, else after).
    const pace = (a, b) => (est.has(a) && est.has(b) && at[b] > at[a] && est.get(b) > est.get(a) ? (est.get(b) - est.get(a)) / (at[b] - at[a]) : null);
    const sPerM = pace(next - 1, next) ?? pace(next, next + 1) ?? 60 / 250;
    const toNext = Math.max(0, at[next] - p.m) * sPerM;
    const e0 = est.get(next);
    const when = new Date(f.t).toISOString();
    for (const x of list) {
      const r = { ...rows[x.i], DataTime: when, GpsMended: true };
      if (x.k < next) Object.assign(r, { EstimateTime: null, Estimates: [] });
      else r.EstimateTime = Math.round(toNext + x.e - e0);
      out[x.i] = r;
    }
  }
  return out;
}
