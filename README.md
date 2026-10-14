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
| **地圖** | The home tab. The map (Google's while the month is under the proxy's cap, else Taiwan's NLSC map in Leaflet; `map.mjs` is one interface over both) shows YouBike stations (regular and ⚡ 電輔車, and docks; along the bottom the five nearest you, each with its walk, nearest that way first; drawn once, in its order, behind the loading screen), every bus stop (one marker a stop, each side of the road close in, with live times; one sign that each operator names its own way, 火車站, 新竹火車站 and 新竹站 a few metres apart, is one stop, named as most of its buses call it: `stopGroups`), and 台鐵, 高鐵 and metro stations. Search places, tap anything for its card (a station's bikes and docks, a stop's buses, a station's next trains), pin places (each pinned place is on the map at every zoom, its icon and its name on a solid label; one pinned from Google's places sits on Google's own icon and covers its name, since Google can't hide a single place; a tap opens its card, as its chip above the map does; hidden while navigating), and plan a trip from here, a pinned place, a search or a spot on the map. A time picked (出發時間, 抵達時間) is for that trip (its ways of moving, its stops, turned round); a new trip is from now. ☆ saves a trip; 開始導航 follows it. A plan's buses, trains and metro are drawn along their real lines (`shapes.mjs`); the rides we add go along OpenStreetMap's bike router (free).

**One walk, everywhere** (`api.mjs walksTo`, `tab-map walkFrom`): the strip, a card's 距離 and 走過去, the walk it starts, a trip's walks we add, and a trip that's only a walk from where you are, all say the same for one walk: Google's streets (the proxy's `/transit/walk`, its route matrix for the strip's five in one ask, a walk with its line for the map; free under the month's cap, each walk kept there a month and on the phone), OpenStreetMap's foot router past the cap (it misses lanes Google knows: 485 m round the block where Google's 210 is right). Its time at our pace (5 km/h). From where you were when it was last asked, until you're 20 m on, so they agree and Google is asked once each 20 m; the strip isn't asked while it's hidden (navigating, looking at a trip).

**Opening** (`tab-map ready`, `app.mjs`): the loading screen lifts onto the finished map: a fresh fix (1.5 s at most; the kept one after), the tiles (1.5 s at most), what's in view and the strip in its order; 4 s at the very most. The map's library and its tiles' servers are asked by the page as it opens (`index.html`, the provider kept from the last opening), not once the app's code is in. Each ride's start is marked on the way; a YouBike's stations are the map's own station markers, the tip on the station, with what you need there as it is now: where you take one its bikes (the bike, ⚡ too), where it goes back its docks (a parking P, an icon like its bike, `dock`), a swap (every 30 minutes) both on one marker; no words on the marker (`planBikes`, `planBikeMarker`), looking at the trip and navigating, when the map's other bike stations are off. |
| **交通** | What's coming that you'd take, refreshed while open: **常用・釘選行程** (your saved trips' next ways to go, recurring ones by day, with the buses' real times; one tap navigates; always from the trip's own start (from where you are only within 800 m of it, or when its start is 目前位置), the way back by itself once you're in the far end's part of the trip, its last 30%, `tab-go tripNow`; a trip saved from where you are keeps that spot as its start, and 編輯行程 changes either end); **釘選的公車・火車** (a stop's bus, a connection, one train, from whichever end you're nearer); **釘選地點** (each place's buses, bikes, station, and how to get there). What's recommended is never pinned by itself: ☆ pins it. |
| **查時刻** | A timetable on purpose. **台鐵・高鐵**: station to station, changing wherever it's faster (the router), with each option's trains, where to change and the wait, the fare and today's delays; ☆ pins a connection or one train. **公車**: a route by number or stop name (your city, its neighbours and 公路客運), each route with its next bus at its stop nearest you (`nextNear`: that stop, the way it goes, when it comes; the timetable's next when none is on its way; asked for the routes on screen as each comes into view, again every 30 s; with no position, where it runs between), its stops each way with the buses now (a bus at a stop on its dot, once: the stops it reaches next say 即將進站 without one; one between two stops on the line between them), or a stop's timetable for any day of the coming week; ☆ pins a stop. |
| **我的** | **地點** (rename, reorder, remove); **行程** (a place to a place, maybe at a time, maybe every weekday; the way back comes by itself); **釘選交通** (bus stops in groups: 常用, 上班, 回家…; trains); **交通偏好** (which ways of moving to use, 每 30 分鐘換 YouBike, the app a walk or a ride is handed to: Google 地圖 or Apple 地圖, your TPASS); **車票** (高鐵 T Express and 台鐵 e訂通: the app opened, the train's details copied, `tickets.mjs`); **捷運路網圖** (each city's metro on the real map, a station's next trains, live where the operator sends them). |

**A bus route as a strip** (`bus-ui strip`): one look wherever a route is listed: 查時刻's routes, 交通's pinned rides and the buses near a pinned place, a stop's card on the map. The route's number and a note (its way, its city, TPASS) on top, the main words (where you get on, or the way it goes) the whole width under them, the next bus on the right (`busWhen`: live while a bus is on its way, else the timetable's next there with its day, `plannedAt`); a ☆, 🔔 or 去程/回程 beside it. Words shrink to their room (`fitStrips`, the kit's `fitNumbers`), never a second line, never cut.

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
   N1 estimates at the boarding stop): the first you can be at the stop for
   from when you set out (now, or the time asked), not the one the plan was
   made around; the stop's live times stay on the leg, so a way to it made
   later (a bike instead of the walk) catches its bus from them too
   (`plan.mjs catchBus`). That gives the bus you'd really
   catch, the rest of the trip moved with it, and a train it would now miss
   marked. Google's and TDX's names for one route are matched (快捷8經興隆大橋
   = 快捷8號, Chinese numerals as digits; never 5 and 5608).
4. **YouBike ideas** (`plan.mjs`), by where the stations are, not by the
   bikes or docks there at the moment (too live to plan on; 換附近的站 is a
   tap, navigating), with one exception (the owner, 2026-10-13): a trip that
   starts with the bike never takes it at a station with none there as you
   plan (`rentNear first`; for a 電輔車 ride, none of those); a bike taken
   later (off a train) and where it goes back stay by place. The walks to
   and from the five stations nearest each end are by the streets (Google's,
   `planner streetWalks`, `plan.mjs useStreetWalks`): a station round a
   stadium's block is no short walk however near it looks; choosing one, a
   walk past 5 minutes counts double (新竹縣體育場 151 m on foot, not 成功國中
   503 or 光明九路停車場 511). A station out of
   service isn't one; every station is YouBike 2.0's, 電輔車 included:
   - all the way by bike (or 電輔車), when it's near enough;
   - by bike to the train or metro instead of a bus or a long walk (leave
     later, the same train);
   - by bike from the last station;
   - a change gone at either end (by bike to the bus after it, or off the
     first one and on by bike), and both together (成功九街 → 竹東高中: by
     bike to 文興嘉興路口, not a 16-minute walk, off the 快捷8號支 and on by
     bike).

   The station to take a bike from and leave it at is the one that makes
   the whole way quickest (綠41公園 on the way home from 六家, not the
   nearer one past it). A station behind you is walked out to and ridden
   back over the same ground, both lost (from 成功九街 to the bus at
   文興嘉興路口, 綠41公園 on the way, not 成功國中 behind for a few metres
   less walk); a walk past 5 minutes is slow going, as in the score.
   每 30 分鐘換 swaps bikes to stay free, always for a TPASS that takes
   YouBike (its switch shows only without one). To be there by a time,
   riding it all sets out to get in 5 minutes early, and our own trains,
   the buses to the stations and the buses on from them are searched
   from two hours before (the planners leave out the 六家線 then 內灣線 to
   竹東; without YouBike, a bus to the station, not a 5 km walk).
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
  `where.json` (the family's data) says which packs have stops near.
- **Buses due**: one ask a city for every stop wanted at that moment.
- **YouBike**: the city's stations, one ask a city.

Each falls back to TDX's own search when the packs can't be had.

## Ranking: what's practical

`plan.mjs rank`. Two steps, so fixing one case can't quietly break another:

1. **Which ways are shown** is decided by comparing ways the way a person
   does, never by a total coming out a point lower. A way is folded (set
   aside, still there to open) when:
   - **a bus then another bus**, whenever a way without one is there
     (Taiwan's buses don't keep their times: the change is a gamble);
   - **over the river on the bike** before or after a bus or train, when a
     way whose bus or train crosses it, or riding the whole way (40 minutes
     at most), gets there within 20 minutes (新竹站 → 成功九街: the 竹北 train
     and a ride, not to 千甲 and a ride over 頭前溪);
   - **the same last train from another first one**: out no earlier, there
     no later, less bother (the 六家線 to 竹中 for the 1804, not 竹北 and a
     change at 北新竹 for it);
   - **the same train for nothing**: another way sets out on the same first
     bus or train, changes no more, rides home about as long after it (8
     minutes more at most) and is there no later (on to 千甲 when off at 竹中
     is home first; on to 北新竹 or 新竹 and back up to 竹北 when the change
     to the 六家線 is home first);
   - another way onto the same rides is no earlier out, no later there and
     **less bother** (a bike to the train instead of a walk and a bus);
   - more changes than a way no later (5 minutes) and no more bother;
   - a change for a hop a walk or a bike would do;
   - one of its rides is most of what riding all the way would (two short
     rides around a train are gap-fillers, not that);
   - a walk over 2 km to a bus or train, while a way without one is there;
   - it's far behind the best (never riding it all: a choice of its own;
     by a time, never kept for getting in sooner).

   "Bother" is everything but time: changes, buses, walking, riding, the
   long way round, money. Folded ways fold nothing else. The same train left
   at stations a kilometre or more apart is two ways, each kept.
2. **The order of what's left**: door to door in minutes, plus a short
   table of what each bother is worth (`scoreParts`, `scripts/replay.mjs
   --why` shows them):

| Part | Worth |
| --- | --- |
| Time | Door to door; the wait before leaving a third while short (spent at home), past 15 minutes as time lost; by an arrival time, how early you must leave |
| Changes | Onto a train or metro 7, onto a bus 10, a bus to a bus 35 |
| Each bus | 4 (early at the stop, late anyway) |
| Walking | Past 5 minutes, 0.6 a minute |
| Each bike ride | 10 minutes nothing, to 18 a little, to 30 each minute twice (20 or 25 is about the same ride), past 30 each minute 4.5×; two short rides beat one long one; 電輔車 a little easier |
| The long way round | Lines half as far again as the straight way; a change farther from the place than the start; chasing your own train |
| Money | What it costs after TPASS; a train it would now miss |

Live bike counts, a bus's minutes on board and a line's small bends count
for nothing: small things never flip a choice.

**The owner's verdicts** (`tests/verdicts/`, `tests/verdicts.test.mjs`):
real trips saved on the day (`node scripts/verdict.mjs <name> <from> <to>
--at <time>`), their plans and bikes before ranking, ranked again on every
`npm test` and checked against what the owner said, and again with each
bus a few minutes earlier or later (seven patterns, as live times move):
a verdict that flips fails the tests. Every trip the owner judges is added.

The first few plans with different main lines show as **推薦**, and the
rest fold.

## Navigation

`lib/nav.mjs`, `navlive.mjs`, `buzz.mjs`. A plan followed step by step with
the phone's position:

- **The whole trip on the map**: every step in its colours (the one you're
  on boldest, the ones behind you faint). In view, the stage you're at
  (`stageView`): walking or on a bike, you and the rest of that step to
  where the next one starts, close up (on foot at least ~200 m across, a
  street or two; on a bike ~400 m); waiting, the street itself (~100 m
  across: which side of the road the stop is on), wider only to have you
  in it too, until the ride has you on board; on board, the rest of the ride to your
  stop. A finger on the map stops that for 10 s. Back in the app, the
  stage again once the page has its size (a fit with no room to fit into
  is left for the next, never zoomed out to the island: `map.mjs`
  `roomFor`). A tap on the map while navigating opens nothing. A saved
  trip or another plan opened while navigating shrinks navigation to its
  bar first.
- **The line under the step** (the bus to catch, how early or late) is
  whole: it goes on to a second line between its parts, never cut.
- **Every step at the bottom**, whole (a second row when they don't fit);
  a tap on any one ahead goes to it (and back again: a step you only
  looked ahead past stays tappable); the ones the trip has got past by
  itself (where you are, an arrival, getting off: `state.reached`, never a
  tap) are faded and can't be tapped.
- **Both cards fold** for more map: a tap on a card's grip, or a swipe (the
  top up, the bottom down). Folded, the top keeps its step and the line
  under it; the bottom when you're there, ⋯ and 結束. Kept on the device
  (`ot.nav.fold`); the map fits the room left whenever a card's height
  changes (`cards`).
- **Walking and riding**: how far is left, and one tap opens Google Maps'
  or Apple Maps' own directions for that step (我的 → 交通偏好 → 導航 App;
  walking for a walk, cycling for a YouBike ride; free, no billed call),
  opened to look over and start yourself; from where you are on the step
  you're at, from the step's own start on one looked ahead to (or a plan's).
  Never for a bus or train: those the app navigates itself (the owner,
  2026-10-13: the whole trip by Google's transit, from ⋯, removed).
- **A bus or train step** counts down to the second and shows where it is
  now: how many stops away and which it's at, from TDX's estimates at
  every stop for a bus, and the live board and timetable for a train. No
  vehicle positions are needed.
- **On board**: the stops still to go with when it's at each (TDX's
  estimates, and your own pace from where the phone has been), and a buzz
  with the card turned round when yours is next. On an iPhone the buzz is
  a chime, since Safari can't vibrate; `primeBuzz` runs on the tap that
  starts navigation. Off the ride for 45 s (far from both the line through
  its stops and its road on the map, `navlive.mjs offRide`: a loop's road
  is far from the straight lines between its stops), it asks 好像已經下車了？
  with 從這裡重新規劃.
- **Each step** moves on by itself when you get there, by where you are
  (`tripAt`): a step's end reached, or the next step's way already under
  you (an end a fix skipped), a bus or train once its first stop is behind
  you. Started (or opened again) half way, it begins at the step you're at.
- **Another departure**: tap the countdown (or ⋯ → 改搭別班) for the bus's
  or train's next departures (live, or the timetable's), one tap to take
  one; what follows moves with it, and a train it would now miss is said.
  **Missed it** (past its time, a train's with its delay, and you're still
  at the stop or station): the next one by itself, said and buzzed. A bus
  with live times counts down to the next that comes.
- **To be there by a time** (a trip planned 抵達 by it): late for the bus
  on the way, or the next one in too late after missing it, the ways from
  where you are for the same time are looked for, and the best that's on
  time offered on the card (「趕不上 5608 的話・改騎電輔車，07:55 到」, one
  tap swaps the navigation), or said that none is. 換一條路 plans by that
  time too.
- **YouBike in navigation**: the bikes and docks at the ride's two stations
  now; found empty (or full), one tap moves the ride to the nearest station
  within 500 m that has some, the walk to it redrawn (none: 換一條路).
  Never by itself.
- **It never takes the app over.** The tabs stay; it shrinks to a bar to
  do something else.
- **The trip can change on the way**: another stop to get off at, a new
  plan from here (換一條路), and 編輯行程: the places still to go, each
  changed with a tap or taken off with ×, a stop added first or last. A
  change to where you're heading first re-routes; on a bus or train it keeps
  you on it: off at its
  stop nearest the new place or the one you had, whichever has you there
  sooner (the one you had when its stops aren't known), the rest planned
  from there, and the place you were going to next after it (`onBoardTo`,
  `navRetarget`, `navRest`). Walking, riding or waiting: the ways from here.
  A change to the places after it only changes the list.
- **Stayed on past your stop**: taken as off at it, but still going along
  the bus's or train's way 300 m and more past it, you're back on it, off at
  the next stop, the rest planned from there (`state.passed`, `stayedOn`).
- **Each ride's stops on its line** (a bus's, a train's, the metro's:
  `metro.mjs metroStops`), dots, where you get off ringed; every ride's
  stops are loaded when navigation starts (`navStops`).
- **It resumes** after the app is swiped away (`ot.nav.v1`, `savedNav`)
  until it's over or ended: it ends by itself when you get there (`arrival`: within 60 m of the end, or stopped a minute within 100 m, at the door of a place whose point is mid-block; never while walking on, nor with more than 90 m left along the walk's way), else 90
  minutes past the planned arrival (a late bus is still being ridden).
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
| Live bus arrivals (each estimate counted from its `DataTime`, when TDX made it: `util.mjs etaAge`), train boards, metro boards, YouBike now | TDX | `/transit/tdx` (Shared-Proxy `transit.js`): cached and shared on the Worker (`tdxLive` 10 s, `tdxBike` 30 s), read by the app every `transitLive` / `transitBike` |
| Stations, routes, a day's timetables | TDX | `/transit/tdx` (stations a day, timetables 6 h) and the device (`orbit-transit-data` cache: stations a week, a day's 台鐵 timetable in a compact form, a tenth of TDX's 3.7 MB) |
| Bus routes and timetables | The family's data (R2, the proxy's `/data/`): `bus/<City>.json`, `bus/InterCity/<square>.json` (a city weekly, Shared-Proxy `builders/buses.js`) | `packs.mjs`: kept on the phone (under 20 h fresh, any age when the site can't be reached); a route not in its pack asked of TDX |
| What's near a point | `/data/where.json` (weekly, with the packs) | `near.mjs`, kept a day |
| The lines' shapes | `/data/shape/rail.json`, `shape/bus/…` (weekly) | `shapes.mjs`, kept a week |
| The map | Google Maps JS (the browser key, counted as a map load) or NLSC | `/transit/config` |
| Place search, details (Autocomplete beside Text Search's 20 near you: a chain's branches nearest first, a typo still found, the same chain far away left out while one is near, a place's parts folded into it: LaLaport, not its cinema or car parks; Shared-Proxy `nearFirst`, `folded`) | Google Places (New), OpenStreetMap past the cap | `/transit/search`, `/transit/place` |
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
| `lib/near.mjs`, `packs.mjs`, `shapes.mjs` | The family's data (`/data/`): what's near, bus packs, line shapes |
| `lib/bike.mjs`, `rivers.mjs`, `tpass.mjs` | YouBike, rivers and bridges, TPASS |
| `lib/nav.mjs`, `navlive.mjs`, `buzz.mjs`, `alerts.mjs` | Navigation, where the bus or train is, the buzz, bus alerts |
| `lib/tab-go.mjs`, `tab-times.mjs`, `tab-train.mjs`, `tab-me.mjs` | 交通, 查時刻 (and its trains), 我的 |
| `lib/tickets.mjs` | Opening the operators' apps with a train's details copied |
| `lib/store.mjs`, `city.mjs`, `ui.mjs`, `util.mjs` | The pass's data, cities, shared UI, small helpers |
| `scripts/live.mjs` | Trips on today's real data through `planTrip` (the dev door); `--against <ref>` compares code at the same moment |
| `scripts/replay.mjs` | A 除錯紀錄's trip run again (`--why` the score's parts) |
| `scripts/timing.mjs`, `navstate.mjs` | Planning time; a navigation state to preview (`long`: an eight-step trip) |
| `scripts/verdict.mjs`, `tests/verdicts/` | The owner's verdicts: a real trip saved, ranked again by `tests/verdicts.test.mjs` |

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
| The score or ranking | `npm test` (the owner's verdicts, with buses a few minutes off), the whole batch old against new (`scripts/live.mjs --against`), TRUTH §4's steps; `replay.mjs` on the owner's logs |
| A TDX path | Shared-Proxy's `TDX_RULES` allowlist and cache times; the `bus` push check |
| Pack formats | Shared-Proxy's `builders/buses.js` (its `v`) |
| Navigation steps | `ot.nav.v1`'s shape (resuming), the `transit:nav` notices |
| The status bar or top | TRUTH §10: `black`, the solid strip, the map sharp under it |
