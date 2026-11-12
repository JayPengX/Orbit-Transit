// 出狀況: one card for whatever goes wrong under way (Jay 2026-11-06: "we
// never really design flow to deal with if you can't catch a bus or you go on
// the wrong bus … the features is spread everywhere"; "not limited to bus").
//
//   miss   the bus, train or metro ahead can't be made (or it's gone): two
//          ways on, each with when you're there: 下一班 (the same line's next
//          run, from the same stop) and 最快 (the quickest way from where you
//          are, planned afresh, never a YouBike to a stop further on).
//          Navigation takes the next run by itself once the one planned is
//          gone (the usual rules); 最快 is a tap.
//   late   to be there by a time, and this way gets in late: 最快 offered.
//   bike   no bike to take (or dock to leave it) within 500 m: 最快 offered.
//   wrong  on a bus or train that isn't the one planned (moving at a ride's
//          pace away from the stop and off its way, or on board and off its
//          way at speed): 從這裡重新規劃 (planned from the ride you're on).
//   off    on board, off its way at a walk: got off already?
//   lost   heading away from all of the plan.
//
// The card shows once it's whole (the next run and 最快 both found), then
// only its times move (Jay 2026-11-06: "the first show is the final result").
// Steps still move on only by where you are (GPS), never by a tap here.

import { icon } from './ui.mjs';
import { e, hm, meters, isRide, rides } from './util.mjs';
import { motion, busPace, trainPace } from './aboard.mjs';
import { W } from '#kit/lang.mjs';

// The quickest of the ways planned from where you are: there first, leaving
// no sooner than now (a minute's grace), none set aside. Not when it is the
// very run 下一班 already is (the same line from the same stop at about the
// same time): then 下一班 is the quickest, and said alone. `next`: { leg, dep }.
export function fastest(plans, next = null, now = Date.now()) {
  const ok = (plans || []).filter(p => p && p.lead !== false && !p.weak && p.dep >= now - 60_000 && p.arr > now);
  const best = ok.sort((a, b) => a.arr - b.arr)[0] || null;
  if (!best || !next?.leg) return best;
  const first = best.legs.find(isRide);
  const l = next.leg;
  const same = first && (first.short || first.name) === (l.short || l.name) && first.from?.lat != null && l.from?.lat != null && meters(first.from.lat, first.from.lon, l.from.lat, l.from.lon) < 200 && Math.abs(first.dep - next.dep) < 3 * 60_000;
  return same ? null : best;
}

// What 最快 does, short enough for a 320 screen beside its time (Jay's
// 320 rule): its first ride's name (區間 1718, 2), else YouBike, else 走路.
export function bestText(p) {
  const r = rides(p)[0];
  if (r) return String(r.short || r.name || '').trim();
  if (p.legs.some(l => l.mode === 'bike')) return p.legs.some(l => l.ebike) ? W('電輔車', 'E-bike') : 'YouBike';
  return W('走路', 'Walk');
}

