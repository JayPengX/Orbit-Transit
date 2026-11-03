// 地圖's 建議 shelf: what's ranked first, on made-up days and places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest, tripScore, busScore, trainScore, bikeScore, homeScore, MAX_SUGGESTIONS, FAR_HOME_M } from '../public/lib/suggest.mjs';
import { twAt } from '../public/lib/util.mjs';

const T = (hm, date = '2026-10-05') => twAt(date, hm); // a Monday
const HOME = { id: 'p1', name: '家', icon: 'home', lat: 24.8, lon: 120.97 };
const SCHOOL = { id: 'p2', name: '學校', icon: 'school', lat: 24.78, lon: 121.04 };
const FAR = { lat: 24.83, lon: 121.0 }; // ~4 km from home
const AT_HOME = { lat: 24.8002, lon: 120.9702 };
const trip = (o = {}) => ({ id: 't1', label: '上學', to: { name: '學校', lat: SCHOOL.lat, lon: SCHOOL.lon }, leaveAt: T('08:00'), recurring: true, today: true, ...o });
const bus = (o = {}) => ({ id: 'b1', route: '5608', stop: '竹東', at: T('07:50'), live: true, ...o });
const bike = (o = {}) => ({ uid: 'k1', name: '新竹火車站', bikes: 6, ebike: 2, ret: 9, d: 120, ok: true, ...o });
const kinds = list => list.map(x => x.kind);

test('suggest: nothing known, nothing suggested', () => {
  assert.deepEqual(suggest({ now: T('08:00') }), []);
  assert.deepEqual(suggest({}), []);
});

test('suggest: the saved trip that fits now leads, with its minutes', () => {
  const r = suggest({ now: T('07:40'), here: AT_HOME, places: [HOME, SCHOOL], trips: [trip()], bikes: [bike({ d: 400 })] });
  assert.equal(r[0].kind, 'trip');
  assert.equal(Math.round(r[0].minutes), 20);
  assert.equal(r[0].key, 'trip:t1');
});

test('suggest: a trip long gone or hours off is not news; a recurring one today beats a one-off', () => {
  assert.equal(tripScore(-11, {}), 0, 'gone more than 10 minutes');
  assert.equal(tripScore(181, {}), 0, 'more than 3 hours off');
  assert.equal(tripScore(null, {}), 0, 'no time: nothing to say');
  assert.ok(tripScore(-5, {}) > 0, 'just gone is still worth a card');
  assert.ok(tripScore(20, { recurring: true, today: true }) > tripScore(20, { recurring: true, today: false }));
  assert.ok(tripScore(10, {}) > tripScore(90, {}), 'sooner first');
});

test('suggest: two trips may both fit, three trips never crowd the rest out', () => {
  const trips = [trip({ id: 'a', leaveAt: T('07:50') }), trip({ id: 'b', leaveAt: T('08:05') }), trip({ id: 'c', leaveAt: T('08:20') })];
  const r = suggest({ now: T('07:40'), trips, buses: [bus()] });
  assert.equal(r.length, MAX_SUGGESTIONS);
  assert.equal(r.filter(x => x.kind === 'trip').length, 2);
  assert.ok(kinds(r).includes('bus'));
});

test('suggest: a pinned bus counts only on its way, soon, and near you more', () => {
  assert.equal(busScore(40), 0, 'over half an hour');
  assert.equal(busScore(null), 0);
  assert.ok(busScore(3) > busScore(20));
  assert.ok(busScore(10, 300) > busScore(10, 1200), 'at a stop you are near');
  assert.ok(busScore(10, 5000) < busScore(10, 1200), 'at a stop across town');
  const noLive = suggest({ now: T('07:40'), buses: [bus({ live: false })] });
  assert.deepEqual(noLive, [], 'a timetable guess is not a bus on its way');
  const r = suggest({ now: T('07:40'), buses: [bus({ id: 'x', at: T('07:55') }), bus({ id: 'y', at: T('07:45') })] });
  assert.equal(r.length, 1, 'one bus card');
  assert.equal(r[0].id, 'y', 'the soonest');
});

test('suggest: a pinned train leaving within 90 minutes', () => {
  assert.equal(trainScore(95), 0);
  assert.ok(trainScore(10) > trainScore(60));
  const r = suggest({ now: T('17:00'), trains: [{ id: 'n1', from: '新竹', to: '台北', dep: T('17:25') }] });
  assert.deepEqual(kinds(r), ['train']);
  assert.equal(Math.round(r[0].minutes), 25);
});

