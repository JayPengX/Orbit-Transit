// 台鐵's delays never come from every train at once (TDX's whole
// TrainLiveBoard, past TDX's free tier from 2026-12; Jay 2026-11-10: off
// TDX): a station's board (台鐵's own 車站時刻 through the Worker) for the
// stations a ride, a pin or 查時刻 leaves from and gets to; one train's own
// page for the train you're on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const answer = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const row = (no, extra = {}) => ({ StationID: '1210', TrainNo: no, Direction: 0, TrainTypeName: { Zh_tw: '區間' }, EndingStationName: { Zh_tw: '基隆' }, Platform: '', ScheduleDepartureTime: '19:05:00', ...extra });

test("traLive(ids): the boards of those stations alone (three at most), a delay only for a train on its way; no stations, no ask", async () => {
  const api = await import('../public/lib/api.mjs');
  const { traLive, traDelays } = await import('../public/lib/raildata.mjs');
  const was = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => {
    const p = new URL(url).searchParams.get('p');
    asked.push(p);
    const id = p.split('/').pop();
    if (id === '1210') return answer({ StationLiveBoards: [row('2548', { DelayTime: 1, RunningStatus: 1 }), row('1262'), row('2560', { RunningStatus: 2 })] });
    if (id === '1000') return answer({ StationLiveBoards: [row('2548', { StationID: '1000', DelayTime: 2, RunningStatus: 1 }), row('138', { StationID: '1000', DelayTime: 0, RunningStatus: 0 })] });
    return new Response('{}', { status: 503 });
  };
  api.useSession({ ensureToken: async () => 'tok' });
  try {
    assert.deepEqual([...(await traLive([]))], []);
    assert.deepEqual(asked, [], 'no stations: nothing asked');
    const live = await traLive(['tra:1210', '1000', 'tra:1210']);
    assert.deepEqual([...live.keys()], ['2548', '138'], "未發車 (no word) and cancelled left out; a train on two boards once");
    assert.deepEqual(live.get('2548'), { delay: 1, st: '', name: '', status: 0 });
    assert.deepEqual(asked.sort(), ['basic/v3/Rail/TRA/StationLiveBoard/Station/1000', 'basic/v3/Rail/TRA/StationLiveBoard/Station/1210']);
    assert.deepEqual([...(await traDelays(['1000']))], [['2548', 2], ['138', 0]]);
    await traLive(['1210', '1000', '3300', '4400']).catch(() => {});
    assert.ok(!asked.some(p => p.endsWith('/4400')), 'three stations at most');
    await assert.rejects(traLive(['7000']), 'no board at all: a failure, not "no trains"');
  } finally {
    globalThis.fetch = was;
    api.useSession(null);
  }
});

test("nothing asks TDX's board of every 台鐵 train at once", () => {
  const dir = new URL('../public/lib/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/TRA\/TrainLiveBoard['`?]/.test(src), `${f} asks TDX's whole TrainLiveBoard`);
    assert.ok(!/traLive\(\)/.test(src), `${f} asks traLive() of no station (every train)`);
  }
});
