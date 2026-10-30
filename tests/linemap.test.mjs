import test from 'node:test';
import assert from 'node:assert/strict';
import { TRA_MAP } from '../public/lib/tra-map.mjs';
import { lineMapHtml, hsrLineHtml } from '../public/lib/linemap.mjs';

// Every station the map names, with a made-up class: the ones listed big.
const BIG = new Set(['0900', '0920', '1000', '1210', '1250']);
const stations = new Map(
  Object.values(TRA_MAP)
    .flat()
    .flatMap(p => [...p.ids, ...(p.at ? [p.at] : [])])
    .map(id => [`tra:${id}`, { key: `tra:${id}`, sys: 'tra', id, name: id, cls: BIG.has(id) ? '1' : '4', city: 'Taipei' }])
);
const shownIds = html => [...html.matchAll(/data-st="tra:(\d+)"/g)].map(m => m[1]);
const folds = html => [...html.matchAll(/data-fold="tra:(\d+)"/g)].map(m => m[1]);

test('every region draws its lines, and each branch leaves from a station on the map', () => {
  for (const [region, parts] of Object.entries(TRA_MAP)) {
    assert.ok(parts.length, region);
    const all = new Set(parts.flatMap(p => p.ids));
    for (const p of parts.filter(p => p.branch)) assert.ok(all.has(p.at), `${region} ${p.zh} leaves from ${p.at}`);
  }
});

test('the big stations, the ends and the junctions show; small ones in a row fold into one row, opened in place', () => {
  const html = lineMapHtml('north', stations);
  const ids = shownIds(html);
  // 基隆 (the line's start), 臺北 (big), 北新竹 (內灣線 leaves from it).
  for (const id of ['0900', '1000', '1190']) assert.ok(ids.includes(id), id);
  // A small station between big ones is folded…
  assert.ok(!ids.includes('0940'));
  const f = folds(html).find(x => html.includes(`data-fold="tra:${x}"`) && Number(x) > 920 && Number(x) < 1000);
  assert.ok(f);
  // …and shows once its row is opened, nothing else changing.
  const opened = shownIds(lineMapHtml('north', stations, { open: new Set([`tra:${f}`]) }));
  assert.ok(opened.includes('0940'));
  assert.ok(ids.every(id => opened.includes(id)));
});

test('the station picked, the other end and the quick picks are never folded away; the other end cannot be picked', () => {
  const html = lineMapHtml('north', stations, { current: 'tra:0940', other: 'tra:0950', keep: new Set(['tra:0960']) });
  assert.ok(['0940', '0950', '0960'].every(id => shownIds(html).includes(id)));
  assert.match(html, /data-st="tra:0940"[^>]*aria-current="true"/);
  assert.match(html, /data-st="tra:0950" disabled/);
});

test('高鐵 across the top: the region’s stations, north to south; none in the east', () => {
  const hsr = [['1000', '台北', 'Taipei'], ['0990', '南港', 'Taipei'], ['1040', '台中', 'Taichung']].map(([id, name, city]) => ({ key: `hsr:${id}`, sys: 'hsr', id, name, city }));
  assert.deepEqual([...hsrLineHtml('north', hsr).matchAll(/data-st="hsr:(\d+)"/g)].map(m => m[1]), ['0990', '1000']);
  assert.equal(hsrLineHtml('east', hsr), '');
});
