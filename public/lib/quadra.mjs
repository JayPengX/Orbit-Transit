// Quadra: what every Quadra app shares. The canonical copy lives in
// Shared-Proxy/kit/; `node kit/sync.mjs` copies it into each app (never edit
// an app's copy by hand).
//
//   Quadra Securities   stock   the financial powerhouse: where money lives and grows
//   Quadra Play         odds    a place to play: sports betting and the lottery
//   Quadra Fixtures     match   a related add-on: scores, schedules and stats
//   Quadra Hub          vocab   a related add-on: vocabulary, the pass, and how the money works
//   Orbit Class         orbit   a related add-on: the class schedule
//   Orbit Weather       weather a related add-on: one forecast, pinned places
//   Orbit Transit       transit a related add-on: the map, buses, trains and metros
//
// One account works everywhere: the Quadra Pass, a 10-character code for
// Shared-Proxy's /eco. It is required: every app opens on a sign-in screen
// until the device is signed in, and the data proxy only answers signed-in
// apps. A device keeps a revocable sign-in, never the pass; another device
// signs in with the pass or a 10-minute device code. Behind the pass is one
// NT$ money pool (play money only), and the pass is the only place anything
// is saved.
//
// One app at a time: the app in use is the account's live one. Opening
// another app (or the same app on another device) makes that one live; the
// one left behind stops refreshing and shows where Quadra is open, with a
// button to continue there. Links between the apps carry the sign-in along.

export const ECO_URL = 'https://orbit-workers-proxy.pengzjay.workers.dev/eco';
export const PROXY_URL = 'https://sports-proxy.pengzjay.workers.dev/sports-proxy';
export const SITE = 'https://jaypengx.github.io';
export const BRAND = { name: 'Quadra', pass: 'Quadra Pass' };

// `related`: an add-on outside the money pool (Fixtures, Hub, Orbit Class, Orbit Weather, Orbit Transit).
export const APPS = {
  stock: { name: 'Quadra Securities', short: 'Securities', path: '/Quadra-Securities/', color: '#0d9488', role: { zh: '投資與理財', en: 'Invest and grow' } },
  odds: { name: 'Quadra Play', short: 'Play', path: '/Quadra-Play/', color: '#2563eb', role: { zh: '運彩與彩券', en: 'Sports bets and lottery' } },
  vocab: { name: 'Quadra Hub', short: 'Hub', path: '/Quadra-Hub/', color: '#7c3aed', related: true, role: { zh: '單字、帳戶與錢的真相', en: 'Words, your pass and the truth about money' } },
  match: { name: 'Quadra Fixtures', short: 'Fixtures', path: '/Quadra-Fixtures/', color: '#ea580c', related: true, role: { zh: '賽程與比分', en: 'Scores and schedules' } },
  orbit: { name: 'Orbit Class', short: 'Orbit Class', tile: 'Orbit', path: '/Orbit-Class/', color: '#0ea5e9', related: true, role: { zh: '課表', en: 'Class schedule' } },
  weather: { name: 'Orbit Weather', short: 'Orbit Weather', tile: 'Weather', path: '/Orbit-Weather/', color: '#6366f1', related: true, role: { zh: '天氣', en: 'Weather' } },
  transit: { name: 'Orbit Transit', short: 'Orbit Transit', tile: 'Transit', path: '/Orbit-Transit/', color: '#22c55e', related: true, role: { zh: '大眾運輸', en: 'Public transport' } }
};
export const appName = app => APPS[app]?.name || app;

// ---- The economy -------------------------------------------------------------------
//
// Balanced so money matters (Shared-Proxy/tools/economy.mjs has the model):
// a new pass opens with NT$30,000; the 1st of every Taiwan month pays a
// fixed NT$6,000, the same for every account, like a salary (eco.js pays
// it, back pay for months nobody came). With the wealth level rewards those
// are the only money Quadra gives. Securities is where it grows (the market,
// real costs); Play and the lottery are where it goes (the house keeps about
// 14% of a single, a third of a treble, half of a draw ticket).
export const ECONOMY = {
  start: 30_000,
  monthly: 6_000
};

const finiteOr0 = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// What the account is worth: the pool and Securities' holdings.
export const worthOf = wallet => poolBalance(wallet) + finiteOr0(wallet?.snap?.stock?.holdings);
// 財富等級: what the account is worth (worthOf) puts it on a level; the
// first time it reaches one, Quadra's economy pays the level's reward once
// (eco.js RANKS, the same table: `eco:rank:<id>`).
export const WEALTH_RANKS = [
  { id: 'start', min: 0, reward: 0, icon: '🌱' },
  { id: 'saver', min: 50_000, reward: 1_000, icon: '🪙' },
  { id: 'steady', min: 100_000, reward: 2_000, icon: '💼' },
  { id: 'comfort', min: 250_000, reward: 3_000, icon: '🏡' },
  { id: 'wealthy', min: 500_000, reward: 5_000, icon: '💎' },
  { id: 'rich', min: 1_000_000, reward: 8_000, icon: '🏦' },
  { id: 'multi', min: 5_000_000, reward: 15_000, icon: '👑' },
  { id: 'tycoon', min: 20_000_000, reward: 30_000, icon: '🚀' }
];
// Where the money came from and went (all time, NT$): what the system gave
// (opening money, pay, level rewards, resets, VIP cashback), the account
// against Quadra (Play's settled bets less Plus fees and overdraft interest:
// a surplus when it has won more than it lost and paid), and its own result
// (markets, savings: worth less the other two). A bet still open is in the
// worth, as money at stake, and in neither side until it's settled.
// An account older than the shared wallet opened in the apps' own books:
// Securities' deposit (NT$100,000, or what it was opened with: it reports
// it as `snap.stock.opened`) and Play's NT$10,000 (its `odds:start` entry,
// with its weekly grants). The reset (`eco:rebase:v3`, −80,000) and its fix
// (`eco:rebase:v3fix`, for an account that had less than 110,000) brought
// that to the NT$30,000 everyone opens with: all of it is opening money.
const RESET_ID = 'eco:rebase:v3';
export function moneySides(wallet) {
  const gave = { start: 0, pay: 0, rank: 0, other: 0 };
  // Play's settled bets (payouts less stakes) and what Quadra charges (Plus
  // fees, overdraft interest); a bet still open is neither yet: it's money
  // at stake, still the account's.
  let play = 0;
  let fees = 0;
  let atStake = 0;
  const entries = wallet?.entries || [];
  const ids = new Set(entries.map(e => e.id));
  const open = e => e.kind === 'stake' && typeof e.id === 'string' && e.id.startsWith('odds:stake-') && !ids.has(`odds:payout-${e.id.slice(11)}`) && !ids.has(`odds:refund-${e.id.slice(11)}`);
  if (entries.some(e => e.id === RESET_ID) && !entries.some(e => e.id === 'eco:start')) gave.start += finiteOr0(wallet?.snap?.stock?.opened ?? 100_000);
  for (const e of entries) {
    const a = Number(e.amount) || 0;
    if (e.app === 'eco') {
      if (e.kind === 'start' || e.kind === 'grant' || e.id.startsWith(RESET_ID)) gave.start += a;
      else if (e.kind === 'pay') gave.pay += a;
      else if (e.kind === 'rank') gave.rank += a;
      else if (e.kind === 'rebase' || e.kind === 'vip') gave.other += a;
      else if (e.kind === 'plus' || e.kind === 'od') fees -= a;
    } else if (e.app === 'odds') {
      if (e.kind === 'start') gave.start += a;
      else if (e.kind === 'grant') gave.other += a;
      else if (open(e)) atStake -= a;
      else play += a;
    }
  }
  const given = gave.start + gave.pay + gave.rank + gave.other;
  // Against Quadra, signed: above 0 when Play has paid out more than the
  // account lost there and paid in fees (a surplus), below when Quadra kept more.
  const quadra = play - fees;
  // The worth counts money at stake: it's still the account's until settled.
  const worth = worthOf(wallet) + atStake;
  return { gave, given, quadra, fees, playNet: play, atStake, took: Math.max(0, -quadra), worth, own: worth - given - quadra };
}
// The monthly pay: fixed, whatever the account holds (eco.js PAY_MONTH).
export const paydayFor = () => ECONOMY.monthly;
// Below zero: an overdraft (1% a month, eco.js), fixed by selling something
// in Securities or borrowing on margin there.
export const OVERDRAFT_RATE = 0.01;
export const overdraft = wallet => Math.max(0, -poolBalance(wallet));

// ---- Quadra Plus ---------------------------------------------------------------------
//
// The one membership across Quadra: PLUS.fee a Taiwan month from the pool,
// billed by the Worker (eco.js: `op: 'plus'`, renewal with the payday). The
// first month someone ever joins is free. A month is a member's when the
// wallet holds `eco:plus:<YYYY-MM>`, so every app reads the same answer, for
// any past day too.
//
// Plus is a product that earns Quadra money, the way a sportsbook's or a
// broker's membership does: every perk makes betting or trading cheaper or
// bigger, so a member bets and trades more, and the house's cut and the
// broker's costs on that extra play earn back more than the perks cost
// (a NT$200 free bet is worth well under NT$100 to the bettor on average:
// only its winnings come back, at the house's prices). Nothing in it pays
// for saving or holding cash. The avatar and frame (Looks, below) are its
// one perk outside the money.
export const PLUS = {
  fee: 490,
  // The yearly plan: twelve months for the price of ten.
  year: 4_900,
  // Play: a NT$bonusBet free bet each week (the Worker's `eco:fb:<Monday>`;
  // free bets take odds of 1.50 or longer, a parlay's all together), the parlay boost
  // ×boost (Play's PARLAY_BOOST: 3+ picks, where the house's cut multiplies
  // with every pick), and cash out keeps cashOutKeep instead of 5% (money
  // back on the slip sooner, to bet again).
  odds: { bonusBet: 200, boost: 1.5, cashOutKeep: 0.02 },
  // Securities: commission at 2.8折 (×0.28, a Taiwan online broker's best
  // rate; a fund's subscription fee too), FX spread ×0.5, margin loans
  // loanCut a year cheaper: more trades, more currencies, more borrowed.
  stock: { commission: 0.28, fxSpread: 0.5, loanCut: 0.01 }
};
const plusMonth = t => new Date(t + 8 * 3_600_000).toISOString().slice(0, 7);
export const plusMonths = wallet => new Set((wallet?.entries || []).filter(e => e.kind === 'plus' && e.app === 'eco').map(e => e.id.slice(9)));
export const plusMember = (wallet, t = Date.now()) => (wallet?.entries || []).some(e => e.id === `eco:plus:${plusMonth(t)}` && e.app === 'eco');
// A charge the balance couldn't cover (eco.js `eco:plusfail:<month>`) after
// the last paid month: the membership lapsed and won't renew until joined again.
export const plusLapsed = wallet => {
  const entries = wallet?.entries || [];
  const last = [...plusMonths(wallet)].sort().at(-1);
  return Boolean(last) && entries.some(e => e.app === 'eco' && e.id?.startsWith('eco:plusfail:') && e.id.slice(13) > last);
};
// Renewing next month (the member hasn't left).
export const plusRenewing = wallet => wallet?.settings?.plus?.value?.on === true && !plusLapsed(wallet);
export const plusTried = wallet => plusMonths(wallet).size > 0;
export const plusPlan = wallet => (wallet?.settings?.plus?.value?.plan === 'year' ? 'year' : 'month');
// The last month already paid for (YYYY-MM), or null.
export const plusUntil = wallet => [...plusMonths(wallet)].sort().at(-1) ?? null;

// ---- Looks: Plus's avatar and frame ----------------------------------------------------
//
// The account button in every app can wear an avatar (the wallet setting
// `avatar`: { id }) and a frame around it (`frame`: { id }), chosen in
// Quadra Hub. They're Plus's: shown only while the account is a member, and
// back as they were if it joins again. Some are for staying a member:
// `streak` is how many Taiwan months in a row (this one included) the
// account must have held Plus. A month missed starts the count again, and a
// look worn beyond it is hidden until the streak is back.
// Months held in a row up to `now`'s (0 when not a member now). A yearly
// plan's months count as they arrive, not all at once.
export function plusStreak(wallet, now = Date.now()) {
  const held = plusMonths(wallet);
  let n = 0;
  for (let m = plusMonth(now); held.has(m) && n < 1200; n++) {
    const [y, mo] = m.split('-').map(Number);
    m = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  }
  return n;
}
export const LOOK_STREAKS = [3, 6, 12];
export const AVATARS = [
  { id: 'sprout', glyph: '🌱' },
  { id: 'fox', glyph: '🦊' },
  { id: 'panda', glyph: '🐼' },
  { id: 'lion', glyph: '🦁' },
  { id: 'dragon', glyph: '🐉' },
  { id: 'unicorn', glyph: '🦄' },
  { id: 'crown', glyph: '👑' },
  { id: 'cat', glyph: '🐱' },
  { id: 'dog', glyph: '🐶' },
  { id: 'frog', glyph: '🐸' },
  { id: 'penguin', glyph: '🐧' },
  { id: 'rocket', glyph: '🚀' },
  { id: 'rainbow', glyph: '🌈' },
  { id: 'fire', glyph: '🔥' },
  { id: 'gem', glyph: '💎' },
  { id: 'star', glyph: '✦' },
  { id: 'tiger', glyph: '🐯' },
  { id: 'eagle', glyph: '🦅' },
  { id: 'trophy', glyph: '🏆' },
  { id: 'owl', glyph: '🦉' },
  { id: 'octopus', glyph: '🐙' },
  { id: 'whale', glyph: '🐳' },
  { id: 'butterfly', glyph: '🦋' },
  { id: 'cactus', glyph: '🌵' },
  { id: 'sun', glyph: '🌞' },
  { id: 'ball', glyph: '⚽' },
  { id: 'chart', glyph: '📈' },
  // For staying a member.
  { id: 'wolf', glyph: '🐺', streak: 3 },
  { id: 'shark', glyph: '🦈', streak: 3 },
  { id: 'bolt', glyph: '⚡', streak: 3 },
  { id: 'peacock', glyph: '🦚', streak: 6 },
  { id: 'planet', glyph: '🪐', streak: 6 },
  { id: 'drake', glyph: '🐲', streak: 6 },
  { id: 'comet', glyph: '☄️', streak: 12 },
  { id: 'galaxy', glyph: '🌌', streak: 12 },
  { id: 'trident', glyph: '🔱', streak: 12 }
];
export const FRAMES = [
  ...['bronze', 'silver', 'jade', 'gold', 'neon', 'aurora', 'sakura', 'ocean', 'ember', 'mint'].map(id => ({ id })),
  // For staying a member (the long ones turn).
  { id: 'sapphire', streak: 3 },
  { id: 'ruby', streak: 3 },
  { id: 'legend', streak: 6 },
  { id: 'prism', streak: 6 },
  { id: 'mythic', streak: 12 },
  { id: 'celestial', streak: 12 }
];
// Whether this account may wear `item` now: a member, long enough.
export const lookOpen = (wallet, item, now = Date.now()) => plusMember(wallet, now) && plusStreak(wallet, now) >= (item?.streak || 0);
const worn = (wallet, key, list, now) => {
  const item = list.find(x => x.id === setting(wallet, key, null)?.id);
  return item && lookOpen(wallet, item, now) ? item : null;
};
export const avatarOf = (wallet, now = Date.now()) => worn(wallet, 'avatar', AVATARS, now);
export const frameOf = (wallet, now = Date.now()) => worn(wallet, 'frame', FRAMES, now);

// ---- VIP: free tiers by what's played, with cashback -----------------------------------
//
// A Taiwan month's gaming stakes (Play's bets and lottery and scratch
// tickets, less refunds: `odds` entries of kind stake / lottery / refund)
// set that month's tier, and the Worker pays the tier's share of them back
// on the next month's first read (`eco:vip:<month>`, kind 'vip'; eco.js
// VIP, the same table). Loyalty cashback like a real sportsbook's or
// casino's: a sliver of the house's cut (every product keeps 14% or more;
// the top rate is 1.5%), for the players who bring the most.
export const VIP = {
  from: '2026-10',
  tiers: [
    { id: 'bronze', min: 10_000, back: 0.005, icon: '🥉', zh: '銅卡', en: 'Bronze' },
    { id: 'silver', min: 50_000, back: 0.008, icon: '🥈', zh: '銀卡', en: 'Silver' },
    { id: 'gold', min: 150_000, back: 0.012, icon: '🥇', zh: '金卡', en: 'Gold' },
    { id: 'black', min: 500_000, back: 0.015, icon: '◆', zh: '黑卡', en: 'Black' }
  ]
};
// A month's (YYYY-MM, Taiwan) gaming stakes, whole NT$.
export function vipStakes(wallet, month) {
  let sum = 0;
  for (const e of wallet?.entries || []) {
    if (e.app !== 'odds' || typeof e.t !== 'number' || plusMonth(e.t) !== month) continue;
    if (e.kind === 'stake' || e.kind === 'lottery' || e.kind === 'refund') sum -= e.amount;
  }
  return Math.max(0, Math.round(sum));
}
export const vipTier = stakes => [...VIP.tiers].reverse().find(t => stakes >= t.min) ?? null;
// This month so far: stakes, tier, the cashback it's heading for, the next
// tier and what's left to reach it; and last month's cashback if paid.
export function vipStatus(wallet, now = Date.now()) {
  const month = plusMonth(now);
  const stakes = vipStakes(wallet, month);
  const tier = vipTier(stakes);
  const next = VIP.tiers.find(t => stakes < t.min) ?? null;
  const paid = (wallet?.entries || []).filter(e => e.app === 'eco' && e.kind === 'vip').sort((a, b) => b.t - a.t)[0] ?? null;
  return { month, stakes, tier, back: tier ? Math.floor(stakes * tier.back) : 0, next, toNext: next ? next.min - stakes : 0, paid };
}
export const vipName = (tier, lang = 'zh') => (tier ? `${tier.icon} ${lang === 'en' ? tier.en : tier.zh}` : '');

