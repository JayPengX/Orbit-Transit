# Orbit Transit: the map

Taiwan's public transport in one app: buses, 台鐵, 高鐵, the metros and
YouBike; trips planned the way a person really travels; navigation that
follows the trip. Signs in with the Orbit Pass, which keeps places, trips
and pins. Light or dark follows the phone; the look is `lib/look.mjs` on the kit,
in Orbit's own look (Jay 2026-11-03, Orbit-Core DESIGN §11: `data-look="native"`
on the page, `board.css` after `transit.css`).

Live: https://orbit.jaypengx.com/transit/

## How it works

- **Tabs** (地圖 first, where the app opens; Jay 2026-11-03: "map should be the first tab"):
  - **地圖:** YouBike stations (the five nearest along the bottom), every
    bus stop with live times, train and metro stations, search, pins, and
    a trip planned from anywhere. A stop's signs a few metres apart are one
    stop (`stopGroups`).
  - **交通:** one board (`lib/board.mjs`, `board.css`; Jay 2026-11-03 found
    the old green focus card "kind of useless": half a screen for one item,
    a different one each open). 要去哪裡 (a bar opening the place search,
    `ctx.planTo`), your places as chips (a tap opens the place: its buses,
    its bikes, 怎麼去), then 我的路線: each trip, pinned bus and pinned train
    a row of one shape (its line's badge in its colour, what and where, the
    time at the end) in the order you keep them, never lifted into a card or
    moved as times change. A trip's row says when to leave and when you're
    there, or why not (`tripWhy`); a tap opens its ways on the map (導航, the
    other ways and times, a way pinned first); editing it is in 我的. Then
    附近: the stops around you with the buses on their way, which way each
    goes (`nearHeads`), the timetable's next where none is (`nearPlanned`),
    and the routes with none as one quiet line.
  - **查時刻:** 台鐵/高鐵 station to station (changing where faster; a
    station picked by search, a nearby or recent one, or on a county's line
    map: `linemap.mjs`, the lines from `scripts/tra-map.mjs`), bus
    routes by number or stop, stop timetables, and 捷運: each city's metro
    as a metro map (`metromap.mjs`: the lines straightened to the eight
    directions from TDX's real stations, worked out ahead by
    `scripts/metro-maps.mjs`, a phone redraws only when the network
    changes), pinch and drag, the trains arriving now on it, 實景 for the
    real map. A station: its line codes, the next trains each way counting
    down (live where the operator sends them, else the timetable, else how
    often the line runs), first and last trains, exits (`metro-ui.mjs`).
  - **建議** (on 交通, `lib/suggest.mjs`): each trip planned keeps its time
    (the last 12 per place in 最近); a place gone to 3+ times at about this
    hour on days like this (a working day or a day off on Taiwan's calendar,
    `util.mjs workday`: a holiday is a day off) comes up as 常在這時候去, its
    distance first, a tap plans it (not when you're there, nor when a saved
    trip or 回家 covers it; somewhere else usual now, 補習班, goes before
    回家). From the first day, a working day's morning at 家 has 去公司 or
    去學校 from the places pinned (`goScore`; not on a typhoon day off there).
    These guesses of a place learn on the kit's feedback.mjs (`lib/learn.mjs`,
    `fb:transit` on the Pass): each card drawn and each trip planned, by the
    place and the place on that weekday (`placeItem`); one passed over too
    often stops coming (`chance` under 0.16). `node scripts/backtest-usual.mjs
    --against <ref>` replays made-up people (2026-11-03, first two weeks
    caught 53/45/64% → 74/65/86%; wrong cards a week, later, a student
    7.9 → 4.5, one who never plans the commute 3.3 → 1.0).
  - **我的:** places, trips, pinned stops, 交通偏好 (ways of moving, TPASS,
    the maps app).
