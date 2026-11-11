// Orbit's own look for Transit (Jay 2026-11-03; Orbit-Core DESIGN §11): on for
// every page, 交通 one board whose every trip row says when (or why not), and a
// route's stop list drawn at its own size (the red 進站中 pill and the big red
// bus stood out of proportion and were hard to read).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const app = read('app.mjs');
const css = read('transit.css');
const rule = sel => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
const px = (body, prop) => Number(body.match(new RegExp(`(?:^|\\s|;)${prop}:\\s*([\\d.]+)px`))?.[1]);

test("the look is the page's own: data-look on <html>, board.css after transit.css, no switch", () => {
  assert.match(html, /<html [^>]*data-look="native"/);
  assert.ok(html.indexOf('href="./transit.css"') < html.indexOf('href="./board.css"'), 'board.css after transit.css');
  assert.doesNotMatch(app, /orbit\.look|\bNV\b/, 'no localStorage switch left');
});


test('交通: a trip row with no ride says why, never nothing (read failed, being read, none now, not read yet)', async () => {
  const { tripWhy } = await import('../public/lib/tab-go.mjs');
  assert.equal(tripWhy({ error: '讀不到', plans: [] }), '讀不到');
  assert.equal(tripWhy({ loading: true, plans: [] }), '找班次…');
  assert.equal(tripWhy({ plans: [] }), '現在沒有班次');
  assert.equal(tripWhy(undefined), '點一下找班次');
  // (A failed re-read over rides already read is not a reason: those rides show.)
  assert.notEqual(tripWhy({ error: '讀不到', plans: [{}] }), '讀不到');
});

test('交通: a trip row with a ride says when to leave (whenHtml), on the badge of its first line', async () => {
  const { boardRow, whenHtml } = await import('../public/lib/board.mjs');
  const row = boardRow({ no: '182', color: '#2f9e44', main: '上學', note: '08:20 到', when: whenHtml(Date.now() + 5 * 60_000, '出發', true) });
  assert.match(row, /class="ot-strip-eta ob-when live"/);
  assert.match(row, /<small>出發<\/small>/);
  assert.match(row, /style="--line:#2f9e44;--ink:#fff"/);
});

test("a route's stops: 進站中 / 即將進站 at the list's own size, no pill, no red; the bus a dot of the line's green a size up", () => {
  const eta = rule('.ot-rs-eta');
  const now = rule('.ot-rs-eta.now');
  const soon = rule('.ot-rs-eta.soon');
  assert.ok(eta && now && soon, 'the rules are there');
  for (const [name, body] of [['now', now], ['soon', soon]]) {
    assert.doesNotMatch(body, /background|font|padding|q-red|animation/, `${name}: colour only, steady`);
  }
  assert.match(now, /color:\s*var\(--ot-ink-green\)/);
  // 即將進站 (four characters at 15 px) fits the time column at 320 (68 px) with its padding.
  const side = Number(eta.match(/padding:\s*[\d.]+px\s+([\d.]+)px/)?.[1]);
  assert.match(eta, /font:\s*700 15px/);
  assert.ok(4 * 15 + 2 * side <= 68, 'fits the narrow column');
  const at = rule('.ot-route-stops li.at .ot-rs-dot');
  const between = rule('.ot-rs-bus');
  for (const [name, body] of [['on a stop', at], ['between stops', between]]) {
    assert.match(body, /background:\s*var\(--q-green\)/, `${name}: the line's green`);
    assert.doesNotMatch(body, /q-red/, `${name}: not red`);
    assert.ok(px(body, 'width') <= 22 && px(body, 'height') <= 22, `${name}: at most 22 px (a stop's dot is 14)`);
  }
});

// Wide screens (Jay's iPad 2026-11-11: 釘選 one short card beside the search and
// a trip, half the screen empty; 查時刻's question alone in a column beside a long
// list of trains): 交通's 要去哪裡 and places run across the top so the trips and
// the pins start level, and 查時刻's 最近 stands under the question beside the
// trains (after them on a phone).
test('交通 heads the page with the search across it; 查時刻 keeps 最近 beside the trains', () => {
  const go = readFileSync(new URL('../public/lib/tab-go.mjs', import.meta.url), 'utf8');
  assert.match(go, /<div class="q-span">\$\{noticesHtml\(S\.notices\)\}\$\{plan\}<\/div>/);
  const train = readFileSync(new URL('../public/lib/tab-train.mjs', import.meta.url), 'utf8');
  assert.match(train, /ot-tq-recent-side/);
  const css = readFileSync(new URL('../public/transit.css', import.meta.url), 'utf8');
  assert.match(css, /:root\.q-wide #panel-train:has\(#t-results:not\(:empty\)\) \.ot-tq-recent-side \{\s*display: block;/);
});
