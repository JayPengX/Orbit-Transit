// 11-17 round 5: bugs proven and fixed (each test fails on the code before).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyData, encodeData, decodeData, mergeData, remember, trainKey } from '../public/lib/store.mjs';

const app = readFileSync(new URL('../public/app.mjs', import.meta.url), 'utf8');
// boot()'s merge and ctx.save as the file has them, run on a stand-in Pass.
function opening({ active = true } = {}) {
  const mergeSrc = /const merge = first => \{[\s\S]*?\n {2}\};/.exec(app)[0];
  const saveSrc = /async save\(\) \{[\s\S]*?\n {2}\},/.exec(app)[0];
  const env = { writes: [], q: { active, write: async x => (env.writes.push(decodeData(x.payload)), {}) } };
  const f = new Function('env', 'emptyData', 'encodeData', 'decodeData', 'mergeData', `
    const q = env.q; const local = {}; let tookPass = false; let held = false;
    const saveLocal = () => {};
    const ctx = { data: null, ${saveSrc} };
    ${mergeSrc};
    return { ctx, merge };`);
  return Object.assign(env, f(env, emptyData, encodeData, decodeData, mergeData));
}
const at = h => Date.parse(`2026-11-17T${h}:00+08:00`);
const trip = { id: 's9', name: '上班', from: null, to: { name: '公司', lat: 25.03, lon: 121.56 }, time: '08:10', days: [1, 2, 3, 4, 5] };
const pair = { from: { sys: 'tra', id: '1210', name: '新竹' }, to: { sys: 'tra', id: '1190', name: '竹北' } };

// Opening on 查時刻 (or a #plan link) saved before the Pass answered: the
// save stamped this phone's old copy newer, the merge kept it, and a trip
// saved on the computer since was gone here and then from the Pass.
test('a save before the Pass answers never beats what another device saved since', async () => {
  const o = opening();
  o.ctx.data = decodeData(encodeData({ ...emptyData(), trains: [{ ...pair, t: at('07:00') }], t: at('07:00') }));
  const pass = { ...decodeData(encodeData(o.ctx.data)), saved: [trip], t: at('09:00') };
  o.ctx.data.trains = remember(o.ctx.data.trains, { ...pair, t: at('10:00') }, trainKey, 8);
  await o.ctx.save();
  assert.equal(o.writes.length, 0, 'nothing sent before the Pass is read');
  o.merge({ payload: encodeData(pass) });
  assert.deepEqual(o.ctx.data.saved.map(s => s.name), ['上班']);
  await o.ctx.save();
  assert.deepEqual(o.writes.at(-1).saved.map(s => s.name), ['上班']);
});

test('a save held for the Pass is stamped and sent when this copy is the one kept', async () => {
  const o = opening();
  o.ctx.data = decodeData(encodeData({ ...emptyData(), saved: [trip], t: at('09:00') }));
  o.ctx.data.trains = remember(o.ctx.data.trains, { ...pair, t: at('10:00') }, trainKey, 8);
  await o.ctx.save();
  o.merge({ payload: encodeData({ ...emptyData(), t: at('08:00') }) });
  assert.equal(o.writes.length, 1);
  assert.equal(o.writes[0].trains.length, 1);
  assert.ok(o.writes[0].t > at('09:00'));
});

test('offline at the opening, a held save stays unstamped (the Pass read later wins)', async () => {
  const o = opening({ active: false });
  o.ctx.data = decodeData(encodeData({ ...emptyData(), t: at('07:00') }));
  await o.ctx.save();
  o.merge({ offline: true });
  assert.equal(o.ctx.data.t, at('07:00'));
});

// A change whose write failed (deleted on a weak link) was kept here but
// never sent at the next opening: the other devices still had it, and any
// edit there brought it back.
test('at the opening this copy is sent up whenever it is the newer', () => {
  const o = opening();
  const pass = { ...emptyData(), saved: [trip], t: at('08:00') };
  o.ctx.data = decodeData(encodeData({ ...pass, saved: [], t: at('09:00') }));
  o.merge({ payload: encodeData(pass) });
  assert.equal(o.writes.length, 1);
  assert.equal(o.writes[0].saved.length, 0);
  // (The Pass's the newer: taken, nothing sent.)
  const p = opening();
  p.ctx.data = decodeData(encodeData({ ...emptyData(), t: at('07:00') }));
  p.merge({ payload: encodeData(pass) });
  assert.equal(p.writes.length, 0);
  assert.equal(p.ctx.data.saved.length, 1);
});

