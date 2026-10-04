// Orbit Transit's logic without a browser or network: the train router, the
// YouBike plans, bus times, the pass's data, the polylines, the metro map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { traStations, hsrStations, traTrips, hsrTrips, network, links, journeys, earliest, directs, tags, traFare, hsrFare } from '../public/lib/rail.mjs';
import { withBikes, bikeOnly, bikeToRail, bikeFromRail, rentNear, returnNear, rank, bikePoints, railPlans, allowed, swapRides, bikeTrip, score, finish } from '../public/lib/plan.mjs';
import { coverage, fareOf, tpassOf, passOk, inPass } from '../public/lib/tpass.mjs';
import { sameRoute, liveTimes, adjustPlan, rideTime } from '../public/lib/live.mjs';
import { etaText, etaOf, findRoutes, parseStops, etaMap, stopTimes, runsOn } from '../public/lib/bus.mjs';
import { mergeBikes, bikeName, bikeLevel } from '../public/lib/bike.mjs';
import { emptyData, encodeData, decodeData, mergeData, cleanData, remember, trainKey, move, cleanSaved, cleanPin, cleanPrefs, modeList } from '../public/lib/store.mjs';
import { decodeGoogle, decodeFlexible, tw, twAt, minsText, distText, meters, addDays } from '../public/lib/util.mjs';
import { cityFromAddress, cityAt, cityOf } from '../public/lib/city.mjs';
import { parseSystem, lineRuns, upcoming, interchanges } from '../public/lib/metro.mjs';

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

test('ranking: by what’s practical, every plan kept however late, the first few recommended, each labelled', () => {
  const list = withBikes([busPlan], O, D, BIKES, T('07:59'));
  assert.ok(list.length >= 2);
  assert.ok(list[0].score <= list[1].score);
  assert.ok(list[0].tags.includes('推薦'));
  assert.ok(list[0].top);
  assert.ok(list.some(p => p.tags.includes('YouBike')));
  const later = { ...busPlan, arr: busPlan.arr + 1_800_000, dur: busPlan.dur + 1800, legs: busPlan.legs.map(l => ({ ...l, dep: l.dep + 1_800_000, arr: l.arr + 1_800_000 })) };
  assert.equal(rank([busPlan, later]).length, 2, 'a later bus is still shown');
  assert.equal(rank([busPlan, { ...busPlan }]).length, 1, 'the same ride once');
  assert.ok(bikePoints([busPlan], O, D).length <= 8);
});

test('TDX’s YouBike first mile gets its stations; a long walk to a bus becomes a ride to it', () => {
  // TDX's answer: bike to the express bus, ride, a zero-length walk, bike from the end.
  const tdxBike = P(T('08:00'), [
    { mode: 'bike', dur: 400, dist: 1500, dep: T('08:00'), arr: T('08:07'), from: { name: '', lat: 24.8011, lon: 120.9902 }, to: { name: '東門', lat: 24.8013, lon: 120.9780 } },
    { mode: 'bus', short: '快捷8號', dur: 1800, dist: 14000, dep: T('08:10'), arr: T('08:40'), from: { name: '東門', lat: 24.8013, lon: 120.9780 }, to: { name: '新竹站', lat: 24.8018, lon: 120.9720 } },
    { mode: 'walk', dur: 0, dist: 0, dep: T('08:40'), arr: T('08:40'), from: { name: '新竹站', lat: 24.8018, lon: 120.9720 }, to: { name: '新竹站', lat: 24.8018, lon: 120.9720 } }
  ], 'tdx-bike');
  const near = [...BIKES, { uid: 'f', name: '站前 YouBike', lat: 24.8013, lon: 120.9781, bikes: 1, ebike: 0, ret: 6, ok: true }];
  const out = withBikes([tdxBike], O, D, near, T('07:59'));
  const mine = out.find(p => p.src === 'tdx-bike');
  assert.equal(mine.legs[0].from.name, '家附近', 'the station with a bike');
  assert.equal(mine.legs[0].rent.uid, 'a');
  assert.equal(mine.legs[0].to.name, '站前 YouBike');
  assert.equal(mine.legs.length, 2, 'the empty walk gone');
  // A 220 m "ride" back to the same station is a walk.
  const stub = P(T('08:00'), [{ ...tdxBike.legs[0], dist: 220, to: { name: '東門', lat: 24.8013, lon: 120.9905 } }, { ...tdxBike.legs[1] }], 'tdx-bike');
  assert.equal(withBikes([stub], O, D, BIKES, T('07:59')).find(p => p.src === 'tdx-bike').legs[0].mode, 'walk');
  // Google's plan with 1.2 km on foot to its first bus: by bike to that bus instead.
  const far = { lat: 24.8012, lon: 120.9780 };
  const walkToBus = P(T('08:00'), [
    { mode: 'walk', dur: 900, dist: 1300, dep: T('08:00'), arr: T('08:15'), from: { ...BIKES[0] }, to: far },
    { mode: 'bus', short: '5608', dur: 1200, dist: 8000, dep: T('08:20'), arr: T('08:40'), from: { name: '站前', ...far }, to: { name: '竹東', lat: 24.74, lon: 121.09 } }
  ]);
  const list = withBikes([walkToBus], BIKES[0], { lat: 24.74, lon: 121.09 }, near, T('07:59'));
  const biked = list.find(p => p.src === 'bike+' && p.legs.some(l => l.mode === 'bus'));
  assert.ok(biked, 'a bike to the bus');
  assert.ok(biked.dep > walkToBus.dep, 'leaving later for the same bus');
});

// ---- Buses -----------------------------------------------------------------------------------------

