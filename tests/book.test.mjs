// 高鐵訂票 (Jay 2026-11-10: TDX's 高鐵訂票導訂 approved; 臺鐵's pending): a
// 高鐵 ride's button opens 高鐵's own booking, the ride filled in, the link
// asked of the proxy at the tap.
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('高鐵訂票: only a 高鐵 ride with its number still to come; the tap opens a window, then 高鐵’s link in it', async () => {
  const api = await import('../public/lib/api.mjs');
  const { canBook, bookHtml, openBooking } = await import('../public/lib/book.mjs');
  const dep = Date.now() + 3_600_000;
  assert.equal(canBook({ mode: 'hsr', dep, train: { no: '123' } }), true);
  assert.equal(canBook({ mode: 'tra', dep, train: { no: '123' } }), false, '臺鐵 waits for TDX');
  assert.equal(canBook({ mode: 'hsr', dep }), false, 'no number: nothing to fill in');
  assert.equal(canBook({ mode: 'hsr', dep: Date.now() - 600_000, train: { no: '123' } }), false, 'gone');
  assert.match(bookHtml({ from: { name: '新竹"' }, to: { name: '台北' }, dep, train: { no: '123' } }), /data-book="\{&#34;from&#34;/, 'its data escaped');
  const was = { fetch: globalThis.fetch, window: globalThis.window, location: globalThis.location };
  const asked = [];
  const win = { closed: false, location: { href: '' }, close() { this.closed = true; } };
  globalThis.window = { open: () => win };
  globalThis.fetch = async url => {
    const u = new URL(url);
    asked.push(Object.fromEntries(u.searchParams));
    return u.pathname.endsWith('/transit/book') ? answer({ url: 'https://irs.thsrc.com.tw/IMINT/?deeplinkToken=t' }) : new Response('', { status: 503 });
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const at = Date.parse('2026-11-10T13:10:00+08:00');
    assert.equal(await openBooking({ from: '新竹', to: '台北', dep: at, no: '123' }), true);
    assert.deepEqual([asked[0].sys, asked[0].from, asked[0].to, asked[0].date, asked[0].time, asked[0].no], ['hsr', '新竹', '台北', '2026-11-10', '13:10', '123']);
    assert.equal(win.location.href, 'https://irs.thsrc.com.tw/IMINT/?deeplinkToken=t');
    // (The proxy can't: the window shut, said so.)
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'TDX_FAILED' }), { status: 502 });
    win.closed = false;
    const said = [];
    assert.equal(await openBooking({ from: '新竹', to: '台北', dep: at, no: '123' }, m => said.push(m)), false);
    assert.equal(win.closed, true);
    assert.equal(said.length, 1);
  } finally {
    Object.assign(globalThis, was);
    api.useSession(null);
  }
});
