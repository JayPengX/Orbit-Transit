// One trip navigated on a phone's GPS (tripsim.mjs): the fixes handed over as
// they would be, the clock and timers run second by second, and what
// navigation showed recorded: its step, what went wrong (the 出狀況 card),
// its actions, its end. Then judged against where the person really was.
import { clock, tick, start, box } from './navsim.mjs';
import { TRIPS } from './gps-trips.mjs';
const { truthPath, gpsFeed, truthAt, metersOff } = await import('../public/lib/tripsim.mjs');
const { isRide } = await import('../public/lib/util.mjs');
const nav = await import('../public/lib/nav.mjs');

const geo = globalThis.navigator.geolocation;
const send = f => geo._cb?.({ coords: { latitude: f.lat, longitude: f.lon, accuracy: f.acc, heading: null }, timestamp: f.at });
// (navsim's watch: the callback it captured; read it through a fresh watch.)
const realWatch = geo.watchPosition;
geo.watchPosition = (cb, ...rest) => ((geo._cb = cb), realWatch.call(geo, cb, ...rest));

export function run(tripName, scenario = 'plan', profile = 'phone', seed = 1, { k = null, reopenAt = null } = {}) {
  const trip = TRIPS[tripName]();
  const plan = trip.plan;
  const ride = k ?? plan.legs.findIndex(l => l.mode !== 'walk' && l.mode !== 'bike');
  const rs0 = trip.rides.get(ride);
  const truth = truthPath(plan, { scenario, k: ride, more: trip.more.get(ride), before: rs0?.stops[rs0.j - 1] });
  const feed = gpsFeed(truth, profile, seed);
  clock.set(truth[0].t);
  let r = start(plan);
  for (const [k, rs] of trip.rides) r.st.ride.set(k, structuredClone(rs));
  const ev = [];
  let last = '';
  let lastTrouble = null;
  const note = t => {
    const s = r.st;
    s.render?.();
    const key = `${s.i}|${s.phase}|${s.reached}`;
    if (key !== last) ev.push({ t, what: 'step', i: s.i, phase: s.phase, reached: s.reached });
    last = key;
    const tr = s.shownTrouble || null;
    if (tr !== lastTrouble) ev.push({ t, what: 'trouble', kind: tr });
    lastTrouble = tr;
  };
  let fi = 0;
  const end = truth.at(-1).t + 60_000;
  let reopened = false;
  for (let t = truth[0].t; t <= end; t += 1000) {
    while (fi < feed.length && feed[fi].got <= t) send(feed[fi++]);
    tick(1000);
    note(clock.get());
    if (reopenAt != null && !reopened && t >= truth[0].t + reopenAt) {
      // (The app killed and opened again: navigation picked up from what it saved.)
      reopened = true;
      const saved = nav.savedNav?.();
      if (saved) {
        const acts = r.acts, ends = r.ends;
        nav.stopNav();
        const st = nav.startNav(saved.plan, { box, draw() {}, follow() {}, onEnd: x => ends.push(x), onAction: (a, i) => acts.push([a, i]), resume: saved });
        r = { st, acts, ends };
        for (const [k, rs] of trip.rides) if (!st.ride.get(k)) st.ride.set(k, structuredClone(rs));
        ev.push({ t, what: 'reopen' });
      }
    }
    if (r.ends.length && !ev.some(e => e.what === 'end')) ev.push({ t: clock.get(), what: 'end' });
  }
  for (const [a, x] of r.acts) ev.push({ what: 'act', a, x: x && typeof x === 'object' ? Object.keys(x).join(',') : x });
  return { trip, plan, truth, feed, ev, ends: r.ends, acts: r.acts, judge: judge(plan, truth, feed, ev, r, scenario, ride) };
}

