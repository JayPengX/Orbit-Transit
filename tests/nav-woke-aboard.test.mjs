// Jay 2026-11-07, 08:14 on 普悠瑪 107 新竹 → 彰化, past 香山 by the coast: the
// trip card said 「搭 台鐵 自強 105 次・新竹 08:23 開」, the bottom 09:52 晚 19 分,
// and the line was drawn straight 新竹 → 彰化, km off his dot. His phone,
// back from sleep, handed over its last fix (at 新竹 station) as if new: the
// trip took him for still there after 107 left, 沒趕上, and moved him to 105
// (dropping 107's line); 105's walk after it was moved by when it leaves, not
// when it gets in. Replayed here on that morning's real stations and times.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, pos, tick, start, show, box } from './navsim.mjs';
const nav = await import('../public/lib/nav.mjs');

const settle = async () => {
  for (let n = 0; n < 50; n++) await new Promise(r => setImmediate(r));
};
const D = s => Date.parse(`2026-11-07T${s}:00+08:00`);
// TDX's stations (Station, 2026-11-07) and that day's DailyTrainTimetable.
const ST = { 1210: ['新竹', 24.80157, 120.97157], 1220: ['三姓橋', 24.78731, 120.92844], 1230: ['香山', 24.76311, 120.91388], 1240: ['崎頂', 24.72291, 120.87183], 1250: ['竹南', 24.68654, 120.88041], 3160: ['苗栗', 24.57001, 120.82233], 3300: ['臺中', 24.13728, 120.68691], 3360: ['彰化', 24.08177, 120.53854] };
const sts = Object.entries(ST).map(([id, [name, lat, lon]]) => ({ key: `tra:${id}`, sys: 'tra', name, lat, lon }));
const S = id => ({ name: ST[id][0], lat: ST[id][1], lon: ST[id][2] });
const run = (no, type, stops) => ({ sys: 'tra', no, type, stops: stops.map(([id, a, d]) => ({ st: `tra:${id}`, arr: D(a), dep: D(d ?? a) })) });
const trips = [
  run('107', '普悠瑪', [[1210, '08:05', '08:07'], [3300, '08:54', '08:56'], [3360, '09:08', '09:10']]),
  run('105', '自強', [[1210, '08:20', '08:22'], [1250, '08:36', '08:38'], [3160, '08:48', '08:49'], [3300, '09:25', '09:27'], [3360, '09:41', '09:43']]),
  run('1117', '區間', [[1210, '07:58', '08:00'], [1220, '08:05'], [1230, '08:09', '08:15'], [1240, '08:21'], [1250, '08:26', '08:27'], [3160, '08:42']])
];
// TrainLiveBoard at 08:15: 107 just past 香山 on time, 105 at 新豐 1 late.
const live = new Map([['107', { delay: 0, st: 'tra:1230', status: 2 }], ['105', { delay: 1, st: 'tra:1170', status: 2 }]]);
const line = [1210, 1220, 1230, 1240, 1250, 3160, 3300, 3360].map(id => [ST[id][1], ST[id][2]]);
const dest = { name: '彰化', lat: 24.079, lon: 120.545 };
function trip() {
  nav.useRail({ dayTrips: async () => trips, railStations: async () => sts, traLive: async () => live });
  const legs = [
    { mode: 'walk', from: { name: 'Home', lat: 24.804, lon: 120.976 }, to: S(1210), dep: D('07:55'), arr: D('08:01'), dur: 360 },
    { mode: 'tra', name: '普悠瑪', short: '普悠瑪 107', train: { no: '107', type: '普悠瑪' }, from: S(1210), to: S(3360), dep: D('08:07'), arr: D('09:08'), dur: 3660, path: line },
    { mode: 'walk', from: S(3360), to: dest, dep: D('09:08'), arr: D('09:18'), dur: 600 }
  ];
  return { legs, dep: legs[0].dep, arr: legs.at(-1).arr, tags: [], dest };
}
// 107 by the coast: 新竹 08:07, 三姓橋 08:10, 香山 08:12:50, 崎頂 08:15:30, 竹南 08:18.
const way = [[D('08:07'), 1210], [D('08:10'), 1220], [D('08:12') + 50e3, 1230], [D('08:15') + 30e3, 1240], [D('08:18'), 1250]];
const where = t => {
  for (let x = 0; x < way.length - 1; x++) {
    const [t0, a] = way[x];
    const [t1, b] = way[x + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return { lat: ST[a][1] + (ST[b][1] - ST[a][1]) * f, lon: ST[a][2] + (ST[b][2] - ST[a][2]) * f };
    }
  }
};
const topText = () => box.querySelector('.ot-nav-topw').innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
// At 新竹 station from 08:01 to 08:06:40, a fix every 20 s.
async function atStation() {
  clock.set(D('08:01'));
  const r = start(trip(), { resume: { i: 1, phase: 'before', reached: 1 } });
  for (let t = D('08:01'); t < D('08:07'); t += 20_000) {
    clock.set(t);
    pos({ lat: ST[1210][1], lon: ST[1210][2] });
    tick(1000);
    await settle();
  }
  assert.deepEqual(show(r.st), { i: 1, phase: 'before', reached: 1 });
  return r;
}
// Asleep from 08:07 to `wake` (no fix, no timer); back, then a fix every 5 s along the coast.
async function ride(s, wake, until, first = null) {
  clock.set(wake);
  if (first) {
    first();
    tick(1000);
    await settle();
  }
  for (let t = wake; t <= until; t += 5000) {
    clock.set(t);
    pos(where(t), 15);
    tick(1000);
    await settle();
  }
}

