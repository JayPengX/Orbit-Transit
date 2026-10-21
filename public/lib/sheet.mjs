// The map's one persistent bottom sheet (Maps' model): it stays over the
// map, never a dialog, in three stops (peek, medium, large). Drag its
// grabber, its top or its body (a finger, or a mouse on the grabber) and it
// follows, then lands on a stop; a tap on the grabber steps it. The map
// keeps the room above. The numbers are detents.mjs; this is the touching.

import { DETENTS, detentHeights, follow, settle, axis, bodyGesture, stepped } from './detents.mjs';

const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// el: the sheet; parts: { head (its top: grabber and search), body (what scrolls), grab (the grabber button) };
// room() the panel's height, top() the space kept above the large sheet;
// side() true while it is a column beside the map (an iPad on its side): then
// it is always the panel's height, every stop the same, and nothing drags it.
export function persistentSheet(el, { head, body, grab, room, top = () => 64, side = () => false, detent = 'peek', onChange = () => {} }) {
  let cur = DETENTS.includes(detent) ? detent : 'peek';
  const heights = () => {
    if (!side()) return detentHeights(room(), { top: top() });
    const h = Math.max(room() - top(), 260);
    return { peek: h, medium: h, large: h };
  };
  let hs = heights();
  let dragging = false;
  // Its height now (what shows above the panel's foot).
  let shown = hs[cur];
  const listeners = new Set([onChange]);

  // The sheet is always as tall as the large stop and slides: a drag moves
  // only its transform, so no frame lays out the sheet or the map (a height
  // each frame was the lag on a phone). `--ms-h` is said once it lands.
  const full = () => hs.large + 40;
  const apply = (h, animate) => {
    shown = h;
    el.classList.toggle('dragging', !animate);
    el.style.height = `${full()}px`;
    el.style.transform = `translate3d(0, ${Math.round(full() - h)}px, 0)`;
    if (animate || !dragging) el.parentElement?.style.setProperty('--ms-h', `${Math.round(h)}px`);
  };
  const paint = (animate = true) => {
    el.dataset.detent = cur;
    el.parentElement?.setAttribute('data-sheet', cur);
    grab?.setAttribute('aria-valuenow', String(DETENTS.indexOf(cur)));
    grab?.setAttribute('aria-valuetext', cur);
    apply(hs[cur], animate && !reduced());
  };
  const set = (d, { animate = true, quiet = false } = {}) => {
    if (!DETENTS.includes(d)) return cur;
    const was = cur;
    cur = d;
    paint(animate);
    if (!quiet && was !== d) listeners.forEach(f => f(d, was));
    return cur;
  };
  const relayout = () => {
    hs = heights();
    if (!dragging) paint(false);
  };

  // ---- a finger anywhere on the sheet ----
  let g = null; // { y0, x0, h0, mode: null | 'sheet' | 'scroll' | 'ignore', head: bool, trail: [[t, y]] }
  const sample = (t, y) => {
    g.trail.push([t, y]);
    while (g.trail.length > 1 && t - g.trail[0][0] > 100) g.trail.shift();
  };
  const speed = t => {
    const a = t[0];
    const b = t.at(-1);
    return b[0] > a[0] ? (a[1] - b[1]) / (b[0] - a[0]) : 0; // up is positive
  };
  const start = (y, x, inHead) => {
    g = { y0: y, x0: x, h0: shown, mode: null, head: inHead, trail: [[performance.now(), y]] };
  };
  const move = (y, x, ev) => {
    if (!g || g.mode === 'ignore') return;
    const dy = y - g.y0;
    sample(performance.now(), y);
    if (!g.mode || g.mode === 'scroll') {
      if (!g.mode) {
        const a = axis(x - g.x0, dy);
        if (!a) return;
        if (a === 'h') return void (g.mode = 'ignore');
      }
      const m = g.head ? 'sheet' : bodyGesture({ detent: cur, scrollTop: body.scrollTop, dy });
      if (m === 'scroll') return void (g.mode = 'scroll');
      // (Scrolled up to the top and still pulling: the sheet takes the finger from here. Otherwise it
      // follows from where the finger went down, so the first move, however far, is not lost.)
      if (g.mode === 'scroll') {
        g.y0 = y;
        g.h0 = shown;
      }
      g.mode = 'sheet';
    }
    if (ev.cancelable) ev.preventDefault();
    dragging = true;
    // (One move a frame: a phone sends more touches than it paints.)
    g.y = y;
    if (!g.raf) g.raf = requestAnimationFrame(() => {
      if (!g || g.mode !== 'sheet') return;
      g.raf = 0;
      apply(follow(g.h0 - (g.y - g.y0), hs), false);
    });
  };
  const end = () => {
    if (!g) return;
    const was = g;
    g = null;
    if (was.mode !== 'sheet') return;
    if (was.raf) cancelAnimationFrame(was.raf);
    const h = was.y != null ? follow(was.h0 - (was.y - was.y0), hs) : shown;
    dragging = false;
    const to = settle(h, speed(was.trail), hs);
    // (Back to the stop it was at: nothing changed, but it still slides home.)
    if (to === cur) paint(true);
    else set(to);
    // (The click that ends a drag is not a tap on what's under it.)
    el.dataset.dragged = '1';
    setTimeout(() => delete el.dataset.dragged, 60);
  };

  el.addEventListener('touchstart', ev => {
    if (ev.touches.length !== 1 || side()) return void (g = null);
    const t = ev.touches[0];
    start(t.clientY, t.clientX, head.contains(ev.target));
  }, { passive: true });
  el.addEventListener('touchmove', ev => g && move(ev.touches[0].clientY, ev.touches[0].clientX, ev), { passive: false });
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', () => {
    if (g?.mode === 'sheet') end();
    g = null;
  });

  // ---- a mouse on the grabber and the top (not the field, whose text it selects) ----
  el.addEventListener('pointerdown', ev => {
    if (side() || ev.pointerType !== 'mouse' || ev.button !== 0 || !head.contains(ev.target) || ev.target.closest('input,textarea,.ot-ms-act')) return;
    start(ev.clientY, ev.clientX, true);
    el.setPointerCapture?.(ev.pointerId);
  });
  el.addEventListener('pointermove', ev => ev.pointerType === 'mouse' && g && move(ev.clientY, ev.clientX, ev));
  const up = ev => ev.pointerType === 'mouse' && end();
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  // A click after a drag on the grabber steps nothing.
  grab?.addEventListener('click', () => {
    if (el.dataset.dragged || side()) return;
    set(stepped(cur));
  });
  grab?.addEventListener('keydown', ev => {
    const i = DETENTS.indexOf(cur);
    if (ev.key === 'ArrowUp') set(DETENTS[Math.min(2, i + 1)]);
    else if (ev.key === 'ArrowDown') set(DETENTS[Math.max(0, i - 1)]);
    else return;
    ev.preventDefault();
  });

  // The panel's size changed (turned, the keyboard, a bar): the stops again.
  if (globalThis.ResizeObserver && el.parentElement) new ResizeObserver(relayout).observe(el.parentElement);
  paint(false);

  const api = {
    el,
    get detent() {
      return cur;
    },
    get height() {
      return shown;
    },
    heights: () => hs,
    set,
    relayout,
    onChange: f => (listeners.add(f), () => listeners.delete(f))
  };
  // (Reachable from the element: the preview tool and a test page set a stop by it.)
  el.sheet = api;
  return api;
}