// The welcome offer (eco.js WELCOME): the first paid bet in Play brings a
// NT$WELCOME.bet free bet (`eco:fb:welcome`), once. Still to come?
export const WELCOME = { bet: 200 };
export const welcomeDue = wallet => {
  const entries = wallet?.entries || [];
  return !entries.some(e => e.id === 'eco:fb:welcome') && !entries.some(e => e.app === 'odds' && e.kind === 'stake' && e.amount < 0);
};

// ---- Free bets ------------------------------------------------------------------------
//
// A free bet is a token from Quadra: Plus's weekly bonus bet or the welcome
// offer (the Worker's 'eco:fb:…', app 'eco', kind 'freebet', amount 0, its
// value in the note). Play stakes one on one slip, and only the winnings
// come back, never the stake. Play marks it spent with 'odds:fb-<token id>'
// (a fixed id: spent once). Unspent tokens last FREEBET.days.
export const FREEBET = { days: 7, max: 500 };
export const freeBetValue = e => {
  const v = Number(e?.note);
  return Number.isInteger(v) && v > 0 && v <= FREEBET.max && v % 10 === 0 ? v : 0;
};
// The tokens not yet spent or expired: [{ id, value, t, until }], soonest
// to expire first.
export function freeBets(wallet, now = Date.now(), spent = []) {
  const entries = wallet?.entries || [];
  const used = new Set(spent);
  for (const e of entries) if (e.app === 'odds' && typeof e.id === 'string' && e.id.startsWith('odds:fb-')) used.add(e.id.slice(8));
  return entries
    .filter(e => e.kind === 'freebet' && e.app === 'eco' && typeof e.id === 'string' && e.id.startsWith('eco:fb:') && freeBetValue(e) && !used.has(e.id))
    .map(e => ({ id: e.id, value: freeBetValue(e), t: e.t, until: e.t + FREEBET.days * 86_400_000 }))
    .filter(x => x.until > now)
    .sort((a, b) => a.until - b.until);
}

// ---- Language ------------------------------------------------------------------------

export function detectLang() {
  try {
    const saved = localStorage.getItem('quadra.lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {}
  const langs = globalThis.navigator?.languages || [globalThis.navigator?.language || 'zh-TW'];
  return langs.some(l => /^zh/i.test(l)) || !langs.some(l => /^en/i.test(l)) ? 'zh' : 'en';
}
export const pick = (lang, zh, en) => (lang === 'en' ? en : zh);

// ---- Codes ---------------------------------------------------------------------------

export const PASS_PATTERN = /^[2-9A-HJ-NP-Z]{10}$/;
export const DEVICE_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;
export function cleanCode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}
export const isPass = code => PASS_PATTERN.test(cleanCode(code));
export const formatPass = code => (code && code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code || '');

// ---- Storage -------------------------------------------------------------------------
//
// A device keeps its refresh token (a revocable sign-in for this device) and
// the account's id, never the pass itself: the pass is typed to sign in,
// shown once when it's made, and that's all.

// Keyboard or touch: the focus ring shows only after a key that moves focus
// (quadra.css), never for focus a tap or the code put somewhere.
if (typeof document !== 'undefined') {
  const root = document.documentElement;
  document.addEventListener('keydown', e => ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && root.setAttribute('data-q-keys', ''), true);
  document.addEventListener('pointerdown', () => root.removeAttribute('data-q-keys'), true);
}

const KEY = { refresh: 'quadra.refresh', account: 'quadra.account', wallet: 'quadra.wallet', aff: 'quadra.aff', dismiss: 'quadra.dismiss' };
function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}
const readJson = (key, fallback) => {
  try {
    return JSON.parse(readStore(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};

// The signed-in account's id on this device (the first 16 characters of
// the pass's hash, from the refresh token), '' when signed out.
export function storedAccount() {
  const id = readStore(KEY.account) || '';
  return /^[0-9a-f]{16}$/.test(id) && readStore(KEY.refresh) ? id : '';
}
function accountOf(refresh) {
  try {
    const body = String(refresh).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(body + '==='.slice((body.length + 3) % 4))).d.slice(0, 16);
  } catch {
    return '';
  }
}
export function cachedWallet(account = storedAccount()) {
  const saved = readJson(KEY.wallet, null);
  return saved && account && saved.account === account ? saved.wallet : null;
}
function cacheWallet(account, wallet) {
  if (account && wallet) writeStore(KEY.wallet, JSON.stringify({ account, wallet }));
}
// The app's own data as last read or written on this device (under the
// account), so a cold start paints at once, before the Worker answers.
// Only small ones (Securities keeps its own compressed copy).
const payloadKey = app => `quadra.payload.${app}`;
export function cachedPayload(app, account = storedAccount()) {
  const saved = readJson(payloadKey(app), null);
  return saved && account && saved.account === account ? saved.payload : null;
}
function cachePayload(app, account, payload) {
  if (!account || typeof payload !== 'string') return;
  writeStore(payloadKey(app), payload.length < 200_000 ? JSON.stringify({ account, payload }) : null);
}

// ---- The Worker ----------------------------------------------------------------------

async function call(method, query = '', body) {
  const res = await fetch(`${ECO_URL}${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25_000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error?.message || `HTTP ${res.status}`);
    error.code = data?.error?.code || `HTTP_${res.status}`;
    error.status = res.status;
    error.live = data?.live || null;
    if (data?.error?.index != null) error.index = data.error.index;
    throw error;
  }
  return data;
}
const qs = params => `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()}`;

export function randomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ---- Data through the proxy: batched, remembered, shared ------------------------------
//
// proxyJson(url, { ttl, trim, persist }) is how every app reads outside data
// (ESPN, Kambi, Yahoo…) through the data proxy:
//
//   - the same URL asked twice within `ttl` is answered from memory;
//   - with `persist` (the default), the answer is also kept on the device
//     (Cache Storage), so it survives closing the app: a copy younger than
//     `ttl` is used without asking the proxy at all, and peekJson(url) gives
//     the last copy of any age for painting at once while a fresh one loads;
//   - requests made within a few milliseconds of each other go to the proxy
//     as one batch (`?batch=1&u=…`, up to 12): the Worker plan bills per
//     request, and a first paint asks for a dozen lists at once. A batch
//     that fails is asked again one by one.
//
// The session token comes from the app's quadraSession (the last one made).
let dataSession = null;
const DATA_CACHE = 'quadra-data-v1';
const DATA_KEEP_MS = 4 * 86_400_000;
const memory = new Map();
const dataKey = (url, trim) => `https://quadra.data/${trim ? `${trim}!` : ''}${encodeURIComponent(url)}`;
const hasCaches = () => typeof caches !== 'undefined' && typeof Response !== 'undefined';
async function persisted(key) {
  if (!hasCaches()) return null;
  try {
    const cache = await caches.open(DATA_CACHE);
    const hit = await cache.match(key);
    if (!hit) return null;
    return { at: Number(hit.headers.get('x-at')) || 0, data: await hit.json() };
  } catch {
    return null;
  }
}
let prunedAt = 0;
async function persist(key, text) {
  if (!hasCaches()) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put(key, new Response(text, { headers: { 'content-type': 'application/json', 'x-at': String(Date.now()) } }));
    // Now and then, what's older than a few days goes.
    if (Date.now() - prunedAt > 10 * 60_000) {
      prunedAt = Date.now();
      for (const req of await cache.keys()) {
        const res = await cache.match(req);
        if (Date.now() - (Number(res?.headers.get('x-at')) || 0) > DATA_KEEP_MS) await cache.delete(req);
      }
    }
  } catch {}
}
export function clearData() {
  memory.clear();
  if (hasCaches()) caches.delete(DATA_CACHE).catch(() => {});
}
// Signed out: nothing of the account stays on this device. The Quadra apps
// share one origin, so every app's keys in this storage go (the account,
// the wallet, each app's copy and its own settings; a home-screen app on a
// phone has storage of its own), this tab's too, and the kept data. Only
// how the device itself is set up stays: its language and its screen's
// safe area (the app files stay cached, so the sign-in screen opens offline).
const DEVICE_KEYS = new Set(['quadra.lang', 'quadra.safeBottom']);
export function wipeDevice() {
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      const keys = [];
      for (let i = 0; i < store.length; i++) keys.push(store.key(i));
      for (const k of keys) if (!(store === globalThis.localStorage && DEVICE_KEYS.has(k))) store.removeItem(k);
    } catch {}
  }
  clearData();
}
// The last copy kept on this device, of any age: { at, data } or null.
export const peekJson = (url, { trim = '' } = {}) => persisted(dataKey(url, trim));

async function dataToken() {
  const s = dataSession;
  if (!s) return '';
  return s.ensureToken().catch(() => s.token || '');
}
const proxyAddress = (url, trim, token) => `${PROXY_URL}?url=${encodeURIComponent(url)}${trim ? `&trim=${trim}` : ''}${token ? `&qt=${encodeURIComponent(token)}` : ''}`;
async function fetchOne(url, trim, timeout) {
  const token = await dataToken();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(proxyAddress(url, trim, token), { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return await res.text();
    } catch (error) {
      if (attempt >= 1 || (error.status >= 400 && error.status < 500 && error.status !== 429)) throw error;
      await new Promise(r => setTimeout(r, 700));
    }
  }
}
// The batch queue.
const BATCH_MAX = 12;
let queue = [];
let flushTimer = 0;
function enqueue(url, trim, timeout) {
  return new Promise((resolve, reject) => {
    queue.push({ url, trim, timeout, resolve, reject });
    if (queue.length >= BATCH_MAX) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 12);
  });
}
async function flush() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  const items = queue.splice(0, BATCH_MAX);
  if (queue.length) flushTimer = setTimeout(flush, 0);
  if (!items.length) return;
  const one = item => fetchOne(item.url, item.trim, item.timeout).then(item.resolve, item.reject);
  if (items.length === 1) return void items.forEach(one);
  try {
    const token = await dataToken();
    const u = items.map(i => `&u=${encodeURIComponent(i.trim ? `${i.trim}!${i.url}` : i.url)}`).join('');
    const res = await fetch(`${PROXY_URL}?batch=1${u}${token ? `&qt=${encodeURIComponent(token)}` : ''}`, { signal: AbortSignal.timeout(Math.max(...items.map(i => i.timeout))) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { r } = await res.json();
    items.forEach((item, i) => {
      const got = r?.[i];
      if (got?.s === 200) item.resolve(got.b);
      else if (got?.s >= 500 || got?.s === 429 || !got) one(item);
      else item.reject(Object.assign(new Error(`HTTP ${got.s}`), { status: got.s }));
    });
  } catch {
    items.forEach(one);
  }
}

// A text in another language (English company descriptions for a Chinese
// reader…), through the proxy's translate route, kept a month everywhere.
// to: 'zh-TW' | 'en' | …; resolves to the original text if it can't.
export async function translate(text, to = 'zh-TW', from = 'auto') {
  const q = String(text || '').slice(0, 4500);
  if (!q.trim()) return q;
  try {
    const got = await proxyJson(`https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${from}&tl=${to}&q=${encodeURIComponent(q)}`, { ttl: 30 * 86_400_000 });
    const out = Array.isArray(got) ? (Array.isArray(got[0]) ? got[0][0] : got[0]) : null;
    return typeof out === 'string' && out.trim() ? out : q;
  } catch {
    return q;
  }
}

export function proxyJson(url, { ttl = 60_000, trim = '', persist: keep = true, timeout = 20_000 } = {}) {
  const key = dataKey(url, trim);
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = (async () => {
    if (keep) {
      const saved = await persisted(key);
      if (saved && Date.now() - saved.at < ttl) return saved.data;
    }
    const got = await enqueue(url, trim, timeout);
    const data = typeof got === 'string' ? JSON.parse(got) : got;
    // Kept on the device off the critical path.
    if (keep) setTimeout(() => persist(key, typeof got === 'string' ? got : JSON.stringify(got)), 0);
    return data;
  })();
  memory.set(key, { at: Date.now(), promise });
  promise.catch(() => memory.delete(key));
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  return promise;
}

// ---- The session ---------------------------------------------------------------------
//
// const q = quadraSession('odds');
// q.on('wallet', w => ...)      the wallet changed (pool, settings…)
// q.on('active', live => ...)   true: this app is the live one; false: paused
// q.on('signedout', () => ...)
// await q.start()               signs in (the gate) and makes this app live;
//                               resolves to the first reply ({ payload, inbox,
//                               wallet } or { offline })
// q.pass                        the account's id on this device ('' signed out)
// q.read({ data, inbox })       { wallet, pool, payload, inbox } (app data when data)
// q.write({ payload, wallet })  only while live
// q.proxy(url, extra)           the data proxy's address for `url`, signed in

// No two-finger zoom in any Quadra app. iOS ignores the viewport's
// user-scalable=no in Safari and doesn't honour touch-action for pinches
// everywhere, so the pinch itself is stopped: its gesture events (Safari),
// a move with two fingers down (every touch browser) and ctrl+wheel (a
// trackpad pinch). One finger still scrolls and every tap still works.
function noZoom() {
  if (typeof document === 'undefined' || document.__quadraNoZoom) return;
  document.__quadraNoZoom = true;
  const stop = e => e.cancelable && e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, { passive: false });
  document.addEventListener('touchmove', e => e.touches && e.touches.length > 1 && stop(e), { passive: false });
  globalThis.addEventListener?.('wheel', e => e.ctrlKey && stop(e), { passive: false });
}
noZoom();

// A phone or a tablet: html.q-touch, so a tablet gets a phone's frame (no
// brand header, the tabs at the bottom; quadra.css). boot.js sets it earlier
// in the apps that load it.
if (typeof document !== 'undefined' && isPhoneOrTablet()) document.documentElement.classList.add('q-touch');

// The solid strip under the phone's status bar (see .q-statusbar in quadra.css).
function statusStrip() {
  if (typeof document === 'undefined' || !document.body || document.querySelector('.q-statusbar')) return;
  const bar = document.createElement('div');
  bar.className = 'q-statusbar';
  bar.setAttribute('aria-hidden', 'true');
  document.body.prepend(bar);
}
if (typeof document !== 'undefined') document.body ? statusStrip() : document.addEventListener('DOMContentLoaded', statusStrip);