test('suggest: the nearest YouBike with a bike, only when you are close and one is there', () => {
  assert.equal(bikeScore(bike({ bikes: 0, ebike: 0 })), 0, 'no bike');
  assert.equal(bikeScore(bike({ ok: false })), 0, 'closed');
  assert.equal(bikeScore(bike({ d: 900 })), 0, 'too far to be a recommendation');
  assert.ok(bikeScore(bike({ d: 60 })) > bikeScore(bike({ d: 400 })));
  const r = suggest({ now: T('12:00'), here: AT_HOME, bikes: [bike({ uid: 'far', d: 400 }), bike({ uid: 'near', d: 90 }), bike({ uid: 'empty', d: 30, bikes: 0, ebike: 0 })] });
  assert.equal(r.length, 1);
  assert.equal(r[0].uid, 'near');
  assert.equal(r[0].bikes, 6);
});

test('suggest: 回家 when far from 家 in the evening, never by day or at home', () => {
  assert.equal(homeScore(FAR_HOME_M, 18 * 60), 0, 'not past the distance');
  assert.equal(homeScore(5000, 10 * 60), 0, 'morning');
  assert.equal(homeScore(5000, 23 * 60 + 45), 0, 'after 23:30');
  assert.ok(homeScore(5000, 18 * 60) > 0);
  const eve = suggest({ now: T('18:30'), here: FAR, places: [HOME, SCHOOL] });
  assert.deepEqual(kinds(eve), ['home']);
  assert.equal(eve[0].place.id, 'p1');
  assert.ok(eve[0].d > FAR_HOME_M);
  assert.deepEqual(suggest({ now: T('10:30'), here: FAR, places: [HOME] }), []);
  assert.deepEqual(suggest({ now: T('18:30'), here: AT_HOME, places: [HOME] }), []);
  assert.deepEqual(suggest({ now: T('18:30'), here: FAR, places: [SCHOOL] }), [], 'no 家 saved');
  assert.deepEqual(suggest({ now: T('18:30'), here: null, places: [HOME] }), [], 'no fix');
});

test('suggest: a saved trip that ends at 家 is the way home, not a second card', () => {
  const back = trip({ id: 'back', label: '上學 回程', to: { name: '家', lat: HOME.lat, lon: HOME.lon }, leaveAt: T('18:45'), rev: true });
  const r = suggest({ now: T('18:30'), here: FAR, places: [HOME, SCHOOL], trips: [back] });
  assert.deepEqual(kinds(r), ['trip']);
});

test('suggest: ranked best first, the same input the same order', () => {
  const input = { now: T('18:30'), here: FAR, places: [HOME], buses: [bus({ at: T('18:38') })], trains: [{ id: 'n1', from: '新竹', to: '竹北', dep: T('18:50') }], bikes: [bike({ d: 200 })] };
  const a = suggest(input);
  const b = suggest(input);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(x => x.score), [...a.map(x => x.score)].sort((x, y) => y - x));
  assert.equal(a.length, MAX_SUGGESTIONS);
  assert.equal(a[0].kind, 'home', '回家 at 18:30 leads the bus and the train');
});

test('suggest: a saved trip at 18:40 is news from about 18:20 to a few minutes after it', async () => {
  const { tripNow } = await import('../public/lib/tab-go.mjs');
  const { cleanSaved } = await import('../public/lib/store.mjs');
  const stop = { name: '新竹車站', lat: 24.8015, lon: 120.9717 };
  // (Away from both ends, as the sheet reads it: the trip as home.mjs hands it over.)
  const t = cleanSaved({ id: 's1', name: '回家', from: stop, to: { name: '家', lat: HOME.lat, lon: HOME.lon }, time: '18:40', days: [1, 2, 3, 4, 5] });
  const here = { lat: 24.83, lon: 121.0 };
  const at = hm => {
    const now = T(hm);
    const w = tripNow(t, here, now);
    if (!w || !(w.at || w.late)) return [];
    return suggest({ now, here, trips: [{ id: w.id, label: w.label, to: w.to, leaveAt: w.at || w.late, recurring: w.recurring, today: w.today }] });
  };
  assert.equal(at('15:30').length, 0, 'over 3 hours ahead');
  assert.equal(at('18:20')[0]?.kind, 'trip');
  assert.equal(Math.round(at('18:20')[0].minutes), 20);
  assert.equal(at('18:40')[0]?.kind, 'trip', 'at the time itself');
  assert.equal(at('18:45')[0]?.kind, 'trip', 'just gone: still a card');
  assert.equal(at('18:55').length, 0, 'gone more than 10 minutes');
  assert.equal(tripNow(t, here, T('18:45')).late, T('18:40'));
});

