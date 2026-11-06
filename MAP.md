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
    its bikes, 怎麼去), then 行程: each trip its own card (Jay 2026-11-03:
    交通 "boring", the first ride's bike badge "misleading"): its main ride's
    badge (`mainRide`: the ride you're on longest), its name and ends, when to
    leave counting down, or why not (`tripWhy`); under it the way as one line
    (`ui.mjs journeyLine`: each ride its colour by its minutes, a change a
    ring), leave and arrive at its ends, its rides as chips; then 其他班次, the
    next two ways in three hours. Opened again the next morning (its kept ways
    two hours old), a trip shows its last ways at once, moved on by whole days,
    said 更新中… while they're found again (`lastGuess`, `ot.trips.last.v1`: a
    slim copy a way, eight days; same hour within 90 minutes, same kind of day;
    never navigated or notified on; Jay 2026-11-06: 上學 sat on 找班次…).
    A school day's trip whose time went by (20 min to 3 h) while you're not
    there yet: its way now as a card of its own above the next time's, that
    one saying its day (`tripLate`, Jay 2026-11-06: "show both").
    A tap on the top opens its ways on the map,
    on a way that way ready to go; editing it is in 我的. Then 釘選: each
    pinned bus and train a row of one shape in the order you keep them (beside
    the trips on a wide screen). No 附近 (Jay 2026-11-03: "basically useless";
    its live read of every bus around you every 20 s went with it; the map
    has what's near).
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
  - **我的:** trips (each a way there and a way back, its time at the
    right edge), places, pinned stops, 規劃: TPASS, each way of moving a
    switch (the last one on stays on), 每 30 分換一台 YouBike as the person's
    own choice (`prefs.swap30` 'on'/'off', else as before: 每 30 分換車 or a
    pass with free first half hours; `tpass.mjs bikeSwap`), the maps app.
    A switch keeps the page where it is.
    Places, bus groups and their stops are put in order by their grips
    (kit `reorder`; `tab-me.mjs`, `bus-ui.mjs` manageSheet).
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
  where TDX sees a bus ahead of the one you'd make (a stopped feed never
  counts), there with room to spare (`chaseSlack`: 2 minutes, 15% of the
  trip there and 10% of the bus's countdown, 4 at least), listed only when it
  gets you in clearly sooner (`chaseGain`: 8+ minutes and half the riding),
  ranked with a 4-point `race` (Jay 2026-11-06: it flipped and was too tight).
  Steady: a chase leaves now while it keeps room (`chaseNow`); re-timed, it
  keeps that very bus with `chaseHold` to spare or is `lost` and hands its
  card to the near stop (`adjustPlan`, `rollPlans`); found again (a replan,
  the planner's later round, on 交通 and the map's card) the stop the card
  showed keeps it unless the other is 10 minutes sooner (`steadyLead`).
  Never offered while navigating, and never on a replan under way
  (`planTrip`'s `chase: false`; Jay 2026-11-06: "not force me to go further").
  YouBike ideas are by station place (`plan.mjs`); rivers are crossed by
  the nearest bridge (`rivers.mjs`). TPASS counts as free (`tpass.mjs`).
  A plan's price line: the planner's own fare, else our own trains at their
  real fares (`raildata.mjs planFare`, TDX's ODFare as 查時刻's, read while the
  buses are looked at; a bus or the metro beside them unpriced makes it
  `NT$… 起`); the ranking still costs trains by distance (`tests/cross-county.test.mjs`).
  Nothing within three hours (a place in the country past its station, no bus
  on from it and no YouBike there: 台北 → 池上's 伯朗大道): the trains with a
  walk up to 6 km at the end (`RAIL_FAR_WALK_M`), beside tomorrow's ways.
  A 高鐵 ridden past the place and back by another train (0149 skips 台南: to
  左營, back by 自強) is dropped when a way that doesn't ride past gets in
  within 15 minutes of it (`plan.mjs overshoots`, `dropOvershoots`).
  偏好電輔車 (the ⚡ after the plans card's ways of moving, this search's
  own): of stations about as near, one with 電輔車 there now, ridden at
  their pace (`plan.mjs` `PREFER_SEC`). 我的's 偏好電輔車 (`prefs.ebike`, off by
  default, Jay 2026-11-04) is where it starts: on, every search and saved trip
  prefers them (`planTrip`'s `ebike` unsaid = the pref) and station cards count
  電輔車 first (`look.mjs ebikeFirst`, handed the pref by `app.mjs`).
- **指定車次** (`lib/ticket.mjs`, `planner.mjs planTicket`, Jay 2026-11-03:
  "some train you buy ticket, HSR as well"): the plans card's time chip →
  指定車次: a 台鐵 or 高鐵 number typed, the day picked, the day's trains with
  it listed from the timetable already loaded (no read of its own), on and
  off at the stops nearest the trip's ends (two pickers to change them). Or
  查時刻's 用這班規劃路線 under a journey's steps (its trains, to its last
  station). The trip is that train: to its station 3 minutes before (高鐵 5)
  by a walk within 800 m, else the planners' ways there by then (never on the
  ticket's own train); then on from where it gets in as any trip from that
  station; ranked together. The chip shows the train; 現在出發 clears it.
  Inside a TPASS area the train list and planner still keep to the pass's
  trains (查時刻 says so, with 全部班次 a chip away, `· TPASS` on the ones it
  covers); a ticket's train is never filtered.
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
- **What's shown stays** (`lib/steady.mjs`; Jay 2026-11-06: "it update the
  trip in front of me which is bad", "the first show is the final result"):
  the plans card and 交通's trip cards wait for the second round before their
  first show (`settled`, up to 6 s past the first round, the skeleton or the
  trip's last ways meanwhile); ways set aside as gone and a trip's later
  stretches before it too. Anything found after that (a slow second round,
  the real ways over a trip's last ways) is merged in place (`steadyPlans`):
  each way shown keeps its place, rank and labels, only its times change; a
  new way comes in quietly at the end, never 推薦; the way open stays open
  (`samePlanAt`). The phone keeps the ways as ranked, so the next opening ranks
  afresh (`tests/steady-plans.test.mjs`).
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
  train than planned → the changes after it moved sooner; waiting for a
  train, a sooner one still to come is taken, except a train you picked
  (`pickedPlan`: a later one chosen over an earlier one on the plans card or
  交通's 其他班次, 指定車次, 改搭別班; `leg.picked`), kept as chosen. A bus you can't
  make (`pastHurry`: later than you'd hurry back) says 趕不上了, never 快一點.
  **出狀況, one card** (`lib/trouble.mjs`, Jay 2026-11-06: missed or wrong
  bus, "not limited to bus"): a bus, train or metro you can't make or that's
  gone shows 趕不上 X with two rows, each with when you're there: 下一班 (the
  same line's next run from the same stop; taken by itself once the one
  planned is gone, ticked) and 最快 (the quickest way from where you are,
  planned whole by tab-map `navFastest`, no 追公車; dropped when it isn't a
  minute sooner than 下一班). To be there by a time: late rows say 晚 N 分,
  and a way gone late asks 最快 (`late`). No bike or dock within 500 m: 最快
  (`bike`). At its stop, then moving at a bus's or train's pace away from it
  and off its way, or on board and off its way at speed: 好像搭錯車了？
  (`wrongRide`, `offKind`), 從這裡重新規劃 planned from the ride you're on
  (aboard.mjs, leaving now); at a walk: 好像已經下車了？; away from it all:
  不照這條路走了？. The card shows once it's whole, then only times move; ×
  is never asked again for that run. Steps still move only by GPS.
  **Replays** (`tests/navreplay.mjs`): navigation records each trip
  (`state.trace`: the plan, every fix, steps reached, cards shown; 除錯紀錄
  `navtrip`); `node scripts/replay-nav.mjs <log.json>` drives it again through
  today's code (logs stay in captures/); `tests/nav-replay.test.mjs` replays
  `tests/fixtures/trips/*.json` (made on 快捷8號's real route by
  `scripts/trip-fixture.mjs`) against what each should do.
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
  arrival time → 最快 on the 出狀況 card. It resumes after the app
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
  - the map: Google under the month's cap, else NLSC. Google's in Orbit's
    look in light and dark (`map.mjs mapStyles`, Jay 2026-11-06): its place pins
    (food, hotels, hospitals, temples, stations) one quiet graphite, shops
    quieter, so the only colour is ours; its own bus stops off
    (`tests/map-style.test.mjs`). A style only: nothing read, nothing spent;
    Google's styles can only grey a pin, never tint or reshape it;
  - walks: Google's streets, OpenStreetMap past the cap.
- **Offline:** covered (`onlineOnly`); never old bus times.
- **Saved:**
  - On the Pass (`store.mjs`, `t1:`, up to 200,000 characters): groups,
    pins, trips, preferences.
  - On the phone: `ot.trips.v2` (planned ways), `ot.nav.v1` (navigation).

## Decisions in force

- **Taiwan only** (Jay 2026-11-06: "block international user from using Taiwan only service outright"): outside Taiwan the kit's card covers the app (`twOnlyCheck`, the country of the last sign-in) and `lib/api.mjs ask` asks nothing; the proxy answers `/transit/…` with 403 `TW_ONLY` (the dev door and the showcase's demo stay open).

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
| `lib/linemap.mjs`, `tra-map.mjs` | The station picker's line map: each line winding across its card (`rowLength`, `mapCols`), 新竹市/嘉義市 one area with their 縣 (`areaOf`, `areaParts` joins the lines), a 高鐵 station within 900 m of a 台鐵 one a tap on that stop (rerun `node scripts/tra-map.mjs` when 台鐵 opens a station) |
| `lib/bus.mjs`, `bus-ui.mjs`, `busgps.mjs` | Routes, stops, arrivals; the route strip; a route's sheet (its stops with the buses on the line: a bus a green dot a size up from a stop's, 進站中 / 即將進站 at the list's own size in the live green, never a red pill); a lagging bus placed by its GPS |
| `lib/board.mjs`, `board.css` | 交通's board: `boardRow` (a row of the one shape), `whenHtml` (the time at its end) |
| `lib/near.mjs`, `packs.mjs`, `shapes.mjs` | R2 data: what's near, bus packs, shapes |
| `lib/bike.mjs`, `rental.mjs`, `rivers.mjs`, `tpass.mjs` | YouBike; the rental timer; bridges; TPASS |
| `lib/nav.mjs`, `navlive.mjs`, `trouble.mjs`, `buzz.mjs`, `alerts.mjs` | Navigation; 出狀況 (missed, late, no bikes, wrong ride); the buzz; bus alerts |
| `lib/aboard.mjs` | Already on a bus or train: which one, and the trip from its stops ahead |
| `lib/ticket.mjs` | 指定車次: a train by its number, where to get on and off, found again for the planner |
| `lib/service.mjs` | What isn't running: operators' notices (台鐵, 高鐵, metros, buses) as rules |
| `lib/compass.mjs` | Which way the phone faces, for the soft beam on your dot (`.ot-beam`): the compass (an iPhone asks on 我的位置, then quietly on the first tap), else the GPS's heading when moving; none known, or riding a bus or train (`navNow().aboard`, or a bus's or train's pace), no beam |
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

A push to `main` tests, stamps versions and deploys to Cloudflare.

## If you change…

| This | Also check |
| --- | --- |
| The score or ranking | The verdicts, `live.mjs --against`, `replay.mjs` |
| A TDX path | Orbit-Core's `TDX_RULES` and cache times, the `bus` push check |
| Pack formats | Orbit-Core's `builders/buses.js` |
| Navigation steps | `ot.nav.v1` resuming, lock-screen notices (`kind: nav`) |
