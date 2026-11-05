// A day's trains as the proxy sends them (Orbit-Core transit.js tdxTrim: only
// the fields read here: 台鐵's stations' names, flags and other languages gone) read the same
// as TDX's whole answer: the same trips, stops, times, types and English
// names. Real trains of 2026-11-05 (through midnight, every type). Runs where
// Orbit-Core is checked out beside this repo (push.sh); CI has the kit only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { traTrips, hsrTrips } from '../public/lib/rail.mjs';

const core = new URL('../../Orbit-Core/transit.js', import.meta.url);
const day = name => readFileSync(new URL(`./fixtures/rail-2026-11-05/${name}.json`, import.meta.url), 'utf8');

test("the proxy's trimmed day reads as TDX's whole one", { skip: !existsSync(core) && 'Orbit-Core is not beside this repo' }, async () => {
  const { tdxTrim } = await import(core.href);
  for (const [name, path, read] of [
    ['tra', 'basic/v3/Rail/TRA/DailyTrainTimetable/TrainDate/2026-11-05', traTrips],
    ['hsr', 'basic/v2/Rail/THSR/DailyTimetable/TrainDate/2026-11-05', hsrTrips]
  ]) {
    const raw = day(name);
    const lean = tdxTrim(path, raw);
    assert.ok(lean.length < raw.length * 0.5, `${name}: ${lean.length} of ${raw.length}`);
    const trips = read(JSON.parse(raw));
    assert.ok(trips.length > 5);
    assert.deepEqual(read(JSON.parse(lean)), trips);
  }
  // The English names the app learns from it (zh(): a type, a headsign's station) still there.
  for (const { TrainInfo: i } of JSON.parse(tdxTrim('basic/v3/Rail/TRA/DailyTrainTimetable/TrainDate/2026-11-05', day('tra'))).TrainTimetables) {
    assert.ok(i.TrainTypeName.Zh_tw && i.TrainTypeName.En && i.EndingStationName.En, i.TrainNo);
  }
});
