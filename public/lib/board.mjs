// 交通 in Orbit's own look (Jay 2026-11-03, Orbit-Core DESIGN §11): no big
// card picking one thing for you (the green card was "kind of useless"). Every
// trip and pin is a row of one shape, in the order you keep them: the line's
// badge in its own colour (the only colour on the row), where you get on, and
// the time on the right edge. Every row says when (the bus's live minutes, else
// the timetable's next), a bar on top plans a trip in one tap, and what's near
// comes after, each bus saying which way it goes.

import { e, shown } from './util.mjs';
import { noHtml } from './bus-ui.mjs';
import { icon, inkOn } from './ui.mjs';
import { countHtml } from './look.mjs';

// The time on a row's right: a countdown that ticks (look.mjs tick reads its
// data-at), a small word under it; live in the live colour.
export const whenHtml = (at, sub = '', live = false) => `<span class="ot-strip-eta ob-when${live ? ' live' : ''}"><b>${countHtml(at, { cls: 'ob-n' })}</b>${sub ? `<small>${e(sub)}</small>` : ''}</span>`;

// One row, as a bus's strip (bus-ui.mjs strip, the same classes, so its words
// fit the same way): `no` the line's name on its badge, or `glyph` an icon;
// `color` the line's own colour; `main` and `note` are HTML; `when` whenHtml's.
// (A light colour, YouBike's yellow, takes dark ink: inkOn's line sits higher here, as a glyph is thin.)
const ink = c => (inkOn(c) === '#fff' && /^#?f5b301$/i.test(c) ? '#1c1c1e' : inkOn(c));
export const boardRow = ({ no = '', color = '', glyph = '', main = '', note = '', when = '', attrs = '' }) =>
  `<div class="ot-strip"><button class="ot-strip-main" type="button" ${attrs}><span class="ot-strip-no${glyph ? ' ob-glyph' : ''}"${color ? ` style="--line:${e(color)};--ink:${ink(color)}"` : ''}>${glyph ? icon(glyph) : noHtml(shown(no))}</span><span class="ot-strip-mid"><span class="ot-strip-what"><b>${main}</b></span>${note ? `<span class="ot-strip-note"><small>${note}</small></span>` : ''}</span>${when}</button></div>`;
