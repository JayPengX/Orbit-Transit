// Trips for the GPS runs (nav-gps.test.mjs, scripts/gps-sweep.mjs): real-looking
// shapes (roads that turn, a bus line past your stop, a train line), a plan and
// the ride's stops as navigation knows them.
import { off, T } from './navsim.mjs';

const L = s => ({ name: s.name, lat: s.lat, lon: s.lon });
const O = { name: 'Home', lat: 24.8, lon: 120.97 };

// A bus: a walk 300 m east, a line that goes east then turns north (stops
// 350 m apart, two more past yours), off at the 5th stop, 150 m to the place.
export function busRide({ depMin = 10 } = {}) {
  const S0 = off(O, 0, 300);
  const pts = [];
  for (let k = 0; k < 9; k++) pts.push(k < 4 ? off(S0, 0, k * 350) : off(off(S0, 0, 3 * 350), (k - 3) * 350, 40 * (k - 3)));
  const st = pts.map((p, k) => ({ uid: 's' + k, name: '站' + k, ...p }));
  const offAt = 6;
  const D = { name: 'Dest', ...off(st[offAt], 0, 150) };
  const t0 = T(8);
  const legs = [
    { mode: 'walk', from: O, to: L(st[0]), dep: t0, arr: t0 + 4 * 60e3, dur: 240 },
    { mode: 'bus', name: '5608', short: '5608', from: L(st[0]), to: L(st[offAt]), dep: t0 + depMin * 60e3, arr: t0 + (depMin + 7) * 60e3, dur: 420, path: st.slice(0, offAt + 1).map(s => [s.lat, s.lon]) },
    { mode: 'walk', from: L(st[offAt]), to: D, dep: t0 + (depMin + 7) * 60e3, arr: t0 + (depMin + 9) * 60e3, dur: 120 }
  ];
  return { plan: { legs, dep: t0, arr: legs[2].arr, dest: { name: 'Dest', lat: D.lat, lon: D.lon } }, rides: new Map([[1, { stops: st, i: 0, j: offAt }]]), more: new Map([[1, st.slice(offAt + 1)]]) };
}

// A train: a walk 500 m to the station, four stations 4–6 km apart along a
// line that bends, off at the 4th, 300 m on.
export function trainRide({ depMin = 12 } = {}) {
  const A = off(O, 0, 500);
  const xs = [
    [0, 0],
    [1500, 4000],
    [4000, 8500],
    [8500, 11500],
    [13500, 13000],
    [18000, 16000]
  ];
  const st = xs.map(([n, e], k) => ({ uid: 't' + k, name: '車站' + k, ...off(A, n, e) }));
  const offAt = 3;
  const D = { name: 'Dest', ...off(st[offAt], 300, 0) };
  const t0 = T(8);
  const legs = [
    { mode: 'walk', from: O, to: L(st[0]), dep: t0, arr: t0 + 7 * 60e3, dur: 420 },
    { mode: 'tra', name: '區間 1234', short: '1234', train: { no: '1234', type: '區間' }, from: L(st[0]), to: L(st[offAt]), dep: t0 + depMin * 60e3, arr: t0 + (depMin + 14) * 60e3, dur: 840, path: st.slice(0, offAt + 1).map(s => [s.lat, s.lon]) },
    { mode: 'walk', from: L(st[offAt]), to: D, dep: t0 + (depMin + 14) * 60e3, arr: t0 + (depMin + 18) * 60e3, dur: 240 }
  ];
  return { plan: { legs, dep: t0, arr: legs[2].arr, dest: { name: 'Dest', lat: D.lat, lon: D.lon } }, rides: new Map([[1, { stops: st, i: 0, j: offAt }]]), more: new Map([[1, st.slice(offAt + 1)]]) };
}

// A change: the bus above, a walk 250 m to a station, the train on.
export function busThenTrain() {
  const b = busRide({ depMin: 6 });
  const bl = b.plan.legs;
  const stop = bl[1].to;
  const A = off(stop, 0, 250);
  const xs = [
    [0, 0],
    [2000, 4000],
    [5000, 8000],
    [9000, 11000]
  ];
  const st = xs.map(([n, e], k) => ({ uid: 't' + k, name: '車站' + k, ...off(A, n, e) }));
  const D = { name: 'Dest', ...off(st[2], 200, 0) };
  const t1 = bl[1].arr;
  const legs = [
    bl[0],
    bl[1],
    { mode: 'walk', from: stop, to: L(st[0]), dep: t1, arr: t1 + 4 * 60e3, dur: 240 },
    { mode: 'tra', name: '區間 2222', short: '2222', train: { no: '2222', type: '區間' }, from: L(st[0]), to: L(st[2]), dep: t1 + 9 * 60e3, arr: t1 + 19 * 60e3, dur: 600, path: st.slice(0, 3).map(s => [s.lat, s.lon]) },
    { mode: 'walk', from: L(st[2]), to: D, dep: t1 + 19 * 60e3, arr: t1 + 22 * 60e3, dur: 180 }
  ];
  return {
    plan: { legs, dep: bl[0].dep, arr: legs[4].arr, dest: { name: 'Dest', lat: D.lat, lon: D.lon } },
    rides: new Map([
      [1, b.rides.get(1)],
      [3, { stops: st, i: 0, j: 2 }]
    ]),
    more: new Map([
      [1, b.more.get(1)],
      [3, st.slice(3)]
    ])
  };
}
export const TRIPS = { bus: busRide, train: trainRide, change: busThenTrain };

// The train above to the station itself: no walk after (a walk of 20 m or
// less is left out of a plan), the trip ends on the train.
export function trainToStation() {
  const t = trainRide();
  const legs = t.plan.legs.slice(0, 2);
  const to = legs[1].to;
  return { ...t, plan: { legs, dep: t.plan.dep, arr: legs[1].arr, dest: { name: to.name, lat: to.lat, lon: to.lon } } };
}
TRIPS.station = trainToStation;
