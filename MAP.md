# Orbit Transit: the map

Taiwan's public transport in one app: buses, 台鐵, 高鐵, the metros and
YouBike; trips planned the way a person really travels; navigation that
follows the trip. Signs in with the Orbit Pass, which keeps places, trips
and pins. Light or dark follows the phone; the look is `lib/look.mjs` on the kit.

Live: https://orbit.jaypengx.com/transit/

## How it works

- **Tabs:**
  - **地圖:** YouBike stations (the five nearest along the bottom), every
    bus stop with live times, train and metro stations, search, pins, and
    a trip planned from anywhere. A stop's signs a few metres apart are one
    stop (`stopGroups`).
  - **交通:** saved trips' next departures with real bus times, pinned
    rides, and the places rail (家, 學校 and your pins).
  - **查時刻:** 台鐵/高鐵 station to station (changing where faster), bus
    routes by number or stop, stop timetables, and 捷運: each city's metro
    as a metro map (`metromap.mjs`: the lines straightened to the eight
    directions from TDX's real stations, worked out ahead by
    `scripts/metro-maps.mjs`, a phone redraws only when the network
    changes), pinch and drag, the trains arriving now on it, 實景 for the
    real map. A station: its line codes, the next trains each way counting
    down (live where the operator sends them, else the timetable, else how
    often the line runs), first and last trains, exits (`metro-ui.mjs`).
  - **我的:** places, trips, pinned stops, 交通偏好 (ways of moving, TPASS,
    the maps app).
- **Planning** (`lib/planner.mjs`): Google's and TDX's planners side by
  side, plus our own 台鐵/高鐵 router (`rail.mjs`, Connection Scan) and
  metro router. A planner's YouBike ride needs a real station at each end
  (never a made-up 附近的 YouBike 站). Buses are re-timed by TDX's live estimates (`adjustPlan`).
  YouBike ideas are by station place (`plan.mjs`); rivers are crossed by
  the nearest bridge (`rivers.mjs`). TPASS counts as free (`tpass.mjs`).
- **Planned once:** a saved trip's ways are kept and re-timed live. The
  billed planners are asked again only when the ways could differ.
- **Ranking** (`plan.mjs rank`), in two steps:
  1. Fold the ways a person wouldn't take (bus to bus when there's another
     way; a pointless change; a far-behind way; a river ride beside a
     direct crossing; a ride for nothing beside a short walk).
  2. Order what's left by door-to-door minutes plus a small table of
     bother (`scoreParts`).
- **Navigation** (`nav.mjs`, `navlive.mjs`): the whole trip on the map,
  each step moving on by itself (on board only once two fixes say so; a
  rough fix moves the dot, never the trip), countdowns, the stops to go, a buzz (a
  chime on iPhone) before yours. Missed bus → the next; on an earlier
  train than planned → the changes after it moved sooner. Late for an
  arrival time → an on-time alternative offered. It resumes after the app
  is swiped away and tells the lock screen.
- **YouBike rental timer** (`rental.mjs`): starts by itself while
  navigating. With TPASS's free half hour, it warns at 25 minutes and
  offers nearby docks to swap.
- **到站提醒** (`alerts.mjs`): "tell me when the 5608 is 5 minutes away";
  the Worker checks every 2 minutes while the phone is locked.
- **Data:**
  - live: TDX through `/transit/tdx`, cached on the Worker;
  - bus routes and timetables: weekly packs in R2 (`packs.mjs`);
  - what's near a point: worked out on the phone (`near.mjs`);
  - line shapes: `shapes.mjs` (packs and shapes read with the kit's
    `packJson`);
  - the map: Google under the month's cap, else NLSC;
  - walks: Google's streets, OpenStreetMap past the cap.
- **Offline:** covered (`onlineOnly`); never old bus times.
- **Saved:**
  - On the Pass (`store.mjs`, `t1:`, up to 200,000 characters): groups,
    pins, trips, preferences.
  - On the phone: `ot.trips.v2` (planned ways), `ot.nav.v1` (navigation).

## Decisions in force

