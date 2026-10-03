// Orbit Transit's logic without a browser or network: the train router, the
// YouBike plans, bus times, the pass's data, the polylines, the metro map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { traStations, hsrStations, traTrips, hsrTrips, network, links, journeys, earliest, directs, tags, traFare, hsrFare } from '../public/lib/rail.mjs';
import { withBikes, bikeOnly, bikeToRail, bikeFromRail, rentNear, returnNear, rank, bikePoints, railPlans } from '../public/lib/plan.mjs';
import { etaText, etaOf, findRoutes, parseStops, etaMap } from '../public/lib/bus.mjs';
import { mergeBikes, bikeName, bikeLevel } from '../public/lib/bike.mjs';
import { emptyData, encodeData, decodeData, mergeData, cleanData, remember, trainKey, move } from '../public/lib/store.mjs';
import { decodeGoogle, decodeFlexible, tw, twAt, minsText, distText, meters, addDays } from '../public/lib/util.mjs';
import { cityFromAddress, cityAt, cityOf } from '../public/lib/city.mjs';
import { parseSystem, lineRuns, mapSvg, upcoming, interchanges } from '../public/lib/metro.mjs';

const T = hm => twAt('2026-10-05', hm);

// ---- A small piece of Hsinchu's railways ----------------------------------------------------------
// 台鐵: 新竹 (1210) – 北新竹 (1193) – 竹中 (1194) – 六家 (1195) [六家線], 竹中 – 上員 (1201) [內灣線],
// 新竹 – 竹北 (1180) – 台北 (1000) [西部幹線]; 高鐵: 新竹 (1040) beside 六家, 台北 (1000).
const TRA_ST = {
  Stations: [
    ['1000', '臺北', 25.0478, 121.5170, '0', '100臺北市中正區北平西路3號'],
    ['1180', '竹北', 24.8392, 121.0093, '2', '302新竹縣竹北市'],
    ['1210', '新竹', 24.8016, 120.9716, '0', '300新竹市東區中華路二段445號'],
    ['1193', '北新竹', 24.8090, 120.9850, '3', '300新竹市東區'],
    ['1194', '竹中', 24.7836, 121.0372, '3', '310新竹縣竹東鎮'],
    ['1195', '六家', 24.8080, 121.0400, '3', '302新竹縣竹北市'],
    ['1201', '上員', 24.7719, 121.0574, '4', '310新竹縣竹東鎮'],
    ['9999', '貨運場', 24.9, 121.1, 'A', '']
  ].map(([id, name, lat, lon, cls, addr]) => ({ StationID: id, StationName: { Zh_tw: name }, StationPosition: { PositionLat: lat, PositionLon: lon }, StationClass: cls, StationAddress: addr }))
};
const HSR_ST = [
  { StationID: '1040', StationName: { Zh_tw: '新竹' }, StationPosition: { PositionLat: 24.8081, PositionLon: 121.0403 }, LocationCity: '新竹縣', StationAddress: '新竹縣竹北市高鐵七路6號' },
  { StationID: '1000', StationName: { Zh_tw: '台北' }, StationPosition: { PositionLat: 25.0477, PositionLon: 121.5163 }, LocationCity: '臺北市', StationAddress: '臺北市中正區北平西路3號' }
];
const stop = (id, arr, dep = arr) => ({ StationID: id, ArrivalTime: arr, DepartureTime: dep });
const train = (no, code, type, stops, extra = {}) => ({ TrainInfo: { TrainNo: no, TrainTypeCode: code, TrainTypeName: { Zh_tw: type }, TripHeadSign: extra.head || '', EndingStationName: { Zh_tw: extra.end || '' }, SuspendedFlag: extra.off ? 1 : 0, BikeFlag: 0 }, StopTimes: stops });
const TRA_DAY = {
  TrainDate: '2026-10-05',
  TrainTimetables: [
    // 六家線 shuttles: 新竹 → 竹中 → 六家.
    train('1801', '6', '區間車', [stop('1210', '08:00'), stop('1193', '08:04'), stop('1194', '08:12'), stop('1195', '08:17')], { end: '六家' }),
    train('1803', '6', '區間車', [stop('1210', '08:40'), stop('1193', '08:44'), stop('1194', '08:52'), stop('1195', '08:57')], { end: '六家' }),
    // 內灣線 from 上員, to 竹中 and on to 新竹.
    train('1701', '6', '區間車', [stop('1201', '07:55'), stop('1194', '08:01'), stop('1193', '08:09'), stop('1210', '08:14')], { end: '新竹' }),
    // 西部幹線 to 台北: a 自強 and a slow 區間.
    train('152', '3', '自強(3000)', [stop('1210', '08:30'), stop('1180', '08:37'), stop('1000', '09:40')], { end: '臺北' }),
    train('2160', '6', '區間車', [stop('1210', '08:20'), stop('1180', '08:28'), stop('1000', '10:05')], { end: '基隆' }),
    // Cancelled: never offered.
    train('999', '3', '自強', [stop('1210', '08:25'), stop('1000', '09:20')], { off: true })
  ]
};
const HSR_DAY = [
  { TrainDate: '2026:10:05', DailyTrainInfo: { TrainNo: '0612', EndingStationName: { Zh_tw: '南港' } }, StopTimes: [stop('1040', '08:33'), stop('1000', '09:02')] },
  { TrainDate: '2026:10:05', DailyTrainInfo: { TrainNo: '0616', EndingStationName: { Zh_tw: '南港' } }, StopTimes: [stop('1040', '09:13'), stop('1000', '09:42')] },
  // A train past midnight.
  { TrainDate: '2026:10:05', DailyTrainInfo: { TrainNo: '0699', EndingStationName: { Zh_tw: '南港' } }, StopTimes: [stop('1040', '23:50'), stop('1000', '00:19')] }
];
const stations = [...traStations(TRA_ST), ...hsrStations(HSR_ST)];
const trips = [...traTrips(TRA_DAY), ...hsrTrips(HSR_DAY)];
const net = network(stations, trips, links(stations));

