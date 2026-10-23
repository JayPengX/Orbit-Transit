// What isn't running, from the operators' own notices (service.mjs), on the
// real notices of 2026-10-23 (颱風薔琵: 新竹 and most of Taiwan off work).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traRules, traCut, traSummary, busNotice, busOff, liveNotices, metroNoticesOf, hsrNoticeOf, summarize, effectOf, routeNotices, cityIdle, likelyOff, traLegOff } from '../public/lib/service.mjs';
import { traTrips } from '../public/lib/rail.mjs';

const F = name => JSON.parse(readFileSync(new URL(`./fixtures/typhoon-2026-10-23/${name}`, import.meta.url), 'utf8'));
const DAY = '2026-10-23';
const NOW = Date.parse('2026-10-23T15:00:00+08:00');
const tra = traRules(F('tra-alert.json'), { ...F('tra-station-of-line.json'), ...F('tra-line.json') });

test('台鐵: each notice read as who stops where', () => {
  const r = tra.rules;
  // 對號列車：全區間停駛 on 西部幹線, 東部幹線 and 南迴線.
  assert.equal(r.filter(x => x.cls === 'reserved' && !x.maybe).length, 3);
  // 內灣線全區間停駛: every class, the line's 12 stations.
  const nw = r.find(x => x.name === '內灣線');
  assert.equal(nw.cls, 'all');
  assert.equal(nw.stations.size, 12);
  // 經海線列車: by the train's own line (TDX TripLine 2).
  assert.ok(r.some(x => x.name === '海線' && x.via === 2 && x.cls === 'unreserved'));
  // 臺東線 視風雨情形機動行駛: may run, never a stop.
  assert.ok(r.some(x => x.name === '臺東線' && x.maybe));
  assert.ok(r.every(x => x.date === DAY));
  assert.match(traSummary(r, DAY), /對號列車停駛/);
  assert.match(traSummary(r, DAY), /\d 條路線停駛/);
  // Tomorrow, a notice about 今(23)日 says nothing.
  assert.equal(traSummary(r, '2026-10-24'), '');
});

test('台鐵: the trains it stops are out, those still running stay', () => {
  const fx = F('tra-trains.json');
  const trips = traTrips(fx);
  const cut = traCut(trips, tra.rules, DAY);
  const kept = new Set(cut.map(t => t.no));
  // 內灣線 (竹東) and 平溪線: none, though TDX's timetable still had them.
  for (const t of trips) if (t.stops.some(s => ['tra:1203', 'tra:7335'].includes(s.st))) assert.ok(!kept.has(t.no), `${t.no} runs on 內灣/平溪`);
  // A 自強 (對號) and a 海線 區間: out.
  for (const t of trips) if (t.code === '3' || (t.line === 2 && t.code === '6')) assert.ok(!kept.has(t.no), `${t.no} should be off`);
  // Every train TDX's live board had running at 15:00 is kept.
  for (const no of fx.live) assert.ok(kept.has(no), `${no} is running`);
  // 西部幹線's 區間 run 視風雨情形: kept, marked.
  assert.ok(cut.some(t => t.maybe));
  // Another day: nothing cut.
  assert.equal(traCut(trips, tra.rules, '2026-10-24').length, trips.length);
});

const bus = [...F('bus-alert-intercity.json').map(a => busNotice(a)), ...F('bus-news-hsinchu.json').map(a => busNotice(a, 'Hsinchu')), ...F('bus-alert-hsinchu.json').map(a => busNotice(a, 'Hsinchu')), ...F('bus-alert-kaohsiung.json').map(a => busNotice(a, 'Kaohsiung'))];

test('公車: a route its operator stops is off today', () => {
  // 新竹客運: 新竹市市區公車路線…均停駛 (its scope lists 0010, 0020…).
  assert.match(busOff(bus, 'HSZ0010', '藍線1區', NOW)?.title || '', /新竹客運/);
  assert.match(busOff(bus, 'HSZ0020', '2', NOW)?.title || '', /新竹客運/);
  // 國光's 【182】 and 【先導公車】, by the numbers in 新竹市's notice.
  assert.ok(busOff(bus, 'HSZ0182', '182', NOW));
  assert.ok(busOff(bus, 'HSZ0185', '先導公車', NOW));
  // 金牌客運's list names 新竹縣: its 快捷1號 (0061).
  assert.ok(busOff(bus, 'HSQ0061', '快捷1號', NOW));
  // A route no notice names: as it runs.
  assert.equal(busOff(bus, 'HSZ0710', '71', NOW), null);
  // A 公路客運 notice's id never lands on another city's route of that number.
  assert.equal(busOff(bus, 'TPE0010', '10', NOW), null);
  // Over: the next day.
  assert.equal(busOff(bus, 'HSZ0010', '藍線1區', Date.parse('2026-10-24T09:00:00+08:00')), null);
});

test('公車: only a whole-day stop counts; part of a day or some buses is shown, not a stop', () => {
  const by = t => bus.find(n => n.title.includes(t));
  assert.equal(by('新竹客運').stop, true);
  assert.equal(by('彰化客運').stop, false); // 所有路線暫停行駛, 惟 7路 調整為區間班車
  assert.equal(by('部分班次異動').stop, false);
  assert.equal(by('嘉義客運').stop, false); // 以下路線「正常行駛」，其餘停駛
  assert.ok(bus.filter(n => n.city === 'Kaohsiung').every(n => n.typhoon));
  assert.equal(liveNotices(bus, NOW).length > 0, true);
});