- What isn't running comes from the operators' own notices (TDX Alert/News),
  never guessed (`service.mjs`): 台鐵's stopped trains leave the day's
  timetable (TDX's own lags: 內灣線 still listed on 2026-10-23), those run
  "視風雨情形" keep a 視天候行駛 tag; a bus route a notice stops is 今日停駛
  everywhere and never planned, unless a bus is seen on the road. A notice
  that says 部分, 減班, a time of day and the like is shown, never a stop.
  The banner rows (交通, 火車, 公車, 捷運) open to the notice as written.

- Judged by how the owner really travels. Every real choice is shown, with
  official names, times and live data first.
- A plan costs what it costs a person, in minutes:
  - Waiting at home counts a third while short; past 15 minutes, as lost
    time.
  - Changing onto a train is easy, onto a bus a gamble, bus to bus barely
    a plan.
  - Walking past 5 minutes is slow.
  - YouBike: 10 minutes is nothing, 18 a workout; past 30, each minute
    counts 4.5×. Two short rides beat one long one.
  - Never race your own train to the next station.
- Walking pace is 5 km/h. One walk reads the same everywhere it's shown,
  by Google's streets.
- YouBike is planned by station place, except a trip that starts on the
  bike: never at a station with no bike now.
- A trip with stops is planned whole. One kept YouBike through the stops
  is recommended unless a stop is far, or walking it all is sooner.
- Train or bus, then a ride over 頭前溪, is listed when it's 5 minutes
  sooner. At most one of each, under the recommendations.
- A ride over 頭前溪 after a bus is recommended when nothing else is close
  (竹東南 → 成功九街: 5608 and a 20′ ride). A way folded itself (bus then
  bus) never hides it.
- There is always a recommendation.
- 高鐵 is never free; our own trains are costed by distance in the ranking.
- Looking ahead on a ride keeps following it, and returns to the ride
  with a buzz when your stop is next.
- An arrival time nothing reaches any more: the ways leaving now, each
  saying how late.
- Navigation never takes the app over: the tabs stay, and it shrinks to a
  bar. The map never pulls you back once a finger has moved it.
- The map opens on where you are and follows you. iOS is asked for the
  location unprompted once, never at every launch.
- Status bar `black`, with a solid strip on the map tab too.
- Logs hold places: keep them in `captures/` (git-ignored).
- Taxis never.

## Files (`public/`)

| File | What |
| --- | --- |
| `app.mjs` | The frame: Pass, tabs, location |
| `lib/api.mjs` | The proxy: TDX, places, plans, walks; caches |
| `lib/planner.mjs`, `plan.mjs`, `live.mjs` | Planning; YouBike ideas, score and ranking; live re-timing |
| `lib/rail.mjs`, `metro*.mjs` | The train router; metro router, boards, maps |
| `lib/bus.mjs`, `bus-ui.mjs` | Routes, stops, arrivals; the route strip |
| `lib/near.mjs`, `packs.mjs`, `shapes.mjs` | R2 data: what's near, bus packs, shapes |
| `lib/bike.mjs`, `rental.mjs`, `rivers.mjs`, `tpass.mjs` | YouBike; the rental timer; bridges; TPASS |
| `lib/nav.mjs`, `navlive.mjs`, `buzz.mjs`, `alerts.mjs` | Navigation; the buzz; bus alerts |
| `lib/service.mjs` | What isn't running: operators' notices (台鐵, 高鐵, metros, buses) as rules |
| `lib/tab-*.mjs`, `map.mjs` | Each tab; Google or Leaflet+NLSC behind one interface |
| `lib/store.mjs` | The Pass's data |

## Run and test

```bash
npm test
```

```bash
node scripts/live.mjs 竹東站 縣體育場
```

```bash
node ../Orbit-Core/tools/preview.mjs transit --live --width 375
```

- `npm test` includes navigation driven fix by fix (`tests/nav-drive.test.mjs`)
  and the owner's verdicts (`tests/verdicts/`): real trips,
  ranked again with buses a few minutes off. A verdict that flips fails.
  Save a new one with `scripts/verdict.mjs`.
- When changing the ranking, also run `node scripts/live.mjs --against
  HEAD` (old against new on today's data) and read what moved.
- `scripts/replay.mjs` re-runs a 除錯紀錄 (`--why` shows the score).

A push to `main` tests, stamps versions and deploys to Pages.

## If you change…

| This | Also check |
| --- | --- |
| The score or ranking | The verdicts, `live.mjs --against`, `replay.mjs` |
| A TDX path | Orbit-Core's `TDX_RULES` and cache times, the `bus` push check |
| Pack formats | Orbit-Core's `builders/buses.js` |
| Navigation steps | `ot.nav.v1` resuming, lock-screen notices (`kind: nav`) |