test('stations: passengers only, the city from the address', () => {
  assert.equal(stations.filter(s => s.sys === 'tra').length, 7, 'the freight yard is left out');
  assert.equal(stations.find(s => s.key === 'tra:1210').city, 'Hsinchu');
  assert.equal(stations.find(s => s.key === 'tra:1195').city, 'HsinchuCounty');
  assert.equal(stations.find(s => s.key === 'hsr:1000').city, 'Taipei');
});

test('timetables: cancelled trains dropped, times past midnight run on', () => {
  assert.ok(!trips.some(t => t.no === '999'));
  const late = trips.find(t => t.no === '0699');
  assert.equal(late.stops[1].arr - late.stops[0].dep, 29 * 60_000);
  assert.equal(trips.find(t => t.no === '152').type, '自強');
  assert.notEqual(trips.find(t => t.no === '152').id, hsrTrips(HSR_DAY)[0].id);
});

test('walks link a 高鐵 station to the 台鐵 station beside it, and only those', () => {
  const w = links(stations);
  const liujia = w.find(x => x.from === 'tra:1195' && x.to === 'hsr:1040');
  assert.ok(liujia, '六家 ↔ 高鐵新竹');
  assert.ok(liujia.min >= 4 && liujia.min <= 8);
  assert.ok(w.find(x => x.from === 'hsr:1000' && x.to === 'tra:1000'), '台北: one building');
  assert.ok(!w.some(x => x.from === 'tra:1210' && x.to === 'hsr:1040'), '台鐵新竹 is 10 km from 高鐵新竹');
  assert.ok(!w.some(x => x.from.startsWith('tra') && x.to.startsWith('tra')), 'no walks inside one railway');
});

test('上員 → 台北: by itself it changes to the 六家線 and walks to the 高鐵 (faster than the 自強)', () => {
  const list = journeys(net, 'tra:1201', 'tra:1000', T('07:50'));
  assert.ok(list.length >= 1);
  const best = list.reduce((a, b) => (b.arr < a.arr ? b : a));
  const rides = best.legs.filter(l => !l.walk);
  assert.deepEqual(rides.map(l => l.trip.no), ['1701', '1801', '0612']);
  assert.equal(best.legs.at(-1).walk, true, 'and a walk across 台北 station to 台鐵');
  assert.equal(best.legs.find(l => l.walk && l.to === 'hsr:1040')?.from, 'tra:1195');
  assert.equal(best.transfers, 2);
  // 1701 reaches 竹中 08:01; the 1801 leaves 竹中 08:12: a change at 竹中, not at 新竹.
  assert.equal(rides[1].from, 'tra:1194');
  // The 自強 way (1701 to 新竹, then 152) arrives later and is kept only if it leaves later or changes less.
  for (const j of list) assert.ok(j.legs.every(l => l.walk || l.dep >= T('07:50')));
});