test('a bus timetable: the day’s times at a stop, holidays and weekdays respected', () => {
  const week = { Sunday: 0, Monday: 1, Tuesday: 1, Wednesday: 1, Thursday: 1, Friday: 1, Saturday: 0 };
  const trip = (t0, extra = {}) => ({ ServiceDay: week, StopTimes: [{ StopUID: 'HSQ1', StopName: { Zh_tw: '竹北火車站' }, DepartureTime: t0 }, { StopUID: 'HSQ2', StopName: { Zh_tw: '竹北口' }, DepartureTime: t0.replace(/:(\d)0$/, ':$12') }], ...extra });
  const sched = [
    { Direction: 1, Timetables: [trip('06:30'), trip('07:10'), trip('08:00', { SpecialDays: [{ Dates: ['2026-10-09'], ServiceStatus: 0 }] })] },
    { Direction: 0, Timetables: [trip('09:00')] },
    { Direction: 1, Frequencys: [{ StartTime: '10:00', EndTime: '16:00', MinHeadwayMins: 15, MaxHeadwayMins: 20, ServiceDay: week }] }
  ];
  const mon = stopTimes(sched, { stopUID: 'HSQ1', dir: 1 }, '2026-10-05', 1);
  assert.deepEqual(mon.times, ['06:30', '07:10', '08:00']);
  assert.deepEqual(mon.every, [{ from: '10:00', to: '16:00', min: 15, max: 20 }]);
  assert.deepEqual(stopTimes(sched, { stopUID: 'HSQ1', dir: 1 }, '2026-10-09', 5).times, ['06:30', '07:10'], '國慶 off');
  assert.deepEqual(stopTimes(sched, { stopUID: 'HSQ1', dir: 1 }, '2026-10-04', 0).times, [], 'Sunday off');
  assert.deepEqual(stopTimes(sched, { stopUID: 'X', name: '竹北口', dir: 1 }, '2026-10-05', 1).times.length, 3, 'by name when the UID differs');
  assert.equal(runsOn({}, '2026-10-05', 1), true);
});

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

