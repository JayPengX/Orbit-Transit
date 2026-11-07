import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bikeTrip, useStreetWalks, useStreetRides } from '../public/lib/plan.mjs';

// Jay 2026-11-07, from 墨竹亭 on 竹北's 博愛街 home to 成功九街: told to return
// the bike at 新竹縣體育場 (400 m from the door) over 綠41公園 (250 m). On the
// straight line 綠41公園 looked past the door and was counted as walked back
// twice; by the roads (OpenStreetMap's bike router, 2026-11-07) the two ride
// the same and 綠41公園 is the shorter walk.
const P = (name, lat, lon) => ({ name, lat, lon });
const from = P('墨竹亭', 24.8335, 121.0085);
const home = P('成功九街', 24.8176, 121.0165);
const st = (uid, name, lat, lon) => ({ uid, name, lat, lon, kind: 'yb2', bikes: 5, ebike: 3, ret: 10, ok: true });
const dock = st('w', '文信爬蟲兩棲公園', 24.83231, 121.00963);
const school = st('c', '成功國中', 24.81872, 121.01597);
const stadium = st('t', '新竹縣體育場', 24.81913, 121.01859);
const park = st('g', '綠41公園', 24.81614, 121.0171);
const bikes = [dock, school, stadium, park];
const key = (a, b) => `${a.lat.toFixed(5)},${a.lon.toFixed(5)}|${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
// The streets' walks from the door (Google's or OpenStreetMap's, the shorter) and the rides from the dock.
const walks = new Map([[key(home, school), 460], [key(home, stadium), 385], [key(home, park), 250], [key(from, dock), 252]]);
const rides = new Map([[key(dock, school), 2167], [key(dock, stadium), 2258], [key(dock, park), 2624], [key(dock, home), 2357]]);
const walkOf = (a, b) => walks.get(key(a, b)) ?? walks.get(key(b, a)) ?? null;
const t = Date.UTC(2026, 10, 7, 4, 0);

test('by the roads, the bike goes back at 綠41公園, the station nearest the door, not 新竹縣體育場', () => {
  useStreetWalks(walkOf);
  useStreetRides((a, b) => rides.get(key(a, b)) ?? null);
  try {
    const legs = bikeTrip(from, home, bikes, t);
    const ride = legs.find(l => l.mode === 'bike');
    assert.equal(ride.from.name, '文信爬蟲兩棲公園');
    assert.equal(ride.to.name, '綠41公園');
    // (The ride's length the roads', not the straight line and a quarter.)
    assert.equal(ride.dist, 2624);
    assert.equal(legs.at(-1).dist, 250);
  } finally {
    useStreetWalks(() => null);
    useStreetRides(() => null);
  }
});

test('with no roads known (offline, the router slow), the straight line as before', () => {
  useStreetWalks(walkOf);
  try {
    const legs = bikeTrip(from, home, bikes, t);
    assert.equal(legs.find(l => l.mode === 'bike').to.name, '新竹縣體育場');
  } finally {
    useStreetWalks(() => null);
  }
});
