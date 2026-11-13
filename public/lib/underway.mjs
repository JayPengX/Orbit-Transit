// One account, many places (Jay 2026-11-13: "when I have a trip in orbit it
// won't have a trip in a standalone app"): what's under way here is the
// account's, not this screen's. The trip being navigated (`nav`), the
// YouBike rental's timer (`rental`) and the bus alerts set (`alerts`) go to
// the Pass as they change (the kit's q.putNow; Orbit-Core eco.js eco-now),
// from the place that runs Transit; the place that takes Transit over
// (opening it, 在這裡繼續: Orbit, the separate app, another device) gets the
// Pass's with its claim and goes on from where it was. Per thing the newer
// change wins, and an end is a change: a trip ended anywhere ends everywhere.
// A paused copy's changes don't count (`changed` only while this place
// runs Transit): the place that took over has the newer one.
// An opening reads the Pass before it writes: what changes here before the
// Pass is heard (a ride kept on the phone, taken up again as the app opens)
// waits for it, and gives way to anything the Pass has that's newer than
// this phone's last word (ended in the other app since: ended here too).

import { readJson, writeJson, rec } from '#kit/orbit.mjs';

// When each last changed here (ms): { nav, rental, alerts }.
const TIMES = 'ot.now.v1';
// (Over this, a plan's drawn roads are left behind: found again on the way.)
const SLIM_AT = 150_000;
const takers = new Map();
let q = null;
let taking = false;
// This opening has heard the Pass (its shelf, or a claim that came back).
let heard = false;
// Changed before then: key → { v, at, base: when it last changed before }.
const held = new Map();

// `key`'s place here: now() its value on this phone (null: nothing under
// way), take(v) a newer one from the Pass taken up, until(v) when it ends by
// itself (ms; Orbit's window opens on the app with something under way).
export function underWay(key, { now, take, until = () => undefined }) {
  takers.set(key, { now, take, until });
}
const ends = (key, v) => (v == null ? undefined : takers.get(key)?.until(v));
// Changed here (v null: over): its time noted, sent up (held till the Pass
// is heard). (Not while taking the Pass's up, and not from a copy another
// place has taken over.)
export function changed(key, v) {
  if (taking || q?.canSave === false) return;
  const at = Date.now();
  const times = readJson(TIMES) || {};
  const copy = passCopy(v);
  if (heard) q?.putNow?.(key, copy, at, { until: ends(key, copy) });
  else held.set(key, { v: copy, at, base: held.get(key)?.base ?? (times[key] || 0) });
  writeJson(TIMES, { ...times, [key]: at });
}
// What goes up: JSON only (no promises: the later buses on their way); a
// very long plan without its roads.
export function passCopy(v) {
  if (v == null) return null;
  const text = JSON.stringify(v, (k, x) => (x instanceof Promise ? undefined : x));
  if (text.length <= SLIM_AT) return JSON.parse(text);
  return JSON.parse(text, (k, x) => (k === 'path' || k === 'road' || k === 'track' ? undefined : x));
}
// The Pass's shelf (a claim's or the sign-in's): each thing changed there
// after here taken up; one changed here after there (held for it, or a
// write that never got through) sent up.
export function fromPass(shelf, { now = Date.now() } = {}) {
  if (!shelf || typeof shelf !== 'object') return;
  const times = readJson(TIMES) || {};
  const live = q?.canSave !== false;
  for (const [key, t] of takers) {
    const e = shelf[key];
    const h = held.get(key);
    held.delete(key);
    const mine = h ? h.base : times[key] || 0;
    if (e && e.at > mine) {
      times[key] = e.at;
      writeJson(TIMES, times);
      taking = true;
      try {
        t.take(e.v ?? null);
      } catch (err) {
        rec('error', { where: `transit under way ${key}`, message: String(err?.message || err).slice(0, 160) });
      } finally {
        taking = false;
      }
    } else if (h) live && q?.putNow?.(key, h.v, Math.min(h.at, now), { until: ends(key, h.v) });
    else if (mine > (e?.at || 0) && live) {
      const v = passCopy(t.now() ?? null);
      q?.putNow?.(key, v, Math.min(mine, now), { until: ends(key, v) });
    }
  }
  for (const [key, h] of held) live && q?.putNow?.(key, h.v, Math.min(h.at, now), { until: ends(key, h.v) });
  held.clear();
  heard = true;
}
// The app's session (app.mjs), at each opening. (A claim that came back
// without a shelf, a Worker without one: heard all the same.)
export function useUnderWay(session) {
  q = session;
  heard = false;
  held.clear();
  session.on?.('now', shelf => fromPass(shelf));
  session.on?.('claim', c => c?.ok && !heard && fromPass({}));
}
