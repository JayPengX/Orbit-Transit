// Buying a ticket for a train you found: the operator's app (or its booking
// site), with the train, date and stations copied to paste in there.
// 台鐵 only. Neither operator has a link that opens a train or fills its form
// (台鐵's booking page posts a token and a reCAPTCHA). What opens:
//   台鐵e訂通  railway.gov.tw's own app link (its apple-app-site-association
//              lists /tra-tip-web/tip/applink for tw.gov.tra.twtraffic): the app
// 高鐵 has none (thsrc.com.tw serves no apple-app-site-association; T Express
// could only be reached through its App Store page, and its booking site
// opens blank in a home-screen app), so it has no 訂票 here (the owner,
// 2026-10-14: a link that doesn't work goes).
const IOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
export const BOOK = {
  tra: 'https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip121/query'
};
export const APP = {
  tra: 'https://www.railway.gov.tw/tra-tip-web/tip/applink'
};
// Whether a train of this system has a 訂票 that works.
export const canBook = sys => sys in BOOK;
export const bookUrl = (sys, ios = IOS()) => (canBook(sys) ? (ios ? APP[sys] : BOOK[sys]) : null);

// { sys: 'tra', no, date ('YYYY-MM-DD'), dep ('HH:MM'), from, to }.
export const ticketText = t => `台鐵 ${t.no} 次 · ${t.date.slice(5).replace('-', '/')} ${t.dep} · ${t.from} → ${t.to}`;

export function buyTicket(t, status = () => {}) {
  if (!canBook(t.sys)) return;
  const text = ticketText(t);
  // Both inside the tap (Safari opens a page, and copies, only then).
  try {
    navigator.clipboard?.writeText(text).catch(() => {});
  } catch {}
  const url = bookUrl(t.sys);
  if (!url) return;
  window.open(url, '_blank', 'noopener');
  status(IOS() ? `已複製「${text}」，在台鐵e訂通照著訂` : `已複製「${text}」，在訂票頁照著填`);
}