test('常去: a place planned to at this hour on days like this comes up; not when already there, nor with too few trips', async () => {
  const { suggest, usualTrip } = await import('../public/lib/suggest.mjs');
  const at = (d, hm) => Date.parse(`${d}T${hm}:00+08:00`);
  const gym = { name: '健身房', lat: 24.81, lon: 120.97, ts: ['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29'].map(d => at(d, '18:40')) };
  const shop = { name: '巨城', lat: 24.809, lon: 120.975, ts: [at('2026-10-25', '14:00'), at('2026-10-18', '15:00')] };
  const now = at('2026-11-03', '18:30');
  const u = usualTrip([gym, shop], now);
  assert.equal(u.place.name, '健身房');
  // Morning: nothing usual then.
  assert.equal(usualTrip([gym, shop], at('2026-11-03', '09:00')), null);
  // Already there: nothing.
  assert.equal(usualTrip([gym], now, { lat: 24.8101, lon: 120.9701 }), null);
  // Twice is not a habit.
  assert.equal(usualTrip([{ ...gym, ts: gym.ts.slice(0, 2) }], now), null);
  const list = suggest({ now, recents: [gym, shop] });
  assert.equal(list[0].kind, 'usual');
});

test('去公司 / 去學校: a working day\'s morning at 家, from the first day; not on a holiday, later, away from 家, or with a saved trip there', async () => {
  const { goScore } = await import('../public/lib/suggest.mjs');
  const WORK = { id: 'p3', name: '公司', icon: 'work', lat: 24.786, lon: 121.017 };
  const places = [HOME, WORK];
  const r = suggest({ now: T('07:40', '2026-11-04'), here: AT_HOME, places });
  assert.equal(r[0].kind, 'go');
  assert.equal(r[0].place.name, '公司');
  // 國慶日補假 (a Friday), a Saturday, the afternoon, out already: none.
  assert.equal(goScore(WORK, AT_HOME, T('07:40', '2026-10-09'), HOME), 0);
  assert.equal(goScore(WORK, AT_HOME, T('07:40', '2026-11-07'), HOME), 0);
  assert.equal(goScore(WORK, AT_HOME, T('14:00', '2026-11-04'), HOME), 0);
  assert.equal(goScore(WORK, FAR, T('07:40', '2026-11-04'), HOME), 0);
  // 學校 when that's what's pinned; and a saved trip there is it already.
  assert.equal(suggest({ now: T('07:10', '2026-11-04'), here: AT_HOME, places: [HOME, SCHOOL] })[0].place.name, '學校');
  assert.ok(!suggest({ now: T('07:40'), here: AT_HOME, places: [HOME, SCHOOL], trips: [trip()] }).some(x => x.kind === 'go'));
});

test('常去 by Taiwan\'s calendar: a holiday is a day off, so the workday commute isn\'t guessed on it', async () => {
  const { usualTrip } = await import('../public/lib/suggest.mjs');
  const work = { name: '公司', lat: 24.786, lon: 121.017, ts: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-27'].map(d => T('07:50', d)) };
  assert.equal(usualTrip([work], T('07:45', '2026-10-28'))?.place.name, '公司');
  assert.equal(usualTrip([work], T('07:45', '2026-10-26')), null, '光復節補假');
  assert.equal(usualTrip([work], T('07:45', '2026-10-31')), null, 'a Saturday');
});

test('a guess of a place learns: passed over too often it stops, gone to it rises; 常去 elsewhere now goes before 回家', async () => {
  const { placeItem } = await import('../public/lib/suggest.mjs');
  const evening = { now: T('19:00'), here: FAR, places: [HOME] };
  assert.equal(suggest(evening)[0].kind, 'home');
  // fb: the chance a card of the place is gone to (feedback.mjs chance).
  assert.deepEqual(suggest({ ...evening, fb: () => 0.05 }), [], 'ignored evening after evening');
  const up = suggest({ ...evening, fb: () => 0.6 })[0].score;
  assert.ok(up > suggest({ ...evening, fb: () => 0.2 })[0].score);
  // One look a day, by the place and by the place on that weekday.
  const item = placeItem(HOME, T('19:00'));
  assert.equal(item.id, `to:24.8000,120.9700:2026-10-05`);
  assert.deepEqual(item.keys, ['to:24.8000,120.9700', 'to:24.8000,120.9700@1']);
  // Out at 17:40 on a 補習班 day: 補習班, not 回家 yet.
  const cram = { name: '補習班', lat: 24.802, lon: 120.975, ts: ['2026-09-22', '2026-09-24', '2026-09-29', '2026-10-01'].map(d => T('17:40', d)) };
  const r = suggest({ now: T('17:35', '2026-10-06'), here: FAR, places: [HOME], recents: [cram] });
  assert.equal(r[0].kind, 'usual');
  assert.ok(!r.some(x => x.kind === 'home'));
});