// What should have happened, by where the person really was.
function judge(plan, truth, feed, ev, r, scenario, ride) {
  const bad = [];
  const tDone = truth.find(s => s.phase === 'done')?.t ?? Infinity;
  const endEv = ev.find(e => e.what === 'end');
  const troubles = ev.filter(e => e.what === 'trouble' && e.kind);
  const steps = ev.filter(e => e.what === 'step');
  const fmt = t => (t == null ? '-' : `${Math.round((t - truth[0].t) / 1000)}s`);
  // Never back to a step already left (unless reopened).
  const stayed = r.acts.some(a => a[0] === 'stayed');
  for (let n = 1; n < steps.length; n++) if (steps[n].reached < steps[n - 1].reached && !stayed) bad.push(`step went back ${steps[n - 1].reached}→${steps[n].reached} at ${fmt(steps[n].t)}`);
  // Never arrived before you're there.
  // (Early by time, and still away: a minute's walk off, or for a trip that
  // ends on the train, 200 m from its station (a long platform's end).)
  const endFar = e => { const s = truthAt(truth, e.t); const d = plan.dest; return d?.lat == null || metersOff(s, d) > (isRide(plan.legs.at(-1)) ? 200 : 80); };
  if (endEv && endEv.t < tDone - 60_000 && endFar(endEv) && !['wrong', 'stray'].includes(scenario)) bad.push(`ended at ${fmt(endEv.t)}, there at ${fmt(tDone)}`);
  if (['wrong', 'stray'].includes(scenario) && endEv && endEv.t < truth.at(-1).t - 120_000) bad.push(`ended at ${fmt(endEv.t)} while off the plan`);
  // The 'on' moment for the ride, and the step after.
  const boardT = truth.find(s => s.k === ride && s.phase === 'on')?.t;
  const alightT = truth.find(s => s.k === ride + 1 && s.phase === 'before')?.t;
  const navOn = steps.find(s => s.i === ride && s.phase === 'on')?.t;
  const navNext = steps.find(s => s.reached >= ride + 1)?.t;
  // (Lag counted from the first good fix after it happened: no fix, no way to know.)
  // (The second: being on a ride takes two fixes going along it.)
  const firstGood = t => feed.filter(f => f.got >= t && f.acc <= 100 && !f.stale)[1]?.got;
  if (['plan', 'late', 'miss', 'over'].includes(scenario) && boardT) {
    const g = firstGood(boardT + 20_000);
    // (Never on it when the phone said nothing while on it: two fixes it takes.)
    if (navOn == null) { if (g && (!alightT || g < alightT)) bad.push(`never on the ride (boarded ${fmt(boardT)})`); }
    else if (g && navOn - g > 150_000) bad.push(`on the ride late: boarded ${fmt(boardT)}, said ${fmt(navOn)}`);
  }
  if (['plan', 'late', 'miss'].includes(scenario) && alightT) {
    const g = firstGood(alightT + 20_000);
    if (navNext == null) bad.push(`never off the ride (off ${fmt(alightT)})`);
    else if (navNext < alightT - 90_000) bad.push(`off the ride early: said ${fmt(navNext)}, off ${fmt(alightT)}`);
    else if (g && navNext - g > 180_000) bad.push(`off the ride late: off ${fmt(alightT)}, said ${fmt(navNext)}`);
  }
  if (['plan', 'late', 'miss'].includes(scenario) && !endEv) bad.push(`never ended (there ${fmt(tDone)})`);
  // Trouble: none on a trip as planned; the right one for each scenario;
  // never flipping from one to another and back.
  const kinds = new Set(troubles.map(e => e.kind));
  const flips = troubles.filter((e, n) => n > 0 && e.kind !== troubles[n - 1].kind).length;
  if (flips > 3) bad.push(`trouble flipped ${flips} times (${troubles.map(e => e.kind).slice(0, 8).join('→')})`);
  if (scenario === 'plan') for (const e of troubles) bad.push(`trouble '${e.kind}' at ${fmt(e.t)} (as planned; truth: step ${truthAt(truth, e.t).k} ${truthAt(truth, e.t).phase})`);
  if (scenario === 'late') for (const e of troubles) if (!['miss', 'late'].includes(e.kind) || e.t > boardT + 60_000) bad.push(`trouble '${e.kind}' at ${fmt(e.t)} (ride late; truth: step ${truthAt(truth, e.t).k} ${truthAt(truth, e.t).phase})`);
  // (Off a stop early: asked, or the walk from there followed to the end.)
  const offStep = steps.find(s => s.reached >= ride + 1)?.t;
  // (Or, the walk from there to the end being the rest of the trip, there at the end in good time.)
  const endedWell = endEv && endEv.t <= tDone + 3 * 60_000;
  if (scenario === 'early' && !kinds.has('off') && !kinds.has('lost') && !endedWell && !(offStep && offStep - (firstGood(truth.find(s => s.phase === 'off').t) ?? 0) < 5 * 60_000)) bad.push(`off early never noticed (troubles: ${[...kinds].join(',') || 'none'})`);
  // (Only when the phone said where you were while it happened: going at a
  // ride's pace off the plan's way, three good fixes or more 500 m and more
  // from where it starts and ends; a silence the whole time (an iPhone in a
  // pocket) leaves nothing to notice.)
  const fast = truth.filter((x, n) => n > 0 && x.phase === 'off' && x.k === ride && metersOff(x, truth[n - 1]) * 1000 / Math.max(1, x.t - truth[n - 1].t) > 3);
  const from = plan.legs[ride].to;
  const startAt = plan.legs[ride].from;
  const seen = fast.length > 0 && feed.filter(f => f.acc <= 100 && !f.stale && f.got >= fast[0].t && f.got <= fast.at(-1).t + 30_000 && Math.min(metersOff(truthAt(truth, f.got), from), metersOff(truthAt(truth, f.got), startAt)) > 500).length >= 3;
  if (scenario === 'wrong' && seen && !kinds.has('wrong') && !kinds.has('lost')) bad.push(`wrong ride never noticed (troubles: ${[...kinds].join(',') || 'none'})`);
  if (scenario === 'stray' && !kinds.has('lost')) bad.push(`walked away never noticed (troubles: ${[...kinds].join(',') || 'none'})`);
  if (scenario === 'over' && seen && !r.acts.some(a => a[0] === 'stayed') && !kinds.has('off') && !kinds.has('wrong') && !kinds.has('lost')) bad.push(`stayed on past the stop never noticed (troubles: ${[...kinds].join(',') || 'none'})`);
  if (scenario === 'miss' && boardT && firstGood(boardT + 20_000) < alightT && !kinds.has('miss') && !steps.some(s => s.i === ride && s.phase === 'on')) bad.push('missed ride: neither said nor the next one taken');
  return bad;
}
