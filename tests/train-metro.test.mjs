// A train into a metro's area goes on by the metro (Jay 2026-11-06, home in
// 竹北 to 台北101 at 22:06: recommended was a YouBike to 六家, 高鐵 0690 to
// 板橋, 區間 2254 to 松山 and a 14-minute YouBike; "we can just go HSR to
// Taipei then Metro"). Our router's trains end at a 台鐵 or 高鐵 station;
// each one's stops in the area are now a way on by the metro too, ranked
// with the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { network } from '../public/lib/rail.mjs';
import { rank, finish, trainLeg } from '../public/lib/plan.mjs';
import { trainThenMetro } from '../public/lib/planner.mjs';
import { metroMapAt } from '../public/lib/metroroute.mjs';

const T = (h, m) => Date.UTC(2026, 10, 6, h - 8, m);
const st = (key, name, lat, lon) => ({ key, sys: key.split(':')[0], id: key.split(':')[1], name, lat, lon });
const stations = [
  st('hsr:1030', '新竹', 24.8081, 121.0403),
  st('hsr:1020', '板橋', 25.0143, 121.4635),
  st('hsr:1010', '台北', 25.0477, 121.5173),
  st('hsr:0990', '南港', 25.0531, 121.6071),
  st('tra:1020', '板橋', 25.0143, 121.4635),
  st('tra:0990', '松山', 25.0494, 121.5779)
];
const trip = (sys, no, stops) => ({ id: `${sys}:2026-11-06:${no}`, sys, no, code: sys === 'hsr' ? 'hsr' : '6', type: sys === 'hsr' ? '高鐵' : '區間', stops: stops.map(([s, h, m]) => ({ st: s, arr: T(h, m), dep: T(h, m) })) });
const hsr = trip('hsr', '0690', [['hsr:1030', 22, 27], ['hsr:1020', 22, 57], ['hsr:1010', 23, 5], ['hsr:0990', 23, 13]]);
const tra = trip('tra', '2254', [['tra:1020', 23, 1], ['tra:0990', 23, 15]]);
const net = network(stations, [hsr, tra], []);
const home = { name: '家', lat: 24.8176, lon: 121.0165 };
const 台北101 = { name: '台北101購物中心', lat: 25.0339, lon: 121.5645 };
const pt = k => ({ name: net.st.get(k).name, lat: net.st.get(k).lat, lon: net.st.get(k).lon });
const leg = (t, a, b) => trainLeg(net, { trip: t, from: t.stops[a].st, to: t.stops[b].st, dep: t.stops[a].dep, arr: t.stops[b].arr, stops: b - a, fromK: a });
const walk = (from, to, dep, min, dist) => ({ mode: 'walk', from, to, dep, arr: dep + min * 60_000, dur: min * 60, dist });
const bike = (from, to, dep, min, dist) => ({ mode: 'bike', from, to, dep, arr: dep + min * 60_000, dur: min * 60, dist });
// What was recommended: YouBike, 0690 to 板橋, 2254 to 松山, YouBike.
const shown = finish({
  src: 'rail',
  legs: [
    walk(home, home, T(22, 6), 2, 120),
    bike(home, pt('hsr:1030'), T(22, 8), 16, 4200),
    leg(hsr, 0, 1),
    walk(pt('hsr:1020'), pt('tra:1020'), T(22, 57), 4, 150),
    leg(tra, 0, 1),
    bike(pt('tra:0990'), 台北101, T(23, 16), 14, 2900),
    walk(台北101, 台北101, T(23, 30), 3, 200)
  ]
});
// The metro from a station (a stand-in for metroroute's, its estimates on 2026-11-06 at 23:00):
// 台北 → 台北101/世貿 13 minutes, 板橋 → 市政府 25, 南港 → 市政府 10; the walks at each end.
const RIDES = { 台北: ['淡水信義線', '台北101/世貿', 13, 2], 板橋: ['板南線', '市政府', 25, 13], 南港: ['板南線', '市政府', 10, 13] };
const metro = async (o, d, at) => {
  const r = RIDES[o.name.replace(/^高鐵/, '')];
  if (!r) return [];
  const [line, to, min, end] = r;
  const m = { name: to, lat: 25.033, lon: 121.565 };
  const dep = at + 3 * 60_000;
  return [finish({ src: 'metro', legs: [walk(o, o, at, 2, 150), { mode: 'metro', name: line, short: line, from: o, to: m, dep, arr: dep + min * 60_000, dur: min * 60, est: true }, walk(m, d, dep + min * 60_000, end, end * 70)] })];
};

test('the 高鐵 into 台北: a way on by the metro from each of its stops there, the plan before it kept', async () => {
  assert.ok(metroMapAt(台北101) && !metroMapAt(home));
  const on = await trainThenMetro([shown], net, 台北101, { metro });
  const say = p => p.legs.filter(l => l.mode !== 'walk').map(l => `${l.mode}:${l.from.name}>${l.to.name}`).join(' ');
  assert.deepEqual(on.map(say).sort(), [
    'bike:家>新竹 hsr:高鐵新竹>高鐵南港 metro:高鐵南港>市政府',
    'bike:家>新竹 hsr:高鐵新竹>高鐵台北 metro:高鐵台北>台北101/世貿',
    'bike:家>新竹 hsr:高鐵新竹>高鐵板橋 metro:高鐵板橋>市政府'
  ]);
  // (Off the train at its stop's time, onto the metro after it.)
  for (const p of on) {
    const [h, m] = [p.legs.find(l => l.mode === 'hsr'), p.legs.find(l => l.mode === 'metro')];
    assert.ok(m.dep >= h.arr + 3 * 60_000 && p.legs.every((l, i) => i === 0 || l.dep >= p.legs[i - 1].arr - 1000));
  }
  // Ranked together: 高鐵 to 台北 and the 淡水信義線, sooner and with no YouBike at the end, is recommended.
  const r = rank([shown, ...on], { now: T(22, 5), o: home, d: 台北101, clock: T(22, 5) });
  assert.match(say(r.find(p => p.top)), /高鐵台北 metro:高鐵台北>台北101/, r.map(p => `${p.score} ${say(p)}`).join('\n'));
});

test('a train that already ends by the place, or a place outside any metro: nothing more', async () => {
  const near = { ...shown, legs: shown.legs.slice(0, 5) };
  assert.deepEqual(await trainThenMetro([near], net, pt('tra:0990'), { metro }), []);
  assert.deepEqual(await trainThenMetro([shown], net, home, { metro }), []);
});