test('metro map: one interchange for 台北車站', () => {
  const groups = interchanges(SYS.stations);
  assert.equal(groups.find(g => g[0].name === '台北車站').length, 2);
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

// ---- What this round added ---------------------------------------------------------------------------

test('saved trips, pinned trains and preferences: cleaned, nothing allowed is everything', () => {
  const t = cleanSaved({ name: '上學', from: null, to: { name: '學校', lat: 24.78, lon: 121.04 }, time: '07:30', by: 'arrive', days: [1, 2, 9, 2, 5], back: '17:00' });
  assert.deepEqual([t.from, t.time, t.by, t.days, t.back], [null, '07:30', 'arrive', [1, 2, 5], '17:00']);
  assert.equal(cleanSaved({ to: { lat: 35, lon: 139 } }), null, 'not in Taiwan');
  assert.equal(cleanSaved({ to: { lat: 24.8, lon: 121 }, time: '25:00' }).time, '');
  assert.equal(cleanPin({ kind: 'train', from: { sys: 'tra', id: '1195', name: '六家' }, to: { sys: 'tra', id: '1203', name: '竹東' } }).kind, 'train');
  assert.equal(cleanPin({ kind: 'trainNo', no: '1x;', from: { sys: 'tra', id: '1', name: 'a' }, to: { sys: 'tra', id: '2', name: 'b' } }), null);
  const p = cleanPrefs({ modes: { bus: false, tra: false, hsr: false, metro: false, bike: false }, bike30: true, tpass: 'hh' });
  assert.ok(Object.values(p.modes).every(Boolean));
  assert.equal(p.bike30, true);
  assert.deepEqual(modeList(cleanPrefs({ modes: { bike: false } })), ['bus', 'tra', 'hsr', 'metro']);
  const d = decodeData(encodeData({ ...emptyData(), saved: [t], prefs: { modes: { bus: false } } }));
  assert.equal(d.saved[0].name, '上學');
  assert.equal(d.prefs.modes.bus, false);
});

test('TPASS: buses and 台鐵 inside its cities free, 高鐵 never, YouBike’s first half hour', () => {
  const hh = tpassOf('hh');
  const city = pt => (pt.lat > 24.75 ? 'HsinchuCounty' : 'MiaoliCounty');
  const plan = { legs: [{ mode: 'bike', dur: 900, from: { lat: 24.8, lon: 121 }, to: { lat: 24.8, lon: 121 } }, { mode: 'bus', from: { lat: 24.8, lon: 121 }, to: { lat: 24.79, lon: 121 } }], fare: 30 };
  assert.equal(coverage(plan, hh, city).all, true);
  assert.equal(fareOf(plan, coverage(plan, hh, city)).cost, 0);
  const out = { legs: [...plan.legs, { mode: 'tra', from: { lat: 24.79, lon: 121 }, to: { lat: 24.5, lon: 120.8 } }], fare: 60 };
  assert.deepEqual([coverage(out, hh, city).all, coverage(out, hh, city).some], [false, true]);
  assert.equal(coverage({ legs: [{ mode: 'hsr', from: { lat: 24.8, lon: 121 }, to: { lat: 24.8, lon: 121 } }] }, hh, city).some, false);
  assert.equal(fareOf(out, coverage(out, null, city)).text, 'NT$60');
});

test('ways of moving: a plan only with what’s allowed (a taxi never)', () => {
  const modes = { bus: false, tra: true, hsr: true, metro: true, bike: true };
  assert.equal(allowed(busPlan, modes), false);
  assert.equal(allowed(busPlan, { ...modes, bus: true }), true);
  assert.equal(allowed({ legs: [{ mode: 'car' }] }, { ...modes, bus: true }), false);
  // No bus: our own plans don't add bus ones, and the bus plan goes.
  const list = withBikes([busPlan], O, D, BIKES, T('07:59'), { modes });
  assert.ok(list.every(p => !p.legs.some(l => l.mode === 'bus')));
});

test('每 30 分鐘換車: a long ride cut at a station half way, each part under half an hour', () => {
  const a = { uid: 'x1', name: '起點', lat: 24.80, lon: 120.97, bikes: 3, ebike: 0, ret: 3, ok: true };
  const mid = { uid: 'x2', name: '半路', lat: 24.80, lon: 121.02, bikes: 2, ebike: 0, ret: 2, ok: true };
  const b = { uid: 'x3', name: '終點', lat: 24.80, lon: 121.07, bikes: 2, ebike: 0, ret: 5, ok: true };
  const whole = bikeTrip(a, b, [a, mid, b], T('08:00'));
  assert.ok(whole.find(l => l.mode === 'bike').dur > 30 * 60, 'one ride is over 30 minutes');
  const cut = bikeTrip(a, b, [a, mid, b], T('08:00'), { swap: true });
  const rides = cut.filter(l => l.mode === 'bike');
  assert.equal(rides.length, 2);
  assert.ok(rides.every(l => l.dur <= 33 * 60));
  assert.equal(rides[1].swap, true);
  assert.ok(rides[1].dep >= rides[0].arr);
  assert.deepEqual(swapRides(whole, [a, b]).length, whole.length, 'no station on the way: the ride stays whole');
});

test('our own trains by YouBike: a station 3 km away ridden to, its stations found, or no plan', () => {
  const o = { name: '家', lat: 24.8300, lon: 120.9716 }; // ~3 km north of 新竹
  const d = { name: '公司', lat: 25.0500, lon: 121.5200 };
  const list = railPlans(net, o, d, T('08:00'), { bike: true });
  const ridden = list.filter(p => p.legs[0].mode === 'bike' && p.legs[0].placeholder);
  assert.ok(ridden.length, 'a station beyond walking reached by bike');
  const docks = [
    { uid: 'r1', name: '家附近', lat: 24.8302, lon: 120.9718, bikes: 4, ebike: 0, ret: 4, ok: true },
    { uid: 'r2', name: '竹北車站', lat: 24.8390, lon: 121.0090, bikes: 2, ebike: 0, ret: 6, ok: true },
    { uid: 'r3', name: '北新竹車站', lat: 24.8089, lon: 120.9852, bikes: 2, ebike: 0, ret: 6, ok: true }
  ];
  const out = withBikes(ridden, o, d, docks, T('08:00'));
  const p = out.find(x => x.legs.some(l => l.mode === 'tra' || l.mode === 'hsr') && x.legs.some(l => l.mode === 'bike'));
  assert.ok(p);
  const bike = p.legs.find(l => l.mode === 'bike');
  assert.equal(bike.rent.uid, 'r1');
  assert.ok(bike.arr <= p.legs.find(l => l.mode === 'tra' || l.mode === 'hsr').dep, 'docked before the train');
  assert.equal(withBikes(ridden, o, d, [], T('08:00')).filter(x => x.legs.some(l => l.placeholder)).length, 0, 'no stations: no plan');
});

test('practical first: a trip that goes the long way round, or changes bus to bus, sinks', () => {
  const o = { lat: 24.821, lon: 121.018 };
  const d = { lat: 24.733, lon: 121.088 };
  const leg = (mode, short, a, b, dep, arr) => ({ mode, short, from: { name: short, ...a }, to: { name: short, ...b }, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist: 0 });
  const direct = finish({ legs: [leg('bus', '快捷8號支', o, d, '08:05', '08:45')] });
  const round = finish({ legs: [leg('bus', '5615', o, { lat: 24.80, lon: 120.97 }, '08:00', '08:15'), leg('bus', '5608', { lat: 24.80, lon: 120.97 }, d, '08:25', '08:40')] });
  assert.ok(round.arr < direct.arr, 'the long way is a little sooner');
  const ranked = rank([round, direct], { now: T('08:00'), o, d });
  assert.equal(ranked[0].legs[0].short, '快捷8號支');
  assert.ok(score(round, { o, d, now: T('08:00') }) > score(direct, { o, d, now: T('08:00') }));
  // Half way at night, the next bus in the morning: no plan (while there's another).
  const overnight = finish({ legs: [leg('bus', '182', o, { lat: 24.80, lon: 121.0 }, '08:00', '08:10'), leg('tra', '區間車', { lat: 24.80, lon: 121.0 }, d, '13:00', '13:20')] });
  assert.equal(rank([overnight, direct], { now: T('08:00'), o, d }).length, 1);
});

test('the buses now: names matched loosely, the bus you’d catch, the trip moved with it', async () => {
  assert.ok(sameRoute('快捷8經興隆大橋', '快捷8號'));
  assert.ok(sameRoute('藍1區間車', '藍1'));
  assert.ok(!sameRoute('5', '5608'));
  const now = T('08:00');
  const rows = [{ RouteName: { Zh_tw: '5608' }, StopStatus: 0, EstimateTime: 900, Estimates: [{ EstimateTime: 900 }, { EstimateTime: 2400 }] }];
  assert.deepEqual(liveTimes(rows, '5608', now).times.map(t => (t.at - now) / 60_000), [15, 40]);
  assert.equal(liveTimes([{ RouteName: { Zh_tw: '5608' }, StopStatus: 3 }], '5608', now).off, 3);
  const p = finish({ legs: [
    { mode: 'walk', dur: 300, dist: 300, dep: T('08:00'), arr: T('08:05'), from: { lat: 24.8, lon: 121 }, to: { lat: 24.801, lon: 121 } },
    { mode: 'bus', short: '5608', dur: 1200, dist: 9000, dep: T('08:06'), arr: T('08:26'), from: { name: '東關東', lat: 24.801, lon: 121 }, to: { name: '竹東高中', lat: 24.733, lon: 121.088 } }
  ] });
  const q = await adjustPlan(p, now, { near: async () => rows });
  assert.equal(q.legs[1].dep, T('08:15'), 'the bus TDX says comes at 08:15');
  assert.equal(q.arr, T('08:35'));
  assert.equal(q.legs[0].arr, T('08:14'), 'leave so as to be there a minute before');
  assert.ok(q.live);
  const none = await adjustPlan(p, now, { near: async () => [] });
  assert.equal(none.arr, p.arr, 'nothing from TDX: as planned');
});

test('a bus ride’s minutes: the timetable’s when a trip lists both stops, else the distance', () => {
  const way = { dir: 0, stops: [{ uid: 'A', lat: 24.8, lon: 121 }, { uid: 'B', lat: 24.81, lon: 121 }, { uid: 'C', lat: 24.82, lon: 121 }] };
  const sched = [{ Direction: 0, Timetables: [{ StopTimes: [{ StopUID: 'A', DepartureTime: '08:00' }, { StopUID: 'C', DepartureTime: '08:12' }] }] }];
  assert.equal(rideTime(way, 0, 2, sched), 720);
  const est = rideTime(way, 0, 2, []);
  assert.ok(est > 300 && est < 600, `${est}`);
});

test('a saved trip’s way now: out from home, back from its far end, the time today or tomorrow', async () => {
  const { tripNow } = await import('../public/lib/tab-go.mjs');
  const home = { name: '家', lat: 24.821, lon: 121.018 };
  const school = { name: '學校', lat: 24.733, lon: 121.088 };
  const t = cleanSaved({ id: 's1', name: '上學', from: home, to: school, time: '07:30', days: [1, 2, 3, 4, 5], back: '17:00' });
  const mon7 = T('07:00'); // 2026-10-05 is a Monday
  const out = tripNow(t, home, mon7);
  assert.equal(out.to.name, '學校');
  assert.equal(out.from, null, 'from where you are (at home)');
  assert.equal(out.at, T('07:30'));
  assert.ok(out.today);
  const back = tripNow(t, school, T('16:00'));
  assert.equal(back.to.name, '家', 'at school: the way home');
  assert.equal(back.at, T('17:00'));
  assert.equal(tripNow(t, home, T('09:00')).at, twAt('2026-10-06', '07:30'), 'past today: tomorrow’s');
});

test('by a departure time: a plan that has you leave before it sinks out; riding most of the way sinks', () => {
  const o = { lat: 24.821, lon: 121.018 };
  const d = { lat: 24.733, lon: 121.088 };
  const leg = (mode, short, dep, arr, x = {}) => ({ mode, short, from: { name: short, ...o }, to: { name: short, ...d }, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist: 0, ...x });
  const early = finish({ legs: [leg('bike', 'YouBike', '05:40', '06:00'), leg('tra', '區間 1234', '06:02', '06:25')] });
  const after = finish({ legs: [leg('bus', '快捷8號', '06:05', '06:40')] });
  const ranked = rank([early, after], { now: T('06:00'), o, d });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].legs[0].short, '快捷8號');
  // By an arrival time: what arrives late goes, what arrives before stays.
  const arr = rank([early, after], { now: T('06:30'), by: 'arrive', deadline: T('06:30'), clock: T('05:00'), o, d });
  assert.deepEqual(arr.map(p => p.legs[0].short), ['YouBike']);
  // 55 minutes on a bike against 50 by bus with a change: the bus first.
  const ride = finish({ legs: [leg('bike', 'YouBike', '06:05', '07:00')] });
  const mid = { name: '竹東', lat: 24.777, lon: 121.053 };
  const bus = finish({ legs: [leg('bus', '5608', '06:05', '06:30', { to: mid }), leg('bus', '5700', '06:32', '06:55', { from: mid })] });
  assert.equal(rank([ride, bus], { now: T('06:00'), o, d })[0].legs[0].short, '5608');
});