export function quadraSession(app, { lang = detectLang(), heartbeat = 60_000 } = {}) {
  const made = makeSession(app, { lang, heartbeat });
  dataSession = made;
  return made;
}
function makeSession(app, { lang, heartbeat }) {
  const listeners = {};
  const emit = (name, value) => (listeners[name] || []).forEach(fn => fn(value));
  let token = '';
  let tokenAt = 0;
  let active = false;
  let live = null;
  let wallet = cachedWallet();
  let timer = 0;
  let started = false;

  const s = {
    app,
    lang,
    get pass() {
      return storedAccount();
    },
    get token() {
      return token;
    },
    get wallet() {
      return wallet;
    },
    get pool() {
      return poolBalance(wallet);
    },
    get active() {
      return active;
    },
    get live() {
      return live;
    },
    on(name, fn) {
      (listeners[name] ||= []).push(fn);
      return s;
    }
  };

  function setWallet(w) {
    if (!w) return;
    wallet = w;
    cacheWallet(storedAccount(), w);
    // The pass's notice switches (newer here: sent up).
    adoptNotifyPrefs(w);
    emit('wallet', w);
    setTimeout(() => syncPrefs(s), 0);
  }
  function setActive(next, where = null) {
    live = where;
    if (active === next) return;
    active = next;
    emit('active', next);
    if (!next) showMoved(s);
    else hideMoved();
  }
  function absorb(data) {
    if (data.refresh) {
      writeStore(KEY.refresh, data.refresh);
      writeStore(KEY.account, accountOf(data.refresh));
    }
    if (data.token) {
      token = data.token;
      tokenAt = Date.now();
    }
    if (data.wallet) setWallet(data.wallet);
    if (typeof data.payload === 'string') cachePayload(app, storedAccount(), data.payload);
    if (data.active != null) setActive(Boolean(data.active), data.live || null);
    return data;
  }

  // Every way of signing in ends here: a refresh token for this device.
  const signIn = body => call('POST', '', { ...body, app, inbox: true }).then(res => absorb({ ...res, active: true }));
  const login = code => signIn(DEVICE_CODE_PATTERN.test(cleanCode(code)) ? { op: 'pair-redeem', code: cleanCode(code) } : { op: 'login', passcode: cleanCode(code) });
  const create = () => signIn({ op: 'create' });
  // A session from the device's refresh token (claim: make this app live).
  // One at a time: a data fetch that needs a token while the start's sign-in
  // is on its way waits for that one (not a second call to the Worker).
  let refreshing = null;
  function refresh(opts) {
    const p = refreshOnce(opts);
    refreshing = p;
    const done = () => refreshing === p && (refreshing = null);
    p.then(done, done);
    return p;
  }
  // A usable token: the one held, the sign-in already on its way, or a new one.
  async function freshToken() {
    if (refreshing) await refreshing.catch(() => {});
    if (!token || Date.now() - tokenAt > 15 * 60_000) await (refreshing || refresh({ claim: false }));
  }
  async function refreshOnce({ claim = false, data = false } = {}) {
    const ref = readStore(KEY.refresh);
    if (!ref) return signedOut();
    try {
      return absorb(await call('POST', '', { op: 'refresh', refresh: ref, app, claim, data, inbox: data }));
    } catch (error) {
      if (error.code === 'ECO_SIGNED_OUT' || error.code === 'ECO_TOKEN_INVALID') return signedOut();
      throw error;
    }
  }
  function signedOut() {
    const had = Boolean(storedAccount());
    // An account was signed in here: everything of it goes. (Never signed
    // in, a token asked for by a data fetch: nothing to wipe.)
    if (had) wipeDevice();
    else for (const k of [KEY.refresh, KEY.account, KEY.wallet, payloadKey(app)]) writeStore(k, null);
    token = '';
    wallet = null;
    active = false;
    emit('signedout');
    // Signed out while in use (another device signed everyone out, the
    // pass changed): straight back to the sign-in screen, like a new device.
    if (started && had && typeof location !== 'undefined') setTimeout(() => location.reload(), 60);
    return { signedOut: true };
  }
  // Every call with the session token: a fresh one on expiry, once.
  async function withToken(fn) {
    await freshToken();
    if (!token) {
      const error = new Error('not live');
      error.code = 'ECO_SESSION_MOVED';
      error.live = live;
      setActive(false, live);
      throw error;
    }
    try {
      return await fn(token);
    } catch (error) {
      if (error.code === 'ECO_TOKEN_INVALID') {
        await refresh({ claim: false });
        return fn(token);
      }
      if (error.code === 'ECO_SIGNED_OUT') signedOut();
      if (error.code === 'ECO_SESSION_MOVED') setActive(false, error.live);
      throw error;
    }
  }

  s.login = login;
  s.create = create;
  s.claim = () => refresh({ claim: true });
  s.signOut = () => signedOut();
  // Every other device signed out; this one stays signed in.
  s.signOutEverywhere = () => withToken(qt => call('POST', '', { op: 'signout-all', qt })).then(absorb);
  // A new pass for the account: shown once, the old one stops working.
  s.rotate = () =>
    withToken(qt => call('POST', '', { op: 'rotate', qt })).then(res => {
      absorb(res);
      return res.passcode;
    });
  // A device code: sign in on another device within 10 minutes, once.
  s.deviceCode = () => withToken(qt => call('POST', '', { op: 'pair-create', qt }));
  s.read = ({ data = false, inbox = false } = {}) =>
    withToken(qt => call('GET', qs({ qt, app: data ? app : '', inbox: inbox ? '1' : '' }))).then(res => {
      absorb(res);
      return res;
    });
  s.write = ({ payload, wallet: patch } = {}) =>
    withToken(qt => {
      if (!active) {
        const error = new Error('not live');
        error.code = 'ECO_SESSION_MOVED';
        error.live = live;
        throw error;
      }
      return call('PATCH', qs({ qt, app }), { payload, wallet: patch });
    }).then(res => {
      if (typeof payload === 'string') cachePayload(app, storedAccount(), payload);
      return absorb(res);
    });
  // Quadra Plus: join (on) or leave (off); the Worker bills it.
  s.plus = (on, plan = 'month') => withToken(qt => call('POST', '', { op: 'plus', qt, on: Boolean(on), plan })).then(absorb);
  s.dropInbox = id => withToken(qt => call('DELETE', qs({ qt, app, inbox: id })));
  // Other passes into this one (they're deleted after).
  s.merge = passes => withToken(qt => call('POST', '', { op: 'merge', qt, sources: passes.map(passcode => ({ passcode })) })).then(absorb);
  s.op = (op, body = {}) => withToken(qt => call('POST', '', { op, qt, ...body }));
  // The data proxy, signed in.
  s.proxy = (url, extra = '') => `${PROXY_URL}?url=${encodeURIComponent(url)}${extra}${token ? `&qt=${encodeURIComponent(token)}` : ''}`;
  s.ensureToken = async () => {
    await freshToken();
    return token;
  };

  // Sign in (the gate, when this device isn't), take a sign-in handed over
  // by a link, and make this app live.
  s.start = async ({ data = true } = {}) => {
    if (started) return s.first || {};
    started = true;
    let first = null;
    try {
      first = await takeHandoff(app);
      if (first) absorb({ ...first, active: true });
      if (!first && storedAccount()) {
        first = await refresh({ claim: true, data });
        if (first?.signedOut) first = null;
      }
    } catch (error) {
      // Offline: the cached wallet stands in until the next try.
      first = { offline: true, error };
    }
    if (!first) first = await signInGate(s);
    s.first = first;
    // The loading screen's line (boot.js): signed in, the app's data next.
    globalThis.__bootStep?.('', 0.8);
    loop();
    setTimeout(() => plusNotices(s), 1200);
    s.on('wallet', () => plusNotices(s));
    setTimeout(() => offerNotices(s), 2500);
    // The first reply: what the app merges its own copy with (never the
    // session itself: an app that took the session for the reply saw "no
    // data" and saved over the pass).
    return first || {};
  };
  function loop() {
    clearInterval(timer);
    timer = setInterval(beat, heartbeat);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
    globalThis.addEventListener?.('pageshow', event => event.persisted && wake());
    globalThis.addEventListener?.('online', wake);
  }
  // Back on screen: this app becomes the live one again.
  let waking = null;
  function wake() {
    if (!storedAccount() || waking) return;
    waking = refresh({ claim: true })
      .catch(() => {})
      .finally(() => (waking = null));
  }
  function beat() {
    if (document.visibilityState === 'hidden' || !storedAccount() || !active) return;
    s.read().catch(() => {});
  }

  s.appUrl = (other, hash = '') => appUrl(other, hash);
  // A link to another app that arrives signed in (apps on a phone's home
  // screen don't share storage): a sealed sign-in, good for 3 minutes.
  s.go = async (other, hash = '') => {
    let target = appUrl(other, hash);
    if (isStandalone() && storedAccount()) {
      try {
        const { handoff } = await s.op('handoff');
        target = appUrl(other, [String(hash || '').replace(/^#/, ''), `qh=${handoff}`].filter(Boolean).join('&'));
      } catch {}
    }
    globalThis.location.assign(target);
  };
  return s;
}

export function appUrl(app, hash = '') {
  const h = String(hash || '').replace(/^#/, '');
  return `${APPS[app]?.path || '/'}${h ? `#${h}` : ''}`;
}

// A sign-in handed over in the address (#qh=<sealed>): taken out of the
// address at once and traded for this device's own sign-in. null if none.
async function takeHandoff(app) {
  const loc = globalThis.location;
  if (!loc?.hash) return null;
  const parts = loc.hash.slice(1).split('&');
  const at = parts.findIndex(p => p.startsWith('qh=') || p.startsWith('qp='));
  if (at < 0) return null;
  const [k, v] = [parts[at].slice(0, 2), decodeURIComponent(parts[at].slice(3))];
  parts.splice(at, 1);
  try {
    globalThis.history?.replaceState(globalThis.history.state, '', `${loc.pathname}${loc.search}${parts.length ? `#${parts.join('&')}` : ''}`);
  } catch {}
  try {
    sessionStorage.setItem('quadra.visit', '1');
  } catch {}
  if (k !== 'qh') return null;
  try {
    return await call('POST', '', { op: 'redeem', handoff: v, app, inbox: true });
  } catch {
    return null;
  }
}

// ---- The pool --------------------------------------------------------------------------

const cash = s => (typeof s?.cash === 'number' && Number.isFinite(s.cash) ? s.cash : 0);
export function poolBalance(wallet) {
  if (!wallet) return 0;
  const entries = (wallet.entries || []).reduce((sum, e) => sum + e.amount, 0);
  return Math.round((entries + Object.values(wallet.snap || {}).reduce((sum, s) => sum + cash(s), 0)) * 100) / 100;
}
// The pool less `app`'s own part (an app with its own books shows its own
// money plus this).
export function othersBalance(wallet, app) {
  if (!wallet) return 0;
  const entries = (wallet.entries || []).filter(e => e.app !== app).reduce((sum, e) => sum + e.amount, 0);
  const snaps = Object.entries(wallet.snap || {})
    .filter(([name]) => name !== app)
    .reduce((sum, [, s]) => sum + cash(s), 0);
  return Math.round((entries + snaps) * 100) / 100;
}
export const entriesNotFrom = (wallet, app) => (wallet?.entries || []).filter(e => e.app !== app).sort((a, b) => b.t - a.t);

const KIND = {
  start: ['開戶金', 'Opening money'],
  grant: ['零用金', 'Allowance'],
  pay: ['每月薪水', 'Monthly pay'],
  stake: ['下注', 'Bet'],
  payout: ['彩金', 'Winnings'],
  refund: ['退款', 'Refund'],
  lottery: ['彩券', 'Lottery ticket'],
  prize: ['彩券獎金', 'Lottery prize'],
  plus: ['Quadra Plus 月費', 'Quadra Plus'],
  rebase: ['經濟調整', 'Economy reset'],
  rank: ['財富等級獎勵', 'Wealth level reward'],
  od: ['透支利息', 'Overdraft interest'],
  cashout: ['提前兌現', 'Cash out'],
  freebet: ['免費投注', 'Free bet'],
  plusboost: ['✦ Plus 串關加成', '✦ Plus parlay boost'],
  vip: ['VIP 投注回饋', 'VIP cashback'],
  welcome: ['新手禮', 'Welcome offer'],
  'xfer-in': ['轉入', 'Transfer in'],
  'xfer-out': ['轉出', 'Transfer out'],
  merge: ['合併帶入', 'Carried over']
};
// One-off Worker entries named for what they were.
const NAMED = { 'eco:rebase:v3fix': ['開戶金補足', 'Opening money made up'], 'eco:odback:v3': ['透支利息退還', 'Overdraft interest refunded'] };
export function describeEntry(e, lang = 'zh') {
  const i = lang === 'en' ? 1 : 0;
  const what = NAMED[e.id]?.[i] || KIND[e.kind]?.[i] || e.kind;
  const from = e.app === 'eco' ? 'Quadra' : APPS[e.app]?.short || e.app;
  const peer = e.peer ? ` ${e.peer}` : '';
  return `${from} · ${what}${peer}${e.note ? ` · ${e.note}` : ''}`;
}

export const setting = (wallet, key, fallback = null) => wallet?.settings?.[key]?.value ?? fallback;
export const settingPatch = (key, value) => ({ settings: { [key]: { value, t: Date.now() } } });

export function money(x, { sign = false, cents = false } = {}) {
  const v = Number(x) || 0;
  const body = Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: 0 });
  return `${v < 0 ? '−' : sign && v > 0 ? '+' : ''}NT$${body}`;
}

// ---- Taiwan days -------------------------------------------------------------------------

const TPE = 8 * 3_600_000;
export const taipeiDay = (t = Date.now()) => new Date(t + TPE).toISOString().slice(0, 10);

// ---- Recommendations: one engine for every app -------------------------------------------
//
// Affinity: every meaningful action (opening a match, a bet, a trade, a
// watch) adds weight to the keys it's about ('team:mlb:LAD', 'league:mlb',
// 'sport:baseball', 'sym:2330.TW', 'sector:tech' …), decaying with a half
// life, so the model follows what the person does now. Each app keeps its
// own map (and syncs its strongest keys to the wallet); ranking reads all
// the apps' maps together, so a sector traded in Securities lifts its
// stocks' news, and a team bet on in Play its games there.
//
// Ranking: score = quality × (1 + affinity) + exploration, then a diversity
// pass (maximal marginal relevance) so one team or sector doesn't fill the
// list, with a little exploration for keys seldom seen (so the list learns
// instead of repeating itself) and items the person dismissed pushed down.

const HALF_LIFE = 21 * 86_400_000;
const AFF_SYNC_KEYS = 40;
const decay = (v, t, now) => v * 0.5 ** ((now - t) / HALF_LIFE);

export function affinityOf(app) {
  return readJson(`${KEY.aff}.${app}`, {});
}
export function recordAffinity(app, keys, weight = 1, now = Date.now()) {
  const map = affinityOf(app);
  for (const k of [].concat(keys).filter(Boolean)) {
    const had = map[k];
    map[k] = { v: (had ? decay(had.v, had.t, now) : 0) + weight, t: now, n: (had?.n || 0) + 1 };
  }
  // Keep it small: the strongest 300.
  const kept = Object.entries(map)
    .sort((a, b) => decay(b[1].v, b[1].t, now) - decay(a[1].v, a[1].t, now))
    .slice(0, 300);
  writeStore(`${KEY.aff}.${app}`, JSON.stringify(Object.fromEntries(kept)));
}
// The strongest keys for the wallet (aff:<app>).
export function affinityPatch(app, now = Date.now()) {
  const top = Object.entries(affinityOf(app))
    .map(([k, a]) => [k, Math.round(decay(a.v, a.t, now) * 100) / 100])
    .filter(([, v]) => v > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, AFF_SYNC_KEYS);
  return settingPatch(`aff:${app}`, Object.fromEntries(top));
}
// Everything known: this device's maps and every app's synced map (the
// larger of the two per key), key -> weight. `apps`: only those apps' maps
// (Fixtures, an add-on, reads its own).
export function affinity(wallet, now = Date.now(), apps = Object.keys(APPS)) {
  const out = {};
  const add = (k, v) => (out[k] = Math.max(out[k] || 0, v));
  for (const app of apps) {
    for (const [k, a] of Object.entries(affinityOf(app))) add(k, decay(a.v, a.t, now));
    for (const [k, v] of Object.entries(setting(wallet, `aff:${app}`, {}) || {})) add(k, Number(v) || 0);
  }
  return out;
}

export function dismiss(id) {
  const d = readJson(KEY.dismiss, {});
  d[id] = Date.now();
  const kept = Object.entries(d)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200);
  writeStore(KEY.dismiss, JSON.stringify(Object.fromEntries(kept)));
}
const dismissed = () => readJson(KEY.dismiss, {});

// items: [{ id, keys: [...], quality (0..1), group }]; returns the best
// `n`, each with `why` (its strongest matching key) and `score`.
export function rank(items, { wallet, n = 10, diversity = 0.35, explore = 0.08, now = Date.now(), aff = affinity(wallet, now) } = {}) {
  const gone = dismissed();
  const max = Math.max(1, ...Object.values(aff));
  const scored = items.map(item => {
    let best = 0;
    let why = null;
    let seen = 0;
    for (const k of item.keys || []) {
      const v = (aff[k] || 0) / max;
      if (v > best) [best, why] = [v, k];
      if (aff[k]) seen++;
    }
    const q = Math.max(0, Math.min(1, item.quality ?? 0.5));
    // A little for the unexplored: items touching nothing known yet.
    const novelty = seen ? 0 : explore * (0.5 + hash01(`${item.id}:${taipeiDay(now)}`));
    const penalty = gone[item.id] ? 0.25 : 1;
    return { ...item, why, score: (q * (0.6 + 1.4 * best) + novelty) * penalty };
  });
  // Maximal marginal relevance over groups.
  const picked = [];
  const groups = {};
  const pool = scored.sort((a, b) => b.score - a.score);
  while (picked.length < n && pool.length) {
    let bi = 0;
    let bv = -Infinity;
    for (let i = 0; i < Math.min(pool.length, 60); i++) {
      const c = pool[i];
      const v = c.score * (1 - diversity) ** (groups[c.group] || 0);
      if (v > bv) [bi, bv] = [i, v];
    }
    const [c] = pool.splice(bi, 1);
    groups[c.group] = (groups[c.group] || 0) + 1;
    picked.push(c);
  }
  return picked;
}
function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// ---- Help: every app's guide lives in Quadra Hub -----------------------------------------

export const helpUrl = (app, topic = '') => appUrl('vocab', `help=${app}${topic ? `:${topic}` : ''}`);

// ---- Screens -----------------------------------------------------------------------------

const node = (tag, props = {}, children = []) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child) el.append(child);
  return el;
};
export { node as el };

