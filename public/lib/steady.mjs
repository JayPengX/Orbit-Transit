// What's shown stays (Jay 2026-11-06: "the trip flicker … it update the trip
// in front of me which is bad"; "the first show is the final result").
// Ways found again over ways already on screen (a later round, a trip's last
// ways shown while its new ones are found, a slow second round past its wait):
// each way shown keeps its place, its rank and its labels (推薦 stays where it
// was); only its times change, to the new ones. A way not shown before comes
// in quietly at the end, under them (never 推薦, never above). A way shown and
// not found again goes (its bus stopped, say): that is news, not a reshuffle.
// `fresh`'s indexes (each way's `times`) stay as they were: nothing is moved
// in the list, only its fields.
import { pickSig } from './plan.mjs';

// The labels that say where a way ranks: the shown way's, never the new one's.
const RANK_TAGS = new Set(['推薦', '最快抵達', '最少轉乘', '最少步行']);
const LIVE = '即時';

export function steadyPlans(shown, fresh) {
  if (!shown?.length) return fresh || [];
  // (Nothing found again, a failure: what's shown stays.)
  if (!fresh?.length) return shown;
  const was = new Map();
  for (const p of shown) {
    if (!p.lead || p.weak) continue;
    const k = pickSig(p);
    if (!was.has(k)) was.set(k, p);
  }
  if (!was.size) return fresh;
  const last = Math.max(0, ...[...was.values()].map(p => p.score ?? 0));
  const taken = new Set();
  return fresh.map(p => {
    if (!p.lead) return p;
    const k = pickSig(p);
    const w = was.get(k);
    const tags = p.tags || [];
    if (w && !taken.has(k)) {
      taken.add(k);
      // (Its rank and labels as shown; 即時 is the new times' own.)
      return { ...p, top: w.top, weak: false, score: w.score, tags: [...(w.tags || []).filter(t => t !== LIVE), ...(tags.includes(LIVE) ? [LIVE] : [])], gone: p.gone || w.gone };
    }
    // A new way: after every way shown, in its own order, a plain row.
    return { ...p, top: false, score: last + 1 + Math.max(0, p.score ?? 0), tags: tags.filter(t => !RANK_TAGS.has(t)) };
  });
}

// The way open on a card, found again in a new list: the same way (its
// lines), its departure nearest the one open; -1 when it's gone.
export function samePlanAt(list, open) {
  if (!open) return -1;
  const k = pickSig(open);
  let best = -1;
  list.forEach((p, i) => {
    if (pickSig(p) !== k) return;
    const d = Math.abs(p.dep - open.dep);
    if (best < 0 || d < Math.abs(list[best].dep - open.dep) || (d === Math.abs(list[best].dep - open.dep) && p.lead && !list[best].lead)) best = i;
  });
  return best;
}

// The whole plan before its first show: planTrip's second round (the direct
// buses, every bus's times, 追公車) when it's in within `ms` (its looks begun
// with the first's since 2026-11-14: half a second after it, warm), else the
// first round, the second still coming (`pending`, merged by steadyPlans when
// it lands). (6 s till then: one slow bus estimate from the Worker, 3.6 s for
// three 公路客運 stops, held the whole trip that long.) → planTrip's answer.
export const SETTLE_MS = 3000;
const PAST = Symbol('past');
export async function settled(out, ms = SETTLE_MS) {
  if (!out?.later) return { ...out, pending: null };
  const got = await Promise.race([out.later.catch(() => null), new Promise(r => setTimeout(r, ms, PAST))]);
  if (got === PAST) return { ...out, pending: out.later };
  return got?.plans?.length ? { ...out, plans: got.plans, sources: got.sources || out.sources, error: got.error ?? null, later: null, pending: null } : { ...out, later: null, pending: null };
}
