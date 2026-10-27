// A metro station as the app shows it, on the metro map's sheet and the
// map's card alike: its line codes in their colours (BL12, R10), the next
// trains each way counting down (live minutes where the operator sends
// them), the day's first and last trains, and its exits.

import { loadSystem, stationBoard, stationExits, stationTitle, interchanges, OPERATORS } from './metro.mjs';
import { metroSystems } from './raildata.mjs';
import { countHtml, rowCard, emptyNote } from './look.mjs';
import { icon, inkOn } from './ui.mjs';
import { e, hm, meters, shown } from './util.mjs';
import { W } from '#kit/lang.mjs';

// A station's whole group (台北車站: BL12 and R10), each with its system's lines.
export async function stationGroup(st) {
  const systems = (await metroSystems(st).catch(() => [])).filter(Boolean);
  const all = systems.flatMap(s => s.stations).filter(s => meters(s.lat, s.lon, st.lat, st.lon) < 600);
  const group = interchanges(all, systems.flatMap(s => s.transfers || [])).find(g => g.some(s => s.key === st.key)) || [st];
  return { list: group, lines: await linesOf(group) };
}
// The lines through a group's stations, { key: 'TRTC:BL', sys, id, name, color } each.
export async function linesOf(list) {
  const systems = await Promise.all([...new Set(list.map(s => s.op))].map(op => loadSystem(op).catch(() => null)));
  return systems.filter(Boolean).flatMap(s => s.lines.filter(l => list.some(st => l.seq.includes(st.key))).map(l => ({ ...l, key: `${l.sys}:${l.id}` })));
}
const lineFor = (lines, op, id) => lines.find(l => l.sys === op && l.id === id) || lines.find(l => l.sys === op) || { name: OPERATORS[op] || '', color: '#8e8e93' };

// The line codes as the stations' signs show them: a capsule in the line's colour.
export function codesHtml(list, lines) {
  const seen = new Set();
  return list
    .flatMap(st => {
      const own = lines.filter(l => l.sys === st.op && l.seq.includes(st.key));
      return (own.length ? own : [lineFor(lines, st.op, '')]).map(l => ({ code: st.id, color: l.color, name: l.name }));
    })
    .filter(c => !seen.has(`${c.code}|${c.name}`) && seen.add(`${c.code}|${c.name}`))
    .map(c => `<span class="mm-code" style="--c:${e(c.color)};--ink:${inkOn(c.color)}"><b>${e(c.code)}</b><span>${e(shown(c.name))}</span></span>`)
    .join('');
}

// A group's boards, live and timetable together, and its lines.
export async function loadBoards(list) {
  return Promise.all(list.map(st => stationBoard(st).catch(err => ({ op: st.op, id: st.id, rows: [], firstLast: [], error: err }))));
}

// The next trains each way: a row a line and way, its countdown on the right.
export function boardHtml(boards, lines) {
  if (!boards) return `<div class="q-rowcard mb-board"><div class="q-ritem mb-wait"><span class="q-ritem-text"><span class="q-ritem-title">${W('載入中…', 'Loading…')}</span></span></div></div>`;
  const rows = boards.flatMap(b => b.rows.map(r => ({ ...r, l: lineFor(lines, b.op, r.line) })));
  if (!rows.length) {
    if (boards.every(b => b.none && b.op === 'TMRT')) return emptyNote(W('台中捷運沒有提供即時或時刻資料', 'Taichung Metro shares no live or timetable data'));
    return emptyNote(W('現在沒有列車', 'No trains right now'));
  }
  return rowCard(
    rows
      .map(r => {
        const [first, ...then] = r.times;
        const sub = [r.l.name, r.note || (r.every ? W('依班距行駛', 'Runs every few minutes') : then.length ? W(`再來 ${then.map(hm).join('、')}`, `then ${then.map(hm).join(', ')}`) : '')].filter(Boolean).join(' · ');
        // (A live train at the platform: 進站, as the station's own sign says.)
        const right = r.every ? `<span class="mb-every"><small>${W('每', 'every')}</small>${e(r.every)}<small>${W('分', 'min')}</small></span>` : first == null ? `<span class="mb-none">—</span>` : r.live && first - Date.now() < 45_000 ? `<strong class="mb-count mb-now">${W('進站', 'Due')}</strong>` : countHtml(first, { floor: true, cls: 'mb-count' });
        return `<div class="q-ritem mb-row" style="--c:${e(r.l.color)}"><span class="mb-bar" aria-hidden="true"></span><span class="q-ritem-text"><span class="q-ritem-title">${r.dest ? `${W('往', 'To')} ${e(shown(r.dest))}` : e(r.l.name)}</span><small>${e(sub)}</small></span>${r.live ? `<span class="mb-live" title="${W('即時', 'Live')}">${icon('live')}</span>` : ''}${right}</div>`;
      })
      .join('')
  ).replace('q-rowcard', 'q-rowcard mb-board');
}

// The day's first and last trains, a row a line and way.
export function firstLastHtml(boards, lines) {
  const rows = (boards || []).flatMap(b => b.firstLast.map(r => ({ ...r, l: lineFor(lines, b.op, r.line) })));
  if (!rows.length) return '';
  return `<h3 class="q-sheet-h">${W('首末班車', 'First and last trains')}</h3>${rowCard(
    rows
      .map(r => `<div class="q-ritem mb-row" style="--c:${e(r.l.color)}"><span class="mb-bar" aria-hidden="true"></span><span class="q-ritem-text"><span class="q-ritem-title">${r.dest ? `${W('往', 'To')} ${e(shown(r.dest))}` : e(r.l.name)}</span><small>${e(shown(r.l.name))}</small></span><span class="mb-fl"><span><small>${W('首班', 'First')}</small><b>${e(hm(r.first))}</b></span><span><small>${W('末班', 'Last')}</small><b>${e(hm(r.last))}</b></span></span></div>`)
      .join('')
  )}`;
}

// The exits: one row each, with a lift or escalator said.
export async function exitsHtml(list) {
  const all = (await Promise.all(list.map(st => stationExits(st).catch(() => [])))).flat();
  const seen = new Set();
  const exits = all.filter(x => !seen.has(x.id) && seen.add(x.id));
  return { count: exits.length, lifts: exits.filter(x => x.lift).length, html: exits.length ? rowCard(exits.map(x => `<div class="q-ritem mb-exit"><span class="mb-exit-no">${e(x.id)}</span><span class="q-ritem-text"><span class="q-ritem-title">${e(x.desc || W(`${x.id} 號出口`, `Exit ${x.id}`))}</span>${x.lift || x.escalator ? `<small>${[x.lift ? W('電梯', 'Lift') : '', x.escalator ? W('電扶梯', 'Escalator') : ''].filter(Boolean).join(' · ')}</small>` : ''}</span></div>`).join('')) : '' };
}

export { stationTitle };
