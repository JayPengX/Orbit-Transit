// Transit's own places and saved trips, told to the family's notebook on this
// phone (the kit's family.mjs: one origin, so every app reads it; Weather's
// 下雨改搭公車 card reads them; Jay 2026-11-10, the family's links). Only
// when they changed since the last time told; on an older kit without the
// notebook, nothing (read with a dynamic import, never by name).
//   trips: [{ name, from: { lat, lon, name } | null (where you are then), to }]
//   places: home, school, work (a place saved with that icon), each { lat, lon, name }

const end = p => ({ lat: p.lat, lon: p.lon, name: p.name || '' });
const KINDS = ['home', 'school', 'work'];
let told = '';

export function familyOf(data) {
  const trips = (data?.trips || []).filter(t => t?.to).map(t => ({ name: t.name || t.to.name || '', from: t.from ? end(t.from) : null, to: end(t.to) }));
  const places = {};
  for (const k of KINDS) {
    const p = (data?.places || []).find(x => x?.icon === k);
    if (p) places[k] = end(p);
  }
  return { trips, places };
}

// → a promise of whether it was told (false: nothing new, or no notebook here).
export function shareFamily(data, load = () => import('#kit/family.mjs')) {
  const now = familyOf(data);
  const sig = JSON.stringify(now);
  if (sig === told) return Promise.resolve(false);
  told = sig;
  return load()
    .then(f => {
      if (typeof f?.tell !== 'function') return false;
      f.tell('transit', 'trips', now.trips);
      for (const [k, p] of Object.entries(now.places)) f.setPlace?.(k, p, 'transit');
      return true;
    })
    .catch(() => {
      told = '';
      return false;
    });
}