// The card, as the trip shows it (null: nothing to show yet, or nothing left
// to choose). `t`: { kind, ride, mode, next: { dep, arr, taken }, best,
// mins }; `deadline`: to be there by. Rows: data-nav tr-next, tr-best, replan;
// × is tr-x.
export function troubleHtml(t, now = Date.now(), deadline = 0) {
  if (!t) return '';
  const x = `<button class="x" type="button" data-nav="tr-x" aria-label="${W('不用', 'Dismiss')}">${icon('x')}</button>`;
  // One question, one tap: off its way, got off, heading elsewhere.
  if (t.kind === 'wrong' || t.kind === 'off' || t.kind === 'lost') {
    const q = t.kind === 'wrong' ? W('好像搭錯車了？', 'Wrong one?') : t.kind === 'off' ? W('好像已經下車了？', 'Got off already?') : W('不照這條路走了？', 'Going another way?');
    return `<div class="ot-nav-ask ot-trouble-q" data-trouble="${t.kind}"><span>${q}</span><button type="button" data-nav="replan">${W('從這裡重新規劃', 'Replan from here')}</button>${t.kind === 'wrong' ? x : ''}</div>`;
  }
  // (Not whole yet: shown once it is.)
  if (t.best === undefined) return '';
  const late = arr => deadline && arr > deadline + 60_000;
  const when = arr => `<time class="${late(arr) ? 'bad' : ''}">${late(arr) ? W(`晚 ${Math.ceil((arr - deadline) / 60_000)} 分`, `${Math.ceil((arr - deadline) / 60_000)} min late`) : W(`${hm(arr)} 到`, `in ${hm(arr)}`)}</time>`;
  const rows = [];
  if (t.next) {
    const what = t.mode === 'bus' ? W(`下一班 ${hm(t.next.dep)} 到站`, `Next, due ${hm(t.next.dep)}`) : W(`下一班 ${hm(t.next.dep)} 開`, `Next, ${hm(t.next.dep)}`);
    rows.push(`<button class="ot-trouble-row${t.next.taken ? ' on' : ''}" type="button" data-nav="tr-next">${icon(t.next.taken ? 'check' : t.mode)}<span>${what}</span>${when(t.next.arr)}</button>`);
  }
  if (t.best) rows.push(`<button class="ot-trouble-row best" type="button" data-nav="tr-best">${icon(rides(t.best)[0]?.mode || (t.best.legs.some(l => l.mode === 'bike') ? 'bike' : 'walk'))}<span>${W('最快', 'Fastest')}・${e(bestText(t.best))}</span>${when(t.best.arr)}</button>`);
  // Nothing to choose: 下一班 already taken and nothing quicker (the line above says it).
  // No run to wait for and nothing found: the full replan, one tap.
  if (!t.best && (!t.next || t.next.taken)) return t.next ? '' : `<div class="ot-nav-ask ot-trouble-q" data-trouble="${t.kind}"><span>${titleOf(t)}</span><button type="button" data-nav="replan">${W('重新規劃', 'Replan')}</button>${x}</div>`;
  return `<div class="ot-trouble" data-trouble="${t.kind}"><div class="ot-trouble-h"><b>${titleOf(t)}</b>${x}</div>${rows.join('')}</div>`;
}
const titleOf = t =>
  t.kind === 'miss'
    ? W(`趕不上 ${e(t.ride || '這班')}`, `Can’t make ${e(t.ride || 'it')}`)
    : t.kind === 'late'
      ? W(`這樣會晚 ${t.mins} 分到`, `${t.mins} min late this way`)
      : t.end === 'ret'
        ? W('附近都沒空位', 'No docks nearby')
        : W('附近都沒車', 'No bikes nearby');

// On a bus or train that isn't the plan's, waiting for (or walking to) ride
// `l`: you were at its stop a while ago (`nearAt`: the last time a fix was
// within 150 m of it), and now you're moving at a bus's or train's pace, away
// from the stop and off its way (`onWay`: on the ride's own way, which is
// boarding it). `fixes`: the last minutes' { lat, lon, t }.
export const NEAR_MS = 10 * 60_000;
export function wrongRide(l, fixes, nearAt, onWay, now = Date.now()) {
  if (!isRide(l) || l.from?.lat == null || !nearAt || now - nearAt > NEAR_MS || onWay) return false;
  const m = motion(fixes, now);
  if (busPace(m) || trainPace(m)) return meters(m.lat, m.lon, l.from.lat, l.from.lon) > 400;
  // (Or, after a silence (an iPhone in a pocket says nothing for minutes),
  // further from the stop than walking could take you since: 1 km and more,
  // at 3 m/s and more. Its pace went unseen; Jay 2026-11-12.)
  const p = fixes?.at(-1);
  if (!p || p.t !== now) return false;
  const d = meters(p.lat, p.lon, l.from.lat, l.from.lon) - (p.acc ?? 0);
  return d > 1000 && d / Math.max(1, (now - nearAt) / 1000) >= 3;
}
// On board and off its way: at a ride's pace it's another bus or train (a
// branch, the wrong way), at a walk you got off. → 'wrong' | 'off'.
export const offKind = (fixes, now = Date.now()) => {
  const m = motion(fixes, now);
  return busPace(m) || trainPace(m) ? 'wrong' : 'off';
};
