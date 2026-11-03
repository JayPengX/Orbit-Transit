// 建議: what the map's sheet puts first, worked out from what the app knows
// already (the saved trips and their times, the pinned buses and trains, the
// YouBike stations around you, your places). Pure: the caller reads the
// pieces (tab-go's tripNow, the pinned buses' times…) and hands them in, this
// ranks them, so what comes first is one rule that a test can hold.
//
// Every candidate gets a score (about 0–120) from how soon it matters:
//   trip   a saved trip that fits now (its leave time, today if it recurs)
//   bus    a pinned bus on its way (live), nearer you counts more
//   train  a pinned train or connection leaving soon
//   bike   the nearest YouBike with a bike, when you're close to it
//   home   「回家」 when you're far from 家 in the evening
//   go     「去公司」「去學校」 on a working day's morning, at 家, from the
//          places pinned: a first week's guess before there's any history
//   usual  常去: a place the person often plans a trip to at about this
//          hour on this kind of day (最近's times, usualTrip), when not there
// The best three, at most one of a kind (two saved trips may both fit).
//
// The guesses of a place (home, go, usual) learn from what's done with them
// (the kit's feedback.mjs, by the place, `fb`): a card shown and no trip
// planned there that day sinks, one gone to rises; ignored day after day
// (回家 to one who never plans the way home) it stops coming.

import { meters, tw, workday, holidayOn } from './util.mjs';

export const MAX_SUGGESTIONS = 3;
// A trip is news from this long before it's due to this long after.
const TRIP_AHEAD_MIN = 180;
const TRIP_LATE_MIN = 10;
const BUS_WITHIN_MIN = 30;
const TRAIN_WITHIN_MIN = 90;
// A bike is worth a card when the station is this close, and a card of its own while a bike is there.
const BIKE_NEAR_M = 450;
// 家 is "far" past this, and the evening is from 17:00 until 23:30.
export const FAR_HOME_M = 1500;
const EVENING = [17 * 60, 23 * 60 + 30];
// A trip's end this near 家 is the way home already (no second card for it).
const SAME_PLACE_M = 300;

const minutesTo = (at, now) => (at - now) / 60_000;

// A saved trip: soonest first, a recurring one on its day ahead of the rest.
export function tripScore(m, { recurring = false, today = false } = {}) {
  if (m == null || !Number.isFinite(m)) return 0;
  if (m < -TRIP_LATE_MIN || m > TRIP_AHEAD_MIN) return 0;
  const urgency = m <= 0 ? 100 : 100 - m * 0.35;
  return urgency + (recurring && today ? 12 : 0);
}
// A pinned bus on its way: due in the next half hour; one at a stop you're near, or far from, moves.
export function busScore(m, d = null) {
  if (m == null || !Number.isFinite(m) || m < -0.5 || m > BUS_WITHIN_MIN) return 0;
  let s = 80 - m * 1.5;
  if (d != null) s += d <= 600 ? 15 : d > 2500 ? -35 : 0;
  return Math.max(0, s);
}
export function trainScore(m) {
  if (m == null || !Number.isFinite(m) || m < -1 || m > TRAIN_WITHIN_MIN) return 0;
  return 72 - m * 0.55;
}
// The nearest station with a bike, close by: nearer is higher; many bikes a little.
export function bikeScore(b) {
  if (!b || b.ok === false || (b.bikes || 0) + (b.ebike || 0) <= 0 || b.d == null || b.d > BIKE_NEAR_M) return 0;
  return 66 - b.d / 25 + Math.min(b.bikes + (b.ebike || 0), 10) * 0.4;
}
// 回家: in the evening, far from 家.
export function homeScore(d, min) {
  if (d == null || d <= FAR_HOME_M || min < EVENING[0] || min >= EVENING[1]) return 0;
  return 88;
}

// 常去: of the places trips were planned to (最近, each with its times
// `ts`), the one this moment is most like: each time counts by how near its
// hour is (a Gaussian, an hour wide), the same kind of day (a working day or
// a day off, on Taiwan's calendar: a holiday is a day off, a 補班 Saturday a
// working day) and how recent (a month's half-life). It needs three trips
// there and most of the weight of now: { place, w, share } or null.
const HOUR_MIN = 60;
const HALF_DAYS = 30;
export function usualTrip(recents = [], now = Date.now(), here = null) {
  const at = tw(now);
  const days = new Map();
  const work = date => (days.has(date) ? days.get(date) : days.set(date, workday(date)).get(date));
  let all = 0;
  const scored = recents.map(p => {
    let w = 0;
    for (const t of p.ts || []) {
      const x = tw(t);
      const gap = Math.abs(x.min - at.min);
      const m = Math.min(gap, 1440 - gap);
      const age = (now - t) / 86_400_000;
      w += Math.exp(-((m / HOUR_MIN) ** 2) / 2) * (work(x.date) === work(at.date) ? 1 : 0.1) * 0.5 ** (age / HALF_DAYS);
    }
    all += w;
    return { place: p, w, n: (p.ts || []).length };
  });
  const best = scored.filter(x => x.n >= 3 && !(here && meters(here.lat, here.lon, x.place.lat, x.place.lon) < SAME_PLACE_M)).sort((a, b) => b.w - a.w)[0];
  if (!best || best.w < 1.2 || best.w / all < 0.4) return null;
  return { place: best.place, w: best.w, share: best.w / all };
}
export function usualScore(u) {
  return u ? 58 + 20 * Math.min(1, u.share) + 4 * Math.min(3, u.w - 1.2) : 0;
}