const typedPass = text => cleanCode(text).replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 10);
// No maxlength: a pass is copied as ABCDE-23456 (11 characters), and a
// maxlength of 10 cut its last character off before the dash was taken out.
function passInput(label) {
  const input = node('input', { class: 'q-pass-input', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', placeholder: 'ABCDE23456', 'aria-label': label });
  input.addEventListener('input', () => {
    input.value = typedPass(input.value);
  });
  return input;
}
const ERR = {
  SYNC_PASSCODE_NOT_FOUND: ['找不到這組通行碼。', 'No Quadra Pass has this code.'],
  ECO_PAIR_NOT_FOUND: ['這組裝置代碼無效或已過期（10 分鐘內、只能用一次）。', 'That device code isn’t valid or has expired (10 minutes, once).'],
  RATE_LIMITED: ['嘗試太多次，請稍後再試。', 'Too many tries. Please wait a little.'],
  ECO_PLUS_FUNDS: ['Quadra 餘額不足以支付本月會費。', 'Your Quadra balance doesn’t cover this month’s fee.'],
  ECO_SESSION_MOVED: ['帳戶正在另一個 App 使用中，回到這裡後再試一次。', 'Your account is in use in another app. Come back here and try again.'],
  INVALID_PASSCODE: ['請輸入 10 碼通行碼（例如 ABCDE-23456）或 8 碼裝置代碼。', 'Enter your 10-character pass (like ABCDE-23456) or an 8-character device code.']
};
export const errorText = (error, lang) => {
  const e = ERR[error?.code];
  if (e) return lang === 'en' ? e[1] : e[0];
  return lang === 'en' ? 'Couldn’t reach Quadra. Check the connection and try again.' : '無法連線到 Quadra，請檢查網路後再試一次。';
};

// Quadra's own screens (sign-in, install, "in use elsewhere") always sit on
// top of everything: each is a modal <dialog> on the browser's top layer,
// where no z-index of an app can reach it, and if an app opens a sheet of
// its own while one is up, the Quadra screen is put back on top at once.
// Esc doesn't close them.
const onTop = new Set();
let topWatch = null;
function keepOnTop(dialog) {
  dialog.addEventListener('cancel', e => e.preventDefault());
  document.body.append(dialog);
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute('open', '');
  }
  onTop.add(dialog);
  topWatch ||= new MutationObserver(records => {
    if (!records.some(r => r.target !== dialog && r.target.tagName === 'DIALOG' && r.target.open && !onTop.has(r.target))) return;
    for (const d of onTop) {
      if (!d.isConnected || !d.open) continue;
      d.close();
      try {
        d.showModal();
      } catch {}
    }
  });
  topWatch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  return dialog;
}
function dropFromTop(dialog) {
  if (!dialog) return;
  onTop.delete(dialog);
  if (dialog.open) dialog.close();
  dialog.remove();
}

// The sign-in screen: nothing of the app shows until there's a pass.
function signInGate(s) {
  const en = s.lang === 'en';
  const a = APPS[s.app];
  document.getElementById('loading')?.setAttribute('hidden', '');
  return new Promise(resolve => {
    const input = passInput(BRAND.pass);
    const error = node('p', { class: 'q-gate-error', role: 'alert' });
    const enter = node('button', { class: 'q-btn primary block', type: 'submit', text: en ? 'Sign in' : '登入' });
    const make = node('button', { class: 'q-btn block', type: 'button', text: en ? 'Create a new Quadra Pass' : '建立新的 Quadra Pass' });
    const busy = on => [enter, make, input].forEach(b => (b.disabled = on));
    const done = async task => {
      busy(true);
      error.textContent = '';
      try {
        const res = await task();
        dropFromTop(gate);
        document.documentElement.classList.remove('q-signing-in');
        resolve(res);
      } catch (e) {
        error.textContent = errorText(e, s.lang);
        busy(false);
      }
    };
    const form = node(
      'form',
      {
        class: 'q-gate-form',
        onsubmit: event => {
          event.preventDefault();
          const code = cleanCode(input.value);
          if (!PASS_PATTERN.test(code) && !DEVICE_CODE_PATTERN.test(code)) return void (error.textContent = errorText({ code: 'INVALID_PASSCODE' }, s.lang));
          done(() => s.login(code));
        }
      },
      [node('label', { class: 'q-gate-label', text: en ? 'Your Quadra Pass or a device code' : 'Quadra Pass 或裝置代碼' }), input, error, enter]
    );
    make.addEventListener('click', () => done(async () => {
      const res = await s.create();
      await showNewPass(s, res.passcode);
      return res;
    }));
    const gate = node('dialog', { class: 'q-gate', 'aria-modal': 'true', style: `--q-accent:${a.color}` }, [
      node('div', { class: 'q-gate-box' }, [
        node('img', { class: 'q-gate-icon', src: './favicon.svg', alt: '', width: '72', height: '72' }),
        node('p', { class: 'q-gate-brand', text: a.related ? (en ? 'WITH QUADRA' : 'QUADRA 相關服務') : 'QUADRA' }),
        node('h1', { class: 'q-gate-title', text: a.name }),
        node('p', { class: 'q-gate-lede', text: en ? 'Sign in with your Quadra Pass: one account for every Quadra app.' : '用 Quadra Pass 登入：所有 Quadra App 共用一個帳戶。' }),
        form,
        node('div', { class: 'q-gate-or', text: en ? 'New to Quadra?' : '第一次使用？' }),
        make,
        node('p', { class: 'q-gate-note', text: en ? 'Signed in on another device? Its Account sheet gives a device code for this one.' : '已在其他裝置登入？在那裡的「帳戶」取得裝置代碼，就能在這裡登入。' })
      ])
    ]);
    document.documentElement.classList.add('q-signing-in');
    // Alone on screen: any sheet the app had open closes first.
    for (const d of document.querySelectorAll('dialog[open]')) if (!onTop.has(d)) d.close();
    keepOnTop(gate);
    setTimeout(() => input.focus(), 50);
  });
}

// "Quadra is open in another app": this one waits.
let movedEl = null;
function showMoved(s) {
  if (movedEl || typeof document === 'undefined') return;
  const en = s.lang === 'en';
  const where = s.live?.app && APPS[s.live.app] ? APPS[s.live.app].name : en ? 'another app' : '另一個 App';
  const same = s.live?.app === s.app;
  movedEl = node('dialog', { class: 'q-moved', 'aria-modal': 'true' }, [
    node('div', { class: 'q-moved-box' }, [
      node('p', { class: 'q-moved-title', text: same ? (en ? 'Open on another device' : '已在其他裝置使用') : en ? `In use in ${where}` : `正在 ${where} 使用中` }),
      node('p', { class: 'q-moved-text', text: en ? 'Quadra runs in one app at a time. This one paused so nothing gets out of step.' : 'Quadra 一次只在一個 App 使用，這裡先暫停，資料才不會互相覆蓋。' }),
      node('button', {
        class: 'q-btn primary block',
        type: 'button',
        text: en ? 'Continue here' : '在這裡繼續',
        onclick: async event => {
          event.currentTarget.disabled = true;
          try {
            await s.claim();
          } finally {
            if (movedEl) movedEl.querySelector('button').disabled = false;
          }
        }
      })
    ])
  ]);
  keepOnTop(movedEl);
}
function hideMoved() {
  dropFromTop(movedEl);
  movedEl = null;
}

// ---- The account sheet: the same in every app ---------------------------------------------
//
// accountSheet(s, { extra }) opens a sheet with the pass, the pool, the
// apps, and the security actions. `extra`: an element the app adds (its
// own settings).

// extra(): the app's own settings for the sheet (an element), optional.
// The button is the account's badge (a person in the Quadra mark's colours),
// never the balance: the balance lives inside the sheet.
const PERSON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6"/></svg>';
export function accountButton(s, { extra = null } = {}) {
  const btn = node('button', { class: 'q-account', type: 'button', 'aria-label': s.lang === 'en' ? 'Quadra Pass' : 'Quadra Pass 帳戶', title: BRAND.pass });
  const dot = node('span', { class: 'q-account-dot', 'aria-hidden': 'true' });
  // The avatar worn (a Plus member's), else the person.
  const paint = () => {
    const a = avatarOf(s.wallet);
    const f = frameOf(s.wallet);
    btn.replaceChildren();
    for (const c of [...btn.classList]) if (c.startsWith('q-frame-')) btn.classList.remove(c);
    if (f) btn.classList.add('q-framed', `q-frame-${f.id}`);
    else btn.classList.remove('q-framed');
    if (a) btn.append(node('span', { class: 'q-avatar', 'aria-hidden': 'true', text: a.glyph }));
    else btn.innerHTML = PERSON_SVG;
    btn.append(dot);
    btn.classList.toggle('signed', Boolean(s.wallet));
    btn.classList.toggle('plus', plusMember(s.wallet));
  };
  paint();
  s.on('wallet', paint);
  btn.addEventListener('click', () => accountSheet(s, { extra: extra ? extra() : null }));
  return btn;
}

// ---- Dialogs: Quadra's own, never the browser's alert/confirm ---------------------------
//
// ask({ title, body, ok, cancel, danger }) resolves true or false; tell({
// title, body, ok }) resolves once closed. A centred card over the page (and
// over an open sheet), Esc or a tap outside cancels.
// `points`: short rows ([icon, title, line]) under the body, instead of a
// paragraph that says the same.
export function ask({ title, body = '', points = [], ok = '', cancel = '', danger = false, icon = '', lang = detectLang(), alertOnly = false } = {}) {
  const en = lang === 'en';
  return new Promise(resolve => {
    const dialog = node('dialog', { class: `q-ask${danger ? ' danger' : ''}`, 'aria-labelledby': 'q-ask-title' });
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      dialog.classList.add('out');
      setTimeout(() => {
        dialog.close();
        dialog.remove();
      }, 140);
      resolve(value);
    };
    const okBtn = node('button', { class: `q-btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: ok || (alertOnly ? (en ? 'OK' : '好') : en ? 'Continue' : '繼續'), onclick: () => finish(true) });
    dialog.append(
      ...[
      icon ? node('div', { class: 'q-ask-icon', 'aria-hidden': 'true', text: icon }) : null,
      node('h2', { id: 'q-ask-title', class: 'q-ask-title', text: title }),
      body ? node('p', { class: 'q-ask-body', text: body }) : null,
      points.length
        ? node('ul', { class: 'q-ask-points' }, points.map(([mark, head, line]) => node('li', {}, [node('span', { class: 'q-ask-mark', 'aria-hidden': 'true', text: mark }), node('span', {}, [node('strong', { text: head }), line ? node('small', { text: line }) : null].filter(Boolean))])))
        : null,
      node('div', { class: 'q-ask-actions' }, [
        alertOnly ? null : node('button', { class: 'q-btn', type: 'button', text: cancel || (en ? 'Cancel' : '取消'), onclick: () => finish(false) }),
        okBtn
      ])
      ].filter(Boolean)
    );
    dialog.addEventListener('cancel', event => (event.preventDefault(), finish(alertOnly)));
    dialog.addEventListener('click', event => event.target === dialog && finish(alertOnly));
    document.body.append(dialog);
    dialog.showModal();
    (alertOnly || !danger ? okBtn : dialog.querySelector('.q-btn:not(.danger)'))?.focus();
  });
}
export const tell = (opts = {}) => ask({ ...opts, alertOnly: true }).then(() => undefined);

// The next payday: the 1st of next Taiwan month.
export function nextPayday(now = Date.now()) {
  const d = new Date(now + TPE);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - TPE;
}
export function paydayText(lang, now = Date.now()) {
  const d = new Date(nextPayday(now) + TPE);
  const next = `${d.getUTCMonth() + 1}/1`;
  const amount = money(ECONOMY.monthly);
  return lang === 'en'
    ? `Next pay ${amount} · ${next}`
    : `下次發薪 ${amount} · ${next}`;
}

// The account at a glance: its number, since when, this month's money in
// and out, and the latest entries (every app's, like a bank statement).
// An entry that moved money (free bet tokens are amount 0).
const moved = e => e.amount !== 0;
export function accountDetails(wallet, lang = 'zh', now = Date.now()) {
  const entries = [...(wallet?.entries || [])].sort((a, b) => b.t - a.t);
  const month = taipeiDay(now).slice(0, 7);
  const thisMonth = entries.filter(e => taipeiDay(e.t).slice(0, 7) === month);
  const sum = list => Math.round(list.reduce((x, e) => x + e.amount, 0) * 100) / 100;
  return {
    created: Number.isFinite(wallet?.created) ? wallet.created : null,
    in: sum(thisMonth.filter(e => e.amount > 0)),
    out: sum(thisMonth.filter(e => e.amount < 0)),
    count: thisMonth.filter(moved).length,
    recent: entries.filter(moved).slice(0, 8).map(e => ({ t: e.t, amount: e.amount, text: describeEntry(e, lang), app: e.app }))
  };
}
const accountNumber = id => (id ? `QP ${id.slice(0, 4).toUpperCase()} ${id.slice(4, 8).toUpperCase()} ${id.slice(8, 12).toUpperCase()}` : '');
function detailsCard(s) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const d = accountDetails(s.wallet, s.lang);
  const date = t => new Date(t).toLocaleDateString(en ? 'en-US' : 'zh-TW', { year: 'numeric', month: 'short', day: 'numeric' });
  const short = t => new Date(t).toLocaleDateString(en ? 'en-US' : 'zh-TW', { month: 'numeric', day: 'numeric' });
  const days = d.created ? Math.max(1, Math.round((Date.now() - d.created) / 86_400_000)) : 0;
  return node('div', { class: 'q-details' }, [
    node('div', { class: 'q-card-hero' }, [
      node('div', { class: 'q-hero-top' }, [node('span', { class: 'q-hero-brand', text: 'QUADRA PASS' }), node('span', { class: 'q-hero-no num', text: accountNumber(s.pass) })]),
      node('span', { class: 'q-hero-label', text: T('Quadra 餘額', 'Quadra balance') }),
      node('strong', { class: 'q-hero-balance num', text: money(s.pool) }),
      node('span', { class: 'q-hero-sub', text: d.created ? T(`${date(d.created)} 開戶 · 第 ${days} 天`, `Opened ${date(d.created)} · day ${days}`) : '' })
    ]),
    node('div', { class: 'q-month' }, [
      node('div', {}, [node('small', { text: T('本月收入', 'In this month') }), node('strong', { class: 'num up', text: money(d.in, { sign: true }) })]),
      node('div', {}, [node('small', { text: T('本月支出', 'Out this month') }), node('strong', { class: 'num down', text: money(d.out) })])
    ]),
    overdraft(s.wallet) > 0 ? node('p', { class: 'q-overdraft', text: T(`帳戶透支 ${money(overdraft(s.wallet))}：每月計息 1%。2 天內沒補足就是違約交割：扣 7% 違約金、賣出持股，5 年內不能融資。`, `Overdrawn by ${money(overdraft(s.wallet))}: 1% a month. Not covered within 2 days, it's a default: a 7% penalty, holdings sold, and no margin for 5 years.`) }) : null,
    node('p', { class: 'q-payday', text: paydayText(s.lang) }),
    d.recent.length
      ? node('details', { class: 'q-recent' }, [
          node('summary', { text: T(`最近明細（本月 ${d.count} 筆）`, `Latest entries (${d.count} this month)`) }),
          node(
            'ul',
            {},
            d.recent.map(e => node('li', {}, [node('span', { class: 'q-recent-when num', text: short(e.t) }), node('span', { class: 'q-recent-what', text: e.text }), node('strong', { class: `num ${e.amount < 0 ? 'down' : 'up'}`, text: money(e.amount, { sign: true }) })]))
          )
        ])
      : null
  ].filter(Boolean));
}
// ---- Quadra Plus on screen --------------------------------------------------------
//
// What joining costs now: free the first time, else the rest of the month's
// share of the fee (the Worker's own rule, eco.js plusJoinEntry).
export function plusJoinPrice(wallet, now = Date.now()) {
  if (!plusTried(wallet)) return 0;
  const d = new Date(now + TPE);
  const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const left = days - d.getUTCDate() + 1;
  return Math.max(10, Math.round((PLUS.fee * left) / days / 10) * 10);
}
export function plusPerks(lang = 'zh') {
  const en = lang === 'en';
  const pct = x => `${Math.round(x * 1000) / 10}%`;
  const o = PLUS.odds;
  return [
    ['odds', en ? `A ${money(o.bonusBet)} free bet every week` : `每週 ${money(o.bonusBet)} 免費投注`, en ? `One ${money(o.bonusBet)} free bet each Monday (4 or 5 a month); keep what it wins` : `每週一送 1 張 ${money(o.bonusBet)}（一個月 4 到 5 張），贏了獎金歸你`],
    ['odds', en ? `Parlay boost ×${o.boost}` : `串關加成 ×${o.boost}`, en ? 'Every winning combination of 3 picks or more' : '3 關以上每個贏的組合'],
    ['odds', en ? 'Better cash out' : '提前兌現更划算', en ? `Keeps ${pct(o.cashOutKeep)} instead of 5%` : `只扣 ${pct(o.cashOutKeep)}，一般扣 5%`],
    ['stock', en ? `Commission ${pct(1 - PLUS.stock.commission)} off` : `證券手續費 ${Math.round(PLUS.stock.commission * 100) / 10} 折`, en ? 'Every market, every order' : '所有市場、每一筆委託'],
    ['stock', en ? 'FX at half the spread' : '換匯點差減半', en ? 'Every currency' : '所有幣別'],
    ['stock', en ? `Margin ${pct(PLUS.stock.loanCut)} cheaper` : `融資利率少 ${pct(PLUS.stock.loanCut)}`, en ? 'On every new loan, every currency' : '每筆新借款、所有幣別'],
    ['looks', en ? 'Your avatar and frame' : '自訂頭像與頭像框', en ? 'Chosen in Quadra Hub, shown in every app while you’re a member; stay 3, 6 or 12 months in a row for the rarest' : '在 Quadra Hub 挑選，會員期間所有 App 都看得到；連續訂閱 3、6、12 個月解鎖限定款']
  ];
}
// What Plus gave back, at face value, from the wallet: the weekly bonus
// bets received (not the welcome offer) and what Play's bigger parlay boost
// added (kind 'plusboost'). This Taiwan month, or (all) every month up to it.
export function plusReturns(wallet, now = Date.now(), { all = false } = {}) {
  const month = plusMonth(now);
  const counts = m => (all ? m <= month : m === month);
  let boosts = 0;
  let bets = 0;
  for (const e of wallet?.entries || []) {
    if (typeof e.t !== 'number' || !counts(plusMonth(e.t))) continue;
    if (e.kind === 'plusboost' && e.amount > 0) boosts += e.amount;
    if (e.app === 'eco' && e.kind === 'freebet' && /^eco:fb:\d{4}-/.test(e.id || '')) bets += freeBetValue(e);
  }
  return { boosts: Math.round(boosts), bets, total: Math.round(boosts) + bets };
}
// Months a member so far (a yearly plan's later months don't count yet).
export const plusTenure = (wallet, now = Date.now()) => [...plusMonths(wallet)].filter(m => m <= plusMonth(now)).length;

// Plus's notices, once each per device (a banner in the app; the kit's
// notify): the week's bonus bet when it arrives, and, in the last three
// Taiwan days before a renewal, what it will charge and what it gave back,
// with where to stop it (the free month included, so nobody is surprised).
export function plusNotices(s, now = Date.now()) {
  const w = s.wallet;
  if (!w) return;
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  // A renewal the balance couldn't cover: said once.
  const failed = (w.entries || []).filter(e => e.app === 'eco' && e.id?.startsWith('eco:plusfail:')).at(-1);
  if (failed && plusLapsed(w) && readStore('quadra.seen.plusfail') !== failed.id) {
    writeStore('quadra.seen.plusfail', failed.id);
    notify(s, { title: T('✦ Plus 扣款失敗，會員已停止', '✦ Plus payment failed; membership stopped'), body: T(`餘額不足 ${money(PLUS.fee)}。補足後到 Plus 重新加入。`, `Your balance didn’t cover ${money(PLUS.fee)}. Join again from Plus once it does.`), tag: failed.id, kind: 'plus' });
  }
  if (!plusMember(w, now)) return;
  const week = (w.entries || []).find(e => e.app === 'eco' && e.id === `eco:fb:${taipeiDay(weekMonday(now))}`);
  if (week && readStore('quadra.seen.fb') !== week.id) {
    writeStore('quadra.seen.fb', week.id);
    notify(s, { title: T(`✦ 本週 ${money(freeBetValue(week))} 免費投注到了`, `✦ Your ${money(freeBetValue(week))} free bet is here`), body: T('在 Play 的投注單上點一下就能用，7 天內有效。', 'Tap it on a slip in Play; it lasts 7 days.'), tag: week.id, kind: 'plus' });
  }
  const month = plusMonth(now);
  const next = new Date(nextPayday(now) + TPE);
  const daysLeft = Math.ceil((nextPayday(now) - now) / 86_400_000);
  const yearly = plusPlan(w) === 'year';
  // A yearly plan renews after its last paid month; a monthly one every month.
  const due = plusRenewing(w) && daysLeft <= 3 && (!yearly || plusUntil(w) === month);
  const key = `quadra.seen.renew:${month}`;
  if (!due || readStore(key)) return;
  writeStore(key, '1');
  const fee = yearly ? PLUS.year : PLUS.fee;
  const back = plusReturns(w, now);
  const trial = (w.entries || []).some(e => e.id === `eco:plus:${month}` && e.note === 'trial');
  const date = `${next.getUTCMonth() + 1}/1`;
  notify(s, {
    title: trial ? T(`✦ Plus 免費試用到本月底，${date} 起 ${money(fee)}`, `✦ Your free Plus month ends; ${money(fee)} from ${date}`) : T(`✦ Plus 將在 ${date} 續訂 ${money(fee)}`, `✦ Plus renews on ${date} for ${money(fee)}`),
    body: T(`本月回饋 ${money(back.total)} · 可在 Plus › 管理會員取消`, `${money(back.total)} back this month · stop under Plus › Manage`),
    tag: key,
    kind: 'plus'
  });
}
// The Monday (Taiwan) a moment's week starts.
function weekMonday(t) {
  const d = new Date(t + TPE);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)) - TPE;
}
const PLUS_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.6 6.9 6.9 2.6-6.9 2.6L12 21.5l-2.6-6.9L2.5 12l6.9-2.6z"/></svg>';
function plusGlyph() {
  const i = node('span', { class: 'q-plus-glyph' });
  i.innerHTML = PLUS_MARK;
  return i;
}
// The membership as a card: a member's status, or what it gives and costs.
export function plusCard(s, { compact = false } = {}) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const member = plusMember(s.wallet);
  const renewing = plusRenewing(s.wallet);
  const next = new Date(nextPayday() + TPE);
  const nextText = `${next.getUTCMonth() + 1}/1`;
  const price = plusJoinPrice(s.wallet);
  const until = plusUntil(s.wallet);
  const untilText = until ? `${until.slice(0, 4)}/${Number(until.slice(5))}` : '';
  const back = member ? plusReturns(s.wallet).total : 0;
  const pct = x => `${Math.round(x * 100)}%`;
  const pitch = member
    ? back > 0
      ? T(`本月會員回饋 ${money(back)}`, `Plus gave you ${money(back)} this month`)
      : T(`每週 ${money(PLUS.odds.bonusBet)} 免費投注 · 證券手續費 ${Math.round(PLUS.stock.commission * 100) / 10} 折`, `${money(PLUS.odds.bonusBet)} free bet weekly · ${pct(1 - PLUS.stock.commission)} off commission`)
    : T(`每週 ${money(PLUS.odds.bonusBet)} 免費投注 · 串關加成 ×${PLUS.odds.boost} · 證券手續費 ${Math.round(PLUS.stock.commission * 100) / 10} 折`, `${money(PLUS.odds.bonusBet)} free bet weekly · parlay boost ×${PLUS.odds.boost} · ${pct(1 - PLUS.stock.commission)} off commission`);
  const status = member
    ? plusPlan(s.wallet) === 'year'
      ? T(`年繳會員 · 有效至 ${untilText}`, `Yearly member · through ${untilText}`)
      : renewing
        ? T(`會員 · ${nextText} 續訂 ${money(PLUS.fee)}`, `Member · renews ${nextText} for ${money(PLUS.fee)}`)
        : T(`會員 · 用到本月底`, 'Member · until the end of the month')
    : price === 0
      ? T(`本月免費 · 年繳只要 ${money(Math.round(PLUS.year / 12))}/月`, `Free this month · ${money(Math.round(PLUS.year / 12))}/mo yearly`)
      : T(`年繳 ${money(PLUS.year)}，省下兩個月`, `${money(PLUS.year)} a year: two months free`);
  return node('button', { class: `q-plus-card${member ? ' member' : ''}${compact ? ' compact' : ''}`, type: 'button', onclick: () => openPlus(s) }, [
    node('span', { class: 'q-plus-top' }, [plusGlyph(), node('span', { class: 'q-plus-word', text: 'QUADRA PLUS' }), node('span', { class: 'q-plus-go', text: member ? T('管理', 'Manage') : price === 0 ? T('免費試用', 'Try free') : T('加入', 'Join') })]),
    compact ? null : node('span', { class: 'q-plus-pitch', text: pitch }),
    node('span', { class: 'q-plus-status', text: status })
  ].filter(Boolean));
}
// The membership sheet: the perks, the price, join or leave.
export function openPlus(s) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const dialog = node('dialog', { class: 'q-sheet q-plus-sheet' });
  const close = () => dialog.close();
  const note = node('p', { class: 'q-sheet-note', role: 'status' });
  const body = node('div', { class: 'q-plus-body' });
  // The plan picked: yearly unless a free month is on offer.
  let plan = plusTried(s.wallet) ? 'year' : 'month';
  const paint = () => {
    const member = plusMember(s.wallet);
    const renewing = plusRenewing(s.wallet);
    const price = plusJoinPrice(s.wallet);
    const next = new Date(nextPayday() + TPE);
    const nextText = T(`${next.getUTCMonth() + 1} 月 1 日`, `${next.getUTCMonth() + 1}/1`);
    const run = (label, fn, cls) =>
      node('button', {
        class: cls,
        type: 'button',
        text: label,
        onclick: async event => {
          const b = event.currentTarget;
          b.disabled = true;
          note.textContent = '';
          try {
            await fn();
            paint();
          } catch (e) {
            note.textContent = errorText(e, s.lang);
            b.disabled = false;
          }
        }
      });
    // Joining charges the pass: asked first, with what it costs from here on.
    const join = async () => {
      const yearly = plan === 'year';
      const title = yearly ? T(`年繳 ${money(PLUS.year)} 加入 Plus？`, `Join Plus yearly for ${money(PLUS.year)}?`) : price === 0 ? T('免費試用 Plus？', 'Try Plus free?') : T(`月繳加入 Plus，本月 ${money(price)}？`, `Join Plus monthly, ${money(price)} this month?`);
      const body = yearly
        ? T('一次付清，用 12 個月，之後每年自動續約，隨時可以取消。', 'Paid once for 12 months, then renews yearly; cancel any time.')
        : price === 0
          ? T(`本月免費；${nextText}起每月 ${money(PLUS.fee)}，隨時可以取消。`, `Free this month; ${money(PLUS.fee)} a month from ${nextText}, cancel any time.`)
          : T(`${nextText}起每月 ${money(PLUS.fee)} 自動續訂，隨時可以取消。`, `Then ${money(PLUS.fee)} a month from ${nextText}, cancel any time.`);
      if (!(await ask({ lang: s.lang, icon: '✦', title, body, ok: yearly || price ? T('付款加入', 'Pay and join') : T('開始試用', 'Start trial'), cancel: T('先不要', 'Not now') }))) return;
      await s.plus(true, plan);
    };
    const saving = PLUS.fee * 12 - PLUS.year;
    const planPick = node('div', { class: 'q-plus-plans', role: 'radiogroup' }, [
      ['year', T('年繳', 'Yearly'), `${money(PLUS.year)}`, T(`每月只要 ${money(Math.round(PLUS.year / 12))} · 省 ${money(saving)}`, `${money(Math.round(PLUS.year / 12))}/mo · save ${money(saving)}`), T('最划算', 'Best value')],
      ['month', T('月繳', 'Monthly'), `${money(PLUS.fee)}`, price === 0 ? T('本月免費試用', 'This month free') : T('隨時取消', 'Cancel any time'), '']
    ].map(([key, name, amount, sub, badge]) =>
      node('button', { class: `q-plus-plan${plan === key ? ' on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(plan === key), onclick: () => ((plan = key), paint()) }, [
        badge ? node('span', { class: 'q-plus-badge', text: badge }) : null,
        node('span', { class: 'q-plus-plan-name', text: name }),
        node('strong', { class: 'num', text: amount }),
        node('small', { text: sub })
      ].filter(Boolean))
    ));
    // Stopping is one confirmation away, with what it gave back and what
    // stays or stops, so the choice is an informed one.
    const leave = async () => {
      const month = plusReturns(s.wallet);
      const ever = plusReturns(s.wallet, Date.now(), { all: true });
      const points = [
        ['✓', T('會保留', 'You keep'), T('已付的月份、還沒用的免費投注', 'Months paid, free bets not yet used')],
        ['✕', T('之後沒有', 'You lose'), T(`每週 ${money(PLUS.odds.bonusBet)} 免費投注、串關加成、手續費折扣、頭像與頭像框`, `The ${money(PLUS.odds.bonusBet)} weekly free bet, the parlay boost, the commission discount, your avatar and frame`)]
      ];
      const body = T(`本月回饋 ${money(month.total)} · 累計 ${money(ever.total)}`, `${money(month.total)} back this month · ${money(ever.total)} in all`);
      if (!(await ask({ lang: s.lang, icon: '✦', title: T('取消自動續訂？', 'Stop renewing?'), body, points, ok: T('取消續訂', 'Stop renewing'), cancel: T('保留會員', 'Keep Plus') }))) return;
      await s.plus(false);
    };
    const until = plusUntil(s.wallet);
    const untilText = until ? T(`${until.slice(0, 4)} 年 ${Number(until.slice(5))} 月底`, `the end of ${until}`) : '';
    const yearly = plusPlan(s.wallet) === 'year';
    const cta = member
      ? [
          node('p', { class: 'q-plus-state', text: yearly ? T(`你是年繳會員，權益有效至 ${untilText}${renewing ? '，到期自動續約一年' : ''}。`, `You're a yearly member through ${untilText}${renewing ? ', renewing for another year' : ''}.`) : renewing ? T(`你是 Plus 會員。${nextText}從 Quadra 餘額續訂 ${money(PLUS.fee)}。`, `You're a Plus member. It renews ${nextText} for ${money(PLUS.fee)} from your Quadra balance.`) : T(`會員權益用到本月底，${nextText}不會扣款。`, `Your perks last to the end of the month; nothing is charged ${nextText}.`) }),
          yearly ? null : run(T(`升級年繳 · ${money(PLUS.year)}，再省 ${money(PLUS.fee * 12 - PLUS.year)}`, `Go yearly · ${money(PLUS.year)}, save ${money(PLUS.fee * 12 - PLUS.year)}`), () => s.plus(true, 'year'), 'q-plus-cta'),
          renewing ? null : run(T('恢復自動續訂', 'Turn renewal back on'), () => s.plus(true, plusPlan(s.wallet)), 'q-plus-cta'),
          node('details', { class: 'q-plus-manage' }, [node('summary', { text: T('管理會員', 'Manage membership') }), renewing ? run(T('取消自動續訂', 'Stop renewing'), leave, 'q-plus-quiet') : node('p', { class: 'q-plus-fine', text: T('已取消自動續訂。', 'Renewal is off.') })])
        ].filter(Boolean)
      : [
          planPick,
          run(plan === 'year' ? T(`年繳加入 · ${money(PLUS.year)}`, `Join yearly · ${money(PLUS.year)}`) : price === 0 ? T('免費試用到月底', 'Try it free this month') : T(`月繳加入 · 本月 ${money(price)}`, `Join monthly · ${money(price)} this month`), join, 'q-plus-cta'),
          node('p', { class: 'q-plus-fine', text: plan === 'year' ? T('十二個月立即生效，每年自動續約。', 'Twelve months from now, renews yearly.') : price === 0 ? T(`本月免費。${nextText}起每月 ${money(PLUS.fee)}，從 Quadra 餘額扣款。`, `Free this month. From ${nextText}, ${money(PLUS.fee)} a month from your Quadra balance.`) : T(`本月依剩下天數計費，之後每月 1 日 ${money(PLUS.fee)}。`, `This month by the days left, then ${money(PLUS.fee)} on the 1st.`) })
        ];
    const perks = plusPerks(s.lang);
    const group = (app, title) =>
      node('div', { class: 'q-plus-group' }, [
        node('h3', { class: 'q-sheet-h', text: title }),
        node('ul', { class: 'q-plus-perks' }, perks.filter(p => p[0] === app).map(([, a, b]) => node('li', {}, [plusGlyph(), node('span', {}, [node('strong', { text: a }), node('small', { text: b })])])))
      ]);
    // A member sees what Plus gave back this month; anyone else, the price.
    const back = plusReturns(s.wallet);
    body.replaceChildren(
      node('div', { class: `q-plus-hero${member ? ' member' : ''}` }, [
        node('span', { class: 'q-plus-top' }, [plusGlyph(), node('span', { class: 'q-plus-word', text: 'QUADRA PLUS' })]),
        member
          ? node('strong', { class: 'q-plus-price num', text: money(back.total) })
          : node('strong', { class: 'q-plus-price num', text: `${money(Math.round(PLUS.year / 12))}` }),
        node('span', { class: 'q-plus-per', text: member ? T('本月回饋給你（免費投注＋串關加成）', 'Back to you this month (free bets + parlay boost)') : T('每月起 · 一個會員，所有 Quadra App', 'a month, yearly · one membership, every Quadra app') }),
        // A member's three figures: the fee, how long, everything so far.
        member
          ? node('div', { class: 'q-plus-stats' }, [
              [T('月費', 'Fee'), money(PLUS.fee)],
              [T('會員', 'Member'), T(`第 ${plusTenure(s.wallet)} 個月`, `Month ${plusTenure(s.wallet)}`)],
              [T('累計回饋', 'In all'), money(plusReturns(s.wallet, Date.now(), { all: true }).total)]
            ].map(([k, v]) => node('div', {}, [node('small', { text: k }), node('strong', { class: 'num', text: v })])))
          : null
      ]),
      group('odds', 'Quadra Play'),
      group('stock', 'Quadra Securities'),
      group('looks', T('頭像與頭像框', 'Looks')),
      ...cta,
      node('p', { class: 'q-plus-fine', text: T('每月 1 日從 Quadra 餘額自動扣款，沒打開 App 也照扣；餘額不足扣款失敗，會員就停止。取消後用到期滿，已付不退費。價格含 5% 營業稅。', 'Charged from your Quadra balance on the 1st of every month, whether or not you open an app; a charge the balance can’t cover fails and the membership stops. Cancelling keeps what’s paid; nothing is refunded. Prices include 5% VAT.') })
    );
  };
  dialog.append(node('div', { class: 'q-sheet-head' }, [node('h2', { text: 'Quadra Plus' }), node('button', { class: 'q-close', type: 'button', 'aria-label': T('關閉', 'Close'), text: '×', onclick: close })]), body, note);
  paint();
  const repaint = () => dialog.open && paint();
  s.on('wallet', repaint);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', e => e.target === dialog && close());
  dialog.showModal();
  return dialog;
}

export function accountSheet(s, { extra = null } = {}) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const dialog = node('dialog', { class: 'q-sheet' });
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const note = node('p', { class: 'q-sheet-note', role: 'status' });
  const act = (label, fn, cls = 'q-row-btn') =>
    node('button', {
      class: cls,
      type: 'button',
      text: label,
      onclick: async event => {
        const b = event.currentTarget;
        b.disabled = true;
        try {
          await fn();
        } catch (e) {
          note.textContent = errorText(e, s.lang);
        } finally {
          b.disabled = false;
        }
      }
    });
  const tiles = node(
    'div',
    { class: 'q-apps' },
    Object.entries(APPS).map(([id, a]) =>
      node(
        'a',
        {
          class: `q-app${id === s.app ? ' here' : ''}${a.related ? ' related' : ''}`,
          href: appUrl(id),
          onclick: e => {
            e.preventDefault();
            if (id !== s.app) s.go(id);
          }
        },
        [node('img', { src: `${a.path}favicon.svg`, alt: '' }), node('span', { text: a.tile || a.short })]
      )
    )
  );
  // A device code, shown with its countdown.
  const device = node('div', { class: 'q-device', hidden: true });
  let tick = 0;
  const showCode = ({ code, exp }) => {
    clearInterval(tick);
    const left = node('span', { class: 'q-device-left' });
    const paint = () => {
      const ms = exp - Date.now();
      if (ms <= 0) {
        clearInterval(tick);
        device.hidden = true;
        return;
      }
      left.textContent = T(`${Math.ceil(ms / 60_000)} 分鐘內有效，只能用一次`, `Valid ${Math.ceil(ms / 60_000)} more min, once`);
    };
    device.replaceChildren(node('span', { class: 'q-device-label', text: T('裝置代碼', 'Device code') }), node('strong', { class: 'q-device-code num', text: formatPass(code) }), left, node('span', { class: 'q-device-how', text: T('在另一台裝置輸入這組代碼登入', 'Enter it on the other device to sign in') }));
    device.hidden = false;
    paint();
    tick = setInterval(paint, 15_000);
  };
  dialog.append(
    node('div', { class: 'q-sheet-head' }, [node('h2', { text: BRAND.pass }), node('button', { class: 'q-close', type: 'button', 'aria-label': T('關閉', 'Close'), text: '×', onclick: close })]),
    detailsCard(s),
    plusCard(s),
    node('h3', { class: 'q-sheet-h', text: T('Quadra 的 App', 'Quadra apps') }),
    tiles,
    ...(extra ? [extra] : []),
    node('h3', { class: 'q-sheet-h', text: T('裝置', 'Devices') }),
    node('div', { class: 'q-rows' }, [
      act(T('新增裝置（取得裝置代碼）', 'Add a device (get a device code)'), async () => showCode(await s.deviceCode())),
      device
    ]),
    node('h3', { class: 'q-sheet-h', text: T('通知', 'Notifications') }),
    ...notifyRows(s, note),
    node('h3', { class: 'q-sheet-h', text: T('帳戶安全', 'Security') }),
    node('div', { class: 'q-rows' }, [
      act(T('登出其他所有裝置', 'Sign out every other device'), async () => {
        if (!(await ask({ lang: s.lang, icon: '🔒', title: T('登出其他所有裝置？', 'Sign out every other device?'), body: T('除了這台，所有裝置都會登出。', 'Every device but this one is signed out.'), ok: T('全部登出', 'Sign them out'), danger: true }))) return;
        await s.signOutEverywhere();
        note.textContent = T('其他裝置都已登出。', 'Every other device is signed out.');
      }),
      act(T('更換通行碼', 'Change my pass'), async () => {
        if (!(await ask({ lang: s.lang, icon: '🔑', title: T('換一組新的通行碼？', 'Get a new pass?'), body: T('舊通行碼立即失效，其他裝置會登出。新通行碼只顯示一次。', 'The old pass stops working and other devices sign out. The new one is shown once.'), ok: T('換新通行碼', 'Get a new pass'), danger: true }))) return;
        const passcode = await s.rotate();
        // The sheet closes first: a modal sheet stays above everything else,
        // so the new pass would open behind it.
        close();
        await showNewPass(s, passcode);
      }),
      node('a', { class: 'q-row-btn', href: helpUrl(s.app), text: T(`${APPS[s.app].short} 使用說明`, `${APPS[s.app].short} guide`) }),
      s.app === 'vocab' ? null : act(T('在 Quadra Hub 管理帳戶與頭像', 'Manage your pass and looks in Quadra Hub'), () => s.go('vocab', 'pass')),
      act(
        T('在這台裝置登出', 'Sign out on this device'),
        async () => {
          if (!(await ask({ lang: s.lang, icon: '👋', title: T('在這台裝置登出？', 'Sign out on this device?'), body: T('這台裝置上的資料會全部清除，都保留在 Quadra Pass。', 'Everything on this device is wiped; it all stays on your Quadra Pass.'), ok: T('登出', 'Sign out') }))) return;
          s.signOut();
          location.reload();
        },
        'q-row-btn danger'
      )
    ].filter(Boolean)),
    node('p', { class: 'q-sheet-sub', text: T('忘記通行碼？在已登入的裝置按「更換通行碼」。', 'Forgot your pass? Choose “Change my pass” on a signed-in device.') }),
    note
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    clearInterval(tick);
    dialog.remove();
  });
  dialog.addEventListener('click', e => e.target === dialog && close());
  dialog.showModal();
  return dialog;
}

// A new pass, shown once: it can't be shown again, so it waits until it has
// been typed back (its last five characters), which also proves it was
// copied right. A modal <dialog>, so it sits above every other sheet and
// dialog and nothing behind it can be tapped.
export function showNewPass(s, passcode) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const shown = formatPass(passcode);
  const tail = String(passcode).replace(/[^0-9A-Za-z]/g, '').slice(-5).toUpperCase();
  return new Promise(resolve => {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    const ok = node('button', { class: 'q-btn primary block', type: 'button', text: T('我已經記下來了', 'I’ve saved it'), disabled: true });
    const copy = node('button', {
      class: 'q-btn small',
      type: 'button',
      text: T('複製', 'Copy'),
      onclick: () => navigator.clipboard?.writeText(shown).then(() => (copy.textContent = T('已複製', 'Copied')))
    });
    const hint = node('small', { class: 'q-newpass-hint' });
    const check = node('input', { class: 'q-pass-input q-newpass-check num', type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '5', placeholder: '•••••', 'aria-label': T('通行碼最後 5 個字', 'The last 5 characters of your pass') });
    check.addEventListener('input', () => {
      const typed = check.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      ok.disabled = typed !== tail;
      hint.textContent = typed.length === 5 && typed !== tail ? T('不對：請對照上面的通行碼。', 'That doesn’t match: check the pass above.') : '';
    });
    const box = node('dialog', { class: 'q-gate q-newpass', style: `--q-accent:${APPS[s.app].color}` }, [
      node('div', { class: 'q-gate-box' }, [
        node('p', { class: 'q-gate-brand', text: 'QUADRA PASS' }),
        node('h1', { class: 'q-gate-title', text: T('這是你的新通行碼', 'This is your new pass') }),
        node('div', { class: 'q-pass-code' }, [node('strong', { class: 'num', text: shown }), copy]),
        node('p', { class: 'q-gate-lede', text: T('只會顯示這一次，請記在安全的地方。', 'Shown only once: keep it somewhere safe.') }),
        node('label', { class: 'q-newpass-label', text: T('記好以後，輸入通行碼的最後 5 個字確認：', 'Once it’s saved, type its last 5 characters to confirm:') }),
        check,
        hint,
        ok
      ])
    ]);
    // Not closed by Esc or a tap outside: only by the confirmed button.
    ok.addEventListener('click', () => {
      dropFromTop(box);
      resolve();
    });
    keepOnTop(box);
  });
}

// ---- Notifications: the same in every app --------------------------------------------
//
// notify(s, { title, body, tag, hash }) shows an in-app banner while the app
// is on screen, and a system notification when it isn't (once allowed in
// the account sheet, per device). `tag` keeps one notice per thing (a slip,
// a match), `hash` is where tapping it goes, `kind` is its NOTICE_KINDS entry
// (a kind turned off in the account sheet is dropped).
//
// A phone stops an app in the background, so what's known ahead (a game's
// start, a class, a streak about to end) and what the Worker can find out
// itself (a final score, a price reached) goes to the Worker as a list,
// schedulePush(s, items), and arrives as a push notice while the app is
// closed (Shared-Proxy/push.js).

// Notices on for the pass (every app, every device) and allowed on this one.
export const notifyOn = () => notifyPrefs().on === true && globalThis.Notification?.permission === 'granted';

const PUSH_URL = ECO_URL.replace(/\/eco$/, '/push');
async function pushPost(s, path, body) {
  const token = await s.ensureToken?.().catch(() => s.token || '');
  if (!token) return null;
  // text/plain: no preflight request.
  return fetch(`${PUSH_URL}/${path}?qt=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
}
const keyBytes = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), c => c.charCodeAt(0));
// This device's push subscription, given to the Worker (again each day, or
// whenever it changes). False when this browser can't take pushes (an
// iPhone needs the app on the home screen, iOS 16.4 or later).
export async function enablePush(s, force = false) {
  if (!notifyOn() || !globalThis.navigator?.serviceWorker) return false;
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(r, 4000))]);
    if (!reg?.pushManager) return false;
    const { key } = await fetch(`${PUSH_URL}/key`).then(r => r.json());
    let sub = await reg.pushManager.getSubscription();
    // One made with another key is replaced.
    const own = sub?.options?.applicationServerKey ? btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === key : true;
    if (sub && !own) await sub.unsubscribe().catch(() => {});
    if (!sub || !own) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    const mark = `${sub.endpoint}|${new Date().toDateString()}`;
    const storeKey = `quadra.push.sub.${s.app}`;
    if (!force && readStore(storeKey) === mark) return true;
    if (await pushPost(s, 'subscribe', { sub: sub.toJSON(), lang: s.lang })) writeStore(storeKey, mark);
    return true;
  } catch {
    return false;
  }
}
// The app's coming notices, for the Worker to send while the app is closed:
// [{ at, title, body, tag, hash, kind, check, until }] (check: see push.js). The
// whole list each time (it replaces the last); sent only when it changed.
export async function schedulePush(s, items) {
  if (!s?.app) return;
  const storeKey = `quadra.push.list.${s.app}`;
  // Turned off: the Worker's list emptied too (once).
  if (!notifyOn()) {
    if (readStore(storeKey) && readStore(storeKey) !== '[]' && (await pushPost(s, 'schedule', { items: [] }))) writeStore(storeKey, '[]');
    return;
  }
  const base = `${globalThis.location?.origin || 'https://jaypengx.github.io'}${APPS[s.app]?.path || '/'}`;
  const list = items
    .filter(x => x && Number.isFinite(x.at) && kindOn(s.app, x.kind))
    .map(x => ({ at: Math.round(x.at), title: x.title || '', body: x.body || '', tag: `${s.app}:${x.tag || x.title}`, ...(x.kind ? { kind: x.kind } : {}), url: `${base}${x.hash ? `#${x.hash}` : ''}`, ...(x.check ? { check: x.check } : {}), ...(x.until ? { until: Math.round(x.until) } : {}) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, 60);
  const text = JSON.stringify(list);
  if (readStore(storeKey) === text && readStore(`quadra.push.sub.${s.app}`)) return;
  if (!(await enablePush(s))) return;
  if (await pushPost(s, 'schedule', { items: list })) writeStore(storeKey, text);
}

// Every kind of notice, by app: what it is and when it comes. Each can be
// turned off on its own; a kind that's off shows neither a banner nor a
// system notice, and the Worker drops it from what it sends while the app
// is closed.
export const NOTICE_KINDS = {
  match: [
    ['start', '比賽開打', 'A game starts', '你追蹤的球隊比賽開始時。', 'When a team you follow starts a game.'],
    ['end', '比賽結束', 'Final score', '你追蹤的球隊比賽結束，附上比分。', 'When a team you follow finishes a game, with the score.']
  ],
  odds: [
    ['slip', '投注單結算', 'Slip settled', '投注單的比賽全部結束、算好派彩時。', 'When every game on a slip is over and it’s paid.'],
    ['ticket', '彩券中獎', 'Lottery win', '電腦彩券開獎、你的彩券中獎時。', 'When a draw is out and your ticket won.'],
    ['plus', 'Plus 免費投注與續訂', 'Plus free bet and renewal', 'Plus 每週免費投注入帳，和續訂前三天的提醒。', 'When Plus’s weekly free bet arrives, and three days before it renews.']
  ],
  vocab: [
    ['streak', '連續練習快斷了', 'Streak ending', '今天還沒練習單字，連續天數今晚就會歸零時。', 'When you haven’t practised today and your streak ends tonight.']
  ],
  stock: [
    ['alert', '價格提醒', 'Price alert', '你設定的價格提醒到價時。', 'When a price alert you set is reached.'],
    ['fill', '委託成交', 'Order filled', '掛單或定期定額成交時，和定期定額扣款日當天。', 'When an order or a monthly plan is filled, and on a plan’s day.'],
    ['order', '委託未成交', 'Order not filled', '委託到期失效、被取消，或定期定額這個月跳過時。', 'When an order lapses or is dropped, or a monthly plan skips a month.'],
    ['margin', '維持率與斷頭', 'Margin call', '維持率偏低，或融資、放空被強制處理時。', 'When margin runs low, or a loan or short is force-closed.'],
    ['income', '股利與利息', 'Dividends and interest', '除息、股利入帳、債券配息和活存利息入帳時。', 'When a holding goes ex-dividend, and when dividends, coupons or interest arrive.']
  ],
  orbit: [['class', '上課提醒', 'Class reminder', '每堂課開始前 5 分鐘。', 'Five minutes before each class.']],
  weather: [
    ['brief', '早晨天氣', 'Morning weather', '每天早上一句話：降雨、溫度、紫外線、空氣。', 'Each morning in one line: rain, temperature, UV, air.'],
    ['rain', '降雨提醒', 'Rain alert', '白天 2 小時內可能下雨時，一天最多一次。', 'When rain is likely within 2 hours, once a day at most.']
  ]
};

// The switches belong to the pass, not the device: the wallet setting
// `notify` ({ on, off: ['stock:alert', …] }, newest wins), so every app and
// every device follows the same ones (apps on a phone's home screen don't
// even share storage). This device keeps a copy (`quadra.notify.prefs`, with
// the time it was set) for when it's offline, and sends a newer one up when
// its app is the live one. `on` is "system notices wanted"; each device (and,
// on an iPhone, each app) still has to be allowed once by the phone.
const PREFS_KEY = 'quadra.notify.prefs';
const cleanPrefs = v => ({
  ...(typeof v?.on === 'boolean' ? { on: v.on } : {}),
  off: [...new Set((Array.isArray(v?.off) ? v.off : []).filter(k => typeof k === 'string' && /^[a-z]+:[a-z]+$/.test(k)))].sort()
});
export function notifyPrefs() {
  const saved = readJson(PREFS_KEY, null);
  return saved && typeof saved === 'object' ? { ...cleanPrefs(saved), t: Number(saved.t) || 0 } : { off: [], t: 0 };
}
const samePrefs = (a, b) => a.on === b.on && a.off.join() === b.off.join();
function savePrefs(next, s) {
  const prefs = { ...cleanPrefs(next), t: Date.now() };
  writeStore(PREFS_KEY, JSON.stringify(prefs));
  if (s) syncPrefs(s);
  return prefs;
}
// Whether notices of this kind are wanted (every kind is, until turned off).
export const kindOn = (app, kind) => !kind || !notifyPrefs().off.includes(`${app}:${kind}`);
export function setKind(app, kind, on, s = null) {
  const prefs = notifyPrefs();
  const off = prefs.off.filter(k => k !== `${app}:${kind}`);
  if (!on) off.push(`${app}:${kind}`);
  return savePrefs({ ...prefs, off }, s);
}
export const setNotifyOn = (on, s = null) => savePrefs({ ...notifyPrefs(), on: Boolean(on) }, s);
// The pass's copy and this device's, made one: the newer wins; a newer (or
// never uploaded) copy here goes up when this app may write; the Worker's
// copy (for notices sent while the app is closed) follows.
let syncingPrefs = null;
export function adoptNotifyPrefs(wallet) {
  const held = wallet?.settings?.notify;
  const mine = notifyPrefs();
  if (!held?.value || !(Number(held.t) > mine.t)) return false;
  writeStore(PREFS_KEY, JSON.stringify({ ...cleanPrefs(held.value), t: Number(held.t) }));
  return true;
}
export async function syncPrefs(s) {
  if (!s?.wallet || syncingPrefs) return;
  syncingPrefs = (async () => {
    adoptNotifyPrefs(s.wallet);
    const mine = notifyPrefs();
    const held = s.wallet.settings?.notify;
    const heldPrefs = held?.value ? cleanPrefs(held.value) : null;
    const worth = mine.on !== undefined || mine.off.length;
    if (s.active && worth && (!heldPrefs || (mine.t > (Number(held.t) || 0) && !samePrefs(mine, heldPrefs)))) {
      const t = mine.t || Date.now();
      const { t: _, ...value } = mine;
      await s.write({ wallet: { settings: { notify: { value, t } } } }).catch(() => null);
      if (!mine.t) writeStore(PREFS_KEY, JSON.stringify({ ...mine, t }));
    }
    // The Worker's copy, once per change.
    const now = notifyPrefs();
    const text = JSON.stringify({ on: now.on !== false, off: now.off });
    if (readStore('quadra.push.prefs') !== text && (await pushPost(s, 'prefs', JSON.parse(text)))) writeStore('quadra.push.prefs', text);
  })().finally(() => (syncingPrefs = null));
  return syncingPrefs;
}

// Notices were turned on for the pass (on another device or in another
// app), but the phone hasn't been asked here yet: a banner offers it (the
// phone asks only after a tap). Not again for a week once closed.
function offerNotices(s) {
  if (typeof document === 'undefined' || !s.pass || !('Notification' in globalThis)) return;
  if (notifyPrefs().on !== true || Notification.permission !== 'default') return;
  const last = Number(readStore('quadra.notify.offered')) || 0;
  if (Date.now() - last < 7 * 86_400_000) return;
  const T = (zh, e) => (s.lang === 'en' ? e : zh);
  bannerEl?.remove();
  const el = node('div', { class: 'q-banner q-banner-ask', role: 'dialog', 'aria-label': T('開啟通知', 'Turn on notices'), style: `--q-accent:${APPS[s.app].color}` }, [
    node('img', { src: './favicon.svg', alt: '' }),
    node('div', {}, [node('strong', { text: T('在這裡也開啟通知？', 'Notices here too?') }), node('span', { text: T(`你的 Quadra Pass 開啟了通知，${APPS[s.app].short} 在這台裝置還需要允許一次。`, `Your Quadra Pass has notices on; ${APPS[s.app].short} on this device needs allowing once.`) })]),
    node('button', { class: 'q-banner-go', type: 'button', text: T('允許', 'Allow') }),
    node('button', { class: 'q-banner-x', type: 'button', 'aria-label': T('關閉', 'Close'), text: '×' })
  ]);
  const gone = () => {
    writeStore('quadra.notify.offered', String(Date.now()));
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('.q-banner-x').addEventListener('click', gone);
  el.querySelector('.q-banner-go').addEventListener('click', async () => {
    const p = await Notification.requestPermission().catch(() => 'denied');
    if (p === 'granted') enablePush(s, true);
    gone();
  });
  document.body.append(el);
  bannerEl = el;
}

// A switch: role=switch, aria-checked.
function toggle(on, label, onchange) {
  const b = node('button', { class: 'q-switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label });
  b.addEventListener('click', async () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    const ok = await onchange(next);
    if (ok !== false) b.setAttribute('aria-checked', String(next));
  });
  return b;
}

// The account sheet's notices: system notices for the pass (on, off, or
// not allowed yet by this phone), then every kind of notice with what it is
// and its own switch. All of them follow the pass to every app and device.
function notifyRows(s, note) {
  const en = s.lang === 'en';
  const T = (zh, e) => (en ? e : zh);
  const supported = 'Notification' in globalThis;
  const state = () => {
    if (!supported) return notifyPrefs().on ? T('已開啟；這個瀏覽器收不到通知', 'On; this browser can’t show them') : T('這個瀏覽器不支援', 'Not supported here');
    if (Notification.permission === 'denied') return T('這台裝置封鎖了通知：請到系統設定允許', 'Blocked on this device: allow them in system settings');
    if (notifyOn()) return T('開啟：每個 App、每台裝置', 'On: every app, every device');
    if (notifyPrefs().on) return T('已開啟；這台裝置還沒允許，點開關允許', 'On; not allowed on this device yet: tap to allow');
    return T('關閉', 'Off');
  };
  const sub = node('small', { class: 'q-notice-sub', text: state() });
  const master = node('div', { class: 'q-notice-row master' }, [
    node('span', { class: 'q-notice-icon', 'aria-hidden': 'true', text: '🔔' }),
    node('div', { class: 'q-notice-text' }, [node('strong', { text: T('系統通知', 'System notices') }), sub]),
    supported
      ? toggle(notifyOn(), T('系統通知', 'System notices'), async on => {
          if (!on) {
            setNotifyOn(false, s);
            sub.textContent = state();
            schedulePush(s, []);
            return true;
          }
          const p = await Notification.requestPermission().catch(() => 'denied');
          if (p === 'granted') {
            setNotifyOn(true, s);
            enablePush(s, true);
          } else note.textContent = T('請到系統設定允許通知。', 'Allow notifications in system settings.');
          sub.textContent = state();
          return p === 'granted';
        })
      : null
  ]);
  // This app's kinds first, then the rest.
  const order = [s.app, ...Object.keys(NOTICE_KINDS).filter(a => a !== s.app)].filter(a => NOTICE_KINDS[a] && APPS[a]);
  const groups = order.map(app =>
    node('div', { class: 'q-notice-group' }, [
      node('p', { class: 'q-notice-app', text: APPS[app].short }),
      ...NOTICE_KINDS[app].map(([kind, zh, e, dzh, de]) =>
        node('div', { class: 'q-notice-row' }, [
          node('div', { class: 'q-notice-text' }, [node('strong', { text: T(zh, e) }), node('small', { class: 'q-notice-sub', text: T(dzh, de) })]),
          toggle(kindOn(app, kind), T(zh, e), on => void setKind(app, kind, on, s))
        ])
      )
    ])
  );
  return [
    node('div', { class: 'q-rows' }, [master]),
    node('p', { class: 'q-notice-note', text: T('通知設定跟著 Quadra Pass：在每個 App、每台裝置都一樣。', 'Notice settings follow your Quadra Pass: the same in every app, on every device.') }),
    node('div', { class: 'q-rows q-notice-kinds' }, groups)
  ];
}

const shown = new Set();
export async function notify(s, { title, body = '', tag = '', hash = '', kind = '' }) {
  if (!kindOn(s.app, kind)) return;
  const key = `${s.app}:${tag || title}`;
  if (tag && shown.has(key)) return;
  if (tag) shown.add(key);
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return queueBanner(s, { title, body, hash });
  if (!notifyOn()) return;
  const options = { body, tag: key, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: `${APPS[s.app].path}${hash ? `#${hash}` : ''}` } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.showNotification) return void (await reg.showNotification(title, options));
    const n = new Notification(title, options);
    n.onclick = () => {
      globalThis.focus?.();
      if (hash) location.hash = hash;
      n.close();
    };
  } catch {}
}
// Notices that come together (the first sign-in on a device, catching up
// after a while away) are one banner: the first, and how many more.
let bannerQueue = null;
function queueBanner(s, notice) {
  if (bannerQueue) return void bannerQueue.push(notice);
  bannerQueue = [notice];
  setTimeout(() => {
    const list = bannerQueue;
    bannerQueue = null;
    if (list.length === 1) return banner(s, list[0]);
    const zh = !/^en/i.test(globalThis.navigator?.language || '');
    banner(s, { title: list[0].title, body: zh ? `還有 ${list.length - 1} 則通知` : `and ${list.length - 1} more`, hash: list[0].hash, more: list.slice(1) });
  }, 700);
}
let bannerEl = null;
function banner(s, { title, body, hash, more = [] }) {
  bannerEl?.remove();
  const el = node('div', { class: 'q-banner', role: 'status', style: `--q-accent:${APPS[s.app].color}` }, [
    node('img', { src: './favicon.svg', alt: '' }),
    node('div', {}, [node('strong', { text: title }), body ? node('span', { text: body }) : null])
  ]);
  const gone = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  };
  let open = false;
  el.addEventListener('click', () => {
    // A grouped banner: the first tap lists them all, the next closes it.
    if (more.length && !open) {
      open = true;
      el.classList.add('open');
      el.append(node('ul', { class: 'q-banner-more' }, more.map(n => node('li', {}, [node('strong', { text: n.title }), n.body ? node('span', { text: n.body }) : null]))));
      return;
    }
    if (hash) location.hash = hash;
    gone();
  });
  document.body.append(el);
  bannerEl = el;
  setTimeout(() => !open && gone(), more.length ? 7000 : 5000);
}

// ---- Shell: installed-only on phones, and always the newest version ------------------------

export function isStandalone() {
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.matchMedia?.('(display-mode: fullscreen)').matches || globalThis.navigator?.standalone);
}
export function isPhoneOrTablet() {
  const ua = globalThis.navigator?.userAgent || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  return /Macintosh/.test(ua) && (globalThis.navigator?.maxTouchPoints || 0) > 1;
}
const isIOS = () => /iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent || '') || (/Macintosh/.test(globalThis.navigator?.userAgent || '') && (globalThis.navigator?.maxTouchPoints || 0) > 1);
const inAppBrowser = () => /Line\/|FBAN|FBAV|Instagram|Messenger|MicroMessenger|KAKAOTALK/i.test(globalThis.navigator?.userAgent || '');
const visiting = () => {
  try {
    return sessionStorage.getItem('quadra.visit') === '1' || /[#&]q[hp]=/.test(globalThis.location?.hash || '');
  } catch {
    return false;
  }
};

// On phones and tablets the apps run from the home screen only. Returns true
// when it covered the page (the app shouldn't start).
export function installGate(app, lang = detectLang()) {
  if (!isPhoneOrTablet() || isStandalone() || visiting()) return false;
  const en = lang === 'en';
  const name = appName(app);
  const steps = inAppBrowser()
    ? en
      ? ['Open this page in Safari (iPhone) or Chrome (Android): tap ⋯ and “Open in browser”.', 'Then add it to your home screen.']
      : ['請先用 Safari（iPhone）或 Chrome（Android）開啟：點右上角 ⋯，選「在瀏覽器開啟」。', '再加入主畫面。']
    : isIOS()
      ? en
        ? ['Tap Share (the square with an arrow) in Safari.', 'Choose “Add to Home Screen”, then “Add”.', `Open ${name} from its new icon.`]
        : ['點 Safari 的「分享」（方框加箭頭）。', '選「加入主畫面」，再點「新增」。', `從主畫面的新圖示打開 ${name}。`]
      : en
        ? ['Tap ⋮ at the top right of Chrome.', 'Choose “Add to Home screen” (or “Install app”).', `Open ${name} from its new icon.`]
        : ['點 Chrome 右上角的 ⋮。', '選「加入主畫面」或「安裝應用程式」。', `從主畫面的新圖示打開 ${name}。`];
  const gate = node('dialog', { class: 'q-gate q-install', 'aria-modal': 'true', style: `--q-accent:${APPS[app].color}` }, [
    node('div', { class: 'q-gate-box' }, [
      node('img', { class: 'q-gate-icon', src: './favicon.svg', alt: '', width: '72', height: '72' }),
      node('p', { class: 'q-gate-brand', text: 'QUADRA' }),
      node('h1', { class: 'q-gate-title', text: en ? `Add ${name} to your home screen` : `把 ${name} 加入主畫面` }),
      node(
        'ol',
        { class: 'q-steps' },
        steps.map(t => node('li', { text: t }))
      )
    ])
  ]);
  keepOnTop(gate);
  document.documentElement.classList.add('q-signing-in');
  document.getElementById('loading')?.setAttribute('hidden', '');
  return true;
}

// A phone-only app on a computer: covers the page with where to open it
// instead (a QR code the app draws, `qr` as SVG markup, and the link), then
// how to add it to the home screen. Returns true when it covered the page.
export function phoneOnlyGate(app, { lang = detectLang(), qr = '' } = {}) {
  if (isPhoneOrTablet()) return false;
  const en = lang === 'en';
  const name = appName(app);
  const url = `${SITE}${APPS[app].path}`;
  const qrBox = node('div', { class: 'q-qr', role: 'img', 'aria-label': en ? `QR code for ${url}` : `${url} 的 QR code` });
  qrBox.innerHTML = qr;
  const copy = node('button', {
    class: 'q-btn',
    type: 'button',
    text: en ? 'Copy the link' : '複製連結',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = en ? 'Copied ✓' : '已複製 ✓';
      } catch {}
    }
  });
  const gate = node('dialog', { class: 'q-gate q-phone-only', 'aria-modal': 'true', style: `--q-accent:${APPS[app].color}` }, [
    node('div', { class: 'q-gate-box' }, [
      node('img', { class: 'q-gate-icon', src: './favicon.svg', alt: '', width: '72', height: '72' }),
      node('p', { class: 'q-gate-brand', text: 'QUADRA' }),
      node('h1', { class: 'q-gate-title', text: en ? `${name} is made for your phone` : `${name} 是手機 App` }),
      node('p', { class: 'q-gate-lede', text: en ? 'It lives in your pocket, beside your day. Open it on your phone:' : '課表跟著你一整天，所以只在手機上使用。用手機打開：' }),
      qrBox,
      node('p', { class: 'q-qr-url', text: url.replace(/^https:\/\//, '') }),
      copy,
      node(
        'ol',
        { class: 'q-steps' },
        (en
          ? ['Scan the code with your phone’s camera (or open the link on it).', 'Add it to the home screen: Share → “Add to Home Screen” on iPhone, ⋮ → “Install app” on Android.', 'Sign in with your Quadra Pass or a device code: your schedule is already there.']
          : ['用手機相機掃描上面的條碼（或在手機打開連結）。', '加入主畫面：iPhone 點「分享」→「加入主畫面」；Android 點 ⋮ →「安裝應用程式」。', '用 Quadra Pass 或裝置代碼登入，課表就在裡面。']
        ).map(t => node('li', { text: t }))
      )
    ])
  ]);
  keepOnTop(gate);
  document.documentElement.classList.add('q-signing-in');
  document.getElementById('loading')?.setAttribute('hidden', '');
  return true;
}

// Keeps every open Quadra page on the latest deploy. version.json is read
// when the page opens (boot.js has already loaded a newer deploy before the
// app started), every `every` ms, whenever the page comes back into view or
// online, and as soon as any other open Quadra page (any app, same site) has
// found an update: they tell each other through a BroadcastChannel. A newer
// deploy is put in place at once (a short veil, the place on the page kept),
// unless the person is in the middle of something: busy() (a round, an
// order), typing in a field, or a sheet open. Then a bar offers it and it
// happens the moment they're done (checked every 2 s) or the page is hidden.
export function watchUpdates({ current, key, cachePrefix, busy = () => false, every = 30_000 } = {}) {
  if (!current || current === 'dev') return;
  let checking = false;
  let pending = null;
  let waiter = 0;
  const channel = globalThis.BroadcastChannel ? new BroadcastChannel('quadra-updates') : null;
  const occupied = () => {
    if (busy()) return true;
    const a = document.activeElement;
    if (a && (a.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(button|checkbox|radio|range)$/i.test(a.type || '')))) return true;
    return Boolean(document.querySelector('dialog[open]:not(.q-passive)'));
  };
  async function apply(latest) {
    // A reload that came back on the old page (GitHub's CDN still had it a
    // moment after the deploy) tries again, 20 s apart, up to 4 times in
    // the session, instead of waiting for the app to be closed and opened.
    const flag = `${key || 'quadra'}.reloadedTo`;
    const [was, tries = 0, at = 0] = String(sessionStorage.getItem(flag) || '').split('|');
    const n = was === latest ? Number(tries) || 0 : 0;
    if (n >= 4 || (n && Date.now() - Number(at) < 20_000)) return;
    sessionStorage.setItem(flag, `${latest}|${n + 1}|${Date.now()}`);
    rememberPlace();
    if (globalThis.caches && cachePrefix) for (const name of await caches.keys()) if (name.startsWith(cachePrefix)) await caches.delete(name);
    const reg = await navigator.serviceWorker?.getRegistration?.(location.pathname);
    await reg?.update?.().catch(() => {});
    location.replace(`${location.pathname}?v=${encodeURIComponent(latest)}${location.hash}`);
  }
  function offer(latest) {
    // Quietly: no bar, no notice; it applies once the person is free.
    pending = latest;
    if (!waiter)
      waiter = setInterval(() => {
        if (!occupied()) {
          clearInterval(waiter);
          apply(pending).catch(() => {});
        }
      }, 2000);
  }
  async function check() {
    if (checking || pending) return;
    checking = true;
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      const latest = res.ok ? (await res.json())?.version : null;
      if (!latest || latest === current) return;
      channel?.postMessage({ update: key || location.pathname });
      if (occupied()) offer(latest);
      else await apply(latest);
    } catch {
    } finally {
      checking = false;
    }
  }
  check();
  channel?.addEventListener('message', () => check());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (pending) apply(pending).catch(() => {});
    } else check();
  });
  globalThis.addEventListener?.('focus', () => check());
  globalThis.addEventListener?.('online', () => check());
  globalThis.addEventListener?.('pageshow', event => event.persisted && check());
  setInterval(check, every);
}

