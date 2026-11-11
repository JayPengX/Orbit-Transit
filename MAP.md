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
    a trip planned from anywhere. Search lists a station once (`uniqueResults`:
    Google's 台鐵新竹車站, 新竹火車站, 新竹 at its door fold into it), the
    railway the words name first (火車站 台鐵, 高鐵 高鐵). YouBike only
    (`bike.mjs mergeBikes`: 彰化's Moovo, ServiceType 3, isn't shown or planned on).
    Live counts are read by the phone from YouBike's own `parkingInfo` (its
    firewall refuses Cloudflare; 10 km circles, `circlesOf`), names from the
    proxy's TDX station list, the proxy's TDX counts if YouBike fails.
    釘選這個方案 on a way with no trip saved yet makes a one-time trip that day,
    leaving then, the way first (`oneTimeTrip`; Jay 2026-11-06). A stop's signs a few metres apart are one
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
    map's other recommendations in its order (two at least, filled from the rest), leaving within three hours of the way
    shown (`otherWays`; not of now: a 16:45 trip opened at 14:05 lost 17:07's
    快捷8號支, Jay 2026-11-10). Opened again the next morning (its kept ways
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
    map: `linemap.mjs`, the lines from `scripts/tra-map.mjs`; with 台鐵 picked
    only 台鐵's stations, with 高鐵 picked its one line 南港 to 左營, each
    station's 台鐵 under it, `hsrMapHtml`, `HSR_TRA`; switched with a station of
    the other railway picked, that station's own there, 六家 ↔ 高鐵新竹,
    `fitStation`; Jay 2026-11-10), each train a
    card that opens in place, sliding, the tapped card kept under the finger
    (`toggleCard`; later reads, delays and fares, patch the cards: `freshen`),
    every 台鐵 train today 準點, 晚 N 分 or 未發車 (`trainNow`: the boards of the
    two stations asked, `traDelays`, give a delay only to trains on their way;
    read again a minute on; Jay 2026-11-10);
    查車次, a search bar at the top (Jay 2026-11-10), a
    台鐵 or 高鐵 number, the day's trains with it and a tap its every stop and
    time (`tab-train.mjs trainNoSheet`, `ticket.mjs trainsNumbered`; Jay 2026-11-06), bus
    routes by number or stop (附近: your city, its neighbours and the 公路客運;
    全部: every place's, `cityRoutes` each, those around you first and the rest
    four at a time, found routes ranked yours first, `findRoutes` `rank`, each
    saying its city; one far from you not asked for its next bus, `far`; Jay
    2026-11-10), stop timetables, and 捷運: each city's metro
    as a metro map (`metromap.mjs`: from TDX's real stations, relaxed, then
    `straighten` by least squares onto the eight directions with even gaps
    and no station on another line's track; worked out ahead by
    `scripts/metro-maps.mjs` into `metro-drawings.mjs`, which starts from
    the kept drawing; a phone redraws only when the network changes, kept
    as `metro-map-v2/<city>`). `mountMap` draws it on a canvas filling the
    screen down to the tabs (`--mm-top`) or full screen (`.mm-full`, moved
    to `body`): pinch, drag that coasts, two taps in, two fingers out, the
    wheel and keys; lines widen and names grow gently with zoom, names
    placed per zoom step so none overlap (`placeNames`); lines sharing a
    track run side by side; the trains arriving now beside their track.
    Over it: the cities (雙北, 桃園, 台中, 高雄), 搜尋車站 across all nine
    systems by name, English name or code (`findMetro`; 最近查看, 附近,
    轉乘站), 實景 for the real map, 定位, the lines to focus. A station
    tapped is ringed, and opens: its line codes, the next trains each way counting
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
    pass with free first half hours; `tpass.mjs bikeSwap`): a ride over 30
    minutes is cut at any station on the way, the first part nearest 26
    minutes (`plan.mjs swapRides`; Jay 2026-11-10: 竹東高中 → 竹北 stayed one
    46′ ride, its station 801 m off the one point looked at), the maps app.
    A switch keeps the page where it is.
    Places, bus groups and their stops are put in order by their grips
    (kit `reorder`; `tab-me.mjs`, `bus-ui.mjs` manageSheet).
