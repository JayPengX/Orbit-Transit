// A bus ride's fare, stop to stop (Jay 2026-11-09: "Add stop-to-stop bus
// fare lookup"): the route's fares as its operator publishes them, in each of
// the three ways a route is priced (段次 with its buffer zones, stop to stop
// for 公路客運, stages), and the riders said once each, those at one price together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fareBetween, fareRows, fareGroups, routeFares } from '../public/lib/fare.mjs';

const stop = (id, name) => ({ uid: `HSZ${id}`, id: String(id), name });
const stops = [stop(1, '新竹站'), stop(2, '東門'), stop(3, '關新路口'), stop(4, '光復新村'), stop(5, '清華大學'), stop(6, '交通大學'), stop(7, '科學園區')];
const way = { dir: 0, sub: 'HSZ010101', stops };
const S = (id, name) => ({ StopID: String(id), StopName: { Zh_tw: name } });
// 一般票 (1) and 電子票證 (3), for 成人 (1), 學生 (2), 敬老 (4), 愛心 (5).
const FARES = [
  { TicketType: 1, FareClass: 1, Price: 15 },
  { TicketType: 3, FareClass: 1, Price: 15 },
  { TicketType: 3, FareClass: 2, Price: 12 },
  { TicketType: 3, FareClass: 4, Price: 8 },
  { TicketType: 3, FareClass: 5, Price: 8 }
];

test('段次: a section a fare; each line crossed paid for, unless you get on or off in its buffer zone', () => {
  // The line between the two sections: 關新路口–光復新村 its buffer zone.
  const list = [{ RouteID: '0101', FarePricingType: 0, SectionFares: [{ BufferZones: [{ SectionSequence: 1, Direction: 0, FareBufferZoneOrigin: S(3, '關新路口'), FareBufferZoneDestination: S(4, '光復新村') }], Fares: FARES }] }];
  const fare = (a, b) => fareBetween(list, way, stops[a], stops[b]);
  assert.equal(fare(0, 1).sections, 1, 'inside the first section');
  assert.equal(fare(0, 6).sections, 2, 'across the line');
  assert.equal(fare(0, 6).fares.find(f => f.who === 'adult' && f.ticket === 'cash').price, 30);
  assert.equal(fare(2, 6).sections, 1, 'on in the buffer zone');
  assert.equal(fare(0, 3).sections, 1, 'off in the buffer zone');
  assert.equal(fare(4, 6).sections, 1, 'inside the second section');
  // The other way's buffer zones aren't this way's.
  assert.equal(fareBetween(list, { ...way, dir: 1 }, stops[0], stops[6]).sections, 2, 'no zone said for the way back: those said for any');
});

test('段次 with each count of sections named (一段票, 二段票): the one for the sections crossed, not a multiple', () => {
  const named = [
    { TicketType: 1, FareClass: 1, Price: 15, FareName: '一段票' },
    { TicketType: 1, FareClass: 1, Price: 25, FareName: '二段票' }
  ];
  const list = [{ FarePricingType: 0, SectionFares: [{ BufferZones: [{ Direction: 0, FareBufferZoneOrigin: S(3, ''), FareBufferZoneDestination: S(4, '') }], Fares: named }] }];
  assert.deepEqual(fareBetween(list, way, stops[0], stops[6]).fares.map(f => f.price), [25]);
  assert.deepEqual(fareBetween(list, way, stops[0], stops[1]).fares.map(f => f.price), [15]);
});

test('stop to stop (公路客運): the pair asked for, either way round it was published; none for a pair not published', () => {
  const list = [{ FarePricingType: 1, ODFares: [{ Direction: 0, OriginStop: S(1, '新竹站'), DestinationStop: S(5, '清華大學'), Fares: [{ TicketType: 1, FareClass: 1, Price: 42 }] }, { Direction: 1, OriginStop: S(7, '科學園區'), DestinationStop: S(2, '東門'), Fares: [{ TicketType: 1, FareClass: 1, Price: 55 }] }] }];
  const f = fareBetween(list, way, stops[0], stops[4]);
  assert.equal(f.kind, 'od');
  assert.equal(f.fares[0].price, 42);
  // (A pair published only for the way back: the same fare this way.)
  assert.equal(fareBetween(list, way, stops[1], stops[6]).fares[0].price, 55, 'the pair the other way round');
  assert.equal(fareBetween(list, way, stops[2], stops[3]), null);
  // A way from a bus pack: its stops have no StopID, their StopUID has it.
  const packed = { ...way, stops: stops.map(({ uid, name }) => ({ uid, name: `${name}站` })) };
  assert.equal(fareBetween(list, packed, packed.stops[0], packed.stops[4]).fares[0].price, 42);
});

test('stages: each stop in the stage it is in, the fare between the two stages', () => {
  const st = (id, seq) => ({ StopID: String(id), Sequence: seq });
  const list = [{ FarePricingType: 2, StageFares: [
    { Direction: 0, OriginStage: st(1, 1), DestinationStage: st(1, 1), Fares: [{ TicketType: 1, FareClass: 1, Price: 20 }] },
    { Direction: 0, OriginStage: st(1, 1), DestinationStage: st(4, 4), Fares: [{ TicketType: 1, FareClass: 1, Price: 35 }] },
    { Direction: 0, OriginStage: st(4, 4), DestinationStage: st(4, 4), Fares: [{ TicketType: 1, FareClass: 1, Price: 20 }] }
  ] }];
  assert.equal(fareBetween(list, way, stops[0], stops[2]).fares[0].price, 20, 'inside the first stage');
  assert.equal(fareBetween(list, way, stops[1], stops[5]).fares[0].price, 35, 'from the first stage into the second');
  assert.equal(fareBetween(list, way, stops[4], stops[6]).fares[0].price, 20, 'inside the second');
});