// 去公司 / 去學校: a working day's morning (06:00 to 09:30), at 家 (or with no
// 家 pinned, anywhere not there), the place not off for a typhoon: below a
// saved trip, a bus on its way, a pinned train within ten minutes and 回家.
const MORNING = [6 * 60, 9 * 60 + 30];
export function goScore(place, here, now, home = null) {
  if (!place || !here) return 0;
  const at = tw(now);
  if (at.min < MORNING[0] || at.min >= MORNING[1] || !workday(at.date)) return 0;
  if (meters(here.lat, here.lon, place.lat, place.lon) <= FAR_HOME_M) return 0;
  if (home && meters(here.lat, here.lon, home.lat, home.lon) > FAR_HOME_M) return 0;
  if (holidayOn(at.date, { name: place.name, to: place })) return 0;
  return 65;
}

// A place guessed, as the kit's feedback.mjs knows it: by the place, and the
// place on that day of the week (補習班 on Tuesdays and Thursdays only), one look a day.
const placeKey = p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
const placeKeys = (p, now) => [`to:${placeKey(p)}`, `to:${placeKey(p)}@${tw(now).dow}`];
export const placeItem = (p, now = Date.now()) => ({ id: `to:${placeKey(p)}:${tw(now).date}`, keys: placeKeys(p, now) });
// What's been done with a place's cards: `fb` (feedback.mjs chance) the
// chance a card of it is gone to (0.2 with nothing known); a point of score
// for every 2% over or under that, and under DROP, passed over too often to show.
const LEARNT = 50;
const USUAL_P = 0.2;
const DROP = 0.16;
const learnt = (fb, p, now) => (fb && p?.lat != null ? fb({ keys: placeKeys(p, now) }) : null);

// → [{ kind, key, score, ...the candidate }], best first.
export function suggest({ now = Date.now(), here = null, places = [], trips = [], buses = [], trains = [], bikes = [], recents = [], fb = null } = {}) {
  const out = [];
  for (const t of trips) {
    const m = t.leaveAt == null ? null : minutesTo(t.leaveAt, now);
    const score = tripScore(m, t);
    if (score > 0) out.push({ ...t, kind: 'trip', key: `trip:${t.id}`, score, minutes: m });
  }
  for (const b of buses) {
    const m = b.at == null || b.live === false ? null : minutesTo(b.at, now);
    const score = busScore(m, b.d ?? null);
    if (score > 0) out.push({ ...b, kind: 'bus', key: `bus:${b.id}`, score, minutes: m });
  }
  for (const t of trains) {
    const m = t.dep == null ? null : minutesTo(t.dep, now);
    const score = trainScore(m);
    if (score > 0) out.push({ ...t, kind: 'train', key: `train:${t.id}`, score, minutes: m });
  }
  const bike = bikes.map(b => ({ b, s: bikeScore(b) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0];
  if (bike) out.push({ ...bike.b, kind: 'bike', key: `bike:${bike.b.uid}`, score: bike.s });
  const home = places.find(p => p.icon === 'home');
  if (home && here) {
    const d = meters(here.lat, here.lon, home.lat, home.lon);
    const score = homeScore(d, tw(now).min);
    // (A saved trip that ends at 家 is the way home already.)
    const covered = out.some(x => x.kind === 'trip' && x.to?.lat != null && meters(x.to.lat, x.to.lon, home.lat, home.lon) < SAME_PLACE_M);
    if (score > 0 && !covered) out.push({ kind: 'home', key: `home:${home.id}`, score, place: home, d });
  }
  // (A saved trip or 回家 to that place is it already.)
  const there = (to, kinds) => out.some(x => kinds.includes(x.kind) && (x.kind === 'trip' ? x.to : x.place)?.lat != null && meters((x.to || x.place).lat, (x.to || x.place).lon, to.lat, to.lon) < SAME_PLACE_M);
  const usual = usualTrip(recents, now, here);
  const to = usual?.place;
  if (to && !there(to, ['trip', 'home'])) {
    out.push({ kind: 'usual', key: `usual:${to.lat},${to.lon}`, score: usualScore(usual), place: to });
    // (Somewhere else is where they usually go now, 補習班 before home: not 回家 yet.)
    const h = out.findIndex(x => x.kind === 'home');
    if (h >= 0) out.splice(h, 1);
  }
  // (公司 first, then 學校; none when a saved trip or 常去 goes there already.)
  const go = ['work', 'school'].map(k => places.find(p => p.icon === k)).find(p => p && goScore(p, here, now, home) > 0);
  if (go && !there(go, ['trip', 'usual'])) out.push({ kind: 'go', key: `go:${go.id}`, score: goScore(go, here, now, home), place: go, d: meters(here.lat, here.lon, go.lat, go.lon) });
  // What's been done with each guess of a place: gone to rises, passed over sinks, and too often passed over goes.
  for (let i = out.length - 1; i >= 0; i--) {
    const x = out[i];
    if (!['home', 'go', 'usual'].includes(x.kind)) continue;
    const p = learnt(fb, x.place, now);
    if (p == null || !Number.isFinite(p)) continue;
    if (p < DROP) out.splice(i, 1);
    else x.score += Math.max(-10, Math.min(10, LEARNT * (p - USUAL_P)));
  }
  out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  // One of each kind but trips (the morning's and the evening's may both be due).
  const seen = new Map();
  const picked = [];
  for (const x of out) {
    const n = seen.get(x.kind) || 0;
    if (n >= (x.kind === 'trip' ? 2 : 1)) continue;
    seen.set(x.kind, n + 1);
    picked.push(x);
    if (picked.length >= MAX_SUGGESTIONS) break;
  }
  return picked;
}
