// What isn't running, from the operators' own notices (service.mjs), on the
// real notices of 2026-10-23 (颱風薔琵: 新竹 and most of Taiwan off work).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traRules, traCut, traSummary, busNotice, busOff, liveNotices, metroNoticesOf, hsrNoticeOf, summarize } from '../public/lib/service.mjs';
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
  assert.match(traSummary(r, DAY), /內灣線/);
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
  assert.ok(rows[1].lines.some(t => t.includes('182')));
  assert.ok(!rows[1].lines.some(t => t.includes('高雄')));
});
