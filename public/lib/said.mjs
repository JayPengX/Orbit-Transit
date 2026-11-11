// 用說的查路線 (the family's AI plan, Jay 11-10; code first): a trip said
// in your own words ("明天八點前到台大醫院", "從家去學校"). Code reads the
// plain ones itself (`readSaid`: 從 X 到 Y, 去 Y, no time); only a sentence
// with a time in it goes to the Worker's AI (Orbit-Core 'transit-say'),
// which names the two places as written and the day and time. Code then
// turns the day and time into the moment (`whenOf`) and each place into a
// point: one of your places by its name (`placeNamed`), else the place
// search opened with the words in it, the right one a tap away.

const TW = 8 * 3_600_000;
const norm = s =>
  String(s || '')
    .replace(/台/g, '臺')
    .replace(/\s+/g, '')
    .toLowerCase();
// Words that say a time: those go to the AI.
const TIMEY = /\d|[一二三四五六七八九十兩]點|點|早上|上午|中午|下午|晚上|今天|明天|後天|週|星期|禮拜|前到|之前|以前|出發|抵達|分鐘|半/;
const HERE = /^(這裡|這邊|我這|現在位置|目前位置|我的位置|here)$/i;

// A plain trip in code: { from, to } (from '' = where you are), else null.
export function readSaid(text) {
  const t = String(text || '').trim().replace(/[。！？!?]+$/, '');
  if (!t || TIMEY.test(t)) return null;
  const m = /^(?:我)?(?:要|想)?(?:從(.+?))?(?:到|去|回)(.+)$/.exec(t);
  if (!m) return null;
  const from = (m[1] || '').trim();
  const to = m[2].trim();
  if (!to || to.length > 30 || from.length > 30) return null;
  return { from: HERE.test(from) ? '' : from, to };
}

// One of your places by the name said (家, 學校, 公司 or its own name), or null.
export function placeNamed(places, name, nameIn = x => x) {
  const n = norm(name);
  if (!n) return null;
  return (places || []).find(p => norm(p.name) === n || norm(nameIn(p.name)) === n) || null;
}

// The AI's day (0 today, 1 tomorrow…) and time ('08:00') as a moment, Taiwan's clock; by 'now' none.
export function whenOf({ by = 'now', day = 0, time = '' } = {}, now = Date.now()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  const d = new Date(now + TW);
  // (A later day with no time, 明天去台中: that day, leaving at this hour, or 08:00 at night.)
  if (!m && Number(day) > 0) {
    const h = d.getUTCHours();
    const at = h >= 6 && h < 22 ? now + Number(day) * 86_400_000 : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + Number(day) + (h < 6 ? -1 : 0), 8, 0) - TW;
    return { by: 'depart', at };
  }
  if (by === 'now' || !m) return { by: 'now', at: null };
  let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (Number(day) || 0), Number(m[1]), Number(m[2])) - TW;
  // (A time already past today, with no day said: the next one, as a person means it.)
  if (!day && at < now - 10 * 60_000) at += 86_400_000;
  return { by: by === 'arrive' ? 'arrive' : 'depart', at };
}

// The facts the AI is told: the clock now and the names of your places.
export function saidFacts(now = Date.now(), places = [], nameIn = x => x) {
  const d = new Date(now + TW);
  const day = ['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()];
  return { now: `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} 週${day}`, places: (places || []).map(p => nameIn(p.name)).filter(Boolean).slice(0, 12) };
}
