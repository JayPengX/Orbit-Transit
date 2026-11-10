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

// 查時刻's 台鐵 / 高鐵 picked (Jay 2026-11-10): the picker shows only that
// railway, 高鐵 as its one line; a station picked on the other moves over.
import { readFileSync } from 'node:fs';
const real = JSON.parse(readFileSync(new URL('./fixtures/rail-stations-2026-11-10.json', import.meta.url)));
const realMap = new Map(real.map(s => [s.key, s]));

test('高鐵 only: one line, 南港 to 左營, every station a tap, its 台鐵 under it', async () => {
  const { hsrMapHtml } = await import('../public/lib/linemap.mjs');
  const html = hsrMapHtml(realMap, { current: 'hsr:1030', other: 'hsr:1000', cols: 4 });
  assert.deepEqual(ids(html), ['0990', '1000', '1010', '1020', '1030', '1035', '1040', '1043', '1047', '1050', '1060', '1070'].map(id => `hsr:${id}`));
  assert.equal((html.match(/class="ot-lm /g) || []).length, 1, 'one card');
  assert.ok(!html.includes('data-city'), 'no counties, no edges');
  assert.match(html, /data-st="hsr:1030"[^>]*aria-current="true"[^]*?台鐵六家/);
  assert.match(html, /data-st="hsr:1000" disabled/);
  assert.match(html, /接駁 中壢/);
  assert.match(html, /data-st="hsr:1040"[^]*?台鐵新烏日/);
  // 12 at 4 a row: three rows, the second right to left.
  const cells = [...html.matchAll(/grid-area:(\d+)\/(\d+)/g)].map(m => [+m[1], +m[2]]);
  assert.deepEqual(cells.slice(3, 6), [[1, 4], [2, 4], [2, 3]]);
});

test('台鐵 only: a county with no 高鐵 tap and no 高鐵 card', () => {
  const traOnly = new Map([...stations].filter(([, s]) => s.sys === 'tra'));
  const html = lineMapHtml('Taipei', traOnly);
  assert.ok(!/data-st="hsr:/.test(html));
  assert.ok(!html.includes('ot-lm-hsr'));
});

test('a station on the other railway moves to its own there', async () => {
  const { fitStation } = await import('../public/lib/linemap.mjs');
  const st = (sys, id) => ({ sys, id, name: realMap.get(`${sys}:${id}`).name });
  const fit = (s, mode) => fitStation(s, mode, real)?.name ?? null;
  // The screenshot: 六家 → 臺北 with 高鐵 picked.
  assert.equal(fit(st('tra', '1194'), 'hsr'), '新竹');
  assert.equal(fit(st('tra', '1000'), 'hsr'), '台北');
  assert.equal(fit(st('hsr', '1030'), 'tra'), '六家');
  assert.equal(fit(st('hsr', '1040'), 'tra'), '新烏日');
  assert.equal(fit(st('hsr', '1047'), 'tra'), '斗六');
  // No 高鐵 beside it: the nearest within 40 km (臺中 → 台中, 宜蘭 → 南港); none for 花蓮.
  assert.equal(fit(st('tra', '3300'), 'hsr'), '台中');
  assert.equal(fit(st('tra', '1210'), 'hsr'), '新竹');
  assert.equal(fit(st('tra', '7190'), 'hsr'), '南港');
  assert.equal(fit(st('tra', '7000'), 'hsr'), null);
  // 全部, or already that railway: as it is.
  const x = st('tra', '1194');
  assert.equal(fitStation(x, 'all', real), x);
  assert.equal(fitStation(x, 'tra', real), x);
});