test('every option is the latest way to leave for its arrival', () => {
  // 新竹 → 台北 from 08:00: the 2160 (08:20, 10:05) and the 152 (08:30, 09:40): the 152 beats it.
  const list = journeys(net, 'tra:1210', 'tra:1000', T('08:00'), { use: t => t.sys === 'tra' });
  assert.deepEqual(list.map(j => j.legs.filter(l => !l.walk).map(l => l.trip.no).join('+')), ['152']);
  const d = directs(net, 'tra:1210', 'tra:1000', T('08:00'));
  assert.deepEqual(d.map(j => j.legs[0].trip.no), ['2160', '152']);
});

test('only 台鐵: no 高鐵 even when it’s faster', () => {
  const j = earliest(net, [{ key: 'tra:1194', at: T('08:00') }], [{ key: 'tra:1000' }], { use: t => t.sys === 'tra' });
  assert.ok(j);
  assert.ok(j.legs.every(l => l.walk || l.trip.sys === 'tra'));
  assert.deepEqual(j.legs.filter(l => !l.walk).map(l => l.trip.no), ['1701', '152']);
  assert.equal(earliest(net, [{ key: 'tra:1194', at: T('08:00') }], [{ key: 'hsr:1000' }], { use: t => t.sys === 'tra' })?.end ?? null, 'hsr:1000', '高鐵台北 by walking from 台鐵台北');
});

test('changing trains takes its minutes', () => {
  // 1701 reaches 新竹 08:14; the 2160 leaves 08:20 (enough), but a train leaving 08:16 would not be.
  const extra = [...trips, ...traTrips({ TrainDate: '2026-10-05', TrainTimetables: [train('3000', '3', '自強', [stop('1210', '08:16'), stop('1000', '09:00')])] })];
  const n2 = network(stations, extra, links(stations));
  const j = earliest(n2, [{ key: 'tra:1201', at: T('07:50') }], [{ key: 'tra:1000' }], { use: t => t.sys === 'tra' });
  assert.notEqual(j.legs.find(l => !l.walk && l.from === 'tra:1210')?.trip.no, '3000', '新竹 is a class-0 station: 5 minutes');
});

test('labels: earliest there, shortest ride, direct', () => {
  const list = journeys(net, 'tra:1201', 'tra:1000', T('07:50'));
  const l = tags(list);
  assert.ok([...l.values()].flat().includes('最早抵達'));
});

test('fares: 台鐵 by train type, 高鐵 standard and non-reserved', () => {
  const tra = { ODFares: [{ TrainType: 6, Fares: [{ TicketType: 1, FareClass: 1, Price: 76 }] }, { TrainType: 3, Fares: [{ TicketType: 1, FareClass: 1, Price: 177 }, { TicketType: 1, FareClass: 2, Price: 89 }] }] };
  assert.equal(traFare(tra, '3'), 177);
  assert.equal(traFare(tra, '6'), 76);
  assert.equal(traFare(tra, '2'), 177, 'an express without its own fare row uses 自強');
  assert.deepEqual(hsrFare([{ Fares: [{ TicketType: 1, FareClass: 1, CabinClass: 1, Price: 290 }, { TicketType: 1, FareClass: 1, CabinClass: 3, Price: 280 }] }]), { standard: 290, business: null, free: 280 });
});

// ---- YouBike plans --------------------------------------------------------------------------------

