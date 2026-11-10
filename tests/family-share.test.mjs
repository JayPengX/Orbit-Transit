// Transit's places and saved trips told to the family's notebook (kit
// family.mjs, Jay 2026-11-10: Weather's 下雨改搭公車 reads them): told once
// for each change, home/school/work by the place's icon, nothing on a kit
// without the notebook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, shareFamily } from '../public/lib/family-share.mjs';

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