- **Planning** (`lib/planner.mjs`): Google's and TDX's planners side by
  side, plus our own 台鐵/高鐵 router (`rail.mjs`, Connection Scan) and
  metro router. A trip within 2 km (straight) is a walk too when no planner
  gave one (`walkPlan`: Google's walk kept a month, else OpenStreetMap's
  walking router with its line; Google's planner stops at 100 trips a day).
  A planner's YouBike ride needs a real station at each end
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
  routes, never waiting past 2.5 s), so a frozen feed is felt nowhere. The
  routes' GPS asked within a moment go as one ask a city (`routeGps`,
  `api.mjs busGps`: the Worker's `/transit/gps` reads a city's whole list
  once for every route and every phone, 公路客運's by its routes), once in
  each 20 s of the clock (a bus sends its place each 20 s), saying how old
  the copy is (`had=`): a stop card read TDX's GPS 24 → 17 times in 3
  minutes (2026-11-06), and a crowd at different stops reads it once a city.
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
  the nearest bridge (`rivers.mjs`). Which station: the walks by the streets
  and the rides by the roads (`api.mjs bikeRides`: OpenStreetMap's bike
  router, one table ask from the stations near the start to those near the
  end and the end itself, inside the planner's 1.5 s for the walks; a ride's
  length then the roads', `rideLeg`); the straight line and its guess at a
  station past the door (`back`) only where they aren't in (Jay 2026-11-07:
  博愛街 → 成功九街 back at 新竹縣體育場 where 成功國中 is by the door: Google's
  walk matrix answered 403, so the walk was OpenStreetMap's 460 m round the
  school, not Google's 267 by the lane; the proxy now asks Compute Routes a walk
  each then; `tests/bike-roads.test.mjs`). A walk kept on the phone that Google
  didn't answer is asked again after 6 hours (`api.mjs WALK_RETRY_MS`; 11-09
  the 460 m still stood: `tests/walks-retry.test.mjs`). TPASS counts as free (`tpass.mjs`).
  A plan's price line: our own trains at their real fares when it's trains
  alone, the planner's never then (Google priced 普悠瑪 107 新竹 → 彰化 at the
  區間's NT$213, 查時刻 NT$331; Jay 2026-11-06), else the planner's own fare, else
  ours (`raildata.mjs planFare`, `tpass.mjs fareOf`, TDX's ODFare as 查時刻's, read while the
  buses are looked at; a bus or the metro beside them unpriced makes it
  `NT$… 起`); the ranking still costs trains by distance (`tests/cross-county.test.mjs`).
  The facts line under a plan wraps between facts, never inside one.
  A train is drawn through its own stops when it stops between (`roadLegs`:
  a planner's shape passing a stop by 1.5 km is replaced; 普悠瑪 107 by the 山線, not the 海線).
  Nothing within three hours (a place in the country past its station, no bus
  on from it and no YouBike there: 台北 → 池上's 伯朗大道): the trains with a
  walk up to 6 km at the end (`RAIL_FAR_WALK_M`), beside tomorrow's ways.
  Into a metro's area (台北・新北, 桃園, 台中, 高雄), our trains go on by our
  metro router from each of their stops there (`planner.mjs trainThenMetro`:
  高鐵 to 台北 then the 淡水信義線 to 101, over 高鐵 to 板橋, 區間 to 松山 and a
  YouBike; Jay 2026-11-06), ranked with the rest; the metro's network asked at
  the start (`metroWarm`), never waited on past 1.5 s (`tests/train-metro.test.mjs`).
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
  the delays of the three trains that could be it, `trainsNear`, each its own
  read, `traTrain`, those in by 1½ s). A bus: faster than a bike between two fixes, every fix along a
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
  **下雨改搭車** (`lib/rain.mjs`, Jay 2026-11-10, the family's links): Orbit
  Weather tells the family's notebook where rain is due (`weather.rain`: each
  of its places' wet stretches, the radar's then the hours at 50%+); a trip
  with a Weather place within 8 km of either end (`rainFor`) costs a YouBike
  ride or a walk of 3 minutes or more in the rain more (`rainCost`, the
  score's `rain`), so a bus or the metro comes first; its card marks those
  legs with a drop and says 會淋雨 (`markWet`). Nothing known: as before.
- **Navigation** (`nav.mjs`, `navlive.mjs`): the whole trip on the map,
  each step moving on by itself (on board only once two fixes say so; a
  rough fix moves the dot, never the trip), countdowns, the stops to go, a buzz (a
  chime on iPhone) before yours. A 台鐵 train followed: its own delay alone
  (`raildata.mjs traTrain`, 台鐵's own 車次查詢 through the Worker, no TDX).
  Never every 台鐵 train at once (TDX's whole board: off TDX, 2026-11-10): a
  ride's, a pin's and 查時刻's delays come from the boards of the stations
  they leave from and get to (`traLive(ids)`, 台鐵's own 車站時刻 through the
  Worker; a station's map card the same, with no platforms). On board, where you are along the ride
  (`navlive.mjs rideAlong`, `rideOn`) is looked for only near where it last
  had you: a route that comes back past itself (a loop, out one street and
  back on its pair) never has you off early or back at stops passed. Missed bus → the next; on an earlier
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
  A trip with stops is one trip: the chips run on past each stop; the
  bottom bar's time is the next stop's (`到 墨竹亭 還要 …`, `stopShort`; Jay
  2026-11-07: "full trip length should be about when I arrive my first
  stop"); a step ahead tapped shows its own length and time, the trip's
  times kept from the step you're at (`state.reached`; Jay 2026-11-07: "when
  I click walk it though I gonna walk from where I am now"); each stop has its pin on the map (a size down
  from the end's) and every leg after it its roads, as the first stretch's
  (`tab-map roadLegs` over `tripLegs`, a road kept by its ends for the
  stretch's re-timed copies, `roadsKnown`; Jay 2026-11-07: "after that
  destination it's all straight line"; `tests/stop-roads.test.mjs`); each
  step after a stop a tap that shows it on the map (`peek`, the step you're
  at kept), and on a ride the trip's own YouBike stations to its last place
  (`navLook`); a trip under way whose stretches after a stop came from an
  older way of planning has them planned again when it's opened (`PLAN_V`,
  `laterIn`; Jay 2026-11-07: "I want my current trip to get the update";
  `tests/nav-later-peek.test.mjs`); on a YouBike to a stop, 到了要還車嗎 (停著 or
  還車, with which is sooner) in its last 5 minutes (`parkAsk`). Off the plan your
  own way (`offPlan`): a bike's pace on a walk → on the YouBike step; heading
  for a later walk's end or the next stop → that step; heading nowhere on it →
  從這裡重新規劃 asked. Where you are is checked again every 20 s as on opening
  half way (a late train boarded after it was taken as missed); a rough fix
  far from the stop you were waiting at counts; a fix stamped over 30 s old
  (an iPhone back from sleep hands over its last one) moves nothing (`api.mjs
  fixAt`); a ride is missed only when you're seen at its stop a minute after it
  left; a train you're found on while the planned one hasn't left yet is the
  nearest running by its clock out to 15 km (an express drawn straight between
  far stops; Jay 2026-11-07, 普悠瑪 107 past 香山 taken for 自強 105 at 新竹:
  `tests/nav-woke-aboard.test.mjs`); a train changed mid-trip moves what follows
  by its arrival and its line is found again (`tab-map navDraw`). 台鐵's track is
  OpenStreetMap's (`public/rail-tra.json`, 25 KB, `node scripts/rail-osm.mjs`;
  ODbL, credited in README: no source named on screen, TRUTH §7), tried before TDX's broken pieces (`shapes.mjs
  railPack`, `railGroups().first`); a train's way drawn before it is drawn again
  (`tab-map TRACK_V`). A one-time trip goes 20 minutes after its time
  (`store.mjs tripOver`; Jay 2026-11-07, it stayed all day offering other trains
  while he rode the one pinned); fresh fixes only, and a watch
  silent 10 s is started over (twice as long each time it stays silent, up to a minute);
  one that hasn't answered yet (the location ask may be up) is left a minute, never a second ask over the first. Late for an
  arrival time → 最快 on the 出狀況 card. It resumes after the app
  is swiped away and tells the lock screen. 編輯行程 while navigating: a stop
  added, or the one you're heading to taken off or changed, re-routes and
  starts the new directions by itself.
- **Bikes at the next station** (`nav.mjs` `bikesText`): its counts;
  換附近的站 asked only when 2 or fewer are left (a 電輔車 ride: its own),
  else the count itself is the tap. The tap takes the station the planner
  would (`swapPick`: your walk to it and the ride on, more than 2 bikes where
  any has), never the nearest to the old one (Jay 2026-11-09: 文興路莊敬南路口
  behind him), and the leg keeps the station (`rent`/`ret`) so its pin moves. Everywhere a station shows, 一般, 電輔車
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
    `/transit/eta` (`api.mjs busEta`): the Worker answers 新竹's, 臺北's,
    新北's from the cities' own sites (Core `transit-free.js`); 臺中's, 桃園's and 臺南's
    the phone reads itself from the cities' bus sites (`ebbus.mjs`, loaded only when asked:
    the kit's reader `ebus-read.mjs`, the Worker's too; routes asked within a moment one read;
    times and buses' places), the Worker's for what it can't answer and for 5 minutes after
    a site fails (`tests/ebbus.test.mjs`; Jay 2026-11-10: what a phone can read, it reads); 高雄's
    the phone reads itself from the city's ibus site, which answers only Taiwan's own networks
    (`khbus.mjs`, loaded only when asked: TDX's ids from the site's, each estimate worded as
    the proxy words 臺中's, kit `ebus.mjs`; buses' places too, `busGps`), the Worker's for
    what it can't answer and for 5 minutes after it fails (`tests/khbus.test.mjs`); else
    a quiet city's stops or routes from TDX's filtered read, a busy city's from
    one read of the whole city (公路客運 always by its stops); the phone asks the same thing
    once a beat at most, and the routes asked within a moment as one ask a
    city (`routes=`; a plan's buses were five to ten asks, 2026-11-06); where
    a city's estimates come every 30 s (新竹, 新竹縣, 公路客運), not again
    until the next can be there (each city's rhythm learnt from its answers;
    a stop whose rows sat one out, again once it's surely at TDX, 5 s on),
    and an ask says how old the phone's copy is (`had=`: the Worker reads TDX
    then if its own is no newer); `tests/bus-asks.test.mjs`, `bus-quiet.test.mjs`,
    `scripts/bus-rhythm.mjs` (the rule against TDX's timing, a stop card's
    asks before and after);
  - bus routes and timetables: weekly packs in R2 (`packs.mjs`, built from
    TDX's free GTFS on GitHub: Core `tools/gtfs-buses.mjs`; 新北's ways
    TDX doesn't time filled from 新北's own route list, Core `builders/ntpc.js`).
    The metros' maps and timetables, 高鐵's days, a city's route list and the
    rail stations are the Worker's copies in R2 too (Core `transit-free.js`),
    asked the same way through `/transit/tdx`: nothing here changed for them.
    So are the metros' live boards, from the operators' own (臺北's open
    file, 高雄's 高捷e遊行 a station at a time, 機場捷運's platform screens),
    in TDX's shape; a board's every live train a way, soonest first, before
    the timetable's (`metro.mjs withLive`).
    A route sheet's 時刻表 at a stop not timed itself (most of 台北, 新北,
    桃園, 台中 list only the first stop) is the first stop's plus the ride,
    said 依起站…推估 (`live.mjs stopTable`; 988, Jay 2026-11-09); the bus
    stations (the map's stops, the stops near you: `bus.mjs stationsNear`)
    from weekly 0.05° tiles in R2 (`packs.mjs stationRows`, Core
    `builders/buses.js cityStations`), never TDX's advanced search around
    each new ~200 m, asked only when a tile can't be had
    (`tests/map-stops.test.mjs`);
  - what's near a point: worked out on the phone (`near.mjs`); the buses at
    the stops near you (附近, `bus-ui.mjs nearStops`) and at a plan's stops
    (`etaAround`) through `/transit/eta` too, never TDX's advanced search of
    the buses around a point (7.5 basic asks' points, made each ~100 m and
    20 s, never shared: most of a phone's TDX points on 2026-11-06;
    `tests/near-stops.test.mjs`); the map's shelves aren't read while a card
    or the search's results cover them (`tab-map.mjs shelvesShown`);
  - line shapes: `shapes.mjs` (packs and shapes read with the kit's
    `packJson`; a piece TDX draws there and back, 六家線, cut into its two tracks);
  - the map: Google under the month's cap, else NLSC. Google's places keep
    their own colours (greyed for an hour on 2026-11-06: Jay "I hate it");
    its own bus stops off in light and dark (`map.mjs mapStyles`,
    `tests/map-style.test.mjs`). A tap on one of its places
    (`tab-map.mjs googlePlace`) opens its card at once, the station lists
    waited on 250 ms at most (a station near it opens ours); its name from
    `/transit/place` (除錯紀錄 `place-tap`: how long, `spot-tap`: a tap on
    nothing). A place's or a spot's card shows the YouBike near it, never
    its bus stops (Jay 2026-11-06: "unhelpful");
  - walks: Google's streets, OpenStreetMap past the cap; asked from a
    spot on a ~40 m grid (`planner.mjs spotOf`, the map's `fromHere` too),
    so a plan finds the walks the map's YouBike strip asked (a plan's 15 → 10).
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
  臺中's and 高雄's bus notices the phone reads itself from the cities' own bus
  sites (`ebnotice.mjs`, loaded only when asked; 高雄's answers only Taiwan's
  networks, and asks a route at a time when its site wants that), worded as the
  proxy words them (kit `ebus.mjs`); the Worker's for what they can't answer and
  for 5 minutes after one fails (`tests/ebnotice.test.mjs`).

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
  查時刻 lay out in two columns (`transit.css` §11): 交通's 要去哪裡 and places
  across the top (`.q-span`), the trips beside the pins level under it (no pins:
  the trips the width, their cards side by side, `.ob-solo`); 查時刻's 最近 under
  the question beside the trains (`.ot-tq-recent-side`; after them on a phone).
  Jay's iPad 2026-11-11.
- Logs hold places: keep them in `captures/` (git-ignored).
- Taxis never.

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
