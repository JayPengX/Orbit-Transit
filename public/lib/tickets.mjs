// Buying a ticket for a train you found: the operator's booking page opens
// (高鐵 T Express's web booking, 台鐵's 訂票), and the train, date and
// stations are copied, to paste or copy in there. (Neither operator offers
// a link that fills its form, nor one that opens its app at a train.)

export const BOOK = {
  hsr: 'https://irs.thsrc.com.tw/IMINT/?locale=tw',
  tra: 'https://tip.railway.gov.tw/tra-tip-web/tip/tip001/tip121/query'
};

// { sys: 'tra' | 'hsr', no, date ('YYYY-MM-DD'), dep ('HH:MM'), from, to }.
export const ticketText = t => `${t.sys === 'hsr' ? '高鐵' : '台鐵'} ${t.no} 次 · ${t.date.slice(5).replace('-', '/')} ${t.dep} · ${t.from} → ${t.to}`;

export function buyTicket(t, status = () => {}) {
  const text = ticketText(t);
  // Both inside the tap (Safari opens a page, and copies, only then).
  try {
    navigator.clipboard?.writeText(text).catch(() => {});
  } catch {}
  window.open(BOOK[t.sys], '_blank', 'noopener');
  status(`已複製「${text}」，在訂票頁照著填`);
}