// Strips that scroll sideways (chips, tabs, dates) keep their place when
// the app redraws them: a redraw replaces the strip with a new one at the
// start, which threw the person back to the first chip after every tap. The
// kit notes where each strip was scrolled (by the nearest element with an
// id, its class and its place among its likes) and, after any redraw, puts a
// fresh strip back there, unless the app placed it itself; the chosen chip
// (aria-pressed / aria-selected / .active / .on) is kept in view. Every app,
// every strip, nothing to call.
function keepStrips() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || globalThis.__quadraStrips) return;
  globalThis.__quadraStrips = true;
  const kept = new Map();
  const host = el => el.parentElement?.closest('[id]') || document.body;
  const classOf = el => (typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(c => !/^(is-|on$|active$|open$|stuck$)/.test(c)).sort().join('.') : '');
  const signature = el => {
    const h = host(el);
    const cls = classOf(el);
    const peers = [...h.querySelectorAll(el.tagName)].filter(x => classOf(x) === cls);
    return { key: `${h.id || 'body'}|${el.tagName}|${cls}|${peers.indexOf(el)}`, hostId: h.id || '', tag: el.tagName, cls, index: peers.indexOf(el) };
  };
  const sideways = el => el instanceof Element && el.scrollWidth > el.clientWidth + 2;
  const note = el => {
    if (!sideways(el)) return;
    const sig = signature(el);
    kept.set(sig.key, { ...sig, left: el.scrollLeft });
  };
  document.addEventListener('scroll', e => note(e.target), true);
  // A tap on a chip counts as where the strip was, even never scrolled.
  document.addEventListener('pointerdown', e => {
    for (let el = e.target instanceof Element ? e.target : null; el && el !== document.body; el = el.parentElement) if (sideways(el)) return note(el);
  }, true);
  const chosen = '[aria-pressed="true"], [aria-selected="true"], [aria-current="true"], [aria-current="page"], .active, .on, .selected';
  let queued = false;
  const restore = () => {
    queued = false;
    for (const k of kept.values()) {
      const h = k.hostId ? document.getElementById(k.hostId) : document.body;
      if (!h) continue;
      const el = [...h.querySelectorAll(k.tag)].filter(x => classOf(x) === k.cls)[k.index];
      if (!el || !sideways(el) || el.scrollLeft !== 0 || el.__quadraKept === k) continue;
      el.__quadraKept = k;
      el.scrollLeft = k.left;
      const pick = el.querySelector(chosen);
      if (pick) {
        const a = pick.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        if (a.left < b.left || a.right > b.right) el.scrollLeft += a.left < b.left ? a.left - b.left - 12 : a.right - b.right + 12;
      }
    }
  };
  // Right after the redraw (before it's painted), so the strip never shows at its start.
  new MutationObserver(() => {
    if (queued || !kept.size) return;
    queued = true;
    restore();
  }).observe(document.documentElement, { childList: true, subtree: true });
}
keepStrips();

