// 這班為什麼慢 (lib/slow.mjs): only what's known (the live board, 台鐵's notices on the
// train's way); never a cause no notice gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traAlertsNow, alertsOn, slowSpec } from '../public/lib/slow.mjs';

const now = Date.parse('2026-11-11T08:00:00+08:00');
const j = { Alerts: [
  { AlertID: 'a', Title: '新竹－竹北間號誌故障', Description: '列車延誤約 10 分', Status: 2, StartTime: '2026-11-11T07:00:00+08:00', Scope: { Stations: [{ StationID: '1210' }] } },
  { AlertID: 'b', Title: '花蓮站施工', Description: '', Status: 2, StartTime: '2026-11-11T07:00:00+08:00', Scope: { Stations: [{ StationID: '7000' }] } },
  { AlertID: 'c', Title: '正常營運', Status: 1 }
] };

test('slow: the notices on the train’s way, nothing else', () => {
  const on = alertsOn(traAlertsNow(j, now), ['tra:1210', 'tra:1220']);
  assert.deepEqual(on.map(a => a.id), ['a']);
});

test('slow: the delay with where it is and when it gets there; no notice, no cause', () => {
  const spec = slowSpec({ label: '自強 162', delay: 6, arr: now, toName: '新竹', pos: { name: '竹北', status: 2 }, alerts: [] });
  assert.match(spec.line, /晚 6 分/);
  assert.doesNotMatch(spec.line, /會車|多半|可能/);
  assert.equal(spec.sections.length, 1);
  assert.equal(spec.sections[0].rows.find(r => r.value === '08:06')?.sub, '原本 08:00');
  const told = slowSpec({ label: '自強 162', delay: 6, arr: now, toName: '新竹', pos: null, alerts: traAlertsNow(j, now).slice(0, 1) });
  assert.equal(told.sections[1].rows[0].label, '新竹－竹北間號誌故障');
  assert.match(slowSpec({ label: '自強 162', delay: 0, pos: null }).line, /準點/);
});
