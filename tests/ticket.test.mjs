// 指定車次 (ticket.mjs): a train found by its number, where you'd get on and off, and found again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { network } from '../public/lib/rail.mjs';
import { trainsNumbered, boardAlight, rideOf, ticketOf, ridesIn, onTicketTrain } from '../public/lib/ticket.mjs';

const T = h => Date.UTC(2026, 10, 4, h - 8);
const st = (key, lat, lon) => ({ key, sys: key.split(':')[0], id: key.split(':')[1], name: key, lat, lon });
const stations = [st('tra:A', 24.80, 121.00), st('tra:B', 24.70, 120.95), st('tra:C', 24.40, 120.80), st('tra:D', 24.10, 120.68), st('hsr:X', 24.80, 121.04), st('hsr:Y', 24.11, 120.62)];
const trip = (sys, no, type, stops) => ({ id: `${sys}:2026-11-04:${no}`, sys, no, type, code: '1', stops: stops.map(([s, h]) => ({ st: s, arr: T(h), dep: T(h) })) });
const trips = [
  trip('tra', '128', '自強', [['tra:A', 8], ['tra:B', 8.2], ['tra:C', 8.6], ['tra:D', 9]]),
  trip('tra', '1281', '區間', [['tra:A', 10], ['tra:B', 10.3]]),
  trip('hsr', '128', '高鐵', [['hsr:X', 9], ['hsr:Y', 9.5]]),
  trip('tra', '12', '自強', [['tra:D', 7], ['tra:A', 9]])
];
const net = network(stations, trips, []);

test('a number finds both railways’ trains first, then those it starts', () => {
  const got = trainsNumbered(net, '128');
  assert.deepEqual(got.map(t => `${t.sys}${t.no}`), ['tra128', 'hsr128', 'tra1281']);
  assert.deepEqual(trainsNumbered(net, ' 12 ').map(t => t.no)[0], '12');
  assert.deepEqual(trainsNumbered(net, ''), []);
});

test('on at the stop nearest the start, off at the stop after it nearest the end', () => {
  const t = trips[0];
  assert.deepEqual(boardAlight(net, t, { lat: 24.71, lon: 120.95 }, { lat: 24.12, lon: 120.68 }), { k: 1, j: 3 });
  // (The end before the start along the train: off at the next stop after boarding.)
  assert.deepEqual(boardAlight(net, t, { lat: 24.40, lon: 120.80 }, { lat: 24.80, lon: 121.0 }), { k: 2, j: 3 });
  // (No start known: where it sets out.)
  assert.deepEqual(boardAlight(net, t, null, null), { k: 0, j: 3 });
});

test('a ticket is found again, its stations picked again only when it was picked by number', () => {
  const r = rideOf(trips[0], 1, 3);
  const fixed = ticketOf([r]);
  assert.equal(fixed.rides[0].from, 'tra:B');
  const again = ridesIn(net, fixed, { from: { lat: 24.8, lon: 121.0 }, to: { lat: 24.4, lon: 120.8 } });
  assert.equal(again[0].from, 'tra:B');
  assert.equal(again[0].to, 'tra:D');
  const auto = ticketOf([r], true);
  const moved = ridesIn(net, auto, { from: { lat: 24.8, lon: 121.0 }, to: { lat: 24.4, lon: 120.8 } });
  assert.equal(moved[0].from, 'tra:A');
  assert.equal(moved[0].to, 'tra:C');
  // (Another day's network without it: not found, never another train.)
  assert.equal(ridesIn(network(stations, [trips[1]], []), fixed), null);
});

test('a way to the station on the ticket’s own train is not a way there', () => {
  const ticket = ticketOf([rideOf(trips[0], 1, 3)]);
  assert.equal(onTicketTrain({ legs: [{ mode: 'tra', train: { sys: 'tra', no: '128' } }] }, ticket), true);
  assert.equal(onTicketTrain({ legs: [{ mode: 'hsr', train: { sys: 'hsr', no: '128' } }] }, ticket), false);
  assert.equal(onTicketTrain({ legs: [{ mode: 'walk' }] }, ticket), false);
});
