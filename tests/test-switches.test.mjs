// The 測試工具's own switches (lib/testing.mjs): each changes what's shown, and nothing without its flag.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { etaOf, etaText } from '../public/lib/bus.mjs';
import { mergeBikes } from '../public/lib/bike.mjs';
import { holidayOn, tw } from '../public/lib/util.mjs';
import { routeStatus, stoppedNow } from '../public/lib/service.mjs';

afterEach(() => delete globalThis.ORBIT_TEST);
const row = { RouteUID: 'HSZ0007', RouteName: { Zh_tw: '7' }, StopUID: 'HSZ1', StopStatus: 1, EstimateTime: null };

test('busNow: every bus as picked; off: 今日停駛; none set: as TDX said', () => {
  assert.equal(etaText(etaOf(row)).main.includes('進站'), false);
  globalThis.ORBIT_TEST = { flags: { busNow: 'now' } };
  assert.equal(etaText(etaOf(row)).tone, 'now');
  globalThis.ORBIT_TEST = { flags: { busNow: 'off' } };
  assert.equal(etaOf(row).status, 4);
  // (The route's sheet and the plans read the route's status: off there too, never the timetable's times.)
  assert.equal(stoppedNow('HSZ0007', '7')?.effect, 'off');
  assert.equal(routeStatus('HSZ0007', '7').notices.length, 0);
  globalThis.ORBIT_TEST = { flags: {} };
  assert.equal(stoppedNow('HSZ0007', '7'), null);
});

test('bikes: empty stations; dayOff: today off', () => {
  const st = { rows: [{ StationUID: 'a', StationName: { Zh_tw: 'YouBike2.0_站' }, StationPosition: { PositionLat: 24.8, PositionLon: 121 }, BikesCapacity: 20 }] };
  const live = { rows: [{ StationUID: 'a', ServiceStatus: 1, AvailableRentBikes: 5, AvailableReturnBikes: 15, AvailableRentBikesDetail: { GeneralBikes: 5, ElectricBikes: 0 } }] };
  assert.equal(mergeBikes(st.rows, live.rows)[0].bikes, 5);
  globalThis.ORBIT_TEST = { flags: { bikes: 'empty' } };
  assert.equal(mergeBikes(st.rows, live.rows)[0].bikes, 0);
  const today = tw().date;
  globalThis.ORBIT_TEST = { flags: { dayOff: true } };
  assert.equal(holidayOn(today), true);
});