const O = { lat: 24.8010, lon: 120.9900, name: '家' }; // ~2 km east of 新竹 station
const D = { lat: 25.0330, lon: 121.5654, name: '台北101' };
const BIKES = [
  { uid: 'a', name: '家附近', lat: 24.8012, lon: 120.9903, bikes: 3, ebike: 1, ret: 5, ok: true },
  { uid: 'b', name: '新竹火車站', lat: 24.8020, lon: 120.9718, bikes: 0, ebike: 0, ret: 8, ok: true },
  { uid: 'c', name: '空站', lat: 24.8011, lon: 120.9901, bikes: 0, ebike: 0, ret: 0, ok: true },
  { uid: 'd', name: '101 站', lat: 25.0335, lon: 121.5650, bikes: 2, ebike: 0, ret: 3, ok: true },
  { uid: 'e', name: '市府站', lat: 25.0410, lon: 121.5650, bikes: 9, ebike: 0, ret: 2, ok: true }
];
const P = (dep, legs, src = 'google') => {
  const out = { src, legs, dep, arr: legs.at(-1).arr };
  out.dur = (out.arr - dep) / 1000;
  out.walk = legs.filter(l => l.mode === 'walk').reduce((a, l) => a + l.dist, 0);
  out.transfers = legs.filter(l => !['walk', 'bike'].includes(l.mode)).length - 1;
  return out;
};
// 公車 to 新竹 station, 自強 to 台北, MRT 市府, walk.
const busPlan = P(T('08:00'), [
  { mode: 'walk', dur: 120, dist: 150, dep: T('08:00'), arr: T('08:02'), from: O, to: { lat: 24.8013, lon: 120.9905 } },
  { mode: 'bus', short: '20', dur: 960, dist: 2000, dep: T('08:05'), arr: T('08:21'), from: { name: '東門', lat: 24.8013, lon: 120.9905 }, to: { name: '新竹站', lat: 24.8018, lon: 120.9720 } },
  { mode: 'walk', dur: 180, dist: 200, dep: T('08:21'), arr: T('08:24'), from: { lat: 24.8018, lon: 120.9720 }, to: { lat: 24.8016, lon: 120.9716 } },
  { mode: 'tra', short: '自強', dur: 4200, dist: 70000, dep: T('08:30'), arr: T('09:40'), from: { name: '新竹', lat: 24.8016, lon: 120.9716 }, to: { name: '臺北', lat: 25.0478, lon: 121.5170 } },
  { mode: 'metro', short: '板南線', dur: 900, dist: 5000, dep: T('09:48'), arr: T('10:03'), from: { name: '台北車站', lat: 25.0461, lon: 121.5175 }, to: { name: '市政府', lat: 25.0410, lon: 121.5655 } },
  { mode: 'bus', short: '20', dur: 600, dist: 1000, dep: T('10:06'), arr: T('10:16'), from: { name: '市府', lat: 25.0410, lon: 121.5655 }, to: { name: '101', lat: 25.0335, lon: 121.5654 } }
]);

test('YouBike stations: the nearest with a bike (two or more if barely farther), the nearest with a dock', () => {
  assert.equal(rentNear(O, BIKES).uid, 'a');
  assert.equal(rentNear(O, BIKES, { ebike: true }).uid, 'a');
  assert.equal(rentNear({ lat: 24.8020, lon: 120.9718 }, BIKES), null, 'no bike at 新竹 station');
  assert.equal(returnNear({ lat: 24.8020, lon: 120.9718 }, BIKES).uid, 'b');
});

test('by bike to the train: the same 自強, leaving later', () => {
  const p = bikeToRail(busPlan, O, BIKES);
  assert.ok(p);
  assert.equal(p.src, 'bike+');
  const bike = p.legs.find(l => l.mode === 'bike');
  assert.equal(bike.rent.uid, 'a');
  assert.equal(bike.ret.uid, 'b');
  assert.ok(p.dep > busPlan.dep, 'leaves later than the bus plan');
  assert.ok(p.legs.find(l => l.mode === 'tra').dep === T('08:30'));
  const toTrain = p.legs[p.legs.findIndex(l => l.mode === 'tra') - 1];
  assert.ok(toTrain.arr <= T('08:28'), 'at the station 2 minutes before');
});

test('by bike from the last metro: there sooner than the bus', () => {
  const p = bikeFromRail(busPlan, D, BIKES);
  assert.ok(p);
  assert.ok(p.arr < busPlan.arr);
  assert.equal(p.legs.find(l => l.mode === 'bike').rent.uid, 'e');
});

test('all the way by bike only when it’s near enough', () => {
  assert.deepEqual(bikeOnly(O, D, BIKES, T('08:00')), [], '80 km: no');
  const near = { lat: 24.8100, lon: 121.0000 };
  const list = bikeOnly(O, near, [...BIKES, { uid: 'f', name: '終點', lat: 24.8101, lon: 121.0001, bikes: 1, ebike: 0, ret: 4, ok: true }], T('08:00'));
  assert.equal(list.length, 1, 'regular bike; 1.4 km is too short for the 電輔車 option');
});

