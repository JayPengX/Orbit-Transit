// 換條分支 (Jay 11-26): the trip's other ways that share the part behind
// you, and part ahead you're not yet on, switched to while under way: the same
// train with another station to get off at (竹中 and a YouBike, or 六家 and a
// bus), or the same start with another way after a change. Kept with the
// navigated plan (`branches`, from the plans it was picked from); pure, so
// nav.mjs applies one (navBranch) and tab-map lists them.
import { isRide, meters } from './util.mjs';

const close = (a, b, m) => a?.lat != null && b?.lat != null && meters(a.lat, a.lon, b.lat, b.lon) < m;
// The same run of a bus or train: boarded at the same stop at the same time
// (a train by its number when both know it, a bus by its name).
export const sameRun = (a, b) =>
  isRide(a) &&
  isRide(b) &&
  a.mode === b.mode &&
  close(a.from, b.from, 300) &&
  Math.abs(a.dep - b.dep) < 90_000 &&
  (a.train?.no && b.train?.no ? String(a.train.no) === String(b.train.no) : String(a.short || a.name || '') === String(b.short || b.name || ''));
// The same step: a ride on the same run to the same stop; a walk or YouBike between the same places.
export const sameLeg = (a, b) => (isRide(a) ? sameRun(a, b) && close(a.to, b.to, 300) : a?.mode === b?.mode && close(a.from, b.from, 200) && close(a.to, b.to, 200));

// One other way against the plan under way at step i. → a branch, or null:
// { n, kind: 'off' (on the same run, off elsewhere) | 'after' (another way
// from where step n-1 ends), at (where it parts), legs, arr }.
export function branchOf(plan, i, other, now = Date.now()) {
  const a = plan?.legs || [];
  const b = other?.legs || [];
  if (!a.length || !b.length || !(other.arr > now)) return null;
  let n = 0;
  while (n < a.length && n < b.length && sameLeg(a[n], b[n])) n++;
  // (The same way, or one whose tail is only a step shorter: nothing to switch to.)
  if (n >= b.length || n >= a.length) return null;
  // Its own rides ahead still to be caught.
  if (b.slice(n + 1).some(l => isRide(l) && l.dep < now - 60_000)) return null;
  if (n >= i && sameRun(a[n], b[n]) && !close(a[n].to, b[n].to, 300) && b[n].arr > now + 60_000) return { n, kind: 'off', at: b[n].to?.name || '', legs: b, arr: other.arr };
  // (Another way after the step you're on, or after one still ahead; never one that parted behind you.)
  if (n > i && n >= 1 && !(isRide(b[n]) && b[n].dep < now - 60_000)) return { n, kind: 'after', at: a[n - 1].to?.name || '', legs: b, arr: other.arr };
  return null;
}

// Every branch still open at step i, soonest there first, one per way.
export function branchesOf(plan, i, now = Date.now()) {
  const seen = new Set();
  return (plan?.branches || [])
    .map(o => branchOf(plan, i, o, now))
    .filter(Boolean)
    .sort((x, y) => x.arr - y.arr)
    .filter(x => {
      const k = x.legs.map(l => `${l.mode}:${l.short || l.name || ''}:${l.to?.name || ''}`).join('|');
      return !seen.has(k) && seen.add(k);
    });
}

// The plans a navigated one was picked from, kept with it: those that share
// its start (any step), at most 5, without their own branches.
export function keepBranches(p, others = []) {
  const list = others.filter(o => o && o !== p && o.legs?.length && sameLeg(o.legs[0], p.legs[0])).slice(0, 5);
  return list.map(o => ({ legs: o.legs, dep: o.dep, arr: o.arr }));
}