- **Planning** (`lib/planner.mjs`): Google's and TDX's planners side by
  side, plus our own 台鐵/高鐵 router (`rail.mjs`, Connection Scan) and
  metro router. A planner's YouBike ride needs a real station at each end
  (never a made-up 附近的 YouBike 站). Buses are re-timed by TDX's live estimates (`adjustPlan`).
  Our own bus ride's minutes (`busLink`): TDX's buses on the road first
  (`live.mjs liveRide`: each hop between two stops showing the same bus, as TDX
  estimates it), else the timetable's run you'd be on (`rideTime` with the
  moment it boards; never its first run: 5608's 05:34 at 7 minutes stood for
  every hour). A timetable's times between its ends can be far off (5608's
  15:23 says 10 minutes to 豐邦公司; the bus took 23, as TDX's live estimates
  said). A planner's bus keeps its own ride (Google's 22 minutes there was right).
  A bus TDX sees is matched to its timetable run (`live.mjs` `seenAt`,
  `nextCatchable`): one seen gone before you can be there is never planned
  or shown again, the next run you can make is. You're at a bus stop 5
  minutes before a timetable time, 2 before a bus seen live; trains as
  timed (`plan.mjs boardEarly`, after ranking: the leave time alone moves).
  A live bus is taken when the timetable has one due about then
  (`liveTrusted`); at a stop the timetable doesn't time (快捷8號 times only
  台大竹東分院 → 砂石廠), when a run left the first stop for it. A route
  sheet draws a bus between two stops only where a live time drops below the
  nearest one before it, a stop without one in between being no bus
  (`bus-ui.mjs busBetween`; `tests/route-bus-icon.test.mjs`).
  A TDX estimate is counted from its DataTime (`etaAge`, at most 5 min). One
  over 4 minutes old is a feed that stopped (`util.mjs ETA_STALE`; TDX's usual
  lag is 1–3.5): shown as it was, 可能已過 for 3 minutes or less, never
  進站中, no bus drawn or placed (`busWhere`), the route sheet saying so once
  at the top; over 15 (`ETA_GHOST`) no live time and none planned on
  (`tests/eta-stale.test.mjs`: 快捷8號's feed froze 17:37:54 on 2026-11-03).
  A route sheet counts a lagging bus again from its GPS (`lib/busgps.mjs`
  `gpsFix`, `bus.mjs routeEtaMended`: TDX RealTimeByFrequency, under a minute
  old, placed along the route's shape, `shapes.mjs routeLines`): the stops it
  has passed lose their time, the rest are the estimates' own gaps from where
  it is (`tests/bus-gps.test.mjs`; on 快捷8號 the error to where buses really
  got to fell from about 2 minutes to under 1).
  Stop cards, a trip's bus, a ride aboard and the planner's live buses read
  the same fix (`bus.mjs busEtaMended`, in place of `busEta`: up to 8 lagging
  routes, never waiting past 2.5 s), so a frozen feed is felt nowhere.
  Today and the next day on one line (`bus-ui.mjs` `nexts`, `doneToday`):
  the stops today's last bus has passed are the next day's (the line grey
  there, the day said once where they begin); where today's begin, that bus
  by the timetable as a ring on the line and 末班車. Today's last is kept 15
  minutes past its time until a bus is seen beyond the stop (it shows up live
  only once it's out). 今天已收班 only when no stop has a run still to come.
- **追公車** (`lib/chase.mjs`): a plan's first bus, walked to, due within the
  hour: a YouBike to a stop further along its way (within 4.5 km of you)
  where TDX sees a bus ahead of the one you'd make, there 2 minutes before
  it, listed when it gets you in 3+ minutes sooner. Navigating, the same is
  offered once the bus you're walking to is seen gone (騎車追上).
  YouBike ideas are by station place (`plan.mjs`); rivers are crossed by
  the nearest bridge (`rivers.mjs`). TPASS counts as free (`tpass.mjs`).
  偏好電輔車 (the ⚡ after the plans card's ways of moving, this search's
  own): of stations about as near, one with 電輔車 there now, ridden at
  their pace (`plan.mjs` `PREFER_SEC`).
- **On board** (`lib/aboard.mjs`, Jay 2026-11-03): 規劃 from 你的位置 while
  on a bus or train plans from it, never from the point on the track. A train:
  the last 2½ minutes of fixes (`api.mjs recentFixes`) at a train's pace and
  today's train where you are going your way (`trainAboard`: timetable plus
  TDX's delay). A bus: faster than a bike between two fixes, every fix along a
  route's stops going its way, and TDX's estimate of that route's bus at the
  stop just ahead matching when you'll be there (`busesAboard`); two routes
  that fit are chips to pick. The ride to the stop nearest the place (and one
  more a kilometre off), then a trip planned from there (`planAboard`, the
  same ride boarded again joined on: `joinRide`). Navigation starts on the
  ride (`aboard` on the first leg). 不在車上 plans from the street; the metro
  (no fixes underground) as before; never a trip started by itself.
- **Speed:** the first plans wait at most 1.5 s on the buses' live times
  (`planner.mjs FIRST_WAIT`), the rest come with the second round.
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
  train than planned → the changes after it moved sooner. A bus you can't
  make (`pastHurry`: later than you'd hurry back) says 趕不上了, never 快一點.
  A trip with stops is one trip: the chips run on past each stop, the end
  time is the last place's; on a YouBike to a stop, 到了要還車嗎 (停著 or
  還車, with which is sooner) in its last 5 minutes (`parkAsk`). Off the plan your
  own way (`offPlan`): a bike's pace on a walk → on the YouBike step; heading
  for a later walk's end or the next stop → that step; heading nowhere on it →
  從這裡重新規劃 asked. Where you are is checked again every 20 s as on opening
  half way (a late train boarded after it was taken as missed); a rough fix
  far from the stop you were waiting at counts; fresh fixes only, and a watch
  silent 10 s is started over (twice as long each time it stays silent, up to a minute);
  one that hasn't answered yet (the location ask may be up) is left a minute, never a second ask over the first. Late for an
  arrival time → an on-time alternative offered. It resumes after the app
  is swiped away and tells the lock screen. 編輯行程 while navigating: a stop
  added, or the one you're heading to taken off or changed, re-routes and
  starts the new directions by itself.
- **Bikes at the next station** (`nav.mjs` `bikesText`): its counts;
  換附近的站 asked only when 2 or fewer are left (a 電輔車 ride: its own),
  else the count itself is the tap. Everywhere a station shows, 一般, 電輔車
  and 空位 are three columns apart; YouBike wears its own logo everywhere but
  the map, whose pins keep the bike glyph.
- **YouBike rental timer** (`rental.mjs`): starts by itself while
  navigating. With TPASS's free half hour, it warns at 25 minutes and
  offers nearby docks to swap: navigating, 附近換車 on the timer's line
  (the docks your way, one tapped cuts the ride there: `splitRide`).
- **到站提醒** (`alerts.mjs`): "tell me when the 5608 is 5 minutes away";
  the Worker checks every 2 minutes while the phone is locked.
- **Data:**
  - live: TDX through `/transit/tdx`, cached on the Worker; buses due through
    `/transit/eta` (`api.mjs busEta`): the Worker keeps each city's whole list
    from one TDX call and answers any stops or route from it (公路客運 by its stops);
  - bus routes and timetables: weekly packs in R2 (`packs.mjs`);
  - what's near a point: worked out on the phone (`near.mjs`);
  - line shapes: `shapes.mjs` (packs and shapes read with the kit's
    `packJson`; a piece TDX draws there and back, 六家線, cut into its two tracks);
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
- Buses come early or late, trains on time (Jay 2026-11-03): at a bus stop
  5 minutes before its timetable time, 2 before a bus seen live. A bus seen
  gone is never offered again, and never "hurry" when hurrying can't make it.
- A trip with stops is navigated as one trip (Jay 2026-11-03), the YouBike
  kept or returned at a stop as you choose.
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
- Every screen, either way up (Jay 2026-10-31): on a wide screen (640 px and
  up) the map's sheet is a panel at the map's left, beside the tab rail, as
  Maps on an iPad: on a phone on its side it keeps its three stops, on a
  tablet or a computer it is pinned whole, as tall as what it holds
  (`sheet.mjs` `pinned`, `tab-map.mjs` `SIDE_Q`/`PIN_Q`, `covered()` for what
  the map frames around); navigation's cards stand in its place. 交通, 我的 and
  查時刻 lay out in two columns (`transit.css` §11).
- Logs hold places: keep them in `captures/` (git-ignored).
- Taxis never.

## Files (`public/`)

| File | What |
| --- | --- |
| `app.mjs` | The frame: Pass, tabs, location |
| `lib/api.mjs` | The proxy: TDX, places, plans, walks; caches |
| `lib/planner.mjs`, `plan.mjs`, `live.mjs` | Planning; YouBike ideas, score and ranking; live re-timing |
| `lib/chase.mjs` | 追公車: a bus caught further along its way by YouBike |
| `lib/rail.mjs`, `metro*.mjs` | The train router; metro router, boards, maps |
| `lib/linemap.mjs`, `tra-map.mjs` | The station picker's line map (rerun `node scripts/tra-map.mjs` when 台鐵 opens a station) |
| `lib/bus.mjs`, `bus-ui.mjs`, `busgps.mjs` | Routes, stops, arrivals; the route strip; a route's sheet (its stops with the buses on the line: a bus a green dot a size up from a stop's, 進站中 / 即將進站 at the list's own size in the live green, never a red pill); a lagging bus placed by its GPS |
| `lib/board.mjs`, `board.css` | 交通's board: `boardRow` (a row of the one shape), `whenHtml` (the time at its end) |
| `lib/near.mjs`, `packs.mjs`, `shapes.mjs` | R2 data: what's near, bus packs, shapes |
| `lib/bike.mjs`, `rental.mjs`, `rivers.mjs`, `tpass.mjs` | YouBike; the rental timer; bridges; TPASS |
| `lib/nav.mjs`, `navlive.mjs`, `buzz.mjs`, `alerts.mjs` | Navigation; the buzz; bus alerts |
| `lib/aboard.mjs` | Already on a bus or train: which one, and the trip from its stops ahead |
| `lib/service.mjs` | What isn't running: operators' notices (台鐵, 高鐵, metros, buses) as rules |
| `lib/compass.mjs` | Which way the phone faces, for the soft beam on your dot (`.ot-beam`): the compass (an iPhone asks on 我的位置, then quietly on the first tap), else the GPS's heading when moving; none known, or riding a bus or train (`navNow().aboard`, or a bus's or train's pace), no beam |
| `tripWays` (tab-go) | 交通: under each trip's row its next ways (up to three in the next three hours: leave, rides, arrive), a tap shows that one on the map ready to go |
| `trimEnds` (tab-map) | A walk's or YouBike ride's line cut where it stops coming nearer its end (no detour past a station and back) |
| `declutter` (tab-map) | A trip's marks never in a heap: by the map's zoom the end, start, boarding and YouBike marks win their spot in that order, one covering a more important one waits for a closer zoom, your stop's name drops where it would run over one (`tests/declutter.test.mjs`) |
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

A push to `main` tests, stamps versions and deploys to Cloudflare.

## If you change…

| This | Also check |
| --- | --- |
| The score or ranking | The verdicts, `live.mjs --against`, `replay.mjs` |
| A TDX path | Orbit-Core's `TDX_RULES` and cache times, the `bus` push check |
| Pack formats | Orbit-Core's `builders/buses.js` |
| Navigation steps | `ot.nav.v1` resuming, lock-screen notices (`kind: nav`) |
