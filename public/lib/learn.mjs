// 建議's guesses of a place (回家, 去公司 / 去學校, 常在這時候去) learn from
// what's done with them, on the family's one engine (the kit's feedback.mjs,
// kept on the Pass as `fb:transit`): each card of a place drawn (home.mjs)
// and each trip planned anywhere (tab-map.mjs). A card shown and no trip
// planned there that day sinks; one gone to rises (suggest.mjs `fb`).
// An older kit without it: the cards as before, nothing learnt.
import { placeItem } from './suggest.mjs';

let fb = null;
const ready = import('#kit/feedback.mjs').then(m => (fb = m)).catch(() => null);
export const keepLearning = q => ready.then(m => m?.keep?.(q, 'transit'));
export const cardsShown = (places, now = Date.now()) => places.length && fb?.shown?.('transit', places.map(p => placeItem(p, now)), now);
export const wentTo = (p, now = Date.now()) => p?.lat != null && fb?.picked?.('transit', placeItem(p, now), now, { from: 'elsewhere' });
// item → the chance a card of it is gone to, or null (nothing to go on).
export const placeChance = (now = Date.now()) => fb?.chance?.('transit', now) || null;
