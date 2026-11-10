// 高鐵訂票 (Jay 2026-11-10: TDX's 高鐵訂票導訂 approved; 臺鐵's pending): a
// 高鐵 ride's button opens 高鐵's own booking, the ride filled in, the link
// asked of the proxy at the tap.
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('高鐵訂票: only a 高鐵 ride with its number still to come; its app’s link and its website’s, asked together at the tap', async () => {
  const api = await import('../public/lib/api.mjs');
  const { canBook, bookHtml, bookWays } = await import('../public/lib/book.mjs');
  const dep = Date.now() + 3_600_000;
  assert.equal(canBook({ mode: 'hsr', dep, train: { no: '123' } }), true);
  assert.equal(canBook({ mode: 'tra', dep, train: { no: '123' } }), false, '臺鐵 waits for TDX');
  assert.equal(canBook({ mode: 'hsr', dep }), false, 'no number: nothing to fill in');
  assert.equal(canBook({ mode: 'hsr', dep: Date.now() - 600_000, train: { no: '123' } }), false, 'gone');
  assert.match(bookHtml({ from: { name: '新竹"' }, to: { name: '台北' }, dep, train: { no: '123' } }), /data-book="\{&#34;from&#34;/, 'its data escaped');
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    asked.push(Object.fromEntries(u.searchParams));
    if (!u.pathname.endsWith('/transit/book')) return new Response('', { status: 503 });
    return answer({ url: u.searchParams.get('app') === '1' ? 'https://ets.thsrc.com.tw/queryTrain?s=1' : 'https://irs.thsrc.com.tw/IMINT/?queryData=t' });
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const trip = { from: '新竹', to: '台北', date: '2026-11-10', time: '13:10', no: '123' };
    assert.deepEqual(await bookWays(trip), { app: 'https://ets.thsrc.com.tw/queryTrain?s=1', web: 'https://irs.thsrc.com.tw/IMINT/?queryData=t' });
    const app = asked.find(a => a.app === '1');
    const web = asked.find(a => !a.app);
    assert.deepEqual([app.sys, app.from, app.to, app.date, app.time, app.no], ['hsr', '新竹', '台北', '2026-11-10', '13:10', '123']);
    assert.ok(web, 'the website’s too');
    // (The app's refused: the website's alone; neither: nothing to open.)
    globalThis.fetch = async url => (new URL(url).searchParams.get('app') === '1' ? new Response(JSON.stringify({ code: 'TDX_FAILED' }), { status: 502 }) : answer({ url: 'https://irs.thsrc.com.tw/IMINT/?queryData=t' }));
    assert.deepEqual(await bookWays(trip), { app: null, web: 'https://irs.thsrc.com.tw/IMINT/?queryData=t' });
    globalThis.fetch = async () => answer({ url: 'javascript:alert(1)' });
    assert.deepEqual(await bookWays(trip), { app: null, web: null }, 'only an https link');
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});