test('YouBike fills gaps: two short rides around a train beat one long ride, even arriving 10 minutes later', () => {
  const o = { lat: 24.821, lon: 121.018 };
  const d = { lat: 24.733, lon: 121.088 };
  const leg = (mode, short, dep, arr, x = {}) => ({ mode, short, from: { name: short, ...o }, to: { name: short, ...d }, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist: 0, ...x });
  const long = finish({ legs: [leg('bike', 'YouBike', '06:07', '06:35')] });
  const train = finish({ legs: [leg('bike', 'YouBike', '06:05', '06:13'), leg('tra', '區間 1234', '06:16', '06:35'), leg('bike', 'YouBike', '06:37', '06:45')] });
  assert.equal(rank([long, train], { now: T('06:00') })[0].legs[1]?.mode, 'tra');
  // A ride cut at 30 minutes (to stay free) is still one long ride.
  const cut = finish({ legs: [leg('bike', 'YouBike', '06:05', '06:30'), leg('bike', 'YouBike', '06:31', '06:44', { swap: true })] });
  const two = finish({ legs: [leg('bike', 'YouBike', '06:05', '06:25'), leg('tra', '區間', '06:27', '06:30'), leg('bike', 'YouBike', '06:31', '06:44')] });
  assert.ok(score(cut, { now: T('06:00') }) > score(two, { now: T('06:00') }));
  // A short ride still beats a bus with a change.
  const short = finish({ legs: [leg('bike', 'YouBike', '06:02', '06:14')] });
  const buses = finish({ legs: [leg('bus', '1', '06:03', '06:08'), leg('bus', '2', '06:10', '06:13')] });
  assert.equal(rank([buses, short], { now: T('06:00') })[0].legs[0].mode, 'bike');
});

