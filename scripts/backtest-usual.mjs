// How often 建議's own guesses of where the person goes (suggest.mjs: 常在這時候去, 回家,
// 去公司 and 去學校 from the pinned places) are right, replayed on made-up
// people (never anyone's real trips) from their first day, the way the app
// learns: every trip planned is a time for 常去 (store.mjs rememberTrip), and
// with the kit's feedback.mjs, every card shown and gone there or not.
//
//   node scripts/backtest-usual.mjs                 # this tree
//   node scripts/backtest-usual.mjs --against HEAD  # that commit's suggest.mjs too
//
// right   of the cards shown, the share whose place the person planned a trip to within 2 hours
// caught  of the trips to the person's usual places, the share the card named as they opened the app
// wrong   cards naming a place they didn't go to, a week
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rememberTrip } from '../public/lib/store.mjs';
import { twAt, tw, meters, addDays } from '../public/lib/util.mjs';
import { twWorkday } from '#kit/holidays.mjs';
import * as F from '#kit/feedback.mjs';

const DAYS = 120;
const START = '2026-09-01';
const MIN = 60_000;
const NEAR = 300;

// A seeded random (the same people every run).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

// Places around Hsinchu.
const P = (name, lat, lon, icon) => ({ id: name, name, lat, lon, ...(icon ? { icon } : {}) });
const HOME = P('家', 24.8, 120.97, 'home');
const WORK = P('公司', 24.786, 121.017, 'work');
const WORK2 = P('新公司', 24.772, 121.045, 'work');
const SCHOOL = P('學校', 24.795, 121.0, 'school');
const GYM = P('健身房', 24.81, 120.99);
const MARKET = P('市場', 24.805, 120.96);
const CRAM = P('補習班', 24.802, 120.975);
const PARENTS = P('爸媽家', 24.83, 121.01);

// A person: what they've pinned, and their week. A habit: [days (0 Sun … 6 Sat, 'work' a workday), hour, spread (min), chance, place].
const PEOPLE = {
  commuter: { pinned: [HOME, WORK], habits: [['work', 7.75, 15, 0.7, WORK], ['work', 18.25, 30, 0.5, HOME], [[3], 19.5, 15, 0.6, GYM], [[6], 10.5, 30, 0.5, MARKET]] },
  student: { pinned: [HOME, SCHOOL], habits: [['work', 7.1, 10, 0.85, SCHOOL], [[2, 4], 17.7, 10, 0.8, CRAM], [[2, 4], 21.2, 10, 0.7, HOME], [[0], 15, 40, 0.5, PARENTS]] },
  // Pinned 家 and 公司 but rides a scooter there: never plans the commute.
  scooter: { pinned: [HOME, WORK], habits: [[[6], 10.5, 30, 0.5, MARKET], [[0], 15, 40, 0.4, PARENTS]] },
  // A new job from day 50 (the pin moved too).
  mover: { pinned: [HOME, WORK], moveAt: 50, habits: [['work', 8, 15, 0.7, WORK], ['work', 18.5, 30, 0.5, HOME], [[6], 10.5, 30, 0.5, MARKET]] },
  // Nothing pinned: only what they plan.
  unpinned: { pinned: [], habits: [['work', 7.75, 15, 0.7, WORK], ['work', 18.25, 30, 0.5, HOME], [[3], 19.5, 15, 0.6, GYM]] }
};