test('our own train plans: walk to a station near you, the trains, walk from the one near there', () => {
  const o = { name: '家', lat: 24.8030, lon: 120.9690 };
  const d = { name: '公司', lat: 25.0500, lon: 121.5200 };
  const list = railPlans(net, o, d, T('08:10'));
  assert.ok(list.length >= 1);
  for (const p of list) {
    assert.equal(p.legs[0].mode, 'walk');
    assert.equal(p.legs.at(-1).mode, 'walk');
    assert.ok(p.legs.some(l => l.mode === 'tra' || l.mode === 'hsr'));
    assert.ok(p.dep >= T('08:10'));
    for (let i = 1; i < p.legs.length; i++) assert.ok(p.legs[i].dep >= p.legs[i - 1].arr - 1000, 'legs in order');
  }
  assert.ok(list.some(p => p.legs.some(l => l.short === '自強 152')));
  assert.deepEqual(railPlans(net, o, { lat: 24.81, lon: 120.98 }, T('08:10')), [], 'under 3 km: no trains');
  assert.deepEqual(railPlans(net, o, { lat: 23.5, lon: 120.5 }, T('08:10')), [], 'no station near there');
});

test('ranking: soonest first, every transit plan kept however late, each labelled', () => {
  const list = withBikes([busPlan], O, D, BIKES, T('07:59'));
  assert.ok(list.length >= 2);
  assert.ok(list[0].arr <= list[1].arr);
  assert.ok(list[0].tags.includes('最快抵達'));
  assert.ok(list.some(p => p.tags.includes('YouBike')));
  const later = { ...busPlan, arr: busPlan.arr + 1_800_000, dur: busPlan.dur + 1800, legs: busPlan.legs.map(l => ({ ...l, dep: l.dep + 60_000 })) };
  assert.equal(rank([busPlan, later]).length, 2, 'a later bus is still shown');
  assert.equal(rank([busPlan, { ...busPlan }]).length, 1, 'the same ride once');
  assert.ok(bikePoints([busPlan], O, D).length <= 8);
});

test('TDX’s YouBike first mile gets its stations; a long walk to a bus becomes a ride to it', () => {
  // TDX's answer: bike to the express bus, ride, a zero-length walk, bike from the end.
  const tdxBike = P(T('08:00'), [
    { mode: 'bike', dur: 400, dist: 1500, dep: T('08:00'), arr: T('08:07'), from: { name: '', lat: 24.8011, lon: 120.9902 }, to: { name: '東門', lat: 24.8013, lon: 120.9905 } },
    { mode: 'bus', short: '快捷8號', dur: 1800, dist: 14000, dep: T('08:10'), arr: T('08:40'), from: { name: '東門', lat: 24.8013, lon: 120.9905 }, to: { name: '新竹站', lat: 24.8018, lon: 120.9720 } },
    { mode: 'walk', dur: 0, dist: 0, dep: T('08:40'), arr: T('08:40'), from: { name: '新竹站', lat: 24.8018, lon: 120.9720 }, to: { name: '新竹站', lat: 24.8018, lon: 120.9720 } }
  ], 'tdx-bike');
  const out = withBikes([tdxBike], O, D, BIKES, T('07:59'));
  const mine = out.find(p => p.src === 'tdx-bike');
  assert.equal(mine.legs[0].from.name, '家附近', 'the station with a bike');
  assert.equal(mine.legs[0].rent.uid, 'a');
  assert.equal(mine.legs.length, 2, 'the empty walk gone');
  // Google's plan with 1.2 km on foot to its first bus: by bike to that bus instead.
  const far = { lat: 24.8012, lon: 120.9780 };
  const walkToBus = P(T('08:00'), [
    { mode: 'walk', dur: 900, dist: 1300, dep: T('08:00'), arr: T('08:15'), from: { ...BIKES[0] }, to: far },
    { mode: 'bus', short: '5608', dur: 1200, dist: 8000, dep: T('08:20'), arr: T('08:40'), from: { name: '站前', ...far }, to: { name: '竹東', lat: 24.74, lon: 121.09 } }
  ]);
  const near = [...BIKES, { uid: 'f', name: '站前 YouBike', lat: 24.8013, lon: 120.9781, bikes: 1, ebike: 0, ret: 6, ok: true }];
  const list = withBikes([walkToBus], BIKES[0], { lat: 24.74, lon: 121.09 }, near, T('07:59'));
  const biked = list.find(p => p.src === 'bike+' && p.legs.some(l => l.mode === 'bus'));
  assert.ok(biked, 'a bike to the bus');
  assert.ok(biked.dep > walkToBus.dep, 'leaving later for the same bus');
});