test('a pinned recommendation: known by its lines (trains by their stations), shown first in 交通', async () => {
  const { pickSig } = await import('../public/lib/plan.mjs');
  const { tripPlans } = await import('../public/lib/tab-go.mjs');
  const a = { mode: 'tra', short: '區間 1234', from: { name: '竹北車站' }, to: { name: '竹東' } };
  const b = { mode: 'tra', short: '區間 1250', from: { name: '竹北' }, to: { name: '竹東站' } };
  assert.equal(pickSig({ legs: [a] }), pickSig({ legs: [b] }), 'another day’s train, another planner’s names');
  assert.equal(pickSig({ legs: [{ mode: 'bus', short: '快捷8號' }] }), pickSig({ legs: [{ mode: 'bus', name: '快捷8' }] }));
  assert.equal(pickSig({ legs: [{ mode: 'bike' }] }), 'bike');
  const now = T('07:00');
  const P = (k, dep, top) => ({ legs: [{ mode: 'bus', short: k }], dep: T(dep), arr: T(dep) + 1, top });
  const plans = [P('YouBike', '07:01', true), P('A', '07:02', true), P('B', '07:03', true), P('C', '07:04', true), P('5608', '07:30', false), P('5608', '07:10', false), P('5608', '07:50', false)];
  const { first, rest } = tripPlans(plans, [pickSig(P('5608'))], now);
  assert.deepEqual(first.map(p => `${p.legs[0].short} ${(p.dep - now) / 60_000}`), ['5608 10', 'YouBike 1', 'A 2', 'B 3'], 'the pinned way once: its other times are picked on its row');
  assert.equal(rest.length, 1);
  assert.equal(cleanSaved({ to: { name: 'x', lat: 24.8, lon: 121 }, picks: ['a', 'a', 5, 'b'] }).picks.join(), 'a,b');
});

test('the day’s trains kept compact: the same trips back', async () => {
  const { packTrips, unpackTrips } = await import('../public/lib/raildata.mjs');
  const trips = [{ id: 't', sys: 'tra', no: '1', code: '6', stops: [{ st: 'tra:1210', arr: T('23:50'), dep: T('23:52') }, { st: 'tra:1180', arr: twAt('2026-10-06', '00:05'), dep: twAt('2026-10-06', '00:05') }] }];
  const back = unpackTrips(JSON.parse(JSON.stringify(packTrips('2026-10-05', trips))));
  assert.deepEqual(back, trips);
});

test('navigation only for a plan leaving soon; its ride said the way the sign says it', async () => {
  const { canNav, rideName } = await import('../public/lib/nav.mjs');
  const now = T('07:00');
  assert.ok(canNav({ dep: T('07:15'), arr: T('08:00') }, now));
  assert.ok(!canNav({ dep: T('07:40'), arr: T('08:00') }, now));
  assert.ok(canNav({ dep: T('06:50'), arr: T('08:00') }, now), 'already on the way');
  assert.equal(rideName({ mode: 'tra', short: '區間 1234', train: { no: '1234' } }), '台鐵 區間 1234 次');
  assert.equal(rideName({ mode: 'tra', short: '區間車' }), '台鐵 區間車');
  assert.equal(rideName({ mode: 'hsr', short: '613 次' }), '高鐵 613 次');
  assert.equal(rideName({ mode: 'bus', short: '5608' }), '公車 5608');
});

test('inside your TPASS area only what the pass takes: no 高鐵, no 普悠瑪, unless that’s all', () => {
  const pass = tpassOf('hh');
  const city = pt => (pt.lat > 24.6 ? 'HsinchuCounty' : 'Taipei');
  const a = { lat: 24.8, lon: 121 };
  const b = { lat: 24.7, lon: 121.1 };
  const leg = (mode, extra, dep, arr) => ({ mode, from: a, to: b, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist: 0, ...extra });
  const puyuma = finish({ legs: [leg('tra', { name: '自強(普悠瑪)', short: '自強 123', train: { code: '2' } }, '08:00', '08:20')] });
  const local = finish({ legs: [leg('tra', { name: '區間', short: '區間 1234', train: { code: '6' } }, '08:05', '08:40')] });
  const hsr = finish({ legs: [leg('hsr', { name: '高鐵' }, '08:00', '08:10')] });
  assert.ok(inPass(a, b, pass, city));
  assert.equal(inPass(a, { lat: 24.5, lon: 121.5 }, pass, city), false);
  assert.deepEqual([puyuma, local, hsr].map(p => passOk(p, pass, city)), [false, true, false]);
  assert.equal(coverage(puyuma, pass, city).all, false);
  const keep = p => passOk(p, pass, city);
  assert.deepEqual(rank([puyuma, local, hsr], { now: T('08:00'), keep }).map(p => p.legs[0].name), ['區間']);
  assert.equal(rank([puyuma, hsr], { now: T('08:00'), keep }).length, 2);
});

test('a change gone: by YouBike to the one bus that goes the whole way', () => {
  const o = { lat: 24.821, lon: 121.018 };
  const s = { lat: 24.835, lon: 121.0 }; // where the second bus boards, ~2.4 km away
  const d = { lat: 24.733, lon: 121.088 };
  const bikes = [
    { uid: 'h', name: '家', lat: 24.8212, lon: 121.0182, bikes: 4, ebike: 0, ret: 4, ok: true },
    { uid: 's', name: '轉乘站', lat: 24.8352, lon: 121.0002, bikes: 2, ebike: 0, ret: 6, ok: true }
  ];
  const leg = (mode, short, a, b, dep, arr) => ({ mode, short, from: { name: short, ...a }, to: { name: short, ...b }, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist: 0 });
  const two = finish({ legs: [leg('bus', '5615', o, s, '08:00', '08:12'), leg('bus', '5608', s, d, '08:25', '09:05')] });
  const ranked = withBikes([two], o, d, bikes, T('07:55'), { modes: null });
  const direct = ranked.find(p => p.legs.some(l => l.mode === 'bike') && p.legs.filter(l => l.mode === 'bus').length === 1);
  assert.ok(direct, 'a plan riding to the 5608');
  assert.equal(direct.legs.find(l => l.mode === 'bus').short, '5608');
  assert.equal(ranked[0], direct);
});

