// Orbit Transit's logic without a browser or network: the train router, the
// YouBike plans, bus times, the pass's data, the polylines, the metro map.
import test from 'node:test';
import assert from 'node:assert/strict';
import { traStations, hsrStations, traTrips, hsrTrips, network, links, journeys, earliest, directs, tags, traFare, hsrFare } from '../public/lib/rail.mjs';
import { withBikes, bikeOnly, bikeToRail, bikeFromRail, rentNear, returnNear, rank, bikePoints, railPlans, allowed, swapRides, bikeTrip, score, finish, inOrder, sameWay } from '../public/lib/plan.mjs';
import { coverage, fareOf, tpassOf, passOk, inPass, routeOnPass, bikeSwap } from '../public/lib/tpass.mjs';
import { sameRoute, liveTimes, adjustPlan, rideTime, officialLeg } from '../public/lib/live.mjs';
import { etaText, etaOf, findRoutes, parseStops, etaMap, stopTimes, runsOn, stopSides } from '../public/lib/bus.mjs';
import { mergeBikes, bikeName, bikeLevel } from '../public/lib/bike.mjs';
import { emptyData, encodeData, decodeData, mergeData, cleanData, remember, trainKey, move, cleanSaved, cleanPin, cleanPrefs, modeList, cleanEnd, cleanPlace } from '../public/lib/store.mjs';
import { navNotices, navTimes, paceOf, gmapsLink, legEnd, rideName, wayText, boardHtml, leftText, tripAt, retimeRide, lateBy, onTimeWay, offerText, stageView } from '../public/lib/nav.mjs';
import { busWhere, busAhead, trainWhere, nextStop, countText, trainFor, routeCum, alongRoute, ridePace, aheadByPace } from '../public/lib/navlive.mjs';
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
  { uid: 'c', name: '暫停站', lat: 24.8011, lon: 120.9901, bikes: 0, ebike: 0, ret: 0, ok: false },
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

