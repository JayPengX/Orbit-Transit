import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 查時刻's trains (Jay 2026-11-10: "Clicking on train jump the UI and some show
// 準點 some doesn't").
const src = readFileSync(new URL('../public/lib/tab-train.mjs', import.meta.url), 'utf8');
const body = name => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)));

// A tap opens the train in its own card: the list drawn anew made every card
// new, and the kit's keeper found the tapped card by what it said, so a
// lookalike card (another 區間) was put under the finger: the page jumped.
test('a train opens and shuts in its own card, the list never drawn again', () => {
  const click = body('onClick');
  assert.match(click, /if \(j\) return toggleCard\(Number\(j\.dataset\.j\)\);/);
  assert.doesNotMatch(click, /showResults\(\)/);
  // (A card above shut at once: the page moved by what it gave back.)
  assert.match(body('toggleCard'), /scrollTop \+= moved/);
  // Delays, fares and a pin come in place too.
  const search = body('search');
  assert.doesNotMatch(search.slice(search.indexOf("Today's delays")), /render\(\)/);
});

// Only trains on their way are on 台鐵's live board: the rest said nothing.
test('every 台鐵 train today says 準點, late or 未發車', async () => {
  const at = 1_000_000;
  const tra = (no, start) => ({ sys: 'tra', no, stops: [{ dep: start }, { dep: start + 600_000 }] });
  const delays = new Map([['1218', 2], ['2194', 0]]);
  const { trainNow } = await import('../public/lib/tab-train.mjs').catch(() => ({}));
  // (The module needs a page; its rule read from its source when it can't load.)
  const now = trainNow || new Function(`return ${src.slice(src.indexOf('function trainNow('), src.indexOf('\n}\n', src.indexOf('function trainNow(')) + 2)}`)();
  assert.equal(now(tra('1218', at - 60_000), delays, true, at), 2);
  assert.equal(now(tra('2194', at - 60_000), delays, true, at), 0);
  assert.equal(now(tra('1228', at + 60_000), delays, true, at), 'wait');
  // Past its start and not on the board yet, 高鐵 (no board), another day: nobody can say.
  assert.equal(now(tra('1230', at - 60_000), delays, true, at), null);
  assert.equal(now({ ...tra('0805', at + 60_000), sys: 'hsr' }, delays, true, at), null);
  assert.equal(now(tra('1228', at + 60_000), delays, false, at), null);
});
