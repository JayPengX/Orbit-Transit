// 這班為什麼慢 (the family's AI plan; code only, framed by the Orbit AI mark):
// a late 台鐵 train you pinned, its delay said with what's known now: where the
// train is (台鐵's live board), when it reaches your station at this delay, and
// 台鐵's notices on its way today. Never a guess at a cause no notice gives.

import { W } from '#kit/lang.mjs';

const MIN = 60_000;
const hm = t => new Date(t + 8 * 3_600_000).toISOString().slice(11, 16);
const firstLine = s => String(s || '').split(/\n/).map(x => x.trim()).filter(Boolean)[0] || '';

// 台鐵's alerts (TDX v3 TRA Alert) as [{ id, title, text, url, stations: Set | null (everywhere) }], those on now.
export function traAlertsNow(j, now = Date.now()) {
  const list = Array.isArray(j?.Alerts) ? j.Alerts : Array.isArray(j) ? j : [];
  return list
    .filter(a => Number(a.Status) !== 1 && (a.Title || a.Description))
    .filter(a => (Date.parse(a.StartTime) || 0) - 6 * 3_600_000 <= now && now <= (Date.parse(a.EndTime) || Infinity))
    .map(a => {
      const ids = (a.Scope?.Stations || []).map(s => String(s.StationID || '')).filter(Boolean);
      return { id: a.AlertID || a.Title, title: String(a.Title || '').trim(), text: String(a.Description || '').trim(), url: a.AlertURL || '', stations: ids.length ? new Set(ids) : null };
    });
}

// The ones on a train's way: a station of its own named, or the whole network's.
export const alertsOn = (alerts, stops = []) => {
  const ids = new Set(stops.map(s => String(s).replace(/^tra:/, '')));
  return (alerts || []).filter(a => !a.stations || [...a.stations].some(id => ids.has(id)));
};

const WHERE = [W('快到', 'Nearing'), W('停靠中', 'At'), W('剛離開', 'Just left')];

// The answer drawn (kit aiAnswer's spec): { line, sections }.
//   label 自強 162, delay minutes, arr (at your station, as timetabled), toName,
//   pos { name, status } (traTrain's) or null, alerts on its way.
export function slowSpec({ label, delay, arr, toName, pos, alerts = [] }, glyphs = {}) {
  const rows = [];
  if (pos?.name) rows.push({ lead: { glyph: glyphs.train || '', color: 'var(--q-blue)' }, label: W('現在在', 'Now at'), sub: WHERE[pos.status] || '', value: pos.name });
  if (delay > 0) rows.push({ lead: { glyph: glyphs.clock || '', color: 'var(--q-orange)' }, label: W('誤點', 'Late by'), value: W(`${delay} 分`, `${delay} min`), on: true });
  if (arr && toName && delay > 0) rows.push({ lead: { glyph: glyphs.flag || '', color: 'var(--q-red)' }, label: W(`到${toName}`, `At ${toName}`), sub: W(`原本 ${hm(arr)}`, `due ${hm(arr)}`), value: hm(arr + delay * MIN) });
  const notes = alerts.slice(0, 3).map(a => ({ lead: { glyph: glyphs.bell || '', color: 'var(--q-red)' }, label: a.title || firstLine(a.text), sub: a.title ? firstLine(a.text) : '', ...(a.url ? { href: a.url, external: true } : {}) }));
  const line = !(delay > 0)
    ? W(`${label} 現在準點。`, `${label} is on time now.`)
    : alerts.length
    ? W(`${label} 晚 ${delay} 分，台鐵今天在這條路上有公告。`, `${label} is ${delay} min late; TRA has a notice on its way today.`)
    : W(`${label} 晚 ${delay} 分；台鐵今天沒有這段路的公告。`, `${label} is ${delay} min late; TRA has no notice on its way today.`);
  return { line, sections: [{ rows }, ...(notes.length ? [{ title: W('台鐵公告', 'TRA notices'), rows: notes }] : [])] };
}