test('YouBike stations: by where they are, not by the bikes or docks there now, except where a trip starts with the bike: never one empty as you plan (the owner, 2026-10-13); one out of service isn’t one', () => {
  assert.equal(rentNear(O, BIKES).uid, 'a');
  assert.equal(rentNear(O, BIKES, { ebike: true }).uid, 'a');
  const station = { lat: 24.8020, lon: 120.9718 };
  const near = { uid: 'n', name: '旁邊', lat: 24.8024, lon: 120.9722, bikes: 2, ebike: 0, ret: 4, ok: true };
  // A bike taken later (off a train): by place, the counts will have changed.
  assert.equal(rentNear(station, [...BIKES, near]).uid, 'b', 'later on: still the station there');
  // The trip starts with it: one that has a bike now.
  assert.equal(rentNear(station, BIKES, { first: true }), null, 'no bike there now: not where you take one');
  assert.equal(rentNear(station, [...BIKES, near], { first: true }).uid, 'n', 'the next one that has a bike');
  assert.equal(rentNear(station, [...BIKES, near], { first: true, ebike: true }), null, 'a 電輔車 ride: one with a 電輔車');
  assert.equal(rentNear(station, [...BIKES, { ...near, bikes: 0, ebike: 1 }], { first: true }).uid, 'n', 'a 電輔車 is a bike to take');
  // Where it goes back: full or not, the nearest (navigating, 換附近的站 is a tap).
  assert.equal(returnNear(station, [...BIKES, near]).uid, 'b');
  assert.equal(returnNear(station, [{ ...BIKES[1], ret: 0 }, near]).uid, 'b');
  // Riding the whole way from beside the empty one: from the one with bikes.
  const ride = bikeOnly(station, { lat: 24.8013, lon: 120.9906 }, [...BIKES, near], Date.now())[0];
  assert.ok(ride, 'riding it all');
  assert.equal(ride.legs.find(l => l.mode === 'bike').rent.uid, 'n');
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

test('a planner’s walk that ends after its bus has left: set out earlier', async () => {
  const { tidy } = await import('../public/lib/plan.mjs');
  const p = finish({ legs: [{ mode: 'walk', dep: T('07:59'), arr: T('08:03'), dur: 240 }, { mode: 'bus', dep: T('08:01'), arr: T('08:15'), dur: 840 }, { mode: 'walk', dep: T('08:15'), arr: T('08:20'), dur: 300 }] });
  const t = tidy(p);
  assert.equal(t.legs[0].arr, T('08:01'));
  assert.equal(t.dep, T('07:57'));
  assert.equal(tidy(t), t, 'in order: as it is');
});

test('a plan that waits overnight half way, or leaves tomorrow, says so', () => {
  const p = finish({ legs: [{ mode: 'tra', name: '區間車', from: { name: '六家' }, to: { name: '北新竹' }, dep: T('23:09'), arr: T('23:25'), dur: 960 }, { mode: 'bus', short: '72', from: { name: '北新竹後站' }, to: { name: '富群街口' }, dep: T('23:25') + 7.5 * 3600e3, arr: T('23:25') + 8 * 3600e3, dur: 1800 }] });
  const [r] = rank([p], { now: T('22:00') });
  assert.match(r.late, /北新竹後站等到 06:55（隔天）/);
  const q = finish({ legs: [{ mode: 'bus', short: '5621', from: { name: '街尾' }, to: { name: '前溪' }, dep: T('22:00') + 8 * 3600e3, arr: T('22:00') + 8.5 * 3600e3, dur: 1800 }] });
  assert.match(rank([q], { now: T('22:00') })[0].late, /^明天 06:00 才有車/);
});

test('a planner’s plan leaving minutes before the time asked: on the metro, the same a train later; by bus, gone', () => {
  const m = finish({ legs: [{ mode: 'walk', dep: T('07:55'), arr: T('07:58'), dur: 180 }, { mode: 'metro', short: '淡水信義線', dep: T('07:58'), arr: T('08:49'), dur: 3060 }] });
  const b = finish({ legs: [{ mode: 'walk', dep: T('07:52'), arr: T('07:57'), dur: 300 }, { mode: 'bus', short: '756', dep: T('07:57'), arr: T('08:45'), dur: 2880 }] });
  const out = rank([m, b], { now: T('08:00') });
  assert.equal(out.length, 1);
  assert.equal(out[0].dep, T('08:00'));
});

test('竹東 → 新竹 by train, straight through or changing at 竹中: one card, its times saying which', async () => {
  const { pickSig } = await import('../public/lib/plan.mjs');
  const { depChips } = await import('../public/lib/ui.mjs');
  const st = n => ({ name: n, lat: 24.8, lon: 121 });
  const direct = finish({ legs: [{ mode: 'tra', short: '區間 1817', from: st('竹東'), to: st('新竹'), dep: T('09:12'), arr: T('09:50'), dur: 2280 }] });
  const change = finish({ legs: [{ mode: 'tra', short: '區間 1805', from: st('竹東'), to: st('竹中'), dep: T('08:12'), arr: T('08:20'), dur: 480 }, { mode: 'tra', short: '區間 1789', from: st('竹中'), to: st('新竹'), dep: T('08:25'), arr: T('08:45'), dur: 1200 }] });
  assert.equal(pickSig(direct), pickSig(change));
  const html = depChips([change, direct], [0, 1], 0, i => `data-i="${i}"`);
  assert.match(html, /08:12<small>竹中轉<\/small>/);
  assert.match(html, /09:12<small>直達<\/small>/);
});

test('a station near both ends: no train-less "journey" (from 千甲 to 千甲) in place of the trains', () => {
  assert.deepEqual(journeys(net, [{ key: 'tra:1210', at: T('08:00') }], [{ key: 'tra:1210', extra: 0 }], T('08:00')), []);
  const j = journeys(net, [{ key: 'tra:1210', at: T('08:00') }], [{ key: 'tra:1000', extra: 0 }], T('08:00'));
  assert.ok(j.length && j.every(x => x.legs.some(l => !l.walk)));
});

test('ranking: by what’s practical, every plan kept however late, the first few recommended, each labelled', () => {
  const list = withBikes([busPlan], O, D, BIKES, T('07:59'));
  assert.ok(list.length >= 2);
  assert.ok(list[0].score <= list[1].score);
  assert.ok(list[0].tags.includes('推薦'));
  assert.ok(list[0].top);
  assert.ok(list.some(p => p.tags.includes('YouBike')));
  const later = { ...busPlan, arr: busPlan.arr + 1_800_000, dur: busPlan.dur + 1800, legs: busPlan.legs.map(l => ({ ...l, dep: l.dep + 1_800_000, arr: l.arr + 1_800_000 })) };
  assert.equal(rank([busPlan, later], { now: T('07:59'), clock: T('07:59') }).length, 2, 'a later bus is still shown');
  assert.equal(rank([busPlan, { ...busPlan }], { now: T('07:59'), clock: T('07:59') }).length, 1, 'the same ride once');
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
  assert.equal(mine.legs[0].from.name, '家附近', 'the station in service');
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
  assert.equal(bikeSwap({ bike30: false, tpass: 'thhm' }), true, 'TPASS with YouBike: cut every 30 minutes');
  assert.equal(bikeSwap({ bike30: false, tpass: '' }), false);
  assert.equal(bikeSwap({ bike30: true, tpass: '' }), true);
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

test('TPASS: a route its official table leaves out (新竹縣 觀光8號) is paid, though inside its cities', () => {
  const city = () => 'HsinchuCounty';
  const ride = short => ({ legs: [{ mode: 'bus', short, name: short, from: { lat: 24.8, lon: 121 }, to: { lat: 24.7, lon: 121.1 } }], fare: 90 });
  for (const id of ['hh', 'hhm', 'thh', 'thhm']) {
    assert.equal(coverage(ride('觀光8號'), tpassOf(id), city).some, false, id);
    assert.equal(passOk(ride('觀光8號'), tpassOf(id), city), false, id);
    assert.equal(coverage(ride('觀光1號'), tpassOf(id), city).all, true, id);
    assert.equal(routeOnPass(tpassOf(id), 'HsinchuCounty', '觀光8號'), false, id);
    assert.equal(routeOnPass(tpassOf(id), 'HsinchuCounty', '觀光2號'), true, id);
  }
  assert.equal(fareOf(ride('觀光8號'), coverage(ride('觀光8號'), tpassOf('hh'), city)).text, 'NT$90');
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
  // 182 at 文興嘉興路口, 22:10: the way to 高鐵 is done for the day, the way to 北大橋 still has its 22:30.
  assert.equal(liveTimes([{ RouteName: { Zh_tw: '182' }, Direction: 0, StopStatus: 3 }, { RouteName: { Zh_tw: '182' }, Direction: 1, StopStatus: 1 }], '182', now).off, 0);
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
  const d = { lat: 24.8392, lon: 121.0095 }; // (no river between: the rides are judged by their length alone)
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
  // 區間車 by one planner, 自強 by another, the station written two ways: one card, its times to pick.
  assert.equal(pickSig({ legs: [{ mode: 'tra', name: '區間車', from: { name: '竹北火車站' }, to: { name: '新竹' } }] }), pickSig({ legs: [{ mode: 'tra', name: '自強', short: '自強 123', from: { name: '竹北' }, to: { name: '臺鐵新竹車站' } }] }));
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

test('navigation for any plan not yet over (a later one says when to leave); its ride said the way the sign says it', async () => {
  const { canNav, rideName } = await import('../public/lib/nav.mjs');
  const now = T('07:00');
  assert.ok(canNav({ dep: T('07:15'), arr: T('08:00') }, now));
  assert.ok(canNav({ dep: T('07:40'), arr: T('08:00') }, now), 'leaving later');
  assert.ok(!canNav({ dep: T('06:00'), arr: T('06:40') }, now), 'over');
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

test('a change gone at the end, and a long walk to the first bus: by YouBike at both ends (成功九街 → 竹東高中: to 文興嘉興路口 by bike, not walking 16 minutes, off the 快捷8號支 and on by bike)', () => {
  const o = { lat: 24.8179, lon: 121.016 };
  const s = { lat: 24.8125, lon: 121.0238 }; // 文興嘉興路口, ~1 km away
  const m = { lat: 24.7468, lon: 121.0726 }; // off the first bus, ~2 km short
  const d = { lat: 24.733, lon: 121.0882 };
  const st = (uid, name, lat, lon) => ({ uid, name, lat, lon, bikes: 5, ebike: 1, ret: 5, ok: true });
  const bikes = [st('g', '綠41公園', 24.81614, 121.0171), st('n', '陽明交通大學(六家校區)', 24.81287, 121.02331), st('x', '客運下公館站', 24.7465, 121.0729), st('z', '竹東高中', 24.7333, 121.0879)];
  const leg = (mode, short, a, b, dep, arr, dist = 0) => ({ mode, short, from: { name: short, ...a }, to: { name: short, ...b }, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000, dist });
  const two = finish({ legs: [leg('walk', '', o, s, '07:12', '07:28', 1260), leg('bus', '快捷8號支', s, m, '07:28', '08:00'), leg('bus', '5625', m, d, '08:09', '08:15')] });
  const ranked = withBikes([two], o, d, bikes, T('07:10'), { modes: null });
  const both = ranked.find(p => p.legs[0].mode !== 'bus' && p.legs.filter(l => l.mode === 'bike').length === 2 && p.legs.filter(l => l.mode === 'bus').length === 1);
  assert.ok(both, ranked.map(p => p.legs.map(l => l.mode).join(' ')).join('\n'));
  assert.equal(both.legs.find(l => l.mode === 'bike').from.name, '綠41公園');
  assert.ok(!both.legs.some(l => l.mode === 'walk' && l.dur > 5 * 60));
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

test('the buses after one: the way the ride goes, TDX’s later estimates, the stop’s timetable (or the first stop’s plus the ride), its headway', async () => {
  const { laterBuses, departuresAt } = await import('../public/lib/live.mjs');
  const A = { uid: 'A', name: 'A', lat: 24.80, lon: 121.00 }, B = { uid: 'B', name: 'B', lat: 24.81, lon: 121.00 }, C = { uid: 'C', name: 'C', lat: 24.83, lon: 121.00 };
  const ways = [{ dir: 0, stops: [A, B, C] }, { dir: 1, stops: [C, B, A] }];
  const row = d => ({ RouteName: { Zh_tw: '5620' }, RouteUID: 'THB5620', StopUID: 'B', Direction: d, StopStatus: 1 });
  const leg = { mode: 'bus', short: '5620', from: B, to: C };
  const day = t => twAt('2026-10-05', t);
  const trips = (dir, rows) => ({ Direction: dir, Timetables: rows.map(st => ({ StopTimes: st.map(([uid, t]) => ({ StopUID: uid, DepartureTime: t })) })) });
  // Times at the stop itself, the way B → C (dir 0), not the other way's.
  const own = [trips(0, ['08:06', '08:26', '08:46', '09:06'].map(t => [['B', t]])), trips(1, [[['B', '08:10']], [['B', '08:15']]])];
  const got = await laterBuses([row(1), row(0)], leg, day('08:06'), { now: day('07:00'), stops: async () => ways, schedule: async () => own });
  assert.deepEqual(got, ['08:26', '08:46', '09:06'].map(day));
  // 公路客運: every stop listed at the first stop's time: the first stop's plus the ride to B.
  const flat = [trips(0, ['08:00', '08:40', '09:20'].map(t => [['A', t], ['B', t], ['C', t]]))];
  const at = departuresAt(flat, ways[0], 1, day('08:00'));
  assert.equal(at.length, 3);
  assert.ok(at[0] > day('08:00') && at[0] < day('08:10'), 'leaves B a few minutes after A');
  // Only a headway: every 15–25 minutes, on from the time asked.
  const freq = [{ Direction: 0, Frequencys: [{ StartTime: '06:00', EndTime: '22:00', MinHeadwayMins: 15, MaxHeadwayMins: 25 }] }];
  assert.deepEqual(departuresAt(freq, ways[0], 1, day('08:06'), 3), [20, 40, 60].map(m => day('08:06') + m * 60_000));
});

test('a route sheet’s times: the nearest day it runs when not today; a live bus only when the timetable has one due about then', async () => {
  const { nextRun, liveTrusted } = await import('../public/lib/live.mjs');
  const A = { uid: 'A', name: 'A', lat: 24.80, lon: 121.00 }, B = { uid: 'B', name: 'B', lat: 24.81, lon: 121.00 };
  const w = { dir: 0, stops: [A, B] };
  const weekdays = { Sunday: 0, Monday: 1, Tuesday: 1, Wednesday: 1, Thursday: 1, Friday: 1, Saturday: 0 };
  const sched = [{ Direction: 0, Timetables: ['08:00', '08:20'].map(t => ({ ServiceDay: weekdays, StopTimes: [{ StopUID: 'A', DepartureTime: t }, { StopUID: 'B', DepartureTime: t.replace(':00', ':06').replace(':20', ':26') }] })) }];
  const at = (d, t) => twAt(d, t);
  assert.deepEqual(nextRun(sched, w, 1, at('2026-10-05', '08:10')), { at: at('2026-10-05', '08:26'), day: 0 }, 'Monday: the next one today');
  assert.deepEqual(nextRun(sched, w, 1, at('2026-10-10', '09:00')), { at: at('2026-10-12', '08:06'), day: 2 }, 'Saturday: Monday’s first');
  assert.equal(liveTrusted(sched, w, 1, at('2026-10-05', '07:20')), false, 'a bus "coming" 45 minutes before any is due: resting');
  assert.equal(liveTrusted(sched, w, 1, at('2026-10-05', '08:15')), true, 'the 08:06, 9 minutes late');
  assert.equal(liveTrusted([], w, 1, at('2026-10-05', '07:20')), true, 'no timetable: as TDX says');
});

test('a ride over 頭前溪 is timed round by its bridge, and nothing more held against it (the owner, 2026-10-12)', async () => {
  const { crossings } = await import('../public/lib/rivers.mjs');
  const stadium = { lat: 24.8212, lon: 121.0176 };
  assert.equal(crossings(stadium, { lat: 24.7985, lon: 121.0045 }), 1, '千甲: over the river');
  assert.equal(crossings(stadium, { lat: 24.8076, lon: 121.0402 }), 0, '六家: this side');
  assert.equal(crossings(stadium, { lat: 24.8392, lon: 121.0095 }), 0, '竹北: this side');
  const ride = to => finish({ legs: [{ mode: 'bike', from: stadium, to, dep: T('08:00'), arr: T('08:15'), dur: 900 }] });
  assert.equal(score(ride({ lat: 24.7985, lon: 121.0045 }), { now: T('08:00') }), score(ride({ lat: 24.8076, lon: 121.0402 }), { now: T('08:00') }), 'the same 15 minutes either side');
});

test('over 頭前溪 by the bridge least out of the way: from 千甲 經國大橋, from 竹中 nearly on its way', async () => {
  const { bridgesFor } = await import('../public/lib/rivers.mjs');
  const school = { lat: 24.8189, lon: 121.0172 };
  assert.equal(bridgesFor({ lat: 24.7985, lon: 121.0045 }, school)[0].name, '經國大橋');
  assert.ok(bridgesFor({ lat: 24.7836, lon: 121.0372 }, school)[0].extra < 200);
  assert.ok(bridgesFor({ lat: 24.7985, lon: 121.0045 }, school)[0].extra > 300, 'from 千甲, round to it');
});

test('a bus route from Shared-Data’s pack, in TDX’s own shapes: its stops each way, its times (or the first stop’s for every stop), its headways', async () => {
  const { expand } = await import('../public/lib/packs.mjs');
  const raw = { v: 1, city: 'Hsinchu', stops: { A: ['甲', 24.8, 121], B: ['乙', 24.81, 121], C: ['丙', 24.82, 121] }, routes: [{ uid: 'HSZ1', name: '1', ways: [['HSZ10', '1', 0, ['A', 'B', 'C']]], sched: [['HSZ10', 0, ['A', 'B', 'C'], [[62, [480, 484, -1]], [65, 500, [{ Dates: ['2026-10-10'], ServiceStatus: 0 }]]], [[127, '06:00', '22:00', 15, 20]]]] }] };
  const p = { raw, byUid: new Map(raw.routes.map(r => [r.uid, r])) };
  const r = expand(p, 'HSZ1');
  const ways = parseStops(r.stops);
  assert.deepEqual(ways[0].stops.map(s => s.name), ['甲', '乙', '丙']);
  assert.equal(ways[0].headsign, '丙');
  const [a, b] = r.sched[0].Timetables;
  assert.deepEqual(a.StopTimes.map(s => s.DepartureTime), ['08:00', '08:04'], 'a stop without a time left out');
  assert.equal(a.ServiceDay.Monday, 1);
  assert.equal(a.ServiceDay.Sunday, 0);
  assert.deepEqual(b.StopTimes.map(s => s.DepartureTime), ['08:20', '08:20', '08:20'], 'the first stop’s time at every stop, as TDX gives it');
  assert.equal(b.SpecialDays[0].Dates[0], '2026-10-10');
  assert.equal(r.sched[0].Frequencys[0].MinHeadwayMins, 15);
  assert.equal(expand(p, 'nope'), null);
});

test('journeys from several stations: each station keeps its own soonest train, leaving as late as gets in then', () => {
  // 新竹 (in time for the 08:00) and 北新竹 (only for the 08:44): both are choices.
  const list = journeys(net, [{ key: 'tra:1210', at: T('07:50'), pre: 600 }, { key: 'tra:1193', at: T('08:30'), pre: 300 }], [{ key: 'tra:1195', extra: 0 }], T('07:50'));
  assert.ok(list.some(j => j.legs[0].from === 'tra:1210' && j.legs[0].trip.no === '1801'));
  assert.ok(list.some(j => j.legs[0].from === 'tra:1193' && j.legs[0].trip.no === '1803'));
});

test('journeys to a station: the same train a station further up is no later a way to leave (竹東 → 榮華 by bike for the train that stopped at 竹東)', () => {
  // At 新竹 (here) in time for the 1801; 北新竹 a 15-minute ride away, where the same 1801 calls 4 minutes later.
  const list = journeys(net, [{ key: 'tra:1210', at: T('07:53'), pre: 180 }, { key: 'tra:1193', at: T('08:03'), pre: 900 }], [{ key: 'tra:1194', extra: 0 }, { key: 'tra:1195', extra: 0 }], T('07:50'));
  const six = list.filter(j => j.end === 'tra:1195' && j.legs[0].trip?.no === '1801');
  assert.ok(six.some(j => j.legs[0].from === 'tra:1210'), 'on to 六家, boarded where you are');
});

test('railPlans: a station in walking distance is timed by the bike when that is quicker (no riding on to the next station for the train that stops here)', () => {
  // 900 m from 新竹: a 16-minute walk misses the 08:00, a 9-minute ride makes it;
  // 北新竹 is a 16-minute ride, for the same 1801 at 08:04.
  const o = { name: '家', lat: 24.7935, lon: 120.9716 };
  const d = { name: '六家', lat: 24.808, lon: 121.04 };
  const plans = railPlans(net, o, d, T('07:45'), { bike: true });
  const first = p => p.legs.find(l => l.mode === 'tra');
  const on = plans.filter(p => first(p)?.train.no === '1801');
  assert.ok(on.some(p => first(p).from.name === '新竹'), 'the 1801 from 新竹, where you are');
});

test('journeys: the same trains boarded a station further up stay beside the nearer boarding, for the ranking to weigh', () => {
  // 新竹 a 10-minute walk, 北新竹 a 5-minute ride: by the clock the 1801 at 北新竹 lets you leave later.
  const list = journeys(net, [{ key: 'tra:1210', at: T('07:50'), pre: 600 }, { key: 'tra:1193', at: T('07:55'), pre: 300 }], [{ key: 'tra:1194', extra: 0 }, { key: 'tra:1195', extra: 0 }], T('07:40'));
  const six = list.filter(j => j.end === 'tra:1195' && j.legs[0].trip?.no === '1801');
  assert.ok(six.some(j => j.legs[0].from === 'tra:1210'), 'boarded at 新竹 too');
  assert.ok(six.some(j => j.legs[0].from === 'tra:1193'), 'and at 北新竹');
});

test('score: chasing your own train to the next station costs more than boarding it where it stopped nearer you', () => {
  const o = { lat: 24.8, lon: 120.97 };
  const d = { lat: 24.808, lon: 121.04 };
  const ride = (from, prev) => ({ mode: 'tra', short: '區間 1801', from, to: { name: '六家', lat: 24.808, lon: 121.04 }, prev, dep: T('08:04'), arr: T('08:17'), train: { no: '1801' } });
  const hsinchu = { name: '新竹', lat: 24.8016, lon: 120.9716 };
  const north = { name: '北新竹', lat: 24.809, lon: 120.985 };
  const chased = finish({ legs: [ride(north, hsinchu)] });
  const there = finish({ legs: [ride(hsinchu, null)] });
  assert.ok(score(chased, { o, d, now: T('07:40') }) - score(there, { o, d, now: T('07:40') }) >= 5);
  // A planner's same train with no number, boarded at the stop before: one train.
  const google = finish({ legs: [{ ...ride(hsinchu, null), short: '六家-新竹', train: null, dep: T('08:00') }] });
  assert.ok(sameWay(finish({ legs: [ride(north, { ...hsinchu, dep: T('08:00') })] }), google));
});

test('journeys to several stations: each station keeps its own too (on to 六家 by the 六家線, over off sooner at 北新竹)', () => {
  // From 上員: the 1701 is at 北新竹 first; 六家 is a change at 竹中 to the 1801.
  const list = journeys(net, [{ key: 'tra:1201', at: T('07:50') }], [{ key: 'tra:1193', extra: 0 }, { key: 'tra:1195', extra: 0 }], T('07:50'));
  assert.ok(list.some(j => j.end === 'tra:1193'));
  const six = list.find(j => j.end === 'tra:1195');
  assert.deepEqual(six?.legs.filter(l => !l.walk).map(l => l.trip.no), ['1701', '1801']);
});

test("Google's names for a bus are the official route's: numerals, and the branch by the stops it really runs", async () => {
  assert.ok(sameRoute('快捷8號', '快捷八號經中正大橋'));
  assert.ok(!sameRoute('快捷8號支', '快捷八號經興隆大橋'), 'by name alone it is not');
  assert.ok(sameRoute('20', '二十'));
  const st = (uid, lat, lon) => ({ uid, name: uid, lat, lon });
  // 快捷8號 crosses one bridge (its stops), 快捷8號支 the other; both stop at 縣政府 and 新竹站.
  const main = [{ dir: 0, headsign: '新竹站', stops: [st('A', 24.827, 121.013), st('M1', 24.82, 121.0), st('M2', 24.81, 120.985), st('Z', 24.8016, 120.9716)] }];
  const branch = [{ dir: 0, headsign: '新竹站', stops: [st('A2', 24.827, 121.013), st('B1', 24.815, 121.02), st('B2', 24.805, 121.0), st('B3', 24.80, 120.985), st('B4', 24.80, 120.978), st('Z2', 24.8016, 120.9716)] }];
  const near = async () => [{ lat: 24.827, lon: 121.013, stops: [{ routeUID: 'HSQ0747', route: '快捷8號', stopUID: 'A' }, { routeUID: 'HSQ0748', route: '快捷8號支', stopUID: 'A2' }, { routeUID: 'HSQ5608', route: '5608', stopUID: 'X' }] }];
  const stops = async r => (r.uid === 'HSQ0747' ? main : r.uid === 'HSQ0748' ? branch : []);
  const leg = (name, n) => ({ mode: 'bus', name, short: name, stops: n, from: { name: '縣政府', lat: 24.827, lon: 121.013 }, to: { name: '新竹站', lat: 24.8016, lon: 120.9716 }, dep: T('09:00'), arr: T('09:30') });
  const a = await officialLeg(leg('快捷八號經中正大橋', 3), { near, stops });
  assert.equal(a.short, '快捷8號');
  assert.equal(a.route.uid, 'HSQ0747');
  const b = await officialLeg(leg('快捷八號經興隆大橋', 5), { near, stops });
  assert.equal(b.short, '快捷8號支');
  assert.equal(b.said, '快捷八號經興隆大橋');
  // Nothing like it there: as it was.
  assert.equal((await officialLeg(leg('182', 4), { near, stops })).short, '182');
});

test('a plan whose bus leaves before the walk to it is over is never shown', () => {
  const p = finish({ src: 'tdx', legs: [{ mode: 'tra', name: '區間', dep: T('09:42'), arr: T('10:00') }, { mode: 'walk', dep: T('10:00'), arr: T('10:04'), dur: 240 }, { mode: 'bus', name: '世博5號', dep: T('09:55'), arr: T('10:04'), dur: 540 }] });
  assert.equal(inOrder(p), false);
  assert.equal(inOrder({ legs: p.legs.map((l, i) => (i === 2 ? { ...l, dep: T('10:05'), arr: T('10:14') } : l)) }), true);
});

test('navigation tells the lock screen: set out, the bus by its live times, a train about to leave, the stop coming up', () => {
  const now = T('07:00');
  const plan = finish({ legs: [
    { mode: 'walk', from: { name: '家', lat: 24.82, lon: 121.017 }, to: { name: '縣體育場', lat: 24.821, lon: 121.018 }, dep: T('07:20'), arr: T('07:25'), dur: 300 },
    { mode: 'bus', name: '5615', short: '5615', from: { name: '縣體育場', lat: 24.821, lon: 121.018 }, to: { name: '新竹車站', lat: 24.8016, lon: 120.9716 }, dep: T('07:26'), arr: T('07:50'), dur: 1440 },
    { mode: 'tra', name: '區間', short: '區間 1141', train: { no: '1141' }, from: { name: '新竹', lat: 24.8016, lon: 120.9716 }, to: { name: '竹東', lat: 24.736, lon: 121.092 }, dep: T('08:00'), arr: T('08:30'), dur: 1800 }
  ] });
  const info = new Map([[1, { leg: { ...plan.legs[1], route: { uid: 'HSQ5615', dir: 0 } }, station: { uid: 'HSQ1', id: '1', cityCode: 'HSQ', name: '縣體育場' } }]]);
  const n = navNotices(plan, 0, info, now);
  const tag = t => n.find(x => x.tag === t);
  assert.equal(tag('nav:leave').at, T('07:18'));
  assert.deepEqual(tag('nav:bus:1').check.bus.route, 'HSQ5615');
  assert.ok(tag('nav:bus:1').body.includes('{result}'));
  assert.equal(tag('nav:train:2').at, T('07:55'));
  assert.equal(tag('nav:off:2').at, T('08:27'));
  // On the train already: only what's left.
  assert.deepEqual(navNotices(plan, 2, info, T('08:05')).map(x => x.tag), ['nav:off:2']);
});

test("a change from one bus to another is barely a plan (Taiwan's buses don't keep time); a bus with a train is fine", () => {
  const t0 = Date.UTC(2026, 9, 5, 8);
  const leg = (mode, from, min) => ({ mode, dur: min * 60, dep: t0 + from * 60_000, arr: t0 + (from + min) * 60_000 });
  const plan = legs => finish({ src: 't', legs });
  const busBus = plan([leg('bus', 0, 25), leg('walk', 25, 5), leg('bus', 30, 25)]);
  const busTrain = plan([leg('bus', 0, 25), leg('walk', 25, 5), leg('tra', 30, 30)]);
  assert.ok(score(busBus, { now: t0 }) > score(busTrain, { now: t0 }) + 20);
});

test('riding 16 minutes to a train anyway, riding the whole way in 27 is the better way (the owner, 2026-10-12); 45 minutes on a bike is not', () => {
  const t0 = Date.UTC(2026, 9, 5, 12);
  const at = m => t0 + m * 60_000;
  const ride = (from, min, ebike = false) => ({ mode: 'bike', ebike, dur: min * 60, dep: at(from), arr: at(from + min) });
  const ebikeAll = finish({ src: 'bike', legs: [ride(0, 27, true)] });
  const train = finish({ src: 't', legs: [ride(0, 16), { mode: 'tra', dur: 20 * 60, dep: at(20), arr: at(40) }, ride(41, 5)] });
  assert.ok(score(ebikeAll, { now: t0 }) < score(train, { now: t0 }));
  const long = finish({ src: 'bike', legs: [ride(0, 45)] });
  const short = finish({ src: 't', legs: [ride(0, 8), { mode: 'tra', dur: 20 * 60, dep: at(12), arr: at(32) }, ride(33, 8)] });
  assert.ok(score(long, { now: t0 }) > score(short, { now: t0 }), 'three quarters of an hour on a bike, against a train with two short rides there sooner');
});

test('1–2 km: a YouBike there when you are beats a bus a minute sooner on paper (its time is a guess); a train keeps its time', () => {
  const t0 = Date.UTC(2026, 9, 5, 8);
  const at = m => t0 + m * 60_000;
  const leg = (mode, from, min, extra = {}) => ({ mode, dur: min * 60, dep: at(from), arr: at(from + min), ...extra });
  const bike = finish({ src: 'bike', legs: [leg('walk', 0, 2, { dist: 150 }), leg('bike', 2, 9), leg('walk', 11, 2, { dist: 150 })] });
  const bus = finish({ src: 't', legs: [leg('walk', 0, 4, { dist: 300 }), leg('bus', 4, 6), leg('walk', 10, 2, { dist: 150 })] });
  assert.ok(bus.arr < bike.arr);
  assert.ok(score(bike, { now: t0 }) < score(bus, { now: t0 }));
  const train = finish({ src: 't', legs: [leg('walk', 0, 4, { dist: 300 }), leg('tra', 4, 6), leg('walk', 10, 2, { dist: 150 })] });
  assert.ok(score(train, { now: t0 }) < score(bus, { now: t0 }));
});

test('riding or walking all the way: a card of its own, with no times to pick (you leave when you like)', () => {
  const t0 = Date.UTC(2026, 9, 5, 8);
  const at = m => t0 + m * 60_000;
  const leg = (mode, from, min, extra = {}) => ({ mode, dur: min * 60, dep: at(from), arr: at(from + min), from: { lat: 24.8, lon: 121 }, to: { lat: 24.81, lon: 121 }, ...extra });
  const ride = finish({ src: 'bike', legs: [leg('walk', 0, 2, { dist: 150 }), leg('bike', 2, 8), leg('walk', 10, 1, { dist: 60 })] });
  const walk = finish({ src: 'g', legs: [leg('walk', 0, 15, { dist: 1100 })] });
  const out = rank([ride, walk], { now: t0 });
  const r = out.find(p => p.bike);
  const w = out.find(p => !p.bike);
  assert.ok(r && w);
  assert.ok(r.lead && w.lead, 'each its own card');
  assert.deepEqual(r.times.length, 1);
  assert.deepEqual(w.times.length, 1);
});

test('what’s near a point from the packs: the cells say which packs, a 公路客運 square’s stops found once; the buses due at them asked together, one ask a city', async () => {
  const { namesAround, packStops, stopsAround, etaStops, useWhere } = await import('../public/lib/near.mjs');
  const cell = (lat, lon) => `${Math.floor(lat / 0.02)}_${Math.floor(lon / 0.02)}`;
  const w = { cell: 0.02, packs: ['HsinchuCounty', 'InterCity/24.75_121.00', 'bike:HsinchuCounty', 'Taipei'], cells: { [cell(24.821, 121.017)]: [0, 1, 2], [cell(25.05, 121.5)]: [3] } };
  assert.deepEqual(namesAround(w, 24.821, 121.017, 500).sort(), ['HsinchuCounty', 'InterCity/24.75_121.00', 'bike:HsinchuCounty']);
  const county = { raw: { stops: { S1: ['縣體育場', 24.8212, 121.0176], S2: ['遠', 24.9, 121.1] }, routes: [{ uid: 'HSQ1', name: '5615', ways: [['', '', 0, ['S1', 'S2']]], sched: [] }, { uid: 'HSQ2', name: '5619', ways: [['', '', 0, ['S1']]], sched: [] }] } };
  const inter = { raw: { stops: { T1: ['縣體育場', 24.8213, 121.0177] }, routes: [{ uid: 'THB1', name: '1820', ways: [['', '', 1, ['T1']]], sched: [] }] } };
  assert.deepEqual(packStops(county).find(s => s.uid === 'S1').routes.map(r => r.name), ['5615', '5619']);
  useWhere(w);
  const packs = { HsinchuCounty: county, 'InterCity/24.75_121.00': inter };
  const list = await stopsAround(24.8212, 121.0176, 900, { packFn: async n => packs[n] });
  assert.deepEqual(list.map(s => `${s.uid}:${s.scope}`), ['S1:HsinchuCounty', 'T1:InterCity']);
  assert.equal(await stopsAround(24.8212, 121.0176, 900, { packFn: async n => (n === 'HsinchuCounty' ? null : packs[n]) }), null, 'a pack not had: TDX is asked instead');
  const asked = [];
  const ask = async path => (asked.push(path), path.includes('InterCity') ? [{ StopUID: 'T1', RouteName: { Zh_tw: '1820' }, EstimateTime: 300 }] : [{ StopUID: 'S1', RouteName: { Zh_tw: '5615' }, EstimateTime: 120 }]);
  const [a, b] = await Promise.all([etaStops([{ uid: 'S1', scope: 'HsinchuCounty' }], { ask }), etaStops([{ uid: 'T1', scope: 'InterCity' }, { uid: 'S1', scope: 'HsinchuCounty' }], { ask })]);
  assert.equal(asked.length, 2, 'one ask a city, both trips together');
  assert.ok(asked.some(p => p.startsWith('basic/v2/Bus/EstimatedTimeOfArrival/City/HsinchuCounty?$filter=StopUID eq \'S1\'')));
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
  await etaStops([{ uid: 'S1', scope: 'HsinchuCounty' }], { ask });
  assert.equal(asked.length, 2, 'kept 20 seconds');
  await assert.rejects(etaStops([{ uid: 'X9', scope: 'Hsinchu' }], { ask: async () => { throw new Error('down'); } }), 'a failed read is a failure, not no buses');
});

test('navigating, live: when you’ll be at the train from where you are (early, only just, late), when you’re there; a bus by when it really comes', () => {
  const t0 = Date.UTC(2026, 9, 5, 12);
  const at = m => t0 + m * 60_000;
  const plan = finish({ src: 't', legs: [
    { mode: 'walk', dur: 300, dep: at(0), arr: at(5), from: { lat: 24.8212, lon: 121.0176 }, to: { name: '竹北', lat: 24.8392, lon: 121.0093 } },
    { mode: 'tra', short: '區間 1247', dur: 600, dep: at(10), arr: at(20), from: { name: '竹北', lat: 24.8392, lon: 121.0093 }, to: { name: '新竹', lat: 24.8016, lon: 120.9716 } },
    { mode: 'walk', dur: 120, dep: at(20), arr: at(22), from: { lat: 24.8016, lon: 120.9716 }, to: { lat: 24.8018, lon: 120.9653 } }
  ] });
  // 470 m from the station, two minutes in: there in ~7 (at 5 km/h), the train in 8.
  const near = { lat: 24.8392 - 0.0042, lon: 121.0093 };
  const a = navTimes(plan, 0, 'before', near, new Map(), at(2));
  assert.ok(a.ready.get(1) > at(7) && a.ready.get(1) < at(10));
  assert.equal(a.eta, at(22));
  assert.equal(paceOf(plan, 0, 'before', a, new Map(), at(2)).tone, 'warn');
  // Right outside: minutes to spare.
  const b = navTimes(plan, 0, 'before', { lat: 24.8390, lon: 121.0093 }, new Map(), at(2));
  assert.equal(paceOf(plan, 0, 'before', b, new Map(), at(2)).tone, 'good');
  // A kilometre and a half away: late, and the trip after it later too.
  const far = { lat: 24.8257, lon: 121.0093 };
  const c = navTimes(plan, 0, 'before', far, new Map(), at(2));
  assert.equal(paceOf(plan, 0, 'before', c, new Map(), at(2)).tone, 'bad');
  assert.match(paceOf(plan, 0, 'before', c, new Map(), at(2)).text, /晚 \d+ 分/);
  // A train 4 minutes late (its live time): you make it, and you're there later.
  const late = new Map([[1, at(14)]]);
  const d = navTimes(plan, 0, 'before', near, late, at(2));
  assert.equal(paceOf(plan, 0, 'before', d, late, at(2)).tone, 'good');
  assert.equal(d.eta, at(26));
  // Before setting out: when to.
  assert.match(paceOf(plan, 0, 'before', navTimes(plan, 0, 'before', null, new Map(), at(-10)), new Map(), at(-10)).text, /出發・還有 10 分/);
  // On the train: its arrival at your stop.
  assert.match(paceOf(plan, 1, 'on', navTimes(plan, 1, 'on', null, new Map(), at(12)), new Map(), at(12)).text, /到 新竹/);
});

test('a train journey ending with the walk over to the other railway (六家 → 高鐵新竹): the walk on from there comes after it', () => {
  const o = { name: '家', lat: 24.8030, lon: 120.9690 };
  const d = { name: '高鐵新竹站', lat: 24.8081, lon: 121.0403 };
  const list = railPlans(net, o, d, T('07:50'));
  assert.ok(list.length >= 1);
  for (const p of list) for (let i = 1; i < p.legs.length; i++) assert.ok(p.legs[i].dep >= p.legs[i - 1].arr - 1000, `legs in order: ${p.legs.map(l => l.mode).join(' ')}`);
});

test('a change onto the metro for 3 km is no hop: two lines that are the quickest way stay shown', () => {
  const t0 = Date.UTC(2026, 9, 6, 5);
  const at = m => t0 + m * 60_000;
  const metro = finish({ src: 'tdx', legs: [
    { mode: 'metro', short: '松山新店線', dur: 300, dep: at(0), arr: at(5), from: { name: '公館', lat: 25.0145, lon: 121.5343 }, to: { name: '中正紀念堂', lat: 25.0352, lon: 121.5199 } },
    { mode: 'metro', short: '淡水信義線', dur: 720, dep: at(8), arr: at(20), from: { name: '中正紀念堂', lat: 25.0352, lon: 121.5199 }, to: { name: '劍潭', lat: 25.0846, lon: 121.5250 } },
    { mode: 'walk', dur: 360, dist: 450, dep: at(20), arr: at(26), from: { lat: 25.0846, lon: 121.5250 }, to: { lat: 25.0880, lon: 121.5241 } }
  ] });
  const bus = finish({ src: 'tdx', legs: [
    { mode: 'bus', short: '280', dur: 2100, dep: at(7), arr: at(42), from: { name: '公館', lat: 25.0145, lon: 121.5343 }, to: { name: '圓山', lat: 25.0700, lon: 121.5200 } },
    { mode: 'walk', dur: 300, dist: 400, dep: at(42), arr: at(47), from: { lat: 25.07, lon: 121.52 }, to: { lat: 25.0880, lon: 121.5241 } }
  ] });
  const out = rank([metro, bus], { now: t0 });
  const m = out.find(p => p.legs[0].mode === 'metro');
  assert.ok(m.lead && !m.weak && out[0] === m);
});

// ---- Live navigation: where the bus or train is, the stops to go, Google Maps' links -------------
// Ten stops along a road, ~110 m apart.
const NSTOPS = Array.from({ length: 10 }, (_, k) => ({ uid: `s${k}`, id: `tra:${k}`, name: `站${k}`, lat: 24.8, lon: 121 + k * 0.0011 }));
const etaOfSecs = o => new Map(Object.entries(o).map(([k, sec]) => [k, { sec, status: 0 }]));

test('busWhere: walking back from your stop while the estimates fall; the first that rises is the bus behind', () => {
  const eta = etaOfSecs({ s8: 300, s7: 240, s6: 180, s5: 120, s4: 600, s3: 540 });
  assert.deepEqual(busWhere(NSTOPS, 8, eta), { k: 5, away: 3, sec: 300, in: 120, far: false });
  // No estimate at your stop: nothing to say.
  assert.equal(busWhere(NSTOPS, 9, eta), null);
  // A stop with no estimate on the way back stops the walk there.
  const gap = etaOfSecs({ s8: 300, s7: 240, s5: 120 });
  assert.equal(busWhere(NSTOPS, 8, gap).k, 7);
  // Further back than we look: far.
  const w = busWhere(NSTOPS, 8, eta, 2);
  assert.equal(w.far, true);
  assert.equal(w.away, 2);
});

test('busAhead: the times at the stops still to go, until an estimate falls (the bus after yours)', () => {
  const eta = etaOfSecs({ s3: 60, s4: 120, s5: 180, s6: 30, s7: 90 });
  const out = busAhead(NSTOPS, 3, 8, eta, 0);
  assert.deepEqual([...out.keys()], [3, 4, 5]);
  assert.equal(out.get(5), 180_000);
});

test('trainWhere: from the live board; left a station is heading to the next; past you is nothing', () => {
  assert.deepEqual(trainWhere(NSTOPS, 3, { st: 'tra:1', status: 2 }), { k: 2, away: 1, at: false, far: false });
  assert.deepEqual(trainWhere(NSTOPS, 3, { st: 'tra:1', status: 1 }), { k: 1, away: 2, at: true, far: false });
  assert.equal(trainWhere(NSTOPS, 3, { st: 'tra:3', status: 2 }), null);
  assert.equal(trainWhere(NSTOPS, 3, { st: 'tra:5', status: 0 }), null);
  assert.equal(trainWhere(NSTOPS, 3, null), null);
});

test('nextStop: on board, the stop you come to next from where you are', () => {
  assert.equal(nextStop(NSTOPS, 1, 6, null), 2);
  // Stopped at 站3: the next is 站4.
  assert.equal(nextStop(NSTOPS, 1, 6, { lat: 24.8, lon: NSTOPS[3].lon }), 4);
  // A little past 站3 towards 站4.
  assert.equal(nextStop(NSTOPS, 1, 6, { lat: 24.8, lon: NSTOPS[3].lon + 0.0004 }), 4);
  // Never past yours.
  assert.equal(nextStop(NSTOPS, 1, 6, { lat: 24.8, lon: NSTOPS[6].lon }), 6);
});

test('countText: m:ss under ten minutes, minutes after', () => {
  assert.equal(countText(245_000), '4:05');
  assert.equal(countText(-5_000), '0:00');
  assert.equal(countText(600_000), '10');
  assert.equal(countText(1_500_000), '25');
});

test("gmapsLink: from Google's own 你的位置; to Google's place when there's its id, else the point", () => {
  const gid = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
  const a = new URL(gmapsLink({ name: '巨城', lat: 24.81, lon: 120.97, gid }, 'bicycling')).searchParams;
  assert.equal(a.has('origin'), false);
  assert.equal(a.get('destination'), '巨城');
  assert.equal(a.get('destination_place_id'), gid);
  assert.equal(a.get('travelmode'), 'bicycling');
  assert.equal(a.get('dir_action'), 'navigate');
  const b = new URL(gmapsLink({ name: '路邊', lat: 24.81, lon: 120.97 }, 'transit')).searchParams;
  assert.equal(b.has('origin'), false);
  assert.equal(b.get('destination'), '24.81,120.97');
  assert.equal(b.has('destination_place_id'), false);
  assert.equal(b.has('dir_action'), false);
  // A bad id is never sent.
  assert.equal(new URL(gmapsLink({ name: 'x', lat: 24.81, lon: 120.97, gid: 'no good!' }, 'walking')).searchParams.has('destination_place_id'), false);
});

test("cleanEnd and cleanPlace keep a Google place id that looks like one, and drop one that doesn't", () => {
  const gid = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
  assert.equal(cleanEnd({ name: '巨城', lat: 24.81, lon: 120.97, gid }).gid, gid);
  assert.equal('gid' in cleanEnd({ name: '巨城', lat: 24.81, lon: 120.97, gid: '<script>' }), false);
  assert.equal(cleanPlace({ name: '巨城', lat: 24.81, lon: 120.97, gid }).gid, gid);
  assert.equal('gid' in cleanPlace({ name: '巨城', lat: 24.81, lon: 120.97, gid: 42 }), false);
});

test("legEnd: the last leg ends at the trip's own place when it's within 300 m, else where the leg ends", () => {
  const to = { name: '路口', lat: 24.8, lon: 121 };
  const legs = [{ mode: 'bus', to: { name: '站', lat: 24.79, lon: 121 } }, { mode: 'walk', to }];
  const near = { name: '巨城', lat: 24.801, lon: 121, gid: 'ChIJN1t_tDeuEmsRUsoyG83frY4' };
  assert.equal(legEnd({ legs, dest: near }, 1), near);
  assert.equal(legEnd({ legs, dest: { name: '遠', lat: 24.81, lon: 121 } }, 1), to);
  assert.equal(legEnd({ legs, dest: near }, 0), legs[0].to);
  assert.equal(legEnd({ legs }, 1), to);
});

test("paceOf: walking to the stop, the line doesn't say the stop's name again (the title does), so the minutes to spare fit beside Google's link", () => {
  const now = Date.UTC(2026, 9, 6, 12);
  const stopPt = { name: '新竹車站(中正路)', lat: 24.8026, lon: 120.9702 };
  const plan = { dep: now, arr: now + 40 * 60_000, legs: [
    { mode: 'walk', from: { lat: 24.80, lon: 120.968 }, to: stopPt, dep: now, arr: now + 5 * 60_000, dur: 300 },
    { mode: 'bus', short: '5608', from: stopPt, to: { name: '竹東站', lat: 24.736, lon: 121.092 }, dep: now + 10 * 60_000, arr: now + 40 * 60_000 }
  ] };
  const times = navTimes(plan, 0, 'before', null, new Map(), now);
  const p = paceOf(plan, 0, 'before', times, new Map(), now);
  assert.ok(!p.text.includes('新竹車站'), p.text);
  assert.match(p.text, /早到 \d+ 分/);
  // Waiting at the stop itself, it still says where.
  assert.ok(paceOf(plan, 1, 'before', navTimes(plan, 1, 'before', null, new Map(), now), new Map(), now).text.startsWith('新竹車站'));
});

test("trainFor: a train leg with only its line (TDX's 新竹-六家) gets its number from the day's timetable: leaving where you board at the time given, stopping where you get off", () => {
  const at = m => Date.UTC(2026, 9, 6, 12) + m * 60_000;
  const stations = [
    { key: 'tra:1210', sys: 'tra', lat: 24.8016, lon: 120.9716 },
    { key: 'tra:1194', sys: 'tra', lat: 24.7836, lon: 121.0372 },
    { key: 'tra:1195', sys: 'tra', lat: 24.808, lon: 121.04 },
    { key: 'hsr:1040', sys: 'hsr', lat: 24.8081, lon: 121.0403 }
  ];
  const trip = (no, a, stops) => ({ sys: 'tra', no, type: '區間', code: '6', stops: stops.map(([st, m]) => ({ st, arr: at(a + m), dep: at(a + m) })) });
  const trips = [
    trip('1771', 0, [['tra:1210', 0], ['tra:1194', 10], ['tra:1195', 18]]),
    trip('1773', 30, [['tra:1210', 0], ['tra:1194', 10], ['tra:1195', 18]]),
    // Leaves 新竹 at the time, but never gets to 六家.
    trip('1251', 31, [['tra:1210', 0], ['tra:1194', 10]]),
    { sys: 'hsr', no: '611', stops: [{ st: 'hsr:1040', arr: at(30), dep: at(30) }] }
  ];
  const leg = { mode: 'tra', dep: at(31), from: { lat: 24.8016, lon: 120.9716 }, to: { lat: 24.8077, lon: 121.0394 } };
  assert.deepEqual(trainFor(trips, stations, leg), { no: '1773', type: '區間', code: '6' });
  // Said as the sign says it: its kind and number, not the planner's line.
  assert.equal(rideName({ mode: 'tra', short: '新竹-六家', train: trainFor(trips, stations, leg) }), '台鐵 區間 1773 次');
  // Nothing near the time: no guess.
  assert.equal(trainFor(trips, stations, { ...leg, dep: at(15) }), null);
});

test("wayText: the sign's way, unless it names where you board (a loop): then where you're going", () => {
  assert.equal(wayText({ headsign: '往 竹東', from: { name: '新竹' }, to: { name: '竹中' } }), '往 竹東');
  assert.equal(wayText({ headsign: '火車站', from: { name: '火車站' }, to: { name: '清華大學' } }), '往 清華大學');
  assert.equal(wayText({ from: { name: '火車站' }, to: { name: '清華大學' } }), '');
});

test('boardHtml: your stop with no live time (a bus line\'s last stop: its estimate is the next bus\'s) says when you\'re there', () => {
  const rs = { stops: ['A', 'B', 'C'].map(name => ({ name })), i: 0, j: 2 };
  const end = Date.UTC(2026, 9, 6, 12, 53);
  const html = boardHtml(rs, 1, new Map([[1, Date.UTC(2026, 9, 6, 12, 43)]]), 0, end);
  assert.match(html, /<li class=" you"><i><\/i><span>C<\/span><em>下車<\/em><time>20:53<\/time>/);
  assert.match(html, /<span>B<\/span><em>下一站<\/em><time>20:43<\/time>/);
});

test('paceOf: a plan that starts with the ride itself says the ride and what is live, not when to leave', () => {
  const now = Date.UTC(2026, 9, 6, 12);
  const l = { mode: 'tra', short: '區間 3258', from: { name: '拔林' }, to: { name: '新營' }, dep: now + 10 * 60_000, arr: now + 26 * 60_000 };
  const plan = { dep: l.dep, arr: l.arr, legs: [l] };
  const p = paceOf(plan, 0, 'before', navTimes(plan, 0, 'before', null, new Map(), now), new Map(), now, '準點');
  assert.equal(p.text, '拔林 20:10 開・10 分後・準點');
});

test("legLabel: a train the planner named by its line, once its number is known, is its kind and number (the step's chip)", async () => {
  const { legLabel } = await import('../public/lib/ui.mjs');
  assert.equal(legLabel({ mode: 'tra', short: '新竹-六家', train: { no: '1774', type: '區間' } }), '區間 1774');
  assert.equal(legLabel({ mode: 'tra', short: '新竹-六家' }), '新竹-六家');
  assert.equal(legLabel({ mode: 'tra', short: '自強 123', train: { no: '123', type: '自強' } }), '自強 123');
});

test("on board, your own pace: where the phone is along the ride's stops, how fast it's come, when it's at each stop ahead", () => {
  // NSTOPS: ten stops ~111 m apart along a road.
  const cum = routeCum(NSTOPS);
  assert.ok(Math.abs(cum[9] - 9 * 111.5) < 10, String(cum[9]));
  // Halfway between 站2 and 站3, 20 m off the road: 2.5 stops along.
  const a = alongRoute(NSTOPS, { lat: 24.8 + 0.00018, lon: NSTOPS[2].lon + 0.00055 }, cum);
  assert.ok(Math.abs(a.d - cum[2] - (cum[3] - cum[2]) / 2) < 5 && a.off > 15 && a.off < 25, JSON.stringify(a));
  // 300 m in 2 minutes (a stop and a light included): 2.5 m/s; under a minute or 100 m: nothing yet.
  const t0 = 1_000_000;
  assert.equal(ridePace([{ d: 0, t: t0 }, { d: 50, t: t0 + 30_000 }], t0 + 30_000), null);
  assert.equal(ridePace([{ d: 0, t: t0 }, { d: 150, t: t0 + 60_000 }, { d: 300, t: t0 + 120_000 }], t0 + 120_000), 2.5);
  // A fix that jumps backwards isn't a pace.
  assert.equal(ridePace([{ d: 300, t: t0 }, { d: 100, t: t0 + 120_000 }], t0 + 120_000), null);
  // Only the last 5 minutes: a long wait at the start no longer drags it down.
  assert.equal(ridePace([{ d: 0, t: t0 }, { d: 0, t: t0 + 600_000 }, { d: 600, t: t0 + 840_000 }], t0 + 840_000), 600 / 240);
  // From 2.5 stops along at 2.5 m/s: stop 3 in ~22 s, stop 5 in ~111 s.
  const ahead = aheadByPace(cum, 3, 5, cum[2] + (cum[3] - cum[2]) / 2, 2.5, 0);
  assert.deepEqual([...ahead.keys()], [3, 4, 5]);
  assert.ok(Math.abs(ahead.get(5) / 1000 - (cum[5] - cum[2] - (cum[3] - cum[2]) / 2) / 2.5) < 1);
});

test("boardHtml: TDX's time first, your own pace where TDX has none, the timetable after; a train's live delay before your pace", () => {
  const T = m => Date.UTC(2026, 9, 6, 12, m);
  const rs = { stops: ['A', 'B', 'C', 'D'].map((name, k) => ({ name, at: T(10 * k) })), i: 0, j: 3 };
  const html = boardHtml(rs, 1, new Map([[1, T(11)]]), 0, null, new Map([[1, T(12)], [2, T(23)], [3, T(33)]]), false);
  assert.match(html, /<span>B<\/span><em>下一站<\/em><time>20:11<\/time>/);
  assert.match(html, /<span>C<\/span><time>20:23<\/time>/);
  assert.match(html, /<span>D<\/span><em>下車<\/em><time>20:33<\/time>/);
  // A train on the live board (delay known): its timetable plus the delay comes before your pace.
  const tr = boardHtml(rs, 1, null, 2, null, new Map([[2, T(25)]]), true);
  assert.match(tr, /<span>C<\/span><time>20:22<\/time>/);
});

test("leftText: how long till you're there, short beside the arrival time and its drift (「還要 1 小時…」 was cut)", () => {
  assert.equal(leftText(45), '45 分');
  assert.equal(leftText(89), '1時29分');
  assert.equal(leftText(125), '2時05分');
});

test('paceOf: before setting out, from where you are: leaving at the planned time misses the bus → leave now, or it says the bus is gone (and 重新規劃 is offered)', () => {
  const now = Date.UTC(2026, 9, 6, 22, 30);
  const stop = { name: '火車站', lat: 24.8034, lon: 120.9720 };
  const plan = { dep: now + 16 * 60_000, arr: now + 60 * 60_000, legs: [
    { mode: 'walk', from: { lat: 24.80, lon: 120.968 }, to: stop, dep: now + 16 * 60_000, arr: now + 20 * 60_000, dur: 240 },
    { mode: 'bus', short: '182', from: stop, to: { name: '高鐵新竹站', lat: 24.808, lon: 121.04 }, dep: now + 20 * 60_000, arr: now + 50 * 60_000 }
  ] };
  const at = pos => paceOf(plan, 0, 'before', navTimes(plan, 0, 'before', pos, new Map(), now), new Map(), now);
  // Next to the stop: when to set out.
  assert.match(at({ lat: 24.8031, lon: 120.9717 }).text, /^06:46 出發・還有 16 分/);
  // ~1 km away (18 min on foot): leaving at 06:46 misses it, leaving now makes it.
  assert.deepEqual(at({ lat: 24.8034, lon: 120.9620 }), { text: '現在就出發・06:50 的車還趕得上', tone: 'warn' });
  // ~2.5 km away (44 min): gone even leaving now.
  assert.deepEqual(at({ lat: 24.8034, lon: 120.9470 }), { text: '從這裡趕不上 06:50 的車了', tone: 'bad' });
});

test("YouBike: the station to leave it at is the one that makes the whole way quickest from where you took it (六家 → 成功九街: 綠41公園 on the way, not 成功國中 past it, a few metres nearer the door)", () => {
  const st = (uid, name, lat, lon, n = 10) => ({ uid, name, lat, lon, bikes: n, ebike: 2, ret: n, ok: true });
  const bikes = [st('lj', '臺鐵六家車站', 24.80777, 121.03895), st('g41', '綠41公園', 24.81614, 121.0171), st('cg', '成功國中', 24.81872, 121.01597)];
  const home = { lat: 24.81761, lon: 121.01652 };
  // Nearest the door, with nothing else known: 成功國中.
  assert.equal(returnNear(home, bikes).uid, 'cg');
  // From 六家: 綠41公園.
  assert.equal(returnNear(home, bikes, { from: bikes[0] }).uid, 'g41');
  const legs = bikeTrip({ lat: 24.8078, lon: 121.0390 }, home, bikes, 0);
  assert.equal(legs.find(l => l.mode === 'bike').to.name, '綠41公園');
  // From the north (成功國中 is on the way then): 成功國中.
  assert.equal(returnNear(home, bikes, { from: { lat: 24.8300, lon: 121.0120 } }).uid, 'cg');
  // Its last dock now changes nothing.
  assert.equal(returnNear(home, [bikes[0], { ...bikes[1], ret: 1 }, bikes[2]], { from: bikes[0] }).uid, 'g41');
});

test("YouBike: the station to take a bike from is on the way, never behind you for a few metres less walk (成功九街 → the bus at 文興嘉興路口, or 六家: 綠41公園, not 成功國中 and back past the door); never a walk past 5 minutes to save a little riding", () => {
  const st = (uid, name, lat, lon) => ({ uid, name, lat, lon, bikes: 10, ebike: 2, ret: 10, ok: true });
  const bikes = [st('g41', '綠41公園', 24.81614, 121.0171), st('cg', '成功國中', 24.81872, 121.01597), st('ny', '陽明交通大學(六家校區)', 24.81287, 121.02331)];
  const stop = { name: '文興嘉興路口', lat: 24.8125, lon: 121.0238 };
  // Along 成功九街, 成功國中 a little nearer (114 and 94 m, 綠41公園 196 and 221 m).
  for (const home of [{ lat: 24.81774, lon: 121.0163 }, { lat: 24.81788, lon: 121.01603 }]) {
    assert.equal(rentNear(home, bikes).uid, 'cg', 'nearest the door, with nothing else known');
    assert.equal(rentNear(home, bikes, { to: stop }).uid, 'g41');
    assert.equal(bikeTrip(home, stop, bikes, 0).find(l => l.mode === 'bike').from.name, '綠41公園');
  }
  // And to 六家's station, by the same rule.
  assert.equal(rentNear({ lat: 24.81788, lon: 121.01603 }, bikes, { to: { lat: 24.80766, lon: 121.03941 } }).uid, 'g41');
  // At 成功國中's door (48 m; 綠41公園 342 m): 成功國中.
  assert.equal(rentNear({ lat: 24.81886, lon: 121.01552 }, bikes, { to: stop }).uid, 'cg');
  // Going north, 成功國中 is on the way: 成功國中.
  assert.equal(rentNear({ lat: 24.81774, lon: 121.0163 }, bikes, { to: { lat: 24.8300, lon: 121.0120 } }).uid, 'cg');
  // 竹東街上 → 縣體育場, 10 km: 竹東信義立體停車場 2 minutes away, a little behind, not 客運竹東站 8 minutes on.
  const zd = [st('xy', '竹東信義立體停車場', 24.73871, 121.09028), st('ky', '客運竹東站', 24.73945, 121.08559)];
  const pick = rentNear({ lat: 24.74, lon: 121.09 }, zd, { to: { lat: 24.821, lon: 121.0184 } });
  assert.equal(pick.uid, 'xy');
});

test("inTaiwan: the app's coverage, the main island and its islands (澎湖, 綠島, 蘭嶼, 金門, 馬祖), not the coast of Fujian beside them", async () => {
  const { inTaiwan } = await import('../public/lib/util.mjs');
  const yes = { 新竹: [24.8016, 120.9716], 台北101: [25.034, 121.565], 墾丁: [21.95, 120.8], 澎湖馬公: [23.57, 119.58], 蘭嶼: [22.05, 121.55], 綠島: [22.66, 121.49], 金門: [24.43, 118.32], 小金門: [24.43, 118.24], 南竿: [26.15, 119.93], 東引: [26.37, 120.49], 彭佳嶼: [25.63, 122.07] };
  const no = { 廈門: [24.48, 118.09], 福州: [26.07, 119.3], 平潭: [25.5, 119.78], 黃岐: [26.33, 119.88], 東京: [35.68, 139.76], 馬尼拉: [14.6, 120.98], 香港: [22.3, 114.17] };
  for (const [k, [a, b]] of Object.entries(yes)) assert.equal(inTaiwan(a, b), true, k);
  for (const [k, [a, b]] of Object.entries(no)) assert.equal(inTaiwan(a, b), false, k);
});

test("the map's top stays sharp: the phone's own status bar (black), the strip solid black on the map tab too", async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/transit.css', import.meta.url), 'utf8');
  // black-translucent puts the page under the status bar, and iOS blurs a band below it whatever the strip.
  assert.match(html, /apple-mobile-web-app-status-bar-style" content="black"/);
  assert.doesNotMatch(css, /--q-status-bg:\s*(transparent|rgba)/);
  // Black, as every other tab (no map-tab colour of its own).
  assert.doesNotMatch(css, /body\.tab-map \{\s*--q-status-bg/);
});

test('a weekdays-only trip (上學) skips a national holiday: Friday 國慶日補假 → Monday; an every-day trip doesn’t', async () => {
  const { tripNow } = await import('../public/lib/tab-go.mjs');
  const { useHolidays } = await import('../public/lib/util.mjs');
  const { twHoliday } = await import('#kit/holidays.mjs');
  const home = { name: '家', lat: 24.821, lon: 121.018 };
  const school = { name: '學校', lat: 24.733, lon: 121.088 };
  const t = cleanSaved({ id: 's1', name: '上學', from: home, to: school, time: '07:30', days: [1, 2, 3, 4, 5], back: '17:00' });
  const gym = cleanSaved({ id: 's2', name: '運動', from: home, to: school, time: '07:30', days: [0, 1, 2, 3, 4, 5, 6] });
  const fri = Date.parse('2026-10-09T07:00:00+08:00');
  useHolidays(date => Boolean(twHoliday(date)));
  const w = tripNow(t, home, fri);
  assert.equal(w.today, false);
  assert.equal(w.at, twAt('2026-10-12', '07:30'));
  assert.equal(tripNow(gym, home, fri).at, twAt('2026-10-09', '07:30'));
  useHolidays(null);
  assert.equal(tripNow(t, home, fri).at, twAt('2026-10-09', '07:30'));
});

test('a bus leg’s live line: a later bus chosen isn’t “趕不上” because an earlier one is coming; its timetable time instead', async () => {
  const { liveLegText } = await import('../public/lib/tab-map.mjs');
  const now = Date.parse('2026-10-10T12:09:00+08:00');
  const at = hhmm => Date.parse(`2026-10-10T${hhmm}:00+08:00`);
  // The 12:11 coming now; you'll be at the stop at 12:15.
  const coming = [{ at: at('12:11') }];
  assert.equal(liveLegText({ dep: at('12:11') }, coming, 0, at('12:15'), now), '即時：這班 2 分後到，趕不上');
  // The next one (13:10) picked from the chips: not on its way yet.
  assert.equal(liveLegText({ dep: at('13:10') }, coming, 0, at('13:05'), now), '時刻表 13:10 到站 · 還沒發車');
  // On its way and catchable, a little late.
  assert.equal(liveLegText({ dep: at('12:20') }, [{ at: at('12:25') }], 0, at('12:15'), now), '即時 12:25 到站 · 16 分後 · 晚 5 分');
});

test('a route that runs seldom (5615, a few buses a day) still offers its next buses to pick, hours apart; a frequent one its next 90 minutes', () => {
  const ride = (short, dep) => finish({ legs: [{ mode: 'walk', dep: T(dep) - 300e3, arr: T(dep), dur: 300 }, { mode: 'bus', short, name: short, from: { name: '縣體育場', lat: 24.8196, lon: 121.0183 }, to: { name: '國賓大飯店', lat: 24.8096, lon: 120.9765 }, dep: T(dep), arr: T(dep) + 14 * 60e3, dur: 840 }] });
  const out = rank([ride('5615', '12:29'), ride('5615', '14:39'), ride('5615', '16:19'), ride('5615', '20:09')], { now: T('12:10') });
  const lead = out.find(p => p.lead);
  const hhmm = t => tw(t).hm;
  assert.deepEqual(lead.times.map(i => hhmm(out[i].dep)).sort(), ['12:24', '14:34', '16:14']);
});

test('a stop’s sides by the way its buses go: two signs on one side are one side (上泉州厝), the street’s other side another; a sign with no way joins the nearest side', () => {
  const st = (uid, lat, lon, bearing, routes) => ({ uid, name: '上泉州厝', lat, lon, bearing, routes });
  const sides = stopSides([
    st('a', 24.8001, 121.0001, 'E', ['5615']),
    st('b', 24.8001, 121.0005, 'NE', ['5616']),
    st('c', 24.8, 121.0003, 'W', ['5615']),
    st('d', 24.80009, 121.00049, '', ['81'])
  ]);
  assert.deepEqual(sides.map(s => s.group.map(x => x.uid)), [['a', 'b', 'd'], ['c']]);
  assert.deepEqual(sides[0].routes, ['5615', '5616', '81']);
  assert.equal(sides[1].bearing, 'W');
  // One side only: one.
  assert.equal(stopSides([st('a', 24.8, 121, 'S', []), st('b', 24.8002, 121, 'S', [])]).length, 1);
});

test('a YouBike station out of bikes or docks while on the way: the ride moved to another, the walk with it', async () => {
  const { moveRide } = await import('../public/lib/nav.mjs');
  const A = { name: 'A', lat: 24.8, lon: 120.97 };
  const S = { name: '站1', lat: 24.801, lon: 120.971 };
  const T = { name: '站2', lat: 24.82, lon: 120.99 };
  const B = { name: 'B', lat: 24.821, lon: 120.991 };
  const plan = () => ({ dur: 1200, arr: 2_000_000, legs: [{ mode: 'walk', from: A, to: S, dur: 120 }, { mode: 'bike', from: S, to: T, dur: 900, poly: 'x' }, { mode: 'walk', from: T, to: B, dur: 180 }] });
  const p = plan();
  const S2 = { name: '站3', lat: 24.8015, lon: 120.9725, uid: 's3' };
  assert.equal(moveRide(p, 1, 'rent', S2), true);
  assert.equal(p.legs[0].to.name, '站3');
  assert.equal(p.legs[1].from.name, '站3');
  assert.equal(p.legs[1].poly, undefined);
  // No docks at 站2: left at 站4, and walked from there.
  const T2 = { name: '站4', lat: 24.8195, lon: 120.9885 };
  assert.equal(moveRide(p, 1, 'return', T2), true);
  assert.equal(p.legs[1].to.name, '站4');
  assert.equal(p.legs[2].from.name, '站4');
  assert.equal(p.legs.length, 3);
  // A ride that ended where you were going (no walk after): a walk added.
  const q = { legs: [{ mode: 'bike', from: S, to: T, dur: 900 }] };
  moveRide(q, 0, 'return', T2);
  assert.deepEqual(q.legs.map(l => [l.mode, l.from.name, l.to.name]), [['bike', '站1', '站4'], ['walk', '站4', '站2']]);
  assert.equal(moveRide(q, 1, 'rent', S2), false);
});

test('a change where the next train already crosses your way: off at 竹中 for the 六家 train, not on to 新竹 and back', () => {
  // The 1901 from 上員 reaches 竹中 07:36 and 新竹 07:49; the 1801 leaves 新竹 08:00 and calls at 竹中 08:12.
  const early = traTrips({ TrainDate: '2026-10-05', TrainTimetables: [train('1901', '6', '區間車', [stop('1201', '07:30'), stop('1194', '07:36'), stop('1193', '07:44'), stop('1210', '07:49')], { end: '新竹' })] });
  const n2 = network(stations, [...trips, ...early], links(stations));
  const j = earliest(n2, [{ key: 'tra:1201', at: T('07:20') }], [{ key: 'tra:1195' }], { use: t => t.sys === 'tra' });
  const rides = j.legs.filter(l => !l.walk);
  assert.deepEqual(rides.map(l => `${l.trip.no} ${l.from}>${l.to}`), ['1901 tra:1201>tra:1194', '1801 tra:1194>tra:1195']);
  assert.equal(rides[0].arr, T('07:36'));
  assert.equal(rides[1].dep, T('08:12'));
  assert.deepEqual([rides[0].stops, rides[1].stops], [1, 1]);
  assert.equal(j.arr, T('08:17'), 'the same arrival');
});

test('the same train left at another station a kilometre or more on is a way of its own; on further only to ride less, home no sooner, is set aside', () => {
  const o = { lat: 24.733, lon: 121.088 };
  const d = { lat: 24.8176, lon: 121.0165 };
  const zhuzhong = { name: '竹中', lat: 24.782, lon: 121.031 };
  const qianjia = { name: '千甲', lat: 24.8068, lon: 121.0034 };
  const ride = to => ({ mode: 'tra', short: '區間 1831', from: { name: '竹東', lat: 24.7382, lon: 121.0947 }, to, dep: T('17:12'), arr: to === zhuzhong ? T('17:27') : T('17:34'), train: { no: '1831' } });
  const bike = (from, dep, min) => ({ mode: 'bike', from, to: d, dep, arr: dep + min * 60_000, dur: min * 60, dist: min * 230 });
  const viaZ = finish({ legs: [ride(zhuzhong), bike(zhuzhong, T('17:28'), 26)] });
  const viaQ = finish({ legs: [ride(qianjia), bike(qianjia, T('17:36'), 21)] });
  assert.ok(!sameWay(viaZ, viaQ));
  const out = rank([viaZ, viaQ], { now: T('17:00'), o, d });
  assert.equal(out.length, 2, 'both kept');
  assert.ok(out.find(p => p.legs[0].to.name === '千甲').weak, 'on to 千甲 for nothing: set aside');
  assert.ok(!out.find(p => p.legs[0].to.name === '竹中').weak);
});

test('navigation knows the step you are at from where you are: a step’s end missed, a ride under way, a trip started half way', () => {
  // 竹東高中 → walk → bike to 竹東站 → walk → 1831 to 竹中 → walk off the platform.
  const P = (lat, lon, name = '') => ({ name, lat, lon });
  const school = P(24.733, 121.0882);
  const dock = P(24.7335, 121.0885, '竹東高中站');
  const stDock = P(24.7378, 121.0938, '竹東車站站');
  const zhudong = P(24.7382, 121.0947, '竹東');
  const zhuzhong = P(24.782, 121.031, '竹中');
  const plan = finish({
    legs: [
      { mode: 'walk', from: school, to: dock, dep: T('17:02'), arr: T('17:03'), dur: 60 },
      { mode: 'bike', from: dock, to: stDock, dep: T('17:03'), arr: T('17:09'), dur: 360 },
      { mode: 'walk', from: stDock, to: zhudong, dep: T('17:09'), arr: T('17:10'), dur: 60 },
      { mode: 'tra', short: '區間 1831', from: zhudong, to: zhuzhong, dep: T('17:12'), arr: T('17:27'), path: [[24.7382, 121.0947], [24.76, 121.06], [24.782, 121.031]] },
      { mode: 'walk', from: zhuzhong, to: P(24.7825, 121.0315), dep: T('17:27'), arr: T('17:28'), dur: 60 }
    ]
  });
  assert.equal(tripAt(plan, school, 0, T('17:02')), null, 'at the start: nothing to move on to');
  assert.deepEqual(tripAt(plan, P(24.7356, 121.0911), 0, T('17:05')), { i: 1, phase: 'before' }, 'half way on the bike, the walk’s end never seen');
  assert.deepEqual(tripAt(plan, P(24.76, 121.06), 0, T('17:20')), { i: 3, phase: 'on' }, 'started on the train');
  assert.equal(tripAt(plan, P(24.76, 121.06), 0, T('16:30')), null, 'not on a train that can’t have come yet');
  assert.equal(tripAt(plan, zhudong, 2, T('17:11')), null, 'at the station, waiting: still the walk to it');
});

test('over the river on the bike after a train is set aside when a train over it gets there in a quarter of an hour; and what’s set aside sets nothing else aside', () => {
  // 新竹站 → 成功九街: the train to 竹北 and a ride, over the train to 千甲 and a ride over 頭前溪.
  const o = { lat: 24.8016, lon: 120.9716 };
  const d = { lat: 24.8176, lon: 121.0165 };
  const hsinchu = { name: '新竹', lat: 24.8016, lon: 120.9716 };
  const qianjia = { name: '千甲', lat: 24.7985, lon: 121.0045 };
  const zhubei = { name: '竹北', lat: 24.8392, lon: 121.0095 };
  const tr = (no, to, dep, arr) => ({ mode: 'tra', short: `區間 ${no}`, from: hsinchu, to, dep: T(dep), arr: T(arr), train: { no } });
  const bike = (from, dep, min) => ({ mode: 'bike', from, to: d, dep: T(dep), arr: T(dep) + min * 60_000, dur: min * 60, dist: min * 230 });
  const viaQ = finish({ legs: [tr('1798', qianjia, '18:45', '18:51'), bike(qianjia, '18:52', 15)] });
  const viaZ = finish({ legs: [tr('1242', zhubei, '18:37', '18:47'), bike(zhubei, '18:48', 15)] });
  const out = rank([viaQ, viaZ], { now: T('18:30'), o, d });
  assert.ok(out.find(p => p.legs[0].to.name === '千甲').weak, 'the ride over 頭前溪 after the train: set aside');
  assert.ok(!out.find(p => p.legs[0].to.name === '竹北').weak);
});

test('the same first train, then on to 北新竹 and back up to 竹北, with the same ride home: set aside for the change to the 六家線, home sooner', () => {
  const o = { lat: 24.733, lon: 121.088 };
  const d = { lat: 24.8176, lon: 121.0165 };
  const S = (name, lat, lon) => ({ name, lat, lon });
  const zhudong = S('竹東', 24.7382, 121.0947), zhuzhong = S('竹中', 24.782, 121.031), liujia = S('六家', 24.8078, 121.039), north = S('北新竹', 24.809, 120.985), zhubei = S('竹北', 24.8392, 121.0095);
  const tr = (no, from, to, dep, arr) => ({ mode: 'tra', short: `區間 ${no}`, from, to, dep: T(dep), arr: T(arr), train: { no } });
  const bike = (from, dep, min) => ({ mode: 'bike', from, to: d, dep: T(dep), arr: T(dep) + min * 60_000, dur: min * 60, dist: min * 230 });
  const viaL = finish({ legs: [tr('1831', zhudong, zhuzhong, '17:12', '17:27'), tr('1758', zhuzhong, liujia, '17:41', '17:46'), bike(liujia, '17:47', 15)] });
  const viaN = finish({ legs: [tr('1831', zhudong, north, '17:12', '17:38'), tr('1242', north, zhubei, '17:46', '17:50'), bike(zhubei, '17:51', 15)] });
  const out = rank([viaN, viaL], { now: T('17:00'), o, d });
  assert.ok(out.find(p => p.legs[1].to.name === '竹北').weak);
  assert.ok(!out.find(p => p.legs[1].to.name === '六家').weak);
});

test('a bus then another bus is set aside whenever a way without one is there, and never labelled 最快抵達', () => {
  const o = { lat: 24.733, lon: 121.088 };
  const d = { lat: 24.8176, lon: 121.0165 };
  const S = (name, lat, lon) => ({ name, lat, lon });
  const bus = (short, from, to, dep, arr) => ({ mode: 'bus', short, from, to, dep: T(dep), arr: T(arr), dur: (T(arr) - T(dep)) / 1000 });
  const chain = finish({ legs: [bus('5673', S('竹東高中', 24.733, 121.088), S('監理站', 24.79, 121.01), '16:52', '17:20'), bus('5614', S('台肥五廠', 24.792, 121.012), S('上泉州厝', 24.817, 121.016), '17:30', '17:48')] });
  const one = finish({ legs: [bus('快捷8號支', S('竹東高中', 24.733, 121.088), S('縣政府', 24.8265, 121.0128), '17:15', '18:05')] });
  const out = rank([chain, one], { now: T('16:45'), o, d });
  const c = out.find(p => p.legs.length === 2);
  assert.ok(c.weak, 'set aside, though there sooner');
  assert.ok(!c.tags.includes('最快抵達'));
  assert.ok(!out.find(p => p.legs.length === 1).weak);
  // Nothing else: shown.
  assert.ok(!rank([chain], { now: T('16:45'), o, d })[0].weak);
});

test('the bus you’d catch is the first you can be at the stop for from now, not from when the plan had you leave for a later one', async () => {
  const now = T('18:55');
  // The plan leaves at 19:05 for the timetable's 19:15 (a 10-minute way to the stop); TDX has one at 19:06 and the next at 19:15.
  const rows = [{ RouteName: { Zh_tw: '快捷8號支' }, StopStatus: 0, EstimateTime: 660, Estimates: [{ EstimateTime: 660 }, { EstimateTime: 1200 }] }];
  const p = finish({ legs: [
    { mode: 'walk', dur: 600, dist: 700, dep: T('19:05'), arr: T('19:15'), from: { lat: 24.8176, lon: 121.0165 }, to: { lat: 24.818, lon: 121.022 } },
    { mode: 'bus', short: '快捷8號支', dur: 2100, dist: 15000, dep: T('19:15'), arr: T('19:50'), from: { name: '文興嘉興路口', lat: 24.818, lon: 121.022 }, to: { name: '竹東高中', lat: 24.733, lon: 121.088 } }
  ] });
  const q = await adjustPlan(p, now, { near: async () => rows, start: now });
  assert.equal(q.legs[1].dep, T('19:06'), 'the 19:06, 11 minutes away, a 10-minute walk');
  assert.equal(q.legs[0].dep, T('18:56'), 'set out in a minute');
  // Asked for a time later on: the first bus from then.
  const later = await adjustPlan(p, now, { near: async () => rows, start: T('19:00') });
  assert.equal(later.legs[1].dep, T('19:15'));
});

test('in navigation, another departure taken: the ride and what follows it move, up to a train that keeps its time, and a train it would now miss is said', () => {
  const P = (name, lat, lon) => ({ name, lat, lon });
  const plan = finish({ legs: [
    { mode: 'walk', from: P('', 24.8176, 121.0165), to: P('文興嘉興路口', 24.818, 121.022), dep: T('19:00'), arr: T('19:05'), dur: 300 },
    { mode: 'bus', short: '快捷8號支', from: P('文興嘉興路口', 24.818, 121.022), to: P('竹東火車站', 24.738, 121.094), dep: T('19:07'), arr: T('19:40'), dur: 1980 },
    { mode: 'walk', from: P('竹東火車站', 24.738, 121.094), to: P('竹東', 24.7382, 121.0947), dep: T('19:40'), arr: T('19:42'), dur: 120 },
    { mode: 'tra', short: '區間 1840', from: P('竹東', 24.7382, 121.0947), to: P('合興', 24.72, 121.12), dep: T('19:50'), arr: T('20:00'), train: { no: '1840' } }
  ] });
  assert.equal(retimeRide(plan, 1, { dep: T('19:12'), arr: T('19:45') }), '', 'five minutes later still makes the 19:50');
  assert.equal(plan.legs[2].arr, T('19:47'));
  assert.equal(plan.legs[3].dep, T('19:50'), 'the train keeps its time');
  assert.match(retimeRide(plan, 1, { dep: T('19:20'), arr: T('19:53') }), /1840/, 'now it would miss the 1840');
  // A train for another: its number.
  retimeRide(plan, 3, { dep: T('20:20'), arr: T('20:30'), train: { no: '1842', type: '區間' } });
  assert.equal(plan.legs[3].short, '區間 1842');
  assert.equal(plan.arr, T('20:30'));
});

test('to be there by a time, late in navigation: how late, and the way from here that still makes it (never the ride you are headed for, never one that left)', () => {
  const P = (name, lat, lon) => ({ name, lat, lon });
  const stop = P('文興嘉興路口', 24.818, 121.022);
  const school = P('竹東高中', 24.733, 121.0882);
  const plan = finish({ deadline: T('08:00'), legs: [
    { mode: 'walk', from: P('', 24.8176, 121.0165), to: stop, dep: T('06:50'), arr: T('07:00'), dur: 600 },
    { mode: 'bus', short: '快捷8號支', from: stop, to: school, dep: T('07:02'), arr: T('07:40'), dur: 2280 }
  ] });
  assert.equal(lateBy(plan, T('07:40')), 0);
  assert.equal(lateBy(plan, T('08:01')), 0, 'a minute is on time');
  assert.equal(lateBy(plan, T('08:15')), 15);
  assert.equal(lateBy({ ...plan, deadline: undefined }, T('09:00')), 0, 'no time said: never late');
  const ride = finish({ src: 'bike', tags: [], top: true, lead: true, legs: [{ mode: 'bike', ebike: true, from: P('A', 24.817, 121.017), to: P('B', 24.734, 121.088), dep: T('07:05'), arr: T('07:55'), dur: 3000 }] });
  const same = finish({ top: true, lead: true, legs: [{ ...plan.legs[1], dep: T('07:02'), arr: T('07:40') }] });
  const gone = finish({ top: true, lead: true, legs: [{ mode: 'bus', short: '5608', from: P('X', 24.81, 121.02), to: school, dep: T('06:40'), arr: T('07:30'), dur: 3000 }] });
  const late = finish({ top: true, lead: true, legs: [{ mode: 'bus', short: '5608', from: P('X', 24.81, 121.02), to: school, dep: T('07:30'), arr: T('08:20'), dur: 3000 }] });
  const now = T('07:03');
  assert.equal(onTimeWay([same, ride], plan, 1, T('06:58')), null, 'the bus you are headed for still comes: nothing to change');
  assert.equal(onTimeWay([gone, late, ride], plan, 1, now), ride, 'the one that left and the one too late are no way');
  assert.equal(onTimeWay([gone, late], plan, 1, now), null);
  assert.equal(offerText(ride), '改騎電輔車，07:55 到');
});

test('a route’s stops: a bus between two stops is where a stop’s live time drops below the one before (not one at a stop, which rides on its dot)', async () => {
  const { busBetween } = await import('../public/lib/bus-ui.mjs');
  const v = sec => ({ status: 0, sec, more: [] });
  // 喜來登飯店 15 分, then 文興嘉興路口 4 分: a bus between them.
  const lives = [v(360), v(420), v(540), v(900), v(240), v(300), v(900)];
  assert.deepEqual(lives.map((_, k) => busBetween(lives, k)), [false, false, false, false, true, false, false]);
  // Pulling in at the stop: on its dot, not between.
  assert.equal(busBetween([v(600), v(30)], 1), false);
  // The stop before has none on its way (gone by): between.
  assert.equal(busBetween([{ status: 3, sec: null }, v(200)], 1), true);
});

test('navigating, the map shows the stage you are at: a bike ride close up (never the whole trip), waiting you and the stop close up, on board the rest of the ride', () => {
  const P = (name, lat, lon) => ({ name, lat, lon });
  const park = P('綠41公園', 24.81614, 121.0171), ny = P('陽明交通大學(六家校區)', 24.81287, 121.02331), st = P('文興嘉興路口', 24.8125, 121.0238), hs = P('竹東高中', 24.7333, 121.0879);
  const plan = { legs: [
    { mode: 'walk', from: P('', 24.81788, 121.01603), to: park },
    { mode: 'bike', from: park, to: ny },
    { mode: 'walk', from: ny, to: st },
    { mode: 'bus', from: st, to: hs, path: [[24.8125, 121.0238], [24.79, 121.04], [24.77, 121.06], [24.75, 121.08], [24.7333, 121.0879]] },
    { mode: 'walk', from: hs, to: P('竹東高中', 24.733, 121.0882) }
  ] };
  const path = l => l.path || [[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]];
  const span = pts => meters(Math.min(...pts.map(p => p.lat)), Math.min(...pts.map(p => p.lon)), Math.max(...pts.map(p => p.lat)), Math.max(...pts.map(p => p.lon)));
  const bike = stageView(plan, 1, 'before', P('', 24.8158, 121.0185), path);
  assert.ok(span(bike) < 1500, `the ride close up: ${Math.round(span(bike))} m`);
  assert.ok(!bike.some(p => p.lat < 24.8), 'not on to 竹東');
  const walk = stageView(plan, 2, 'before', P('', 24.8129, 121.0233), path);
  assert.ok(walk.some(p => p.lat === st.lat && p.lon === st.lon), 'a walk: on to the stop');
  assert.ok(span(walk) >= 350, 'never closer than a street or two');
  const wait = stageView(plan, 3, 'before', P('', 24.8126, 121.0236), path);
  assert.ok(span(wait) < 160, `waiting: the street, which side the stop is on, ${Math.round(span(wait))} m`);
  // Still a way off it: you and the stop both.
  const nearing = stageView(plan, 3, 'before', P('', 24.814, 121.022), path);
  assert.ok(nearing.some(p => p.lat === 24.814) && span(nearing) > 200);
  assert.ok(wait.some(p => p.lat === st.lat && p.lon === st.lon));
  const on = stageView(plan, 3, 'on', P('', 24.7701, 121.0601), path);
  assert.ok(!on.some(p => p.lat > 24.8), 'on board: from you on, not where you got on');
  assert.ok(on.some(p => p.lat < 24.74), 'to your stop');
});

test("a bus's estimate counts from when TDX made it (its DataTime), not from when it was read: \"4 minutes\" read again a minute later is 3 minutes, the countdown never back up", () => {
  const made = Date.parse('2026-10-13T06:51:36+08:00');
  const row = { RouteName: { Zh_tw: '快捷8號支' }, Direction: 0, StopStatus: 0, EstimateTime: 240, DataTime: '2026-10-13T06:51:36+08:00', Estimates: [{ EstimateTime: 900 }] };
  // Read at once, and again 70 s later (the same estimate, the proxy's copy): the same moment both times.
  const first = liveTimes([row], '快捷8號支', made).times[0].at;
  const again = liveTimes([row], '快捷8號支', made + 70_000).times[0].at;
  assert.equal(first, made + 240_000);
  assert.equal(again, first);
  assert.deepEqual(liveTimes([row], '快捷8號支', made + 70_000).times.map(t => t.at - made), [240_000, 900_000]);
  // A stop's row: 170 s to go, 830 s for the next.
  const v = etaOf({ ...row, StopUID: 'X' }, made + 70_000);
  assert.equal(v.sec, 170);
  assert.deepEqual(v.more, [830]);
  // No DataTime: from now, as before.
  const { DataTime, ...plain } = row;
  assert.equal(liveTimes([plain], '快捷8號支', made + 70_000).times[0].at, made + 70_000 + 240_000);
});

test("on a bus round a loop (快捷8號支 by 高鐵新竹站), on its road but far from the straight lines between its stops: still on it, never asked if you got off", async () => {
  const { offRide } = await import('../public/lib/navlive.mjs');
  // Two stops 1.2 km apart; the road goes round a block 400 m to the side.
  const stops = [{ lat: 24.808, lon: 121.03 }, { lat: 24.808, lon: 121.042 }];
  const road = [[24.808, 121.03], [24.8116, 121.03], [24.8116, 121.042], [24.808, 121.042]].map(([lat, lon]) => ({ lat, lon }));
  const onRoad = { lat: 24.8116, lon: 121.036 };
  assert.ok(alongRoute(stops, onRoad).off > 250, 'the stops’ line alone says off');
  assert.ok(offRide(stops, onRoad, routeCum(stops), 0, road) < 30, 'its road says on it');
  // Really off (a street away from both): off.
  assert.ok(offRide(stops, { lat: 24.818, lon: 121.036 }, routeCum(stops), 0, road) > 250);
  // No road known: the stops' line, as before.
  assert.ok(offRide(stops, onRoad, routeCum(stops), 0, null) > 250);
});

test("常用行程: the way back once you're in the far end's part of the trip (成功九街 → 竹東高中, at 竹東 station), and always from the trip's own start or end, not from where you are", async () => {
  const { tripNow } = await import('../public/lib/tab-go.mjs');
  const home = { name: '成功九街', lat: 24.8176, lon: 121.0165 };
  const school = { name: '竹東高中', lat: 24.733, lon: 121.0882 };
  const t = cleanSaved({ id: 'z1', name: '上學', from: home, to: school, time: '', days: [], back: '' });
  const noon = twAt('2026-10-13', '12:00');
  // At 竹東 station (~1 km from school, 11 km from home): the way back, from school.
  const back = tripNow(t, { lat: 24.7382, lon: 121.0947 }, noon);
  assert.equal(back.to.name, '成功九街');
  assert.equal(back.from.name, '竹東高中');
  // At home's door: forward, from where you are.
  const fwd = tripNow(t, { lat: 24.8178, lon: 121.0163 }, noon);
  assert.equal(fwd.to.name, '竹東高中');
  assert.equal(fwd.from, null);
  // In between, 2 km from home (竹北): forward, from home, not from where you are.
  const mid = tripNow(t, { lat: 24.8302, lon: 121.0040 }, noon);
  assert.equal(mid.to.name, '竹東高中');
  assert.equal(mid.from.name, '成功九街');
});

test('a metro ride’s stops, for the map: its line’s stations between where it boards and gets off, in order, either way along the line', async () => {
  const { metroStops } = await import('../public/lib/metro.mjs');
  const st = (id, name, lat, lon) => ({ key: `metro:TRTC:${id}`, id, name, lat, lon });
  const S = [st('BL10', '龍山寺', 25.0353, 121.4999), st('BL11', '西門', 25.0421, 121.5082), st('BL12', '台北車站', 25.0463, 121.5174), st('BL13', '善導寺', 25.0447, 121.5232)];
  const load = async () => ({ sys: 'TRTC', stations: S, lines: [{ id: 'BL', name: '板南線', seq: S.map(s => s.key), paths: [] }] });
  const r = await metroStops({ mode: 'metro', name: '板南線', from: { lat: 25.0354, lon: 121.5 }, to: { lat: 25.0447, lon: 121.5231 } }, { load });
  assert.deepEqual(r.stops.map(s => s.name), ['龍山寺', '西門', '台北車站', '善導寺']);
  const back = await metroStops({ mode: 'metro', name: '板南線', from: { lat: 25.0463, lon: 121.5174 }, to: { lat: 25.0421, lon: 121.5082 } }, { load });
  assert.deepEqual(back.stops.map(s => s.name), ['台北車站', '西門']);
  assert.equal(await metroStops({ mode: 'metro', from: { lat: 24.8, lon: 121 }, to: { lat: 24.81, lon: 121 } }, { load }), null, 'no metro there');
});

test('a pinned place is on the map: its icon and name, a tap opening its card (the pin kept, so 已釘選)', async () => {
  const { placeMarker } = await import('../public/lib/tab-map.mjs');
  const m = placeMarker({ id: 'h', name: '家<b>', icon: 'home', lat: 24.8, lon: 120.97, address: '東區', gid: 'g1' });
  assert.equal(m.id, 'place:h');
  assert.equal(m.kind, 'place');
  assert.deepEqual([m.lat, m.lon], [24.8, 120.97]);
  assert.match(m.html, /🏠/);
  assert.match(m.html, /家&lt;b&gt;/);
  assert.deepEqual(m.data, { name: '家<b>', sub: '東區', lat: 24.8, lon: 120.97, pin: 'h', gid: 'g1' });
  assert.match(placeMarker({ id: 'x', name: 'x', icon: 'nope', lat: 24, lon: 121 }).html, /📍/);
});

test('a YouBike ride shows where it goes back on the map (a swap: once, where the next bike is taken)', async () => {
  const { bikeReturns } = await import('../public/lib/tab-map.mjs');
  const A = { lat: 24.80, lon: 121.00 };
  const B = { lat: 24.81, lon: 121.01 };
  const C = { lat: 24.83, lon: 121.03 };
  const walk = { mode: 'walk', from: C, to: { lat: 24.84, lon: 121.04 } };
  assert.deepEqual(bikeReturns([{ mode: 'walk', from: {}, to: A }, { mode: 'bike', from: A, to: C }, walk]).map(l => l.to), [C]);
  assert.deepEqual(bikeReturns([{ mode: 'bike', from: A, to: B }, { mode: 'bike', from: B, to: C }]).map(l => l.to), [C]);
  assert.deepEqual(bikeReturns([{ mode: 'bus', from: A, to: B }, walk]), []);
});

test("a trip's YouBike stations: where you take one its bikes, where it goes back its docks, a swap's both, once", async () => {
  const { planBikes, planBikeMarker } = await import('../public/lib/tab-map.mjs');
  const st = (uid, lat, o = {}) => ({ uid, name: uid, lat, lon: 121, bikes: 5, ebike: 2, ret: 19, ...o });
  const [A, B, C] = [st('A', 24.8), st('B', 24.81), st('C', 24.83, { ret: 0 })];
  const ride = (r, t) => ({ mode: 'bike', from: { lat: r.lat, lon: r.lon }, to: { lat: t.lat, lon: t.lon }, rent: r, ret: t });
  const roles = list => list.map(b => `${b.st.uid}:${b.rent ? '借' : ''}${b.ret ? '還' : ''}`);
  assert.deepEqual(roles(planBikes([{ mode: 'walk' }, ride(A, C), { mode: 'walk' }])), ['A:借', 'C:還']);
  assert.deepEqual(roles(planBikes([ride(A, B), ride(B, C)])), ['A:借', 'B:借還', 'C:還']);
  assert.deepEqual(planBikes([{ mode: 'bike', from: A, to: C }]), []);
  const [a, b, c] = planBikes([ride(A, B), ride(B, C)]).map(x => planBikeMarker(x));
  assert.match(a.html, /ot-i.*<b>5<\/b><i>⚡2/);
  assert.doesNotMatch(a.html, /<rect/);
  assert.match(b.html, /<rect.*<b>19<\/b><s><\/s>.*<b>5<\/b>/);
  assert.match(c.html, /<rect[^]*<\/svg><b>0<\/b>$/);
    // No docks where it goes back: shown as an empty station; live counts win over the plan's.
  assert.match(c.cls, /none/);
  assert.match(planBikeMarker({ st: A, rent: true, ret: false }, { ...A, bikes: 1, ebike: 0 }).html, /<b>1<\/b>/);
  assert.equal(a.id, 'pbike:A');
});

test("a planner's walk by its own line: TDX's 210 m (a straight-line guess) for a 510 m walk round the block is 510 m, and the time to walk it", async () => {
  const { walksByLine } = await import('../public/lib/plan.mjs');
  // Google's encoded polyline, for the test.
  const enc = pts => {
    let out = '';
    let [pl, pn] = [0, 0];
    const one = v => {
      v = v < 0 ? ~(v << 1) : v << 1;
      while (v >= 0x20) {
        out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      out += String.fromCharCode(v + 63);
    };
    for (const [la, lo] of pts) {
      const [a, b] = [Math.round(la * 1e5), Math.round(lo * 1e5)];
      one(a - pl);
      one(b - pn);
      [pl, pn] = [a, b];
    }
    return out;
  };
  // Home on 成功九街 to 成功國中's station, round the block: ~170 + 170 + 170 m.
  const round = enc([[24.8168, 121.0163], [24.8168, 121.0146], [24.8183, 121.0146], [24.8183, 121.0163]]);
  const t0 = Date.UTC(2026, 9, 13, 9, 21);
  const walk = { mode: 'walk', dist: 210, dur: 180, dep: t0, arr: t0 + 180_000, poly: round, fmt: 'g', from: { lat: 24.8168, lon: 121.0163 }, to: { lat: 24.8183, lon: 121.0163 } };
  const only = walksByLine(finish({ src: 'tdx', legs: [walk] }));
  assert.ok(only.legs[0].dist > 480 && only.legs[0].dist < 540, String(only.legs[0].dist));
  assert.ok(only.legs[0].dur >= 350 && only.legs[0].dur <= 400, `about 6 minutes at 5 km/h: ${only.legs[0].dur}`);
  assert.equal(only.walk, only.legs[0].dist, 'the trip’s 步行 too');
  assert.equal(only.dep, t0, 'leaving now, in later');
  // Walking to a bus: set out earlier, the bus the same.
  const bus = { mode: 'bus', short: '5608', dur: 600, dep: t0 + 4 * 60_000, arr: t0 + 14 * 60_000, from: walk.to, to: { lat: 24.83, lon: 121.02 } };
  const toBus = walksByLine(finish({ src: 'tdx', legs: [{ ...walk, dep: t0 + 60_000, arr: t0 + 4 * 60_000 }, bus] }));
  assert.equal(toBus.legs[0].arr, bus.dep);
  assert.ok(toBus.legs[0].dep < t0 - 60_000, 'out earlier');
  assert.equal(toBus.legs[1].dep, bus.dep);
  // A walk whose length its line already says (Google's): as it is.
  const right = { ...walk, dist: 510, dur: 370, arr: t0 + 370_000 };
  const same = finish({ src: 'google', legs: [right] });
  assert.equal(walksByLine(same), same);
});