// ---- Buses -----------------------------------------------------------------------------------------

test('bus times say what a stop sign says', () => {
  assert.deepEqual(etaText({ sec: 40, status: 0, more: [] }), { main: '進站中', sub: '', tone: 'now' });
  assert.equal(etaText({ sec: 150, status: 0, more: [] }).main, '即將進站');
  assert.deepEqual(etaText({ sec: 420, status: 0, more: [1500] }), { main: '7 分', sub: '下一班 25 分', tone: 'wait' });
  assert.equal(etaText({ sec: 300, status: 0, more: [], last: true }).sub, '末班車');
  assert.equal(etaText({ sec: null, status: 1, next: Date.parse('2026-10-05T06:10:00+08:00'), more: [] }, Date.parse('2026-10-05T05:40:00+08:00')).main, '06:10 發車');
  assert.equal(etaText({ sec: null, status: 3, more: [] }).main, '末班已過');
  assert.equal(etaText({ sec: null, status: 4, more: [] }).main, '今日未營運');
  assert.equal(etaText(null).main, '—');
  const r = etaOf({ StopUID: 'HSZ1', EstimateTime: 300, StopStatus: 0, PlateNumb: '-1', Estimates: [{ EstimateTime: 300 }, { EstimateTime: 900 }] });
  assert.deepEqual(r.more, [900]);
  assert.equal(r.plate, '');
  // A stop listed for both directions: the sooner bus.
  const m = etaMap([{ StopUID: 'X', EstimateTime: 900, StopStatus: 0 }, { StopUID: 'X', EstimateTime: 120, StopStatus: 0 }]);
  assert.equal(m.get('X').sec, 120);
});

test('route search: exact, then starting with, then containing, then by place', () => {
  const list = [
    { uid: '1', name: '20', from: '新竹', to: '關西' },
    { uid: '2', name: '2', from: '新竹', to: '竹北' },
    { uid: '3', name: '藍2', from: '台北', to: '內湖' },
    { uid: '4', name: '182', from: '新竹', to: '香山' },
    { uid: '5', name: '5608', from: '新竹', to: '竹東' }
  ];
  assert.deepEqual(findRoutes(list, '2').map(r => r.name), ['2', '20', '藍2', '182']);
  assert.deepEqual(findRoutes(list, '竹東').map(r => r.name), ['5608']);
  assert.deepEqual(findRoutes(list, '台北').map(r => r.name), ['藍2'], '台 and 臺 are one');
});

test('a route’s stops: in order, the main pattern of each way first', () => {
  const ways = parseStops([
    { Direction: 1, SubRouteUID: 'b', SubRouteName: { Zh_tw: '2' }, Stops: [{ StopUID: 'y2', StopName: { Zh_tw: '竹北' }, StopSequence: 2 }, { StopUID: 'y1', StopName: { Zh_tw: '新竹' }, StopSequence: 1 }] },
    { Direction: 0, SubRouteUID: 'a', SubRouteName: { Zh_tw: '2區' }, Stops: [{ StopUID: 'x1', StopName: { Zh_tw: '新竹' }, StopSequence: 1 }] },
    { Direction: 0, SubRouteUID: 'c', SubRouteName: { Zh_tw: '2' }, Stops: [{ StopUID: 'x1', StopName: { Zh_tw: '新竹' }, StopSequence: 1 }, { StopUID: 'x2', StopName: { Zh_tw: '竹北' }, StopSequence: 2 }] }
  ]);
  assert.deepEqual(ways.map(w => `${w.dir}:${w.sub}`), ['0:c', '0:a', '1:b']);
  assert.deepEqual(ways[2].stops.map(s => s.name), ['新竹', '竹北']);
  assert.equal(ways[0].headsign, '竹北');
});