test('a weekday trip on a Sunday is Monday’s; a day of its own keeps its own time', async () => {
  const { tripNow } = await import('../public/lib/tab-go.mjs');
  const home = { name: '家', lat: 24.821, lon: 121.018 };
  const school = { name: '學校', lat: 24.733, lon: 121.088 };
  const t = cleanSaved({ id: 's1', name: '上學', from: home, to: school, time: '07:30', days: [1, 2, 3, 4, 5], back: '17:00', alt: [{ days: [3], time: '09:10', back: '' }, { days: [3, 5], time: '', back: '15:00' }] });
  assert.deepEqual(t.alt, [{ days: [3], time: '09:10', back: '' }, { days: [5], time: '', back: '15:00' }]);
  const sun = twAt('2026-10-04', '20:00'); // a Sunday
  assert.equal(tripNow(t, home, sun).at, twAt('2026-10-05', '07:30'));
  assert.equal(tripNow(t, home, twAt('2026-10-06', '09:00')).at, twAt('2026-10-07', '09:10'), 'Tuesday after: Wednesday’s own time');
  assert.equal(tripNow(t, school, twAt('2026-10-09', '12:00')).at, twAt('2026-10-09', '15:00'), 'Friday home earlier');
  assert.equal(tripNow(t, school, twAt('2026-10-08', '12:00')).at, twAt('2026-10-08', '17:00'));
  assert.equal(tripNow(t, home, twAt('2026-10-08', '20:00')).at, twAt('2026-10-09', '07:30'), 'Friday out: the usual time');
});

test('the buzz: a chime where there’s no vibrating (an iPhone), once a tap has started the audio', async () => {
  const { buzz, primeBuzz } = await import('../public/lib/buzz.mjs');
  const started = [];
  const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  globalThis.AudioContext = class {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { return { gain: param, connect: x => x }; }
    createOscillator() { return { frequency: {}, connect: x => x, start: t => started.push(t), stop() {} }; }
  };
  try {
    buzz();
    assert.equal(started.length, 0, 'no sound before a tap');
    primeBuzz();
    buzz();
    assert.equal(started.length, 2, 'two notes');
    const pulses = [];
    Object.defineProperty(navigator, 'vibrate', { value: p => pulses.push(p) > 0, configurable: true });
    buzz();
    assert.deepEqual(pulses, [[200, 100, 200]]);
    assert.equal(started.length, 2, 'a phone that vibrates: no chime');
  } finally {
    delete globalThis.AudioContext;
    delete navigator.vibrate;
  }
});

test('a bus alert as the Worker’s notice: the stop’s own TDX ask, checked from when it was set for two hours', async () => {
  const { pushItem } = await import('../public/lib/alerts.mjs');
  const a = { id: 'a1', at: 1_000, route: '5608', routeUID: 'HSZ0058', dir: '0', min: 5, station: { uid: 'HSZ1234', id: '1234', cityCode: 'HSZ', name: '竹東高中' } };
  const item = pushItem(a);
  assert.equal(item.until - item.at, 2 * 60 * 60_000);
  assert.equal(item.kind, 'bus');
  assert.equal(item.body, '{result}（竹東高中）');
  assert.deepEqual({ ...item.check.bus, path: undefined }, { path: undefined, route: 'HSZ0058', dir: 0, min: 5 });
  // What push.js takes: a station's arrivals, by City or InterCity.
  assert.match(item.check.bus.path, /^advanced\/v2\/Bus\/EstimatedTimeOfArrival\/City\/Hsinchu\/PassThrough\/Station\/1234\?\$select=/);
});

test('a stop’s timetable an hour a row; any day of the coming week', async () => {
  const { hours } = await import('../public/lib/bus-ui.mjs');
  assert.deepEqual(hours(['06:00', '06:20', '07:40', '24:10']), [['06', ['06:00', '06:20']], ['07', ['07:40']], ['24', ['24:10']]]);
  const { stopTimes } = await import('../public/lib/bus.mjs');
  const day = on => Object.fromEntries(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => [d, on(i) ? 1 : 0]));
  const trip = (at, on) => ({ ServiceDay: day(on), StopTimes: [{ StopUID: 'S1', DepartureTime: at }] });
  const sched = [{ Direction: 0, Timetables: [trip('06:00', d => d >= 1 && d <= 5), trip('08:00', d => d === 0 || d === 6)] }];
  assert.deepEqual(stopTimes(sched, { stopUID: 'S1', dir: 0 }, '2026-10-04', 0).times, ['08:00'], 'a Sunday');
  assert.deepEqual(stopTimes(sched, { stopUID: 'S1', dir: 0 }, '2026-10-05', 1).times, ['06:00'], 'the Monday after');
});

test('a pinned ride: on and off, and the way back by itself from wherever you are nearer', async () => {
  const { rideNow } = await import('../public/lib/tab-go.mjs');
  const { cleanItem } = await import('../public/lib/store.mjs');
  const it = cleanItem({ id: 'i1', city: 'Hsinchu', routeUID: 'HSZ0001', route: '藍1', dir: 0, stopUID: 'A0', stop: '新竹火車站', headsign: '竹北火車站', lat: 24.8016, lon: 120.9716, off: { stopUID: 'B0', stop: '竹北火車站', lat: 24.8395, lon: 121.0093 }, n: 12, back: { dir: 1, stopUID: 'B1', stop: '竹北火車站', headsign: '新竹火車站', lat: 24.8396, lon: 121.0094, off: { stopUID: 'A1', stop: '新竹火車站', lat: 24.8017, lon: 120.9717 } } });
  assert.equal(it.off.stop, '竹北火車站');
  assert.equal(it.back.off.stopUID, 'A1');
  const home = { lat: 24.802, lon: 120.972 };
  const work = { lat: 24.839, lon: 121.009 };
  assert.equal(rideNow(it, home).stopUID, 'A0', 'near where you get on: that way');
  const back = rideNow(it, work);
  assert.deepEqual([back.stopUID, back.off.stop, back.back], ['B1', '新竹火車站', true], 'near where you got off: the way back');
  assert.equal(rideNow(it, work, true).stopUID, 'A0', '⇄ turns it round');
  const alone = cleanItem({ routeUID: 'HSZ0001', stopUID: 'A0', stop: '新竹火車站' });
  assert.equal(rideNow(alone, work).stopUID, 'A0', 'a stop pinned alone stays');
  assert.equal(alone.off, undefined);
});

