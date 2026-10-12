# Orbit Transit

Taiwan's public transport in one app:
- buses, 台鐵, 高鐵, the metros and YouBike;
- trips planned the way a person really travels, with the buses' real
  times;
- navigation that follows the trip.

It's an Orbit app (the everyday tools), signed in with the Quadra Pass,
which keeps your places, trips and pins. It is always dark and in 繁體中文.

**https://jaypengx.github.io/Orbit-Transit/**

The family's rules are `Shared-Proxy/docs/TRUTH.md`, and TRUTH §7
"Transit" is this app's yardstick:
- it's judged by how the owner really travels;
- every real choice is shown;
- official names, times and live data come first;
- navigation resumes after the app is swiped away and tells the lock
  screen;
- it never takes the app over.

A change to how plans are recommended follows TRUTH §4's six steps (see
it live, find the rule, a failing test, the case live again, the whole
batch old against new, say what moved).

## Contents

- [The tabs](#the-tabs)
- [Planning a trip](#planning-a-trip)
- [Ranking: what's practical](#ranking-whats-practical)
- [Navigation](#navigation)
- [Bus alerts and notices](#bus-alerts-and-notices)
- [Where the data comes from](#where-the-data-comes-from)
- [What's kept](#whats-kept)
- [Files](#files)
- [Develop, test, deploy](#develop-test-deploy)
- [What depends on what](#what-depends-on-what)

## The tabs

| Tab | What |
| --- | --- |
| **地圖** | The home tab. The map (Google's while the month is under the proxy's cap, else Taiwan's NLSC map in Leaflet; `map.mjs` is one interface over both) shows YouBike stations (regular and ⚡ 電輔車, and docks), every bus stop (each side of the road, with live times), and 台鐵, 高鐵 and metro stations. Search places, tap anything for its card (a station's bikes and docks, a stop's buses, a station's next trains), pin places, and plan a trip from here, a pinned place, a search or a spot on the map. ☆ saves a trip; 開始導航 follows it. A plan's buses, trains and metro are drawn along their real lines (`shapes.mjs`). |
| **交通** | What's coming that you'd take, refreshed while open: **常用・釘選行程** (your saved trips' next ways to go, recurring ones by day, the way back by itself, with the buses' real times; one tap navigates); **釘選的公車・火車** (a stop's bus, a connection, one train, from whichever end you're nearer); **釘選地點** (each place's buses, bikes, station, and how to get there). What's recommended is never pinned by itself: ☆ pins it. |
| **查時刻** | A timetable on purpose. **台鐵・高鐵**: station to station, changing wherever it's faster (the router), with each option's trains, where to change and the wait, the fare and today's delays; ☆ pins a connection or one train. **公車**: a route by number or stop name (your city, its neighbours and 公路客運), its stops each way with the buses now, or a stop's timetable for any day of the coming week; ☆ pins a stop. |
| **我的** | **地點** (rename, reorder, remove); **行程** (a place to a place, maybe at a time, maybe every weekday; the way back comes by itself); **釘選交通** (bus stops in groups: 常用, 上班, 回家…; trains); **交通偏好** (which ways of moving to use, 每 30 分鐘換 YouBike, your TPASS); **車票** (高鐵 T Express and 台鐵 e訂通: the app opened, the train's details copied, `tickets.mjs`); **捷運路網圖** (each city's metro on the real map, a station's next trains, live where the operator sends them). |

## Planning a trip

`lib/planner.mjs`, the same for 地圖's 路線 and 交通:

1. **Plans side by side.**
   - The proxy's planners: Google's transit routes and TDX's planner,
     walking and by YouBike.
   - Our own **台鐵 / 高鐵 router** (`rail.mjs`). It turns a day's whole
     timetable into connections and runs the Connection Scan Algorithm,
     changing wherever that's faster (a 內灣線 train to 竹中, the 六家線, a
     walk to HSR 新竹, the HSR to 台北), with real change times. The search
     runs again from just after each first departure, so every option is
     the latest way to leave for its arrival, and a change is made at the
     first station where the next train already calls (off at 竹中 for the
     六家 train, never on to 新莊 and back for the same train). With bikes
     allowed, it includes YouBike to a station 1.2–4.5 km away.
   - Our own **metro router** (`metroroute.mjs`), for rides the planners
     leave out (板橋 → 內湖 by 板南線 then 文湖線). It uses TDX's station
     times, half the headway as the wait, and 3 minutes a change.
2. **A train far from the place** goes on by a direct bus when one comes
   soon (竹中 → 5608 → 竹東高中; `live.mjs busLink`).
3. **The buses re-timed** by what TDX says they're doing now (`adjustPlan`,
   N1 estimates at the boarding stop). That gives the bus you'd really
   catch, the rest of the trip moved with it, and a train it would now miss
   marked. Google's and TDX's names for one route are matched (快捷8經興隆大橋
   = 快捷8號, Chinese numerals as digits; never 5 and 5608).
4. **YouBike ideas** (`plan.mjs`), by where the stations are, never by the
   bikes or docks there at the moment (too live to plan on; navigation moves
   the ride if a station is empty when you get there). A station out of
   service isn't one; every station is YouBike 2.0's, 電輔車 included:
   - all the way by bike (or 電輔車), when it's near enough;
   - by bike to the train or metro instead of a bus or a long walk (leave
     later, the same train);
   - by bike from the last station.

   The station to take a bike from and leave it at is the one that makes
   the whole way quickest (綠41公園 on the way home from 六家, not the
   nearer one past it). 每 30 分鐘換 swaps bikes to stay free.
5. **Rivers** (`rivers.mjs`): a ride over 頭前溪 or 鳳山溪 goes round by
   the bridge least out of its way, and that distance is its time; no
   bridge counts against it on top (the owner, 2026-10-12). A ride's length
   on the roads is the straight line and a quarter, or, over a river, the
   way by its bridge and a little (竹中 → 綠41公園 5.3 km, as the roads say).
6. **Only the ways of moving the person allows** are used (我的 →
   交通偏好). A taxi never is: TDX sometimes ends a trip with one.
7. **TPASS** (`tpass.mjs`): what the pass covers counts as free. That is
   buses, 台鐵 and metros inside its cities (never 高鐵; never 太魯閣,
   普悠瑪, EMU3000; its skipped routes), and YouBike's first 30 minutes
   where included. A trip inside the pass's area is ranked only by what
   the pass takes.

**Near a point** (`near.mjs`), worked out on the phone instead of asking TDX
around every point:
- **Bus stops**: within a kilometre, from the bus packs kept here.
  Shared-Data's `where.json` says which packs have stops near.
- **Buses due**: one ask a city for every stop wanted at that moment.
- **YouBike**: the city's stations, one ask a city.

Each falls back to TDX's own search when the packs can't be had.

## Ranking: what's practical

`plan.mjs score` / `scoreParts` (`scripts/replay.mjs --why` shows them).
What a plan costs, in minutes:

| Part | Rule |
| --- | --- |
| Time | Door to door in full; the wait before leaving counts a third while short (it's spent at home), past 15 minutes as time lost; by an arrival time, how early you must leave |
| Changes | Onto a train or metro is easy (it keeps time); onto a bus a gamble; a bus to a bus barely a plan (Taiwan's buses don't keep their times); a bus between two trains is fine |
| Each bus | A few minutes (early at the stop, late anyway), and a little for the time on it |
| Walking | Past 5 minutes, slow going |
| Bikes | Each ride by its own length: 10 minutes is nothing, 18 a workout, past that every minute counts 4.5×. Two short rides beat one long one; a swap at 30 minutes is still one ride; riding in all counts (15 to a train and 6 from it is nearly riding the whole way); 電輔車 a little easier |
| Rivers | Only the way round to the bridge, in the ride's time |
| The long way round | Lines that go away and back, or a change farther from the place than the start; chasing your own train past a nearer station |
| Money | What it costs you after TPASS; a train it would now miss |

The first few plans with different main lines show as **推薦**, and the
rest fold. A plan is folded (set aside, still there to open) when:

- another way onto the same rides is no earlier out, no later there and
  less bother (a bike to the train instead of a walk and a bus);
- it changes more than a way no later and less bother;
- it changes for a hop a walk or a bike would do;
- it rides most of what riding all the way would;
- **over the river on the bike** before or after a bus or train, when a way
  whose bus or train crosses it gets there within 15 minutes (新竹站 →
  成功九街: the train to 竹北 and a ride, not to 千甲 and a ride over
  頭前溪);
- **the same train stayed on for nothing**: another way sets out on the
  same bus or train, changes no more, rides home about as long after it
  (8 minutes more at most) and is there no later (on to 千甲 when off at
  竹中 is home first; on to 北新竹 or 新竹 and back up to 竹北 when the
  change to the 六家線 is home first, the ride home the same 15 minutes);
- it's far behind the best.

A plan that's folded folds nothing else. The same train left at stations a
kilometre or more apart is two ways, each kept (off at 竹中 and ride, or on
to 六家).

## Navigation

`lib/nav.mjs`, `navlive.mjs`, `buzz.mjs`. A plan followed step by step with
the phone's position:

- **The whole trip on the map**: every step in its colours (the one you're
  on boldest, the ones behind you faint), the rest of the trip from where
  you are kept in view; a finger on the map stops that for 10 s. A tap on
  the map while navigating opens nothing.
- **Every step at the bottom**, whole (a second row when they don't fit).
- **Walking and riding**: how far is left, and one tap opens Google Maps'
  own turn-by-turn for that step (free, no billed call).
- **A bus or train step** counts down to the second and shows where it is
  now: how many stops away and which it's at, from TDX's estimates at
  every stop for a bus, and the live board and timetable for a train. No
  vehicle positions are needed.
- **On board**: the stops still to go with when it's at each (TDX's
  estimates, and your own pace from where the phone has been), and a buzz
  with the card turned round when yours is next. On an iPhone the buzz is
  a chime, since Safari can't vibrate; `primeBuzz` runs on the tap that
  starts navigation.
- **Each step** moves on by itself when you get there, by where you are
  (`tripAt`): a step's end reached, or the next step's way already under
  you (an end a fix skipped), a bus or train once its first stop is behind
  you. Started (or opened again) half way, it begins at the step you're at.
- **YouBike in navigation**: the bikes and docks at the ride's two stations
  now; found empty (or full), one tap moves the ride to the nearest station
  within 500 m that has some, the walk to it redrawn (none: 換一條路).
  Never by itself.
- **It never takes the app over.** The tabs stay; it shrinks to a bar to
  do something else.
- **The trip can change on the way**: another stop to get off at, a new
  plan from here, another place (換一條路).
- **It resumes** after the app is swiped away (`ot.nav.v1`, `savedNav`)
  until it's over or ended.
- **The lock screen**: the kit's `transit:nav` notices are handed to the
  Worker: time to leave, your bus nearly here, the train about to leave,
  your stop next.

## Bus alerts and notices

- **到站提醒** (`alerts.mjs`): "tell me when the 5608 is 5 minutes from my
  stop". It is checked every 20 s while open, told by a notice, a buzz and
  the status line, then gone, and kept on the device two hours. The
  Worker gets it too (`schedulePush`, the `bus` check in Shared-Proxy's
  `push.js`) and checks every 2 minutes itself, which is what tells you
  when the phone is locked.
- **Notice kinds** (each with its own switch, following the pass):
  `transit:bus`, `transit:nav`.
- **Holidays** (the kit's `holidays.mjs`): a weekdays-only trip
  (家 → 學校) isn't picked for a holiday.

## Where the data comes from

| Data | Source | How |
| --- | --- | --- |
| Live bus arrivals, train boards, metro boards, YouBike now | TDX | `/transit/tdx` (Shared-Proxy `transit.js`): cached and shared on the Worker (`tdxLive` 10 s, `tdxBike` 30 s), read by the app every `transitLive` / `transitBike` |
| Stations, routes, a day's timetables | TDX | `/transit/tdx` (stations a day, timetables 6 h) and the device (`orbit-transit-data` cache: stations a week, a day's 台鐵 timetable in a compact form, a tenth of TDX's 3.7 MB) |
| Bus routes and timetables | Shared-Data `bus/<City>.json`, `bus/InterCity/<square>.json` (weekly) | `packs.mjs`: kept on the phone (under 20 h fresh, any age when the site can't be reached); a route not in its pack asked of TDX |
| What's near a point | Shared-Data `where.json` (nightly) | `near.mjs`, kept a day |
| The lines' shapes | Shared-Data `shape/rail.json`, `shape/bus/…` (weekly) | `shapes.mjs`, kept a week |
| The map | Google Maps JS (the browser key, counted as a map load) or NLSC | `/transit/config` |
| Place search, details | Google Places (New), OpenStreetMap past the cap | `/transit/search`, `/transit/place` |
| Plans | Google's transit routes and TDX's planner | `/transit/route` |

Every ask is signed with the pass's session (`api.mjs`), given a time
limit, and asked once more after a failure that passes (no answer, a
timeout, a 5xx, TDX busy). The proxy says how old its copy is when TDX is
slow.

## What's kept

- **On the pass** (`store.mjs`, `t1:` + JSON, ≤ 100,000 characters,
  collection `orbit-transit`): the bus groups (pinned stops and lines),
  pinned places, saved trips (with time and days), pinned trains (a
  connection or one train), recent trips and train searches, the map's
  layers, the ways of moving and TPASS. The newer copy (by `t`) wins, and
  the device keeps one so it opens at once.
- **On the device**:
  - `ot.trips.v1`: plans built, refreshed only where live;
  - `ot.nav.v1`: the ride being followed;
  - where the device was last (the map opens there at once);
  - the `orbit-transit-data` cache, kept across versions.
- **除錯紀錄** (the kit's `rec`): a trip's plans and the bikes around them,
  before ranking. `scripts/replay.mjs` runs one again here. **Logs hold
  places**: keep them in `captures/` (git-ignored), never in the repo.

## Files

| File | What |
| --- | --- |
| `app.mjs` | The frame: the pass, the tabs, holidays, where the device is |
| `lib/api.mjs` | The proxy: TDX paths, places, plans; memory and device caches |
| `lib/tab-map.mjs`, `map.mjs` | 地圖: cards, search, plans and their steps, saving trips; Google / Leaflet + NLSC |
| `lib/planner.mjs` | A trip planned the whole way |
| `lib/plan.mjs` | YouBike ideas, our train plans, the score and the ranking |
| `lib/live.mjs` | Live bus estimates in plans; direct buses between two places |
| `lib/rail.mjs`, `raildata.mjs` | The train router (Connection Scan over 台鐵 + 高鐵) and its data |
| `lib/metro.mjs`, `metroroute.mjs`, `tab-metro.mjs` | Metro systems, boards, our metro router, the maps |
| `lib/bus.mjs`, `bus-ui.mjs` | Routes, stops, arrivals, timetables; route sheets, groups, stops near a point |
| `lib/near.mjs`, `packs.mjs`, `shapes.mjs` | Shared-Data's packs: what's near, bus packs, line shapes |
| `lib/bike.mjs`, `rivers.mjs`, `tpass.mjs` | YouBike, rivers and bridges, TPASS |
| `lib/nav.mjs`, `navlive.mjs`, `buzz.mjs`, `alerts.mjs` | Navigation, where the bus or train is, the buzz, bus alerts |
| `lib/tab-go.mjs`, `tab-times.mjs`, `tab-train.mjs`, `tab-me.mjs` | 交通, 查時刻 (and its trains), 我的 |
| `lib/tickets.mjs` | Opening the operators' apps with a train's details copied |
| `lib/store.mjs`, `city.mjs`, `ui.mjs`, `util.mjs` | The pass's data, cities, shared UI, small helpers |
| `scripts/live.mjs` | Trips on today's real data through `planTrip` (the dev door); `--against <ref>` compares code at the same moment |
| `scripts/replay.mjs` | A 除錯紀錄's trip run again (`--why` the score's parts) |
| `scripts/timing.mjs`, `navstate.mjs` | Planning time; a navigation state to preview |

## Develop, test, deploy

```bash
npm test
```

```bash
node scripts/live.mjs 竹東站 縣體育場
```

```bash
node scripts/live.mjs --against HEAD
```

```bash
node ../Shared-Proxy/tools/preview.mjs transit go --webkit
```

- **Tests**: `npm test` runs `tests/app.test.mjs` (planning, ranking,
  routers, packs, navigation on a small made-up network) and
  `tests/shapes.test.mjs`.
- **Live checks**: `scripts/live.mjs` plans a trip on today's real buses,
  trains and bikes through the dev door. `--against` runs the same trips
  on old and new code at the same moment.
- **The preview tool**: made-up TDX around 新竹車站, the NLSC map. Tabs:
  `go`, `times`, `me`.
- **Deploy**: a push to `main` runs the tests, stamps versions and
  deploys `public/`; the kit puts a new deploy in place at once.

## What depends on what

| If you change… | Also check |
| --- | --- |
| The score or ranking | The whole batch, old code against new (`scripts/live.mjs --against`), TRUTH §4's steps; `replay.mjs` on the owner's logs |
| A TDX path | Shared-Proxy's `TDX_RULES` allowlist and cache times; the `bus` push check |
| Pack formats | Shared-Data's `build.mjs`, `shapes.mjs`, `where.mjs` (their `v`) |
| Navigation steps | `ot.nav.v1`'s shape (resuming), the `transit:nav` notices |
| The status bar or top | TRUTH §10: `black`, the solid strip, the map sharp under it |