// 查時刻 asked at 08:00 and shown again at 18:00 (another tab, the
// background, another app in Orbit) kept the morning's trains, 現在 on the
// pill and 下一班 · 即將開車 on one long gone (proven on the 11-05 timetable).
test('查時刻 asked for now is asked again once a listed train has left or the day turned', () => {
  const src = readFileSync(new URL('../public/lib/tab-train.mjs', import.meta.url), 'utf8');
  const show = src.slice(src.indexOf('export function show()'), src.indexOf('\n}\n', src.indexOf('export function show()')));
  assert.match(show, /else if \(!ctx\.trainQuery && state\.asOf && Array\.isArray\(state\.results\) && \(state\.asOf !== tw\(\)\.date \|\| \(state\.results\.length && state\.results\.findIndex\(j => leaveAt\(j\) >= Date\.now\(\) - 120_000\) !== 0\)\)\) search\(\{ again: true \}\);/);
  assert.match(src, /state\.asOf = !state\.time && !state\.date \? today : null;/);
  // (Asked again, not remembered again: no write to the Pass for it.)
  assert.match(src, /if \(!again\) \{\n\s+ctx\.data\.trains = remember\(/);
});

// A route's sheet closed while its stops were still read (a slow link)
// started its 20-second ETA and GPS asks anyway, with nothing to stop them.
test('a route sheet closed before it loads starts nothing', () => {
  const src = readFileSync(new URL('../public/lib/bus-ui.mjs', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function openRoute('));
  const ret = fn.indexOf('if (!d.open) return;');
  assert.ok(ret > fn.indexOf('ways = await routeStops(') && ret < fn.indexOf('const t = setInterval(whileSeen(refresh), liveMs());'));
});

// 查時刻 › 捷運 asked the four LiveBoards every 20 s while another app was
// shown in Orbit, and a failed network's retry went on on every other tab.
test('the metro map asks nothing out of sight, and its retry stops with the tab', () => {
  const src = readFileSync(new URL('../public/lib/tab-metro.mjs', import.meta.url), 'utf8');
  assert.match(src, /trainTimer = setTimeout\(\(\) => \(globalThis\.document\?\.visibilityState === 'hidden' \? trainsSoon\(\) : !\$\('panel-metro'\)\.hidden && trains\(\)\), liveMs\(\)\);/);
  const hide = src.slice(src.indexOf('export function hide()'), src.indexOf('\n}\n', src.indexOf('export function hide()')));
  assert.match(hide, /clearTimeout\(retry\);/);
  assert.match(src, /retry = setTimeout\(whileSeen\(\(\) => current === id && open\(id\)\), 30_000\);/);
  // (Back on the tab with the network unread: read again then.)
  assert.match(src, /\} else if \(failed === current\) await open\(current\);/);
});

// A bus alert set: its stop's times asked every 20 s while the page was out
// of sight (another app in Orbit), the Worker already telling it.
test('a bus alert asks nothing out of sight, and checks again on return', () => {
  const src = readFileSync(new URL('../public/lib/alerts.mjs', import.meta.url), 'utf8');
  assert.match(src, /timer = setInterval\(whileSeen\(check\), 20_000\);/);
  assert.match(src, /addEventListener\?\.\('visibilitychange', \(\) => globalThis\.document\.visibilityState === 'visible' && list\.length && check\(\)\);/);
});

// In English the map's 高鐵 and metro cards, a pinned bus in 建議 and a
// metro board's line stayed Chinese though English was there ("HSR 新竹",
// "市政府站"), and TPASS's lines were joined with 、.
test('English names where the data has them, and lists joined the English way', () => {
  const read = f => readFileSync(new URL(`../public/lib/${f}`, import.meta.url), 'utf8');
  const map = read('tab-map.mjs');
  assert.match(map, /W\(`高鐵\$\{s\.name\}站`, `HSR \$\{s\.en \|\| shown\(s\.name\)\}`\)/);
  assert.match(map, /head\(en \? s\.en \|\| shown\(s\.name\) : stationTitle\(s\.name\),/);
  const home = read('home.mjs');
  assert.match(home, /W\('往', 'to'\)\} \$\{shown\(x\.toward \|\| ''\) \|\| '—'\}/);
  assert.match(home, /`Board at \$\{shown\(x\.stop\)\}`/);
  const mu = read('metro-ui.mjs');
  assert.doesNotMatch(mu, /[^(]r\.l\.name[,)]/, 'every line name through shown()');
  const me = read('tab-me.mjs');
  assert.doesNotMatch(me, /passModes\([^)]*\)\.join\('、'\)/);
  assert.match(me, /row\(t\.id, shown\(t\.name\),/);
});

// A Mon–Fri night bus out at 23:50, at the third stop at 00:20 (TDX writes
// it under the day it set out): on a Friday night it was said Monday 00:20,
// missing the bus 25 minutes away; on a Sunday night, a Monday-morning bus
// that doesn't run.
test('a bus past midnight is at its stop the day after it set out', async () => {
  const { nextRun, liveTrusted } = await import('../public/lib/live.mjs');
  const { stopTimes } = await import('../public/lib/bus.mjs');
  const { twAt, tw, hm } = await import('../public/lib/util.mjs');
  const wk = { Sunday: 0, Monday: 1, Tuesday: 1, Wednesday: 1, Thursday: 1, Friday: 1, Saturday: 0 };
  const st = (u, t, i) => ({ StopUID: u, StopName: { Zh_tw: u }, StopSequence: i + 1, DepartureTime: t });
  const run = times => ({ ServiceDay: wk, StopTimes: ['A', 'B', 'C'].map((u, i) => st(u, times[i], i)) });
  const sched = [{ RouteUID: 'NWT988', Direction: 0, Timetables: [run(['22:50', '23:05', '23:20']), run(['23:50', '00:05', '00:20']), run(['05:30', '05:45', '06:00'])] }];
  const w = { dir: 0, stops: ['A', 'B', 'C'].map((uid, i) => ({ uid, name: uid, lat: 25 + i / 100, lon: 121.45 + i / 100 })) };
  const next = (date, clock) => {
    const r = nextRun(sched, w, 2, twAt(date, clock));
    return `${tw(r.at).date} ${hm(r.at)}`;
  };
  assert.equal(next('2026-11-20', '23:55'), '2026-11-21 00:20', 'Friday night: the bus 25 minutes away');
  assert.equal(next('2026-11-22', '23:55'), '2026-11-23 06:00', 'Sunday night: none at 00:20');
  assert.deepEqual(stopTimes(sched, { stopUID: 'C', dir: 0 }, '2026-11-21', 6).times, ['00:20'], 'Saturday: Friday’s night bus');
  assert.deepEqual(stopTimes(sched, { stopUID: 'C', dir: 0 }, '2026-11-23', 1).times, ['06:00', '23:20'], 'Monday: none from Sunday');
  assert.equal(liveTrusted(sched, w, 2, twAt('2026-11-21', '00:20')), true, 'the live bus at 00:20 is that run');
});