// Where the person was (the scroll), kept across a reload for an update and
// put back by restorePlace() once the app has painted.
const PLACE_KEY = 'quadra.place';
export function rememberPlace() {
  try {
    sessionStorage.setItem(PLACE_KEY, JSON.stringify({ path: location.pathname, hash: location.hash, y: Math.round(globalThis.scrollY || 0), t: Date.now() }));
  } catch {}
}
export function restorePlace() {
  try {
    const p = JSON.parse(sessionStorage.getItem(PLACE_KEY) || 'null');
    sessionStorage.removeItem(PLACE_KEY);
    if (p && p.path === location.pathname && p.hash === location.hash && Date.now() - p.t < 60_000 && p.y > 0) requestAnimationFrame(() => globalThis.scrollTo(0, p.y));
  } catch {}
}

// The fixed tab bar keeps clear of the iPhone's home indicator even when iOS
// reports no safe area after a resume (the largest inset seen is a floor).
const SAFE_KEY = 'quadra.safeBottom';
function steadyTabBar() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.getComputedStyle) return;
  const root = document.documentElement;
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)';
  let seen = { p: 0, l: 0 };
  try {
    seen = { ...seen, ...JSON.parse(localStorage.getItem(SAFE_KEY) || '{}') };
  } catch {}
  const fix = () => {
    if (!document.body) return;
    if (!probe.isConnected) document.body.append(probe);
    const side = window.innerWidth > window.innerHeight ? 'l' : 'p';
    const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
    if (inset > (seen[side] || 0) && inset < 80) {
      seen[side] = inset;
      try {
        localStorage.setItem(SAFE_KEY, JSON.stringify(seen));
      } catch {}
    }
    root.style.setProperty('--q-safe-bottom', `${isStandalone() ? seen[side] || 0 : 0}px`);
  };
  const settle = () => {
    fix();
    requestAnimationFrame(fix);
    for (const ms of [120, 400, 1000, 2000]) setTimeout(fix, ms);
  };
  for (const ev of ['resize', 'orientationchange', 'pageshow', 'focus']) window.addEventListener(ev, settle);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && settle());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', settle, { once: true });
  else settle();
}
steadyTabBar();