function dayOf(who, seed) {
  const r = rng(seed);
  const others = Array.from({ length: 25 }, (_, i) => P(`地點${i}`, 24.76 + r() * 0.09, 120.93 + r() * 0.12));
  const days = [];
  for (let d = 0; d < DAYS; d++) {
    const date = addDays(START, d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const work = twWorkday(date);
    const p = PEOPLE[who];
    const moved = p.moveAt != null && d >= p.moveAt;
    const trips = [];
    for (const [when, h, sd, chance, place] of p.habits) {
      if (!(when === 'work' ? work : when.includes(dow) && (work || dow === 0 || dow === 6))) continue;
      if (r() > chance) continue;
      const to = moved && place === WORK ? WORK2 : place;
      trips.push({ at: twAt(date, '00:00') + (h * 60 + gauss(r) * sd) * MIN, to, habit: true });
    }
    // Other trips now and then, anywhere.
    for (let k = 0; k < 3; k++) if (r() < 0.25) trips.push({ at: twAt(date, '00:00') + (9 + r() * 13) * 60 * MIN, to: others[Math.floor(r() * others.length)], habit: false });
    // Opened just to look (a bus, the map), twice a day or so.
    const looks = Array.from({ length: Math.floor(r() * 4) }, () => twAt(date, '00:00') + (6.5 + r() * 16.5) * 60 * MIN);
    days.push({ date, d, moved, trips: trips.sort((a, b) => a.at - b.at), looks });
  }
  return days;
}

async function load(ref) {
  if (!ref) return import('../public/lib/suggest.mjs');
  const src = execFileSync('git', ['show', `${ref}:public/lib/suggest.mjs`], { encoding: 'utf8' });
  const tmp = fileURLToPath(new URL(`../public/lib/.suggest-${process.pid}.mjs`, import.meta.url));
  writeFileSync(tmp, src);
  try {
    return await import(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}

const mem = () => {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
};
const GUESS = new Set(['usual', 'go', 'home']);

function replay(S, who, seed) {
  F.useStore(mem());
  const days = dayOf(who, seed);
  const p = PEOPLE[who];
  let recents = [];
  const out = { early: { shown: 0, right: 0, habit: 0, caught: 0 }, later: { shown: 0, right: 0, habit: 0, caught: 0 } };
  for (const day of days) {
    const pinned = day.moved ? p.pinned.map(x => (x === WORK ? WORK2 : x)) : p.pinned;
    let here = HOME;
    const opens = [...day.trips.map(t => ({ at: t.at - 2 * MIN, trip: t })), ...day.looks.map(at => ({ at }))].sort((a, b) => a.at - b.at);
    const goes = day.trips;
    const o = day.d < 14 ? out.early : out.later;
    for (const open of opens) {
      // Where they are: where the last trip took them.
      const last = goes.filter(t => t.at < open.at).at(-1);
      here = last ? last.to : HOME;
      const list = S.suggest({ now: open.at, here, places: pinned, recents, fb: S.placeItem ? F.chance('transit', open.at) : null });
      // (Up to three on the shelf: each guess of a place is a card.)
      const named = list.filter(x => GUESS.has(x.kind)).map(x => x.place);
      for (const n of named) {
        o.shown++;
        if (goes.some(t => t.at >= open.at && t.at - open.at <= 120 * MIN && meters(t.to.lat, t.to.lon, n.lat, n.lon) < NEAR)) o.right++;
      }
      if (S.placeItem && named.length) F.shown('transit', named.map(n => S.placeItem(n, open.at)), open.at);
      if (open.trip) {
        const t = open.trip;
        const hit = named.some(n => meters(t.to.lat, t.to.lon, n.lat, n.lon) < NEAR);
        if (t.habit) o.habit++, hit && o.caught++;
        recents = rememberTrip(recents, t.to, { now: t.at, went: true });
        if (S.placeItem) F.picked('transit', S.placeItem(t.to, t.at), t.at, { from: hit ? 'list' : 'elsewhere' });
      }
    }
  }
  return out;
}

const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '–');
const args = process.argv.slice(2);
const against = args.includes('--against') ? args[args.indexOf('--against') + 1] : null;
const runs = [...(against ? [[against, await load(against)]] : []), ['now', await load(null)]];
const seeds = [7, 11, 23, 42, 99];
console.log(`建議's 常去, 回家 and 去公司 cards, ${DAYS} days from ${START}, averaged over ${seeds.length} runs: right (of cards shown) · caught (of trips to usual places) · wrong a week`);
for (const who of Object.keys(PEOPLE)) {
  console.log(`\n${who}`);
  for (const [name, S] of runs) {
    const sum = { early: {}, later: {} };
    for (const seed of seeds) {
      const r = replay(S, who, seed);
      for (const part of ['early', 'later']) for (const [k, v] of Object.entries(r[part])) sum[part][k] = (sum[part][k] || 0) + v;
    }
    const line = (x, weeks) => `right ${pct(x.right, x.shown)} · caught ${pct(x.caught, x.habit)} · wrong ${((x.shown - x.right) / seeds.length / weeks).toFixed(1)}`;
    console.log(`  ${name.padEnd(8)} first 2 weeks ${line(sum.early, 2)}   after ${line(sum.later, (DAYS - 14) / 7)}`);
  }
}