// As TDX publishes them (5608, 新竹's 2, read 2026-11-10): stages only between
// two stages, never inside one; 半票 as FareClass 10; IsForAllSubRoutes as 0.
test('stages as published: inside one stage the least fare (基本票價); 半票 said', () => {
  const st = (id, seq, name) => ({ StopID: String(id), StopName: name, Sequence: seq });
  const fares = (full, half) => [{ FareName: '全票_不分時段_四排座', TicketType: 1, FareClass: 1, Price: full }, { FareName: '半票_不分時段_四排座', TicketType: 1, FareClass: 10, Price: half }];
  const list = [{ SubRouteID: '010101', FarePricingType: 2, IsFreeBus: 0, IsForAllSubRoutes: 0, StageFares: [
    { Direction: 0, OriginStage: st(1, 1, '新竹站'), DestinationStage: st(4, 4, '光復新村'), Fares: fares(30, 15) },
    { Direction: 0, OriginStage: st(1, 1, '新竹站'), DestinationStage: st(6, 6, '交通大學'), Fares: fares(44, 22) },
    { Direction: 0, OriginStage: st(4, 4, '光復新村'), DestinationStage: st(6, 6, '交通大學'), Fares: fares(25, 12) }
  ] }];
  const f = (a, b) => fareBetween(list, way, stops[a], stops[b]);
  assert.deepEqual(fareRows(f(0, 1).fares), [{ who: 'adult', cash: 25, card: null }, { who: 'half', cash: 12, card: null }], 'inside the first stage: the least');
  assert.equal(f(1, 4).fares[0].price, 30, 'from the first stage into the second');
  assert.equal(f(0, 6).fares[0].price, 44);
  assert.equal(f(4, 5).fares[0].price, 25, 'inside the second');
  assert.equal(fareBetween(list, { ...way, sub: 'HSZ010102' }, stops[0], stops[6]).fares[0].price, 44, "another sub-route's (0: not for all) when its own are none");
});

test("a free bus; a way's own sub-route's fares before those for all; nothing for a ride the wrong way", () => {
  assert.deepEqual(fareBetween([{ IsFreeBus: true, FarePricingType: 0 }], way, stops[0], stops[3]), { kind: 'free', fares: [] });
  const sec = price => ({ FarePricingType: 0, SectionFares: [{ BufferZones: [], Fares: [{ TicketType: 1, FareClass: 1, Price: price }] }] });
  const list = [{ ...sec(15), IsForAllSubRoutes: true }, { ...sec(20), SubRouteUID: 'HSZ010101', SubRouteID: '010101' }];
  assert.equal(fareBetween(list, way, stops[0], stops[1]).fares[0].price, 20);
  assert.equal(fareBetween(list, { ...way, sub: 'HSZ010102' }, stops[0], stops[1]).fares[0].price, 15);
  assert.equal(fareBetween(list, way, stops[3], stops[1]), null, 'off before on');
  assert.equal(fareBetween([], way, stops[0], stops[1]), null, 'nothing published');
});

test('the riders: 全票 first, cash and (when it differs) card, and those at one price together', () => {
  const rows = fareRows(fareBetween([{ FarePricingType: 0, SectionFares: [{ BufferZones: [], Fares: FARES }] }], way, stops[0], stops[1]).fares);
  assert.deepEqual(rows, [
    { who: 'adult', cash: 15, card: null },
    { who: 'student', cash: null, card: 12 },
    { who: 'elder', cash: null, card: 8 },
    { who: 'care', cash: null, card: 8 }
  ]);
  assert.deepEqual(fareGroups(rows.slice(1)), [
    { who: ['student'], cash: null, card: 12 },
    { who: ['elder', 'care'], cash: null, card: 8 }
  ]);
});

test("routeFares: one read a route (the 公路客運's own, a city's, 臺南's in v3's object), its own rows of a name others share", async () => {
  const api = await import('../public/lib/api.mjs');
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    const p = u.searchParams.get('p');
    asked.push(p);
    const rows = [{ RouteID: '5608', FarePricingType: 1 }, { RouteID: '5608A', FarePricingType: 1 }];
    return new Response(JSON.stringify(p.includes('/v3/') ? { RouteFares: rows } : rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const own = await routeFares({ city: 'InterCity', uid: 'THB5608', name: '5608' });
    assert.deepEqual(own.map(r => r.RouteID), ['5608']);
    await routeFares({ city: 'Tainan', uid: 'TNN5608', name: '綠1' });
    await routeFares({ city: 'Hsinchu', uid: 'HSZ0010', name: '1' });
    assert.deepEqual(asked, ['basic/v2/Bus/RouteFare/InterCity/5608', 'basic/v3/Bus/RouteFare/City/Tainan/%E7%B6%A01', 'basic/v2/Bus/RouteFare/City/Hsinchu/1']);
  } finally {
    globalThis.fetch = was;
  }
});
