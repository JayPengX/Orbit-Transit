// 用說的查路線's sheet (lib/said.mjs; the family's AI plan): say where and
// when, see what was understood (from, to, the time) drawn under the Orbit
// AI mark, and 看路線 opens it on the map: each place one of yours by its
// name, else the place search with your words in it. A plain "去 X" skips
// the AI and the sheet both. Read on the tap (tab-go's ✦ on 要去哪裡).
import * as kitUI from '#kit/ui.mjs';
import * as kitAI from '#kit/ai.mjs';
import { W } from '#kit/lang.mjs';
import { readSaid, whenOf, saidFacts, placeNamed } from './said.mjs';
import { shown } from './util.mjs';

const h = kitUI.h;
const TW = 8 * 3_600_000;
const md = t => {
  const d = new Date(t + TW);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.toISOString().slice(11, 16)}`;
};

// `ask`: a question already said (問 Orbit's, #ask=…), read at once.
export function openSayTrip(ctx, { ask = '' } = {}) {
  const STARTERS = [W('明天早上 8 點前到台北車站', 'To Taipei Main Station by 8 tomorrow'), W('現在回家', 'Home now'), W('下午三點從學校去台大醫院', 'From school to NTU Hospital at 3 pm')];
  const talk = h('div', { class: 'ot-say-talk', 'aria-live': 'polite' });
  let open = true;
  const bar = kitAI.aiBar({ placeholder: W('說要去哪、什麼時候…', 'Where and when…'), label: W('用說的查路線', 'Say your trip'), max: 120, onSend: q => go(q) });
  const starters = h('div', { class: 'q-ai-chips ot-say-starters' }, STARTERS.map(q => h('button', { class: 'q-chip', type: 'button', text: q, onclick: () => go(q) })));
  const hint = h('p', { class: 'ot-say-hint', text: W('說出發地、目的地和時間；沒說從哪裡，就從你現在的位置。', 'Say where from, where to and when; with no start, from where you are.') });
  const foot = h('div', { class: 'q-sheet-foot ot-say-foot' }, [bar]);
  const s = kitUI.sheet({ title: W('用說的查路線', 'Say your trip'), detent: 'large', cls: 'ot-say', body: [hint, starters, talk], foot, onClose: () => (open = false) });
  if (ask) requestAnimationFrame(() => go(String(ask).slice(0, 120)));
  else requestAnimationFrame(() => bar.input?.focus());

  const go_ = trip => {
    s.close?.();
    ctx.planSaid?.(trip);
  };
  // What was understood, drawn: from, to, when; 看路線 under it.
  const understood = (trip, mine) => {
    const row = (label, value, glyph, color) => ({ lead: { glyph: kitUI.icons?.[glyph] || '', color }, label, value });
    const when = trip.by === 'now' ? W('現在出發', 'Leaving now') : `${trip.by === 'arrive' ? W('抵達', 'Arrive by') : W('出發', 'Leave at')} ${md(trip.at)}`;
    const a = (kitAI.aiAnswer || (() => null))({
      line: W(`${trip.from || '目前位置'} 到 ${trip.to}`, `${trip.from || 'Here'} to ${trip.to}`),
      sections: [{ rows: [row(W('出發', 'From'), trip.from || W('目前位置', 'Where you are'), mine.from ? 'home' : 'pin', 'var(--q-green)'), row(W('到達', 'To'), trip.to, mine.to ? 'home' : 'flag', 'var(--q-red)'), row(W('時間', 'When'), when, 'clock', 'var(--q-blue)')] }]
    }) || h('p', { class: 'ot-say-line', text: `${trip.from || W('目前位置', 'Here')} → ${trip.to} · ${when}` });
    return h('div', { class: 'ot-say-a' }, [a, h('button', { class: 'q-btn primary block', type: 'button', text: W('看路線', 'See the ways'), onclick: () => go_(trip) })]);
  };

  async function go(q) {
    if (bar.classList.contains('busy')) return;
    // (A plain one, read by code: straight to it.)
    const plain = readSaid(q);
    if (plain) return go_({ ...plain, by: 'now', at: null });
    starters.hidden = true;
    bar.busy(true);
    bar.clear();
    const doing = W('讀一下你要去哪…', 'Reading your trip…');
    const think = kitAI.aiAnswerWait?.({ text: doing, rows: 3 }) || kitAI.aiThinking(doing);
    talk.append(h('p', { class: 'ot-say-you', text: q }), think);
    try {
      const now = Date.now();
      const r = await kitAI.aiCall('transit-say', { text: q, ...saidFacts(now, ctx.data.places, shown) });
      if (!open) return;
      const o = r.out;
      if (!o?.to) {
        think.replaceWith(h('p', { class: 'ot-say-hint ot-say-err', text: r.error ? kitAI.aiSays(r.error, r.left) : W('聽不出要去哪裡，換個說法，例如「明天八點前到台北車站」。', 'Couldn’t tell where to. Try “to Taipei Main Station by 8 tomorrow”.') }));
        return;
      }
      const trip = { from: o.from || '', to: o.to, ...whenOf(o, now) };
      const mine = { from: Boolean(trip.from && placeNamed(ctx.data.places, trip.from, shown)), to: Boolean(placeNamed(ctx.data.places, trip.to, shown)) };
      const a = understood(trip, mine);
      think.replaceWith(a);
      a.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    } finally {
      bar.busy(false);
    }
  }
}
