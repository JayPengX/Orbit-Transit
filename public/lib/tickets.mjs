// Buying a ticket for a train you found: the operator's app (or its booking
// site), with the train, date and stations copied to paste in there.
// Neither operator has a link that opens a train or fills its form (台鐵's
// booking page posts a token and a reCAPTCHA; 高鐵's is the same, and in a
// home-screen app it opens blank). What does open:
//   台鐵e訂通  railway.gov.tw's own app link (its apple-app-site-association
//              lists /tra-tip-web/tip/applink): the app itself
//   T Express  no app link at all: its App Store page, whose 打開 goes
//              straight into the app (or installs it)
const IOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
export const BOOK = {
  hsr: 'https://irs.thsrc.com.tw/IMINT/?locale=tw',
  tra: 'https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip121/query'
};
export const APP = {
  hsr: 'https://apps.apple.com/tw/app/id468963664',
  tra: 'https://www.railway.gov.tw/tra-tip-web/tip/applink'
};
export const bookUrl = (sys, ios = IOS()) => (ios ? APP[sys] : BOOK[sys]);

// { sys: 'tra' | 'hsr', no, date ('YYYY-MM-DD'), dep ('HH:MM'), from, to }.
export const ticketText = t => `${t.sys === 'hsr' ? '高鐵' : '台鐵'} ${t.no} 次 · ${t.date.slice(5).replace('-', '/')} ${t.dep} · ${t.from} → ${t.to}`;

export function buyTicket(t, status = () => {}) {
  const text = ticketText(t);
  // Both inside the tap (Safari opens a page, and copies, only then).
  try {
    navigator.clipboard?.writeText(text).catch(() => {});
  } catch {}
  window.open(bookUrl(t.sys), '_blank', 'noopener');
  status(IOS() ? `已複製「${text}」，在${t.sys === 'hsr' ? ' T Express（App Store 點「打開」）' : '台鐵e訂通'}照著訂` : `已複製「${text}」，在訂票頁照著填`);
}
