# Orbit Transit: the map

Taiwan's public transport in one app: buses, 台鐵, 高鐵, the metros and
YouBike; trips planned the way a person really travels; navigation that
follows the trip. Signs in with the Orbit Pass, which keeps places, trips and
pins. Live: https://orbit.jaypengx.com/transit/ `FEATURES.md` lists every
feature with its code.

## Rules

Jay's, dated (Taiwan day), newest wins; the family's are in Orbit-Core `docs/RULEBOOK.md`.

**The app.**
- 11-03 The tabs are 地圖, 交通, 查時刻, 我的, opening on 地圖; never moved without asking. 交通 is one board (要去哪裡, places, trips, pins); no 附近 tab.
- 10-22 YouBike is crucial: never plan a trip without bikes as a fallback; make it load reliably instead. 10-30 YouBike shows its own logo everywhere but the map (whose pins keep the bike glyph); 一般, 電輔車 and 空位 are counted apart.
- 10-23 Operators' 停駛 notices are rules: what isn't running comes from their notices (`service.mjs`), never guessed; stopped services are never planned; a notice saying 部分, 減班 or a time of day is shown, never a stop; likely-off is 可能停駛, never 停駛. On a nothing-running day the app still works and says what's stopped.
- 10-27 A trip's legs fit one line (tighten, never wrap); 查時刻 is visual (a journey bar, live 準點/晚, the next train lit), not text.
- 11-06 Google's places on the map keep Google's own colours; a tap on one opens it at once. Google's own bus stops stay off (ours have live times). A place's or spot's card shows the YouBike near it, never its bus stops.
- Bus times: TDX's live estimates are right, TDX's timetables between the ends are often wrong, Google's planner's ride time is right (`busLink`, `liveRide`). The islands (金門, 馬祖) stay supported.
- Every real choice is shown, with official names, times and live data first. There is always a recommendation. Taxis never.
- The map opens on where you are and follows you, and never pulls you back once a finger has moved it. Navigation never takes the app over: the tabs stay, it shrinks to a bar. Status bar `black`.
- Logs hold places: keep them in `captures/` (git-ignored).

**Planning.**
- A plan costs what it costs a person, in minutes: waiting at home counts a third while short, past 15 minutes as lost time; changing onto a train is easy, onto a bus a gamble, bus to bus barely a plan; walking past 5 minutes is slow (5 km/h, one walk reads the same everywhere, by Google's streets); YouBike 10 minutes is nothing, 18 a workout, past 30 each minute counts 4.5×, two short rides beat one long; never race your own train to the next station. 高鐵 is never free; our own trains are costed by distance.
- YouBike is planned by station place, except a trip that starts on the bike: never at a station with no bike now. A trip with stops is planned whole; one kept YouBike through the stops unless a stop is far or walking it all is sooner.
- Train or bus then a ride over 頭前溪 is listed when 5 minutes sooner (at most one of each, under the recommendations); after a bus it's recommended when nothing else is close. An arrival time nothing reaches: the ways leaving now, each saying how late.
- 10-29 偏好電輔車 is a per-trip choice on the plans card (of stations about as near, the one with 電輔車, ridden at their pace); 11-04 also a setting in 我的 › 規劃, off by default (on, every trip starts with it and station cards count 電輔車 first).
- 11-03 Buses run early or late, trains on time: at a bus stop 5 minutes before its timetable time, 2 before a bus seen live; trains as timed; ranking unchanged, only the leave time. A bus TDX sees arriving is that timetable run: once it's gone before you can be there, the next run you can make; never 快一點 when hurrying can't make it (趕不上了).
- 11-03 Trains go beyond TPASS: inside a TPASS area the list and planner keep to the pass's trains, but any 台鐵 or 高鐵 train can be the one you hold a ticket for (指定車次, or 用這班規劃路線 from 查時刻); 查時刻 has 全部班次.
- 11-04 A train you pick is the train you take: a later departure chosen is never switched to a sooner one by itself; a plan you didn't pick still moves to a sooner train still to come (10-28).
- 11-06 追公車 (a YouBike to a stop further along a bus's way) is offered only when clearly sooner (8+ minutes, more for a long ride), with real room at the stop (4+ minutes), never on a stopped feed; once shown, the near or further stop keeps showing until the other is 10 minutes sooner. Planning only: never while navigating or replanning under way. (Replaced 11-03's 3 minutes.)
- 11-06 Trip results never change under the person: the plans card and 交通's trips show the whole plan once (the skeleton or a trip's last ways until then); after that a way keeps its place and labels and only its times update; a way found later joins quietly at the end (`lib/steady.mjs`).
- 11-10 下雨改搭車: rain due near a trip's ends (Weather's `weather.rain`) costs a YouBike ride or walk in it more, and the card says 會淋雨.