// ---- The app frame: the tab bar and the top-right, the same in every app -------------------
//
// Every app's header is the same markup (index.html):
//   <header class="q-appbar"><div class="q-appbar-inner">
//     <div class="q-brand">logo, <h1 id="title">, <p id="status" class="q-status"></div>
//     <nav id="tabs" class="q-tabbar"></nav> <div id="top-actions" class="q-actions"></div>
//   </div></header>
// On a phone the tabs sit at the bottom and the header is only the status
// line and the buttons; on a wider screen it's one sticky bar.

// One drawing per idea, shared by every app (24×24, stroked).
export const ICONS = {
  home: '<path d="M3.5 10.6 12 4l8.5 6.6"/><path d="M5.5 9.3V20h13V9.3"/><path d="M10 20v-5.4h4V20"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  live: '<circle cx="12" cy="12" r="2.3"/><path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5.2 5.2a9.6 9.6 0 0 0 0 13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  balls: '<circle cx="8" cy="8" r="4"/><circle cx="16.5" cy="16" r="4"/><circle cx="17" cy="7" r="2.4"/><circle cx="7.2" cy="17" r="2.4"/>',
  ticket: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V9a3 3 0 0 0 0 6v2.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V15a3 3 0 0 0 0-6z"/><path d="M9.5 9h5M9.5 12h5M9.5 15h3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3"/><path d="M3.5 4.5v4.3h4.3"/><path d="M12 7.5V12l3 2"/>',
  chart: '<path d="M4 20h16"/><path d="M5 16l4.2-5 3.6 3 6.2-8"/><circle cx="19" cy="6" r="1.4"/>',
  wallet: '<rect x="3.5" y="6.5" width="17" height="13.5" rx="3"/><path d="M8 6.5V5.3A1.8 1.8 0 0 1 9.8 3.5h4.4A1.8 1.8 0 0 1 16 5.3v1.2"/><path d="M3.5 12h17"/>',
  exchange: '<path d="M4 8.5h14l-3.2-3.2"/><path d="M20 15.5H6l3.2 3.2"/>',
  book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14.5H7.5A2.5 2.5 0 0 0 5 20z"/><path d="M5 20a1.5 1.5 0 0 0 1.5 1.5H19v-4"/><path d="M9.5 7.5h6M9.5 11h4"/>',
  pass: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h3.5M14.5 13.5h2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.4a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.3-2.6 3.9"/><circle cx="12" cy="17.2" r=".5"/>',
  refresh: '<path d="M19.5 11.5a7.5 7.5 0 1 0-2.2 5.4"/><path d="M19.5 4.5v7h-7"/>'
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || name}</svg>`;
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// tabBar({ tabs: [{ id, label, icon }], onSelect }) draws the tab bar in #tabs
// and returns { select, badge, label, hide, current }.
//   onSelect(id, { again }): the app shows that tab (its own rendering), and
//     calls select(id) for the bar, the panels (#panel-<id>) and the address.
//   Tapping the tab that's already open scrolls it back to the top; tapped
//   again at the top, onSelect(id, { again: true }) (a tab may reset itself).
//   Each tab keeps its place: switching back returns to where it was
//   (select(id, { top: true }) starts it at the top instead).
//   hash(id): the address for a tab ('#<id>' by default; null leaves it).
export function tabBar({ tabs, onSelect, hash = id => `#${id}`, nav = document.getElementById('tabs'), label: ariaLabel = '' } = {}) {
  const buttons = new Map();
  const places = {};
  let current = null;
  nav.classList.add('q-tabbar');
  nav.setAttribute('role', 'tablist');
  if (ariaLabel) nav.setAttribute('aria-label', ariaLabel);
  nav.style.setProperty('--q-tabs', String(tabs.length));
  const again = id => {
    if ((globalThis.scrollY || 0) > 4) globalThis.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    else onSelect(id, { again: true });
  };
  for (const tab of tabs) {
    const b = node('button', { class: 'q-tab', id: `tab-${tab.id}`, type: 'button', role: 'tab', 'data-tab': tab.id, 'aria-controls': `panel-${tab.id}`, 'aria-selected': 'false', tabindex: '-1' });
    b.innerHTML = `<span class="q-tab-icon">${icon(tab.icon)}<b class="q-tab-badge" hidden></b></span><span class="q-tab-label"></span>`;
    b.querySelector('.q-tab-label').textContent = tab.label;
    b.addEventListener('click', () => (tab.id === current ? again(tab.id) : onSelect(tab.id, { again: false })));
    buttons.set(tab.id, b);
  }
  nav.replaceChildren(...buttons.values());
  nav.addEventListener('keydown', event => {
    const shown = [...buttons].filter(([, b]) => !b.hidden).map(([id]) => id);
    const i = shown.indexOf(current);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || i < 0) return;
    event.preventDefault();
    const next = shown[(i + step + shown.length) % shown.length];
    onSelect(next, { again: false });
    buttons.get(next)?.focus();
  });
  const api = {
    get current() {
      return current;
    },
    select(id, { top = false } = {}) {
      const changed = current !== id;
      const first = current == null;
      if (changed && !first) places[current] = globalThis.scrollY || 0;
      current = id;
      for (const [tid, b] of buttons) {
        const on = tid === id;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(`panel-${tid}`);
        if (panel) panel.hidden = !on;
      }
      // Only a change of tab moves the address (the first paint leaves it:
      // the app reads it to start).
      try {
        const h = changed && !first ? hash(id) : null;
        if (h != null && location.hash !== h) history.replaceState(null, '', h || location.pathname + location.search);
      } catch {}
      if (changed && !first) {
        // After the app has drawn the tab (it does so right after select).
        const y = top ? 0 : places[id] || 0;
        globalThis.scrollTo?.(0, y);
        if (y) requestAnimationFrame(() => globalThis.scrollTo(0, y));
      }
    },
    // A count (a number or short text) on a tab's icon; 0/''/null hides it.
    // tone: 'bad' (red, default), 'warn', 'accent'; dot: a dot without text.
    badge(id, value, { tone = 'bad', dot = false } = {}) {
      const b = buttons.get(id)?.querySelector('.q-tab-badge');
      if (!b) return;
      const show = dot ? Boolean(value) : value != null && value !== '' && value !== 0 && value !== false;
      b.hidden = !show;
      b.textContent = show && !dot ? String(value) : '';
      b.className = `q-tab-badge${dot ? ' dot' : ''}${tone !== 'bad' ? ` ${tone}` : ''}`;
    },
    label(id, text) {
      const l = buttons.get(id)?.querySelector('.q-tab-label');
      if (l && l.textContent !== text) l.textContent = text;
    },
    hide(id, hidden = true) {
      const b = buttons.get(id);
      if (b) b.hidden = Boolean(hidden);
    }
  };
  return api;
}