test('YouBike: regular bikes and 電輔車 apart, the name without its prefix', () => {
  const list = mergeBikes(
    [{ StationUID: 'HSZ1', StationName: { Zh_tw: 'YouBike2.0_新竹火車站(東站)' }, StationPosition: { PositionLat: 24.8, PositionLon: 120.97 }, BikesCapacity: 30, ServiceType: 2 }],
    [{ StationUID: 'HSZ1', ServiceStatus: 1, AvailableRentBikes: 7, AvailableReturnBikes: 23, AvailableRentBikesDetail: { GeneralBikes: 5, ElectricBikes: 2 } }]
  );
  assert.deepEqual({ ...list[0], at: null }, { uid: 'HSZ1', name: '新竹火車站(東站)', lat: 24.8, lon: 120.97, cap: 30, kind: 'YouBike 2.0', bikes: 5, ebike: 2, ret: 23, ok: true, at: null });
  assert.equal(bikeName('YouBike2.0E_竹北'), '竹北');
  assert.equal(bikeLevel({ bikes: 0, ebike: 0 }), 'none');
  assert.equal(bikeLevel({ bikes: 1, ebike: 1 }), 'few');
});

// ---- The pass's data ---------------------------------------------------------------------------------

test('the pass’s data: cleaned, encoded, the newer copy wins', () => {
  const d = emptyData();
  d.groups[0].items.push({ routeUID: 'HSZ0001', route: '藍1', stopUID: 'HSZ123', stop: '新竹車站', dir: 1, city: 'Hsinchu', headsign: '竹北', lat: 24.8, lon: 120.97 });
  d.places.push({ name: '家', icon: 'home', lat: 24.8, lon: 120.99 }, { name: '東京', lat: 35.6, lon: 139.7 });
  d.t = 5;
  const back = decodeData(encodeData(d));
  assert.equal(back.groups[0].items[0].route, '藍1');
  assert.equal(back.places.length, 1, 'only places in Taiwan');
  assert.equal(back.places[0].icon, 'home');
  assert.ok(encodeData(d).startsWith('t1:'));
  assert.equal(decodeData('w1:{}'), null);
  assert.equal(mergeData(back, { ...back, t: 9, places: [] }).places.length, 0);
  assert.equal(mergeData({ ...back, t: 10 }, { ...back, t: 9, places: [] }).places.length, 1);
  assert.equal(cleanData({ groups: [] }).groups.length, 1, 'never no group');
  const x = { from: { sys: 'tra', id: '1210', name: '新竹' }, to: { sys: 'hsr', id: '1000', name: '台北' } };
  assert.deepEqual(remember([x, { ...x, from: { ...x.from, id: '1000' } }], x, trainKey, 8).length, 2);
  assert.deepEqual(move([1, 2, 3], 0, 1), [2, 1, 3]);
  assert.deepEqual(move([1, 2, 3], 0, -1), [1, 2, 3]);
});

// ---- Small pieces ------------------------------------------------------------------------------------

