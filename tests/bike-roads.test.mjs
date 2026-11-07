import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bikeTrip, useStreetWalks, useStreetRides } from '../public/lib/plan.mjs';

// Jay 2026-11-07, from 墨竹亭 on 竹北's 博愛街 home to 成功九街: told to return
// the bike at 新竹縣體育場 ("it should pick 成功國中 cause that's more
// intuitive"). Google's walks had stopped answering (its matrix, 403), so the
// walk from 成功國中 was OpenStreetMap's 460 m round the school, not Google's
// 267 by the lane; and the rides were the straight line, 綠41公園 counted as
// walked back twice. Real numbers (2026-11-07): the rides from 文信爬蟲兩棲公園
// by OpenStreetMap's bike router, the walks Google's and OpenStreetMap's.
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
const osm = [[key(home, school), 460], [key(home, stadium), 385], [key(home, park), 250], [key(from, dock), 252]];
let walks = new Map(osm);
const rides = new Map([[key(dock, school), 2167], [key(dock, stadium), 2258], [key(dock, park), 2624], [key(dock, home), 2357]]);
const walkOf = (a, b) => walks.get(key(a, b)) ?? walks.get(key(b, a)) ?? null;
const t = Date.UTC(2026, 10, 7, 4, 0);

test('Google’s walk by the lane and the rides by the roads: back at 成功國中, by the door', () => {
  walks = new Map([...osm, [key(home, school), 267]]);
  useStreetWalks(walkOf);
  useStreetRides((a, b) => rides.get(key(a, b)) ?? null);
  try {
    const legs = bikeTrip(from, home, bikes, t);
    const ride = legs.find(l => l.mode === 'bike');
    assert.equal(ride.from.name, '文信爬蟲兩棲公園');
    assert.equal(ride.to.name, '成功國中');
    // (The ride's length the roads', not the straight line and a quarter.)
    assert.equal(ride.dist, 2167);
    assert.equal(legs.at(-1).dist, 267);
  } finally {
    useStreetWalks(() => null);
    useStreetRides(() => null);
  }
});

test('OpenStreetMap’s walks alone (round the school): by the roads 綠41公園, the shorter walk, never 新竹縣體育場 on the straight line', () => {
  walks = new Map(osm);
  useStreetWalks(walkOf);
  useStreetRides((a, b) => rides.get(key(a, b)) ?? null);
  try {
    assert.equal(bikeTrip(from, home, bikes, t).find(l => l.mode === 'bike').to.name, '綠41公園');
  } finally {
    useStreetWalks(() => null);
    useStreetRides(() => null);
  }
});
