// Another app's way into a trip (Jay 2026-11-10: Sports' 去球場, Class's
// 出門時間, Money's 車資記帳 to come): a link to Transit with
//   #plan?to=<lat>,<lon>,<name>[&by=<ISO time>]
// opens 規劃 from where you are to there, arriving by that time when one is
// given (a game's start, a first class). The name may itself hold commas;
// encode the whole value (encodeURIComponent) or just the name.
// → { to: { name, lat, lon }, at } (at: ms, or null) or null when it isn't one.

export function planLink(hash) {
  const m = /^#plan\?(.*)$/.exec(String(hash || ''));
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const [lat, lon, ...rest] = String(q.get('to') || '').split(',');
  const y = Number(lat);
  const x = Number(lon);
  // (Taiwan and around it only: a place anywhere else isn't a trip here.)
  if (!Number.isFinite(y) || !Number.isFinite(x) || y < 20 || y > 27.5 || x < 116 || x > 123) return null;
  let name = rest.join(',').trim();
  try {
    name = decodeURIComponent(name);
  } catch {}
  const at = q.get('by') ? Date.parse(q.get('by')) : NaN;
  return { to: { name: name.slice(0, 60) || `${y.toFixed(4)}, ${x.toFixed(4)}`, lat: y, lon: x }, at: Number.isFinite(at) ? at : null };
}

// The link itself, for an app making one (the hash only: on the family's one origin, `/transit/` + it).
export function planHash({ lat, lon, name = '' }, at = null) {
  const by = at != null && Number.isFinite(new Date(at).getTime()) ? `&by=${encodeURIComponent(new Date(at).toISOString())}` : '';
  return `#plan?to=${Number(lat).toFixed(6)},${Number(lon).toFixed(6)},${encodeURIComponent(String(name))}${by}`;
}
