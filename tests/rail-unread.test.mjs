// A day's trains read while TDX failed (11-17): held as read, one blip at the
// day's first plan left every plan of the session without 台鐵 and 高鐵
// (dayTrips and the network kept the empty day), and 台鐵 failing beside a
// 高鐵 that answered took 台鐵 out of the day. Now the day is asked again a
// minute on, the network built again with it, and a system unread takes its
// trains from the copy kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { useSession } from '../public/lib/api.mjs';
import { dayTrips, railNetwork } from '../public/lib/raildata.mjs';

const DATE = '2030-01-08';
const tra = { TrainDate: DATE, TrainTimetables: [{ TrainInfo: { TrainNo: '1101', TrainTypeCode: '6', TrainTypeName: { Zh_tw: '區間' }, EndingStationName: { Zh_tw: '新竹' } }, StopTimes: [{ StationID: '1000', ArrivalTime: '08:00', DepartureTime: '08:00' }, { StationID: '1210', ArrivalTime: '09:00', DepartureTime: '09:00' }] }] };
const hsr = [{ TrainDate: DATE, DailyTrainInfo: { TrainNo: '0101', EndingStationName: { Zh_tw: '左營' } }, StopTimes: [{ StationID: '1000', ArrivalTime: '08:00', DepartureTime: '08:00' }, { StationID: '1030', ArrivalTime: '08:30', DepartureTime: '08:30' }] }];

test('a day read while TDX failed is asked again a minute on, and the network built again with its trains', async () => {
  useSession({ ensureToken: async () => 'T' });
  const was = { fetch: globalThis.fetch, now: Date.now };
  let down = true;
  let clock = Date.parse(`${DATE}T00:00:00Z`);
  Date.now = () => clock;
  globalThis.fetch = async url => {
    const u = decodeURIComponent(String(url?.url || url));
    const j = b => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
    if (/DailyTrainTimetable|DailyTimetable/.test(u)) return down ? new Response('', { status: 503 }) : j(/THSR/.test(u) ? hsr : tra);
    if (/Station/.test(u)) return j(/THSR/.test(u) ? [] : { Stations: [] });
    return j({ Alerts: [] });
  };
  try {
    assert.equal((await dayTrips(DATE)).length, 0, 'TDX down: no trains');
    await railNetwork(DATE).catch(() => null);
    down = false;
    assert.equal((await dayTrips(DATE)).length, 0, 'within the minute: not asked again');
    clock += 61_000;
    const net = railNetwork(DATE).catch(() => null);
    const got = await dayTrips(DATE);
    assert.deepEqual(got.map(t => t.sys).sort(), ['hsr', 'tra'], 'a minute on: the day read again');
    await net;
  } finally {
    globalThis.fetch = was.fetch;
    Date.now = was.now;
  }
});
