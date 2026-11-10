// 下雨改搭車 (the family's links, Jay 11-10; code only, nothing asked):
// Orbit Weather tells the family's notebook where rain is due (weather.rain:
// each of its places' wet stretches, the radar's shower then the hours at
// 50%+). A trip starting or ending near one of those places favours a bus or
// the metro over a YouBike and a long walk while it rains on them (plan.mjs
// scoreParts `rain`), and its card says which legs are wet.
import { meters } from './util.mjs';

// A Weather place this near the trip's start or end speaks for it.
export const RAIN_NEAR_M = 8000;
// A walk shorter than this is getting on and off (ui.mjs legChips leaves it out too).
export const WET_WALK_S = 180;

// The wet stretches ([from, to], ms) for a trip between `pts`: each end's
// nearest Weather place within RAIN_NEAR_M, together. null: nothing known.
export function rainFor(fact, pts) {
  const places = (fact?.places || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Array.isArray(p.wet));
  if (!places.length) return null;
  const out = [];
  let known = false;
  for (const pt of pts || []) {
    if (pt?.lat == null || pt?.lon == null) continue;
    const best = places.map(p => ({ p, m: meters(pt.lat, pt.lon, p.lat, p.lon) })).filter(x => x.m <= RAIN_NEAR_M).sort((a, b) => a.m - b.m)[0];
    if (!best) continue;
    known = true;
    out.push(...best.p.wet.filter(s => Array.isArray(s) && s[1] > s[0]));
  }
  return known ? out : null;
}

export const inRain = (spans, a, b) => !!spans?.some(([x, y]) => a < y && b > x);
const legEnd = l => l.arr ?? (l.dep != null ? l.dep + (l.dur || 0) * 1000 : null);
// A YouBike ride or a walk of three minutes or more, while it rains.
export const wetLeg = (l, spans) => (l.mode === 'bike' || (l.mode === 'walk' && (l.dur || 0) >= WET_WALK_S)) && l.dep != null && inRain(spans, l.dep, legEnd(l));

// What riding or walking in the rain costs a plan (a score's points, as a
// minute): a ride 6 and half its minutes again, a walk past its first 3
// minutes half again. Enough that a bus a few minutes slower comes first,
// never so much that an hour on buses beats a 10-minute ride in a drizzle.
export function rainCost(p, spans) {
  if (!spans?.length) return 0;
  let cost = 0;
  for (const l of p.legs || []) {
    if (!wetLeg(l, spans)) continue;
    const min = (l.dur || 0) / 60;
    cost += l.mode === 'bike' ? 6 + min * 0.5 : Math.max(0, min - 3) * 0.5;
  }
  return Math.round(cost * 10) / 10;
}

// Each wet leg marked (`wet`), and the plan (`wet`: its card says 會淋雨).
export function markWet(plans, spans) {
  if (!spans?.length) return plans;
  for (const p of plans || []) {
    let any = false;
    for (const l of p.legs || []) if (wetLeg(l, spans)) any = l.wet = true;
    if (any) p.wet = true;
  }
  return plans;
}
