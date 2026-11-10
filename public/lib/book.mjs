// ---- book.mjs ----
// 高鐵訂票: a 高鐵 ride's booking on 高鐵's own site, the trip filled in
// (stations, day, train): the proxy's /transit/book asks TDX's 訂票導訂 for a
// link (Jay's key, approved 2026-11-10; 臺鐵's pending) at the tap, as each
// lasts a few minutes. Orbit sells nothing: the person books and pays there.
import { bookLink } from './api.mjs';
import { railStations } from './raildata.mjs';
import { icon, sheet, sheetHead } from './ui.mjs';
import { tile, COLOR } from './look.mjs';
import { e, tw, meters, dayLabel } from './util.mjs';
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

// A ride's two links, asked together: { app, web } (null where the proxy couldn't).
export async function bookWays(trip) {
  const ok = x => (/^https:\/\//.test(x?.url || '') ? x.url : null);
  const [app, web] = await Promise.all([bookLink({ ...trip, app: true }).catch(() => null), bookLink(trip).catch(() => null)]);
  return { app: ok(app), web: ok(web) };
}

// Opens 高鐵's booking for a ride ({ from, to, dep, no }: names or places):
// a small sheet with the ride and two ways, each asked of the proxy at once
// (Jay 2026-11-10: "高鐵導訂 open hsr app if possible"): 高鐵's T Express app
// first (ets.thsrc.com.tw, its universal link: iOS opens the app for a tap
// on the app's own address, so the link is a real one the person taps, never
// a window sent there later), then its website (the way the person chose for
// links: the quick view or the Safari app, kit `linkHref`). → true when a
// way came.
export async function openBooking({ from, to, dep, no }, say = () => {}) {
  const { date, hm: time } = tw(dep);
  const d = sheet(
    `${sheetHead(W(`訂票 · 高鐵 ${e(no)}`, `Book THSR ${e(no)}`), `<span data-ride>${e(`${dayLabel(date)} ${time}`)}</span>`, tile('hsr', COLOR.hsr))}
    <div class="ot-book" aria-live="polite" aria-busy="true"><span class="ot-book-way q-skel"></span><span class="ot-book-way q-skel"></span></div>`,
    'ot-book-sheet'
  );
  try {
    const [a, b] = await Promise.all([hsrName(from), hsrName(to)]);
    d.querySelector('[data-ride]').textContent = `${a} → ${b} · ${d.querySelector('[data-ride]').textContent}`;
    const { app: appUrl, web: webUrl } = await bookWays({ from: a, to: b, date, time, no: String(no) });
    if (!appUrl && !webUrl) throw new Error('no link');
    // Two even cards, the app's first: a tile, what it is, whose.
    const way = (url, glyph, label, sub, own = '') => `<a class="ot-book-way" href="${e(url)}" target="_blank" rel="noopener"${own}>${tile(glyph, COLOR.hsr)}<b>${label}</b><small>${sub}</small></a>`;
    const box = d.querySelector('.ot-book');
    box.innerHTML = [appUrl ? way(appUrl, 'ticket', W('高鐵 App', 'THSR app'), 'T Express', ' data-q-quick') : '', webUrl ? way(webUrl, 'globe', W('高鐵網站', 'THSR website'), W('官網訂票', 'Book online')) : ''].join('');
    box.removeAttribute('aria-busy');
    // (Each link lasts minutes: the sheet goes once one is used.)
    d.querySelector('.ot-book').addEventListener('click', ev => ev.target.closest('a[href]') && setTimeout(() => d.shut?.(), 400));
    return true;
  } catch {
    d.shut?.();
    say(W('高鐵訂票暫時打不開，稍後再試', 'THSR booking isn’t opening; try again later'));
    return false;
  }
}
