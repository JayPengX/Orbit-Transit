import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 查時刻 and 我的 come back where they were left after the map (Jay
// 2026-11-05: "switching tab force it to scroll back up"). The map holds the
// page to one screen (body.tab-map), so the kit's bar sets the tab's frame
// (onShow) before it scrolls the tab back to its place, in the tap.
const src = readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');

test('the bar sets a tab\'s frame before putting its place back', () => {
  assert.match(src, /tabBar\(\{[^\n]*onShow: frame/);
  assert.match(src, /function select\([^\n]*\n[^\n]*\n[^\n]*\n\s*frame\(tab\.id\);/);
});