test('polylines: Google’s and HERE’s flexible', () => {
  // Google's documented example.
  assert.deepEqual(decodeGoogle('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  // HERE's documented example (precision 5, no third dimension).
  const f = decodeFlexible('BFoz5xJ67i1B1B7PzIhaxL7Y');
  assert.equal(f.length, 4);
  assert.deepEqual(f[0].map(v => Math.round(v * 1e5) / 1e5), [50.10228, 8.69821]);
  assert.deepEqual(decodeFlexible('!!'), []);
});

test('Taiwan time, minutes and distances', () => {
  assert.equal(tw(Date.parse('2026-10-04T16:30:00Z')).date, '2026-10-05');
  assert.equal(tw(Date.parse('2026-10-04T16:30:00Z')).hm, '00:30');
  assert.equal(twAt('2026-10-05', '25:10') - twAt('2026-10-05', '01:10'), 86_400_000);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(minsText(65 * 60), '1 小時 5 分');
  assert.equal(minsText(8 * 60), '8 分');
  assert.equal(distText(850), '850 公尺');
  assert.equal(distText(12_400), '12 公里');
  assert.ok(Math.abs(meters(25.0478, 121.517, 24.8016, 120.9716) - 60_500) < 2000);
});

test('cities: from an address, from a point, written 台 or 臺', () => {
  assert.equal(cityFromAddress('302新竹縣竹北市高鐵七路6號'), 'HsinchuCounty');
  assert.equal(cityFromAddress('300新竹市東區'), 'Hsinchu');
  assert.equal(cityFromAddress('台北市中正區'), 'Taipei');
  assert.equal(cityOf('台中市'), 'Taichung');
  const towns = [['新竹市', '東區', 24.79, 120.99], ['新竹縣', '竹北市', 24.83, 121.01], ['臺北市', '中正區', 25.03, 121.51]];
  assert.equal(cityAt(towns, 24.84, 121.02).city, 'HsinchuCounty');
});

// ---- The metro map ----------------------------------------------------------------------------------

const SYS = parseSystem(
  'TRTC',
  [['O12', '大橋頭', 25.0633, 121.5130], ['O13', '台北橋', 25.0632, 121.5009], ['O21', '迴龍', 25.0219, 121.4116], ['O50', '三重國小', 25.0705, 121.4966], ['O54', '蘆洲', 25.0915, 121.4646], ['BL12', '台北車站', 25.0461, 121.5175], ['R10', '台北車站', 25.0464, 121.5170]].map(([id, n, lat, lon]) => ({ StationID: id, StationName: { Zh_tw: n }, StationPosition: { PositionLat: lat, PositionLon: lon } })),
  [
    { LineID: 'O', Stations: [['O12', 1], ['O13', 2], ['O21', 3], ['O50', 4], ['O54', 5]].map(([StationID, Sequence]) => ({ StationID, Sequence })) },
    { LineID: 'BL', Stations: [{ StationID: 'BL12', Sequence: 1 }] },
    { LineID: 'R', Stations: [{ StationID: 'R10', Sequence: 1 }] }
  ],
  [{ LineID: 'O', LineName: { Zh_tw: '中和新蘆線' }, LineColor: '#f8b61c' }, { LineID: 'BL', LineName: { Zh_tw: '板南線' }, LineColor: '0070bd' }],
  [
    { LineID: 'O', RouteID: 'O-1', Direction: 0, Stations: [['O12', 1], ['O13', 2], ['O21', 3]].map(([StationID, Sequence]) => ({ StationID, Sequence })) },
    { LineID: 'O', RouteID: 'O-1', Direction: 1, Stations: [['O21', 1], ['O13', 2], ['O12', 3]].map(([StationID, Sequence]) => ({ StationID, Sequence })) },
    { LineID: 'O', RouteID: 'O-2', Direction: 0, Stations: [['O12', 1], ['O50', 2], ['O54', 3]].map(([StationID, Sequence]) => ({ StationID, Sequence })) }
  ]
);

test('metro lines: drawn by the operator’s routes (the 蘆洲 branch from 大橋頭), else split where they jump', () => {
  const O = SYS.lines.find(l => l.id === 'O');
  assert.deepEqual(O.paths.map(p => p.map(k => k.split(':')[2])), [['O12', 'O13', 'O21'], ['O12', 'O50', 'O54']], 'each route once, one way');
  const byKey = new Map(SYS.stations.map(s => [s.key, s]));
  const runs = lineRuns({ ...O, paths: [] }, byKey);
  assert.ok(runs.length >= 2, 'without routes: split at the jumps');
  assert.equal(SYS.lines.find(l => l.id === 'BL').color, '#0070bd');
  assert.equal(SYS.lines.find(l => l.id === 'R').color, '#94a3b8', 'no colour from TDX: grey');
});

test('metro map: one interchange for 台北車站, every name escaped', () => {
  const groups = interchanges(SYS.stations);
  assert.equal(groups.find(g => g[0].name === '台北車站').length, 2);
  const { svg } = mapSvg([SYS]);
  assert.match(svg, /^<svg viewBox="0 0 1000 1000"/);
  assert.equal((svg.match(/class="mt-st x"/g) || []).length, 1);
  assert.ok(!svg.includes('<script'));
});

test('metro timetable: the next trains each way, after midnight counted as tonight', () => {
  const now = Date.parse('2026-10-05T23:50:00+08:00');
  const list = upcoming(
    [
      { DestinationStationName: { Zh_tw: '南港展覽館' }, LineID: 'BL', ServiceDay: { Monday: true }, Timetables: [{ DepartureTime: '23:45' }, { DepartureTime: '23:56' }, { DepartureTime: '00:08' }] },
      { DestinationStationName: { Zh_tw: '頂埔' }, LineID: 'BL', ServiceDay: { Monday: false, Sunday: true }, Timetables: [{ DepartureTime: '23:58' }] }
    ],
    now
  );
  assert.equal(list.length, 1, 'Sunday’s timetable isn’t Monday’s');
  assert.deepEqual(list[0].times.map(t => new Date(t + 8 * 3_600_000).toISOString().slice(11, 16)), ['23:56', '00:08']);
});