**Navigation.**
- 10-22 One standard table (leg type × phase × auto/user view) in one function (`navLook`); change the table, never add one-off rules.
- 10-22 On a ride: frame the remaining ride only, no zoom-follow on a bus or train; your own YouBike station icon-only (counts when zoomed in); no nearby stations or parking badges; boarding and start marks; a ring one stop before yours; no swipe-down minimize. Looking ahead on a ride keeps following it and returns with a buzz when your stop is next.
- 10-29 換附近的站 is asked only when a station runs low (2 or fewer bikes or docks; no 電輔車 for an e-bike ride); otherwise the count is a quiet tap, and it takes the station the planner would, never the nearest to the old one (11-09).
- 11-06 When something goes wrong under way, one card, any mode (`lib/trouble.mjs`): missed or late → 下一班 and 最快, each with when you're there; no bike or dock nearby → 最快; on the wrong ride (GPS) → 從這裡重新規劃. Steps move only by GPS.
- 11-07 A trip with stops is one coherent trip while navigating: the chips run to the last place, each step after a stop a tap to look at it; the bottom bar's time is the next stop's arrival (replaced 11-03's end time); riding a YouBike to a stop it asks 停著 or 還車 with which is sooner; with the free half hour, 附近換車 from 25 minutes on a bike.
- Every screen: on a wide screen the map's sheet is a panel at the map's left (pinned whole on a tablet or computer); 交通, 我的 and 查時刻 in two columns (`transit.css` §11).

## How it works

- **地圖:** YouBike stations (live counts read by the phone from YouBike's own `parkingInfo`; the proxy's TDX counts if it fails; `bike.mjs`), every bus stop with live times (stations from weekly 0.05° tiles in R2, `packs.mjs stationRows`), train and metro stations, search (`uniqueResults`), pins, a trip planned from anywhere. The map is Google under the month's cap, else NLSC (`map.mjs`).
- **交通** (`lib/board.mjs`): trips as cards with when to leave (`tripWhy`, `lastGuess` for an instant first paint, `tripLate`), 其他班次 (`otherWays`), pins; 建議 (`lib/suggest.mjs`, learning on the kit's `feedback.mjs` as `fb:transit`; `node scripts/backtest-usual.mjs --against <ref>`).
- **查時刻:** 台鐵/高鐵 station to station (`trainNow`, `traDelays`), 查車次, line maps (`linemap.mjs`), bus routes and stop timetables (`findRoutes`, `stopTable`), 捷運 as metro maps (`metromap.mjs`, worked out by `scripts/metro-maps.mjs` into `metro-drawings.mjs`; `metro-ui.mjs`).
- **Planning** (`lib/planner.mjs`): Google's and TDX's planners side by side with our own 台鐵/高鐵 router (`rail.mjs`, Connection Scan) and metro router (`trainThenMetro`); walks (`walkPlan`, Google, else OpenStreetMap); buses re-timed by TDX's live estimates (`adjustPlan`, `live.mjs seenAt`, `nextCatchable`, `boardEarly`); a stale feed (`ETA_STALE` 4 min, `ETA_GHOST` 15) never shown as live; lagging buses re-counted from GPS (`lib/busgps.mjs gpsFix`); YouBike stations by street walks and road rides (`api.mjs bikeRides`); fares (`raildata.mjs planFare`, `tpass.mjs`); 追公車 (`lib/chase.mjs`); 指定車次 (`lib/ticket.mjs`); on board (`lib/aboard.mjs`). The first plans wait at most 1.5 s (`FIRST_WAIT`); a saved trip's ways are kept and re-timed live.
- **Ranking** (`plan.mjs rank`): fold the ways a person wouldn't take, then order by door-to-door minutes plus a small table of bother (`scoreParts`), rain included (`lib/rain.mjs`).
- **Navigation** (`nav.mjs`, `navlive.mjs`): the whole trip on the map, steps moving by GPS (`rideAlong`, `rideOn`, `offPlan`, `fixAt`), 台鐵 delays from 台鐵's own boards through the Worker (`traTrain`, `traLive`), `pickedPlan`, `pastHurry`, the 出狀況 card, stops (`stopShort`, `peek`, `parkAsk`, `PLAN_V`), resumes after the app is swiped away. Replays: `node scripts/replay-nav.mjs <log.json>`; `tests/nav-replay.test.mjs` replays `tests/fixtures/trips/`. 台鐵's track is OpenStreetMap's (`public/rail-tra.json`, `scripts/rail-osm.mjs`, ODbL credited in README).
- **Timers and alerts:** the YouBike rental timer (`rental.mjs`, `splitRide`); 到站提醒 (`alerts.mjs`, checked by the Worker every 2 minutes).
- **Data:** live TDX through `/transit/tdx`, cached on the Worker; buses due through `/transit/eta`: 新竹, 臺北, 新北 from the cities' own sites (Orbit-Core `transit-free.js`); 臺中, 桃園, 臺南 read by the phone from the cities' bus sites (`ebbus.mjs`, kit `ebus-read.mjs`), 高雄 by the phone from its ibus site (`khbus.mjs`), the Worker's as fallback; routes asked together, once a beat at most, `had=` saying the copy's age (`tests/bus-asks.test.mjs`, `bus-quiet.test.mjs`). Bus routes, timetables and shapes: weekly packs in R2 built from TDX's free GTFS (Orbit-Core `tools/gtfs-buses.mjs`, `builders/ntpc.js`), read with the kit's `packJson` (`packs.mjs`, `shapes.mjs`). Metros' maps, timetables and live boards, 高鐵's days and rail stations: the Worker's copies (`transit-free.js`). What's near a point is worked out on the phone (`near.mjs`). Notices: TDX's and, for 臺中 and 高雄, the cities' own (`ebnotice.mjs`). The family: Weather's rain, Money's 車資記帳 (`transit.ride`), the planner opened by `#plan` (kit `planHash`) from Class, Sports and the Pass.
- **Saved:** on the Pass (`store.mjs`, `t1:`, up to 200,000 characters): groups, pins, trips, preferences; on the phone `ot.trips.v2`, `ot.trips.last.v1`, `ot.nav.v1`. **Offline:** covered (`onlineOnly`); never old bus times.

## Files (`public/`)

| File | What |
| --- | --- |
| `app.mjs` | The frame: Pass, tabs, location |
| `lib/api.mjs` | The proxy: TDX, places, plans, walks; caches |
| `lib/book.mjs` | 高鐵訂票: a 高鐵 ride's booking, filled in (Core `/transit/book`, TDX 訂票導訂; 臺鐵's when TDX approves it): a small sheet with the T Express app's link first (ets.thsrc.com.tw, its universal link, tapped for real so iOS can open the app) and 高鐵's website beside it (the Pass's way for links: quick view or Safari) |
| `lib/planner.mjs`, `plan.mjs`, `live.mjs` | Planning; YouBike ideas, score and ranking; live re-timing |
| `lib/chase.mjs` | 追公車: a bus caught further along its way by YouBike |
| `lib/rail.mjs`, `metro*.mjs` | The train router; metro router, boards, maps |
| `lib/linemap.mjs`, `tra-map.mjs` | The station picker's line map: each line winding across its card (`rowLength`, `mapCols`), 新竹市/嘉義市 one area with their 縣 (`areaOf`, `areaParts` joins the lines), a 高鐵 station within 900 m of a 台鐵 one a tap on that stop (rerun `node scripts/tra-map.mjs` when 台鐵 opens a station) |
| `lib/khbus.mjs` | 高雄's buses from the city's own site, read by the phone (the Worker's if it can't) |
| `lib/ebbus.mjs` | 臺中's, 桃園's and 臺南's buses from the cities' own sites, read by the phone with the kit's reader (the Worker's if it can't) |
| `lib/bus.mjs`, `bus-ui.mjs`, `busgps.mjs` | Routes, stops, arrivals; the route strip; a route's sheet (its stops with the buses on the line: a bus a green dot a size up from a stop's, 進站中 / 即將進站 at the list's own size in the live green, never a red pill); a lagging bus placed by its GPS |
| `lib/rain.mjs` | 下雨改搭車: Weather's wet stretches near a trip's ends, what rain costs a ride or a walk, the wet legs marked |
| `lib/family-share.mjs` | Transit's home, school and work places and saved trips told to the kit's family notebook (`family.mjs`, read by a dynamic import) on each save and merge, only when changed (`shareFamily`): Weather's 下雨改搭公車 reads them; a trip set out on (`navigate`, tab-map.mjs) whose fare is one known price told as the family's latest ride (`rideFact`, `shareRide`: `{ id, at, name, fare, modes }`), for Money's 車資記帳 to offer |
| `lib/said.mjs`, `say-trip.mjs` | 用說的查路線 (✦ beside 要去哪裡; 問 Orbit's `#ask=<words>`, kit `takeAsk`, opens it asked, app.mjs `askFromLink`): a plain 從 X 到 Y / 去 Y read by code (`readSaid`, straight to the map); a sentence with a time to the Worker's AI (Core `transit-say`: the two places as written, the day and time), drawn under the Orbit AI mark as 出發, 到達, 時間 with 看路線; `whenOf` makes the moment on Taiwan's clock; each place one of yours by its name (`placeNamed`) else the place search with the words in it (`ctx.planSaid`, tab-map.mjs) |
| `lib/tab-go.mjs` `tripLeaves` | 通勤小幫手 (the AI plan): each saved trip's 「10 分鐘後出發」 notice, sent by the Worker with the alerts (`setTripPush`): a weekly trip's next days within a week (its way out; holidays skipped by `tripNow`), a one-time trip's day; when to leave from a way kept for that same time out, else its time out (by an arrival time: the kept way's length before it, else an hour). No bus check: no TDX read for it |
| `lib/slow.mjs` | 這班為什麼慢 (code, under the Orbit AI mark): a pinned 台鐵 train's 晚 N 分 on 交通 is a tap (`data-slow`, tab-go.mjs `openSlow`): where it is now (`traTrain`), when it reaches your station at this delay, and 台鐵's alerts on its way today (`traAlertsNow`, `alertsOn`: a station of its own in the alert's scope, or the whole network's), drawn by the kit's `aiAnswer` (`slowSpec`); never a cause no notice gives |
| `lib/links.mjs` | Another app's link to a trip: `#plan?to=<lat>,<lon>,<name>[&by=<ISO time>]` (`planLink`; `planHash` makes one), opened by `app.mjs` `openLink` on the map from where you are, arriving by then; the address left as `#map` |
| `lib/fare.mjs` | A bus ride's fare, stop to stop (a route sheet's 票價): TDX's RouteFare a route at a time, kept a week; 段次 with its buffer zones, stop to stop (公路客運), stages; free buses |
| `lib/board.mjs`, `board.css` | 交通's board: `boardRow` (a row of the one shape), `whenHtml` (the time at its end) |
| `lib/near.mjs`, `packs.mjs`, `shapes.mjs` | R2 data: what's near, bus packs, shapes |
| `lib/bike.mjs`, `rental.mjs`, `rivers.mjs`, `tpass.mjs` | YouBike; the rental timer; bridges; TPASS |
| `lib/nav.mjs`, `navlive.mjs`, `trouble.mjs`, `buzz.mjs`, `alerts.mjs` | Navigation; 出狀況 (missed, late, no bikes, wrong ride); the buzz; bus alerts |
| `lib/aboard.mjs` | Already on a bus or train: which one, and the trip from its stops ahead |
| `lib/ticket.mjs` | 指定車次: a train by its number, where to get on and off, found again for the planner |
| `lib/service.mjs`, `ebnotice.mjs` | What isn't running: operators' notices (台鐵, 高鐵, metros, buses) as rules; 臺中's and 高雄's bus notices read by the phone |
| `lib/compass.mjs` | Which way the phone faces, for the soft beam on your dot (`.ot-beam`): the compass (an iPhone asks only from a tap on your own dot, once a launch, never after a no; never on opening or 我的位置), else the GPS's heading when moving; none known, or riding a bus or train (`navNow().aboard`, or a bus's or train's pace), no beam |
| `tripCard` (tab-go) | 交通: a trip's card, its own icon (`look.mjs tripTile`: the place it ends at, else its name; never a bus's badge), its way as one line, the next two ways in three hours; a tap on a way shows it on the map ready to go |
| `trimEnds` (tab-map) | A walk's or YouBike ride's line cut where it stops coming nearer its end (no detour past a station and back) |
| `declutter` (tab-map) | A trip's marks never in a heap: by the map's zoom the end, start, boarding and YouBike marks win their spot in that order, one covering a more important one waits for a closer zoom, your stop's name drops where it would run over one (`tests/declutter.test.mjs`) |
| `lib/tab-*.mjs`, `map.mjs` | Each tab; Google or Leaflet+NLSC behind one interface; `mapStyles` Google's look |
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
- `live.mjs` and `verdict.mjs` read the proxy through `scripts/dev-fetch.mjs`:
  each address once in 5 minutes for every tool run (Orbit-Core's
  `tools/live-keep.mjs`; `ORBIT_LIVE_KEEP=off` asks each time), so
  `--against`'s two runs see the same buses. `timing.mjs` and
  `bus-rhythm.mjs` time the live answers: they ask every time.
- `node scripts/timing.mjs <from> <to> --warm` times a plan and counts its
  Worker asks by kind, on a new phone and then the same phone again
  (`scripts/phone.mjs` keeps its storage): run it before and after a change
  to what a plan reads.

A push to `main` tests, stamps versions and deploys to Cloudflare.

## If you change…

| This | Also check |
| --- | --- |
| The score or ranking | The verdicts, `live.mjs --against`, `replay.mjs` |
| A TDX path | Orbit-Core's `TDX_RULES` and cache times, the `bus` push check, `scripts/timing.mjs --warm` (asks before and after) |
| Pack formats | Orbit-Core's `builders/buses.js` |
| Navigation steps | `ot.nav.v1` resuming, lock-screen notices (`kind: nav`) |
