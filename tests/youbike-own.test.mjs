import test from 'node:test';
import assert from 'node:assert/strict';
import { ybRows, ybUid, circlesOf, cityBikes, YB_LIVE, ybDrop } from '../public/lib/bike.mjs';
import { useSession } from '../public/lib/api.mjs';

test("YouBike's own counts in TDX's words: TDX's ids, bikes, e-bikes, docks, paused", () => {
  const [r] = ybRows([{ station_no: '500401063', parking_spaces: 81, available_spaces: 16, available_spaces_detail: { yb2: 12, eyb: 4 }, empty_spaces: 64, lat: '24.80189', lng: '120.97099', status: 2 }], Date.parse('2026-11-10T03:00:00Z'));
  assert.deepEqual(r, { StationUID: 'HSZ500401063', ServiceStatus: 2, AvailableRentBikes: 16, AvailableReturnBikes: 64, AvailableRentBikesDetail: { GeneralBikes: 12, ElectricBikes: 4 }, UpdateTime: '2026-11-10T11:00:00+08:00' });
  assert.equal(ybUid('508201001'), 'HSZ508201001', '竹科, listed with 新竹市');
  assert.equal(ybRows([{ station_no: '999900001' }]).length, 0, "a system YouBike doesn't run here");
});

test("a city's stations covered by 10 km circles: 新竹市 one, two far apart two", () => {
  const st = (lat, lon) => ({ StationUID: 'HSZ1', StationPosition: { PositionLat: lat, PositionLon: lon } });
  assert.equal(circlesOf([st(24.80, 120.97), st(24.81, 120.99), st(24.78, 120.95)]).length, 1);
  assert.equal(circlesOf([st(24.80, 120.97), st(25.05, 121.52)]).length, 2);
});

test("cityBikes: names from the proxy's station list, counts from YouBike itself; YouBike away: the proxy's counts", async () => {
  useSession({ ensureToken: async () => 'T' });
  const was = globalThis.fetch;
  const asked = [];
  let up = true;
  const station = { StationUID: 'HSZ500401063', StationName: { Zh_tw: 'YouBike2.0_新竹火車站', En: 'Hsinchu Sta.' }, StationPosition: { PositionLat: 24.80189, PositionLon: 120.97099 }, BikesCapacity: 81, ServiceType: 2 };
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url?.url || url));
    asked.push(u);
    const j = b => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } });
    if (u === YB_LIVE) return up ? j({ retCode: 1, retVal: [{ station_no: '500401063', parking_spaces: 81, available_spaces: 9, available_spaces_detail: { yb2: 9, eyb: 0 }, empty_spaces: 72, status: 1 }] }) : new Response('', { status: 403 });
    if (u.includes('Bike/Station')) return j([station]);
    if (u.includes('Bike/Availability')) return j([{ StationUID: 'HSZ500401063', ServiceStatus: 1, AvailableRentBikes: 3, AvailableReturnBikes: 70 }]);
    return j([]);
  };
  const realNow = Date.now;
  try {
    const got = await cityBikes('Hsinchu');
    const [s] = got;
    assert.deepEqual([s.name, s.bikes, s.ret, s.ok], ['新竹火車站', 9, 72, true]);
    assert.ok(!asked.some(u => u.includes('Bike/Availability')), "no proxy counts");
    up = false;
    ybDrop();
    const [t] = await cityBikes('Hsinchu');
    assert.equal(t.bikes, 3, "the proxy's");
  } finally {
    globalThis.fetch = was;
  }
});