// topActions(s, { help, refresh, extra }): the top-right of every app, in
// #top-actions: 說明 · 重新整理 (apps with live data) · the account.
//   help(): opens the help (default: this app's guide in Quadra Hub).
//   refresh(): reloads the app's data; the button (id="refresh") spins while
//     it's disabled, so apps set refresh.disabled while loading.
export function topActions(s, { help = null, refresh = null, extra = null, into = document.getElementById('top-actions') } = {}) {
  const en = s.lang === 'en';
  const helpBtn = node('button', { class: 'q-icon-btn', id: 'help-button', type: 'button', 'aria-label': en ? 'Help' : '說明', title: en ? 'Help' : '說明' });
  helpBtn.innerHTML = icon('help');
  helpBtn.addEventListener('click', () => (help ? help() : s.go('vocab', `help=${s.app}`)));
  let refreshBtn = null;
  if (refresh) {
    refreshBtn = node('button', { class: 'q-icon-btn q-refresh', id: 'refresh', type: 'button', 'aria-label': en ? 'Refresh' : '重新整理', title: en ? 'Refresh' : '重新整理' });
    refreshBtn.innerHTML = icon('refresh');
    refreshBtn.addEventListener('click', () => refresh());
  }
  into.classList.add('q-actions');
  into.replaceChildren(...[helpBtn, refreshBtn, accountButton(s, { extra })].filter(Boolean));
  return { help: helpBtn, refresh: refreshBtn };
}

// Big numbers never wrap: they shrink (to 60% at most) to fit their box.
export function fitNumbers(nodes) {
  for (const el of nodes) {
    el.style.fontSize = '';
    const box = el.parentElement?.clientWidth || 0;
    if (!box || el.scrollWidth <= box) continue;
    const base = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = `${Math.max(base * 0.6, (base * box) / el.scrollWidth - 0.5)}px`;
  }
}
