import test from 'node:test';
import assert from 'node:assert/strict';
import { TRA_MAP } from '../public/lib/tra-map.mjs';
import { lineMapHtml, mapCities } from '../public/lib/linemap.mjs';

// Every station the map names, each in the county the map has it in.
const stations = new Map();
for (const [city, parts] of Object.entries(TRA_MAP))
  for (const p of parts) for (const id of p.ids) stations.set(`tra:${id}`, { key: `tra:${id}`, sys: 'tra', id, name: id, cls: id === '1000' ? '0' : '4', city });
const hsr = { key: 'hsr:1000', sys: 'hsr', id: '1000', name: '台北', city: 'Taipei' };
stations.set(hsr.key, hsr);
const ids = html => [...html.matchAll(/data-st="(\w+:\d+)"/g)].map(m => m[1]);

test('every county draws its lines; each branch leaves from a station on its map', () => {
  for (const [city, parts] of Object.entries(TRA_MAP)) {
    const all = new Set(parts.flatMap(p => p.ids));
    for (const p of parts.filter(p => p.branch && p.at)) assert.ok(all.has(p.at), `${city} ${p.zh} leaves from ${p.at}`);
  }
  // North to south, only counties with a station.
  assert.deepEqual(mapCities([...stations.values()]).slice(0, 3), ['Keelung', 'Taipei', 'NewTaipei']);
  assert.ok(!mapCities([...stations.values()]).includes('PenghuCounty'));
});

test("a county's map: 高鐵 first, then every 台鐵 station of the county in order, the next county's station at each edge", () => {
  const html = lineMapHtml('Taipei', stations);
  assert.deepEqual(ids(html), ['hsr:1000', ...TRA_MAP.Taipei.flatMap(p => p.ids).map(id => `tra:${id}`)]);
  // 汐科 before 南港 and 板橋 after 萬華: over the edge into 新北, a tap moves the map there.
  assert.equal([...html.matchAll(/class="ot-lm-edge \w+" type="button" data-city="NewTaipei"/g)].length, 2);
});

test('the station picked is lit; the other end cannot be picked', () => {
  const html = lineMapHtml('Taipei', stations, { current: 'tra:1000', other: 'tra:0990' });
  assert.match(html, /data-st="tra:1000"[^>]*aria-current="true"/);
  assert.match(html, /data-st="tra:0990" disabled/);
});

test('新竹市 inside 新竹縣 is one area: its lines joined over the old border, no edge between them', async () => {
  const { areaParts, areaOf } = await import('../public/lib/linemap.mjs');
  const cities = mapCities([...stations.values()]);
  assert.ok(cities.includes('HsinchuCounty') && !cities.includes('Hsinchu'));
  assert.equal(areaOf('Hsinchu'), 'HsinchuCounty');
  const parts = areaParts('HsinchuCounty');
  const wl = parts.filter(p => p.line === 'WL');
  assert.equal(wl.length, 1, '西部幹線 one line through 新竹');
  assert.deepEqual(wl[0].ids, [...TRA_MAP.HsinchuCounty[0].ids, ...TRA_MAP.Hsinchu[0].ids]);
  const nw = parts.filter(p => p.line === 'NW');
  assert.equal(nw.length, 1, '內灣線 one line');
  assert.ok(nw[0].ids.includes('1191') && nw[0].ids.includes('1208'));
  const html = lineMapHtml('HsinchuCounty', stations);
  assert.ok(!/data-city="(Hsinchu|HsinchuCounty)"/.test(html), 'no edge into itself');
});

test('a row runs left to right, the next right to left; a 高鐵 station beside a 台鐵 one is a tap on that stop', () => {
  const at = (lat, lon) => ({ lat, lon });
  const st = new Map(
    TRA_MAP.Taipei.flatMap(p => p.ids).map((id, i) => [`tra:${id}`, { key: `tra:${id}`, sys: 'tra', id, name: id, cls: '4', city: 'Taipei', ...at(25 + i * 0.05, 121.5) }])
  );
  const h = { key: 'hsr:0990', sys: 'hsr', id: '0990', name: '0990', city: 'Taipei', ...at(25.05, 121.5) };
  st.set(h.key, h);
  const html = lineMapHtml('Taipei', st, { cols: 3 });
  // No 高鐵 card: its one station is on the 台鐵 line.
  assert.ok(!html.includes('ot-lm-hsr'));
  assert.match(html, /data-st="tra:0990"[^]*?data-st="hsr:0990"/);
  const cells = [...html.matchAll(/grid-area:(\d+)\/(\d+)/g)].map(m => [+m[1], +m[2]]);
  assert.deepEqual(cells, [[1, 1], [1, 2], [1, 3], [2, 3]]);
});
