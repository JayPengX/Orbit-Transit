// A map whose script didn't load said its error on the screen: the script's
// address with Google's key in it ("地圖載入失敗：load https://maps.googleapis…
// key=…"), or "maps timeout" in English. Plain words now, and 重試.
// tab-map.mjs needs a browser: read from its source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/lib/tab-map.mjs', import.meta.url), 'utf8');

test('a map that failed to load says so plainly, never its error (an address, a key), with 重試', () => {
  const i = src.indexOf('map = await createMap(');
  const fail = src.slice(i, src.indexOf('return isReady();', i));
  assert.match(fail, /mapFailedHtml\(/);
  assert.doesNotMatch(fail.match(/innerHTML = [^\n]*/)[0], /err/, 'the error is never drawn');
  assert.match(fail, /key=…/, 'the logged error has its key cut');
  const html = src.slice(src.indexOf('export const mapFailedHtml'), src.indexOf('export async function init'));
  assert.match(html, /重試/);
  assert.match(html, /map-retry/);
});
