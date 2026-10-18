// The family's premium look for Transit's pages (the kit's q-page-head,
// q-hero-card, q-tile, q-rowcard, q-tag: class names only, so an older kit
// still loads the app), as small string builders the tabs share: a page's head,
// a colour tile per way of moving, tags, and the one hero card each page leads with.

import { e, hm } from './util.mjs';
import { icon } from './ui.mjs';
import { W, en } from './lang.mjs';

// One colour per way of moving, the same on the map, in a plan's legs and here.
export const COLOR = { bus: '#22c55e', tra: '#0ea5e9', hsr: '#f97316', metro: '#3b82f6', bike: '#f5b301', walk: '#8e8e93', route: '#6155f5', place: '#ff383c', tool: '#5e5ce6' };

// "10月18日 週日": a page's small line over its title.
export const dateLine = () => new Date().toLocaleDateString(en ? 'en-US' : 'zh-TW', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Taipei' });

export const pageHead = (title, over = '') => `<header class="q-page-head">${over ? `<p class="q-over">${e(over)}</p>` : ''}<h1>${e(title)}</h1></header>`;
// A colour tile holding one of the app's own glyphs (ui.mjs icon names) or a word.
export const tile = (glyph, color = '', size = '', word = false) => `<span class="q-tile${size ? ` ${size}` : ''}"${color ? ` style="--t:${color}"` : ''} aria-hidden="true">${word ? e(glyph) : icon(glyph)}</span>`;
export const tag = (text, tone = '') => `<span class="q-tag${tone ? ` ${tone}` : ''}">${e(text)}</span>`;
export const section = (title, body, more = '') => `<section class="q-section ot-sec"><div class="q-section-head"><h2>${e(title)}</h2>${more}</div>${body}</section>`;
export const rowCard = rows => `<div class="q-rowcard ot-rows">${rows}</div>`;

// A countdown to a time: minutes big, "現在" when it's now, the clock beyond an hour.
// `data-at` is what the page ticks (tick below) so it stays true between reads.
export function count(at, { floor = false, now = Date.now() } = {}) {
  const raw = (at - now) / 60_000;
  const m = floor ? Math.floor(raw + 0.05) : Math.round(raw);
  if (m >= 60) return { html: `<span>${e(hm(at))}</span>`, wide: true };
  if (m <= 0) return { html: `<span>${W('現在', 'Now')}</span>`, wide: true };
  return { html: `<span>${m}</span><small>${W('分', 'min')}</small>`, wide: false };
}
export const countHtml = (at, o = {}) => `<strong class="q-hc-big ot-count" data-at="${at}"${o.floor ? ' data-floor="1"' : ''}>${count(at, o).html}</strong>`;
// Re-read every countdown in a box (a second's work, run every few seconds).
export function tick(box) {
  for (const el of box?.querySelectorAll('[data-at]') || []) {
    const html = count(Number(el.dataset.at), { floor: Boolean(el.dataset.floor) }).html;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
}

// The page's one thing: { eyebrow, glyph, big (html), title, sub, tags: [html], attrs, color, empty }.
export function hero({ eyebrow = '', glyph = '', big = '', title = '', sub = '', tags = [], attrs = '', color = '', empty = false }) {
  const style = color ? ` style="--q-hc-b:${color};--q-hc-a:color-mix(in srgb, ${color} 55%, #0b1020)"` : '';
  const body = `<span class="q-hc-eyebrow">${glyph ? icon(glyph) : ''}<span>${e(eyebrow)}</span></span>${big}${title ? `<strong class="q-hc-title">${e(title)}</strong>` : ''}${sub ? `<p class="q-hc-sub">${e(sub)}</p>` : ''}${tags.length ? `<span class="q-tags ot-hc-tags">${tags.join('')}</span>` : ''}`;
  return attrs ? `<button class="q-hero-card q-press ot-hero" type="button" ${attrs}${style}>${body}</button>` : `<div class="q-hero-card ot-hero${empty ? ' empty' : ''}"${style}>${body}</div>`;
}
