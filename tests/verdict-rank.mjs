// A saved trip (tests/verdicts/*.json, scripts/verdict.mjs) ranked again by
// today's code, as the phone ranks it (replay.mjs's settings): → the ranked plans.
import { readFileSync } from 'node:fs';
import { withBikes } from '../public/lib/plan.mjs';
import { coverage, fareOf, tpassOf, inPass, passOk, bikeSwap } from '../public/lib/tpass.mjs';

// `jitter(i)`: minutes to move plan i by when it has a bus (live times move
// a few minutes from one reading to the next): the verdicts must not flip.
// `shuffle(list)`: the plans and bikes in another order (as the planners
// answer in any order): the ranking must not change.
export function rankSaved(name, { jitter = null, shuffle = null } = {}) {
  const t = JSON.parse(readFileSync(new URL(`./verdicts/${name}.json`, import.meta.url), 'utf8'));
  if (shuffle) Object.assign(t, { plans: shuffle(t.plans), bikes: shuffle(t.bikes) });
  if (jitter)
    t.plans = t.plans.map((p, i) => {
      const m = p.legs.some(l => l.mode === 'bus') ? jitter(i) * 60_000 : 0;
      if (!m) return p;
      // (Not before the time asked: a plan can't leave before it.)
      const d = p.dep + m < t.t0 ? 0 : m;
      return { ...p, dep: p.dep + d, arr: p.arr + d, legs: p.legs.map(l => ({ ...l, dep: l.dep + d, arr: l.arr + d })) };
    });
  const cityOf = pt => (pt?.lat != null ? t.cities[`${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`] ?? null : null);
  const pass = tpassOf(t.prefs.tpass);
  const keep = inPass(t.from, t.to, pass, cityOf) ? p => passOk(p, pass, cityOf) : null;
  const cost = p => fareOf(p, coverage(p, pass, cityOf)).cost;
  return withBikes(t.plans, t.from, t.to, t.bikes, t.t0, { modes: t.prefs.modes, swap: bikeSwap(t.prefs), cost, by: t.by, deadline: t.by === 'arrive' ? t.at : null, keep, clock: t.now });
}
// A plan in a line: its rides by line and stations, its bikes by minutes.
export const sayPlan = p => p.legs.filter(l => l.mode !== 'walk').map(l => (l.mode === 'bike' ? `bike${Math.round((l.dur || 0) / 60)}` : `${l.mode}:${String(l.short || l.name || '').replace(/\s+/g, '')}:${l.from?.name || ''}>${l.to?.name || ''}`)).join(' ');
