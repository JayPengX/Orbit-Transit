// Transit's places and saved trips told to the family's notebook (kit
// family.mjs, Jay 2026-11-10: Weather's 下雨改搭公車 reads them): told once
// for each change, home/school/work by the place's icon, nothing on a kit
// without the notebook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, shareFamily, rideFact, shareRide } from '../public/lib/family-share.mjs';

const data = {
  places: [{ id: 'p1', name: '家', icon: 'home', lat: 24.80, lon: 120.97 }, { id: 'p2', name: '新竹高中', icon: 'school', lat: 24.79, lon: 120.98 }, { id: 'p3', name: '巨城', icon: 'pin', lat: 24.81, lon: 120.97 }],
  trips: [{ id: 's1', name: '上學', from: null, to: { name: '新竹高中', lat: 24.79, lon: 120.98 } }, { id: 's2', name: '', from: { name: '家', lat: 24.8, lon: 120.97 }, to: { name: '巨城', lat: 24.81, lon: 120.97 } }]
};

test('familyOf: trips with their ends (from null: where you are), home/school/work by icon', () => {
  assert.deepEqual(familyOf(data), {
    trips: [{ name: '上學', from: null, to: { lat: 24.79, lon: 120.98, name: '新竹高中' } }, { name: '巨城', from: { lat: 24.8, lon: 120.97, name: '家' }, to: { lat: 24.81, lon: 120.97, name: '巨城' } }],
    places: { home: { lat: 24.8, lon: 120.97, name: '家' }, school: { lat: 24.79, lon: 120.98, name: '新竹高中' } }
  });
});

test('shareFamily: told once per change; an older kit (no notebook) is nothing and tried again later', async () => {
  const calls = [];
  const notebook = async () => ({ tell: (...a) => calls.push(['tell', ...a]), setPlace: (...a) => calls.push(['setPlace', ...a]) });
  assert.equal(await shareFamily(data, notebook), true);
  assert.deepEqual(calls.map(c => c.slice(0, 3)), [['tell', 'transit', 'trips'], ['setPlace', 'home', { lat: 24.8, lon: 120.97, name: '家' }], ['setPlace', 'school', { lat: 24.79, lon: 120.98, name: '新竹高中' }]]);
  assert.deepEqual(calls[1].at(-1), 'transit');
  assert.equal(await shareFamily(data, notebook), false, 'nothing new');
  const moved = { ...data, places: [{ ...data.places[0], lat: 24.81 }] };
  assert.equal(await shareFamily(moved, async () => { throw new Error('no such module'); }), false);
  assert.equal(await shareFamily(moved, notebook), true, 'told once the notebook can be had');
});

// Money's 車資記帳 (Jay 2026-11-10, the family's links): a trip set out on
// whose fare is one known price, the family's latest ride; none when TPASS
// covers it, when it's only 起, or on foot.

const ride = fareText => ({
  fareText,
  dep: Date.UTC(2026, 10, 10, 0, 5),
  legs: [
    { mode: 'walk', from: { name: '家' }, to: { name: '新竹車站' } },
    { mode: 'bus', dep: Date.UTC(2026, 10, 10, 0, 8), from: { name: '新竹車站' }, to: { name: '北新竹' } },
    { mode: 'tra', from: { name: '北新竹' }, to: { name: '竹北' } },
    { mode: 'walk', from: { name: '竹北' }, to: { name: '竹北高中' } }
  ]
});

test('rideFact: one known fare, named by where you board and get off, its kinds of ride', () => {
  const f = rideFact(ride('NT$45'));
  assert.deepEqual(f, { id: `${Math.round(Date.UTC(2026, 10, 10, 0, 5) / 60_000)}:新竹車站 → 竹北`, at: Date.UTC(2026, 10, 10, 0, 5), name: '新竹車站 → 竹北', fare: 45, modes: ['bus', 'rail'] });
  for (const t of ['TPASS 涵蓋', 'NT$45（部分 TPASS）', 'NT$45 起', '', 'NT$0']) assert.equal(rideFact(ride(t)), null, t);
  assert.equal(rideFact({ fareText: 'NT$20', legs: [{ mode: 'walk' }, { mode: 'bike' }] }), null, 'no ride, no fare to keep');
  assert.equal(rideFact({ fareText: 'NT$20', legs: [{ mode: 'metro', dep: 5, from: { name: 'A' }, to: { name: 'B' } }] }).at, 5, 'its first ride\'s time when the plan has none');
});

test('shareRide: told as the transit ride; nothing without a fare or a notebook', async () => {
  const calls = [];
  const notebook = async () => ({ tell: (...a) => calls.push(a) });
  assert.equal(await shareRide(ride('NT$45'), notebook), true);
  assert.deepEqual(calls.map(c => c.slice(0, 2)), [['transit', 'ride']]);
  assert.equal(calls[0][2].fare, 45);
  assert.equal(await shareRide(ride('TPASS 涵蓋'), notebook), false);
  assert.equal(await shareRide(ride('NT$45'), async () => ({})), false, 'an older kit');
  assert.equal(await shareRide(ride('NT$45'), async () => { throw new Error('no such module'); }), false);
  assert.equal(calls.length, 1);
});
