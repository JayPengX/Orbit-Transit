// ---- book.mjs ----
// 高鐵訂票: a 高鐵 ride's booking on 高鐵's own site, the trip filled in
// (stations, day, train): the proxy's /transit/book asks TDX's 訂票導訂 for a
// link (Jay's key, approved 2026-11-10; 臺鐵's pending) at the tap, as each
// lasts a few minutes. Orbit sells nothing: the person books and pays there.
import { bookLink } from './api.mjs';
import { railStations } from './raildata.mjs';
import { icon } from './ui.mjs';
import { e, hm, tw, meters } from './util.mjs';
import { W } from '#kit/lang.mjs';

// A ride that can be booked: 高鐵 with its train's number, not left yet.
export const canBook = l => l?.mode === 'hsr' && /^\d{1,4}$/.test(String(l.train?.no ?? l.no ?? '')) && (l.dep || 0) > Date.now() - 60_000;
// (A ride's as its button's data: what openBooking needs.)
export const bookOf = l => ({ from: l.from, to: l.to, dep: l.dep, no: l.train?.no ?? l.no });
// Its button: a quiet pill beside the ride (the step's own, as 地圖 beside a walk).
export const bookHtml = (l, cls = 'ot-step-gm') => `<span class="${cls}" role="button" data-book="${e(JSON.stringify(bookOf(l)))}">${icon('ticket')}${W('高鐵訂票', 'Book on THSR')}</span>`;

// A station's 高鐵 name: its own (by name), else the 高鐵 station within 1 km of where it is.
async function hsrName(pt) {
  if (typeof pt === 'string') return pt;
  if (pt?.lat == null) return pt?.name || '';
  const sts = await railStations().catch(() => []);
  const near = sts.filter(s => s.sys === 'hsr').map(s => ({ s, d: meters(pt.lat, pt.lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d)[0];
  return near && near.d < 1000 ? near.s.name : pt.name || '';
}

// Opens 高鐵's booking for a ride ({ from, to, dep, no }: names or places).
// The window opens at the tap (a phone lets only a tap open one), the link
// put in it when it comes. → true when opened.
export async function openBooking({ from, to, dep, no }, say = () => {}) {
  const w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  if (w) w.opener = null;
  try {
    const [a, b] = await Promise.all([hsrName(from), hsrName(to)]);
    const { url } = await bookLink({ from: a, to: b, date: tw(dep).date, time: hm(dep), no: String(no) });
    if (!/^https?:\/\//.test(url || '')) throw new Error('no link');
    if (w) w.location.href = url;
    else location.href = url;
    return true;
  } catch {
    w?.close();
    say(W('高鐵訂票暫時打不開，稍後再試', 'THSR booking isn’t opening; try again later'));
    return false;
  }
}