test('新竹縣體育場 → 新竹大遠百: by bike to 竹北 for the train, not 28 minutes on a 電輔車, not on to 北新竹 for the same train; one of each way', () => {
  const o = { name: '新竹縣體育場', lat: 24.8212, lon: 121.0176 };
  const d = { name: '新竹大遠百', lat: 24.8018, lon: 120.9653 };
  const zhubei = { name: '竹北', lat: 24.8392, lon: 121.0095 };
  const north = { name: '北新竹', lat: 24.8086, lon: 120.9838 };
  const hsinchu = { name: '新竹', lat: 24.8016, lon: 120.9716 };
  const st = (uid, pt, n = 8) => ({ uid, name: `${pt.name}站`, lat: pt.lat + 0.0003, lon: pt.lon + 0.0003, bikes: n, ebike: n, ret: n, ok: true });
  const bikes = [st('o', o), st('z', zhubei), st('n', north), st('h', hsinchu), st('d', d)];
  const train = (from, dep) => ({ mode: 'tra', name: '區間', short: '區間 1187', train: { sys: 'tra', no: '1187' }, from, to: hsinchu, dep: T(dep), arr: T('08:29'), dur: (T('08:29') - T(dep)) / 1000 });
  const walkEnd = { mode: 'walk', from: hsinchu, to: d, dep: T('08:30'), arr: T('08:39'), dur: 540, dist: 700 };
  const ph = (to, dep, arr) => ({ mode: 'bike', placeholder: true, fix: 'arr', from: o, to, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist: 0 });
  const viaZhubei = finish({ src: 'rail', legs: [ph(zhubei, '08:02', '08:17'), train(zhubei, '08:20'), walkEnd] });
  const viaNorth = finish({ src: 'rail', legs: [ph(north, '07:59', '08:22'), train(north, '08:25'), walkEnd] });
  const walked = finish({ src: 'rail', legs: [{ mode: 'walk', from: o, to: zhubei, dep: T('07:50'), arr: T('08:17'), dur: 1620, dist: 2600 }, train(zhubei, '08:20'), walkEnd] });
  const list = withBikes([viaZhubei, viaNorth, walked], o, d, bikes, T('08:00'));
  assert.equal(list[0].legs.find(l => l.mode === 'tra').from.name, '竹北', list.map(p => `${p.score} ${p.legs.map(l => l.mode + ':' + (l.from?.name || '')).join(' ')}`).join('\n'));
  assert.equal(list.filter(p => p.legs.some(l => l.train?.no === '1187')).length, 1, 'the train 1187 once, by the best way onto it');
  assert.ok(list.filter(p => !p.legs.some(l => l.mode !== 'walk' && l.mode !== 'bike')).length <= 1, 'all the way by bike once (bike or 電輔車)');
});

test('a 15-minute walk to the bus loses to riding to the same bus; a route nobody would take is set aside; one card per route with its times', () => {
  const o = { name: '家', lat: 24.8212, lon: 121.0176 };
  const stop = { name: '站牌', lat: 24.8312, lon: 121.0176 }; // ~1.1 km
  const d = { name: '那裡', lat: 24.80, lon: 120.96 };
  const st = (uid, pt) => ({ uid, name: `${pt.name}站`, lat: pt.lat + 0.0002, lon: pt.lon, bikes: 1, ebike: 0, ret: 5, ok: true });
  const bikes = [st('o', o), st('s', stop)];
  const bus = (dep, arr) => ({ mode: 'bus', short: '81', from: stop, to: d, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000 });
  const walk = (dep, arr) => ({ mode: 'walk', from: o, to: stop, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist: 1150 });
  const walked = finish({ legs: [walk('08:05', '08:20'), bus('08:21', '08:45')] });
  const later = finish({ legs: [walk('08:25', '08:40'), bus('08:41', '09:05')] });
  const list = withBikes([walked, later], o, d, bikes, T('08:00'), { modes: { bus: true, bike: true } });
  const lead = list.find(p => p.lead && !p.weak && p.legs.some(l => l.mode === 'bus'));
  assert.equal(lead.legs[0].mode === 'walk' ? lead.legs[1].mode : lead.legs[0].mode, 'bike', 'ridden to the 81');
  assert.ok(lead.times.length >= 2, 'the 81’s later one is a time on its card');
  assert.equal(list.filter(p => p.lead && !p.weak && p.legs.some(l => l.short === '81')).length, 1);
  // Without bikes, walking is the way.
  const off = withBikes([walked, later], o, d, bikes, T('08:00'), { modes: { bus: true, bike: false } });
  assert.equal(off[0].legs[0].mode, 'walk');
});

