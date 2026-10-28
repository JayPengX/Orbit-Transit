// The map's sheet, as pure numbers: where its three stops are for a screen,
// where a drag lands, and whether a finger on its body moves the sheet or
// scrolls what's in it. (sheet.mjs does the touching; this is what a test holds.)

export const DETENTS = ['peek', 'medium', 'large'];
// The search field and the first shelf's row of tiles, whole (a tile cut through its circle looks unfinished).
export const PEEK = 236;
// How far a finger goes before it means something, and how long a lift's speed carries it on.
export const SLOP = 6;
const COAST_MS = 200;

// The heights (px) of the three stops in a panel `room` high: peek, medium
// (about half), large (all of it less `top`, so the account pill and the
// map show above, as in Maps). Always peek < medium < large, even on a short screen.
export function detentHeights(room, { top = 64, peek = PEEK } = {}) {
  const r = Math.max(room || 0, 320);
  const large = Math.max(r - top, 260);
  const p = Math.min(peek, large - 140);
  const medium = Math.round(Math.min(Math.max(r * 0.5, p + 90), large - 80));
  return { peek: p, medium, large };
}

// While dragging: the height follows the finger, a little slack past the ends.
export function follow(h, hs) {
  if (h > hs.large) return hs.large + (h - hs.large) * 0.15;
  if (h < hs.peek) return Math.max(hs.peek - 28, hs.peek - (hs.peek - h) * 0.35);
  return h;
}

// Let go at height `h` going `v` px/ms (up is positive): the stop it coasts to.
export function settle(h, v, hs) {
  const to = Math.min(hs.large, Math.max(hs.peek, h + v * COAST_MS));
  let best = 'peek';
  for (const d of DETENTS) if (Math.abs(hs[d] - to) < Math.abs(hs[best] - to)) best = d;
  // A flick moves it at least one stop that way (a fast swipe from peek is not left at peek).
  const from = DETENTS.reduce((a, d) => (Math.abs(hs[d] - h) < Math.abs(hs[a] - h) ? d : a), 'peek');
  const i = DETENTS.indexOf(from);
  if (Math.abs(v) > 0.8 && best === from) return DETENTS[Math.max(0, Math.min(2, i + (v > 0 ? 1 : -1)))];
  return best;
}

// Which way a finger is going once it has moved past the slop: 'v', 'h', or null (not yet).
export function axis(dx, dy, slop = SLOP) {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return null;
  return Math.abs(dy) >= Math.abs(dx) ? 'v' : 'h';
}

// A finger down on the sheet's body, going `dy` (down is positive): does the
// sheet move, or does what's in it scroll? Only the large sheet scrolls (and the
// half one when it holds a trip's steps, `scrolls`: the map above stays in view), and
// only until its top: pulled down from there, the sheet comes with the finger.
export function bodyGesture({ detent, scrollTop = 0, dy = 0, scrolls = detent === 'large' }) {
  if (!scrolls || detent === 'peek') return 'sheet';
  return scrollTop <= 0 && dy > 0 ? 'sheet' : 'scroll';
}

// The stop above or below one (a tap on the grabber steps it up; large goes back down).
export function stepped(detent) {
  return detent === 'peek' ? 'medium' : detent === 'medium' ? 'large' : 'medium';
}
