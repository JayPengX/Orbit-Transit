// node scripts/navstate.mjs <walk|wait|on|train|bike|long> → an ot.nav.v1 value: a navigation to preview (preview.mjs transit --store "ot.nav.v1=…")
const now = Date.now(), m = x => now + x * 60_000;
const here = { lat: 24.8026, lon: 120.9702 };
const stop = { name: '新竹車站(中正路)', lat: 24.8026, lon: 120.9702 };
const far = { name: '新竹車站(中正路)', lat: 24.8056, lon: 120.9722 };
const sc = process.argv[2];
const bus = (from, d) => ({ mode: 'bus', name: '5608', short: '5608', headsign: '竹東', from, to: { name: '竹東站', lat: 24.7360, lon: 121.0920 }, dep: m(d), arr: m(d + 30), dur: 1800, stops: 18 });
let legs, i = 0, phase = 'before';
if (sc === 'walk') legs = [{ mode: 'walk', from: { name: '', ...here }, to: far, dep: m(0), arr: m(5), dur: 300, dist: 400 }, bus(far, 7), { mode: 'walk', from: { name: '竹東站', lat: 24.736, lon: 121.092 }, to: { name: '竹東高中', lat: 24.733, lon: 121.088 }, dep: m(37), arr: m(43), dur: 360, dist: 450 }];
if (sc === 'wait' || sc === 'on') { legs = [{ mode: 'walk', from: { name: '', lat: 24.80, lon: 120.968 }, to: stop, dep: m(-5), arr: m(0), dur: 300, dist: 400 }, bus(stop, 4), { mode: 'walk', from: { name: '竹東站', lat: 24.736, lon: 121.092 }, to: { name: '竹東高中', lat: 24.733, lon: 121.088 }, dep: m(34), arr: m(40), dur: 360, dist: 450 }]; i = 1; phase = sc === 'on' ? 'on' : 'before'; }
if (sc === 'train') { legs = [{ mode: 'walk', from: { name: '', lat: 24.80, lon: 120.968 }, to: { name: '新竹', lat: 24.8016, lon: 120.9716 }, dep: m(-5), arr: m(0), dur: 300 }, { mode: 'tra', name: '區間', short: '區間 1247', train: { no: '1247', platform: '2A' }, headsign: '往 竹東', from: { name: '新竹', lat: 24.8016, lon: 120.9716 }, to: { name: '竹東', lat: 24.736, lon: 121.092 }, dep: m(6), arr: m(30), dur: 1440, stops: 7 }, { mode: 'walk', from: { name: '竹東', lat: 24.736, lon: 121.092 }, to: { name: '竹東高中', lat: 24.733, lon: 121.088 }, dep: m(30), arr: m(36), dur: 360 }]; i = 1; }
if (sc === 'bike') { legs = [{ mode: 'walk', from: { name: '', ...here }, to: { name: '新竹火車站(前站)', lat: 24.8030, lon: 120.9710 }, dep: m(0), arr: m(2), dur: 120 }, { mode: 'bike', name: 'YouBike', from: { name: '新竹火車站(前站)', lat: 24.8030, lon: 120.9710 }, to: { name: '清華大學', lat: 24.7940, lon: 120.9930 }, dep: m(2), arr: m(14), dur: 720, dist: 2900 }, { mode: 'walk', from: { name: '清華大學', lat: 24.794, lon: 120.993 }, to: { name: '清華大學 台達館', lat: 24.7955, lon: 120.9925 }, dep: m(14), arr: m(17), dur: 180 }]; }
// The owner's kind of trip, eight steps: a walk, a bike to the train, a change to the 六家線, a bike home.
if (sc === 'long') {
  const P = (name, lat, lon) => ({ name, lat, lon });
  const dock = P('新竹火車站(前站)', 24.803, 120.971), nh = P('北新竹', 24.809, 120.985), zz = P('竹中', 24.782, 121.031), lj = P('六家', 24.8078, 121.039), park = P('綠41公園', 24.8165, 121.0172);
  legs = [
    { mode: 'walk', from: { name: '', ...here }, to: dock, dep: m(0), arr: m(4), dur: 240 },
    { mode: 'bike', name: 'YouBike', from: dock, to: P('北新竹車站', 24.8088, 120.9845), dep: m(4), arr: m(10), dur: 360, dist: 1600 },
    { mode: 'walk', from: P('北新竹車站', 24.8088, 120.9845), to: nh, dep: m(10), arr: m(11), dur: 60 },
    { mode: 'tra', name: '區間', short: '區間 1831', train: { no: '1831' }, headsign: '往 竹中', from: nh, to: zz, dep: m(14), arr: m(26), dur: 720, stops: 3 },
    { mode: 'tra', name: '區間', short: '區間 1758', train: { no: '1758' }, headsign: '往 六家', from: zz, to: lj, dep: m(32), arr: m(37), dur: 300, stops: 1 },
    { mode: 'walk', from: lj, to: P('臺鐵六家車站', 24.8079, 121.0392), dep: m(37), arr: m(38), dur: 60 },
    { mode: 'bike', name: 'YouBike', from: P('臺鐵六家車站', 24.8079, 121.0392), to: park, dep: m(38), arr: m(53), dur: 900, dist: 3000 },
    { mode: 'walk', from: park, to: P('成功九街', 24.8176, 121.0165), dep: m(53), arr: m(56), dur: 180 }
  ];
}
const plan = { tags: [], transfers: 0, walk: 400, legs, dep: legs[0].dep, arr: legs.at(-1).arr, dur: (legs.at(-1).arr - legs[0].dep) / 1000, dest: { name: legs.at(-1).to.name, lat: legs.at(-1).to.lat, lon: legs.at(-1).to.lon } };
process.stdout.write(JSON.stringify({ plan, i, phase, at: now }));
