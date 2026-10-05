// Rivers whose bridges are built for cars: a YouBike ride across one goes
// over a long, busy bridge with the traffic (頭前溪 between 竹北 and 新竹,
// 鳳山溪 north of 竹北), which nobody chooses when a station on their own
// side does. Their courses, simplified from OpenStreetMap ([lat, lon]).
// Another river: add its course the same way.
export const RIVERS = {"頭前溪":[[[24.854,120.9303],[24.8312,120.9589],[24.8223,120.9996],[24.8006,121.029],[24.7945,121.0471],[24.7853,121.0593],[24.7609,121.074],[24.7503,121.0895],[24.7398,121.0964],[24.7156,121.1329],[24.7149,121.1414],[24.7065,121.1467],[24.712,121.1652],[24.7005,121.1874],[24.6978,121.1879],[24.6978,121.1957],[24.7236,121.2199],[24.7251,121.2361],[24.7328,121.2456],[24.7332,121.2467],[24.7335,121.248],[24.7333,121.2525],[24.7409,121.2558],[24.7496,121.2719],[24.7502,121.2867],[24.7407,121.299]],[[24.7183,121.301],[24.7209,121.2834],[24.7186,121.2696],[24.7267,121.261],[24.733,121.2462]]],"鳳山溪":[[[24.854,120.9303],[24.8587,120.9492],[24.8521,120.9602],[24.8576,120.9662],[24.849,121.0217],[24.8293,121.0449],[24.8294,121.0629],[24.821,121.0724],[24.8155,121.0957],[24.8173,121.1014],[24.8145,121.1209],[24.8066,121.1277],[24.8096,121.1352],[24.8001,121.148],[24.799,121.1616],[24.7934,121.1626],[24.7915,121.1705],[24.7869,121.1719],[24.7847,121.1767],[24.7753,121.1735],[24.7713,121.1768],[24.7743,121.1794],[24.769,121.1834],[24.7682,121.194],[24.7729,121.1955],[24.772,121.1986],[24.7762,121.2015],[24.7676,121.2192],[24.7758,121.2366],[24.7793,121.2553],[24.7709,121.2657],[24.7643,121.2834],[24.7654,121.2897]]]};

// Each river's bridges a bike or a walk can take, from OpenStreetMap
// ([name, lat, lon, kind]): 'path' a bike path's (or one along the bridge),
// 'small' a local road's, 'road' a main road's with no bike lane (經國大橋,
// 竹林大橋: in the traffic). Expressways aren't here. A river with none
// listed counts every crossing as a main road's.
export const BRIDGES = {
  頭前溪: [
    ['竹港大橋', 24.8476, 120.9387, 'road'],
    ['舊港大橋', 24.8428, 120.9413, 'small'],
    ['頭前溪自行車道', 24.8308, 120.9577, 'path'],
    ['舊社大橋', 24.8271, 120.9802, 'small'],
    ['頭前溪橋', 24.8226, 120.9964, 'path'],
    ['經國大橋', 24.809, 121.0199, 'road'],
    ['興隆大橋', 24.7994, 121.0375, 'small'],
    ['中正大橋', 24.7861, 121.0584, 'small'],
    ['新中正橋', 24.7755, 121.0657, 'small'],
    ['竹林大橋', 24.747, 121.0926, 'road']
  ]
};
// The bridges a ride (or a walk) from a to b takes over each river it
// crosses: [{ river, name, kind, extra }], `extra` the metres round to it
// (added to the ride's length: its time is the real one). Each the bridge
// best for it: a main road's in the traffic is what few take (經國大橋 from
// 千甲), a small one a little cost (竹中's, to 竹北), the way round counted
// three times its minutes (it lengthens a ride that's already long).
export const BRIDGE_COST = { path: 4, small: 8, road: 35 };
const M_PER_DEG = 111_000;
const dist = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180)) * M_PER_DEG;
// (`direct`: the bridge nearest the way, for a planner's leg timed by the
// roads: it went over that one.)
export function bridgesFor(a, b, mode = 'bike', { direct = false } = {}) {
  if (a?.lat == null || b?.lat == null) return [];
  const A = [a.lat, a.lon];
  const B = [b.lat, b.lon];
  const perMin = mode === 'bike' ? 250 : 75;
  const straight = dist(A, B);
  return crossed(a, b).map(river => {
    const list = BRIDGES[river] || [];
    if (!list.length) return { river, name: '', kind: 'road', extra: 0 };
    const ways = list.map(([name, lat, lon, kind]) => ({ river, name, kind, extra: Math.max(0, dist(A, [lat, lon]) + dist([lat, lon], B) - straight) }));
    const by = w => (direct ? w.extra : BRIDGE_COST[w.kind] + (3 * w.extra) / perMin);
    return ways.reduce((x, y) => (by(y) < by(x) ? y : x));
  });
}
// The metres round to the bridges, and what crossing by them costs a plan (in its score's minutes).
export const bridgeExtra = (a, b, mode) => bridgesFor(a, b, mode).reduce((t, x) => t + x.extra, 0);
// (`timed`: ours, its time with the way round to the bridge it chose; a
// planner's leg is timed by the roads, over the bridge nearest its way.)
export const crossingCost = (a, b, mode, timed = false) => bridgesFor(a, b, mode, { direct: !timed }).reduce((t, x) => t + BRIDGE_COST[x.kind], 0);

const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
// The rivers the straight line from a to b crosses (a name once per crossing).
export function crossed(a, b) {
  if (a?.lat == null || b?.lat == null) return [];
  const [p, q] = [[a.lat, a.lon], [b.lat, b.lon]];
  const out = [];
  for (const [name, lines] of Object.entries(RIVERS))
    for (const c of lines)
      for (let i = 0; i + 1 < c.length; i++) if (side(p, q, c[i]) * side(p, q, c[i + 1]) < 0 && side(c[i], c[i + 1], p) * side(c[i], c[i + 1], q) < 0) out.push(name);
  return out;
}
export const crossings = (a, b) => crossed(a, b).length;
