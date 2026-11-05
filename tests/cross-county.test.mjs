// Trips across counties, past TPASS (checked on the road's data 2026-11-05:
// 台北 → 台南, 花蓮, 池上, 墾丁, 日月潭, 北港, 奮起湖…).
//   1. Our own router's trains carry their real fares (TDX's ODFare): the
//      recommended 高鐵 + 區間 to 台南 showed no price at all.
//   2. A place in the country a few kilometres past its station, no bus on
//      from it and no YouBike there (池上's 伯朗大道), is reached by the train
//      and the walk: before, nothing was found.
//   3. A 高鐵 ridden past 台南 to 左營 and back by 自強 is no way when a
//      way that doesn't ride past gets in about as soon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { network } from '../public/lib/rail.mjs';
import { railPlans, RAIL_FAR_WALK_M, overshoots, dropOvershoots } from '../public/lib/plan.mjs';
import { planFare, faresIn } from '../public/lib/raildata.mjs';
import { fareOf } from '../public/lib/tpass.mjs';

const T = h => Date.UTC(2026, 10, 5, h - 8);
const st = (key, lat, lon) => ({ key, sys: key.split(':')[0], id: key.split(':')[1], name: key, lat, lon });
// 臺北 and 池上 (the real stations' places), 高鐵台北 and 高鐵台南, 沙崙 and 臺南.
const stations = [st('tra:1000', 25.0478, 121.517), st('tra:6070', 23.1256, 121.2193), st('hsr:1000', 25.0477, 121.5173), st('hsr:1060', 22.9251, 120.2858), st('tra:4272', 22.9244, 120.2869), st('tra:4220', 22.9971, 120.2127)];
const trip = (sys, no, code, stops) => ({ id: `${sys}:2026-11-05:${no}`, sys, no, type: sys === 'hsr' ? '高鐵' : '自強', code, stops: stops.map(([s, h]) => ({ st: s, arr: T(h), dep: T(h) })) });
const trips = [
  trip('tra', '442', '3', [['tra:1000', 17.08], ['tra:6070', 20.97]]),
  trip('hsr', '1241', 'hsr', [['hsr:1000', 16.85], ['hsr:1060', 18.28]]),
  trip('tra', '3760', '6', [['tra:4272', 18.38], ['tra:4220', 18.73]]),
  trip('tra', '445', '3', [['tra:6070', 19.13], ['tra:1000', 23.12]])
];
const net = network(stations, trips, []);
const 台北 = { name: '台北車站', lat: 25.0478, lon: 121.517 };
const 伯朗大道 = { name: '伯朗大道', lat: 23.1, lon: 121.223 };

test('a place 2.8 km past a country station: nothing within the usual walk, the train and the walk past it', () => {
  assert.equal(railPlans(net, 台北, 伯朗大道, T(16.9)).length, 0);
  const far = railPlans(net, 台北, 伯朗大道, T(16.9), { walkM: RAIL_FAR_WALK_M });
  assert.ok(far.length);
  const p = far[0];
  assert.deepEqual(p.legs.map(l => l.mode), ['tra', 'walk']);
  assert.ok(p.legs[1].dist > 2000 && p.legs[1].dist < RAIL_FAR_WALK_M * 1.5);
  // (And the way back the same.)
  assert.ok(railPlans(net, 伯朗大道, 台北, T(16)).length === 0 && railPlans(net, 伯朗大道, 台北, T(16), { walkM: RAIL_FAR_WALK_M }).length);
});

test('our own trains are priced from the fares, a bus beside them makes it a floor (起)', async () => {
  const prices = { 'tra:1000>tra:6070:3': 843, 'hsr:1000>hsr:1060:': 1350, 'tra:4272>tra:4220:6': 37 };
  const price = leg => Promise.resolve(prices[`${leg.from}>${leg.to}:${leg.trip.code}`] ?? null);
  const pt = k => ({ name: k, lat: stations.find(s => s.key === k).lat, lon: stations.find(s => s.key === k).lon });
  const leg = (mode, a, b, code) => ({ mode, from: pt(a), to: pt(b), train: { sys: mode, code } });
  const toTainan = { legs: [leg('hsr', 'hsr:1000', 'hsr:1060', 'hsr'), { mode: 'walk' }, leg('tra', 'tra:4272', 'tra:4220', '6')] };
  const withBus = { legs: [leg('tra', 'tra:1000', 'tra:6070', '3'), { mode: 'bus', short: '1' }] };
  await faresIn([toTainan, withBus], net, 1000, price);
  assert.deepEqual(planFare(toTainan, net, price), { fare: 1387, more: false });
  assert.equal(fareOf(toTainan, null, planFare(toTainan, net, price)).text, 'NT$1387');
  assert.match(fareOf(withBus, null, planFare(withBus, net, price)).text, /^NT\$843 起$|^from NT\$843$/);
  // A planner's own fare stands; a TPASS line stands; no train, no line.
  assert.equal(planFare({ fare: 500, legs: toTainan.legs }, net, price), null);
  assert.equal(fareOf(toTainan, { all: true }, planFare(toTainan, net, price)).text.includes('TPASS'), true);
  assert.equal(planFare({ legs: [{ mode: 'bus' }] }, net, price), null);
});

test('a 高鐵 ridden past the place and back: dropped beside a way about as soon, kept alone; round the island is no overshoot', () => {
  const hsrNet = network([st('hsr:1000', 25.0477, 121.5173), st('hsr:1040', 24.1121, 120.6157), st('hsr:1060', 22.9251, 120.2858), st('hsr:1070', 22.6873, 120.3076), st('tra:4220', 22.9971, 120.2127), st('tra:4340', 22.6876, 120.3077)], [], []);
  const p = (name, lat, lon) => ({ name, lat, lon });
  const [tpe, tnHsr, zy, tn, zyTra] = [p('高鐵台北', 25.0477, 121.5173), p('高鐵台南', 22.9251, 120.2858), p('高鐵左營', 22.6873, 120.3076), p('臺南', 22.9971, 120.2127), p('新左營', 22.6876, 120.3077)];
  const ride = (mode, from, to, dep, arr) => ({ mode, from, to, dep: T(dep), arr: T(arr) });
  const back = { legs: [ride('hsr', tpe, zy, 17.52, 19.08), { mode: 'walk' }, ride('tra', zyTra, tn, 19.25, 19.72)], dep: T(17.52), arr: T(19.72) };
  const direct = { legs: [ride('hsr', tpe, tnHsr, 17.35, 19.1), ride('tra', p('沙崙', 22.9244, 120.2869), tn, 19.47, 19.85)], dep: T(17.35), arr: T(19.85) };
  assert.equal(overshoots(back, hsrNet, tn), true);
  assert.equal(overshoots(direct, hsrNet, tn), false);
  assert.deepEqual(dropOvershoots([back, direct], hsrNet, tn), [direct]);
  // Nothing else within 15 minutes: kept (a way is better than none).
  assert.deepEqual(dropOvershoots([back, { ...direct, arr: T(20.5) }], hsrNet, tn).length, 2);
  assert.deepEqual(dropOvershoots([back], hsrNet, tn), [back]);
  // 台北 → 左營 → 台東: passes 台南, which is further from 台東 than 左營.
  const taitung = p('臺東', 22.7936, 121.1233);
  assert.equal(overshoots({ legs: [ride('hsr', tpe, zy, 16.85, 18.5), ride('tra', zyTra, taitung, 18.83, 21.22)] }, hsrNet, taitung), false);
});
