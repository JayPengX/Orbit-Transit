// A quiet stop: its operator's rows sit some of the city's estimates out
// (none of its rows new in one). It waited for the next estimate only once
// that one was a beat and 5 s past its time, so a 10 s beat asked it three
// times an estimate, each one a TDX read (2026-11-06, a stop card on the
// live Worker: 新竹縣's 3 stops asked 11 times in 3 minutes, 新竹市's 6).
// Now 5 s past (TDX has a city's estimates 5 to 10 s after their time).
import test from 'node:test';
import assert from 'node:assert/strict';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('a quiet stop: asked about once an estimate, never missing one', async () => {
  const api = await import('../public/lib/api.mjs');
  const was = { fetch: globalThis.fetch, now: Date.now };
  const t0 = Date.parse('2026-11-06T04:00:00Z');
  let clock = t0;
  Date.now = () => clock;
  // The city's estimates every 30 s, each at the Worker 6 s after its time;
  // the quiet stop's rows only in every other one.
  const made = t => Math.floor((t - 6_000) / 30_000) * 30_000;
  const quiet = t => Math.floor((t - 6_000) / 60_000) * 60_000;
  const asked = [];
  globalThis.fetch = async url => {
    const u = new URL(url);
    const stop = u.searchParams.get('stops');
    asked.push({ at: clock, stop });
    const dt = stop === 'HSQ2' ? quiet(clock) : made(clock);
    return answer([{ StopUID: stop, RouteUID: 'HSQ0010', EstimateTime: 300, DataTime: new Date(dt).toISOString() }]);
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    // A stop card's beat (10 s) for 4 minutes: a busy stop and a quiet one.
    for (let s = 0; s < 240; s += 10) {
      clock = t0 + s * 1000;
      await api.busEta('HsinchuCounty', { stops: ['HSQ1'] });
      await api.busEta('HsinchuCounty', { stops: ['HSQ2'] });
    }
    const of = stop => asked.filter(x => x.stop === stop).map(x => x.at);
    const q = of('HSQ2');
    // Every estimate of its own it would have had asking each beat, it had.
    const all = new Set();
    for (let s = 0; s < 240; s += 10) all.add(quiet(t0 + s * 1000));
    assert.equal(new Set(q.map(quiet)).size, all.size, 'none of its estimates missed');
    // 8 of the city's estimates in 4 minutes, 4 of them its own: an ask each
    // and a second when one may not have reached the Worker yet (it was 16).
    assert.ok(q.length <= 13, `the quiet stop asked ${q.length} times: ${q.map(t => (t - t0) / 1000)}`);
    assert.ok(of('HSQ1').length <= 10, `the busy stop asked ${of('HSQ1').length} times: ${of('HSQ1').map(t => (t - t0) / 1000)}`);
  } finally {
    globalThis.fetch = was.fetch;
    Date.now = was.now;
    api.useSession(null);
  }
});

// TDX's 988 (Jay 2026-11-15): one way with five night runs, the other with 80:
// the timetable missing runs, never 今天不行駛.
test('a way the timetable hardly has is missing runs, not off', async () => {
  const { thinWay, doneToday } = await import('../public/lib/bus-ui.mjs');
  const trip = d => ({ ServiceDay: { Sunday: d, Monday: 1, Tuesday: 1, Wednesday: 1, Thursday: 1, Friday: 1, Saturday: 1 }, StopTimes: [{ StopUID: 'A', DepartureTime: '23:40' }] });
  const sched = [{ Direction: 0, Timetables: Array.from({ length: 80 }, () => trip(1)) }, { Direction: 1, Timetables: Array.from({ length: 5 }, () => trip(0)) }];
  const w = { dir: 1, stops: [{ uid: 'A', name: 'A' }] };
  assert.equal(thinWay(sched, w), true);
  assert.equal(thinWay(sched, { ...w, dir: 0 }), false);
  assert.equal(doneToday(sched, w), false);
});