test('back from sleep on 107 past 香山, the phone’s old fix at 新竹 handed over first: never 沒趕上, on 107, there 09:18', async () => {
  const { st: s } = await atStation();
  await ride(s, D('08:14'), D('08:15'), () => pos({ lat: ST[1210][1], lon: ST[1210][2] }, 30, D('08:06') + 40e3));
  assert.equal(String(s.plan.legs[1].train.no), '107', 'the train he is on');
  assert.ok(!/沒趕上|Missed/.test(s.swap?.text || ''), `no miss said: ${s.swap?.text}`);
  assert.deepEqual(show(s), { i: 1, phase: 'on', reached: 1 });
  assert.equal(s.plan.arr, D('09:18'));
  s.render();
  assert.match(topText(), /坐到 彰化 下車/);
  assert.doesNotMatch(topText(), /搭 台鐵 自強 105/);
});

test('its last good fix 250 m out as 107 pulled away, then nothing: not taken as missed, on it once fixes come', async () => {
  const { st: s } = await atStation();
  clock.set(D('08:07') + 50e3);
  pos(where(D('08:07') + 10e3), 20);
  await settle();
  // (Silent in the train till 08:10, the live board read meanwhile: at 08:09:40, past 107's time and 2½ minutes.)
  for (let t = D('08:07') + 55e3; t < D('08:10'); t += 5000) {
    clock.set(t);
    tick(1000);
    if (t === D('08:09') + 40e3) s.go(s.i, s.phase);
    await settle();
  }
  assert.equal(String(s.plan.legs[1].train.no), '107');
  await ride(s, D('08:10'), D('08:11'));
  assert.equal(String(s.plan.legs[1].train.no), '107');
  assert.deepEqual(show(s), { i: 1, phase: 'on', reached: 1 });
});

test('the old fix taken as new (no stamp to tell): 105 for a moment, then on 107 again within a minute of the coast, there 09:18', async () => {
  const { st: s } = await atStation();
  await ride(s, D('08:14'), D('08:15'), () => pos({ lat: ST[1210][1], lon: ST[1210][2] }, 30));
  assert.equal(String(s.plan.legs[1].train.no), '107', 'the train he is on, found from where he is');
  assert.deepEqual(show(s), { i: 1, phase: 'on', reached: 1 });
  assert.equal(s.plan.arr, D('09:18'));
  assert.ok(!/沒趕上|Missed/.test(s.swap?.text || ''), `the miss taken back: ${s.swap?.text}`);
});

test('another train taken: what follows moves by when it gets in (105 for 107: the walk 09:41 → 09:51, not 09:33), its line found again', () => {
  const plan = trip();
  nav.retimeRide(plan, 1, { dep: D('08:22'), arr: D('09:41'), train: { sys: 'tra', no: '105', type: '自強' } });
  assert.equal(plan.legs[2].dep, D('09:41'));
  assert.equal(plan.arr, D('09:51'));
  plan.legs[1].stopsChecked = true;
  nav.retimeRide(plan, 1, { dep: D('08:07'), arr: D('09:08'), train: { sys: 'tra', no: '107', type: '普悠瑪' } });
  assert.equal(plan.arr, D('09:18'));
  assert.ok(!plan.legs[1].path && !plan.legs[1].stopsChecked, 'its line to be found again (tab-map navDraw), never the old train’s nor a straight one');
  nav.useRail({});
});