test('捷運 and 高鐵: what isn’t 正常營運 is said', () => {
  assert.equal(metroNoticesOf(F('metro-TRTC.json')).length, 0);
  const k = metroNoticesOf(F('metro-KRTC.json'));
  assert.equal(k.length, 1);
  assert.equal(k[0].stop, false);
  assert.equal(metroNoticesOf(F('metro-TRTCMG.json'))[0].stop, true);
  assert.equal(hsrNoticeOf([{ Title: '全線營運正常(Normal)' }]), null);
});

test('the banner: 台鐵, and the bus notices of your city', () => {
  const rows = summarize({ tra, bus, cities: ['Hsinchu'] }, NOW);
  assert.deepEqual(rows.map(r => r.kind), ['tra', 'bus']);
  assert.ok(rows[1].said.some(n => n.text.includes('182')));
  assert.ok(!rows[1].said.some(n => n.text.includes('高雄')));
  // With 新竹市's buses all off the road, it says so first.
  const idle = summarize({ bus, cities: ['Hsinchu'], running: { Hsinchu: { routes: Object.fromEntries(Array.from({ length: 29 }, (_, i) => [`HSZ${i}`, 0])) } } }, NOW);
  assert.match(idle[0].sum, /新竹市的公車幾乎都沒在路上/);
});

test('every kind of notice, in two words', () => {
  assert.equal(effectOf('因受薔琵颱風影響，全線停駛一日。'), 'off');
  assert.equal(effectOf('【全航客運】6268F(經國六)中午十二點前停駛'), 'part');
  assert.equal(effectOf('取消停靠 因施工本路線取消停靠XX站'), 'stops');
  assert.equal(effectOf('施工改道 本路線改道行駛'), 'detour');
  assert.equal(effectOf('配合高市府宣布停班停課，市公車於早上8點至晚上7點採颱風/豪雨班表行駛'), 'less');
  assert.equal(effectOf('7314 因道路封閉短駛至石棹站止'), 'short');
  assert.equal(effectOf('28路公車自115年10月19日起，自坪頂延伸至都會南街發車'), 'route');
  assert.equal(effectOf('245路公車自115年10月19日起，調整亞大醫院發車部分班次'), 'time');
  // 統聯's 部分班次異動 on its routes: its times, not the route.
  const u = bus.find(n => n.title.includes('部分班次異動'));
  assert.equal(u.effect, 'time');
  // A route's notices, strongest first.
  const ns = routeNotices(bus, 'HSZ0182', '182', NOW);
  assert.equal(ns[0].effect, 'off');
});

test('no bus on the road: likely off only when the whole city is off it, by day', () => {
  const hsz = { routes: Object.fromEntries(Array.from({ length: 29 }, (_, i) => [`HSZ${String(i).padStart(4, '0')}`, i < 20 ? -1 : 0])) };
  assert.equal(cityIdle(hsz, NOW), true);
  assert.equal(likelyOff(hsz, 'HSZ0025', NOW), true);
  // Night: buses not running is no news.
  assert.equal(cityIdle(hsz, Date.parse('2026-10-23T22:30:00+08:00')), false);
  // Taipei's buses on the road (99 of 271 routes): a route between its buses is only that.
  const tpe = { routes: Object.fromEntries(Array.from({ length: 271 }, (_, i) => [`TPE${i}`, i < 99 ? 3 : 0])) };
  assert.equal(likelyOff(tpe, 'TPE200', NOW), false);
});

test('台鐵: a planner\'s ride our timetable has no train for, on a stopped line: stopped', () => {
  const at = { 竹東: 'tra:1203', 新竹: 'tra:1210', 湖口: 'tra:1180' };
  const stationAt = p => at[p.name];
  const dep = Date.parse('2026-10-23T17:12:00+08:00');
  const ride = (from, to, extra = {}) => ({ mode: 'tra', name: '內灣-新竹', short: '內灣-新竹', from: { name: from, lat: 1, lon: 1 }, to: { name: to, lat: 1, lon: 1 }, dep, ...extra });
  // TDX's planner still had 內灣-新竹 from 竹東 on 2026-10-23.
  assert.equal(traLegOff(ride('竹東', '新竹'), tra.rules, stationAt)?.name, '內灣線');
  // Our timetable named it (a train that runs): never cut here.
  assert.equal(traLegOff(ride('竹東', '新竹', { train: { no: '1831' } }), tra.rules, stationAt), null);
  // 湖口 → 新竹, a 區間 on the 縱貫線: runs.
  assert.equal(traLegOff(ride('湖口', '新竹', { name: '區間車', short: '區間車' }), tra.rules, stationAt), null);
});

test('a notice said twice (Alert and News, a space or a mark apart, or one inside a fuller one) is shown once', async () => {
  const { oneEach } = await import('../public/lib/service.mjs');
  const a = { id: '1', title: '颱風停駛', text: '因受颱風影響，10月23日 各路線全日停駛 如有不便 敬請見諒！' };
  const b = { id: '2', title: '颱風停駛公告', text: '因受颱風影響、10月23日各路線全日停駛如有不便敬請見諒' };
  const c = { id: '3', title: '公告', text: '因受颱風影響，10月23日 各路線全日停駛 如有不便 敬請見諒！另 5614 改道。' };
  const d = { id: '4', title: '改道', text: '光明六路施工改道' };
  assert.deepEqual(oneEach([a, b]).map(n => n.id), ['1']);
  assert.deepEqual(oneEach([a, c, d]).map(n => n.id), ['3', '4']);
  assert.deepEqual(oneEach([d]).map(n => n.id), ['4']);
});
