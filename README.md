# Orbit Transit

Taiwan's public transport in one app, a Quadra app (a related add-on, like
Orbit Weather): the Quadra Pass signs in and keeps your pinned places, trips,
buses and trains, preferences and recent searches. Always dark, in 繁體中文.

Live: https://jaypengx.github.io/Orbit-Transit/

| Tab | What |
| --- | --- |
| 地圖 | Google's map (Taiwan's NLSC map once the month's free Google use is spent), with YouBike stations and their bikes now (regular and ⚡ 電輔車, and docks), every bus stop, 台鐵 / 高鐵 / metro stations. Search places, tap anything for its card, pin places, and plan a trip from where you are (the start can be a pinned place, a search or a spot chosen on the map): Google's and TDX's plans (walking and by YouBike), 台鐵 / 高鐵 plans from our own router (YouBike to a station 1.2–4.5 km away), a train finished by a direct bus, YouBike plans of our own, the buses re-timed by TDX's live estimates. Ranked by what's practical (changes, detours, walking, what TPASS leaves you to pay), the first few with different main lines shown as 推薦, the rest folded. ☆ saves the trip; 開始導航 follows it step by step (Google Maps for a walking or riding step). |
| 交通 | What's coming that you'd take: your saved trips' next ways to go (recurring ones by day, the way back by itself), the buses, trains and YouBike around you, pinned buses and trains, pinned places' buses and bikes. One tap navigates; ☆ pins a recommendation. |
| 查時刻 | 台鐵 / 高鐵 station to station (changes found by the router; ☆ pins the connection or one train), and bus routes (live arrivals or a stop's timetable; ☆ pins a stop). |
| 我的 | Places, trips (a time, days of the week), pinned transit, preferences (which ways of moving, 每 30 分鐘換 YouBike, your TPASS), tickets (高鐵 T Express, 台鐵 e訂通), the metro maps on the real map. |

## How it's built

A static site (`public/`), no build step, on the shared Quadra kit
(loaded from Shared-Proxy's Pages: `#kit/quadra.mjs`, the page's
`kit:head` and `kit:boot`, `Shared-Proxy/kit/loader.html`).

| File | What |
| --- | --- |
| `app.mjs` | The frame: the pass, the tabs, where the device is |
| `lib/api.mjs` | The proxy (`Shared-Proxy/transit.js`): TDX paths, places, plans; answers kept in memory and in the `orbit-transit-data` cache |
| `lib/tab-map.mjs`, `map.mjs` | The map tab (cards, plans, saving a trip); one interface over Google Maps and Leaflet + NLSC |
| `lib/planner.mjs` | A trip planned the whole way: planners, our trains, train + bus, live buses, YouBike, TPASS, ranking |
| `lib/plan.mjs` | The YouBike plans (30-minute swaps), our own train plans, the score and the ranking |
| `lib/live.mjs` | TDX's live bus estimates in plans; a direct bus between two places |
| `lib/nav.mjs`, `buzz.mjs` | Navigation; the buzz (a chime on an iPhone, which can't vibrate) |
| `lib/tab-go.mjs` | 交通 |
| `lib/tab-times.mjs`, `tab-train.mjs`, `rail.mjs`, `raildata.mjs` | 查時刻; the train router (Connection Scan over a day's 台鐵 + 高鐵 timetable) and its data |
| `lib/tab-me.mjs`, `tpass.mjs` | 我的; TPASS passes and what they cover |
| `lib/bus-ui.mjs`, `bus.mjs` | Bus route sheets, groups, nearby stops; routes, arrivals, timetables |
| `lib/tab-metro.mjs`, `metro.mjs` | The metro maps (on the real map) and boards |
| `lib/bike.mjs`, `city.mjs`, `store.mjs`, `ui.mjs`, `util.mjs` | YouBike, cities, the pass's data, shared UI, small helpers |

Tests: `npm test`. A phone-sized look with sample data:
`node tools/preview.mjs transit [go|times|me]` in Shared-Proxy.

The data (TDX, Google) comes only through the proxy, which holds the keys,
caches and shares every answer, and keeps Google's billed calls under its
free monthly use (see Shared-Proxy's README, `/transit`).
