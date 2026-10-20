// Transit's pages in the family's look: the kit's classes (q-page-head,
// q-hero-card, q-tile, q-rowcard, q-tag, q-rail), written as strings since
// the tabs draw their pages whole.

import { e, hm } from './util.mjs';
import { icon } from './ui.mjs';
import { W, en } from './lang.mjs';
import * as kitUI from '#kit/ui.mjs';

// One colour per way of moving, the same on the map, in a plan's legs and here.
export const PLACE_COLOR = { home: '#ff9500', work: '#6155f5', school: '#0a84ff', pin: '#ff383c', star: '#f5b301' };
export const COLOR = { bus: '#22c55e', tra: '#0ea5e9', hsr: '#f97316', metro: '#3b82f6', bike: '#f5b301', walk: '#8e8e93', route: '#6155f5', place: '#ff383c' };

// A colour tile holding one of the app's glyphs (ui.mjs icon names), or a word (`word`).
export const tile = (glyph, color = '', size = '', word = false) => `<span class="q-tile${size ? ` ${size}` : ''}"${color ? ` style="--t:${color}"` : ''} aria-hidden="true">${word ? e(glyph) : icon(glyph)}</span>`;
export const tag = (text, tone = '') => `<span class="q-tag${tone ? ` ${tone}` : ''}">${e(text)}</span>`;
// A section: its 20px title, an optional button on the right (`more`: html), its body.
export const section = (title, body, more = '') => `<section class="q-section ot-sec"><div class="q-section-head"><h2>${e(title)}</h2>${more}</div>${body}</section>`;
export const rowCard = rows => `<div class="q-rowcard">${rows}</div>`;

// A countdown to a time: minutes big, 現在 when it's now, the clock beyond an hour.
// `data-at` is what `tick` reads, so it stays true between reads.
export function count(at, { floor = false, now = Date.now() } = {}) {
  const raw = (at - now) / 60_000;
  const m = floor ? Math.floor(raw + 0.05) : Math.round(raw);
  if (m >= 60) return `<span>${e(hm(at))}</span>`;
  if (m <= 0) return `<span>${W('現在', 'Now')}</span>`;
  return `<span>${m}</span><small>${W('分', 'min')}</small>`;
}
export const countHtml = (at, { floor = false, cls = 'q-hc-big' } = {}) => `<strong class="${cls} ot-count" data-at="${at}"${floor ? ' data-floor="1"' : ''}>${count(at, { floor })}</strong>`;
export function tick(box) {
  for (const el of box?.querySelectorAll('[data-at]') || []) {
    const html = count(Number(el.dataset.at), { floor: Boolean(el.dataset.floor) });
    if (el.innerHTML !== html) el.innerHTML = html;
  }
}

// The page's one card, on the app's colour (or `color`): { eyebrow, glyph,
// big (html), title, sub, tags: [html], body (html), actions: [{ label,
// attrs, ghost }], attrs (the whole card a button), color }.
export function hero({ eyebrow = '', glyph = '', big = '', title = '', sub = '', tags = [], body = '', actions = [], attrs = '', color = '' }) {
  const style = color ? ` style="--q-hc-b:${color};--q-hc-a:color-mix(in srgb, ${color} 58%, #0b1020)"` : '';
  const tagHtml = tags.filter(Boolean).join('');
  const inner = `${eyebrow || glyph ? `<span class="q-hc-eyebrow">${glyph ? icon(glyph) : ''}<span>${e(eyebrow)}</span></span>` : ''}${big}${title ? `<strong class="q-hc-title">${e(title)}</strong>` : ''}${sub ? `<p class="q-hc-sub">${e(sub)}</p>` : ''}${tagHtml ? `<span class="q-tags ot-hc-tags">${tagHtml}</span>` : ''}${body}${actions.length ? `<div class="q-hc-row">${actions.map(a => `<button class="q-hc-btn${a.ghost ? ' ghost' : ''}" type="button" ${a.attrs}>${a.label}</button>`).join('')}</div>` : ''}`;
  return attrs ? `<button class="q-hero-card q-press ot-hero" type="button" ${attrs}${style}>${inner}</button>` : `<div class="q-hero-card ot-hero"${style}>${inner}</div>`;
}

// Nothing here: the kit's empty state.
export const emptyNote = title => kitUI.emptyHtml({ title });
// A non-first tab's large title (the kit's navTitle).
export const navTitle = title => kitUI.navTitleHtml(title);
