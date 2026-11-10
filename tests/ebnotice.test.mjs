// 臺中's and 高雄's bus notices read by the phone from the cities' own bus
// sites (Jay 2026-11-10: what a phone can read, it reads), the Worker's
// (TDX's) when a site can't answer.
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const msg = { id: '404025561', title: '臨時站位', description: '92路、95路公車將自115年11月7日起臨時取消停靠「中正紀念館」(往東)公車招呼站。' };

test("臺中's notices: every route's in one ask, as TDX's Alert rows; its posts as News; kept 5 minutes", async () => {
  const { cityNotices, resetNotices, phoneNotices } = await import('../public/lib/ebnotice.mjs');
  resetNotices();
  let t = Date.parse('2026-11-10T19:30:00+08:00');
  const asked = [];
  const fetchFn = async (url, o) => {
    const q = JSON.parse(o.body).query;
    asked.push([url, q.includes('blogs') ? 'blogs' : 'clog']);
    if (q.includes('blogs')) return answer({ data: { blogs: { edges: [{ node: { id: 'b1', title: '🚌97路調整部分班次', content: '<p>x</p>', onShelfAt: '2026-11-10', offShelfAt: '2026-12-10', createdAt: '2026-11-10T06:22:50.029Z' } }] } } });
    return answer({ data: { clogMessages: { edges: [{ node: { ...msg, xno: 92 } }, { node: { ...msg, xno: 95 } }] } } });
  };
  const deps = { fetchFn, now: () => t };
  assert.ok(phoneNotices('Alert', 'Taichung') && phoneNotices('News', 'Taichung') && phoneNotices('Alert', 'Kaohsiung'));
  assert.ok(!phoneNotices('News', 'Kaohsiung') && !phoneNotices('Alert', 'Taipei'));
  const rows = await cityNotices('Alert', 'Taichung', deps);
  assert.deepEqual(rows.map(r => [r.AlertID, r.Scope.Routes.map(x => x.RouteID)]), [['404025561', ['92', '95']]]);
  t += 60_000;
  await cityNotices('Alert', 'Taichung', deps);
  assert.deepEqual(asked, [['https://citybus.taichung.gov.tw/ebus/graphql', 'clog']], 'kept 5 minutes');
  const news = await cityNotices('News', 'Taichung', deps);
  assert.deepEqual([news[0].NewsID, news[0].NewsURL], ['b1', 'https://citybus.taichung.gov.tw/ebus/blog/b1']);
  await assert.rejects(cityNotices('News', 'Kaohsiung', deps), "高雄's posts: the Worker's");
});

test("高雄's notices: every route's at once, or a route an ask when its site wants that; a failure: the Worker's, and the Worker's alone 5 minutes", async () => {
  const { cityNotices, resetNotices } = await import('../public/lib/ebnotice.mjs');
  resetNotices();
  let t = Date.parse('2026-11-10T19:30:00+08:00');
  const asked = [];
  let down = false;
  const fetchFn = async (url, o) => {
    assert.equal(url, 'https://ibus.tbkc.gov.tw/ibus/graphql');
    const q = JSON.parse(o.body).query;
    asked.push(q.includes('xno:') ? [...q.matchAll(/xno: (\d+)/g)].map(m => m[1]).join(',') : 'all');
    if (down) throw new TypeError('Failed to fetch');
    if (!q.includes('xno:')) return answer({ errors: [{ message: 'Field "clogMessages" argument "xno" of type "Int!" is required, but it was not provided.' }] });
    return answer({ data: { r100: { edges: [{ node: { id: '7', title: '施工改道', description: '100路改道' } }] }, r60: { edges: [] } } });
  };
  const deps = { fetchFn, now: () => t, routes: async () => ['100', '60', '紅3'] };
  const rows = await cityNotices('Alert', 'Kaohsiung', deps);
  assert.deepEqual(rows.map(r => [r.AlertID, r.Title, r.Scope.Routes.map(x => x.RouteID)]), [['7', '施工改道', ['100']]]);
  assert.deepEqual(asked, ['all', '100,60'], 'asked whole, then a route an ask');
  t += 6 * 60_000;
  await cityNotices('Alert', 'Kaohsiung', deps);
  assert.deepEqual(asked.slice(2), ['100,60'], 'remembered: a route an ask');
  t += 6 * 60_000;
  down = true;
  await assert.rejects(cityNotices('Alert', 'Kaohsiung', deps));
  down = false;
  t += 60_000;
  await assert.rejects(cityNotices('Alert', 'Kaohsiung', deps), /down/, 'the Worker alone for 5 minutes');
  assert.equal(asked.length, 4);
});

test("busNotices: 臺中's from its own site; the site failing, the Worker's; 臺北's always the Worker's", async () => {
  const api = await import('../public/lib/api.mjs');
  const { busNotices } = await import('../public/lib/service.mjs');
  const { resetNotices } = await import('../public/lib/ebnotice.mjs');
  resetNotices();
  const was = globalThis.fetch;
  const asked = [];
  let siteDown = false;
  globalThis.fetch = async (url, o) => {
    const u = new URL(url);
    if (u.host === 'citybus.taichung.gov.tw') {
      asked.push('site');
      if (siteDown) return new Response('', { status: 502 });
      const q = JSON.parse(o.body).query;
      return answer(q.includes('blogs') ? { data: { blogs: { edges: [] } } } : { data: { clogMessages: { edges: [{ node: { ...msg, xno: 92 } }] } } });
    }
    asked.push(u.searchParams.get('p'));
    return answer(u.searchParams.get('p') === 'basic/v2/Bus/Alert/City/Taichung' ? [{ AlertID: 'w1', Title: '改道', Description: '【92】改道', Scope: { Routes: [{ RouteID: '92' }] } }] : []);
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    const list = await busNotices(['Taichung', 'Taipei']);
    assert.deepEqual(list.filter(n => n.city === 'Taichung').map(n => n.id), ['404025561']);
    assert.ok(!asked.includes('basic/v2/Bus/Alert/City/Taichung') && !asked.includes('basic/v2/Bus/News/City/Taichung'), "臺中's: not the Worker's");
    assert.ok(asked.includes('basic/v2/Bus/Alert/City/Taipei'), "臺北's: the Worker's");
    resetNotices();
    siteDown = true;
    const again = await busNotices(['Taichung']);
    assert.deepEqual(again.filter(n => n.city === 'Taichung').map(n => n.id), ['w1'], "the site down: the Worker's");
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});
