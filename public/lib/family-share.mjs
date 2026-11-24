// Transit's own places told to the family's notebook on this phone (the
// kit's family.mjs: one origin, so every app reads them: Class's 怎麼去學校,
// Weather's places; Jay 2026-11-10, the family's links). Only when they
// changed since the last time told (read with a dynamic import).
//   places: home, school, work (a place saved with that icon), each { lat, lon, name }

const end = p => ({ lat: p.lat, lon: p.lon, name: p.name || '' });
const KINDS = ['home', 'school', 'work'];
let told = '';

export function familyOf(data) {
  const places = {};
  for (const k of KINDS) {
    const p = (data?.places || []).find(x => x?.icon === k);
    if (p) places[k] = end(p);
  }
  return { places };
}

// → a promise of whether it was told (false: nothing new, or no notebook here).
export function shareFamily(data, load = () => import('#kit/family.mjs')) {
  const now = familyOf(data);
  const sig = JSON.stringify(now);
  if (sig === told) return Promise.resolve(false);
  told = sig;
  return load()
    .then(f => {
      if (typeof f?.setPlace !== 'function') return false;
      for (const [k, p] of Object.entries(now.places)) f.setPlace(k, p, 'transit');
      // (One deleted here, or its icon changed, let go too, if it was
      // Transit's: Class and Weather went on using the old 家 or 學校.)
      for (const k of KINDS) if (!now.places[k] && f.placeFor?.(k)?.from === 'transit') f.tell?.('place', k, null);
      return true;
    })
    .catch(() => {
      told = '';
      return false;
    });
}