test('新竹縣體育場 → 新竹大遠百, every real choice shown: both train lines (竹北, 六家), the buses, and riding; the same line’s trains as times on one card', () => {
  const o = { name: '新竹縣體育場', lat: 24.8212, lon: 121.0176 };
  const d = { name: '新竹大遠百', lat: 24.8018, lon: 120.9653 };
  const zhubei = { name: '竹北', lat: 24.8392, lon: 121.0095 };
  const liujia = { name: '六家', lat: 24.8076, lon: 121.0402 };
  const hsinchu = { name: '新竹', lat: 24.8016, lon: 120.9716 };
  const stopO = { name: '縣體育場', lat: 24.8225, lon: 121.0165 };
  const stopD = { name: '大遠百', lat: 24.8025, lon: 120.9660 };
  const st = (uid, pt) => ({ uid, name: `${pt.name}站`, lat: pt.lat + 0.0003, lon: pt.lon + 0.0003, bikes: 8, ebike: 8, ret: 8, ok: true });
  const bikes = [st('o', o), st('z', zhubei), st('l', liujia), st('h', hsinchu), st('d', d)];
  const ph = (to, dep, arr) => ({ mode: 'bike', placeholder: true, fix: 'arr', from: o, to, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist: 0 });
  const train = (no, from, dep, arr) => ({ mode: 'tra', name: '區間', short: `區間 ${no}`, train: { sys: 'tra', no }, from, to: hsinchu, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000 });
  const walkEnd = t => ({ mode: 'walk', from: hsinchu, to: d, dep: T(t), arr: T(t) + 540_000, dur: 540, dist: 700 });
  const rail = (to, no, b0, b1, t0, t1) => finish({ src: 'rail', legs: [ph(to, b0, b1), train(no, to, t0, t1), walkEnd(t1)] });
  const bus = (no, dep, arr) => finish({ src: 'tdx', legs: [{ mode: 'walk', from: o, to: stopO, dep: T(dep) - 240_000, arr: T(dep), dur: 240, dist: 250 }, { mode: 'bus', short: no, from: stopO, to: stopD, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000 }, { mode: 'walk', from: stopD, to: d, dep: T(arr), arr: T(arr) + 120_000, dur: 120, dist: 120 }] });
  const plans = [
    rail(zhubei, '1187', '08:02', '08:17', '08:20', '08:29'),
    rail(zhubei, '1191', '08:22', '08:37', '08:40', '08:49'),
    rail(liujia, '1305', '08:05', '08:19', '08:22', '08:42'),
    bus('182', '08:06', '08:44'),
    bus('5615', '08:12', '08:50'),
    bus('5614', '08:20', '09:02')
  ];
  const list = withBikes(plans, o, d, bikes, T('08:00'));
  const shown = list.filter(p => p.lead && !p.weak);
  const has = f => shown.some(p => p.legs.some(f));
  const why = list.map(p => `${p.score} ${p.lead ? 'L' : ' '}${p.weak ? 'W' : ' '} ${p.legs.map(l => l.mode + ':' + (l.short || l.from?.name || '')).join(' ')}`).join('\n');
  assert.ok(has(l => l.mode === 'tra' && l.from.name === '竹北'), why);
  assert.ok(has(l => l.mode === 'tra' && l.from.name === '六家'), why);
  for (const no of ['182', '5615', '5614']) assert.ok(has(l => l.short === no), `${no}\n${why}`);
  assert.ok(shown.some(p => p.bike && !p.legs.some(l => l.mode === 'tra' || l.mode === 'bus')), 'riding all the way');
  const zb = shown.find(p => p.legs.some(l => l.mode === 'tra' && l.from.name === '竹北'));
  assert.deepEqual(zb.times.map(i => list[i].legs.find(l => l.mode === 'tra').train.no), ['1187', '1191'], 'both trains on the 竹北 card');
});

test('a route’s other departures: the next trains between the same stations, the next buses at the stop, the way there moved to meet each', async () => {
  const { moreTrains, moreBuses } = await import('../public/lib/plan.mjs');
  const o = { name: '家', lat: 24.8030, lon: 120.9690 };
  const d = { name: '公司', lat: 25.0500, lon: 121.5200 };
  const base = railPlans(net, o, d, T('08:10')).find(p => p.legs.filter(l => l.mode === 'tra' || l.mode === 'hsr').length === 1);
  assert.ok(base, 'a one-train plan');
  const more = moreTrains(base, net, T('08:10'));
  assert.ok(more.length >= 1, 'a later train');
  const ride = p => p.legs.find(l => l.mode === 'tra' || l.mode === 'hsr');
  for (const p of more) {
    assert.equal(ride(p).from.name, ride(base).from.name);
    assert.equal(ride(p).to.name, ride(base).to.name);
    assert.notEqual(ride(p).train.no, ride(base).train.no);
    assert.ok(p.dep >= T('08:10') - 60_000, 'not before now');
    assert.equal(ride(p).dep - p.dep, ride(base).dep - base.dep, 'the same way there, moved');
  }
  const stop = { name: '站', lat: 24.81, lon: 120.97 };
  const bus = finish({ legs: [{ mode: 'walk', from: o, to: stop, dep: T('08:00'), arr: T('08:05'), dur: 300, dist: 300 }, { mode: 'bus', short: '81', from: stop, to: d, dep: T('08:06'), arr: T('08:30'), dur: 1440, next: [T('08:21'), T('08:36')] }] });
  const later = moreBuses(bus, T('08:00'));
  assert.deepEqual(later.map(p => [p.dep, p.arr]), [[T('08:15'), T('08:45')], [T('08:30'), T('09:00')]]);
});

test('the buses after one: TDX’s later estimates, else the stop’s timetable, else its headway', async () => {
  const { nextBuses } = await import('../public/lib/live.mjs');
  const row = { RouteName: { Zh_tw: '182' }, RouteUID: 'HSZ182', StopUID: 'HSZ1', StopName: { Zh_tw: '縣體育場' }, Direction: 0 };
  const at = twAt('2026-10-05', '08:06');
  const sched = [{ Direction: 0, Timetables: ['07:46', '08:06', '08:26', '08:46', '09:06'].map(t => ({ StopTimes: [{ StopUID: 'HSZ1', DepartureTime: t }] })) }];
  assert.deepEqual(await nextBuses([row], '182', at, [], { schedule: async () => sched }), ['08:26', '08:46', '09:06'].map(t => twAt('2026-10-05', t)));
  const freq = [{ Direction: 0, Frequencys: [{ StartTime: '06:00', EndTime: '22:00', MinHeadwayMins: 15, MaxHeadwayMins: 25 }] }];
  assert.deepEqual(await nextBuses([row], '182', at, [], { schedule: async () => freq }), [20, 40, 60].map(m => at + m * 60_000));
  const live = [{ at: at + 12 * 60_000 }, { at: at + 30 * 60_000 }, { at: at + 50 * 60_000 }];
  assert.equal((await nextBuses([row], '182', at, live, { schedule: async () => { throw new Error('not asked'); } })).length, 3);
});
