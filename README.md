# Orbit Transit

Taiwan's public transport in one app, a Quadra app (a related add-on, like
Orbit Weather): the Quadra Pass signs in and keeps your bus groups, pinned
places and recent searches. Always dark, in 繁體中文.

Live: https://jaypengx.github.io/Orbit-Transit/

| Tab | What |
| --- | --- |
| 地圖 | Google's map (Taiwan's NLSC map once the month's free Google use is spent), with YouBike stations and their bikes now (regular and ⚡ 電輔車, and docks), every bus stop, 台鐵 / 高鐵 / metro stations. Search places, tap anything for its card (a stop's buses, a station's next trains), pin places, and plan a trip (start and destination both changeable, swapped with one tap): Google's and TDX's transit plans, 台鐵 / 高鐵 plans from our own router, and YouBike plans of our own (all the way, to the train instead of a bus, from the last station). Every plan is shown, however much later it arrives, labelled 最快抵達 / 最省時 / 最少轉乘 / 最少步行; a planner that didn't answer is named. |
| 公車 | Bus stops in groups you name and order, one page each, swiped; when the bus comes, every 20 s. Find a route by city (yours first) or 公路客運, see its stops each way with the buses on them, add a stop to a group. |
| 火車 | 台鐵 and 高鐵 between any two stations (nearest first, or by city): the router changes trains by itself (支線 to the trunk line, 台鐵 ↔ 高鐵 with the walk between, e.g. 六家 and 高鐵新竹), each option the latest way to leave for its arrival; fares and today's delays. |
| 捷運 | Each city's metro drawn as one map (台北・新北, 桃園機捷, 台中, 高雄) from TDX's stations and routes; pinch, drag, tap a station for its next trains, live where the operator sends them. |

## How it's built

A static site (`public/`), no build step, on the shared Quadra kit
(`lib/quadra.mjs`, `quadra.css`, `boot.js`: copied from
`Shared-Proxy/kit/` by `node kit/sync.mjs`, never edited here).

| File | What |
| --- | --- |
| `app.mjs` | The frame: the pass, the tabs, where the device is |
| `lib/api.mjs` | The proxy (`Shared-Proxy/transit.js`): TDX paths, places, plans; answers kept in memory and in the `orbit-transit-data` cache |
| `lib/tab-map.mjs`, `map.mjs` | The map tab; one interface over Google Maps and Leaflet + NLSC |
| `lib/plan.mjs` | The YouBike plans, our own train plans, and the ranking |
| `lib/tab-bus.mjs`, `bus.mjs` | Bus groups, routes, arrivals |
| `lib/tab-train.mjs`, `rail.mjs`, `raildata.mjs` | The train router (Connection Scan over a day's 台鐵 + 高鐵 timetable) and its data |
| `lib/tab-metro.mjs`, `metro.mjs` | The metro maps and boards |
| `lib/bike.mjs`, `city.mjs`, `store.mjs`, `ui.mjs`, `util.mjs` | YouBike, cities, the pass's data, shared UI, small helpers |

Tests: `npm test`. A phone-sized look with sample data:
`node tools/preview.mjs transit [bus|train|metro]` in Shared-Proxy.

The data (TDX, Google) comes only through the proxy, which holds the keys,
caches and shares every answer, and keeps Google's billed calls under its
free monthly use (see Shared-Proxy's README, `/transit`).
